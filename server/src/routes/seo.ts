import { V1_HIDDEN_PATHS } from '../services/v1.js';
import { createReadStream, realpath as realpathCb } from 'node:fs';
import { stat } from 'node:fs/promises';
import { pipeline } from 'node:stream';
import { brotliCompressSync, constants as zc, createBrotliCompress, createGzip, gzipSync } from 'node:zlib';
import { basename, extname, posix, relative, resolve, sep } from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import Entity from '../models/Entity.js';
import Module from '../models/Module.js';
import { ROLE_RANK } from '../models/User.js';
import { buildHtmlCsp } from '../services/csp.js';
import { gateBoot } from '../services/ssrHero.js';
import OfficialNews from '../models/OfficialNews.js';
import { LEGAL_LASTMOD, LEGAL_PAGES, baseUrl, clientDistDir, escHtml, injectHead, loadTemplate, resolveRoute } from '../services/ssrLite.js';

const MAX_URLS = 50_000;
const GUIDES_MODULE = 'guias';
/** Módulos con fichas que no se indexan en el sitemap (el mapa ya tiene su propia ruta /mapa). */
const SITEMAP_EXCLUDED_MODULES = new Set(['mapa']);
// Rutas publicas indexables de docs §1.1 (sin /aportar, que es noindex).
const STATIC_PATHS = ['/', '/mapa', '/guias', '/noticias', '/foro'].filter((p) => !V1_HIDDEN_PATHS.has(p));

interface UrlEntry {
  loc: string; // ruta limpia, sin '#' ni query
  lastmod?: Date;
  /** Solo paginas de baja prioridad (legales); el resto no declara <priority>. */
  priority?: number;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Doc = Record<string, any>;

const seg = (s: unknown) => encodeURIComponent(String(s));
const validDate = (d: unknown): Date | undefined => {
  if (!d) return undefined;
  const x = new Date(d as string | number | Date);
  return Number.isNaN(x.getTime()) ? undefined : x;
};
const maxDate = (ds: Array<Date | undefined>): Date | undefined =>
  ds.reduce<Date | undefined>((m, d) => (d && (!m || d > m) ? d : m), undefined);

async function safe(fn: () => Promise<unknown>): Promise<Doc[]> {
  try {
    return (await fn()) as Doc[];
  } catch {
    return [];
  }
}

export async function collectUrls(): Promise<UrlEntry[]> {
  const modules = await safe(() => Module.find({ activo: true }).select('_id slug').lean().exec());
  const slugById = new Map(modules.map((m) => [String(m._id), String(m.slug)]));
  const entities = await safe(() =>
    Entity.find({ module_id: { $in: [...slugById.keys()] } })
      .select('slug module_id created_at')
      .sort({ created_at: -1 })
      .limit(MAX_URLS)
      .lean()
      .exec(),
  );
  const news = await safe(() =>
    OfficialNews.find({}).select('slug publishedAt updatedAt').sort({ publishedAt: -1 }).limit(MAX_URLS).lean().exec(),
  );

  const catalog: UrlEntry[] = [];
  const guides: UrlEntry[] = [];
  for (const e of entities) {
    const mod = slugById.get(String(e.module_id));
    if (!mod || !e.slug || SITEMAP_EXCLUDED_MODULES.has(mod)) continue;
    const lastmod = validDate(e.created_at);
    if (mod === GUIDES_MODULE) guides.push({ loc: `/guias/${seg(e.slug)}`, lastmod });
    else catalog.push({ loc: `/catalogo/${seg(mod)}/${seg(e.slug)}`, lastmod });
  }
  const newsUrls: UrlEntry[] = news
    .filter((n) => n.slug)
    .map((n) => ({
      loc: `/noticias/${seg(n.slug)}`,
      lastmod: validDate(n.updatedAt) ?? validDate(n.publishedAt),
    }));

  // Una pagina de categoria por modulo activo (no guias) con al menos una ficha.
  const catLastmod = new Map<string, Date | undefined>();
  for (const e of entities) {
    const mod = slugById.get(String(e.module_id));
    if (!mod || !e.slug || mod === GUIDES_MODULE || SITEMAP_EXCLUDED_MODULES.has(mod)) continue;
    catLastmod.set(mod, maxDate([catLastmod.get(mod), validDate(e.created_at)]));
  }
  const categories: UrlEntry[] = [...catLastmod].map(([mod, lastmod]) => ({
    loc: `/catalogo/${seg(mod)}`,
    lastmod,
  }));

  const staticLastmod: Record<string, Date | undefined> = {
    '/': maxDate(newsUrls.map((u) => u.lastmod)),
    '/guias': maxDate(guides.map((u) => u.lastmod)),
    '/noticias': maxDate(newsUrls.map((u) => u.lastmod)),
  };
  const statics = STATIC_PATHS.map((p) => ({
    loc: p,
    lastmod: staticLastmod[p],
  }));
  // Sin duplicados por URL (la primera aparicion gana).
  const seen = new Set<string>();
  const legal: UrlEntry[] = Object.keys(LEGAL_PAGES).map((loc) => ({
    loc,
    lastmod: new Date(LEGAL_LASTMOD),
    priority: 0.3,
  }));
  return [...statics, ...categories, ...catalog, ...guides, ...newsUrls, ...legal].filter((u) => !seen.has(u.loc) && !!seen.add(u.loc));
}

const lm = (d?: Date) => (d ? `<lastmod>${d.toISOString()}</lastmod>` : '');
const XML = '<?xml version="1.0" encoding="UTF-8"?>\n';
const NS = 'xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"';

const urlset = (urls: UrlEntry[], base: string) =>
  `${XML}<urlset ${NS}>${urls
    .map(
      (u) =>
        `<url><loc>${escHtml(base + (u.loc === '/' ? '/' : u.loc))}</loc>${lm(u.lastmod)}${u.priority !== undefined ? `<priority>${u.priority.toFixed(1)}</priority>` : ''}</url>`,
    )
    .join('')}</urlset>`;

const MIME: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
};

