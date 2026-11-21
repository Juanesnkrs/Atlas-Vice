import mongoose, { type ClientSession } from 'mongoose';
import { z } from 'zod';
import { Entity, entitySchema, entityUpdateSchema, slugSchema } from '../models/Entity.js';
import { MapMarker, mapMarkerSchema, mapMarkerUpdateSchema } from '../models/MapMarker.js';
import { Module } from '../models/Module.js';
import {
  isFooterType,
  Submission,
  type SubmissionCreate,
  type SubmissionDoc,
} from '../models/Submission.js';
import { ROLE_RANK, type Role } from '../models/User.js';
import { writeAuditEntry } from './audit.js';
import { clearSsrCache } from './ssrLite.js';
import { HttpError, resourceNotFound } from './validate.js';

/** Quien ejecuta la accion: un usuario con rol o el sistema (autor de confianza). */
export interface Actor {
  id: string;
  role: Role | 'SYSTEM';
  ip?: string | null;
}
const SYSTEM: Actor = { id: 'system', role: 'SYSTEM' };

export const FOOTER_MODULE_SLUG = 'leonidapp';

export const slugify = (input: string): string =>
  input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 110);

const NO_TXN =
  /replica set|Transaction numbers|transactions? (are|is) not supported|does not support retryable writes/i;

/** Transaccion Mongo; si el servidor es standalone (dev) degrada a escritura sin sesion. */
export async function runAtomic<T>(fn: (session: ClientSession | null) => Promise<T>): Promise<T> {
  const session = await mongoose.startSession();
  try {
    return (await session.withTransaction(() => fn(session))) as T;
  } catch (err) {
    if (err instanceof Error && NO_TXN.test(err.message)) return fn(null);
    throw err;
  } finally {
    await session.endSession();
  }
}

const unprocessable = (err: z.ZodError): HttpError =>
  new HttpError(422, 'Payload invalido', z.treeifyError(err));

const markerPayloadSchema = mapMarkerSchema.omit({ id: true, coord_x: true, coord_y: true });
const entityPayloadSchema = entitySchema
  .omit({ id: true, module_id: true, slug: true })
  .extend({ slug: slugSchema.optional() });
/** Bloque opcional `payload.marker` de una ficha: crea su pin vinculado en la misma promocion. */
const entityMarkerBlockSchema = z.object({
  region: z.string().min(1).max(80),
  coord_x: z.number().min(0).max(1000),
  coord_y: z.number().min(0).max(700),
  descripcion: z.string().max(2000).optional(),
  slug: slugSchema.optional(),
});
const correctionPayloadSchema = z.object({
  target: z.enum(['Entity', 'MapMarker']),
  id: z.uuid(),
  patch: z.record(z.string(), z.unknown()),
});

async function uniqueEntitySlug(moduleId: string, base: string, session: ClientSession | null): Promise<string> {
  const root = base || 'entrada';
  for (let i = 1; i < 200; i += 1) {
    const candidate = i === 1 ? root : `${root.slice(0, 110)}-${i}`;
    const exists = await Entity.exists({ module_id: moduleId, slug: candidate }).session(session);
    if (!exists) return candidate;
  }
  throw new HttpError(409, 'No se pudo generar un slug unico');
}

/**
 * Promueve una Submission aprobada. Idempotente: si `promotedTo` existe no hace nada.
 * Lanza 422 (y no escribe nada) si el payload no valida.
 */
