// P06 - Centro de aportes (P06.1, rol USER) y moderación + módulos (P06.2, solo ADMIN)
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { SEED_MODULES, useForumData, useWorldData } from '../data/seed';
import { isSupabaseConfigured, supabase, useAuthStore } from '../store/useAuthStore';
import type { Json, Module, Submission, SubmissionEstado, SubmissionTipo } from '../types/database';

const TIPOS: ReadonlyArray<{ value: SubmissionTipo; label: string }> = [
  { value: 'MARKER', label: 'Marcador / ubicación' },
  { value: 'ENTITY', label: 'Entidad (arma, vehículo, coleccionable, guía)' },
  { value: 'CORRECTION', label: 'Corrección de un dato' },
];
const ESTADO_LABEL: Record<SubmissionEstado, string> = {
  PENDIENTE: 'Pendiente',
  APROBADO: 'Aprobado',
  RECHAZADO: 'Rechazado',
};
const ESTADO_TONE: Record<SubmissionEstado, string> = {
  PENDIENTE: 'bg-vice-gold text-vice-ink',
  APROBADO: 'bg-vice-cyan text-vice-ink',
  RECHAZADO: 'bg-vice-rose text-vice-ink',
};

const INPUT =
  'min-h-11 w-full rounded-xl border border-white/15 bg-white/10 px-4 text-base text-vice-text placeholder:text-vice-text/50 focus-visible:outline-2 focus-visible:outline-vice-gold';
const BTN =
  'flex min-h-11 items-center justify-center rounded-xl px-4 font-semibold focus-visible:outline-2 focus-visible:outline-vice-gold disabled:opacity-50';

type Payload = Record<string, Json | undefined>;
const payloadOf = (s: Submission): Payload =>
  s.payload_json && typeof s.payload_json === 'object' && !Array.isArray(s.payload_json)
    ? (s.payload_json as Payload)
    : {};
