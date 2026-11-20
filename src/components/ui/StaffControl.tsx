// Sección «Control Total» (chunk `staff-ctl-*`, solo SUPER_ADMIN): configuración global, monetización, identidades y
// auditoría/salud. Solo se importa dinámicamente desde StaffPage tras confirmar el rol correspondiente; el servidor
// responde 404 uniforme a cualquier otro rol (RBAC antes que Zod).
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { NEWS_SOURCES, type PublicConfig } from '../../data/seed';
import type { AdPosition, AdRoute, MonetizationConfig } from '../../types/database';
import StaffAudit from './StaffAudit';
import StaffIdentity from './StaffIdentity';
import { Block, BTN, errMsg, GHOST, INPUT, PRIMARY, QueryState, SELECT, staffFetch, SubTabs, toast } from './StaffKit';

const ALL_PROVIDERS = ['google', 'discord', 'apple', 'magic-link'] as const;
const FLAG_RE = /^[a-zA-Z0-9_.-]{1,40}$/;
type ConfigDTO = PublicConfig & { monetization: MonetizationConfig };

/** Config vigente leída sin caché pública (el panel siempre ve lo último guardado). */
function useStaffConfig() {
  return useQuery({
    queryKey: ['staff', 'config'],
    queryFn: () => staffFetch<ConfigDTO>('/api/config', { cache: 'no-cache' }),
  });
}

function useAfterConfigSave() {
  const qc = useQueryClient();
  return () => {
    for (const key of ['staff', 'config']) void qc.invalidateQueries({ queryKey: [key] });
  };
}

const SAVE_NOTE = 'Aviso: los visitantes ven el cambio en cuanto su navegador revalida (hasta 30 s).';

// ---- Configuración global ---------------------------------------------------------------------
type ConfigDraft = Pick<PublicConfig, 'maintenance_mode' | 'announcement' | 'feature_flags' | 'enabled_auth_providers' | 'social_links'>;
const pick = (c: ConfigDTO): ConfigDraft => ({
  maintenance_mode: c.maintenance_mode,
  announcement: c.announcement,
  feature_flags: c.feature_flags,
  enabled_auth_providers: c.enabled_auth_providers,
  social_links: c.social_links,
});

