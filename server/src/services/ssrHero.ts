import { AppConfig, heroSlideSchema, normalizeHeroOrder } from '../models/AppConfig.js';
import { env } from '../config/env.js';
import { escHtml } from './ssrLite.js';

/**
 * Hero estatico de la portada `/` (SSR-lite, docs/LeonidApp-Rutas-SEO-Monetizacion.md §3.6).
 *
 * El HTML de `/` lleva dentro de `<div id="root">` un bloque `<div id="ssr-hero">` con el primer slide activo del
 * Hero y su CSS critico en linea (`<style id="ssr-hero-css">`), de modo que la imagen LCP se pinta sin esperar al JS
 * ni a que React monte. `createRoot(#root)` sustituye todo el contenido de `#root`: el bloque desaparece en la misma
 * tarea en que aparece el Hero real, sin logica extra en el cliente.
 *
 * CONTRATO CON EL CLIENTE (src/components/ui/HeroCarousel.tsx):
 *   - id `ssr-hero`; el bloque NO contiene nada interactivo (ni enlaces, ni botones, ni scripts).
 *   - la geometria del Hero real NO debe cambiar: cabecera 71 px; contenedor max-w-7xl con px-4/md:px-8 y pt-2;
 *     tarjeta con borde 1 px y radio 24 px; movil (< 768 px): columna invertida, imagen 16/10 (slide por defecto) o
 *     16/9 y texto solapado -24 px; escritorio (>= 768 px): min-height 52vh, max-height 60vh, imagen absoluta a la
 *     derecha 55 % de ancho y 100 % de alto, texto 55 % (max 36rem) con padding 40 px.
 *   - mismos `srcset`/`sizes`/`src` que el `<img>` del Hero real (HERO_DEFAULT_SRCSET para el slide por defecto;
 *     `<media>?w=800` 800w + `<media>` 1600w para imagenes propias) para que el preload sirva a ambos.
 *   - si cambian los textos de `DEFAULT_HERO_SLIDE` (src/data/seed.ts), actualizar `DEFAULT_HERO` aqui.
 */

export interface HeroImage {
  src: string;
  srcset?: string;
  sizes: string;
  width: number;
  height: number;
  /** Tipo MIME del candidato del preload (solo si se conoce: variante webp del artwork por defecto). */
  type?: string;
  /** href del `<link rel=preload>` (variante pequena si hay srcset). */
  preloadHref: string;
}

export interface HeroView {
  kicker: string;
  titulo: string;
  descripcion: string;
  alt: string;
  isDefault: boolean;
  image: HeroImage;
}

const SIZES = '(min-width: 768px) 55vw, 100vw';
const DEFAULT_SRC = '/assets/hero-gas-station.jpg';
const DEFAULT_SMALL = '/assets/hero-gas-station-800.webp';
const OWN_MEDIA_RE = /^\/media\/[0-9a-f-]{36}$/i;
const ASSET_RE = /^\/assets\/[A-Za-z0-9_./-]+$/;

/** Textos del slide por defecto: copia de DEFAULT_HERO_SLIDE (src/data/seed.ts). */
const DEFAULT_HERO: HeroView = {
  kicker: 'Guía comunitaria de Leonida',
  titulo: 'Todo Leonida, en un solo mapa',
  descripcion: 'Mapa, catálogo, guías y foro. Marca lo que ya encontraste.',
  alt: 'Lucía y Jason con pañuelos sobre el rostro frente a una gasolinera al atardecer',
  isDefault: true,
  image: {
    src: DEFAULT_SRC,
    srcset: `${DEFAULT_SMALL} 800w, ${DEFAULT_SRC} 1080w`,
    sizes: SIZES,
    width: 1080,
    height: 1350,
    type: 'image/webp',
    preloadHref: DEFAULT_SMALL,
  },
};

export const defaultHero = (): HeroView => DEFAULT_HERO;

