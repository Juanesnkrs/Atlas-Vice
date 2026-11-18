import type { FastifyInstance } from 'fastify';
import { OfficialNews } from '../models/OfficialNews.js';
import Entity from '../models/Entity.js';
import ForumThread from '../models/ForumThread.js';

const MAX_URLS = 50_000;
const STATIC_PATHS = ['/', '/mapa', '/catalogo', '/foro', '/noticias', '/guias'];
const REGIONS = ['leonida-keys', 'grassrivers', 'port-gellhorn', 'vice-city', 'ambrosia', 'kalaga-park'];

interface UrlEntry {
  loc: string;
  lastmod?: Date;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Doc = Record<string, any>;

const esc = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
const baseUrl = () => (process.env.PUBLIC_SITE_URL ?? 'http://localhost:5173').replace(/\/+$/, '');
const seg = (s: unknown) => encodeURIComponent(String(s));

async function safe(fn: () => Promise<unknown>): Promise<Doc[]> {
  try {
    return (await fn()) as Doc[];
  } catch {
    return [];
  }
}

async function collectUrls(): Promise<UrlEntry[]> {
  const urls: UrlEntry[] = [
    ...STATIC_PATHS.map((p) => ({ loc: p })),
    ...REGIONS.map((r) => ({ loc: `/mapa/${r}` })),
  ];
  const entities = await safe(() =>
    Entity.find({}).select('slug category type updatedAt').limit(20_000).lean().exec(),
  );
  for (const e of entities) {
    if (!e.slug) continue;
    const cat = e.category ?? e.type ?? 'general';
    urls.push({ loc: `/catalogo/${seg(cat)}/${seg(e.slug)}`, lastmod: e.updatedAt });
  }
  const threads = await safe(() =>
    ForumThread.find({}).select('slug updatedAt').sort({ updatedAt: -1 }).limit(20_000).lean().exec(),
  );
  for (const t of threads) urls.push({ loc: `/foro/${seg(t.slug ?? t._id)}`, lastmod: t.updatedAt });
  const news = await safe(() =>
    OfficialNews.find({}).select('slug publishedAt updatedAt').sort({ publishedAt: -1 }).limit(20_000).lean().exec(),
  );
  for (const n of news) urls.push({ loc: `/noticias/${seg(n.slug)}`, lastmod: n.updatedAt ?? n.publishedAt });
  return urls.slice(0, MAX_URLS);
}

export async function registerSeoRoutes(app: FastifyInstance): Promise<void> {
  app.get('/sitemap.xml', async (_req, reply) => {
    const base = baseUrl();
    const body = (await collectUrls())
      .map((u) => {
        const d = u.lastmod ? new Date(u.lastmod) : null;
        const lm = d && !Number.isNaN(d.getTime()) ? `<lastmod>${d.toISOString()}</lastmod>` : '';
        return `<url><loc>${esc(base + u.loc)}</loc>${lm}</url>`;
      })
      .join('');
    return reply
      .header('Cache-Control', 'public, max-age=3600')
      .type('application/xml; charset=utf-8')
      .send(
        `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${body}</urlset>`,
      );
  });

  app.get('/robots.txt', async (_req, reply) =>
    reply
      .header('Cache-Control', 'public, max-age=86400')
      .type('text/plain; charset=utf-8')
      .send(`User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /admin\n\nSitemap: ${baseUrl()}/sitemap.xml\n`),
  );
}
