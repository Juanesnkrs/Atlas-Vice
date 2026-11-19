import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireRole } from '../plugins/auth.js';
import {
  AppConfig,
  appConfigUpdateSchema,
  DEFAULT_MONETIZATION,
  getGlobalConfig,
  monetizationSchema,
} from '../models/AppConfig.js';
import { Module, type ModuleDoc } from '../models/Module.js';
import { AuditLog } from '../models/AuditLog.js';
import { roleSchema, toPublicUserDTO, toSelfUserDTO, User, type UserDoc } from '../models/User.js';
import { clearSsrCache } from '../services/ssrLite.js';
import { writeAudit } from '../services/audit.js';
import { HttpError, idParamsSchema, parse } from '../services/validate.js';

export async function registerConfigRoutes(app: FastifyInstance): Promise<void> {
  const publicConfig = async (_req: unknown, reply: { header: (k: string, v: string) => unknown }) => {
    const c = await getGlobalConfig();
    const mods = await Module.find({}).sort({ orden: 1 }).lean<ModuleDoc[]>();
    const mon = monetizationSchema.safeParse(c.monetization ?? DEFAULT_MONETIZATION);
    reply.header('cache-control', 'public, max-age=30');
    return {
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
    };
  };
  app.get('/api/config', publicConfig);
  app.get('/api/config/public', publicConfig);

  app.patch('/api/admin/config', { preHandler: requireRole('SUPER_ADMIN') }, async (req) => {
    const patch = parse(appConfigUpdateSchema, req.body);
    await getGlobalConfig();
    const updated = await AppConfig.findOneAndUpdate({ key: 'global' }, { $set: patch }, { returnDocument: 'after' }).lean();
    await writeAudit(req, 'config.update', 'AppConfig', 'global', { patch });
    clearSsrCache();
    return updated;
  });

  app.get('/api/admin/users', { preHandler: requireRole('SUPER_ADMIN') }, async (req) => {
    const q = parse(
      z.object({ limit: z.coerce.number().int().min(1).max(200).default(50), q: z.string().max(80).optional() }),
      req.query,
    );
    const esc = q.q?.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const filter = esc ? { $or: [{ username: new RegExp(esc, 'i') }, { email: q.q!.toLowerCase() }] } : {};
    const users = await User.find(filter).sort({ created_at: -1 }).limit(q.limit).lean<UserDoc[]>();
    return { users: users.map(toSelfUserDTO) };
  });

  app.patch('/api/admin/users/:id/role', { preHandler: requireRole('SUPER_ADMIN') }, async (req) => {
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
    return { user: updated ? toPublicUserDTO(updated) : null };
  });

  app.get('/api/admin/audit-logs', { preHandler: requireRole('SUPER_ADMIN') }, async (req) => {
    const q = parse(
      z.object({
        limit: z.coerce.number().int().min(1).max(200).default(50),
        before: z.coerce.date().optional(),
        actor_id: z.uuid().optional(),
      }),
      req.query,
    );
    const filter: Record<string, unknown> = {};
    if (q.before) filter['created_at'] = { $lt: q.before };
    if (q.actor_id) filter['actor_id'] = q.actor_id;
    const logs = await AuditLog.find(filter).sort({ created_at: -1 }).limit(q.limit).lean();
    return { logs: logs.map((l) => ({ ...l, id: l._id })) };
  });
}
