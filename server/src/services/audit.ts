import type { FastifyRequest } from 'fastify';
import type { ClientSession } from 'mongoose';
import { AuditLog } from '../models/AuditLog.js';

export interface AuditEntry {
  actor_id: string;
  actor_role: string;
  action: string;
  target_type: string;
  target_id: string | null;
  metadata?: Record<string, unknown>;
  ip?: string | null;
}

/** Insercion directa (acciones automaticas con actor 'system'). Inmutable: solo insert. */
export async function writeAuditEntry(entry: AuditEntry, session?: ClientSession | null): Promise<void> {
  await AuditLog.create(
    [{ ...entry, metadata: entry.metadata ?? {}, ip: entry.ip ?? null }],
    session ? { session } : undefined,
  );
}

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
  await writeAuditEntry({
    actor_id: actor._id,
    actor_role: actor.rol,
    action,
    target_type: targetType,
    target_id: targetId,
    metadata,
    ip: req.ip,
  });
}
