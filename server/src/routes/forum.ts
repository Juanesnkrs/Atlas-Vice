import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth, requireStaffRole } from '../plugins/auth.js';
import { ForumPost, forumPostSchema, toPostDTO, type ForumPostDoc } from '../models/ForumPost.js';
import { ForumThread, forumThreadSchema, toThreadDTO, type ForumThreadDoc } from '../models/ForumThread.js';
import { ForumVote, forumVoteSchema } from '../models/ForumVote.js';
import { toPublicUserDTO, User, type UserDoc } from '../models/User.js';
import { writeAudit } from '../services/audit.js';
import { clearSsrCache } from '../services/ssrLite.js';
import { HttpError, idParamsSchema, parse } from '../services/validate.js';

export async function registerForumRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Hilos + respuestas + autores (forma `ForumData` del cliente).
   * Sin sesion: solo lista en vivo en formato preview (sin `contenido` ni `posts`), 50 max,
   * ignorando filtros (DesignSpec 7.5). Con sesion: respuesta completa + `replies_count`.
   */
  app.get('/api/forum', async (req, reply) => {
    void reply.header('Cache-Control', 'no-store').header('Vary', 'Cookie');
    const preview = req.authUser === null;
    const threads = preview
      ? await ForumThread.find().select('-contenido').sort({ created_at: -1 }).limit(50).lean<ForumThreadDoc[]>()
      : await ForumThread.find().sort({ is_pinned: -1, created_at: -1 }).limit(500).lean<ForumThreadDoc[]>();
    const [posts, counts] = await Promise.all([
      preview
        ? Promise.resolve<ForumPostDoc[]>([])
        : ForumPost.find().sort({ created_at: 1 }).limit(5000).lean<ForumPostDoc[]>(),
      ForumPost.aggregate<{ _id: string; n: number }>([
        { $match: { thread_id: { $in: threads.map((t) => t._id) } } },
        { $group: { _id: '$thread_id', n: { $sum: 1 } } },
      ]),
    ]);
    const replies = new Map(counts.map((c) => [c._id, c.n]));
    const authorIds = [...new Set([...threads.map((t) => t.user_id), ...posts.map((p) => p.user_id)])];
    const users = await User.find({ _id: { $in: authorIds } }).lean<UserDoc[]>();
    const withReplies = (t: ForumThreadDoc) => ({ ...toThreadDTO(t), replies_count: replies.get(t._id) ?? 0 });
    if (preview) {
      return {
        preview: true as const,
        threads: threads.map((t) => {
          const { contenido: _omit, ...rest } = withReplies(t);
          return rest;
        }),
        posts: [],
        profiles: users.map(toPublicUserDTO),
      };
    }
    return {
      preview: false as const,
      threads: threads.map(withReplies),
      posts: posts.map(toPostDTO),
      profiles: users.map(toPublicUserDTO),
    };
  });

  app.get('/api/forum/votes', { preHandler: requireAuth }, async (req) => {
    const votes = await ForumVote.find({ user_id: req.authUser?._id }).lean();
    return { votes: votes.map((v) => ({ target_type: v.target_type, target_id: v.target_id })) };
  });

  const write = { preHandler: requireAuth, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } };

  app.post('/api/forum/threads', write, async (req, reply) => {
    const { id, ...body } = parse(forumThreadSchema, req.body);
    const doc = await ForumThread.create({ ...body, ...(id ? { _id: id } : {}), user_id: req.authUser?._id });
    clearSsrCache();
    return reply.code(201).send(toThreadDTO(doc.toObject()));
  });

  app.post('/api/forum/posts', write, async (req, reply) => {
    const { id, ...body } = parse(forumPostSchema, req.body);
    const thread = await ForumThread.findById(body.thread_id).select('is_locked').lean<{ is_locked?: boolean }>();
    if (!thread) throw new HttpError(422, 'thread_id inexistente');
    if (thread.is_locked) throw new HttpError(409, 'Este hilo esta cerrado: no admite mas respuestas');
    if (body.parent_post_id) {
      const parent = await ForumPost.exists({ _id: body.parent_post_id, thread_id: body.thread_id });
      if (!parent) throw new HttpError(422, 'parent_post_id inexistente en este hilo');
    }
    const doc = await ForumPost.create({ ...body, ...(id ? { _id: id } : {}), user_id: req.authUser?._id });
    clearSsrCache();
    return reply.code(201).send(toPostDTO(doc.toObject()));
  });

  /** Alterna el voto unico del usuario y mantiene `upvotes_count`. */
  app.post('/api/forum/votes/toggle', write, async (req) => {
    const v = parse(forumVoteSchema, req.body);
    const userId = req.authUser?._id ?? '';
    const exists =
      v.target_type === 'THREAD'
        ? await ForumThread.exists({ _id: v.target_id })
        : await ForumPost.exists({ _id: v.target_id });
    if (!exists) throw new HttpError(404, 'Objetivo no encontrado');

    const filter = { user_id: userId, target_type: v.target_type, target_id: v.target_id };
    const removed = await ForumVote.findOneAndDelete(filter);
    let delta = removed ? -1 : 0;
    const voted = !removed;
    if (!removed) {
      try {
        await ForumVote.create(filter);
        delta = 1;
      } catch (err) {
        if ((err as { code?: number }).code !== 11000) throw err; // carrera: ya existia
      }
    }
    const inc = { $inc: { upvotes_count: delta } };
    const updated: { upvotes_count: number } | null =
      v.target_type === 'THREAD'
        ? await ForumThread.findByIdAndUpdate(v.target_id, inc, { returnDocument: 'after' }).lean<ForumThreadDoc>()
        : await ForumPost.findByIdAndUpdate(v.target_id, inc, { returnDocument: 'after' }).lean<ForumPostDoc>();
    return { voted, upvotes_count: Math.max(0, updated?.upvotes_count ?? 0) };
  });

  // ---- Moderacion (MODERATOR+) -------------------------------------------------
  // 404 uniforme (hook onRequest, antes de Zod) para quien no sea MODERATOR+: no revela que la ruta existe.
  const mod = { onRequest: requireStaffRole('MODERATOR') };

  app.delete('/api/forum/threads/:id', mod, async (req, reply) => {
    const { id } = parse(idParamsSchema, req.params);
    const t = await ForumThread.findByIdAndDelete(id).lean<ForumThreadDoc>();
    if (!t) throw new HttpError(404, 'Hilo no encontrado');
    const posts = await ForumPost.find({ thread_id: id }, { _id: 1 }).lean<Array<{ _id: string }>>();
    const postIds = posts.map((p) => p._id);
    await Promise.all([
      ForumPost.deleteMany({ thread_id: id }),
      ForumVote.deleteMany({ $or: [{ target_type: 'THREAD', target_id: id }, { target_type: 'POST', target_id: { $in: postIds } }] }),
    ]);
    clearSsrCache();
    await writeAudit(req, 'forum.thread.delete', 'ForumThread', id, { titulo: t.titulo, author: t.user_id });
    return reply.code(204).send();
  });

  app.delete('/api/forum/posts/:id', mod, async (req, reply) => {
    const { id } = parse(idParamsSchema, req.params);
    const p = await ForumPost.findByIdAndDelete(id).lean<ForumPostDoc>();
    if (!p) throw new HttpError(404, 'Respuesta no encontrada');
    await ForumVote.deleteMany({ target_type: 'POST', target_id: id });
    clearSsrCache();
    await writeAudit(req, 'forum.post.delete', 'ForumPost', id, { author: p.user_id });
    return reply.code(204).send();
  });

  app.patch('/api/forum/threads/:id/pin', mod, async (req) => {
    const { id } = parse(idParamsSchema, req.params);
    const { is_pinned } = parse(z.object({ is_pinned: z.boolean() }), req.body);
    const t = await ForumThread.findByIdAndUpdate(id, { $set: { is_pinned } }, { returnDocument: 'after' }).lean<ForumThreadDoc>();
    if (!t) throw new HttpError(404, 'Hilo no encontrado');
    await writeAudit(req, 'forum.thread.pin', 'ForumThread', id, { is_pinned });
    return toThreadDTO(t);
  });
}
