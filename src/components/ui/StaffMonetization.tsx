// Bloque «Monetización y AdSlots» de Control Total (chunk `staff-ctl-*`, solo SUPER_ADMIN): proveedor, interruptor global,
// slots por ruta/posición y verificación de que cada ruta con anuncios responde.
import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import type { AdPosition, AdRoute, MonetizationConfig } from '../../types/database';
import { SaveBar, useConfigForm } from './StaffConfig';
import { Block, BTN, errMsg, GHOST, INPUT, SELECT, staffFetch, toast } from './StaffKit';

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

export default function StaffMonetization() {
  const form = useConfigForm<MonetizationConfig>({
    draftKey: 'config:monetization',
    read: (c) => c.monetization,
    toBody: (v) => ({ monetization: v }),
    okText: 'Monetización guardada.',
  });
  const [checks, setChecks] = useState<RouteCheck[] | null>(null);
  const verify = useMutation({
    mutationFn: (routes: readonly AdRoute[]) => checkRoutes(routes),
    onSuccess: setChecks,
    onError: (e) => toast.err(`No se pudo verificar: ${errMsg(e)}`),
  });

  const m = form.value;
  if (!m) return form.loading;
  const edit = (patch: Partial<MonetizationConfig>) => form.edit({ ...m, ...patch });
  const editSlot = (i: number, patch: Partial<Slot>) => edit({ slots: m.slots.map((s, j) => (j === i ? { ...s, ...patch } : s)) });

  const onSave = (e: FormEvent) => {
    e.preventDefault();
    const ids = m.slots.map((s) => s.id.trim());
    if (ids.some((id) => !id) || new Set(ids).size !== ids.length) return form.fail('Cada slot necesita un id único.');
    if (m.slots.some((s) => !Number.isInteger(s.width) || s.width <= 0 || !Number.isInteger(s.height) || s.height <= 0)) {
      return form.fail('Ancho y alto deben ser enteros positivos (reserva fija, CLS = 0).');
    }
    for (const r of AD_ROUTE_OPTIONS) {
      if (m.slots.filter((s) => s.enabled && s.route === r).length > 2) return form.fail(`Máximo 2 slots activos por página (${r}).`);
    }
    if (m.ads_enabled && m.provider === 'adsense' && !m.publisher_id?.trim()) return form.fail('AdSense requiere un publisher_id (p. ej. ca-pub-…).');
    form.submit({ ...m, require_consent: true, publisher_id: m.publisher_id?.trim() ? m.publisher_id.trim() : null, slots: m.slots.map((s) => ({ ...s, id: s.id.trim() })) });
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

        <SaveBar label="Guardar monetización" saving={form.saving} dirty={form.dirty} err={form.err} onDiscard={form.discard} />
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
