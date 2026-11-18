import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { OfficialNews } from '../models/OfficialNews.js';
import { parse } from '../services/validate.js';

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
    return rows.map((n) => ({
      id: String((n as { _id: unknown })._id),
      title: n.title,
      summary: n.summary,
      sourceUrl: n.sourceUrl,
      source: n.source,
      imageUrl: n.imageUrl ?? null,
      publishedAt: n.publishedAt,
      slug: n.slug,
    }));
  });
}
