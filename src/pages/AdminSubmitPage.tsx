// P06 - Centro de aportes (USER), moderación (MODERATOR+), catálogo y mapa (ADMIN+) y panel "Control Total"
// (EXCLUSIVO de SUPER_ADMIN). La UI oculta lo que no corresponde al rol, pero el servidor decide.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { DEFAULT_PUBLIC_CONFIG, NEWS_SOURCES, useWorldData, usePublicConfig, type PublicConfig } from '../data/seed';
import { CatalogAdminPanel } from '../components/ui/CatalogAdminPanel';
import { apiFetch, isApiConfigured, useAuthStore, type Role } from '../store/useAuthStore';
import type { AdPosition, AdRoute, MonetizationConfig } from '../types/database';

// ---- Tipos de la API (Submission, usuarios, auditoría) ----------------------------------
type SubStatus = 'pending' | 'approved' | 'rejected';
interface SubmissionDTO {
  id: string;
  userId: string;
  moduleSlug: string;
  type: string;
  title: string;
  payload: Record<string, unknown>;
  coords: { x: number; y: number } | null;
  status: SubStatus;
  reviewedBy: string | null;
  createdAt?: string;
}
interface AdminUser {
  id: string;
  username: string;
  email: string | null;
  rol: Role;
}
interface AuditEntry {
  id: string;
  actor_id: string;
  actor_role: string;
  action: string;
  target_type: string;
  target_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

const TIPOS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'marker', label: 'Marcador / ubicación' },
  { value: 'entity', label: 'Entidad (arma, vehículo, coleccionable, guía)' },
  { value: 'correction', label: 'Corrección de un dato' },
];
const STATUS_LABEL: Record<SubStatus, string> = { pending: 'Pendiente', approved: 'Aprobado', rejected: 'Rechazado' };
const STATUS_TONE: Record<SubStatus, string> = {
  pending: 'bg-vice-gold text-vice-ink',
  approved: 'bg-vice-cyan text-vice-ink',
  rejected: 'bg-vice-rose text-vice-ink',
};
const ROLES: readonly Role[] = ['USER', 'MODERATOR', 'ADMIN', 'SUPER_ADMIN'];
const ALL_PROVIDERS = ['google', 'discord', 'apple', 'magic-link'] as const;

const INPUT =
  'min-h-11 w-full rounded-xl border border-white/15 bg-white/10 px-4 text-base text-vice-text placeholder:text-vice-text/50 focus-visible:outline-2 focus-visible:outline-vice-gold';
const SELECT = `${INPUT} bg-[#2e1a47]`;
const BTN =
  'flex min-h-11 items-center justify-center rounded-xl px-4 font-semibold focus-visible:outline-2 focus-visible:outline-vice-gold disabled:opacity-50';
const PRIMARY = `${BTN} bg-vice-accent font-bold text-vice-ink`;

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : 'Error desconocido');

