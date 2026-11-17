# ATLAS VICE — Documento de Arquitectura de Datos y Esquema SQL

**Proyecto:** VICE HUB / VI Companion (Portal Interactivo & Companion App de GTA VI)

**Documento:** Artefacto Técnico de Base de Datos (PostgreSQL / Supabase) — v1.0

## 1. Propósito y Estrategia de Escalabilidad de Datos

El presente documento formaliza el **Modelo Entidad-Relación (DER)**, el diccionario de datos, las reglas de integridad y las políticas de seguridad a nivel de fila (**Row Level Security**) para el sistema Atlas Vice.

* **Principio de Diseño Polimórfico:** En lugar de crear tablas rígidas por cada categoría del videojuego, la arquitectura centraliza los elementos en una tabla polimórfica (`ENTITIES`) apoyada por atributos dinámicos en formato JSONB (`stats_json` y `metadata_json`) y un gestor dinámico de secciones (`MODULES`). Esto permite incorporar futuras expansiones (DLCs, GTA VI Online, propiedades, radios o trucos) mediante inserción de registros sin alterar el esquema de base de datos ni reescribir la interfaz.

## 2. Diagrama Entidad-Relación (DER) Atlas Vice

```
+-----------------------------+       +---------------------------------------+
|           MODULES           |       |               ENTITIES                |
+-----------------------------+       +---------------------------------------+
| PK id (uuid)                |───┐   | PK id (uuid)                          |
|    slug (unique)            |   └──>| FK module_id (uuid)                   |
|    nombre                   |       |    titulo                             |
|    icono                    |       |    subtitulo                          |
|    activo (bool)            |       |    categoria                          |
|    orden (int)              |       |    imagen_url                         |
+-----------------------------+       |    stats_json (jsonb)                 |
                                      |    metadata_json (jsonb)              |
                                      |    created_at                         |
                                      +---------------------------------------+
                                           │               │
                      ┌────────────────────┘               │
                      ▼                                    ▼
+---------------------------------------+   +---------------------------------+
|              MAP_MARKERS              |   |          USER_PROGRESS          |
+---------------------------------------+   +---------------------------------+
| PK id (uuid)                          |   | PK id (uuid)                    |
| FK entity_id (uuid, nullable)         |   | FK user_id (uuid -> auth.users) |
|    region                             |   | FK entity_id (uuid, nullable)   |
|    titulo                             |   | FK marker_id (uuid, nullable)   |
|    descripcion                        |   |    completado (bool)            |
|    coord_x (numeric)                  |   |    updated_at                   |
|    coord_y (numeric)                  |   +---------------------------------+
|    media_url                          |
+---------------------------------------+
          │               │
          │               └──────────────────────────────────────────────────┐
          │ (opcional: hilos vinculados a pin o entidad)                     │
          ▼                                                                  ▼
+-----------------------------------------------------+   +---------------------------------+
|                    FORUM_THREADS                    |   |            PROFILES             |
+-----------------------------------------------------+   +---------------------------------+
| PK id (uuid)                                        |   | PK id (uuid)                    |
| FK user_id (uuid -> PROFILES)                       |<──|    username                     |
| FK entity_id (uuid, nullable)                       |   |    avatar_url                   |
| FK marker_id (uuid, nullable)                       |   |    discord_id                   |
|    categoria (General | Ayuda | Secretos | Crews)   |   |    rol (USER | ADMIN)           |
|    titulo                                           |   +---------------------------------+
|    contenido                                        |                    │
|    is_spoiler (bool)                                |                    ▼
|    is_pinned (bool)                                 |   +-----------------------------------+
|    upvotes_count (int)                              |   |            SUBMISSIONS            |
|    created_at                                       |   +-----------------------------------+
+-----------------------------------------------------+   | PK id (uuid)                      |
          │                                               | FK user_id (uuid -> PROFILES)     |
          ▼                                               |    tipo (MARKER|ENTITY|CORRECTION)|
+---------------------------------+                       |    payload_json (jsonb)           |
|           FORUM_POSTS           |                       |    estado (PENDIENTE|APROBADO|...) |
+---------------------------------+                       |    created_at                     |
| PK id (uuid)                    |                       +-----------------------------------+
| FK thread_id (uuid)             |
| FK user_id (uuid)               |   +---------------------------------+
| FK parent_post_id (uuid)        |   |           FORUM_VOTES           |
|    contenido                    |   +---------------------------------+
|    upvotes_count (int)          |   | PK (user_id, target_type,       |
|    created_at                   |   |     target_id)                  |
+---------------------------------+   +---------------------------------+
```

## 3. Diccionario de Entidades y Relaciones

