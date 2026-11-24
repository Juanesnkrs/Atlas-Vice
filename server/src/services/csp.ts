import { createHash } from 'node:crypto';
import { env } from '../config/env.js';

/**
 * Content-Security-Policy.
 *
 * - API / recursos no HTML: politica cerrada (`default-src 'none'`).
 * - Documentos HTML (SSR-lite): politica compatible con el cliente real.
 *   Decisiones:
 *   * `script-src 'self'`: el bundle de Vite son modulos externos. Los bloques JSON-LD
 *     (`type="application/ld+json"`) son datos, no se ejecutan y no estan sujetos a script-src.
 *   * Manejadores inline (`on*="..."`) o `<script>` inline ejecutables: en vez de `'unsafe-inline'` se
 *     autoriza SOLO su hash (con `'unsafe-hashes'` para atributos). Los hashes se calculan del propio HTML
 *     servido, asi que la politica se adapta sola. Hoy index.html no tiene ninguno y el hero estatico de `/`
 *     (ssrHero.ts) no incluye scripts ni manejadores.
 *   * Fuentes (Poppins y Jost) alojadas en el propio origen (`/fonts/*.woff2`): `font-src 'self'` y `style-src`
 *     sin fonts.googleapis.com ni fonts.gstatic.com (S6.2: sin terceros en la ruta critica ni fuga de IP a Google).
 *   * `style-src 'unsafe-inline'`: React/Tailwind emiten atributos `style=""` dinamicos
 *     (no se pueden hashear). Se acepta el riesgo, limitado a estilos.
 *   * `img-src ... https:`: decision del propietario (2026-11-21). Las diapositivas del Hero admiten imagenes
 *     de cualquier dominio https, por lo que se retiran los hosts oficiales sueltos (quedan incluidos). Riesgo
 *     aceptado: fuga de IP/Referer al host de la imagen y contenido externo mutable. Ninguna otra directiva se relaja.
 *   * AdSense (solo tras consentimiento, `<AdSlot/>`): script de pagead2.googlesyndication.com y
 *     frames de anuncios.
 */

const originOf = (u: string): string | null => {
  try {
    return new URL(u).origin;
  } catch {
    return null;
  }
};

const sha256 = (s: string): string => `'sha256-${createHash('sha256').update(s, 'utf8').digest('base64')}'`;

const decodeAttr = (s: string): string =>
  s.replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/** Hashes de manejadores inline (`on*="..."`) y de `<script>` sin src/JSON de datos. */
function inlineHashes(html: string): { handlers: string[]; scripts: string[] } {
  const handlers = new Set<string>();
  const scripts = new Set<string>();
  const head = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, (m) => {
    const open = /^<script\b([^>]*)>/i.exec(m)?.[1] ?? '';
    const body = m.slice(m.indexOf('>') + 1, m.lastIndexOf('</'));
    if (/\bsrc\s*=/i.test(open) || /type\s*=\s*["']?(application\/(ld\+)?json|importmap)/i.test(open) || !body.trim()) return '';
    scripts.add(sha256(body));
    return '';
  });
  for (const m of head.matchAll(/\son[a-z]+\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
    handlers.add(sha256(decodeAttr(m[1] ?? m[2] ?? '')));
  }
  return { handlers: [...handlers], scripts: [...scripts] };
}

export const API_POLICY = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

const cache = new Map<string, string>();

export function buildHtmlCsp(html: string): string {
  const hit = cache.get(html);
  if (hit) return hit;
  const { handlers, scripts } = inlineHashes(html);
  const api = originOf(env.API_PUBLIC_URL);
  const connect = ["'self'", ...(api ? [api] : []), 'https://pagead2.googlesyndication.com'];
  const script = [
    "'self'",
    ...(handlers.length ? ["'unsafe-hashes'", ...handlers] : []),
    ...scripts,
    'https://pagead2.googlesyndication.com',
  ];
  const policy = [
    "default-src 'self'",
    `script-src ${script.join(' ')}`,
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    "img-src 'self' data: blob: https:",
    `connect-src ${connect.join(' ')}`,
    "worker-src 'self'",
    "manifest-src 'self'",
    "media-src 'self' blob:",
    'frame-src https://googleads.g.doubleclick.net https://tpc.googlesyndication.com',
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
  if (cache.size > 4) cache.clear();
  cache.set(html, policy);
  return policy;
}

