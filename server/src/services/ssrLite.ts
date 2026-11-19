import { existsSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import Entity from '../models/Entity.js';
import Module from '../models/Module.js';
import OfficialNews from '../models/OfficialNews.js';
import { env } from '../config/env.js';

/**
 * SSR-lite (docs/LeonidApp-Rutas-SEO-Monetizacion.md §3): no renderiza React; inyecta
 * title, meta, canonical, Open Graph, Twitter y JSON-LD en el `index.html` del cliente.
 */

export const SITE_NAME = 'LeonidApp';
export const DEFAULT_IMAGE_PATH = '/assets/hero-gas-station.jpg';
const DEFAULT_DESCRIPTION =
  'LeonidApp: atlas interactivo de Leonida con mapa, catalogo, guias, foro y noticias oficiales. Proyecto de fans no afiliado a Rockstar Games.';
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX = 500;
const GUIDES_MODULE = 'guias';

export const baseUrl = (): string => env.PUBLIC_SITE_URL.replace(/\/+$/, '');

// --- Escapado -----------------------------------------------------------------

export const escHtml = (s: unknown): string =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** JSON seguro dentro de <script>: neutraliza `</script>`, `<!--` y separadores de linea. */
export const safeJsonLd = (data: unknown): string =>
  JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .split(String.fromCharCode(0x2028))
    .join('\\u2028')
    .split(String.fromCharCode(0x2029))
    .join('\\u2029');

const truncate = (s: string, max: number): string => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
};

// --- Modelo de pagina ---------------------------------------------------------

type JsonLd = Record<string, unknown>;

export interface PageMeta {
  status: 200 | 404;
  title: string; // sin sufijo de marca
  description: string;
  path: string; // ruta limpia canonica (sin query ni hash)
  type: 'website' | 'article';
  image: string; // URL absoluta
  robots: 'index,follow' | 'noindex,nofollow';
  jsonLd: JsonLd[];
  publishedTime?: string;
}

export type Resolved = { kind: 'page'; meta: PageMeta } | { kind: 'redirect'; to: string };