const apiOrigin = (): string => env.API_PUBLIC_URL.replace(/\/+$/, '');

/** Imagen del slide: `/media/<uuid>` (la sirve la API: variante 800 y principal), `/assets/...` o https sin credenciales. null = invalida. */
function imageOf(url: string): HeroImage | null {
  if (OWN_MEDIA_RE.test(url)) {
    const full = `${apiOrigin()}${url}`;
    const small = `${full}?w=800`;
    return { src: full, srcset: `${small} 800w, ${full} 1600w`, sizes: SIZES, width: 1600, height: 900, preloadHref: small };
  }
  if (ASSET_RE.test(url) && !url.includes('..')) return { src: url, sizes: SIZES, width: 1600, height: 900, preloadHref: url };
  if (/^https:\/\//i.test(url)) {
    try {
      const u = new URL(url);
      if (!u.username && !u.password && u.hostname) return { src: u.href, sizes: SIZES, width: 1600, height: 900, preloadHref: u.href };
    } catch {
      /* invalida */
    }
  }
  return null;
}

/** Primer slide ACTIVO (por `orden`) con imagen valida; sin ninguno, el hero por defecto. Lectura tolerante, nunca lanza. */
export function pickHero(raw: unknown): HeroView {
  if (!Array.isArray(raw)) return DEFAULT_HERO;
  const ok = raw.flatMap((s) => {
    const r = heroSlideSchema.safeParse(s);
    return r.success ? [r.data] : [];
  });
  for (const s of normalizeHeroOrder(ok)) {
    if (!s.activa) continue;
    const image = imageOf(s.imagen_url);
    if (!image) continue;
    return { kicker: s.kicker, titulo: s.titulo, descripcion: s.descripcion, alt: s.imagen_alt, isDefault: false, image };
  }
  return DEFAULT_HERO;
}

const HERO_TTL_MS = 30_000;
let heroCache: { exp: number; view: HeroView } | null = null;
export const clearHeroCache = (): void => {
  heroCache = null;
};

/** Hero a mostrar en `/` (cache 30 s como `/api/hero`; se invalida al guardar el carrusel). Fallo de BD = por defecto. */
export async function loadHero(): Promise<HeroView> {
  if (heroCache && heroCache.exp > Date.now()) return heroCache.view;
  try {
    const doc = await AppConfig.findOne({ key: 'global' }).select('hero_slides').lean().exec();
    const view = pickHero((doc as { hero_slides?: unknown } | null)?.hero_slides);
    heroCache = { exp: Date.now() + HERO_TTL_MS, view };
    return view;
  } catch {
    return DEFAULT_HERO;
  }
}

/**
 * CSS critico (< 3 KB), independiente del CSS externo. Todo bajo `#ssr-hero` (especificidad mayor que el preflight de
 * Tailwind, que se carga despues y no debe alterar la geometria). Medidas = las del Hero real en 390x844 y 1440x900.
 */
