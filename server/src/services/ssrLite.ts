import { readFileSync, statSync } from 'node:fs';
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
  /** Solo con imagen propia (/media): dimensiones y alt para og:image:width/height/alt. */
  imageMeta?: { width: number; height: number; alt: string };
  robots: 'index,follow' | 'noindex,follow' | 'noindex,nofollow';
  /** Sin <link rel=canonical> ni og:url (p. ej. categoria vacia: no se declara una URL canonica engañosa). */
  noCanonical?: boolean;
  jsonLd: JsonLd[];
  publishedTime?: string;
  /** Texto SSR minimo para rastreadores sin JS (h1 + descripcion), dentro de <noscript> en #root. Solo paginas legales. */
  body?: { h1: string; text: string };
  /** Imagen LCP a precargar (solo `/`): debe coincidir con el srcset/sizes del <img> del hero (HeroCarousel.tsx). */
  preloadImage?: { href: string; srcset: string; sizes: string; type: string };
}

/** Artwork por defecto del hero: mismo srcset/sizes que HERO_DEFAULT_SRCSET en src/components/ui/HeroCarousel.tsx. */
export const HERO_PRELOAD = {
  href: '/assets/hero-gas-station-800.webp',
  srcset: '/assets/hero-gas-station-800.webp 800w, /assets/hero-gas-station.jpg 1080w',
  sizes: '(min-width: 768px) 55vw, 100vw',
  type: 'image/webp',
} as const;

export type Resolved = { kind: 'page'; meta: PageMeta } | { kind: 'redirect'; to: string };