const COMPRESS_MIN = 1024;
const COMPRESSIBLE = /^(text\/|application\/(javascript|json|xml|manifest\+json)|image\/svg\+xml)|\+(json|xml)$/i;
const BR_OPTS = { params: { [zc.BROTLI_PARAM_QUALITY]: 5 } };

/** Codificacion negociada (br > gzip) respetando q=0; null si el cliente no acepta ninguna. */
function pickEncoding(header: string | undefined): 'br' | 'gzip' | null {
  const q = new Map<string, number>();
  for (const part of (header ?? '').split(',')) {
    const [name, ...params] = part.trim().toLowerCase().split(';');
    if (!name) continue;
    const m = /^\s*q\s*=\s*([0-9.]+)/.exec(params.join(';'));
    q.set(name.trim(), m ? Number(m[1]) : 1);
  }
  const ok = (e: string) => (q.get(e) ?? q.get('*') ?? 0) > 0;
  return ok('br') ? 'br' : ok('gzip') ? 'gzip' : null;
}

type FileBody = { file: string; size: number };
const isFile = (b: string | Buffer | FileBody): b is FileBody => typeof b === 'object' && !Buffer.isBuffer(b);

/**
 * El handler 404 (estaticos + SSR-lite) no recibe el onSend por ruta de @fastify/compress, asi que comprime aqui:
 * br/gzip solo para tipos de texto >= 1 KiB; imagenes y fuentes (ya comprimidas) salen tal cual. Siempre Vary.
 */
function sendCompressed(req: FastifyRequest, reply: FastifyReply, body: string | Buffer | FileBody, headOnly = false): FastifyReply {
  const vary = String(reply.getHeader('vary') ?? '');
  if (!/accept-encoding/i.test(vary)) reply.header('Vary', vary ? `${vary}, Accept-Encoding` : 'Accept-Encoding');
  const size = typeof body === 'string' ? Buffer.byteLength(body) : isFile(body) ? body.size : body.length;
  const ct = String(reply.getHeader('content-type') ?? '');
  const enc = COMPRESSIBLE.test(ct) && size >= COMPRESS_MIN ? pickEncoding(req.headers['accept-encoding']) : null;
  if (!enc) {
    if (isFile(body)) {
      reply.header('Content-Length', body.size);
      return headOnly ? reply.send() : reply.send(createReadStream(body.file));
    }
    return reply.send(body);
  }
  reply.header('Content-Encoding', enc);
  if (isFile(body)) {
    if (headOnly) return reply.send();
    const z = enc === 'br' ? createBrotliCompress(BR_OPTS) : createGzip();
    pipeline(createReadStream(body.file), z, () => undefined);
    return reply.send(z);
  }
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
  return reply.send(enc === 'br' ? brotliCompressSync(buf, BR_OPTS) : gzipSync(buf));
}