export const absolute = (u: unknown): string => {
  const s = typeof u === 'string' ? u.trim() : '';
  if (/^https:\/\//i.test(s) || /^http:\/\//i.test(s)) return s;
  if (s.startsWith('/') && !s.startsWith('//')) return baseUrl() + s;
  return baseUrl() + DEFAULT_IMAGE_PATH;
};

const base = (over: Partial<PageMeta> & { path: string }): PageMeta => ({
  status: 200,
  title: SITE_NAME,
  description: DEFAULT_DESCRIPTION,
  type: 'website',
  image: baseUrl() + DEFAULT_IMAGE_PATH,
  robots: 'index,follow',
  jsonLd: [],
  ...over,
});

const crumbs = (items: Array<[string, string]>): JsonLd => ({
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: items.map(([name, path], i) => ({
    '@type': 'ListItem',
    position: i + 1,
    name,
    item: baseUrl() + path,
  })),
});

const collectionPage = (name: string, description: string, path: string): JsonLd[] => [
  { '@context': 'https://schema.org', '@type': 'CollectionPage', name, description, url: baseUrl() + path },
  crumbs([
    ['Inicio', '/'],
    [name, path],
  ]),
];

const notFound = (): PageMeta =>
  base({
    status: 404,
    path: '/404',
    title: 'Pagina no encontrada',
    description: 'La pagina que buscas no existe en LeonidApp.',
    robots: 'noindex,nofollow',
  });

// --- Rutas estaticas ----------------------------------------------------------

const STATIC_PAGES: Record<string, { title: string; description: string; collection?: string }> = {
  '/mapa': {
    title: 'Mapa de Leonida',
    description: 'Mapa interactivo de Leonida con regiones, puntos de interes y marcadores de la comunidad.',
    collection: 'Mapa de Leonida',
  },
  '/catalogo': {
    title: 'Catalogo de Leonida',
    description: 'Catalogo de vehiculos, armas, personajes, negocios y mas elementos de Leonida con sus estadisticas.',
    collection: 'Catalogo',
  },
  '/guias': {
    title: 'Guias',
    description: 'Guias paso a paso y ayuda de la comunidad para explorar Leonida.',
    collection: 'Guias',
  },
  '/noticias': {
    title: 'Noticias oficiales',
    description: 'Noticias oficiales de Rockstar Games y Take-Two Interactive, con enlace a la fuente original.',
    collection: 'Noticias oficiales',
  },
  '/foro': {
    title: 'Foro de la comunidad',
    description: 'Foro de la comunidad: guias, ayuda y debates sobre Leonida.',
    collection: 'Foro',
  },
};
const NOINDEX_PAGES: Record<string, string> = {
  '/hub': 'Hub',
  '/progreso': 'Progreso',
  '/entrar': 'Entrar',
  '/aportar': 'Aportar',
};

const LANDING_DESCRIPTION =
  'Explora el mapa interactivo de Leonida, el catálogo de armas, vehículos y coleccionables, guías, noticias oficiales y el foro de la comunidad.';

const landing = (): PageMeta =>
  base({
    path: '/',
    title: 'Mapa, catálogo y guías de Leonida',
    description: LANDING_DESCRIPTION,
    jsonLd: [
      {
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        name: SITE_NAME,
        url: baseUrl() + '/',
        description: LANDING_DESCRIPTION,
        inLanguage: 'es',
        potentialAction: {
          '@type': 'SearchAction',
          target: { '@type': 'EntryPoint', urlTemplate: `${baseUrl()}/catalogo?q={search_term_string}` },
          'query-input': 'required name=search_term_string',
        },
      },
      {
        '@context': 'https://schema.org',
        '@type': 'Organization',
        name: SITE_NAME,
        url: baseUrl() + '/',
        description: 'Proyecto de fans, sin afiliacion con Rockstar Games ni Take-Two Interactive.',
      },
    ],
  });

// --- Resolucion con BD --------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Doc = Record<string, any>;

const dbReady = (): boolean => mongoose.connection.readyState === 1;

async function newsPage(slug: string): Promise<PageMeta> {
  const n = (await OfficialNews.findOne({ slug }).lean().exec()) as Doc | null;
  if (!n) return notFound();
  const path = `/noticias/${slug}`;
  const description = truncate(n.summary || `Noticia oficial: ${n.title}`, 160);
  const published = new Date(n.publishedAt).toISOString();
  const image = absolute(n.imageUrl);
  return base({
    path,
    title: n.title,
    description,
    type: 'article',
    image,
    publishedTime: published,
    jsonLd: [
      {
        '@context': 'https://schema.org',
        '@type': 'NewsArticle',
        headline: truncate(n.title, 110),
        description,
        datePublished: published,
        ...(n.updatedAt ? { dateModified: new Date(n.updatedAt).toISOString() } : {}),
        image: [image],
        mainEntityOfPage: baseUrl() + path,
        isBasedOn: n.sourceUrl,
        publisher: { '@type': 'Organization', name: SITE_NAME, url: baseUrl() + '/' },
      },
      crumbs([
        ['Inicio', '/'],
        ['Noticias oficiales', '/noticias'],
        [n.title, path],
      ]),
    ],
  });
}

async function guidePage(slug: string): Promise<PageMeta> {
  const mod = (await Module.findOne({ slug: GUIDES_MODULE, activo: true }).lean().exec()) as Doc | null;
  const g = mod ? ((await Entity.findOne({ module_id: mod._id, slug }).lean().exec()) as Doc | null) : null;
  if (!g) return notFound();
  const path = `/guias/${slug}`;
  const meta = (g.metadata_json ?? {}) as Doc;
  const rawSteps: unknown[] = Array.isArray(meta.steps) ? meta.steps : [];
  const steps = rawSteps
    .filter((s): s is Doc => !!s && typeof s === 'object')
    .filter((s) => typeof s.title === 'string' && s.title)
    .map((s, i) => ({ id: String(s.id ?? i + 1), title: String(s.title), body: String(s.body ?? '') }));
  const description = truncate(g.subtitulo || steps[0]?.body || `Guia de ${g.titulo} en LeonidApp.`, 160);
  const image = absolute(g.imagen_url);
  const published = g.created_at ? new Date(g.created_at).toISOString() : undefined;
  const main: JsonLd = steps.length
    ? {
        '@context': 'https://schema.org',
        '@type': 'HowTo',
        name: g.titulo,
        description,
        image: [image],
        step: steps.map((s, i) => ({
          '@type': 'HowToStep',
          position: i + 1,
          name: s.title,
          text: s.body || s.title,
          url: `${baseUrl()}${path}#${encodeURIComponent(s.id)}`,
        })),
      }
    : {
        '@context': 'https://schema.org',
        '@type': 'Article',
        headline: truncate(g.titulo, 110),
        description,
        image: [image],
        ...(published ? { datePublished: published } : {}),
        mainEntityOfPage: baseUrl() + path,
      };
  return base({
    path,
    title: g.titulo,
    description,
    type: 'article',
    image,
    publishedTime: published,
    jsonLd: [
      main,
      crumbs([
        ['Inicio', '/'],
        ['Guias', '/guias'],
        [g.titulo, path],
      ]),
    ],
  });
}

async function entityPage(moduleSlug: string, slug: string): Promise<Resolved> {
  const mod = (await Module.findOne({ slug: moduleSlug, activo: true }).lean().exec()) as Doc | null;
  if (!mod) return { kind: 'page', meta: notFound() };
  const e = (await Entity.findOne({ module_id: mod._id, slug }).lean().exec()) as Doc | null;
  if (!e) return { kind: 'page', meta: notFound() };
  if (moduleSlug === GUIDES_MODULE) return { kind: 'redirect', to: `/guias/${slug}` };
  const path = `/catalogo/${moduleSlug}/${slug}`;
  const description = truncate(e.subtitulo || `${e.titulo}: ${e.categoria} de ${mod.nombre} en el catalogo de LeonidApp.`, 160);
  const image = absolute(e.imagen_url);
  return {
    kind: 'page',
    meta: base({
      path,
      title: e.titulo,
      description,
      image,
      jsonLd: [
        {
          '@context': 'https://schema.org',
          '@type': 'CreativeWork',
          name: e.titulo,
          description,
          image: [image],
          genre: e.categoria,
          url: baseUrl() + path,
          isPartOf: { '@type': 'CollectionPage', name: mod.nombre, url: `${baseUrl()}/catalogo` },
        },
        crumbs([
          ['Inicio', '/'],
          ['Catalogo', '/catalogo'],
          [e.titulo, path],
        ]),
      ],
    }),
  };
}

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Cache en memoria por ruta (TTL 5 min). Solo se cachean respuestas 200. */
const cache = new Map<string, { exp: number; meta: PageMeta }>();
export const clearSsrCache = (): void => cache.clear();

/** Decide que mostrar para una ruta. Nunca lanza: ante fallo de BD devuelve la cabecera generica. */
export async function resolveRoute(pathname: string, search: URLSearchParams): Promise<Resolved> {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;

  if (path === '/aportes') return { kind: 'redirect', to: '/aportar' };
  if (path === '/') return { kind: 'page', meta: landing() };
  if (NOINDEX_PAGES[path]) {
    return {
      kind: 'page',
      meta: base({ path, title: NOINDEX_PAGES[path], robots: 'noindex,nofollow' }),
    };
  }
  const st = STATIC_PAGES[path];
  if (st) {
    if (path === '/catalogo' && search.get('comparar')) {
      return { kind: 'page', meta: base({ path, title: st.title, description: st.description, robots: 'noindex,nofollow' }) };
    }
    const entity = path === '/catalogo' ? search.get('entity') : null;
    const item = path === '/noticias' ? search.get('item') : null;
    if (item && SLUG_RE.test(item)) return { kind: 'redirect', to: `/noticias/${item}` };
    if (entity) {
      const r = await withDb(async () => {
        const e = (await Entity.findOne({ _id: entity }).select('slug module_id').lean().exec()) as Doc | null;
        const m = e ? ((await Module.findOne({ _id: e.module_id }).select('slug').lean().exec()) as Doc | null) : null;
        return e && m ? `/${m.slug === GUIDES_MODULE ? 'guias' : `catalogo/${m.slug}`}/${e.slug}` : null;
      });
      if (r) return { kind: 'redirect', to: r };
    }
    return {
      kind: 'page',
      meta: base({
        path,
        title: st.title,
        description: st.description,
        jsonLd: st.collection ? collectionPage(st.collection, st.description, path) : [],
      }),
    };
  }

  const m = /^\/(noticias|guias)\/([^/]+)$/.exec(path) ?? /^\/catalogo\/([^/]+)\/([^/]+)$/.exec(path);
  if (!m) return { kind: 'page', meta: notFound() };

  const cached = cache.get(path);
  if (cached && cached.exp > Date.now()) return { kind: 'page', meta: cached.meta };

  const isCatalog = path.startsWith('/catalogo/');
  const a = m[1]!;
  const b = m[2]!;
  const slugOk = isCatalog ? SLUG_RE.test(a) && SLUG_RE.test(b) : SLUG_RE.test(b);
  if (!slugOk) return { kind: 'page', meta: notFound() };

  try {
    if (!dbReady()) throw new Error('db no disponible');
    let res: Resolved;
    if (isCatalog) res = await entityPage(a, b);
    else if (a === 'noticias') res = { kind: 'page', meta: await newsPage(b) };
    else res = { kind: 'page', meta: await guidePage(b) };
    if (res.kind === 'page' && res.meta.status === 200) {
      if (cache.size >= CACHE_MAX) cache.clear();
      cache.set(path, { exp: Date.now() + CACHE_TTL_MS, meta: res.meta });
    }
    return res;
  } catch {
    // Fallo de BD: cabecera generica de la landing y 200 (la SPA resuelve la vista).
    return { kind: 'page', meta: { ...landing(), path, robots: 'noindex,nofollow' } };
  }
}

async function withDb<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    if (!dbReady()) return null;
    return await fn();
  } catch {
    return null;
  }
}

