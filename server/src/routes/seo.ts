import type { FastifyInstance } from 'fastify';
import { OfficialNews } from '../models/OfficialNews.js';
import Entity from '../models/Entity.js';
import ForumThread from '../models/ForumThread.js';

const MAX_URLS = 50_000;
// El cliente usa enrutado hash (src/App.tsx): las rutas reales son `/#/ruta?param=`.
const STATIC_PATHS = ['/', '/#/mapa', '/#/catalogo', '/#/foro', '/#/noticias'];
// Mismos nombres que MAP_REGIONS en src/data/seed.ts (parametro `region` de MapPage).
const REGIONS = ['Grassrivers', 'Port Gellhorn', 'Ambrosia', 'Vice Beach', 'Downtown', 'Ocean Beach', 'Leonida Keys'];

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
    ...REGIONS.map((r) => ({ loc: `/#/mapa?region=${seg(r)}` })),
  ];
  const entities = await safe(() => Entity.find({}).select('_id created_at').limit(20_000).lean().exec());
  for (const e of entities) urls.push({ loc: `/#/catalogo?entity=${seg(e._id)}`, lastmod: e.created_at });
  const threads = await safe(() =>
    ForumThread.find({}).select('_id created_at').sort({ created_at: -1 }).limit(20_000).lean().exec(),
  );
  for (const t of threads) urls.push({ loc: `/#/foro?thread=${seg(t._id)}`, lastmod: t.created_at });
  const news = await safe(() =>
    OfficialNews.find({}).select('slug publishedAt updatedAt').sort({ publishedAt: -1 }).limit(20_000).lean().exec(),
  );
  for (const n of news) urls.push({ loc: `/#/noticias?item=${seg(n.slug)}`, lastmod: n.updatedAt ?? n.publishedAt });
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
