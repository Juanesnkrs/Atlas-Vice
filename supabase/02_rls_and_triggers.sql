-- =============================================================================
-- ATLAS VICE - MIGRACIÓN 02: RLS COMPLEMENTARIAS Y TRIGGERS
-- Requiere: supabase/schema.sql aplicado previamente.
-- No añade columnas ni modifica tablas. Idempotente (re-ejecutable).
-- Motor: PostgreSQL 15+ (Supabase)
-- =============================================================================

-- =============================================================================
-- 0. HELPER: public.is_admin()
--    SECURITY DEFINER evita recursión RLS al consultar public.profiles.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid() AND rol = 'ADMIN'
    );
$$;

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO anon, authenticated, service_role;

-- Verdadero cuando la operación llega desde la API (PostgREST) como usuario
-- final (roles anon / authenticated). Las funciones SECURITY DEFINER, el editor
-- SQL y el service_role se ejecutan con otro current_user y quedan exentos.
CREATE OR REPLACE FUNCTION public.is_end_user_request()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = public
AS $$
    SELECT current_user IN ('anon', 'authenticated');
$$;

REVOKE ALL ON FUNCTION public.is_end_user_request() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_end_user_request() TO anon, authenticated, service_role;

-- =============================================================================
-- 1. PERFIL AUTOMÁTICO AL CREAR USUARIO EN auth.users
-- =============================================================================

-- Genera un username saneado y único a partir de un texto base.
CREATE OR REPLACE FUNCTION public.generate_unique_username(p_base TEXT)
RETURNS TEXT
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_max_len   CONSTANT INT := 24;
    v_base      TEXT;
    v_candidate TEXT;
    v_suffix    TEXT;
    v_n         INT := 1;
BEGIN
    -- Sanea: minúsculas, solo [a-z0-9_], sin guiones bajos en extremos.
    v_base := lower(coalesce(p_base, ''));
    v_base := regexp_replace(v_base, '[^a-z0-9_]+', '_', 'g');
    v_base := regexp_replace(v_base, '_{2,}', '_', 'g');
    v_base := btrim(v_base, '_');
    v_base := left(v_base, v_max_len);
    IF length(v_base) < 3 THEN
        v_base := 'jugador';
    END IF;

    v_candidate := v_base;
    WHILE EXISTS (SELECT 1 FROM public.profiles WHERE username = v_candidate) LOOP
        v_n := v_n + 1;
        IF v_n <= 50 THEN
            v_suffix := '_' || v_n::TEXT;                                   -- sufijo incremental
        ELSE
            v_suffix := '_' || substr(replace(gen_random_uuid()::TEXT, '-', ''), 1, 6); -- aleatorio
        END IF;
        v_candidate := left(v_base, v_max_len - length(v_suffix)) || v_suffix;
    END LOOP;

    RETURN v_candidate;
END;
$$;

REVOKE ALL ON FUNCTION public.generate_unique_username(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.generate_unique_username(TEXT) FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_meta       JSONB := coalesce(NEW.raw_user_meta_data, '{}'::jsonb);
    v_is_discord BOOLEAN := coalesce(NEW.raw_app_meta_data ->> 'provider', '') = 'discord';
    v_raw_name   TEXT;
    v_username   TEXT;
    v_discord_id TEXT;
    v_avatar     TEXT := nullif(v_meta ->> 'avatar_url', '');
    v_attempt    INT := 0;
BEGIN
    v_raw_name := coalesce(
        nullif(v_meta ->> 'username', ''),
        nullif(v_meta ->> 'full_name', ''),
        nullif(v_meta ->> 'user_name', ''),
        nullif(v_meta ->> 'name', ''),
        nullif(v_meta ->> 'preferred_username', ''),
        nullif(split_part(coalesce(NEW.email, ''), '@', 1), ''),
        'jugador'
    );

    IF v_is_discord THEN
        v_discord_id := coalesce(nullif(v_meta ->> 'provider_id', ''), nullif(v_meta ->> 'sub', ''));
    END IF;

    v_username := public.generate_unique_username(v_raw_name);

    LOOP
        BEGIN
            INSERT INTO public.profiles (id, username, avatar_url, discord_id, rol)
            VALUES (NEW.id, v_username, v_avatar, v_discord_id, 'USER')
            ON CONFLICT (id) DO NOTHING;
            EXIT;
        EXCEPTION WHEN unique_violation THEN
            -- Carrera en username o discord_id ya vinculado a otro perfil.
            v_attempt := v_attempt + 1;
            IF v_attempt >= 5 THEN
                RAISE;
            END IF;
            v_username := public.generate_unique_username(
                v_raw_name || '_' || substr(replace(gen_random_uuid()::TEXT, '-', ''), 1, 4)
            );
            IF v_attempt >= 2 THEN
                v_discord_id := NULL;
            END IF;
        END;
    END LOOP;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Backfill: usuarios ya existentes sin perfil (fila a fila para que cada
-- username generado vea los anteriores y no colisione).
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT u.id, u.email
        FROM auth.users u
        WHERE NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = u.id)
    LOOP
        INSERT INTO public.profiles (id, username, rol)
        VALUES (
            r.id,
            public.generate_unique_username(
                coalesce(nullif(split_part(coalesce(r.email, ''), '@', 1), ''), 'jugador')
            ),
            'USER'
        )
        ON CONFLICT (id) DO NOTHING;
    END LOOP;