export async function promote(submissionId: string, reviewer: Actor): Promise<SubmissionDoc> {
  const sub = await Submission.findById(submissionId).lean<SubmissionDoc>();
  if (!sub) throw resourceNotFound('Aporte no encontrado');
  if (isFooterType(sub.type)) throw new HttpError(409, 'contact/newsletter nunca se promueven');
  if (sub.promotedTo) return sub;
  if (sub.status === 'rejected') throw new HttpError(409, 'Aporte rechazado');

  // Validacion previa (fuera de la transaccion): si falla, queda pending.
  let plan: () => (session: ClientSession | null) => Promise<{
    collection: 'MapMarker' | 'Entity';
    id: string;
    audit: string;
    extra: Record<string, unknown>;
    /** Pin creado junto a la ficha (aporte `entity` con `payload.marker`). */
    marker?: { id: string; titulo: string };
  }>;

  if (sub.type === 'marker') {
    if (!sub.coords) throw new HttpError(422, 'Falta ubicar el pin: indica las coordenadas X (0-1000) e Y (0-700) para aprobar este aporte.');
    const r = markerPayloadSchema.safeParse(sub.payload);
    if (!r.success) throw unprocessable(r.error);
    const coords = sub.coords;
    plan = () => async (session) => {
      const [doc] = await MapMarker.create([{ ...r.data, coord: { x: coords.x, y: coords.y } }], { session });
      return { collection: 'MapMarker', id: doc!._id, audit: 'marker.created', extra: { titulo: r.data.titulo } };
    };
  } else if (sub.type === 'entity') {
    const r = entityPayloadSchema.safeParse(sub.payload);
    if (!r.success) throw unprocessable(r.error);
    const rawMarker = (sub.payload as { marker?: unknown }).marker;
    const mk = rawMarker === undefined ? null : entityMarkerBlockSchema.safeParse(rawMarker);
    if (mk && !mk.success) throw unprocessable(mk.error);
    const mod = await Module.findOne({ slug: sub.moduleSlug, activo: true }).lean<{ _id: string }>();
    if (!mod) throw new HttpError(422, 'moduleSlug inexistente o inactivo');
    plan = () => async (session) => {
      const slug = await uniqueEntitySlug(mod._id, r.data.slug ?? slugify(r.data.titulo), session);
      const [doc] = await Entity.create([{ ...r.data, slug, module_id: mod._id }], { session });
      let marker: { id: string; titulo: string } | undefined;
      if (mk?.success) {
        const m = mk.data;
        // El slug del pin (deep-link /mapa?pin=) es unico: si ya esta ocupado se omite (indice sparse).
        const wanted = m.slug ?? slug;
        const taken = await MapMarker.exists({ slug: wanted }).session(session);
        const [pin] = await MapMarker.create(
          [
            {
              entity_id: doc!._id,
              ...(taken ? {} : { slug: wanted }),
              region: m.region,
              titulo: r.data.titulo,
              descripcion: m.descripcion ?? null,
              coord: { x: m.coord_x, y: m.coord_y },
            },
          ],
          { session },
        );
        marker = { id: pin!._id, titulo: r.data.titulo };
      }
      return {
        collection: 'Entity',
        id: doc!._id,
        audit: 'entity.created',
        extra: { titulo: r.data.titulo, slug, ...(marker ? { markerId: marker.id } : {}) },
        ...(marker ? { marker } : {}),
      };
    };
  } else {
    const c = correctionPayloadSchema.safeParse(sub.payload);
    if (!c.success) throw unprocessable(c.error);
    const { target, id, patch } = c.data;
    if (target === 'Entity') {
      const p = entityUpdateSchema.omit({ id: true, module_id: true }).safeParse(patch);
      if (!p.success) throw unprocessable(p.error);
      plan = () => async (session) => {
        const res = await Entity.updateOne({ _id: id }, { $set: p.data }).session(session);
        if (res.matchedCount === 0) throw new HttpError(422, 'Entidad destino inexistente');
        return { collection: 'Entity', id, audit: 'entity.updated', extra: { patch: p.data } };
      };
    } else {
      const p = mapMarkerUpdateSchema.omit({ id: true }).safeParse(patch);
      if (!p.success) throw unprocessable(p.error);
      const { coord_x, coord_y, ...rest } = p.data;
      if ((coord_x === undefined) !== (coord_y === undefined)) {
        throw new HttpError(422, 'coord_x y coord_y deben enviarse juntas');
      }
      const set: Record<string, unknown> = { ...rest };
      if (coord_x !== undefined && coord_y !== undefined) set['coord'] = { x: coord_x, y: coord_y };
      plan = () => async (session) => {
        const res = await MapMarker.updateOne({ _id: id }, { $set: set }).session(session);
        if (res.matchedCount === 0) throw new HttpError(422, 'Marcador destino inexistente');
        return { collection: 'MapMarker', id, audit: 'marker.updated', extra: { patch: p.data } };
      };
    }
  }

  const run = plan();
  const result = await runAtomic(async (session) => {
    // Guarda de idempotencia/concurrencia: solo promueve si sigue sin promover.
    const claimed = await Submission.findOneAndUpdate(
      { _id: sub._id, promotedTo: null, status: { $ne: 'rejected' } },
      { $set: { status: 'approved', reviewedBy: reviewer.id } },
      { returnDocument: 'after', session },
    ).lean<SubmissionDoc>();
    if (!claimed) {
      const again = await Submission.findById(sub._id).session(session).lean<SubmissionDoc>();
      if (again?.promotedTo) return again;
      throw new HttpError(409, 'Aporte no promovible');
    }
    const out = await run(session);
    const updated = await Submission.findOneAndUpdate(
      { _id: sub._id },
      { $set: { promotedTo: { collection: out.collection, id: out.id } } },
      { returnDocument: 'after', session },
    ).lean<SubmissionDoc>();
    const base = { actor_id: reviewer.id, actor_role: reviewer.role, ip: reviewer.ip ?? null };
    await writeAuditEntry(
      {
        ...base,
        action: 'submission.approved',
        target_type: 'Submission',
        target_id: sub._id,
        metadata: { from: sub.status, to: 'approved', promotedTo: { collection: out.collection, id: out.id } },
      },
      session,
    );
    await writeAuditEntry(
      { ...base, action: out.audit, target_type: out.collection, target_id: out.id, metadata: { submissionId: sub._id, ...out.extra } },
      session,
    );
    if (out.marker) {
      await writeAuditEntry(
        {
          ...base,
          action: 'marker.created',
          target_type: 'MapMarker',
          target_id: out.marker.id,
          metadata: { submissionId: sub._id, titulo: out.marker.titulo, entity_id: out.id },
        },
        session,
      );
    }
    return updated!;
  });
  clearSsrCache(); // la entidad/marcador promovido cambia el HTML inyectado y el sitemap
  return result;
}

