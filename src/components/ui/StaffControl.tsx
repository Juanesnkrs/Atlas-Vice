// Módulo privado de nivel máximo (chunk `staff-ctl-*`): configuración global, módulos, monetización, identidades y
// auditoría. Solo se importa dinámicamente desde StaffPage tras confirmar el rol correspondiente.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { DEFAULT_PUBLIC_CONFIG, NEWS_SOURCES, useWorldData, usePublicConfig, type PublicConfig } from '../../data/seed';
import { isApiConfigured } from '../../store/useAuthStore';
import type { AdPosition, AdRoute, MonetizationConfig } from '../../types/database';
import { BTN, errMsg, INPUT, PRIMARY, ROLE_ORDER, SELECT, staffFetch, type Role } from './StaffKit';

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

const ROLES = ROLE_ORDER;
const ALL_PROVIDERS = ['google', 'discord', 'apple', 'magic-link'] as const;

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
      staffFetch('/api/admin/config', {
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
    queryFn: () => staffFetch<{ users: AdminUser[] }>(`/api/admin/users?limit=50${term ? `&q=${encodeURIComponent(term)}` : ''}`),
  });

  const setRole = useMutation({
    mutationFn: (v: { id: string; rol: Role }) =>
      staffFetch(`/api/admin/users/${v.id}/role`, { method: 'PATCH', json: { rol: v.rol } }),
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
    queryFn: () => staffFetch<{ logs: AuditEntry[] }>('/api/admin/audit-logs?limit=50'),
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

  // La config pública incluye también los módulos inactivos; si no responde se usan los módulos de /api/modules.
  const modules = (
    cfg.modules ?? world.modules.map((m) => ({ id: m.id, slug: m.slug, nombre: m.nombre, icono: m.icono, orden: m.orden, isActive: m.activo }))
  )
    .slice()
    .sort((a, b) => a.orden - b.orden);

  const toggle = useMutation({
    // `orden` viaja siempre: el esquema parcial del servidor aplica su default (0) y reordenaría el módulo.
    mutationFn: (v: { id: string; activo: boolean; orden: number }) =>
      staffFetch(`/api/modules/${v.id}`, { method: 'PATCH', json: { activo: v.activo, orden: v.orden } }),
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
  '/catalogo/:categoria/:itemSlug',
  '/foro',
];
// Posiciones permitidas por ruta (docs/LeonidApp-Rutas-SEO-Monetizacion.md §6.1).
const AD_ALLOWED: Record<AdRoute, readonly AdPosition[]> = {
  '/guias': ['after-content'],
  '/guias/:slug': ['in-article', 'after-content', 'sidebar'],
  '/noticias': ['after-content'],
  '/noticias/:slug': ['after-content'],
  '/catalogo/:categoria/:itemSlug': ['after-content'],
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
    mutationFn: (body: MonetizationConfig) => staffFetch('/api/admin/config', { method: 'PATCH', json: { monetization: body } }),
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

export default function StaffControl() {
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