const str = (v: Json | undefined): string => (typeof v === 'string' ? v : '');
const num = (v: Json | undefined): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function EstadoBadge({ estado }: { estado: SubmissionEstado }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${ESTADO_TONE[estado]}`}>{ESTADO_LABEL[estado]}</span>
  );
}

export default function AdminSubmitPage() {
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const profile = useAuthStore((s) => s.profile);
  const { data: world } = useWorldData();
  const { data: forum } = useForumData();

  const [tipo, setTipo] = useState<SubmissionTipo>('MARKER');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [adminMsg, setAdminMsg] = useState<string | null>(null);

  const isAdmin = profile?.rol === 'ADMIN';
  const online = isSupabaseConfigured && supabase !== null;
  const nameOf = (id: string): string => forum.profiles.find((p) => p.id === id)?.username ?? id.slice(0, 8);

  // ---- Mis aportes -----------------------------------------------------------------
  const mine = useQuery({
    queryKey: ['submissions', 'mine', user?.id],
    enabled: online && user !== null,
    queryFn: async (): Promise<Submission[]> => {
      if (!supabase || !user) return [];
      const { data, error } = await supabase
        .from('submissions')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });

  // ---- Cola de moderación (ADMIN) -----------------------------------------------------
  const queue = useQuery({
    queryKey: ['submissions', 'all'],
    enabled: online && isAdmin,
    queryFn: async (): Promise<Submission[]> => {
      if (!supabase) return [];
      const { data, error } = await supabase
        .from('submissions')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });

  const modulesQ = useQuery({
    queryKey: ['admin-modules'],
    enabled: online && isAdmin,
    queryFn: async (): Promise<Module[]> => {
      if (!supabase) return SEED_MODULES;
      const { data, error } = await supabase.from('modules').select('*').order('orden');
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });

  // ---- Envío P06.1 ---------------------------------------------------------------------
  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setMsg(null);
    if (!supabase || !user) {
      setMsg({ ok: false, text: 'Sin conexión con Supabase: no se puede enviar el aporte ahora.' });
      return;
    }
    const form = e.currentTarget;
    const fd = new FormData(form);
    const get = (k: string): string => String(fd.get(k) ?? '').trim();
    const titulo = get('titulo');
    const descripcion = get('descripcion');
    if (titulo.length < 3 || descripcion.length < 10) {
      setMsg({ ok: false, text: 'Indica un título (3+) y una descripción (10+ caracteres).' });
      return;
    }
    const payload: Record<string, Json> = { titulo, descripcion };
    const media = get('media_url');
    if (media) {
      if (!/^https?:\/\//i.test(media)) {
        setMsg({ ok: false, text: 'La imagen debe ser una URL http(s).' });
        return;
      }
      payload.media_url = media;
    }
    if (tipo === 'MARKER') {
      const x = Number(get('coord_x'));
      const y = Number(get('coord_y'));
      if (!get('region') || !Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1000 || y < 0 || y > 700) {
        setMsg({ ok: false, text: 'Indica región y coordenadas válidas (X 0-1000, Y 0-700).' });
        return;
      }
      payload.region = get('region');
      payload.coord_x = Math.round(x * 10000) / 10000;
      payload.coord_y = Math.round(y * 10000) / 10000;
    } else if (tipo === 'ENTITY') {
      if (!get('module_id') || !get('categoria')) {
        setMsg({ ok: false, text: 'Elige un módulo y una categoría.' });
        return;
      }
      payload.module_id = get('module_id');
      payload.categoria = get('categoria');
      payload.subtitulo = descripcion;
    } else {
      payload.objetivo = get('objetivo');
    }
    setBusy(true);
    const { error } = await supabase
      .from('submissions')
      .insert({ user_id: user.id, tipo, payload_json: payload, estado: 'PENDIENTE' });
    setBusy(false);
    if (error) {
      setMsg({ ok: false, text: `No se pudo enviar: ${error.message}` });
      return;
    }
    form.reset();
    setMsg({ ok: true, text: 'Aporte enviado. Quedará Pendiente hasta que un ADMIN lo revise.' });
    void qc.invalidateQueries({ queryKey: ['submissions'] });
  };

  // ---- Moderación P06.2 -------------------------------------------------------------------
  const moderate = async (s: Submission, estado: SubmissionEstado) => {
    if (!supabase) return;
    setAdminMsg(null);
    const p = payloadOf(s);
    if (estado === 'APROBADO' && s.tipo === 'MARKER') {
      const { error } = await supabase.from('map_markers').insert({
        region: str(p.region),
        titulo: str(p.titulo),
        descripcion: str(p.descripcion) || null,
        coord_x: num(p.coord_x) ?? 0,
        coord_y: num(p.coord_y) ?? 0,
        media_url: str(p.media_url) || null,
      });
      if (error) return setAdminMsg(`No se pudo publicar el marcador: ${error.message}`);
    }
    if (estado === 'APROBADO' && s.tipo === 'ENTITY') {
      const { error } = await supabase.from('entities').insert({
        module_id: str(p.module_id),
        titulo: str(p.titulo),
        subtitulo: str(p.subtitulo) || null,
        categoria: str(p.categoria) || 'Sin categoría',
        imagen_url: str(p.media_url) || null,
      });
      if (error) return setAdminMsg(`No se pudo publicar la entidad: ${error.message}`);
    }
    const { error } = await supabase.from('submissions').update({ estado }).eq('id', s.id);
    if (error) return setAdminMsg(`No se pudo actualizar el estado: ${error.message}`);
    setAdminMsg(
      estado === 'APROBADO' && s.tipo === 'CORRECTION'
        ? 'Aprobado. Las correcciones se aplican manualmente sobre el dato original.'
        : `Aporte ${ESTADO_LABEL[estado].toLowerCase()}.`,
    );
    void qc.invalidateQueries({ queryKey: ['submissions'] });
    void qc.invalidateQueries({ queryKey: ['world'] });
  };

  const toggleModule = async (m: Module) => {
    if (!supabase) return;
    setAdminMsg(null);
    const { error } = await supabase.from('modules').update({ activo: !m.activo }).eq('id', m.id);
    if (error) return setAdminMsg(`No se pudo cambiar el módulo: ${error.message}`);
    void qc.invalidateQueries({ queryKey: ['admin-modules'] });
    void qc.invalidateQueries({ queryKey: ['world'] });
  };

  const moduleList = modulesQ.data ?? [];

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-8 pt-2 md:px-8">
      <h1 className="font-display text-3xl font-bold">Centro de aportes</h1>
      <p className="mt-1 text-sm text-vice-text/80">
        Comparte hallazgos con la comunidad. Todo aporte pasa por moderación antes de publicarse.
      </p>
      {!online && (
        <p role="status" className="glass mt-3 rounded-xl px-4 py-2 text-sm text-vice-gold">
          Supabase no está configurado: el envío y la moderación no están disponibles sin conexión.
        </p>
      )}

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        {/* P06.1 Formulario */}
        <section aria-labelledby="form-title" className="glass rounded-2xl p-5">
          <h2 id="form-title" className="font-display text-xl font-bold">
            Nuevo aporte
          </h2>
          <form onSubmit={(e) => void onSubmit(e)} className="mt-3 flex flex-col gap-3">
            <div>
              <label htmlFor="ap-tipo" className="mb-1 block text-sm font-medium">
                Tipo de aporte
              </label>
              <select
                id="ap-tipo"
                value={tipo}
                onChange={(e) => setTipo(e.target.value as SubmissionTipo)}
                className={`${INPUT} bg-[#2e1a47]`}
              >
                {TIPOS.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="ap-titulo" className="mb-1 block text-sm font-medium">
                Título
              </label>
              <input id="ap-titulo" name="titulo" required maxLength={120} className={INPUT} />
            </div>
            <div>
              <label htmlFor="ap-desc" className="mb-1 block text-sm font-medium">
                Descripción
              </label>
              <textarea id="ap-desc" name="descripcion" required rows={4} className={`${INPUT} py-2`} />
            </div>

            {tipo === 'MARKER' && (
              <>
                <div>
                  <label htmlFor="ap-region" className="mb-1 block text-sm font-medium">
                    Región
                  </label>
                  <input id="ap-region" name="region" list="ap-regions" required className={INPUT} />
                  <datalist id="ap-regions">
                    {Array.from(new Set(world.markers.map((m) => m.region))).map((r) => (
                      <option key={r} value={r} />
                    ))}
                  </datalist>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="ap-x" className="mb-1 block text-sm font-medium">
                      Coordenada X (0-1000)
                    </label>
                    <input id="ap-x" name="coord_x" type="number" step="0.0001" min="0" max="1000" required className={INPUT} />
                  </div>
                  <div>
                    <label htmlFor="ap-y" className="mb-1 block text-sm font-medium">
                      Coordenada Y (0-700)
                    </label>
                    <input id="ap-y" name="coord_y" type="number" step="0.0001" min="0" max="700" required className={INPUT} />
                  </div>
                </div>
              </>
            )}

            {tipo === 'ENTITY' && (
              <>
                <div>
                  <label htmlFor="ap-mod" className="mb-1 block text-sm font-medium">
                    Módulo
                  </label>
                  <select id="ap-mod" name="module_id" required className={`${INPUT} bg-[#2e1a47]`}>
                    {world.modules
                      .filter((m) => m.activo && ['armas', 'vehiculos', 'coleccionables', 'guias'].includes(m.slug))
                      .map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.nombre}
                        </option>
                      ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="ap-cat" className="mb-1 block text-sm font-medium">
                    Categoría
                  </label>
                  <input id="ap-cat" name="categoria" required placeholder="Ej.: Rifles, Deportivos…" className={INPUT} />
                </div>
              </>
            )}

            {tipo === 'CORRECTION' && (
              <div>
                <label htmlFor="ap-obj" className="mb-1 block text-sm font-medium">
                  Dato a corregir
                </label>
                <select id="ap-obj" name="objetivo" className={`${INPUT} bg-[#2e1a47]`}>
                  {world.entities.map((e) => (
                    <option key={e.id} value={`entity:${e.id}`}>
                      {e.titulo}
                    </option>
                  ))}
                  {world.markers.map((m) => (
                    <option key={m.id} value={`marker:${m.id}`}>
                      Marcador: {m.titulo}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label htmlFor="ap-media" className="mb-1 block text-sm font-medium">
                Imagen (URL, opcional)
              </label>
              <input id="ap-media" name="media_url" type="url" placeholder="https://…" className={INPUT} />
            </div>

            <button
              type="submit"
              disabled={busy || !online}
              className={`${BTN} bg-vice-accent font-bold text-vice-ink`}
            >
              {busy ? 'Enviando…' : 'Enviar aporte'}
            </button>
            <div aria-live="polite" className="min-h-[1.25rem] text-sm">
              {msg && (
                <p role={msg.ok ? 'status' : 'alert'} className={msg.ok ? 'text-vice-cyan' : 'text-vice-gold'}>
                  {msg.text}
                </p>
              )}
            </div>
          </form>
        </section>

        {/* Mis aportes */}
        <section aria-labelledby="mine-title" className="glass rounded-2xl p-5">
          <h2 id="mine-title" className="font-display text-xl font-bold">
            Mis aportes
          </h2>
          {!online ? (
            <p className="mt-3 text-sm text-vice-text/70">Disponible al conectar con Supabase.</p>
          ) : mine.isLoading ? (
            <p role="status" className="mt-3 text-sm">
              Cargando…
            </p>
          ) : mine.error ? (
            <p role="alert" className="mt-3 text-sm text-vice-gold">
              No se pudieron cargar tus aportes: {mine.error.message}
            </p>
          ) : (mine.data ?? []).length === 0 ? (
            <p className="mt-3 text-sm text-vice-text/70">Aún no has enviado aportes.</p>
          ) : (
            <ul className="mt-3 flex flex-col gap-2">
              {(mine.data ?? []).map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-3 rounded-xl bg-white/5 p-3">
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{str(payloadOf(s).titulo) || 'Sin título'}</p>
                    <p className="text-xs text-vice-text/70">
                      {TIPOS.find((t) => t.value === s.tipo)?.label} · {new Date(s.created_at).toLocaleDateString('es')}
                    </p>
                  </div>
                  <EstadoBadge estado={s.estado} />
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* P06.2 Moderación y módulos - solo ADMIN */}
        {!profile ? (
          <p role="status" className="glass rounded-2xl p-5 text-sm lg:col-span-2">
            Cargando perfil…
          </p>
        ) : isAdmin ? (
          <>
            <section aria-labelledby="mod-title" className="glass rounded-2xl p-5 lg:col-span-2">
              <h2 id="mod-title" className="font-display text-xl font-bold">
                Moderación (ADMIN)
              </h2>
              <div aria-live="polite" className="min-h-[1.25rem] text-sm text-vice-cyan">
                {adminMsg}
              </div>
              {queue.isLoading ? (
                <p role="status" className="text-sm">
                  Cargando cola…
                </p>
              ) : queue.error ? (
                <p role="alert" className="text-sm text-vice-gold">
                  No se pudo cargar la cola: {queue.error.message}
                </p>
              ) : (queue.data ?? []).length === 0 ? (
                <p className="text-sm text-vice-text/70">No hay aportes.</p>
              ) : (
                <ul className="mt-2 flex flex-col gap-2">
                  {(queue.data ?? []).map((s) => {
                    const p = payloadOf(s);
                    return (
                      <li key={s.id} className="rounded-xl bg-white/5 p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="font-semibold">
                            {str(p.titulo) || 'Sin título'}{' '}
                            <span className="text-xs font-normal text-vice-text/70">
                              · {TIPOS.find((t) => t.value === s.tipo)?.label} · {nameOf(s.user_id)}
                            </span>
                          </p>
                          <EstadoBadge estado={s.estado} />
                        </div>
                        <p className="mt-1 text-sm text-vice-text/85">{str(p.descripcion)}</p>
                        {s.tipo === 'MARKER' && (
                          <p className="text-xs text-vice-text/70">
                            {str(p.region)} · X {num(p.coord_x) ?? '?'} · Y {num(p.coord_y) ?? '?'}
                          </p>
                        )}
                        {s.estado === 'PENDIENTE' && (
                          <div className="mt-2 flex gap-2">
                            <button
                              type="button"
                              onClick={() => void moderate(s, 'APROBADO')}
                              className={`${BTN} bg-vice-cyan text-vice-ink`}
                            >
                              Aprobar
                            </button>
                            <button
                              type="button"
                              onClick={() => void moderate(s, 'RECHAZADO')}
                              className={`${BTN} bg-white/10 hover:bg-white/20`}
                            >
                              Rechazar
                            </button>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <section aria-labelledby="mods-title" className="glass rounded-2xl p-5 lg:col-span-2">
              <h2 id="mods-title" className="font-display text-xl font-bold">
                Módulos
              </h2>
              {modulesQ.isLoading ? (
                <p role="status" className="text-sm">
                  Cargando módulos…
                </p>
              ) : modulesQ.error ? (
                <p role="alert" className="text-sm text-vice-gold">
                  No se pudieron cargar los módulos: {modulesQ.error.message}
                </p>
              ) : (
                <ul className="mt-2 grid gap-2 sm:grid-cols-2">
                  {moduleList.map((m) => (
                    <li key={m.id} className="flex items-center justify-between gap-3 rounded-xl bg-white/5 p-3">
                      <span>
                        <span className="font-semibold">{m.nombre}</span>
                        <span className="block text-xs text-vice-text/70">{m.slug}</span>
                      </span>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={m.activo}
                        aria-label={`Módulo ${m.nombre}`}
                        onClick={() => void toggleModule(m)}
                        className={`${BTN} min-w-[88px] ${m.activo ? 'bg-vice-accent text-vice-ink' : 'bg-white/10'}`}
                      >
                        {m.activo ? 'Activo' : 'Inactivo'}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        ) : (
          <p className="glass rounded-2xl p-5 text-sm text-vice-text/75 lg:col-span-2">
            La moderación y la gestión de módulos están reservadas para el rol ADMIN.
          </p>
        )}
      </div>
    </div>
  );
}
