// =============================================================================
// LEONIDAPP - Router mínimo con History API (rutas limpias, sin '#').
// Sin librería externa. Expone: navigate(), useLocation(), matchRoute(),
// interceptación de <a href> internos, popstate y usePageMeta() (title/meta/canonical).
// Docs: docs/LeonidApp-Rutas-SEO-Monetizacion.md §1 y §3 (regla 5).
// No guarda nada en localStorage/sessionStorage.
// =============================================================================
import { useEffect, useMemo } from 'react';
import { create } from 'zustand';

interface LocationState {
  path: string;
  search: string;
}

const normalizePath = (p: string): string => {
  const clean = p.replace(/\/{2,}/g, '/');
  return clean.length > 1 ? clean.replace(/\/+$/, '') : clean || '/';
};

/** Compatibilidad: convierte `#/ruta` heredado en `/ruta` una sola vez al arrancar. */
function migrateLegacyHash(): void {
  if (typeof window === 'undefined') return;
  const h = window.location.hash;
  if (h.startsWith('#/')) window.history.replaceState(window.history.state, '', h.slice(1));
}
migrateLegacyHash();

const read = (): LocationState =>
  typeof window === 'undefined'
    ? { path: '/', search: '' }
    : { path: normalizePath(window.location.pathname), search: window.location.search };

const useLocationStore = create<LocationState>(() => read());

export interface NavigateOptions {
  replace?: boolean;
  /** Mantener la posición de scroll (por defecto se vuelve arriba). */
  keepScroll?: boolean;
}

/** Navega a una ruta interna (o ruta + query). Rutas externas hacen carga completa. */
export function navigate(to: string, opts: NavigateOptions = {}): void {
  const url = new URL(to, window.location.origin);
  if (url.origin !== window.location.origin) {
    window.location.assign(to);
    return;
  }
  const target = `${normalizePath(url.pathname)}${url.search}${url.hash}`;
  const here = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (target !== here) {
    if (opts.replace) window.history.replaceState(null, '', target);
    else window.history.pushState(null, '', target);
  }
  useLocationStore.setState({ path: normalizePath(url.pathname), search: url.search });
  if (!opts.keepScroll) window.scrollTo(0, 0);
}

const NON_CLIENT = /^\/(api|assets)(\/|$)|^\/(sitemap\.xml|robots\.txt)$/;

let installed = false;
/** Instala popstate + interceptación de clics en <a href> internos (una sola vez). */
export function installRouter(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('popstate', () => useLocationStore.setState(read()));
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const target = e.target instanceof Element ? e.target : null;
    const a = target?.closest('a');
    if (!a) return;
    const href = a.getAttribute('href');
    if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return;
    if (a.hasAttribute('download') || (a.target && a.target !== '_self') || a.rel.includes('external')) return;
    const url = new URL(href, window.location.href);
    if (url.origin !== window.location.origin || NON_CLIENT.test(url.pathname)) return;
    e.preventDefault();
    navigate(`${url.pathname}${url.search}${url.hash}`);
  });
}

export interface RouterLocation {
  path: string;
  search: string;
  params: URLSearchParams;
}

export function useLocation(): RouterLocation {
  const path = useLocationStore((s) => s.path);
  const search = useLocationStore((s) => s.search);
  const params = useMemo(() => new URLSearchParams(search), [search]);
  return { path, search, params };
}

// ---- Tabla de rutas con :param ----------------------------------------------------
export interface RouteMatch<Id extends string> {
  id: Id;
  params: Record<string, string>;
}

export function matchRoute<Id extends string>(
  table: ReadonlyArray<readonly [pattern: string, id: Id]>,
  path: string,
): RouteMatch<Id> | null {
  const segs = path.split('/').filter(Boolean);
  for (const [pattern, id] of table) {
    const pSegs = pattern.split('/').filter(Boolean);
    if (pSegs.length !== segs.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    for (let i = 0; i < pSegs.length; i += 1) {
      const p = pSegs[i]!;
      const s = segs[i]!;
      if (p.startsWith(':')) {
        try {
          params[p.slice(1)] = decodeURIComponent(s);
        } catch {
          ok = false;
          break;
        }
      } else if (p !== s) {
        ok = false;
        break;
      }
    }
    if (ok) return { id, params };
  }
  return null;
}

// ---- Metadatos por ruta (title, description, robots, canonical) --------------------
export interface PageMeta {
  title: string;
  description?: string;
  /** Por defecto 'index,follow'. */
  robots?: 'index,follow' | 'noindex,nofollow';
  /** Ruta canónica (sin query ni hash); por defecto la ruta actual. */
  canonicalPath?: string;
}

const SITE = 'LeonidApp';

function setHeadMeta(name: string, content: string): void {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute('name', name);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

/** Actualiza document.title, description, robots y canonical (no toca JSON-LD: lo inyecta el servidor). */
export function usePageMeta(meta: PageMeta | null): void {
  const { path } = useLocation();
  const title = meta?.title;
  const description = meta?.description;
  const robots = meta?.robots;
  const canonicalPath = meta?.canonicalPath;
  useEffect(() => {
    if (title === undefined) return;
    // title '' = no tocar el título (lo gestiona la propia vista, p. ej. la landing).
    if (title) document.title = title.includes(SITE) ? title : `${title} · ${SITE}`;
    if (description) setHeadMeta('description', description);
    setHeadMeta('robots', robots ?? 'index,follow');
    let link = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!link) {
      link = document.createElement('link');
      link.rel = 'canonical';
      document.head.appendChild(link);
    }
    link.href = `${window.location.origin}${canonicalPath ?? path}`;
  }, [title, description, robots, canonicalPath, path]);
}