// --- Render / inyeccion -------------------------------------------------------

export function renderHead(meta: PageMeta): string {
  const url = baseUrl() + (meta.path === '/404' ? '' : meta.path);
  const full = `${truncate(meta.title, 60 - SITE_NAME.length - 3)} · ${SITE_NAME}`;
  const title = meta.path === '/' ? `${SITE_NAME} · ${truncate(meta.title, 57)}` : full;
  const desc = truncate(meta.description, 160);
  const e = escHtml;
  const lines = [
    `<title>${e(title)}</title>`,
    `<meta name="description" content="${e(desc)}" />`,
    `<meta name="robots" content="${meta.robots}" />`,
  ];
  if (meta.status === 200) lines.push(`<link rel="canonical" href="${e(url)}" />`);
  lines.push(
    `<meta property="og:site_name" content="${SITE_NAME}" />`,
    `<meta property="og:locale" content="es_ES" />`,
    `<meta property="og:type" content="${meta.type}" />`,
    `<meta property="og:title" content="${e(title)}" />`,
    `<meta property="og:description" content="${e(desc)}" />`,
    `<meta property="og:image" content="${e(meta.image)}" />`,
  );
  if (meta.status === 200) lines.push(`<meta property="og:url" content="${e(url)}" />`);
  if (meta.publishedTime) lines.push(`<meta property="article:published_time" content="${e(meta.publishedTime)}" />`);
  lines.push(
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${e(title)}" />`,
    `<meta name="twitter:description" content="${e(desc)}" />`,
    `<meta name="twitter:image" content="${e(meta.image)}" />`,
  );
  if (meta.status === 200) {
    for (const ld of meta.jsonLd) lines.push(`<script type="application/ld+json">${safeJsonLd(ld)}</script>`);
  }
  return lines.join('\n    ');
}

