import type { FastifyInstance } from 'fastify';
import mongoose from 'mongoose';
import { z } from 'zod';
import { requireStaffRole } from '../plugins/auth.js';
import { ForumPost, toPostDTO, type ForumPostDoc } from '../models/ForumPost.js';
import { FORUM_CATEGORIES, ForumThread, toThreadDTO, type ForumThreadDoc } from '../models/ForumThread.js';
import { OfficialNews } from '../models/OfficialNews.js';
import { toPublicUserDTO, User, type UserDoc } from '../models/User.js';
import { writeAudit } from '../services/audit.js';
import { clearSsrCache, ssrCacheSize } from '../services/ssrLite.js';
import { HttpError, idParamsSchema, parse } from '../services/validate.js';
import { getNewsWorkerStatus, runOfficialNewsIngest } from '../workers/officialNewsWorker.js';

const escapeRx = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Colecciones aprobadas (docs/LeonidApp-Arquitectura-Datos-MongoDB.md §2) mas las auxiliares ya existentes. */
const COLLECTIONS = [
  'users',
  'appconfigs',
  'modules',
  'entities',
  'mapmarkers',
  'submissions',
  'userprogresses',
  'forumthreads',
  'forumposts',
  'forumvotes',
  'auditlogs',
  'officialnews',
] as const;

