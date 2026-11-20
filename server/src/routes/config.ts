import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { sendPublicJson } from '../services/httpCache.js';
import { z } from 'zod';
import { requireStaffRole } from '../plugins/auth.js';
import {
  AppConfig,
  appConfigUpdateSchema,
  DEFAULT_MONETIZATION,
  getGlobalConfig,
  monetizationSchema,
} from '../models/AppConfig.js';
import { Module, type ModuleDoc } from '../models/Module.js';
import { AuditLog } from '../models/AuditLog.js';
import { roleSchema, toSelfUserDTO, User, type UserDoc } from '../models/User.js';
import { clearSsrCache } from '../services/ssrLite.js';
import { writeAudit } from '../services/audit.js';
import { HttpError, idParamsSchema, parse } from '../services/validate.js';

/** PATCH de configuracion: sin claves desconocidas y al menos una clave. */
const configPatchSchema = appConfigUpdateSchema
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Se requiere al menos una clave' });

const escapeRx = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const pagesOf = (total: number, limit: number): number => Math.max(1, Math.ceil(total / limit));

export async function registerConfigRoutes(app: FastifyInstance): Promise<void> {
  const publicConfig = async (req: FastifyRequest, reply: FastifyReply) => {
    const c = await getGlobalConfig();
    const mods = await Module.find({}).sort({ orden: 1 }).lean<ModuleDoc[]>();
    const mon = monetizationSchema.safeParse(c.monetization ?? DEFAULT_MONETIZATION);
    return sendPublicJson(req, reply, {
      maintenance_mode: c.maintenance_mode,
      announcement: c.announcement,
      feature_flags: c.feature_flags,
      enabled_auth_providers: c.enabled_auth_providers,
      social_links: c.social_links ?? [],
      monetization: mon.success ? mon.data : monetizationSchema.parse({}),
      modules: mods.map((m) => ({
        id: m._id,
        slug: m.slug,
        nombre: m.nombre,
        icono: m.icono,
        orden: m.orden,
        isActive: m.activo,
      })),
    }, 30);
  };
  app.get('/api/config', publicConfig);
  app.get('/api/config/public', publicConfig);

  app.patch('/api/admin/config', { onRequest: requireStaffRole('SUPER_ADMIN') }, async (req) => {
    const patch = parse(configPatchSchema, req.body);
    await getGlobalConfig();
    const updated = await AppConfig.findOneAndUpdate({ key: 'global' }, { $set: patch }, { returnDocument: 'after' }).lean();
    await writeAudit(req, 'config.update', 'AppConfig', 'global', { patch });
    clearSsrCache();
    return updated;
  });

  app.get('/api/admin/users', { onRequest: requireStaffRole('SUPER_ADMIN') }, async (req) => {
    const q = parse(
      z.object({
        limit: z.coerce.number().int().min(1).max(100).default(25),
        page: z.coerce.number().int().min(1).max(10_000).default(1),
        q: z.string().trim().max(80).optional(),
        rol: roleSchema.optional(),
      }),
      req.query,
    );
    const filter: Record<string, unknown> = {};
    if (q.q) {
      const rx = new RegExp(escapeRx(q.q), 'i');
      filter.$or = [{ username: rx }, { email: rx }];
    }
    if (q.rol) filter.rol = q.rol;
    const [total, users] = await Promise.all([
      User.countDocuments(filter),
      User.find(filter)
        .sort({ created_at: -1, _id: 1 })
        .skip((q.page - 1) * q.limit)
        .limit(q.limit)
        .lean<UserDoc[]>(),
    ]);
    return {
      users: users.map((u) => ({ ...toSelfUserDTO(u), sessions_revoked_at: u.sessions_revoked_at?.toISOString() ?? null })),
      total,
      page: q.page,
      pages: pagesOf(total, q.limit),
    };
  });

  app.patch('/api/admin/users/:id/role', { onRequest: requireStaffRole('SUPER_ADMIN') }, async (req) => {
    const { id } = parse(idParamsSchema, req.params);
    const { rol } = parse(z.object({ rol: roleSchema }), req.body);
    const target = await User.findById(id).lean<UserDoc>();
    if (!target) throw new HttpError(404, 'Usuario no encontrado');
    if (target.rol === 'SUPER_ADMIN' && rol !== 'SUPER_ADMIN') {
      const supers = await User.countDocuments({ rol: 'SUPER_ADMIN' });
      if (supers <= 1) throw new HttpError(409, 'No se puede degradar al ultimo SUPER_ADMIN');
    }
    const updated = await User.findByIdAndUpdate(id, { $set: { rol } }, { returnDocument: 'after' }).lean<UserDoc>();
    await writeAudit(req, 'user.role.update', 'User', id, { from: target.rol, to: rol });
    return { user: updated ? toSelfUserDTO(updated) : null };
  });

  /** Revoca todas las sesiones emitidas hasta ahora: el usuario debera iniciar sesion de nuevo. */
  app.post('/api/admin/users/:id/revoke-sessions', { onRequest: requireStaffRole('SUPER_ADMIN') }, async (req) => {
    const { id } = parse(idParamsSchema, req.params);
    const at = new Date();
    const updated = await User.findByIdAndUpdate(id, { $set: { sessions_revoked_at: at } }, { returnDocument: 'after' }).lean<UserDoc>();
    if (!updated) throw new HttpError(404, 'Usuario no encontrado');
    await writeAudit(req, 'user.sessions.revoke', 'User', id, { username: updated.username });
    return { revoked_at: at.toISOString() };
  });

  app.get('/api/admin/audit-logs', { onRequest: requireStaffRole('SUPER_ADMIN') }, async (req) => {
    const q = parse(
      z.object({
        limit: z.coerce.number().int().min(1).max(100).default(25),
        page: z.coerce.number().int().min(1).max(10_000).default(1),
        actor_id: z.uuid().optional(),
        action: z.string().trim().max(60).optional(), // prefijo: "config" o "user.role"
        target_type: z.string().trim().max(40).optional(),
        from: z.coerce.date().optional(),
        to: z.coerce.date().optional(),
      }),
      req.query,
    );
    const filter: Record<string, unknown> = {};
    if (q.actor_id) filter['actor_id'] = q.actor_id;
    if (q.action) filter['action'] = new RegExp('^' + escapeRx(q.action));
    if (q.target_type) filter['target_type'] = q.target_type;
    if (q.from || q.to) filter['created_at'] = { ...(q.from ? { $gte: q.from } : {}), ...(q.to ? { $lte: q.to } : {}) };
    const [total, logs, actions, targetTypes] = await Promise.all([
      AuditLog.countDocuments(filter),
      AuditLog.find(filter)
        .sort({ created_at: -1, _id: 1 })
        .skip((q.page - 1) * q.limit)
        .limit(q.limit)
        .lean(),
      AuditLog.distinct('action'),
      AuditLog.distinct('target_type'),
    ]);
    const actors = await User.find({ _id: { $in: [...new Set(logs.map((l) => l.actor_id))] } })
      .select('username')
      .lean<Array<{ _id: string; username: string }>>();
    const names = new Map(actors.map((a) => [a._id, a.username]));
    return {
      logs: logs.map((l) => ({ ...l, id: l._id, actor_name: names.get(l.actor_id) ?? (l.actor_id === 'system' ? 'system' : null) })),
      total,
      page: q.page,
      pages: pagesOf(total, q.limit),
      facets: { actions: actions.sort(), targetTypes: targetTypes.sort() },
    };
  });
}
