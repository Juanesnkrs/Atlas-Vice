import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireStaffRole } from '../plugins/auth.js';
import { AuditLog, type AuditLogDoc } from '../models/AuditLog.js';
import { Entity } from '../models/Entity.js';
import { ForumPost } from '../models/ForumPost.js';
import { ForumThread } from '../models/ForumThread.js';
import { ForumVote } from '../models/ForumVote.js';
import { MapMarker } from '../models/MapMarker.js';
import { Module, type ModuleDoc } from '../models/Module.js';
import { Submission } from '../models/Submission.js';
import { ROLE_RANK, User } from '../models/User.js';
import { restoreFromAudit } from '../services/restore.js';
import { HttpError, idParamsSchema, parse, resourceNotFound } from '../services/validate.js';
import { getNewsWorkerStatus } from '../workers/officialNewsWorker.js';

const NO_STORE = 'private, no-store';

/** Mismo error que lanza `requireStaffRole`: 404 uniforme, sin `code`. */
const uniformNotFound = (): HttpError => new HttpError(404, 'No encontrado');

export async function registerAdminPanelRoutes(app: FastifyInstance): Promise<void> {
  const moderation = { onRequest: requireStaffRole('MODERATOR') };
  const superAdmin = { onRequest: requireStaffRole('SUPER_ADMIN') };

  /** Resumen Operativo: pantalla de entrada de /_staff, filtrada por rol. */
  app.get('/api/admin/overview', moderation, async (req, reply) => {
    void reply.header('Cache-Control', NO_STORE);
    const actor = req.authUser!;
    const isAdmin = ROLE_RANK[actor.rol] >= ROLE_RANK.ADMIN;
    const isSuper = actor.rol === 'SUPER_ADMIN';

    const pendingMatch: Record<string, unknown> = { status: 'pending' };
    if (!isAdmin) pendingMatch['type'] = { $nin: ['contact', 'newsletter'] };
    const [pendingRows, auditRows] = await Promise.all([
      Submission.aggregate<{ _id: string; count: number; oldestAt: Date }>([
        { $match: pendingMatch },
        { $group: { _id: '$type', count: { $sum: 1 }, oldestAt: { $min: '$createdAt' } } },
      ]),
      AuditLog.find(isSuper ? {} : { actor_id: actor._id })
        .sort({ created_at: -1, _id: 1 })
        .limit(10)
        .select('-metadata')
        .lean<AuditLogDoc[]>(),
    ]);
    const names = new Map(
      (
        await User.find({ _id: { $in: [...new Set(auditRows.map((l) => l.actor_id))] } })
          .select('username')
          .lean<Array<{ _id: string; username: string }>>()
      ).map((u) => [u._id, u.username]),
    );
    const oldest = pendingRows.reduce<Date | null>((a, r) => (a === null || r.oldestAt < a ? r.oldestAt : a), null);

    const base = {
      role: actor.rol,
      pending: {
        total: pendingRows.reduce((n, r) => n + r.count, 0),
        oldestAt: oldest?.toISOString() ?? null,
        byType: pendingRows
          .map((r) => ({ type: r._id, count: r.count, oldestAt: r.oldestAt.toISOString() }))
          .sort((a, b) => a.type.localeCompare(b.type)),
      },
      audit: auditRows.map((l) => ({
        id: l._id,
        action: l.action,
        target_type: l.target_type,
        target_id: l.target_id,
        actor_id: l.actor_id,
        actor_name: names.get(l.actor_id) ?? (l.actor_id === 'system' ? 'system' : null),
        created_at: l.created_at.toISOString(),
      })),
    };
    if (!isAdmin) return base;

    const w = getNewsWorkerStatus();
    const mapMod = await Module.findOne({ slug: 'mapa' }).select('_id').lean<{ _id: string }>();
    const pinned = await MapMarker.distinct('entity_id', { entity_id: { $type: 'string' } });
    const [coverage, modules, markersTotal, markersWithoutEntity, mapWithoutPin] = await Promise.all([
      Entity.aggregate<{ _id: string; count: number }>([{ $group: { _id: '$module_id', count: { $sum: 1 } } }]),
      Module.find({}).sort({ orden: 1 }).lean<ModuleDoc[]>(),
      MapMarker.estimatedDocumentCount(),
      MapMarker.countDocuments({ $or: [{ entity_id: null }, { entity_id: { $exists: false } }] }),
      mapMod ? Entity.countDocuments({ module_id: mapMod._id, _id: { $nin: pinned } }) : Promise.resolve(0),
    ]);
    const perModule = new Map(coverage.map((c) => [c._id, c.count]));
    const errors = w.lastResults.filter((r) => r.error).map((r) => ({ source: r.source, error: r.error }));
    return {
      ...base,
      worker: {
        enabled: w.enabled,
        running: w.running,
        lastFinishedAt: w.lastFinishedAt,
        nextRunAt: w.nextRunAt,
        sources: w.sources.length,
        lastErrors: errors,
        ranSinceBoot: w.lastFinishedAt !== null,
      },
      catalog: modules.map((m) => ({ module_id: m._id, slug: m.slug, nombre: m.nombre, activo: m.activo, entities: perModule.get(m._id) ?? 0 })),
      pins: { total: markersTotal, withoutEntity: markersWithoutEntity, mapEntitiesWithoutPin: mapWithoutPin },
    };
  });

  /** Dependientes de un objeto antes de borrarlo (confirmacion segura del panel). */
  app.get('/api/admin/dependents/:type/:id', moderation, async (req, reply) => {
    void reply.header('Cache-Control', NO_STORE);
    const { type, id } = parse(z.object({ type: z.enum(['thread', 'entity', 'marker', 'module']), id: z.uuid() }), req.params);
    // El hilo es de moderacion; el resto de objetos son de contenido (ADMIN+): para MODERATOR, 404 uniforme.
    if (type !== 'thread' && ROLE_RANK[req.authUser!.rol] < ROLE_RANK.ADMIN) throw uniformNotFound();
    if (type === 'thread') {
      const t = await ForumThread.findById(id).select('titulo').lean<{ titulo: string }>();
      if (!t) throw resourceNotFound('Hilo no encontrado');
      const postIds = (await ForumPost.find({ thread_id: id }).select('_id').lean<Array<{ _id: string }>>()).map((p) => p._id);
      const votes = await ForumVote.countDocuments({
        $or: [{ target_type: 'THREAD', target_id: id }, { target_type: 'POST', target_id: { $in: postIds } }],
      });
      return { type, id, replies: postIds.length, votes };
    }
    if (type === 'entity') {
      if (!(await Entity.exists({ _id: id }))) throw resourceNotFound('Entidad no encontrada');
      const markers = await MapMarker.find({ entity_id: id }).select('titulo').lean<Array<{ _id: string; titulo: string }>>();
      const threads = await ForumThread.countDocuments({ entity_id: id });
      return { type, id, markers: markers.map((m) => ({ id: m._id, titulo: m.titulo })), threads };
    }
    if (type === 'marker') {
      const m = await MapMarker.findById(id).select('entity_id').lean<{ entity_id?: string | null }>();
      if (!m) throw resourceNotFound('Marcador no encontrado');
      return { type, id, threads: await ForumThread.countDocuments({ marker_id: id }) };
    }
    if (!(await Module.exists({ _id: id }))) throw resourceNotFound('Modulo no encontrado');
    return { type, id, entities: await Entity.countDocuments({ module_id: id }) };
  });

  /** Historial de un objeto. SUPER_ADMIN ve todo; el resto solo sus propias entradas y sin snapshot. */
  app.get('/api/admin/history', moderation, async (req, reply) => {
    void reply.header('Cache-Control', NO_STORE);
    const q = parse(
      z.object({
        target_type: z.string().trim().min(1).max(40),
        target_id: z.string().trim().min(1).max(80),
        limit: z.coerce.number().int().min(1).max(50).default(20),
      }),
      req.query,
    );
    const isSuper = req.authUser!.rol === 'SUPER_ADMIN';
    const rows = await AuditLog.find({ target_type: q.target_type, target_id: q.target_id, ...(isSuper ? {} : { actor_id: req.authUser!._id }) })
      .sort({ created_at: -1, _id: 1 })
      .limit(q.limit)
      .lean<AuditLogDoc[]>();
    const names = new Map(
      (
        await User.find({ _id: { $in: [...new Set(rows.map((l) => l.actor_id))] } })
          .select('username')
          .lean<Array<{ _id: string; username: string }>>()
      ).map((u) => [u._id, u.username]),
    );
    return {
      scope: isSuper ? 'all' : 'own',
      logs: rows.map((l) => {
        const { snapshot: _snapshot, ...metadata } = l.metadata;
        return {
          id: l._id,
          action: l.action,
          actor_id: l.actor_id,
          actor_name: names.get(l.actor_id) ?? (l.actor_id === 'system' ? 'system' : null),
          metadata,
          created_at: l.created_at.toISOString(),
        };
      }),
    };
  });

  app.post('/api/admin/audit-logs/:id/restore', superAdmin, async (req, reply) => {
    void reply.header('Cache-Control', NO_STORE);
    const { id } = parse(idParamsSchema, req.params);
    const actor = req.authUser!;
    const restored = await restoreFromAudit(id, { id: actor._id, role: actor.rol, ip: req.ip });
    return reply.code(201).send({ restored });
  });
}