export const HERO_CSS =
  '#ssr-hero,#ssr-hero *{box-sizing:border-box}' +
  '#ssr-hero{min-height:calc(100dvh + 71px);padding:env(safe-area-inset-top,0) env(safe-area-inset-right,0) 0 env(safe-area-inset-left,0);' +
  'background:linear-gradient(180deg,#2e1a47 0%,#7b2c6f 38%,#e14b7b 72%,#f69259 100%);color:#fbf1f5;' +
  'font-family:Poppins,system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}' +
  'html,body{margin:0;background:#2e1a47}' +
  '#ssr-hero .sh-head{height:71px}' +
  '#ssr-hero .sh-wrap{max-width:80rem;margin:0 auto;padding:8px 16px 40px}' +
  '#ssr-hero .sh-card{position:relative;isolation:isolate;display:flex;flex-direction:column-reverse;overflow:hidden;' +
  'border:1px solid rgba(246,146,89,.25);border-radius:24px;background:rgba(20,14,36,.78);box-shadow:0 10px 40px rgba(26,10,34,.45)}' +
  '#ssr-hero .sh-text{position:relative;z-index:10;display:flex;flex-direction:column;align-items:flex-start;gap:12px;' +
  'max-width:36rem;margin-top:-24px;padding:0 20px 20px}' +
  '#ssr-hero .sh-k{margin:0;font-size:12px;line-height:16px;font-weight:600;letter-spacing:.3em;text-transform:uppercase;color:#f69259}' +
  '#ssr-hero .sh-t{margin:0;font:700 1.75rem/1.15 Jost,system-ui,sans-serif}' +
  '#ssr-hero .sh-d{margin:0;font-size:15px;line-height:1.625;color:rgba(251,241,245,.9);display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden}' +
  '#ssr-hero .sh-cta{width:100%;height:44px;margin-top:4px}' +
  '#ssr-hero .sh-img{position:relative;width:100%;aspect-ratio:16/9;-webkit-mask-image:linear-gradient(180deg,#000 62%,transparent 100%);mask-image:linear-gradient(180deg,#000 62%,transparent 100%)}' +
  '#ssr-hero .sh-def .sh-img{aspect-ratio:16/10}' +
  '#ssr-hero .sh-img img{position:absolute;right:0;bottom:0;display:block;width:100%;height:100%;max-width:none;object-fit:cover;object-position:50% 50%}' +
  '#ssr-hero .sh-def .sh-img img{object-position:50% 82%}' +
  '#ssr-hero .sh-img:after{content:"";position:absolute;left:0;right:0;top:0;height:56px;background:linear-gradient(180deg,rgba(20,14,36,.55),transparent)}' +
  '@media (min-width:768px){' +
  '#ssr-hero .sh-wrap{padding:8px 32px 40px}' +
  '#ssr-hero .sh-card{flex-direction:row;align-items:center;min-height:calc(52vh + 2px);max-height:60vh}' +
  '#ssr-hero .sh-text{width:55%;margin-top:0;padding:40px}' +
  '#ssr-hero .sh-t{font-size:3rem}#ssr-hero .sh-d{font-size:18px;-webkit-line-clamp:unset;display:block}' +
  '#ssr-hero .sh-cta{width:auto;margin-top:8px}' +
  '#ssr-hero .sh-img,#ssr-hero .sh-def .sh-img{position:absolute;top:0;bottom:0;right:0;width:55%;height:100%;aspect-ratio:auto;' +
  '-webkit-mask-image:linear-gradient(90deg,transparent 0,#000 28%);mask-image:linear-gradient(90deg,transparent 0,#000 28%)}' +
  '#ssr-hero .sh-img img,#ssr-hero .sh-def .sh-img img{object-position:50% 100%}' +
  '#ssr-hero .sh-img:after{display:none}}';

/** `<link rel=preload>` del LCP: misma variante que el `<img>` estatico (srcset/sizes identicos). Una sola por pagina. */
export function heroPreload(h: HeroView): { href: string; srcset?: string; sizes: string; type?: string } {
  return { href: h.image.preloadHref, ...(h.image.srcset ? { srcset: h.image.srcset } : {}), sizes: h.image.sizes, ...(h.image.type ? { type: h.image.type } : {}) };
}

/** Bloque HTML del hero estatico (todo el texto escapado; sin enlaces, botones ni scripts). */
export function renderHeroBlock(h: HeroView): string {
  const e = escHtml;
  const i = h.image;
  return (
    `<div id="ssr-hero"><div class="sh-head"></div><div class="sh-wrap">` +
    `<section class="sh-card${h.isDefault ? ' sh-def' : ''}" aria-label="Portada de LeonidApp">` +
    `<div class="sh-text">${h.kicker ? `<p class="sh-k">${e(h.kicker)}</p>` : ''}<h1 class="sh-t">${e(h.titulo)}</h1>` +
    `<p class="sh-d">${e(h.descripcion)}</p><div class="sh-cta" aria-hidden="true"></div></div>` +
    `<div class="sh-img"><img src="${e(i.src)}"${i.srcset ? ` srcset="${e(i.srcset)}"` : ''} sizes="${e(i.sizes)}" width="${i.width}" height="${i.height}" ` +
    `alt="${e(h.alt)}" fetchpriority="high" decoding="async" /></div>` +
    `</section></div></div>`
  );
}