/**
 * Area restringida del panel (no se documenta en sitemap/robots/SSR publico). Se detecta sobre la ruta
 * decodificada y normalizada en minusculas para que variantes (%5F, `..`, mayusculas, barra invertida) no la eludan.
 */
/** Ruta real (resuelve symlinks y nombres cortos 8.3 de Windows). */
const realNative = (p: string): Promise<string> => new Promise((ok, fail) => realpathCb.native(p, (e, r) => (e ? fail(e) : ok(r))));
const STAFF_AREA = '_staff';
const normalizeLower = (raw: string): string => {
  let s = raw;
  try {
    s = decodeURIComponent(raw);
  } catch {
    /* se usa tal cual */
  }
  return posix.normalize('/' + s.split('\\').join('/')).toLowerCase();
};
const isStaffArea = (p: string): boolean => {
  const n = normalizeLower(p);
  return n === `/${STAFF_AREA}` || n.startsWith(`/${STAFF_AREA}/`);
};
/** Rango minimo para un archivo del area: chunk de Control Total (`staff-ctl-`) exige SUPER_ADMIN, resto MODERATOR. */
const staffFileMinRank = (file: string): number =>
  basename(file).toLowerCase().startsWith('staff-ctl-') ? ROLE_RANK.SUPER_ADMIN : ROLE_RANK.MODERATOR;

/** Sirve un archivo de dist/ con proteccion de path traversal. 404 JSON si no existe o es directorio. */
async function sendStatic(
  req: FastifyRequest,
  pathname: string,
  headOnly: boolean,
  reply: FastifyReply,
  staffRank: number,
): Promise<FastifyReply> {
  // Un /assets/* inexistente (hash de un despliegue anterior) responde text/plain limpio: un JSON con ese MIME
  // rompe la carga de modulos/CSS con un error confuso. El area /_staff/ conserva su 404 JSON uniforme.
  const notFound = () =>
    pathname.startsWith('/assets/')
      ? reply.code(404).header('Cache-Control', 'no-store').type('text/plain; charset=utf-8').send('No encontrado')
      : reply.code(404).send({ error: 'No encontrado' });
  let rel: string;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    return notFound();
  }
  if (rel.includes('\0')) return notFound();
  const root = resolve(clientDistDir());
  const file = resolve(root, `.${rel}`);
  if (file !== root && !file.startsWith(root + sep)) return notFound();

  const info = await stat(file).catch(() => null);
  if (!info?.isFile()) return notFound();

  // Area restringida: se comprueba la ruta pedida y la real (symlinks / nombres cortos de Windows).
  const real = await realNative(file).catch(() => file);
  const realRoot = await realNative(root).catch(() => root);
  const staffFile =
    isStaffArea(rel) ||
    isStaffArea('/' + relative(realRoot, real).split(sep).join('/')) ||
    isStaffArea('/' + relative(root, file).split(sep).join('/'));
  if (staffFile && staffRank < staffFileMinRank(real)) return notFound();
  if (staffFile) reply.header('Vary', 'Cookie');

  reply
    .header(
      'Cache-Control',
      staffFile
        ? 'private, max-age=3600'
        : rel === '/sw.js' || rel === '/index.html'
          ? 'no-cache'
          : rel.startsWith('/assets/') || (rel.startsWith('/fonts/') && rel.endsWith('.woff2'))
            ? // Las fuentes no llevan hash en el nombre, pero su contenido es estable: se aceptan como inmutables.
              'public, max-age=31536000, immutable'
            : 'public, max-age=3600',
    )
    .type(MIME[extname(file).toLowerCase()] ?? 'application/octet-stream');
  return sendCompressed(req, reply, { file, size: info.size }, headOnly);
}

