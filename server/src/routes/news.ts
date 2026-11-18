import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { OfficialNews } from '../models/OfficialNews.js';
import { HttpError, parse } from '../services/validate.js';

const toNewsDTO = (n: {
  _id?: unknown;
  title: string;
  summary: string;
  sourceUrl: string;
  source: string;
  imageUrl?: string | null;
  publishedAt: Date;
  slug: string;
}) => ({
  id: String(n._id),
  title: n.title,
  summary: n.summary,
  sourceUrl: n.sourceUrl,
  source: n.source,
  imageUrl: n.imageUrl ?? null,
  publishedAt: n.publishedAt,
  slug: n.slug,
});

export async function registerNewsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/news', async (req, reply) => {
    const q = parse(
      z.object({
        source: z.enum(['rockstar-newswire', 'rockstar-youtube', 'take-two-ir']).optional(),
        limit: z.coerce.number().int().min(1).max(50).default(12),
      }),
      req.query,
    );
    const rows = await OfficialNews.find(q.source ? { source: q.source } : {})
      .sort({ publishedAt: -1 })
      .limit(q.limit)
      .lean();
    reply.header('cache-control', 'public, max-age=60');
    return rows.map(toNewsDTO);
  });

  app.get('/api/news/:slug', async (req, reply) => {
    const { slug } = parse(z.object({ slug: z.string().min(1).max(200) }), req.params);
    const n = await OfficialNews.findOne({ slug }).lean();
    if (!n) throw new HttpError(404, 'Noticia no encontrada');
    reply.header('cache-control', 'public, max-age=60');
    return toNewsDTO(n);
  });
}