export const absolute = (u: unknown): string => {
  const s = typeof u === 'string' ? u.trim() : '';
  if (/^https:\/\//i.test(s) || /^http:\/\//i.test(s)) return s;
  if (s.startsWith('/') && !s.startsWith('//')) return baseUrl() + s;
  return baseUrl() + DEFAULT_IMAGE_PATH;
};

const OWN_MEDIA_RE = /^\/media\/[0-9a-f-]{36}$/i;
const ASSET_PATH_RE = /^\/assets\/[A-Za-z0-9_./-]+$/;
/** Tamano nominal de la imagen social propia (cover 1600x900, ver docs del Estudio). */
const SOCIAL_W = 1600;
const SOCIAL_H = 900;

export interface SocialImage {
  url: string; // absoluta
  own: boolean; // imagen propia servida por la API (/media/<uuid>)
  width?: number;
  height?: number;
  alt?: string;
}

/**
 * Unico punto de decision de la imagen social (og:image, twitter:image, JSON-LD `image`) de una ficha o guia.
 * - `/media/<uuid>`: imagen propia -> URL absoluta (cuando el Sprint 3 exponga variantes, solo cambia aqui, p. ej. `?w=1600`).
 * - `/assets/...` interno permitido -> absoluta.
 * - `https://` valido sin credenciales -> tal cual.
 * - null/otro (javascript:, //host, http, rutas no permitidas, `..`) -> respaldo hero.
 */
export function socialImageOf(entity: { imagen_url?: unknown; titulo?: unknown }): SocialImage {
  const fallback: SocialImage = { url: baseUrl() + DEFAULT_IMAGE_PATH, own: false };
  const raw = typeof entity.imagen_url === 'string' ? entity.imagen_url.trim() : '';
  if (!raw) return fallback;
  if (OWN_MEDIA_RE.test(raw)) {
    return { url: baseUrl() + raw, own: true, width: SOCIAL_W, height: SOCIAL_H, alt: String(entity.titulo ?? '') };
  }
  if (ASSET_PATH_RE.test(raw) && !raw.includes('..')) return { url: baseUrl() + raw, own: false };
  if (/^https:\/\//i.test(raw)) {
    try {
      const u = new URL(raw);
      if (u.protocol === 'https:' && !u.username && !u.password && u.hostname) return { url: u.href, own: false };
    } catch {
      /* cae al respaldo */
    }
  }
  return fallback;
}

const imageMetaOf = (si: SocialImage): PageMeta['imageMeta'] =>
  si.own && si.width && si.height ? { width: si.width, height: si.height, alt: si.alt ?? '' } : undefined;

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
/**
 * Paginas legales (S6.3). El texto visible vive en el cliente (src/data/legalDocs.ts); aqui solo van titulo,
 * descripcion y fecha de revision para la meta SSR y el sitemap. Una prueba comprueba que no se desincronizan.
 */
export const LEGAL_LASTMOD = '2026-11-23';
export const LEGAL_PAGES: Record<string, { title: string; description: string }> = {
  '/legal/privacidad': {
    title: 'Política de privacidad',
    description:
      'Qué datos trata LeonidApp, para qué los usa, dónde se almacenan y cómo puedes ejercer tus derechos de acceso, rectificación y supresión.',
  },
  '/legal/cookies': {
    title: 'Política de cookies',
    description:
      'Qué cookies y almacenamiento local usa LeonidApp, la diferencia entre necesarias y de marketing, y cómo cambiar tu decisión en cualquier momento.',
  },
  '/legal/terminos': {
    title: 'Términos de uso',
    description:
      'Condiciones de uso de LeonidApp: cuenta, contenido de la comunidad y aportes, conducta, moderación, ausencia de garantías y limitación de responsabilidad.',
  },
  '/legal/marcas': {
    title: 'Aviso de marca y propiedad intelectual',
    description:
      'LeonidApp es un proyecto de aficionados no afiliado a Rockstar Games ni Take-Two Interactive. Información sobre marcas, imágenes de terceros y su procedencia.',
  },
  '/legal/retirada': {
    title: 'Retirada de contenido y derechos de autor',
    description:
      'Canal para titulares de derechos: cómo notificar a LeonidApp una infracción, qué datos incluir, plazo de respuesta y retirada en 72 horas y contra-notificación.',
  },
};

const legalPage = (path: string, lp: { title: string; description: string }): PageMeta =>
  base({
    path,
    title: lp.title,
    description: lp.description,
    body: { h1: lp.title, text: lp.description },
    jsonLd: [
      {
        '@context': 'https://schema.org',
        '@type': 'WebPage',
        name: lp.title,
        description: lp.description,
        url: baseUrl() + path,
        inLanguage: 'es',
        dateModified: LEGAL_LASTMOD,
        isPartOf: { '@type': 'WebSite', name: SITE_NAME, url: baseUrl() + '/' },
      },
      crumbs([
        ['Inicio', '/'],
        [lp.title, path],
      ]),
    ],
  });

const CATALOG_ROOT = {
  title: 'Catalogo de Leonida',
  description: 'Catalogo de vehiculos, armas, coleccionables y mas elementos de Leonida con sus estadisticas.',
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
    preloadImage: { ...HERO_PRELOAD },
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

/** `metadata_json.descripcion` canónica (texto editorial original) o ''. */
const descripcionOf = (meta: Doc): string => (typeof meta.descripcion === 'string' ? meta.descripcion.replace(/\s+/g, ' ').trim() : '');

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
  const longText = descripcionOf(meta);
  const description = truncate(longText || g.subtitulo || steps[0]?.body || `Guia de ${g.titulo} en LeonidApp.`, 160);
  /** JSON-LD: descripción completa si existe; si no, la misma de la meta. */
  const ldDescription = longText || description;
  const social = socialImageOf(g);
  const image = social.url;
  const published = g.created_at ? new Date(g.created_at).toISOString() : undefined;
  const main: JsonLd = steps.length
    ? {
        '@context': 'https://schema.org',
        '@type': 'HowTo',
        name: g.titulo,
        description: ldDescription,
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
        description: ldDescription,
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
    imageMeta: imageMetaOf(social),
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

const CATALOG_DEFAULT = 'armas';

/** "<Nombre> de Leonida" sin duplicar el sufijo cuando el nombre del modulo ya lo incluye. */
const withLeonida = (nombre: string): string => (/leonida/i.test(nombre) ? nombre : `${nombre} de Leonida`);

/** Categoria por defecto del catalogo: `armas` si esta activa; si no, la primera activa por `orden` (excluye guias). null sin BD/modulos. */
export async function defaultCategory(): Promise<string | null> {
  return withDb(async () => {
    const mods = (await Module.find({ activo: true, slug: { $ne: GUIDES_MODULE } })
      .select('slug')
      .sort({ orden: 1 })
      .lean()
      .exec()) as Doc[];
    if (mods.some((m) => m.slug === CATALOG_DEFAULT)) return CATALOG_DEFAULT;
    return mods[0] ? String(mods[0].slug) : null;
  });
}

async function categoryPage(moduleSlug: string): Promise<Resolved> {
  if (moduleSlug === GUIDES_MODULE) return { kind: 'redirect', to: '/guias' };
  const mod = (await Module.findOne({ slug: moduleSlug, activo: true }).lean().exec()) as Doc | null;
  if (!mod) return { kind: 'page', meta: notFound() };
  const count = await Entity.countDocuments({ module_id: mod._id }).exec();
  const path = `/catalogo/${moduleSlug}`;
  if (count === 0) {
    // Categoria activa sin fichas: 200 para la SPA (estado vacio), pero sin indexar y sin canonical ni JSON-LD de lista.
    return {
      kind: 'page',
      meta: base({
        path,
        title: `${mod.nombre}: sin fichas por ahora`,
        description: truncate(
          `La categoria ${mod.nombre} todavia no tiene fichas en el catalogo de LeonidApp. Explora otras categorias mientras la completamos.`,
          160,
        ),
        robots: 'noindex,follow',
        noCanonical: true,
      }),
    };
  }
  const description = truncate(
    `${withLeonida(mod.nombre)}: ${count} ${count === 1 ? 'ficha' : 'fichas'} con estadisticas y detalles en el catalogo de LeonidApp.`,
    160,
  );
  return {
    kind: 'page',
    meta: base({
      path,
      title: withLeonida(mod.nombre),
      description,
      jsonLd: [
        {
          '@context': 'https://schema.org',
          '@type': 'CollectionPage',
          name: mod.nombre,
          description,
          url: baseUrl() + path,
          numberOfItems: count,
          isPartOf: { '@type': 'WebSite', name: SITE_NAME, url: baseUrl() + '/' },
        },
        crumbs([
          ['Inicio', '/'],
          ['Catalogo', '/catalogo'],
          [mod.nombre, path],
        ]),
      ],
    }),
  };
}

async function entityPage(moduleSlug: string, slug: string): Promise<Resolved> {
  const mod = (await Module.findOne({ slug: moduleSlug, activo: true }).lean().exec()) as Doc | null;
  if (!mod) return { kind: 'page', meta: notFound() };
  const e = (await Entity.findOne({ module_id: mod._id, slug }).lean().exec()) as Doc | null;
  if (!e) return { kind: 'page', meta: notFound() };
  if (moduleSlug === GUIDES_MODULE) return { kind: 'redirect', to: `/guias/${slug}` };
  const path = `/catalogo/${moduleSlug}/${slug}`;
  const longText = descripcionOf((e.metadata_json ?? {}) as Doc);
  const description = truncate(longText || e.subtitulo || `${e.titulo}: ${e.categoria} de ${mod.nombre} en el catalogo de LeonidApp.`, 160);
  const social = socialImageOf(e);
  const image = social.url;
  return {
    kind: 'page',
    meta: base({
      path,
      title: e.titulo,
      description,
      image,
      imageMeta: imageMetaOf(social),
      jsonLd: [
        {
          '@context': 'https://schema.org',
          '@type': 'CreativeWork',
          name: e.titulo,
          description: longText || description,
          image: [image],
          genre: e.categoria,
          url: baseUrl() + path,
          isPartOf: { '@type': 'CollectionPage', name: mod.nombre, url: `${baseUrl()}/catalogo/${moduleSlug}` },
        },
        crumbs([
          ['Inicio', '/'],
          ['Catalogo', '/catalogo'],
          [mod.nombre, `/catalogo/${moduleSlug}`],
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
export const ssrCacheSize = (): number => cache.size;

/** `/catalogo`: `?entity` -> URL limpia del item; `?q`/`?comparar` sirven la shell; sin query o `?modulo` -> 301 a la categoria. */
async function catalogRoot(search: URLSearchParams): Promise<Resolved> {
  const entity = search.get('entity');
  if (entity) {
    const r = await withDb(async () => {
      const e = (await Entity.findOne({ _id: entity }).select('slug module_id').lean().exec()) as Doc | null;
      const m = e ? ((await Module.findOne({ _id: e.module_id }).select('slug').lean().exec()) as Doc | null) : null;
      return e && m ? `/${m.slug === GUIDES_MODULE ? 'guias' : `catalogo/${m.slug}`}/${e.slug}` : null;
    });
    if (r) return { kind: 'redirect', to: r };
  }
  const shell = (robots: PageMeta['robots'], cat: string | null): Resolved => ({
    kind: 'page',
    meta: base({
      path: cat ? `/catalogo/${cat}` : '/catalogo',
      title: CATALOG_ROOT.title,
      description: CATALOG_ROOT.description,
      robots,
    }),
  });
  const def = await defaultCategory();
  if (search.get('comparar')) return shell('noindex,nofollow', def);
  if (search.has('q')) return shell('index,follow', def);
  const modulo = search.get('modulo');
  if (modulo && SLUG_RE.test(modulo) && modulo !== GUIDES_MODULE) {
    const active = await withDb(async () => Module.exists({ slug: modulo, activo: true }).exec());
    if (active) return { kind: 'redirect', to: `/catalogo/${modulo}` };
  }
  if (def) return { kind: 'redirect', to: `/catalogo/${def}` };
  return shell('index,follow', null);
}

/** Decide que mostrar para una ruta. Nunca lanza: ante fallo de BD devuelve la cabecera generica. */
export async function resolveRoute(pathname: string, search: URLSearchParams): Promise<Resolved> {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;

  // /catalogo/mapa[/:slug] (sin distinguir mayusculas): el mapa se explora solo en /mapa.
  const mapaM = /^\/catalogo\/mapa(?:\/([^/]+))?$/i.exec(path);
  if (mapaM) {
    let pin = mapaM[1] ?? '';
    try {
      pin = decodeURIComponent(pin);
    } catch {
      pin = '';
    }
    pin = pin.toLowerCase();
    return { kind: 'redirect', to: pin && SLUG_RE.test(pin) ? `/mapa?pin=${encodeURIComponent(pin)}` : '/mapa' };
  }

  // Mayusculas en la ruta: si la version en minusculas existe, 301 a ella (conserva la query); si no, el 404 de siempre.
  if (/[A-Z]/.test(path)) {
    const lower = path.toLowerCase();
    const r = await resolveRoute(lower, search);
    if (r.kind === 'page' && r.meta.status === 200) {
      const qs = search.toString();
      return { kind: 'redirect', to: lower + (qs ? `?${qs}` : '') };
    }
    return r.kind === 'page' ? { kind: 'page', meta: notFound() } : r;
  }

  if (path === '/aportes') return { kind: 'redirect', to: '/aportar' };
  if (path === '/') return { kind: 'page', meta: landing() };
  if (NOINDEX_PAGES[path]) {
    return {
      kind: 'page',
      meta: base({ path, title: NOINDEX_PAGES[path], robots: 'noindex,nofollow' }),
    };
  }
  if (path === '/catalogo') return catalogRoot(search);
  const legal = Object.hasOwn(LEGAL_PAGES, path) ? LEGAL_PAGES[path] : undefined;
  if (legal) return { kind: 'page', meta: legalPage(path, legal) };
  const st = STATIC_PAGES[path];
  if (st) {
    const item = path === '/noticias' ? search.get('item') : null;
    if (item && SLUG_RE.test(item)) return { kind: 'redirect', to: `/noticias/${item}` };
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

  const m =
    /^\/(noticias|guias)\/([^/]+)$/.exec(path) ??
    /^\/catalogo\/([^/]+)\/([^/]+)$/.exec(path) ??
    /^\/catalogo\/([^/]+)$/.exec(path);
  if (!m) return { kind: 'page', meta: notFound() };

  const cached = cache.get(path);
  if (cached && cached.exp > Date.now()) return { kind: 'page', meta: cached.meta };

  const isCatalog = path.startsWith('/catalogo/');
  const a = m[1]!;
  const b = m[2];
  const slugOk = isCatalog ? SLUG_RE.test(a) && (b === undefined || SLUG_RE.test(b)) : SLUG_RE.test(b!);
  if (!slugOk) return { kind: 'page', meta: notFound() };

  try {
    if (!dbReady()) throw new Error('db no disponible');
    let res: Resolved;
    if (isCatalog) res = b === undefined ? await categoryPage(a) : await entityPage(a, b);
    else if (a === 'noticias') res = { kind: 'page', meta: await newsPage(b!) };
    else res = { kind: 'page', meta: await guidePage(b!) };
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
  const withUrl = meta.status === 200 && !meta.noCanonical;
  if (withUrl) lines.push(`<link rel="canonical" href="${e(url)}" />`);
  lines.push(
    `<meta property="og:site_name" content="${SITE_NAME}" />`,
    `<meta property="og:locale" content="es_ES" />`,
    `<meta property="og:type" content="${meta.type}" />`,
    `<meta property="og:title" content="${e(title)}" />`,
    `<meta property="og:description" content="${e(desc)}" />`,
    `<meta property="og:image" content="${e(meta.image)}" />`,
  );
  if (meta.imageMeta) {
    lines.push(
      `<meta property="og:image:width" content="${meta.imageMeta.width}" />`,
      `<meta property="og:image:height" content="${meta.imageMeta.height}" />`,
      `<meta property="og:image:alt" content="${e(truncate(meta.imageMeta.alt, 200))}" />`,
    );
  }
  if (withUrl) lines.push(`<meta property="og:url" content="${e(url)}" />`);
  if (meta.publishedTime) lines.push(`<meta property="article:published_time" content="${e(meta.publishedTime)}" />`);
  lines.push(
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${e(title)}" />`,
    `<meta name="twitter:description" content="${e(desc)}" />`,
    `<meta name="twitter:image" content="${e(meta.image)}" />`,
  );
  if (meta.status === 200 && meta.preloadImage) {
    const p = meta.preloadImage;
    lines.push(
      `<link rel="preload" as="image" href="${e(p.href)}" type="${e(p.type)}" imagesrcset="${e(p.srcset)}" imagesizes="${e(p.sizes)}" fetchpriority="high" />`,
    );
  }
  if (meta.status === 200) {
    for (const ld of meta.jsonLd) lines.push(`<script type="application/ld+json">${safeJsonLd(ld)}</script>`);
  }
  return lines.join('\n    ');
}

const MARK_RE = /<!--ssr-head-->[\s\S]*?<!--\/ssr-head-->/;

/** Reemplaza los marcadores `<!--ssr-head-->`; si no existen, retira title/description/robots/canonical previos e inyecta antes de `</head>`. */
const ROOT_RE = /<div id="root"><\/div>/;

/** Fallback para rastreadores sin JS: dentro de <noscript> (no se muestra con JS, asi que no hay parpadeo ni CLS). */
const renderBody = (meta: PageMeta): string =>
  meta.body ? `<div id="root"><noscript><main><h1>${escHtml(meta.body.h1)}</h1><p>${escHtml(meta.body.text)}</p></main></noscript></div>` : '';

export function injectHead(template: string, meta: PageMeta): string {
  const out = injectHeadOnly(template, meta);
  return meta.body && meta.status === 200 && ROOT_RE.test(out) ? out.replace(ROOT_RE, () => renderBody(meta)) : out;
}

function injectHeadOnly(template: string, meta: PageMeta): string {
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
let templateMtime = 0;

/**
 * Lee dist/index.html del cliente y lo vuelve a leer si cambia en disco (p. ej. tras `pnpm build`): un indice en
 * memoria con los hashes de un build anterior apuntaria a chunks que ya no existen (pagina en blanco y sin conexion
 * hasta reiniciar el servidor). null si aun no esta compilado (dev).
 */
export function loadTemplate(): string | null {
  const file = clientIndexFile();
  let mtime = 0;
  try {
    mtime = statSync(file).mtimeMs;
  } catch {
    templateCache = null;
    templateMtime = 0;
    return null;
  }
  if (templateCache === undefined || templateCache === null || mtime !== templateMtime) {
    templateCache = readFileSync(file, 'utf8');
    templateMtime = mtime;
  }
  return templateCache;
}
