import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../plugins/auth.js';
import { progressBatchSchema, toProgressDTO, UserProgress, type UserProgressDoc } from '../models/UserProgress.js';
import { parse } from '../services/validate.js';

export async function registerProgressRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/progress', { preHandler: requireAuth }, async (req) => {
    const rows = await UserProgress.find({ user_id: req.authUser?._id }).lean<UserProgressDoc[]>();
    return { items: rows.map(toProgressDTO) };
  });

  /** Sincronizacion batch con last-write-wins por `updated_at`; devuelve el estado fusionado. */
  app.put('/api/progress', { preHandler: requireAuth }, async (req) => {
    const userId = req.authUser?._id ?? '';
    const { items } = parse(progressBatchSchema, req.body);
    const now = new Date();
    for (const it of items) {
      const at = it.updated_at && it.updated_at <= now ? it.updated_at : now;
      const filter = { user_id: userId, target_type: it.target_type, target_id: it.target_id };
      const existing = await UserProgress.findOne(filter).lean<UserProgressDoc>();
      if (existing && existing.updated_at >= at) continue;
      await UserProgress.updateOne(
        filter,
        { $set: { completado: it.completado, updated_at: at } },
        { upsert: true },
      ).catch((err: { code?: number }) => {
        if (err.code !== 11000) throw err; // carrera: otro request inserto antes
      });
    }
    const rows = await UserProgress.find({ user_id: userId }).lean<UserProgressDoc[]>();
    return { items: rows.map(toProgressDTO) };
  });
}