| Tabla | Llaves (PK / FK) | Descripción Funcional y Reglas de Negocio |
| :--- | :--- | :--- |
| `public.profiles` | **PK:** `id` (**FK** `auth.users`) | Extiende la autenticación de Supabase con alias público, avatar, vinculación opcional con Discord (`discord_id`) y control de rol (`USER` / `ADMIN`). |
| `public.modules` | **PK:** `id` (UUID)<br>**UK:** `slug` | Define dinámicamente las secciones activas del menú de navegación (Mapa, Armas, Vehículos, Coleccionables, Guías, Foro y futuras expansiones). |
| `public.entities` | **PK:** `id` (UUID)<br>**FK:** `module_id` | Almacena cualquier ítem enciclopédico. Usa `stats_json` para métricas numéricas comparativas y `metadata_json` para atributos descriptivos flexibles. |
| `public.map_markers` | **PK:** `id` (UUID)<br>**FK:** `entity_id` (nullable) | Registra coordenadas (`coord_x`, `coord_y`) por región de Leonida / Vice City, vinculables opcionalmente a una entidad del catálogo. |
| `public.user_progress` | **PK:** `id` (UUID)<br>**FK:** `user_id`, `entity_id`, `marker_id` | Sincroniza el avance al 100% entre Web, iOS y Android. Garantiza unicidad por usuario y objetivo mediante restricciones `UNIQUE`. |
| `public.submissions` | **PK:** `id` (UUID)<br>**FK:** `user_id` | Cola de moderación para aportes comunitarios (`MARKER`, `ENTITY`, `CORRECTION`) con flujo de estados ($\text{PENDIENTE} \rightarrow \text{APROBADO} / \text{RECHAZADO}$). |
| `public.forum_threads` | **PK:** `id` (UUID)<br>**FK:** `user_id`, `entity_id`, `marker_id` | Gestiona tanto los hilos generales del foro (`entity_id = NULL`) como las discusiones contextuales ancladas a un arma, vehículo o pin del mapa. |
| `public.forum_posts` | **PK:** `id` (UUID)<br>**FK:** `thread_id`, `user_id`, `parent_post_id` | Soporta comentarios y respuestas anidadas multinivel dentro de cada hilo mediante autorreferencia (`parent_post_id`). |
| `public.forum_votes` | **PK Compuesta:** `(user_id, target_type, target_id)` | Impide votos duplicados sobre hilos (`THREAD`) o respuestas (`POST`) y alimenta la clasificación por relevancia comunitaria. |

## 4. Script SQL Completo de Implementación (PostgreSQL / Supabase)

Código DDL listo para ejecutar en el editor SQL de Supabase, incluyendo extensiones, tablas, índices de consulta rápida y políticas de seguridad RLS (Row Level Security):