const MARK_RE = /<!--ssr-head-->[\s\S]*?<!--\/ssr-head-->/;

/** Reemplaza los marcadores `<!--ssr-head-->`; si no existen, retira title/description/robots/canonical previos e inyecta antes de `</head>`. */
export function injectHead(template: string, meta: PageMeta): string {
  const block = renderHead(meta);
  if (MARK_RE.test(template)) {
    return template.replace(MARK_RE, () => `<!--ssr-head-->\n    ${block}\n    <!--/ssr-head-->`);
  }
  const cleaned = template
    .replace(/<title>[\s\S]*?<\/title>\s*/i, '')
    .replace(/<meta\s+name=["']description["'][^>]*>\s*/gi, '')
    .replace(/<meta\s+name=["']robots["'][^>]*>\s*/gi, '')
    .replace(/<link\s+rel=["']canonical["'][^>]*>\s*/gi, '');
  return cleaned.replace(/<\/head>/i, () => `    <!--ssr-head-->\n    ${block}\n    <!--/ssr-head-->\n  </head>`);
}

/** Ruta de index.html del cliente compilado (CLIENT_DIST_INDEX o dist/ en la raiz del repo). */
const clientIndexFile = (): string =>
  process.env.CLIENT_DIST_INDEX ?? fileURLToPath(new URL('../../../dist/index.html', import.meta.url));

/** Directorio del cliente compilado: de ahi se sirven los estaticos. */
export const clientDistDir = (): string => dirname(clientIndexFile());

let templateCache: string | null | undefined;

/** Lee dist/index.html del cliente una vez. null si aun no esta compilado (dev). */
export function loadTemplate(): string | null {
  if (templateCache !== undefined && templateCache !== null) return templateCache;
  const file = clientIndexFile();
  templateCache = existsSync(file) ? readFileSync(file, 'utf8') : null;
  return templateCache;
}