/** POST /api/submissions: pending, o aprobada y promovida si el autor es MODERATOR+. */
export async function createUserSubmission(
  user: { _id: string; rol: Role },
  body: SubmissionCreate,
  ip?: string | null,
): Promise<SubmissionDoc> {
  const created = await Submission.create({ ...body, userId: user._id, status: 'pending', reviewedBy: null, promotedTo: null });
  const doc = created.toObject() as SubmissionDoc;
  // Un marcador sin coordenadas espera a que el equipo ubique el pin: no se autopromueve.
  if (ROLE_RANK[user.rol] >= ROLE_RANK.MODERATOR && !(doc.type === 'marker' && doc.coords === null)) {
    return promote(doc._id, { ...SYSTEM, ip: ip ?? null });
  }
  return doc;
}

/** PATCH /api/admin/submissions/:id (MODERATOR+; contact/newsletter solo ADMIN+). */
export async function reviewSubmission(
  id: string,
  status: 'approved' | 'rejected',
  reviewer: { _id: string; rol: Role },
  ip?: string | null,
  reviewNote?: string,
  coords?: { x: number; y: number },
): Promise<SubmissionDoc> {
  const sub = await Submission.findById(id).lean<SubmissionDoc>();
  if (!sub) throw resourceNotFound('Aporte no encontrado');
  const actor: Actor = { id: reviewer._id, role: reviewer.rol, ip: ip ?? null };

  if (isFooterType(sub.type) && ROLE_RANK[reviewer.rol] < ROLE_RANK.ADMIN) {
    throw new HttpError(403, 'Permisos insuficientes');
  }

  if (status === 'approved' && !isFooterType(sub.type)) {
    // El aporte publico de ubicacion llega sin coordenadas: quien aprueba las completa aqui.
    if (coords && sub.type === 'marker' && !sub.promotedTo) await Submission.updateOne({ _id: id }, { $set: { coords } });
    return promote(id, actor);
  }

  if (status === 'rejected' && sub.promotedTo) throw new HttpError(409, 'Aporte ya promovido');
  const updated = await Submission.findByIdAndUpdate(
    id,
    { $set: { status, reviewedBy: reviewer._id, ...(status === 'rejected' && reviewNote ? { reviewNote } : {}) } },
    { returnDocument: 'after' },
  ).lean<SubmissionDoc>();
  await writeAuditEntry({
    actor_id: actor.id,
    actor_role: actor.role,
    ip: actor.ip ?? null,
    action: `submission.${status}`,
    target_type: 'Submission',
    target_id: id,
    metadata: { from: sub.status, to: status, ...(status === 'rejected' && reviewNote ? { reviewNote } : {}) },
  });
  return updated!;
}

// ---- Footer (invitados): contact / newsletter ------------------------------------

export async function createContactSubmission(data: { email: string; message: string }): Promise<void> {
  await Submission.create({
    userId: null,
    moduleSlug: FOOTER_MODULE_SLUG,
    type: 'contact',
    title: `Contacto de ${data.email}`.slice(0, 160),
    payload: { email: data.email, message: data.message },
    coords: null,
    status: 'pending',
    reviewedBy: null,
    promotedTo: null,
  });
}

export async function createNewsletterSubscription(data: { email: string; locale: string }): Promise<void> {
  // Idempotente por email: no duplica suscripciones.
  const dup = await Submission.exists({ type: 'newsletter', 'payload.email': data.email });
  if (dup) return;
  await Submission.create({
    userId: null,
    moduleSlug: FOOTER_MODULE_SLUG,
    type: 'newsletter',
    title: 'Suscripción newsletter',
    payload: { email: data.email, locale: data.locale },
    coords: null,
    status: 'pending',
    reviewedBy: null,
    promotedTo: null,
  });
}