function ConfigPanel() {
  const cfg = useStaffConfig();
  const afterSave = useAfterConfigSave();
  const [draft, setDraft] = useState<ConfigDraft | null>(null);
  const [newFlag, setNewFlag] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const server = cfg.data ? pick(cfg.data) : null;
  const d = draft ?? server;
  const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(server);

  const save = useMutation({
    // Solo los campos de este formulario: monetización tiene su propio bloque.
    mutationFn: (body: ConfigDraft) => staffFetch('/api/admin/config', { method: 'PATCH', json: body }),
    onSuccess: () => {
      toast.ok(`Configuración guardada. ${SAVE_NOTE}`);
      setDraft(null);
      afterSave();
    },
    onError: (e) => {
      setErr(errMsg(e));
      toast.err(`No se pudo guardar: ${errMsg(e)}`);
    },
  });

  if (!d) return <QueryState loading={cfg.isLoading} error={cfg.error} empty={false} emptyText="" onRetry={() => void cfg.refetch()} />;
  const edit = (patch: Partial<ConfigDraft>) => setDraft({ ...d, ...patch });

  const toggleProvider = (p: (typeof ALL_PROVIDERS)[number]) => {
    const has = d.enabled_auth_providers.includes(p);
    edit({ enabled_auth_providers: has ? d.enabled_auth_providers.filter((x) => x !== p) : [...d.enabled_auth_providers, p] });
  };

  const onSave = (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    const links = d.social_links.filter((l) => l.platform.trim() || l.url.trim());
    const fail = (text: string) => {
      setErr(text);
      toast.err(text);
    };
    if (d.enabled_auth_providers.length === 0) return fail('Debe quedar al menos un proveedor de acceso.');
    if (links.some((l) => !l.platform.trim() || !/^https?:\/\//i.test(l.url.trim()))) {
      return fail('Cada red social necesita plataforma y una URL http(s).');
    }
    const badFlag = Object.keys(d.feature_flags).find((k) => !FLAG_RE.test(k));
    if (badFlag) return fail(`Nombre de flag inválido: «${badFlag}».`);
    save.mutate({
      ...d,
      announcement: d.announcement?.trim() ? d.announcement.trim() : null,
      social_links: links.map((l) => ({ platform: l.platform.trim(), url: l.url.trim() })),
    });
  };

  return (
    <Block
      id="blk-config"
      title="Configuración global"
      controls="el anuncio del Hub, el aviso de mantenimiento, los métodos de acceso de /entrar, los interruptores del sitio y las redes sociales del pie de página."
      href="/hub"
      linkLabel="Abrir el Hub"
    >
      <form onSubmit={onSave} className="flex flex-col gap-4">
        <label className="flex min-h-11 items-center gap-3">
          <input type="checkbox" checked={d.maintenance_mode} onChange={(e) => edit({ maintenance_mode: e.target.checked })} className="h-5 w-5 accent-[#E1307E]" />
          <span>Modo mantenimiento (muestra un aviso en la pantalla de acceso)</span>
        </label>

        <div>
          <label htmlFor="cfg-ann" className="mb-1 block text-sm font-medium">
            Anuncio global en el Hub ({(d.announcement ?? '').length}/500)
          </label>
          <textarea id="cfg-ann" rows={2} maxLength={500} value={d.announcement ?? ''} onChange={(e) => edit({ announcement: e.target.value })} className={`${INPUT} py-2`} />
        </div>

        <fieldset>
          <legend className="mb-1 text-sm font-medium">Métodos de acceso visibles (mínimo 1, máximo 4)</legend>
          <div className="flex flex-wrap gap-3">
            {ALL_PROVIDERS.map((p) => (
              <label key={p} className="flex min-h-11 items-center gap-2">
                <input type="checkbox" checked={d.enabled_auth_providers.includes(p)} onChange={() => toggleProvider(p)} className="h-5 w-5 accent-[#E1307E]" />
                {p}
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="mb-1 text-sm font-medium">Interruptores del sitio (feature flags)</legend>
          {Object.keys(d.feature_flags).length === 0 && <p className="text-sm text-vice-text/70">Sin flags definidas.</p>}
          <ul className="flex flex-col gap-1">
            {Object.entries(d.feature_flags).map(([k, v]) => (
              <li key={k} className="flex items-center justify-between gap-2 rounded-xl bg-white/5 px-3">
                <label className="flex min-h-11 flex-1 items-center gap-3">
                  <input type="checkbox" checked={v} onChange={(e) => edit({ feature_flags: { ...d.feature_flags, [k]: e.target.checked } })} className="h-5 w-5 accent-[#E1307E]" />
                  {k}
                </label>
                <button
                  type="button"
                  aria-label={`Quitar flag ${k}`}
                  onClick={() => {
                    const { [k]: _omit, ...rest } = d.feature_flags;
                    edit({ feature_flags: rest });
                  }}
                  className={`${BTN} px-3 text-vice-gold`}
                >
                  Quitar
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex gap-2">
            <input aria-label="Nueva feature flag" value={newFlag} onChange={(e) => setNewFlag(e.target.value)} placeholder="nombre_de_flag" maxLength={40} className={INPUT} />
            <button
              type="button"
              onClick={() => {
                const k = newFlag.trim();
                if (!k) return;
                if (!FLAG_RE.test(k)) return toast.err('Nombre de flag inválido: letras, números, guion, guion bajo o punto (máx. 40).');
                if (k in d.feature_flags) return toast.err('Esa flag ya existe.');
                edit({ feature_flags: { ...d.feature_flags, [k]: false } });
                setNewFlag('');
              }}
              className={GHOST}
            >
              Añadir
            </button>
          </div>
        </fieldset>

        <fieldset>
          <legend className="mb-1 text-sm font-medium">Redes sociales del pie de página (máx. 12)</legend>
          <ul className="flex flex-col gap-2">
            {d.social_links.map((l, i) => (
              <li key={i} className="grid grid-cols-[1fr_2fr_auto] gap-2">
                <input
                  aria-label={`Plataforma ${i + 1}`}
                  value={l.platform}
                  maxLength={30}
                  onChange={(e) => edit({ social_links: d.social_links.map((x, j) => (j === i ? { ...x, platform: e.target.value } : x)) })}
                  placeholder="discord"
                  className={INPUT}
                />
                <input
                  aria-label={`URL ${i + 1}`}
                  value={l.url}
                  onChange={(e) => edit({ social_links: d.social_links.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)) })}
                  placeholder="https://…"
                  className={INPUT}
                />
                <button type="button" aria-label={`Quitar red ${i + 1}`} onClick={() => edit({ social_links: d.social_links.filter((_, j) => j !== i) })} className={`${BTN} px-3 text-vice-gold`}>
                  Quitar
                </button>
              </li>
            ))}
          </ul>
          {d.social_links.length < 12 && (
            <button type="button" onClick={() => edit({ social_links: [...d.social_links, { platform: '', url: '' }] })} className={`${GHOST} mt-2`}>
              Añadir red social
            </button>
          )}
        </fieldset>

        <div className="flex flex-wrap gap-3">
          <button type="submit" disabled={save.isPending || !dirty} className={`${PRIMARY} flex-1`}>
            {save.isPending ? 'Guardando…' : 'Guardar configuración'}
          </button>
          <button type="button" disabled={!dirty || save.isPending} onClick={() => { setDraft(null); setErr(null); }} className={GHOST}>
            Descartar cambios
          </button>
        </div>
        <div aria-live="polite" className="min-h-[1.25rem] text-sm">
          {err ? <p role="alert" className="text-vice-gold">{err}</p> : dirty ? <p className="text-vice-text/70">Hay cambios sin guardar.</p> : null}
        </div>
        <p className="text-xs text-vice-text/60">
          Fuentes de noticias oficiales vigentes (fijas en el servidor): {NEWS_SOURCES.filter((s) => s.value !== 'all').map((s) => s.label).join(', ')}. El nombre del sitio es fijo
          (LeonidApp): no existe un campo aprobado para cambiarlo.
        </p>
      </form>
    </Block>
  );
}

// ---- Monetización -----------------------------------------------------------------------------
type Slot = MonetizationConfig['slots'][number];
const AD_ROUTE_OPTIONS: readonly AdRoute[] = ['/guias', '/guias/:slug', '/noticias', '/noticias/:slug', '/catalogo/:categoria/:itemSlug', '/foro'];
// Posiciones permitidas por ruta (docs/LeonidApp-Rutas-SEO-Monetizacion.md §6.1).
const AD_ALLOWED: Record<AdRoute, readonly AdPosition[]> = {
  '/guias': ['after-content'],
  '/guias/:slug': ['in-article', 'after-content', 'sidebar'],
  '/noticias': ['after-content'],
  '/noticias/:slug': ['after-content'],
  '/catalogo/:categoria/:itemSlug': ['after-content'],
  '/foro': ['after-content'],
};

interface RouteCheck {
  route: AdRoute;
  url: string | null;
  status: number | null;
  note: string;
}

/** Resuelve una URL real para cada patrón de ruta (primera ficha/noticia publicada) y comprueba que responde. */
async function checkRoutes(routes: readonly AdRoute[]): Promise<RouteCheck[]> {
  const firstSlug = async (path: string): Promise<string | null> => {
    const r = await staffFetch<{ items?: Array<{ slug?: string }> } | Array<{ slug?: string }>>(path, { cache: 'no-cache' });
    const list = Array.isArray(r) ? r : (r.items ?? []);
    return list[0]?.slug ?? null;
  };
  const urlFor = async (route: AdRoute): Promise<{ url: string | null; note: string }> => {
    if (route === '/guias' || route === '/noticias' || route === '/foro') return { url: route, note: '' };
    if (route === '/guias/:slug') {
      const s = await firstSlug('/api/entities?module=guias&limit=1&envelope=1');
      return s ? { url: `/guias/${s}`, note: '' } : { url: null, note: 'No hay guías publicadas para probar.' };
    }
    if (route === '/noticias/:slug') {
      const s = await firstSlug('/api/news?limit=1');
      return s ? { url: `/noticias/${s}`, note: '' } : { url: null, note: 'No hay noticias publicadas para probar.' };
    }
    const s = await firstSlug('/api/entities?module=armas&limit=1&envelope=1');
    return s ? { url: `/catalogo/armas/${s}`, note: '' } : { url: null, note: 'No hay fichas de catálogo para probar.' };
  };
  return Promise.all(
    routes.map(async (route): Promise<RouteCheck> => {
      try {
        const { url, note } = await urlFor(route);
        if (!url) return { route, url, status: null, note };
        const res = await fetch(url, { cache: 'no-store' });
        return { route, url, status: res.status, note: res.ok ? 'La página responde.' : 'La página no responde correctamente.' };
      } catch (e) {
        return { route, url: null, status: null, note: errMsg(e) };
      }
    }),
  );
}

function MonetizationPanel() {
  const cfg = useStaffConfig();
  const afterSave = useAfterConfigSave();
  const [draft, setDraft] = useState<MonetizationConfig | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [checks, setChecks] = useState<RouteCheck[] | null>(null);

  const server = cfg.data?.monetization ?? null;
  const m = draft ?? server;
  const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(server);

  const save = useMutation({
    mutationFn: (body: MonetizationConfig) => staffFetch('/api/admin/config', { method: 'PATCH', json: { monetization: body } }),
    onSuccess: () => {
      toast.ok(`Monetización guardada. ${SAVE_NOTE}`);
      setDraft(null);
      afterSave();
    },
    onError: (e) => {
      setErr(errMsg(e));
      toast.err(`No se pudo guardar: ${errMsg(e)}`);
    },
  });
  const verify = useMutation({
    mutationFn: (routes: readonly AdRoute[]) => checkRoutes(routes),
    onSuccess: setChecks,
    onError: (e) => toast.err(`No se pudo verificar: ${errMsg(e)}`),
  });

  if (!m) return <QueryState loading={cfg.isLoading} error={cfg.error} empty={false} emptyText="" onRetry={() => void cfg.refetch()} />;
  const edit = (patch: Partial<MonetizationConfig>) => setDraft({ ...m, ...patch });
  const editSlot = (i: number, patch: Partial<Slot>) => edit({ slots: m.slots.map((s, j) => (j === i ? { ...s, ...patch } : s)) });

  const onSave = (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    const fail = (text: string) => {
      setErr(text);
      toast.err(text);
    };
    const ids = m.slots.map((s) => s.id.trim());
    if (ids.some((id) => !id) || new Set(ids).size !== ids.length) return fail('Cada slot necesita un id único.');
    if (m.slots.some((s) => !Number.isInteger(s.width) || s.width <= 0 || !Number.isInteger(s.height) || s.height <= 0)) {
      return fail('Ancho y alto deben ser enteros positivos (reserva fija, CLS = 0).');
    }
    for (const r of AD_ROUTE_OPTIONS) {
      if (m.slots.filter((s) => s.enabled && s.route === r).length > 2) return fail(`Máximo 2 slots activos por página (${r}).`);
    }
    if (m.ads_enabled && m.provider === 'adsense' && !m.publisher_id?.trim()) return fail('AdSense requiere un publisher_id (p. ej. ca-pub-…).');
    save.mutate({ ...m, require_consent: true, publisher_id: m.publisher_id?.trim() ? m.publisher_id.trim() : null, slots: m.slots.map((s) => ({ ...s, id: s.id.trim() })) });
  };

  const usedRoutes = [...new Set(m.slots.map((s) => s.route))];
  const SMALL = `${SELECT} w-full`;
  return (
    <Block
      id="blk-mon"
      title="Monetización y AdSlots"
      controls="los bloques publicitarios de /guias, /noticias, /catalogo/:categoria/:itemSlug y /foro. Nunca en mapa, Inspector, Hub, Aportar ni acceso; sin consentimiento de cookies «Marketing» no se carga ningún script."
      href="/guias"
      linkLabel="Abrir guías"
    >
      <form onSubmit={onSave} className="flex flex-col gap-4">
        <label className="flex min-h-11 items-center gap-3">
          <input type="checkbox" role="switch" checked={m.ads_enabled} onChange={(e) => edit({ ads_enabled: e.target.checked })} className="h-5 w-5 accent-[#E1307E]" />
          <span>
            Anuncios {m.ads_enabled ? 'activados' : 'pausados'} (interruptor global)
          </span>
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="mon-provider" className="mb-1 block text-sm font-medium">
              Proveedor
            </label>
            <select id="mon-provider" value={m.provider} onChange={(e) => edit({ provider: e.target.value === 'adsense' ? 'adsense' : 'none' })} className={SELECT}>
              <option value="none">Ninguno</option>
              <option value="adsense">AdSense</option>
            </select>
          </div>
          <div>
            <label htmlFor="mon-pub" className="mb-1 block text-sm font-medium">
              Publisher ID (no es secreto)
            </label>
            <input id="mon-pub" value={m.publisher_id ?? ''} maxLength={60} placeholder="ca-pub-…" onChange={(e) => edit({ publisher_id: e.target.value })} className={INPUT} />
          </div>
        </div>

        <fieldset>
          <legend className="mb-1 text-sm font-medium">Slots por ruta y posición (máx. 20)</legend>
          {m.slots.length === 0 && <p className="text-sm text-vice-text/70">Sin slots definidos.</p>}
          <ul className="flex flex-col gap-3">
            {m.slots.map((s, i) => (
              <li key={i} className="grid gap-2 rounded-xl bg-white/5 p-3 sm:grid-cols-2 lg:grid-cols-6">
                <input aria-label={`Id del slot ${i + 1}`} value={s.id} maxLength={40} onChange={(e) => editSlot(i, { id: e.target.value })} placeholder="id-del-slot" className={INPUT} />
                <select
                  aria-label={`Ruta del slot ${i + 1}`}
                  value={s.route}
                  onChange={(e) => {
                    const route = e.target.value as AdRoute;
                    editSlot(i, { route, position: AD_ALLOWED[route].includes(s.position) ? s.position : AD_ALLOWED[route][0]! });
                  }}
                  className={SMALL}
                >
                  {AD_ROUTE_OPTIONS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
                <select aria-label={`Posición del slot ${i + 1}`} value={s.position} onChange={(e) => editSlot(i, { position: e.target.value as AdPosition })} className={SMALL}>
                  {AD_ALLOWED[s.route].map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
                <input aria-label={`Ancho del slot ${i + 1}`} type="number" min={1} value={s.width} onChange={(e) => editSlot(i, { width: Math.round(Number(e.target.value)) })} className={INPUT} />
                <input aria-label={`Alto del slot ${i + 1}`} type="number" min={1} value={s.height} onChange={(e) => editSlot(i, { height: Math.round(Number(e.target.value)) })} className={INPUT} />
                <div className="flex items-center justify-between gap-2">
                  <label className="flex min-h-11 items-center gap-2 text-sm">
                    <input type="checkbox" checked={s.enabled} onChange={(e) => editSlot(i, { enabled: e.target.checked })} className="h-5 w-5 accent-[#E1307E]" />
                    {s.enabled ? 'Activo' : 'Pausado'}
                  </label>
                  <button type="button" aria-label={`Quitar slot ${i + 1}`} onClick={() => edit({ slots: m.slots.filter((_, j) => j !== i) })} className={`${BTN} px-3 text-vice-gold`}>
                    Quitar
                  </button>
                </div>
              </li>
            ))}
          </ul>
          {m.slots.length < 20 && (
            <button
              type="button"
              onClick={() => edit({ slots: [...m.slots, { id: `slot-${m.slots.length + 1}`, route: '/guias', position: 'after-content', width: 728, height: 90, enabled: true }] })}
              className={`${GHOST} mt-2`}
            >
              Añadir slot
            </button>
          )}
        </fieldset>

        <div className="flex flex-wrap gap-3">
          <button type="submit" disabled={save.isPending || !dirty} className={`${PRIMARY} flex-1`}>
            {save.isPending ? 'Guardando…' : 'Guardar monetización'}
          </button>
          <button type="button" disabled={!dirty || save.isPending} onClick={() => { setDraft(null); setErr(null); }} className={GHOST}>
            Descartar cambios
          </button>
        </div>
        <div aria-live="polite" className="min-h-[1.25rem] text-sm">
          {err ? <p role="alert" className="text-vice-gold">{err}</p> : dirty ? <p className="text-vice-text/70">Hay cambios sin guardar.</p> : null}
        </div>
      </form>

      <div className="mt-2 border-t border-white/10 pt-3">
        <h3 className="font-semibold">Verificación de rutas</h3>
        <p className="text-sm text-vice-text/80">Abre una página real de cada ruta con slots (primera ficha, guía o noticia publicada) y comprueba que responde.</p>
        <button type="button" disabled={verify.isPending || usedRoutes.length === 0} onClick={() => verify.mutate(usedRoutes)} className={`${GHOST} mt-2`}>
          {verify.isPending ? 'Verificando…' : usedRoutes.length === 0 ? 'Añade un slot para verificar' : 'Verificar rutas de los slots'}
        </button>
        {checks && (
          <ul className="mt-2 flex flex-col gap-1 text-sm">
            {checks.map((c) => (
              <li key={c.route} className="rounded-xl bg-white/5 px-3 py-2">
                <span className={c.status !== null && c.status < 400 ? 'text-vice-cyan' : 'text-vice-gold'}>{c.status !== null && c.status < 400 ? 'OK' : 'Fallo'}</span> <code>{c.route}</code>
                {c.url && (
                  <>
                    {' '}
                    → <a href={c.url} target="_blank" rel="noopener" className="underline">{c.url}</a> ({c.status})
                  </>
                )}
                {c.note && <span className="text-vice-text/70"> · {c.note}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Block>
  );
}

// ---- Sección ----------------------------------------------------------------------------------
type Sub = 'config' | 'monetizacion' | 'identidades' | 'auditoria';
const SUBS: ReadonlyArray<{ id: Sub; label: string }> = [
  { id: 'config', label: 'Configuración' },
  { id: 'monetizacion', label: 'Monetización' },
  { id: 'identidades', label: 'Identidades y roles' },
  { id: 'auditoria', label: 'Auditoría y salud' },
];

export default function StaffControl() {
  const [sub, setSub] = useState<Sub>('config');
  return (
    <div className="flex flex-col gap-4">
      <SubTabs label="Control Total" tabs={SUBS} value={sub} onChange={setSub} />
      {sub === 'config' && <ConfigPanel />}
      {sub === 'monetizacion' && <MonetizationPanel />}
      {sub === 'identidades' && <StaffIdentity />}
      {sub === 'auditoria' && <StaffAudit />}
    </div>
  );
}