END;
$$;

-- =============================================================================
-- 2. PROFILES: LECTURA PÚBLICA + ACTUALIZACIÓN DEL PROPIO PERFIL
-- =============================================================================
DROP POLICY IF EXISTS "Lectura publica profiles" ON public.profiles;
CREATE POLICY "Lectura publica profiles" ON public.profiles
    FOR SELECT USING (TRUE);

DROP POLICY IF EXISTS "Actualizar propio perfil" ON public.profiles;
CREATE POLICY "Actualizar propio perfil" ON public.profiles
    FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- Bloquea la autoasignación de rol y protege campos de sistema.
CREATE OR REPLACE FUNCTION public.guard_profile_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    IF public.is_end_user_request() AND NOT public.is_admin() THEN
        IF NEW.rol IS DISTINCT FROM OLD.rol THEN
            RAISE EXCEPTION 'No autorizado: solo un ADMIN puede cambiar el rol'
                USING ERRCODE = '42501';
        END IF;
        NEW.id         := OLD.id;
        NEW.discord_id := OLD.discord_id;   -- vinculado vía OAuth, no editable a mano
        NEW.created_at := OLD.created_at;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_guard_update ON public.profiles;
CREATE TRIGGER trg_profiles_guard_update
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION public.guard_profile_update();

-- =============================================================================
-- 3. SUBMISSIONS: USER (INSERT + SELECT propio) / ADMIN (SELECT + UPDATE)
-- =============================================================================
DROP POLICY IF EXISTS "Crear propios aportes" ON public.submissions;
CREATE POLICY "Crear propios aportes" ON public.submissions
    FOR INSERT WITH CHECK (auth.uid() = user_id AND estado = 'PENDIENTE');

DROP POLICY IF EXISTS "Leer propios aportes" ON public.submissions;
CREATE POLICY "Leer propios aportes" ON public.submissions
    FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admin lee aportes" ON public.submissions;
CREATE POLICY "Admin lee aportes" ON public.submissions
    FOR SELECT USING (public.is_admin());

DROP POLICY IF EXISTS "Admin modera aportes" ON public.submissions;
CREATE POLICY "Admin modera aportes" ON public.submissions
    FOR UPDATE USING (public.is_admin()) WITH CHECK (public.is_admin());

-- =============================================================================
-- 4. ADMIN: GESTIÓN COMPLETA DE CONTENIDO Y MODERACIÓN DEL FORO
--    (FOR ALL también permite al ADMIN leer módulos inactivos)
-- =============================================================================
DROP POLICY IF EXISTS "Admin gestiona modules" ON public.modules;
CREATE POLICY "Admin gestiona modules" ON public.modules
    FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admin gestiona entities" ON public.entities;
CREATE POLICY "Admin gestiona entities" ON public.entities
    FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admin gestiona markers" ON public.map_markers;
CREATE POLICY "Admin gestiona markers" ON public.map_markers
    FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admin modera threads" ON public.forum_threads;
CREATE POLICY "Admin modera threads" ON public.forum_threads
    FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admin modera posts" ON public.forum_posts;
CREATE POLICY "Admin modera posts" ON public.forum_posts
    FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- Autor: editar / borrar sus propios hilos y respuestas
DROP POLICY IF EXISTS "Editar propios hilos" ON public.forum_threads;
CREATE POLICY "Editar propios hilos" ON public.forum_threads
    FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Borrar propios hilos" ON public.forum_threads;