function StatusBadge({ status }: { status: SubStatus }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${STATUS_TONE[status]}`}>{STATUS_LABEL[status]}</span>
  );
}

type TabId = 'aportes' | 'moderacion' | 'catalogo' | 'control';

// =============================================================================
// Pestaña 1: aportes (USER autenticado)
// =============================================================================
function AportesTab() {
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const { data: world } = useWorldData();
  const [tipo, setTipo] = useState('marker');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const online = isApiConfigured;

  const mine = useQuery({
    queryKey: ['submissions', 'mine', user?.id],
    enabled: online && user !== null,
    queryFn: () => apiFetch<SubmissionDTO[]>('/api/submissions/mine'),
  });

  const send = useMutation({
    mutationFn: (body: unknown) => apiFetch<SubmissionDTO>('/api/submissions', { method: 'POST', json: body }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['submissions'] }),
  });

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setMsg(null);
    const form = e.currentTarget;
    const fd = new FormData(form);
    const get = (k: string): string => String(fd.get(k) ?? '').trim();
    const title = get('title');
    const descripcion = get('descripcion');
    if (title.length < 3 || descripcion.length < 10) {
      setMsg({ ok: false, text: 'Indica un título (3+) y una descripción (10+ caracteres).' });
      return;
    }
    const media = get('media_url');
    if (media && !/^https?:\/\//i.test(media)) return setMsg({ ok: false, text: 'La imagen debe ser una URL http(s).' });
    // El payload debe cumplir los esquemas de promoción del servidor (marker, entity o correction).
    let payload: Record<string, unknown>;
    let coords: { x: number; y: number } | null = null;
    if (tipo === 'marker') {
      const x = Number(get('coord_x'));
      const y = Number(get('coord_y'));
      if (!get('region') || !Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1000 || y < 0 || y > 700) {
        return setMsg({ ok: false, text: 'Indica región y coordenadas válidas (X 0-1000, Y 0-700).' });
      }
      payload = { titulo: title, region: get('region'), descripcion, ...(media ? { media_url: media } : {}) };
      coords = { x, y };
    } else if (tipo === 'entity') {
      if (!get('categoria')) return setMsg({ ok: false, text: 'Indica una categoría.' });
      payload = {
        titulo: title,
        categoria: get('categoria'),
        metadata_json: { descripcion },
        ...(media ? { imagen_url: media } : {}),
      };
    } else {
      const [kind, id] = get('objetivo').split(':');
      if (!id) return setMsg({ ok: false, text: 'Elige el dato a corregir.' });
      if (kind === 'entity') {
        if (descripcion.length > 240) return setMsg({ ok: false, text: 'La corrección de una ficha admite hasta 240 caracteres.' });
        payload = { target: 'Entity', id, patch: { subtitulo: descripcion, ...(media ? { imagen_url: media } : {}) } };
      } else {
        payload = { target: 'MapMarker', id, patch: { descripcion, ...(media ? { media_url: media } : {}) } };
      }
    }
    try {
      await send.mutateAsync({ moduleSlug: get('moduleSlug') || 'mapa', type: tipo, title, payload, coords });
      form.reset();
      setMsg({ ok: true, text: 'Aporte enviado. Quedará Pendiente hasta que un moderador lo revise.' });
    } catch (err) {
      setMsg({ ok: false, text: `No se pudo enviar: ${errMsg(err)}` });
    }
  };

  const slugs = world.modules.filter((m) => m.activo).map((m) => ({ slug: m.slug, nombre: m.nombre }));

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <section aria-labelledby="form-title" className="glass rounded-2xl p-5">
        <h2 id="form-title" className="font-display text-xl font-bold">
          Nuevo aporte
        </h2>
        <form onSubmit={(e) => void onSubmit(e)} className="mt-3 flex flex-col gap-3">
          <div>
            <label htmlFor="ap-tipo" className="mb-1 block text-sm font-medium">
              Tipo de aporte
            </label>
            <select id="ap-tipo" value={tipo} onChange={(e) => setTipo(e.target.value)} className={SELECT}>
              {TIPOS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="ap-mod" className="mb-1 block text-sm font-medium">
              Módulo
            </label>
            <select id="ap-mod" name="moduleSlug" className={SELECT} defaultValue="mapa">
              <option value="mapa">Mapa</option>
              {slugs.map((m) => (
                <option key={m.slug} value={m.slug}>
                  {m.nombre}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="ap-titulo" className="mb-1 block text-sm font-medium">
              Título
            </label>
            <input id="ap-titulo" name="title" required minLength={3} maxLength={160} className={INPUT} />
          </div>
          <div>
            <label htmlFor="ap-desc" className="mb-1 block text-sm font-medium">
              Descripción
            </label>
            <textarea id="ap-desc" name="descripcion" required rows={4} className={`${INPUT} py-2`} />
          </div>

          {tipo === 'marker' && (
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
          {tipo === 'entity' && (
            <div>
              <label htmlFor="ap-cat" className="mb-1 block text-sm font-medium">
                Categoría
              </label>
              <input id="ap-cat" name="categoria" required placeholder="Ej.: Rifles, Deportivos…" className={INPUT} />
            </div>
          )}
          {tipo === 'correction' && (
            <div>
              <label htmlFor="ap-obj" className="mb-1 block text-sm font-medium">
                Dato a corregir
              </label>
              <select id="ap-obj" name="objetivo" className={SELECT}>
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
          <button type="submit" disabled={send.isPending || !online} className={PRIMARY}>
            {send.isPending ? 'Enviando…' : 'Enviar aporte'}
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

      <section aria-labelledby="mine-title" className="glass rounded-2xl p-5">
        <h2 id="mine-title" className="font-display text-xl font-bold">
          Mis aportes
        </h2>
        {!online ? (
          <p className="mt-3 text-sm text-vice-text/70">Disponible al conectar con la API.</p>
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
                  <p className="truncate font-semibold">{s.title}</p>
                  <p className="text-xs text-vice-text/70">
                    {TIPOS.find((t) => t.value === s.type)?.label ?? s.type}
                    {s.createdAt ? ` · ${new Date(s.createdAt).toLocaleDateString('es')}` : ''}
                  </p>
                </div>
                <StatusBadge status={s.status} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// =============================================================================
// Pestaña 2: moderación (MODERATOR+), catálogo y mapa (ADMIN+)
// =============================================================================
function ModeracionTab() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<SubStatus>('pending');
  const [note, setNote] = useState<string | null>(null);

  const queue = useQuery({
    queryKey: ['submissions', 'admin', filter],
    enabled: isApiConfigured,
    queryFn: () => apiFetch<SubmissionDTO[]>(`/api/admin/submissions?status=${filter}&limit=100`),
  });

  const review = useMutation({
    mutationFn: (v: { id: string; status: 'approved' | 'rejected' }) =>
      apiFetch<SubmissionDTO>(`/api/admin/submissions/${v.id}`, { method: 'PATCH', json: { status: v.status } }),
    onSuccess: (_d, v) => {
      setNote(`Aporte ${v.status === 'approved' ? 'aprobado' : 'rechazado'}.`);
      void qc.invalidateQueries({ queryKey: ['submissions'] });
    },
    onError: (e) => setNote(`No se pudo actualizar: ${errMsg(e)}`),
  });

  return (
    <section aria-labelledby="mod-title" className="glass rounded-2xl p-5">
      <h2 id="mod-title" className="font-display text-xl font-bold">
        Cola de moderación
      </h2>
      <div role="group" aria-label="Estado" className="mt-3 flex flex-wrap gap-2">
        {(['pending', 'approved', 'rejected'] as const).map((st) => (
          <button
            key={st}
            type="button"
            aria-pressed={filter === st}
            onClick={() => setFilter(st)}
            className={`${BTN} ${filter === st ? 'bg-vice-accent text-vice-ink' : 'bg-white/10 hover:bg-white/20'}`}
          >
            {STATUS_LABEL[st]}
          </button>
        ))}
      </div>
      <div aria-live="polite" className="min-h-[1.25rem] pt-2 text-sm text-vice-cyan">
        {note}
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
        <p className="text-sm text-vice-text/70">No hay aportes en este estado.</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-2">
          {(queue.data ?? []).map((s) => (
            <li key={s.id} className="rounded-xl bg-white/5 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold">
                  {s.title}{' '}
                  <span className="text-xs font-normal text-vice-text/70">
                    · {TIPOS.find((t) => t.value === s.type)?.label ?? s.type} · {s.moduleSlug}
                  </span>
                </p>
                <StatusBadge status={s.status} />
              </div>
              {typeof s.payload.descripcion === 'string' && (
                <p className="mt-1 text-sm text-vice-text/85">{s.payload.descripcion}</p>
              )}
              {s.coords && (
                <p className="text-xs text-vice-text/70">
                  {typeof s.payload.region === 'string' ? `${s.payload.region} · ` : ''}X {s.coords.x} · Y {s.coords.y}
                </p>
              )}
              {s.status === 'pending' && (
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    disabled={review.isPending}
                    onClick={() => review.mutate({ id: s.id, status: 'approved' })}
                    className={`${BTN} bg-vice-cyan text-vice-ink`}
                  >
                    Aprobar
                  </button>
                  <button
                    type="button"
                    disabled={review.isPending}
                    onClick={() => review.mutate({ id: s.id, status: 'rejected' })}
                    className={`${BTN} bg-white/10 hover:bg-white/20`}
                  >
                    Rechazar
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// =============================================================================
// Pestaña 3: Control Total (solo SUPER_ADMIN)
// =============================================================================
function ConfigPanel() {
  const qc = useQueryClient();
  const cfg = usePublicConfig();
  const [draft, setDraft] = useState<PublicConfig>(DEFAULT_PUBLIC_CONFIG);
  const [loaded, setLoaded] = useState(false);
  const [newFlag, setNewFlag] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!loaded && cfg !== DEFAULT_PUBLIC_CONFIG) {
      setDraft(cfg);
      setLoaded(true);
    }
  }, [cfg, loaded]);

  const save = useMutation({
    // Solo los campos de este formulario: monetization y modules tienen su propio panel.
    mutationFn: (body: PublicConfig) =>
      apiFetch('/api/admin/config', {
        method: 'PATCH',
        json: {
          maintenance_mode: body.maintenance_mode,
          announcement: body.announcement,
          feature_flags: body.feature_flags,
          enabled_auth_providers: body.enabled_auth_providers,
          social_links: body.social_links,
        },
      }),
    onSuccess: () => {
      setMsg({ ok: true, text: 'Configuración guardada.' });
      void qc.invalidateQueries({ queryKey: ['config'] });
    },
    onError: (e) => setMsg({ ok: false, text: `No se pudo guardar: ${errMsg(e)}` }),
  });

  const toggleProvider = (p: (typeof ALL_PROVIDERS)[number]) =>
    setDraft((d) => {
      const has = d.enabled_auth_providers.includes(p);
      const list = has ? d.enabled_auth_providers.filter((x) => x !== p) : [...d.enabled_auth_providers, p];
      return { ...d, enabled_auth_providers: list.slice(0, 4) };
    });

  const onSave = (e: FormEvent) => {
    e.preventDefault();
    setMsg(null);
    const links = draft.social_links.filter((l) => l.platform.trim() && l.url.trim());
    if (links.some((l) => !/^https?:\/\//i.test(l.url))) {
      return setMsg({ ok: false, text: 'Las redes sociales requieren URL http(s).' });
    }
    save.mutate({ ...draft, announcement: draft.announcement?.trim() ? draft.announcement : null, social_links: links });
  };

  return (
    <form onSubmit={onSave} className="glass flex flex-col gap-4 rounded-2xl p-5" aria-labelledby="cfg-title">
      <h2 id="cfg-title" className="font-display text-xl font-bold">
        Configuración global
      </h2>

      <label className="flex min-h-11 items-center gap-3">
        <input
          type="checkbox"
          checked={draft.maintenance_mode}
          onChange={(e) => setDraft({ ...draft, maintenance_mode: e.target.checked })}
          className="h-5 w-5 accent-[#E1307E]"
        />
        <span>Modo mantenimiento (maintenance_mode)</span>
      </label>

      <div>
        <label htmlFor="cfg-ann" className="mb-1 block text-sm font-medium">
          Anuncio global (máx. 500)
        </label>
        <textarea
          id="cfg-ann"
          rows={2}
          maxLength={500}
          value={draft.announcement ?? ''}
          onChange={(e) => setDraft({ ...draft, announcement: e.target.value })}
          className={`${INPUT} py-2`}
        />
      </div>

      <fieldset>
        <legend className="mb-1 text-sm font-medium">Proveedores de acceso habilitados (máx. 4)</legend>
        <div className="flex flex-wrap gap-3">
          {ALL_PROVIDERS.map((p) => (
            <label key={p} className="flex min-h-11 items-center gap-2">
              <input
                type="checkbox"
                checked={draft.enabled_auth_providers.includes(p)}
                onChange={() => toggleProvider(p)}
                className="h-5 w-5 accent-[#E1307E]"
              />
              {p}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-1 text-sm font-medium">Feature flags</legend>
        <ul className="flex flex-col gap-1">
          {Object.entries(draft.feature_flags).map(([k, v]) => (
            <li key={k} className="flex items-center justify-between gap-2 rounded-xl bg-white/5 px-3">
              <label className="flex min-h-11 flex-1 items-center gap-3">
                <input
                  type="checkbox"
                  checked={v}
                  onChange={(e) => setDraft({ ...draft, feature_flags: { ...draft.feature_flags, [k]: e.target.checked } })}
                  className="h-5 w-5 accent-[#E1307E]"
                />
                {k}
              </label>
              <button
                type="button"
                aria-label={`Eliminar flag ${k}`}
                onClick={() => {
                  const { [k]: _omit, ...rest } = draft.feature_flags;
                  setDraft({ ...draft, feature_flags: rest });
                }}
                className={`${BTN} px-3 text-vice-gold`}
              >
                Quitar
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-2 flex gap-2">
          <input
            aria-label="Nueva feature flag"
            value={newFlag}
            onChange={(e) => setNewFlag(e.target.value)}
            placeholder="nombre_de_flag"
            className={INPUT}
          />
          <button
            type="button"
            onClick={() => {
              const k = newFlag.trim();
              if (k) setDraft({ ...draft, feature_flags: { ...draft.feature_flags, [k]: false } });
              setNewFlag('');
            }}
            className={`${BTN} bg-white/10 hover:bg-white/20`}
          >
            Añadir
          </button>
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-1 text-sm font-medium">Redes sociales (máx. 12)</legend>
        <ul className="flex flex-col gap-2">
          {draft.social_links.map((l, i) => (
            <li key={i} className="grid grid-cols-[1fr_2fr_auto] gap-2">
              <input
                aria-label={`Plataforma ${i + 1}`}
                value={l.platform}
                maxLength={30}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    social_links: draft.social_links.map((x, j) => (j === i ? { ...x, platform: e.target.value } : x)),
                  })
                }
                placeholder="discord"
                className={INPUT}
              />
              <input
                aria-label={`URL ${i + 1}`}
                value={l.url}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    social_links: draft.social_links.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)),
                  })
                }
                placeholder="https://…"
                className={INPUT}
              />
              <button
                type="button"
                aria-label={`Quitar red ${i + 1}`}
                onClick={() => setDraft({ ...draft, social_links: draft.social_links.filter((_, j) => j !== i) })}
                className={`${BTN} px-3 text-vice-gold`}
              >
                Quitar
              </button>
            </li>
          ))}
        </ul>
        {draft.social_links.length < 12 && (
          <button
            type="button"
            onClick={() => setDraft({ ...draft, social_links: [...draft.social_links, { platform: '', url: '' }] })}
            className={`${BTN} mt-2 bg-white/10 hover:bg-white/20`}
          >
            Añadir red social
          </button>
        )}
      </fieldset>

      <button type="submit" disabled={save.isPending || !isApiConfigured} className={PRIMARY}>
        {save.isPending ? 'Guardando…' : 'Guardar configuración'}
      </button>
      <div aria-live="polite" className="min-h-[1.25rem] text-sm">
        {msg && (
          <p role={msg.ok ? 'status' : 'alert'} className={msg.ok ? 'text-vice-cyan' : 'text-vice-gold'}>
            {msg.text}
          </p>
        )}
      </div>
      <p className="text-xs text-vice-text/60">
        Fuentes oficiales de noticias vigentes: {NEWS_SOURCES.filter((s) => s.value !== 'all').map((s) => s.label).join(', ')}.
      </p>
    </form>
  );
}

function RolesPanel() {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  const users = useQuery({
    queryKey: ['admin', 'users', term],
    enabled: isApiConfigured,
    queryFn: () => apiFetch<{ users: AdminUser[] }>(`/api/admin/users?limit=50${term ? `&q=${encodeURIComponent(term)}` : ''}`),
  });

  const setRole = useMutation({
    mutationFn: (v: { id: string; rol: Role }) =>
      apiFetch(`/api/admin/users/${v.id}/role`, { method: 'PATCH', json: { rol: v.rol } }),
    onSuccess: () => {
      setMsg('Rol actualizado.');
      void qc.invalidateQueries({ queryKey: ['admin'] });
    },
    onError: (e) => setMsg(`No se pudo cambiar el rol: ${errMsg(e)}`),
  });

  return (
    <section aria-labelledby="roles-title" className="glass rounded-2xl p-5">
      <h2 id="roles-title" className="font-display text-xl font-bold">
        Gestión de roles
      </h2>
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          setTerm(q.trim());
        }}
        className="mt-3 flex gap-2"
      >
        <input
          aria-label="Buscar usuario por nombre o correo exacto"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Nombre o correo…"
          className={INPUT}
        />
        <button type="submit" className={`${BTN} bg-white/10 hover:bg-white/20`}>
          Buscar
        </button>
      </form>
      <div aria-live="polite" className="min-h-[1.25rem] pt-2 text-sm text-vice-cyan">
        {msg}
      </div>
      {users.isLoading ? (
        <p role="status" className="text-sm">
          Cargando usuarios…
        </p>
      ) : users.error ? (
        <p role="alert" className="text-sm text-vice-gold">
          {users.error.message}
        </p>
      ) : (users.data?.users ?? []).length === 0 ? (
        <p className="text-sm text-vice-text/70">Sin resultados.</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-2">
          {(users.data?.users ?? []).map((u) => (
            <li key={u.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white/5 p-3">
              <span className="min-w-0">
                <span className="block truncate font-semibold">{u.username}</span>
                <span className="block truncate text-xs text-vice-text/70">{u.email ?? 'sin correo'}</span>
              </span>
              <select
                aria-label={`Rol de ${u.username}`}
                value={u.rol}
                disabled={setRole.isPending}
                onChange={(e) => setRole.mutate({ id: u.id, rol: e.target.value as Role })}
                className={`${SELECT} w-44`}
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function AuditPanel() {
  const logs = useQuery({
    queryKey: ['admin', 'audit'],
    enabled: isApiConfigured,
    queryFn: () => apiFetch<{ logs: AuditEntry[] }>('/api/admin/audit-logs?limit=50'),
  });
  return (
    <section aria-labelledby="audit-title" className="glass rounded-2xl p-5">
      <h2 id="audit-title" className="font-display text-xl font-bold">
        Registro de auditoría
      </h2>
      {logs.isLoading ? (
        <p role="status" className="mt-3 text-sm">
          Cargando…
        </p>
      ) : logs.error ? (
        <p role="alert" className="mt-3 text-sm text-vice-gold">
          {logs.error.message}
        </p>
      ) : (logs.data?.logs ?? []).length === 0 ? (
        <p className="mt-3 text-sm text-vice-text/70">Sin eventos.</p>
      ) : (
        <ul className="mt-3 flex max-h-[420px] flex-col gap-2 overflow-y-auto">
          {(logs.data?.logs ?? []).map((l) => (
            <li key={l.id} className="rounded-xl bg-white/5 p-3 text-sm">
              <p className="font-semibold">{l.action}</p>
              <p className="text-xs text-vice-text/70">
                {new Date(l.created_at).toLocaleString('es')} · {l.actor_role} · {l.actor_id.slice(0, 8)} ·{' '}
                {l.target_type}
                {l.target_id ? `:${l.target_id.slice(0, 8)}` : ''}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---- Módulos: interruptor de Module.isActive (PATCH /api/modules/:id { activo }) -----------------
function ModulesPanel() {
  const qc = useQueryClient();
  const cfg = usePublicConfig();
  const { data: world } = useWorldData();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // La config pública incluye también los módulos inactivos; sin API se muestra el seed.
  const modules = (
    cfg.modules ?? world.modules.map((m) => ({ id: m.id, slug: m.slug, nombre: m.nombre, icono: m.icono, orden: m.orden, isActive: m.activo }))
  )
    .slice()
    .sort((a, b) => a.orden - b.orden);

  const toggle = useMutation({
    // `orden` viaja siempre: el esquema parcial del servidor aplica su default (0) y reordenaría el módulo.
    mutationFn: (v: { id: string; activo: boolean; orden: number }) =>
      apiFetch(`/api/modules/${v.id}`, { method: 'PATCH', json: { activo: v.activo, orden: v.orden } }),
    onSuccess: (_d, v) => {
      setMsg({ ok: true, text: v.activo ? 'Módulo activado.' : 'Módulo desactivado: desaparece de la navegación.' });
      void qc.invalidateQueries({ queryKey: ['config'] });
      void qc.invalidateQueries({ queryKey: ['world'] });
    },
    onError: (e) => setMsg({ ok: false, text: `No se pudo cambiar el módulo: ${errMsg(e)}` }),
  });

  return (
    <section aria-labelledby="mods-title" className="glass rounded-2xl p-5">
      <h2 id="mods-title" className="font-display text-xl font-bold">
        Módulos
      </h2>
      <p className="mt-1 text-sm text-vice-text/80">Un módulo inactivo se oculta de la navegación y sus rutas dejan de estar disponibles.</p>
      <ul className="mt-3 flex flex-col gap-2">
        {modules.map((m) => (
          <li key={m.id} className="flex items-center justify-between gap-3 rounded-xl bg-white/5 px-3">
            <label className="flex min-h-11 flex-1 items-center gap-3">
              <input
                type="checkbox"
                role="switch"
                checked={m.isActive}
                disabled={toggle.isPending || !isApiConfigured}
                onChange={(e) => toggle.mutate({ id: m.id, activo: e.target.checked, orden: m.orden })}
                className="h-5 w-5 accent-[#E1307E]"
              />
              <span>
                <span className="font-semibold">{m.nombre}</span>
                <span className="ml-2 text-xs text-vice-text/70">/{m.slug}</span>
              </span>
            </label>
            <span className={`text-xs font-bold ${m.isActive ? 'text-vice-cyan' : 'text-vice-gold'}`}>
              {m.isActive ? 'Activo' : 'Inactivo'}
            </span>
          </li>
        ))}
      </ul>
      <div aria-live="polite" className="min-h-[1.25rem] pt-2 text-sm">
        {msg && (
          <p role={msg.ok ? 'status' : 'alert'} className={msg.ok ? 'text-vice-cyan' : 'text-vice-gold'}>
            {msg.text}
          </p>
        )}
      </div>
    </section>
  );
}

// ---- Monetización: AppConfig.monetization (PATCH /api/admin/config { monetization }) -----------------
type Slot = MonetizationConfig['slots'][number];
const AD_ROUTE_OPTIONS: readonly AdRoute[] = [
  '/guias',
  '/guias/:slug',
  '/noticias',
  '/noticias/:slug',
  '/catalogo/:modulo/:slug',
  '/foro',
];
// Posiciones permitidas por ruta (docs/LeonidApp-Rutas-SEO-Monetizacion.md §6.1).
const AD_ALLOWED: Record<AdRoute, readonly AdPosition[]> = {
  '/guias': ['after-content'],
  '/guias/:slug': ['in-article', 'after-content', 'sidebar'],
  '/noticias': ['after-content'],
  '/noticias/:slug': ['after-content'],
  '/catalogo/:modulo/:slug': ['after-content'],
  '/foro': ['after-content'],
};
const DEFAULT_MONETIZATION_CFG: MonetizationConfig = {
  ads_enabled: false,
  provider: 'none',
  publisher_id: null,
  require_consent: true,
  slots: [],
};

function MonetizationPanel() {
  const qc = useQueryClient();
  const cfg = usePublicConfig();
  const [draft, setDraft] = useState<MonetizationConfig | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const m = draft ?? cfg.monetization ?? DEFAULT_MONETIZATION_CFG;
  const edit = (patch: Partial<MonetizationConfig>) => setDraft({ ...m, ...patch });
  const editSlot = (i: number, patch: Partial<Slot>) =>
    edit({ slots: m.slots.map((s, j) => (j === i ? { ...s, ...patch } : s)) });

  const save = useMutation({
    mutationFn: (body: MonetizationConfig) => apiFetch('/api/admin/config', { method: 'PATCH', json: { monetization: body } }),
    onSuccess: () => {
      setMsg({ ok: true, text: 'Monetización guardada.' });
      setDraft(null);
      void qc.invalidateQueries({ queryKey: ['config'] });
    },
    onError: (e) => setMsg({ ok: false, text: `No se pudo guardar: ${errMsg(e)}` }),
  });

  const onSave = (e: FormEvent) => {
    e.preventDefault();
    setMsg(null);
    const ids = m.slots.map((s) => s.id.trim());
    if (ids.some((id) => !id) || new Set(ids).size !== ids.length) {
      return setMsg({ ok: false, text: 'Cada slot necesita un id único.' });
    }
    if (m.slots.some((s) => !Number.isInteger(s.width) || s.width <= 0 || !Number.isInteger(s.height) || s.height <= 0)) {
      return setMsg({ ok: false, text: 'Ancho y alto deben ser enteros positivos (reserva fija, CLS = 0).' });
    }
    for (const r of AD_ROUTE_OPTIONS) {
      if (m.slots.filter((s) => s.enabled && s.route === r).length > 2) {
        return setMsg({ ok: false, text: `Máximo 2 slots activos por página (${r}).` });
      }
    }
    if (m.ads_enabled && m.provider === 'adsense' && !m.publisher_id?.trim()) {
      return setMsg({ ok: false, text: 'AdSense requiere un publisher_id (p. ej. ca-pub-…).' });
    }
    save.mutate({
      ...m,
      require_consent: true,
      publisher_id: m.publisher_id?.trim() ? m.publisher_id.trim() : null,
      slots: m.slots.map((s) => ({ ...s, id: s.id.trim() })),
    });
  };

  const SMALL = `${SELECT} w-full`;
  return (
    <form onSubmit={onSave} aria-labelledby="mon-title" className="glass flex flex-col gap-4 rounded-2xl p-5">
      <h2 id="mon-title" className="font-display text-xl font-bold">
        Monetización (AdSlot)
      </h2>
      <p className="text-sm text-vice-text/80">
        Solo páginas editoriales con scroll. Nunca en mapa, Inspector, hub, aportar ni autenticación. Sin consentimiento de
        cookies &quot;Marketing&quot; no se carga ningún script de terceros.
      </p>

      <label className="flex min-h-11 items-center gap-3">
        <input
          type="checkbox"
          role="switch"
          checked={m.ads_enabled}
          onChange={(e) => edit({ ads_enabled: e.target.checked })}
          className="h-5 w-5 accent-[#E1307E]"
        />
        <span>Anuncios activados (interruptor global)</span>
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="mon-provider" className="mb-1 block text-sm font-medium">
            Proveedor
          </label>
          <select
            id="mon-provider"
            value={m.provider}
            onChange={(e) => edit({ provider: e.target.value === 'adsense' ? 'adsense' : 'none' })}
            className={SELECT}
          >
            <option value="none">Ninguno</option>
            <option value="adsense">AdSense</option>
          </select>
        </div>
        <div>
          <label htmlFor="mon-pub" className="mb-1 block text-sm font-medium">
            Publisher ID (no es secreto)
          </label>
          <input
            id="mon-pub"
            value={m.publisher_id ?? ''}
            maxLength={60}
            placeholder="ca-pub-…"
            onChange={(e) => edit({ publisher_id: e.target.value })}
            className={INPUT}
          />
        </div>
      </div>

      <fieldset>
        <legend className="mb-1 text-sm font-medium">Slots por ruta y posición (máx. 20)</legend>
        <ul className="flex flex-col gap-3">
          {m.slots.map((s, i) => (
            <li key={i} className="grid gap-2 rounded-xl bg-white/5 p-3 sm:grid-cols-2 lg:grid-cols-6">
              <input
                aria-label={`Id del slot ${i + 1}`}
                value={s.id}
                maxLength={40}
                onChange={(e) => editSlot(i, { id: e.target.value })}
                placeholder="id-del-slot"
                className={INPUT}
              />
              <select
                aria-label={`Ruta del slot ${i + 1}`}
                value={s.route}
                onChange={(e) => {
                  const route = e.target.value as AdRoute;
                  editSlot(i, {
                    route,
                    position: AD_ALLOWED[route].includes(s.position) ? s.position : AD_ALLOWED[route][0]!,
                  });
                }}
                className={SMALL}
              >
                {AD_ROUTE_OPTIONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
              <select
                aria-label={`Posición del slot ${i + 1}`}
                value={s.position}
                onChange={(e) => editSlot(i, { position: e.target.value as AdPosition })}
                className={SMALL}
              >
                {AD_ALLOWED[s.route].map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
              <input
                aria-label={`Ancho del slot ${i + 1}`}
                type="number"
                min={1}
                value={s.width}
                onChange={(e) => editSlot(i, { width: Math.round(Number(e.target.value)) })}
                className={INPUT}
              />
              <input
                aria-label={`Alto del slot ${i + 1}`}
                type="number"
                min={1}
                value={s.height}
                onChange={(e) => editSlot(i, { height: Math.round(Number(e.target.value)) })}
                className={INPUT}
              />
              <div className="flex items-center justify-between gap-2">
                <label className="flex min-h-11 items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={s.enabled}
                    onChange={(e) => editSlot(i, { enabled: e.target.checked })}
                    className="h-5 w-5 accent-[#E1307E]"
                  />
                  Activo
                </label>
                <button
                  type="button"
                  aria-label={`Quitar slot ${i + 1}`}
                  onClick={() => edit({ slots: m.slots.filter((_, j) => j !== i) })}
                  className={`${BTN} px-3 text-vice-gold`}
                >
                  Quitar
                </button>
              </div>
            </li>
          ))}
        </ul>
        {m.slots.length < 20 && (
          <button
            type="button"
            onClick={() =>
              edit({
                slots: [
                  ...m.slots,
                  { id: `slot-${m.slots.length + 1}`, route: '/guias', position: 'after-content', width: 728, height: 90, enabled: true },
                ],
              })
            }
            className={`${BTN} mt-2 bg-white/10 hover:bg-white/20`}
          >
            Añadir slot
          </button>
        )}
      </fieldset>

      <button type="submit" disabled={save.isPending || !isApiConfigured} className={PRIMARY}>
        {save.isPending ? 'Guardando…' : 'Guardar monetización'}
      </button>
      <div aria-live="polite" className="min-h-[1.25rem] text-sm">
        {msg && (
          <p role={msg.ok ? 'status' : 'alert'} className={msg.ok ? 'text-vice-cyan' : 'text-vice-gold'}>
            {msg.text}
          </p>
        )}
      </div>
    </form>
  );
}

function ControlTotalTab() {
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="lg:col-span-2">
        <ConfigPanel />
      </div>
      <ModulesPanel />
      <MonetizationPanel />
      <RolesPanel />
      <AuditPanel />
    </div>
  );
}

// =============================================================================
// Página
// =============================================================================
export default function AdminSubmitPage() {
  const status = useAuthStore((s) => s.status);
  const hasRole = useAuthStore((s) => s.hasRole);
  const role = useAuthStore((s) => s.role);
  const [tab, setTab] = useState<TabId>('aportes');
  const online = isApiConfigured;

  const authenticated = status === 'authenticated';
  const canModerate = hasRole('MODERATOR');
  const isAdmin = hasRole('ADMIN');
  const isSuper = role === 'SUPER_ADMIN';

  const tabs: Array<{ id: TabId; label: string }> = [{ id: 'aportes', label: 'Aportes' }];
  if (canModerate) tabs.push({ id: 'moderacion', label: 'Moderación' });
  if (isAdmin) tabs.push({ id: 'catalogo', label: 'Catálogo y mapa' });
  if (isSuper) tabs.push({ id: 'control', label: 'Control Total' });
  const current = tabs.some((t) => t.id === tab) ? tab : 'aportes';

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-8 pt-2 md:px-8">
      <h1 className="font-display text-3xl font-bold">Centro de aportes</h1>
      <p className="mt-1 text-sm text-vice-text/80">
        Comparte hallazgos con la comunidad. Todo aporte pasa por moderación antes de publicarse.
      </p>
      {!online && (
        <p role="status" className="glass mt-3 rounded-xl px-4 py-2 text-sm text-vice-gold">
          La API no está configurada: el envío y la moderación no están disponibles sin conexión.
        </p>
      )}

      {!authenticated ? (
        <section className="glass mt-5 rounded-2xl p-6 text-center" aria-label="Inicia sesión">
          <p className="text-vice-text/90">Como Invitado puedes explorar en lectura. Inicia sesión para aportar.</p>
          <a href="/entrar?next=%2Faportar" className={`${PRIMARY} mx-auto mt-4 w-fit`}>
            Iniciar sesión
          </a>
        </section>
      ) : (
        <>
          <div role="tablist" aria-label="Secciones" className="mt-4 flex flex-wrap gap-2">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                id={`tab-${t.id}`}
                aria-selected={current === t.id}
                aria-controls={`panel-${t.id}`}
                onClick={() => setTab(t.id)}
                className={`${BTN} ${current === t.id ? 'bg-vice-accent text-vice-ink' : 'glass hover:bg-white/10'}`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div role="tabpanel" id={`panel-${current}`} aria-labelledby={`tab-${current}`} className="mt-4">
            {current === 'aportes' && <AportesTab />}
            {current === 'moderacion' && canModerate && <ModeracionTab />}
            {current === 'catalogo' && isAdmin && (
              <div className="grid gap-5">
                <CatalogAdminPanel />
                {!isSuper && <AuditPanel />}
              </div>
            )}
            {current === 'control' && isSuper && <ControlTotalTab />}
          </div>
        </>
      )}
    </div>
  );
}
