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

const MAX_TEXT = 500;
const MAX_JSON = 4000;
/** Tope del snapshot serializado de un borrado: por encima solo se conserva el documento raiz. */
export const MAX_SNAPSHOT_BYTES = 8 * 1024 * 1024;

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Politica de tamano de los diffs (Arquitectura §2.10): textos largos truncados, objetos extensos resumidos. */
function capValue(v: unknown): unknown {
  if (typeof v === 'string') return v.length > MAX_TEXT ? `${v.slice(0, MAX_TEXT)}…[+${v.length - MAX_TEXT}]` : v;
  if (v !== null && typeof v === 'object') {
    const len = JSON.stringify(v).length;
    return len > MAX_JSON ? `[valor extenso: ${len} caracteres]` : v;
  }
  return v;
}

/** `{ before, after }` solo con las claves del parche cuyo valor realmente cambia (sin secretos: el llamante solo pasa campos de contenido). */
export function diffFields(before: Record<string, unknown>, patch: Record<string, unknown>): { before: Record<string, unknown>; after: Record<string, unknown> } {
  const b: Record<string, unknown> = {};
  const a: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined || same(before[k], v)) continue;
    b[k] = capValue(before[k] ?? null);
    a[k] = capValue(v);
  }
  return { before: b, after: a };
}

/** Copia JSON pura (Date -> ISO, sin tipos de Mongoose) del documento para guardarlo como `snapshot`. */
export const toSnapshot = <T>(doc: T): Record<string, unknown> => JSON.parse(JSON.stringify(doc)) as Record<string, unknown>;
