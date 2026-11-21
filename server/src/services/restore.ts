import type { ClientSession } from 'mongoose';
import { AuditLog, type AuditLogDoc } from '../models/AuditLog.js';
import { Entity } from '../models/Entity.js';
import { ForumPost } from '../models/ForumPost.js';
import { ForumThread } from '../models/ForumThread.js';
import { ForumVote } from '../models/ForumVote.js';
import { MapMarker } from '../models/MapMarker.js';
import { Module } from '../models/Module.js';
import { writeAuditEntry } from './audit.js';
import { clearSsrCache } from './ssrLite.js';
import { runAtomic } from './submissions.js';
import { HttpError, resourceNotFound } from './validate.js';

/** Borrados con `snapshot` restaurable -> tipo de objeto y accion de restauracion (Arquitectura §2.10). */
const KINDS = {
  'entity.delete': { type: 'Entity', restore: 'entity.restore' },
  'module.delete': { type: 'Module', restore: 'module.restore' },
  'marker.delete': { type: 'MapMarker', restore: 'marker.restore' },
  'forum.thread.delete': { type: 'ForumThread', restore: 'forum.thread.restore' },
} as const;
type DeleteAction = keyof typeof KINDS;

const isDeleteAction = (a: string): a is DeleteAction => a in KINDS;

type Snap = Record<string, unknown>;
const asSnap = (v: unknown): Snap | null => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Snap) : null);
const withDate = (s: Snap): Snap => ({ ...s, ...(typeof s['created_at'] === 'string' ? { created_at: new Date(s['created_at']) } : {}) });

/** ¿Esta entrada de borrado se puede restaurar? (tiene snapshot completo). */
export function isRestorable(log: Pick<AuditLogDoc, 'action' | 'metadata'>): boolean {
  return isDeleteAction(log.action) && asSnap(log.metadata['snapshot']) !== null && log.metadata['snapshot_truncated'] !== true;
}

/** Subconjunto de `ids` que ya tiene su entrada `*.restore`. */
export async function restoredSet(ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await AuditLog.find({ action: { $regex: /\.restore$/ }, 'metadata.restored_from': { $in: ids } })
    .select('metadata.restored_from')
    .lean<Array<{ metadata: { restored_from: string } }>>();
  return new Set(rows.map((r) => r.metadata.restored_from));
}

const conflict = (msg: string): HttpError => new HttpError(409, msg, undefined, 'RESTORE_CONFLICT');

async function insertSnapshot(action: DeleteAction, snapshot: Snap, session: ClientSession | null): Promise<{ id: string; titulo?: string }> {
  const opts = session ? { session } : {};
  if (action === 'forum.thread.delete') {
    const thread = asSnap(snapshot['thread']);
    if (!thread) throw conflict('Snapshot incompleto');
    const posts = (Array.isArray(snapshot['posts']) ? snapshot['posts'] : []).map((p) => withDate(asSnap(p) ?? {}));
    const votes = (Array.isArray(snapshot['votes']) ? snapshot['votes'] : []).map((v) => withDate(asSnap(v) ?? {}));
    await ForumThread.create([withDate(thread)], opts);
    if (posts.length) await ForumPost.insertMany(posts, opts);
    if (votes.length) await ForumVote.insertMany(votes, opts);
    return { id: String(thread['_id']), titulo: String(thread['titulo'] ?? '') };
  }
  const doc = withDate(snapshot);
  if (action === 'entity.delete') await Entity.create([doc], opts);
  else if (action === 'module.delete') await Module.create([doc], opts);
  else await MapMarker.create([doc], opts);
  return { id: String(snapshot['_id']), titulo: String(snapshot['titulo'] ?? snapshot['nombre'] ?? '') };
}

/** Comprobaciones previas: nada se escribe si hay conflicto (409 con motivo). */
async function assertFree(action: DeleteAction, snapshot: Snap): Promise<void> {
  const id = String(snapshot['_id'] ?? (asSnap(snapshot['thread'])?.['_id'] ?? ''));
  if (!id) throw conflict('Snapshot sin identificador');
  if (action === 'entity.delete') {
    if (await Entity.exists({ _id: id })) throw conflict('Ya existe una ficha con ese identificador');
    if (await Entity.exists({ module_id: String(snapshot['module_id']), slug: String(snapshot['slug']) })) {
      throw conflict(`Ya existe una ficha con el slug «${String(snapshot['slug'])}» en ese modulo`);
    }
    if (!(await Module.exists({ _id: String(snapshot['module_id']) }))) throw conflict('El modulo de la ficha ya no existe: restauralo primero');
  } else if (action === 'module.delete') {
    if (await Module.exists({ $or: [{ _id: id }, { slug: String(snapshot['slug']) }] })) throw conflict('Ya existe un modulo con ese identificador o slug');
  } else if (action === 'marker.delete') {
    if (await MapMarker.exists({ _id: id })) throw conflict('Ya existe un pin con ese identificador');
    if (typeof snapshot['slug'] === 'string' && (await MapMarker.exists({ slug: snapshot['slug'] }))) {
      throw conflict(`Ya existe un pin con el slug «${snapshot['slug']}»`);
    }
  } else {
    if (await ForumThread.exists({ _id: id })) throw conflict('Ya existe un hilo con ese identificador');
    const postIds = (Array.isArray(snapshot['posts']) ? snapshot['posts'] : []).map((p) => String(asSnap(p)?.['_id'] ?? ''));
    if (postIds.length && (await ForumPost.exists({ _id: { $in: postIds } }))) throw conflict('Alguna respuesta del hilo ya existe');
  }
}

/** Reinserta el documento borrado con el mismo `_id` (SUPER_ADMIN). Deja su propia entrada de auditoria. */
export async function restoreFromAudit(logId: string, actor: { id: string; role: string; ip?: string | null }): Promise<{ type: string; id: string }> {
  const log = await AuditLog.findById(logId).lean<AuditLogDoc>();
  if (!log) throw resourceNotFound('Entrada de auditoria no encontrada');
  if (!isDeleteAction(log.action) || !isRestorable(log)) throw conflict('Esta entrada no se puede restaurar');
  if ((await restoredSet([logId])).has(logId)) throw conflict('Esta entrada ya se restauro');
  const snapshot = asSnap(log.metadata['snapshot'])!;
  await assertFree(log.action, snapshot);
  const { type, restore } = KINDS[log.action];

  const out = await runAtomic(async (session) => {
    const res = await insertSnapshot(log.action as DeleteAction, snapshot, session);
    await writeAuditEntry(
      {
        actor_id: actor.id,
        actor_role: actor.role,
        ip: actor.ip ?? null,
        action: restore,
        target_type: type,
        target_id: res.id,
        metadata: { restored_from: logId, ...(res.titulo ? { titulo: res.titulo } : {}) },
      },
      session,
    );
    return res;
  });
  clearSsrCache();
  return { type, id: out.id };
}