CREATE POLICY "Borrar propios hilos" ON public.forum_threads
    FOR DELETE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Editar propias respuestas" ON public.forum_posts;
CREATE POLICY "Editar propias respuestas" ON public.forum_posts
    FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Borrar propias respuestas" ON public.forum_posts;
CREATE POLICY "Borrar propias respuestas" ON public.forum_posts
    FOR DELETE USING (auth.uid() = user_id);

-- Protege campos de sistema/moderación frente a autores no-admin
-- (upvotes_count solo lo mueve el trigger de votos; is_pinned solo ADMIN).
CREATE OR REPLACE FUNCTION public.guard_forum_thread_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    IF public.is_end_user_request() AND NOT public.is_admin() THEN
        IF TG_OP = 'INSERT' THEN
            NEW.upvotes_count := 0;
            NEW.is_pinned     := FALSE;
        ELSE
            NEW.upvotes_count := OLD.upvotes_count;
            NEW.is_pinned     := OLD.is_pinned;
            NEW.user_id       := OLD.user_id;
            NEW.created_at    := OLD.created_at;
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_forum_threads_guard ON public.forum_threads;
CREATE TRIGGER trg_forum_threads_guard
    BEFORE INSERT OR UPDATE ON public.forum_threads
    FOR EACH ROW EXECUTE FUNCTION public.guard_forum_thread_fields();

CREATE OR REPLACE FUNCTION public.guard_forum_post_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    IF public.is_end_user_request() AND NOT public.is_admin() THEN
        IF TG_OP = 'INSERT' THEN
            NEW.upvotes_count := 0;
        ELSE
            NEW.upvotes_count  := OLD.upvotes_count;
            NEW.user_id        := OLD.user_id;
            NEW.thread_id      := OLD.thread_id;
            NEW.parent_post_id := OLD.parent_post_id;
            NEW.created_at     := OLD.created_at;
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_forum_posts_guard ON public.forum_posts;
CREATE TRIGGER trg_forum_posts_guard
    BEFORE INSERT OR UPDATE ON public.forum_posts
    FOR EACH ROW EXECUTE FUNCTION public.guard_forum_post_fields();

-- =============================================================================
-- 5. CONTADOR AUTOMÁTICO DE UPVOTES (forum_votes -> upvotes_count)
--    forum_votes no tiene columna de valor: cada fila = +1.
--    target_type según CHECK del esquema: 'THREAD' | 'POST'.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.apply_forum_vote(p_target_type TEXT, p_target_id UUID, p_delta INT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF p_target_type = 'THREAD' THEN
        UPDATE public.forum_threads
           SET upvotes_count = GREATEST(upvotes_count + p_delta, 0)
         WHERE id = p_target_id;
    ELSIF p_target_type = 'POST' THEN
        UPDATE public.forum_posts
           SET upvotes_count = GREATEST(upvotes_count + p_delta, 0)
         WHERE id = p_target_id;
    ELSE
        RETURN FALSE;
    END IF;
    RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_forum_vote(TEXT, UUID, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_forum_vote(TEXT, UUID, INT) FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.handle_forum_vote()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF TG_OP IN ('DELETE', 'UPDATE') THEN
        -- Si el objetivo ya no existe (hilo/post borrado) se ignora.
        PERFORM public.apply_forum_vote(OLD.target_type, OLD.target_id, -1);
    END IF;

    IF TG_OP IN ('INSERT', 'UPDATE') THEN
        -- target_id no tiene FK (polimórfico): se valida su existencia aquí.
        IF NOT public.apply_forum_vote(NEW.target_type, NEW.target_id, 1) THEN
            RAISE EXCEPTION 'Objetivo de voto inexistente: % %', NEW.target_type, NEW.target_id
                USING ERRCODE = '23503';
        END IF;
    END IF;

    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_forum_votes_count ON public.forum_votes;
CREATE TRIGGER trg_forum_votes_count
    AFTER INSERT OR UPDATE OR DELETE ON public.forum_votes
    FOR EACH ROW EXECUTE FUNCTION public.handle_forum_vote();

-- Recalcula contadores existentes (idempotente).
UPDATE public.forum_threads t
   SET upvotes_count = (SELECT count(*) FROM public.forum_votes v
                         WHERE v.target_type = 'THREAD' AND v.target_id = t.id);
UPDATE public.forum_posts p
   SET upvotes_count = (SELECT count(*) FROM public.forum_votes v
                         WHERE v.target_type = 'POST' AND v.target_id = p.id);