export async function registerSeoRoutes(app: FastifyInstance): Promise<void> {
  const sendXml = (reply: import('fastify').FastifyReply, body: string) =>
    reply.header('Cache-Control', 'public, max-age=300').type('application/xml; charset=utf-8').send(body);

  app.get('/sitemap.xml', async (_req, reply) => {
    const base = baseUrl();
    const urls = await collectUrls();
    if (urls.length <= MAX_URLS) return sendXml(reply, urlset(urls, base));
    const parts = Math.ceil(urls.length / MAX_URLS);
    const idx = Array.from({ length: parts }, (_, i) => `<sitemap><loc>${base}/sitemap-${i + 1}.xml</loc></sitemap>`).join('');
    return sendXml(reply, `${XML}<sitemapindex ${NS}>${idx}</sitemapindex>`);
  });

  app.get<{ Params: { n: string } }>('/sitemap-:n.xml', async (req, reply) => {
    const n = Number(req.params.n);
    const urls = await collectUrls();
    const chunk = Number.isInteger(n) && n >= 1 ? urls.slice((n - 1) * MAX_URLS, n * MAX_URLS) : [];
    if (!chunk.length) return reply.code(404).send({ error: 'No encontrado' });
    return sendXml(reply, urlset(chunk, baseUrl()));
  });

  app.get('/robots.txt', async (_req, reply) =>
    reply
      .header('Cache-Control', 'public, max-age=86400')
      .type('text/plain; charset=utf-8')
      .send(`User-agent: *\nAllow: /\nDisallow: /api/\n\nSitemap: ${baseUrl()}/sitemap.xml\n`),
  );

  // Estaticos de dist/ (JS/CSS/imagenes del cliente) y fallback SPA con SSR-lite para rutas sin extension.
  app.setNotFoundHandler(async (req, reply) => {
    // Se antepone el origen al texto crudo: `//` o `//host` se leerian como URL con autoridad y lanzarian TypeError.
    let url: URL;
    try {
      url = new URL(`http://localhost${req.url.startsWith('/') ? '' : '/'}${req.url}`);
    } catch {
      return reply.code(404).send({ error: 'No encontrado' });
    }
    const p = url.pathname;
    if (p.startsWith('//')) return reply.code(404).send({ error: 'No encontrado' });
    const readOnly = req.method === 'GET' || req.method === 'HEAD';
    if (!readOnly || p.startsWith('/api/')) return reply.code(404).send({ error: 'No encontrado' });

    const staffRank = req.authUser ? ROLE_RANK[req.authUser.rol] : -1;
    if (/\.[a-z0-9]{1,12}$/i.test(p)) {
      if (p === '/sitemap.xml' || p === '/robots.txt') return reply.code(404).send({ error: 'No encontrado' });
      return sendStatic(req, p, req.method === 'HEAD', reply, staffRank);
    }
    if (p.startsWith('/assets/'))
      return reply.code(404).header('Cache-Control', 'no-store').type('text/plain; charset=utf-8').send('No encontrado');

    const template = loadTemplate();
    if (!template)
      return reply.code(404).send({
        error: 'Cliente no compilado (ejecuta pnpm build en la raiz)',
      });

    const csp = buildHtmlCsp(template);

    // Area restringida: staff (MODERATOR+) recibe la shell noindex; cualquier otro, exactamente lo mismo que una ruta inexistente.
    if (isStaffArea(p)) {
      const staff = staffRank >= ROLE_RANK.MODERATOR;
      const rr = await resolveRoute(staff ? '/' : '/nada-existe', new URLSearchParams());
      if (rr.kind === 'page') {
        const { hero: _hero, preloadImage: _preload, ...shell } = rr.meta; // el panel no lleva el hero estatico de la portada
        const meta = staff
          ? {
              ...shell,
              title: 'Panel',
              robots: 'noindex,nofollow' as const,
              jsonLd: [],
            }
          : rr.meta;
        reply.header('Content-Security-Policy', csp);
        if (staff) {
          void reply.header('Cache-Control', 'private, no-store').header('Vary', 'Cookie').header('X-Robots-Tag', 'noindex, nofollow');
        } else {
          void reply.header('Cache-Control', 'no-store');
        }
        return sendCompressed(req, reply.code(meta.status).type('text/html; charset=utf-8'), injectHead(template, meta));
      }
    }

    const r = await resolveRoute(p, url.searchParams);
    if (r.kind === 'redirect') return reply.redirect(r.to, 301);
    const page = reply
      .code(r.meta.status)
      .header('Cache-Control', r.meta.status === 200 ? 'no-cache' : 'no-store')
      // Portada: el cargador diferido del cliente es un script en linea; su hash va en la CSP (sin 'unsafe-inline').
      .header('Content-Security-Policy', r.meta.hero && r.meta.status === 200 ? buildHtmlCsp(gateBoot(template)) : csp)
      .type('text/html; charset=utf-8');
    return sendCompressed(req, page, injectHead(template, r.meta));
  });
}
