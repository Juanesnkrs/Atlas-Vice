import type { FastifyRequest } from 'fastify';
import { AuditLog } from '../models/AuditLog.js';

/** Toda accion administrativa/moderacion deja rastro. */
export async function writeAudit(
  req: FastifyRequest,
  action: string,
  targetType: string,
  targetId: string | null,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  const actor = req.authUser;
  if (!actor) return;
  await AuditLog.create({
    actor_id: actor._id,
    actor_role: actor.rol,
    action,
    target_type: targetType,
    target_id: targetId,
    metadata,
    ip: req.ip,
  });
}
