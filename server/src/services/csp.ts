import { createHash } from 'node:crypto';
import { env } from '../config/env.js';
import { ALLOWED_HOSTS } from '../workers/sources.js';

/**
 * Content-Security-Policy.
 *
 * - API / recursos no HTML: politica cerrada (`default-src 'none'`).
 * - Documentos HTML (SSR-lite): politica compatible con el cliente real.
 *   Decisiones:
 *   * `script-src 'self'`: el bundle de Vite son modulos externos. Los bloques JSON-LD
 *     (`type="application/ld+json"`) son datos, no se ejecutan y no estan sujetos a script-src.
 *   * El `onload="this.media='all'"` de la hoja de fuentes de index.html es un manejador inline:
 *     en vez de `'unsafe-inline'` se autoriza SOLO su hash con `'unsafe-hashes'`. Los hashes se
 *     calculan del propio HTML servido (cualquier `on*="..."` o `<script>` inline ejecutable),
 *     por lo que si el cliente cambia esa linea la politica se adapta sin tocar el servidor.
 *   * `style-src 'unsafe-inline'`: React/Tailwind emiten atributos `style=""` dinamicos
 *     (no se pueden hashear). Se acepta el riesgo, limitado a estilos.
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

/** Dominios registrables oficiales (p. ej. `*.rockstargames.com`) para imagenes de noticias. */
const officialImageHosts = (): string[] =>
  [...new Set(ALLOWED_HOSTS.map((h) => h.split('.').slice(-2).join('.')))].map((d) => `https://*.${d} https://${d}`);

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
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    `img-src 'self' data: blob: ${officialImageHosts().join(' ')}`,
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