// --- Arranque diferido del cliente en `/` (puerta de pintado) -------------------------------------------------------

const ASSET_URL_RE = /^\/assets\/[A-Za-z0-9_.\-/]+\.js$/;
const MAIN_SCRIPT_RE = /<script\b(?=[^>]*\btype="module")(?=[^>]*\bsrc="([^"]+)")[^>]*><\/script>[ \t]*\r?\n?/i;
const MODULEPRELOAD_RE = /<link\b(?=[^>]*\brel="modulepreload")(?=[^>]*\bhref="([^"]+)")[^>]*>[ \t]*\r?\n?/gi;

/**
 * Cuerpo del cargador en linea (se autoriza por hash en la CSP, sin 'unsafe-inline' de scripts). Espera a que el
 * `<img>` del hero estatico se haya PINTADO (entrada `largest-contentful-paint` cuyo elemento es esa imagen), anade los
 * `modulepreload` y arranca el modulo principal. Si el navegador no expone LCP, arranca ya; tope de 2,5 s por si la
 * imagen no llega. Sin la puerta, React sustituye `#root` antes del primer pintado, el hero estatico nunca se llega a
 * pintar y el LCP queda detras de ~450 KB de JS (modelo simulado de Lighthouse: 4,9 s frente a 2,1 s).
 */
const gateScript = (main: string, pre: string[]): string =>
  `(function(){var d=0,P=${JSON.stringify(pre)},m=function(){if(d)return;d=1;P.forEach(function(h){var l=document.createElement("link");l.rel="modulepreload";l.href=h;document.head.appendChild(l)});import(${JSON.stringify(main)})};` +
  `try{if(!(window.PerformanceObserver&&PerformanceObserver.supportedEntryTypes&&PerformanceObserver.supportedEntryTypes.includes("largest-contentful-paint"))){m();return}` +
  `new PerformanceObserver(function(l){for(var e of l.getEntries()){var n=e.element;if(n&&n.tagName==="IMG"&&n.closest("#ssr-hero")){setTimeout(m,0);return}}}).observe({type:"largest-contentful-paint",buffered:true})}catch(x){m();return}` +
  `setTimeout(m,2500)})()`;

const gated = new Map<string, string>();

/**
 * Plantilla de `/`: quita `<script type=module src=/assets/index-*.js>` y los `<link rel=modulepreload>` (que competirian
 * con la imagen LCP por el ancho de banda antes de pintarla) y los sustituye por el cargador diferido al final de
 * `<body>`. Solo transforma si todas las URLs son `/assets/*.js` locales; en cualquier otro caso devuelve la plantilla tal cual.
 */
export function gateBoot(template: string): string {
  const hit = gated.get(template);
  if (hit !== undefined) return hit;
  let out = template;
  const main = MAIN_SCRIPT_RE.exec(template);
  const pre = [...template.matchAll(MODULEPRELOAD_RE)];
  if (main && ASSET_URL_RE.test(main[1]!) && pre.every((p) => ASSET_URL_RE.test(p[1]!)) && /<\/body>/i.test(template)) {
    out = template.replace(MAIN_SCRIPT_RE, '').replace(MODULEPRELOAD_RE, '');
    out = out.replace(/<\/body>/i, () => `<script>${gateScript(main[1]!, pre.map((p) => p[1]!))}</script></body>`);
  }
  if (gated.size > 4) gated.clear();
  gated.set(template, out);
  return out;
}