const threadPatchSchema = z
  .object({
    is_pinned: z.boolean(),
    is_locked: z.boolean(),
    is_spoiler: z.boolean(),
    categoria: z.enum(FORUM_CATEGORIES),
    titulo: z.string().trim().min(3).max(160),
    contenido: z.string().trim().min(1).max(10000),
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Se requiere al menos una clave' });

export async function registerAdminRoutes(app: FastifyInstance): Promise<void> {
  const moderation = { onRequest: requireStaffRole('MODERATOR') };
  const admin = { onRequest: requireStaffRole('ADMIN') };
  const superAdmin = { onRequest: requireStaffRole('SUPER_ADMIN') };

  // ---- Foro (MODERATOR+) ------------------------------------------------------
  app.get('/api/admin/forum/threads', moderation, async (req, reply) => {
    void reply.header('Cache-Control', 'private, no-store');
    const q = parse(
      z.object({
        q: z.string().trim().min(1).max(80).optional(),
        categoria: z.enum(FORUM_CATEGORIES).optional(),
        limit: z.coerce.number().int().min(1).max(50).default(20),
        page: z.coerce.number().int().min(1).max(10_000).default(1),
      }),
      req.query,
    );
    const filter: Record<string, unknown> = {};
    if (q.categoria) filter.categoria = q.categoria;
    if (q.q) filter.titulo = new RegExp(escapeRx(q.q), 'i');
    const [total, threads] = await Promise.all([
      ForumThread.countDocuments(filter),
      ForumThread.find(filter)
        .sort({ is_pinned: -1, created_at: -1, _id: 1 })
        .skip((q.page - 1) * q.limit)
        .limit(q.limit)
        .lean<ForumThreadDoc[]>(),
    ]);
    const counts = await ForumPost.aggregate<{ _id: string; n: number }>([
      { $match: { thread_id: { $in: threads.map((t) => t._id) } } },
      { $group: { _id: '$thread_id', n: { $sum: 1 } } },
    ]);
    const replies = new Map(counts.map((c) => [c._id, c.n]));
    const users = await User.find({ _id: { $in: [...new Set(threads.map((t) => t.user_id))] } }).lean<UserDoc[]>();
    return {
      threads: threads.map((t) => ({ ...toThreadDTO(t), replies_count: replies.get(t._id) ?? 0 })),
      profiles: users.map(toPublicUserDTO),
      total,
      page: q.page,
      pages: Math.max(1, Math.ceil(total / q.limit)),
    };
  });

  app.get('/api/admin/forum/threads/:id', moderation, async (req, reply) => {
    void reply.header('Cache-Control', 'private, no-store');
    const { id } = parse(idParamsSchema, req.params);
    const thread = await ForumThread.findById(id).lean<ForumThreadDoc>();
    if (!thread) throw new HttpError(404, 'Hilo no encontrado');
    const posts = await ForumPost.find({ thread_id: id }).sort({ created_at: 1 }).limit(500).lean<ForumPostDoc[]>();
    const users = await User.find({ _id: { $in: [...new Set([thread.user_id, ...posts.map((p) => p.user_id)])] } }).lean<UserDoc[]>();
    return { thread: toThreadDTO(thread), posts: posts.map(toPostDTO), profiles: users.map(toPublicUserDTO) };
  });

  app.patch('/api/admin/forum/threads/:id', moderation, async (req) => {
    const { id } = parse(idParamsSchema, req.params);
    const patch = parse(threadPatchSchema, req.body);
    const t = await ForumThread.findByIdAndUpdate(id, { $set: patch }, { returnDocument: 'after' }).lean<ForumThreadDoc>();
    if (!t) throw new HttpError(404, 'Hilo no encontrado');
    await writeAudit(req, 'forum.thread.update', 'ForumThread', id, { patch: { ...patch, contenido: patch.contenido === undefined ? undefined : '[editado]' } });
    clearSsrCache();
    return toThreadDTO(t);
  });

  app.patch('/api/admin/forum/posts/:id', moderation, async (req) => {
    const { id } = parse(idParamsSchema, req.params);
    const { contenido } = parse(z.object({ contenido: z.string().trim().min(1).max(10000) }).strict(), req.body);
    const p = await ForumPost.findByIdAndUpdate(id, { $set: { contenido } }, { returnDocument: 'after' }).lean<ForumPostDoc>();
    if (!p) throw new HttpError(404, 'Respuesta no encontrada');
    await writeAudit(req, 'forum.post.update', 'ForumPost', id, {});
    clearSsrCache();
    return toPostDTO(p);
  });

  // ---- Worker de noticias oficiales (ADMIN+) ---------------------------------
  app.get('/api/admin/news/status', admin, async (_req, reply) => {
    void reply.header('Cache-Control', 'private, no-store');
    const rows = await OfficialNews.aggregate<{ _id: string; count: number; lastPublishedAt: Date; lastIngestedAt: Date }>([
      { $group: { _id: '$source', count: { $sum: 1 }, lastPublishedAt: { $max: '$publishedAt' }, lastIngestedAt: { $max: '$createdAt' } } },
    ]);
    const bySource = new Map(rows.map((r) => [r._id, r]));
    const worker = getNewsWorkerStatus();
    return {
      worker,
      sources: worker.sources.map((s) => ({
        ...s,
        count: bySource.get(s.id)?.count ?? 0,
        lastPublishedAt: bySource.get(s.id)?.lastPublishedAt?.toISOString() ?? null,
        lastIngestedAt: bySource.get(s.id)?.lastIngestedAt?.toISOString() ?? null,
      })),
      total: rows.reduce((a, r) => a + r.count, 0),
    };
  });

  app.post(
    '/api/admin/news/sync',
    { ...admin, config: { rateLimit: { max: 6, timeWindow: '10 minutes' } } },
    async (req, reply) => {
      if (getNewsWorkerStatus().running) throw new HttpError(409, 'Ya hay una sincronizacion en curso');
      void runOfficialNewsIngest('manual');
      await writeAudit(req, 'news.sync.manual', 'OfficialNews', null, {});
      return reply.code(202).send({ started: true });
    },
  );

  // ---- Salud y cache (SUPER_ADMIN) --------------------------------------------
  app.get('/api/admin/health', superAdmin, async (_req, reply) => {
    void reply.header('Cache-Control', 'private, no-store');
    const db = mongoose.connection.db;
    if (!db) throw new HttpError(503, 'MongoDB no disponible');
    const t0 = performance.now();
    await db.command({ ping: 1 });
    const pingMs = Math.round((performance.now() - t0) * 10) / 10;
    const [stats, counts] = await Promise.all([
      db.stats(),
      Promise.all(COLLECTIONS.map(async (name) => ({ name, count: await db.collection(name).estimatedDocumentCount() }))),
    ]);
    const mem = process.memoryUsage();
    return {
      status: 'ok',
      checkedAt: new Date().toISOString(),
      mongo: {
        ok: true,
        pingMs,
        db: db.databaseName,
        readyState: mongoose.connection.readyState,
        dataSizeKB: Math.round(stats.dataSize / 1024),
        storageSizeKB: Math.round(stats.storageSize / 1024),
        collections: counts,
      },
      process: {
        node: process.version,
        uptimeS: Math.round(process.uptime()),
        rssMB: Math.round(mem.rss / 1048576),
        heapUsedMB: Math.round(mem.heapUsed / 1048576),
      },
      worker: getNewsWorkerStatus(),
      cache: {
        ssrEntries: ssrCacheSize(),
        publicJson: 'ETag debil + Cache-Control public (30-60 s) con revalidacion',
        compression: 'br/gzip a partir de 1 KB',
      },
    };
  });

  app.post('/api/admin/cache/clear', superAdmin, async (req) => {
    const before = ssrCacheSize();
    clearSsrCache();
    await writeAudit(req, 'cache.clear', 'SsrCache', null, { entries: before });
    return { cleared: before };
  });
}