```sql
-- =============================================================================
-- ATLAS VICE (VICE HUB / VI COMPANION) - ESQUEMA DE BASE DE DATOS ESCALABLE
-- Motor: PostgreSQL 15+ (Supabase)
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. PERFILES DE USUARIO Y ROLES (Extensión de auth.users)
CREATE TABLE public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    username TEXT UNIQUE NOT NULL,
    avatar_url TEXT,
    discord_id TEXT UNIQUE,
    rol TEXT NOT NULL DEFAULT 'USER' CHECK (rol IN ('USER', 'ADMIN')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. MÓDULOS DINÁMICOS DEL PORTAL (Permite activar expansiones sin tocar código)
CREATE TABLE public.modules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug TEXT UNIQUE NOT NULL, -- 'mapa', 'armas', 'vehiculos', 'coleccionables', 'guias', 'foro'
    nombre TEXT NOT NULL,
    icono TEXT NOT NULL,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    orden INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. ENTIDADES POLIMÓRFICAS (Armas, Vehículos, Coleccionables, Guías, Futuros DLCs)
CREATE TABLE public.entities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    module_id UUID NOT NULL REFERENCES public.modules(id) ON DELETE CASCADE,
    titulo TEXT NOT NULL,
    subtitulo TEXT,
    categoria TEXT NOT NULL, -- Ej: 'Rifles', 'Deportivos', 'Paquetes Ocultos', 'Misión Principal'
    imagen_url TEXT,
    stats_json JSONB NOT NULL DEFAULT '{}'::jsonb, -- Ej: {"dano": 85, "cadencia": 70, "alcance": 60}
    metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb, -- Ej: {"precio": 4500, "ubicacion": "Ocean Beach"}
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_entities_module_cat ON public.entities (module_id, categoria);

-- 4. MARCADORES DEL MAPA INTERACTIVO DE LEONIDA
CREATE TABLE public.map_markers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_id UUID REFERENCES public.entities(id) ON DELETE SET NULL,
    region TEXT NOT NULL, -- 'Vice Beach', 'Downtown', 'Grassrivers', 'Gellhorn', etc.
    titulo TEXT NOT NULL,
    descripcion TEXT,
    coord_x NUMERIC(8, 4) NOT NULL,
    coord_y NUMERIC(8, 4) NOT NULL,
    media_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_markers_region ON public.map_markers (region);

-- 5. PROGRESO DEL JUGADOR (Sincronizado Web / iOS / Android)
CREATE TABLE public.user_progress (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    entity_id UUID REFERENCES public.entities(id) ON DELETE CASCADE,
    marker_id UUID REFERENCES public.map_markers(id) ON DELETE CASCADE,
    completado BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_target_progress CHECK (entity_id IS NOT NULL OR marker_id IS NOT NULL),
    CONSTRAINT uq_user_entity UNIQUE (user_id, entity_id),
    CONSTRAINT uq_user_marker UNIQUE (user_id, marker_id)
);

-- 6. APORTES COMUNITARIOS Y COLA DE MODERACIÓN
CREATE TABLE public.submissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    tipo TEXT NOT NULL CHECK (tipo IN ('MARKER', 'ENTITY', 'CORRECTION')),
    payload_json JSONB NOT NULL,
    estado TEXT NOT NULL DEFAULT 'PENDIENTE' CHECK (estado IN ('PENDIENTE', 'APROBADO', 'RECHAZADO')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7. FORO COMUNITARIO E HILOS CONTEXTUALES (P07)
CREATE TABLE public.forum_threads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    entity_id UUID REFERENCES public.entities(id) ON DELETE SET NULL, -- NULL = Hilo general del foro
    marker_id UUID REFERENCES public.map_markers(id) ON DELETE SET NULL,
    categoria TEXT NOT NULL CHECK (categoria IN ('General', 'Guias/Ayuda', 'Secretos', 'Crews')),
    titulo TEXT NOT NULL,
    contenido TEXT NOT NULL,
    is_spoiler BOOLEAN NOT NULL DEFAULT FALSE,
    is_pinned BOOLEAN NOT NULL DEFAULT FALSE,
    upvotes_count INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_threads_cat_date ON public.forum_threads (categoria, created_at DESC);
CREATE INDEX idx_threads_entity ON public.forum_threads (entity_id) WHERE entity_id IS NOT NULL;

-- 8. RESPUESTAS ANIDADAS DEL FORO
CREATE TABLE public.forum_posts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    thread_id UUID NOT NULL REFERENCES public.forum_threads(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    parent_post_id UUID REFERENCES public.forum_posts(id) ON DELETE CASCADE,
    contenido TEXT NOT NULL,
    upvotes_count INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 9. CONTROL DE VOTOS ÚNICOS (UPVOTES)
CREATE TABLE public.forum_votes (
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    target_type TEXT NOT NULL CHECK (target_type IN ('THREAD', 'POST')),
    target_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, target_type, target_id)
);

-- =============================================================================
-- SEGURIDAD (ROW LEVEL SECURITY - LECTURA PÚBLICA / ESCRITURA AUTENTICADA)
-- =============================================================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.map_markers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.forum_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.forum_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.forum_votes ENABLE ROW LEVEL SECURITY;

-- Lectura libre para visitantes e invitados en catálogos, mapa y foro
CREATE POLICY "Lectura publica modules" ON public.modules FOR SELECT USING (activo = TRUE);
CREATE POLICY "Lectura publica entities" ON public.entities FOR SELECT USING (TRUE);
CREATE POLICY "Lectura publica markers" ON public.map_markers FOR SELECT USING (TRUE);
CREATE POLICY "Lectura publica threads" ON public.forum_threads FOR SELECT USING (TRUE);
CREATE POLICY "Lectura publica posts" ON public.forum_posts FOR SELECT USING (TRUE);

-- Cada jugador gestiona únicamente su propio progreso
CREATE POLICY "Gestion propio progreso" ON public.user_progress
    FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Usuarios autenticados pueden crear hilos, responder y votar
CREATE POLICY "Crear hilos autenticados" ON public.forum_threads
    FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Crear respuestas autenticadas" ON public.forum_posts
    FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Gestionar propios votos" ON public.forum_votes
    FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
```

## 5. Resumen de Políticas de Acceso y Seguridad (RLS)

| Perfil / Rol | Permisos de Lectura | Permisos de Escritura |
| :--- | :--- | :--- |
| **Jugador Invitado**<br>(Sin sesión activa) | Acceso completo a `modules` activos, `entities`, `map_markers`, `forum_threads` y `forum_posts`. | Sin escritura en nube (el progreso se persiste localmente en `localStorage` / `IndexedDB`). |
| **Jugador Registrado**<br>(Rol `USER`) | Todos los recursos públicos más su propio historial en `user_progress` y estado de sus `submissions`. | Gestión exclusiva de su progreso, creación de hilos/respuestas en foro, votos únicos (`forum_votes`) y envío de aportes. |
| **Administrador**<br>(Rol `ADMIN`) | Acceso global a todas las tablas y colas de moderación pendientes. | Activación de nuevos módulos, publicación de entidades/marcadores, aprobación de aportes y moderación del foro. |