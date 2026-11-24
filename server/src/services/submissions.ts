import { randomUUID } from 'node:crypto';
import mongoose, { type ClientSession } from 'mongoose';
import { z } from 'zod';
import { Entity, type EntityDoc, entitySchema, entityUpdateSchema, slugSchema } from '../models/Entity.js';
import { MapMarker, mapMarkerSchema, mapMarkerUpdateSchema } from '../models/MapMarker.js';
import { MEDIA_HEIGHT, MEDIA_WIDTH, MediaAsset } from '../models/MediaAsset.js';
import { Module } from '../models/Module.js';
import {
  isFooterType,
  Submission,
  type SubmissionCreate,
  type SubmissionDoc,
} from '../models/Submission.js';
import { ROLE_RANK, type Role } from '../models/User.js';
import { writeAuditEntry } from './audit.js';
import { parseTarjeta, sameJson, withManualEdits } from './catalogIngest.js';
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
/** Campos que construye el servidor: un aporte de usuario nunca los fija (se descartan al validar). */
const SERVER_ONLY = { contentHash: true, manualEdits: true, capturaPropiaPendiente: true } as const;
const userEntityPayloadSchema = entityPayloadSchema.omit(SERVER_ONLY);
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

/** Slug de pin libre: `base`, `base-2`, `base-3`… (el índice único es sparse; nunca se omite el slug en silencio). */
async function uniqueMarkerSlug(base: string, session: ClientSession | null): Promise<string> {
  const root = base.slice(0, 110);
  for (let i = 1; i < 200; i += 1) {
    const candidate = i === 1 ? base : `${root}-${i}`;
    if (!(await MapMarker.exists({ slug: candidate }).session(session))) return candidate;
  }
  throw new HttpError(409, 'No se pudo generar un slug de pin unico');
}

/** Crea el MediaAsset de la tarjeta (created_by = revisor o 'system') dentro de la transaccion y devuelve su ruta publica. */
async function createTarjetaAsset(tarjeta: { buffer: Buffer; bytes: number }, createdBy: string, session: ClientSession | null): Promise<string> {
  const [asset] = await MediaAsset.create(
    [{ mime: 'image/webp', width: MEDIA_WIDTH, height: MEDIA_HEIGHT, bytes: tarjeta.bytes, data: tarjeta.buffer, created_by: createdBy }],
    { session },
  );
  return `/media/${asset!._id}`;
}

/** Imagen reemplazable por una tarjeta: ninguna o un /media/ propio (nunca un asset editorial /assets/ ni una edicion manual). */
const tarjetaMayReplace = (current: { imagen_url?: string | null; manualEdits?: string[] }): boolean =>
  !(current.manualEdits ?? []).includes('imagen_url') && (!current.imagen_url || current.imagen_url.startsWith('/media/'));

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
    const fromPipeline = sub.origin === 'pipeline';
    const r = (fromPipeline ? entityPayloadSchema : userEntityPayloadSchema).safeParse(sub.payload);
    if (!r.success) throw unprocessable(r.error);
    const rawMarker = (sub.payload as { marker?: unknown }).marker;
    const mk = rawMarker === undefined ? null : entityMarkerBlockSchema.safeParse(rawMarker);
    if (mk && !mk.success) throw unprocessable(mk.error);
    // Tarjeta provisional: solo en aportes del pipeline; se revalida (misma logica que /api/admin/media).
    const rawTarjeta = fromPipeline ? (sub.payload as { tarjeta?: unknown }).tarjeta : undefined;
    let tarjeta: { buffer: Buffer; bytes: number } | null = null;
    if (rawTarjeta !== undefined && rawTarjeta !== null) {
      const t = parseTarjeta(rawTarjeta as { mime?: unknown; base64?: unknown });
      if (!t.ok) throw new HttpError(422, t.message);
      tarjeta = { buffer: t.buffer, bytes: t.value.bytes };
    }
    const mod = await Module.findOne({ slug: sub.moduleSlug, activo: true }).lean<{ _id: string }>();
    if (!mod) throw new HttpError(422, 'moduleSlug inexistente o inactivo');
    plan = () => async (session) => {
      // Aporte del pipeline sobre una ficha existente (actualizada/conflicto): se actualiza esa ficha, sin duplicarla.
      if (fromPipeline && r.data.slug) {
        const current = await Entity.findOne({ module_id: mod._id, slug: r.data.slug }, { _id: 1, imagen_url: 1, manualEdits: 1 }).session(session).lean<{ _id: string; imagen_url?: string | null; manualEdits?: string[] }>();
        if (current) {
          // slug no se toca; manualEdits y capturaPropiaPendiente (por defecto del schema) no se resetean.
          const { slug: _slug, manualEdits: _manual, capturaPropiaPendiente: flag, ...set } = r.data as z.infer<typeof entityPayloadSchema>;
          let tarjetaUrl: string | null = null;
          if (tarjeta) {
            // Una imagen_url del payload nunca pisa la existente cuando llega tarjeta; la tarjeta solo entra si no hay conflicto.
            delete set.imagen_url;
            if (tarjetaMayReplace(current)) tarjetaUrl = await createTarjetaAsset(tarjeta, reviewer.id, session);
          }
          const extra: Record<string, unknown> = tarjetaUrl ? { imagen_url: tarjetaUrl, capturaPropiaPendiente: true } : flag === true ? { capturaPropiaPendiente: true } : {};
          await Entity.updateOne({ _id: current._id }, { $set: { ...set, ...extra } }).session(session);
          let pin: { id: string; titulo: string } | undefined;
          if (mk?.success) {
            const m = mk.data;
            const pinExists = Boolean(await MapMarker.exists({ entity_id: current._id }).session(session));
            await MapMarker.updateOne(
              { entity_id: current._id },
              {
                $set: { region: m.region, titulo: r.data.titulo, descripcion: m.descripcion ?? null, coord: { x: m.coord_x, y: m.coord_y } },
                $setOnInsert: { _id: randomUUID(), entity_id: current._id, ...(pinExists ? {} : { slug: await uniqueMarkerSlug(m.slug ?? r.data.slug!, session) }) },
              },
              { upsert: true },
            ).session(session);
            const found = await MapMarker.findOne({ entity_id: current._id }, { _id: 1 }).session(session).lean<{ _id: string }>();
            if (found) pin = { id: found._id, titulo: r.data.titulo };
          }
          return {
            collection: 'Entity',
            id: current._id,
            audit: 'entity.updated',
            extra: { titulo: r.data.titulo, slug: r.data.slug, via: 'pipeline', ...(tarjetaUrl ? { tarjeta: tarjetaUrl } : {}), ...(pin ? { markerId: pin.id } : {}) },
            ...(pin ? { marker: pin } : {}),
          };
        }
      }
      const slug = await uniqueEntitySlug(mod._id, r.data.slug ?? slugify(r.data.titulo), session);
      const tarjetaUrl = tarjeta ? await createTarjetaAsset(tarjeta, reviewer.id, session) : null;
      const [doc] = await Entity.create(
        [{ ...r.data, slug, module_id: mod._id, ...(tarjetaUrl ? { imagen_url: tarjetaUrl, capturaPropiaPendiente: true } : {}) }],
        { session },
      );
      let marker: { id: string; titulo: string } | undefined;
      if (mk?.success) {
        const m = mk.data;
        // El slug del pin (deep-link /mapa?pin=) es unico: si ya esta ocupado se usa un sufijo -2, -3...
        const pinSlug = await uniqueMarkerSlug(m.slug ?? slug, session);
        const [pin] = await MapMarker.create(
          [
            {
              entity_id: doc!._id,
              slug: pinSlug,
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
        extra: { titulo: r.data.titulo, slug, ...(tarjetaUrl ? { tarjeta: tarjetaUrl } : {}), ...(marker ? { markerId: marker.id } : {}) },
        ...(marker ? { marker } : {}),
      };
    };
  } else {
    const c = correctionPayloadSchema.safeParse(sub.payload);
    if (!c.success) throw unprocessable(c.error);
    const { target, id, patch } = c.data;
    if (target === 'Entity') {
      const p = entityUpdateSchema.omit({ id: true, module_id: true, ...SERVER_ONLY }).safeParse(patch);
      if (!p.success) throw unprocessable(p.error);
      plan = () => async (session) => {
        const prev = await Entity.findById(id).session(session).lean<EntityDoc>();
        if (!prev) throw new HttpError(422, 'Entidad destino inexistente');
        // Marca los campos corregidos en manualEdits y recalcula contentHash (igual que PATCH /api/entities).
        await Entity.updateOne({ _id: id }, { $set: withManualEdits(prev, p.data) }).session(session);
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
  // Guarda atomica: solo se cierra un aporte aun pendiente y sin ficha promovida (una aprobacion concurrente gana).
  const updated = await Submission.findOneAndUpdate(
    { _id: id, status: 'pending', promotedTo: null },
    { $set: { status, reviewedBy: reviewer._id, ...(status === 'rejected' && reviewNote ? { reviewNote } : {}) } },
    { returnDocument: 'after' },
  ).lean<SubmissionDoc>();
  if (!updated) throw new HttpError(409, 'Aporte ya procesado');
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

// ---- Lote de moderacion --------------------------------------------------------

/** Tope duro de aportes que procesa una llamada de lote (por ids o por filtro). */
export const BULK_MAX = 500;
export const PIPELINE_REASONS = ['nueva', 'actualizada', 'conflicto'] as const;
export type PipelineReason = (typeof PIPELINE_REASONS)[number];

export interface BulkInput {
  action: 'approve' | 'reject';
  ids?: string[] | undefined;
  filter?: { origin: 'pipeline'; status: 'pending'; runId?: string | undefined; reason?: PipelineReason | undefined } | undefined;
  reviewNote?: string | undefined;
}
export interface BulkItemResult {
  id: string;
  ok: boolean;
  error?: string;
}
export interface BulkResult {
  action: 'approve' | 'reject';
  /** Aportes seleccionados (<= BULK_MAX). */
  requested: number;
  ok: number;
  failed: number;
  /** `true` si el filtro tenia mas de BULK_MAX coincidencias: repite la llamada para el resto. */
  truncated: boolean;
  results: BulkItemResult[];
}

/** Filtro Mongo de la seleccion por `filter`: `approve` sin `reason` explicito excluye los `conflicto`. */
export function bulkFilterQuery(action: 'approve' | 'reject', f: NonNullable<BulkInput['filter']>): Record<string, unknown> {
  return {
    origin: 'pipeline',
    status: 'pending',
    type: 'entity',
    ...(f.runId ? { 'payload.pipeline_run_id': f.runId } : {}),
    ...(f.reason ? { 'payload.pipeline_reason': f.reason } : action === 'approve' ? { 'payload.pipeline_reason': { $ne: 'conflicto' } } : {}),
  };
}

/**
 * Aprueba o rechaza varios aportes en secuencia reutilizando `reviewSubmission` (mismas reglas, promocion y AuditLog por item).
 * Un fallo en un item no aborta el lote: queda en `results` con su motivo.
 */
export async function bulkReview(input: BulkInput, reviewer: { _id: string; rol: Role }, ip?: string | null): Promise<BulkResult> {
  let ids: string[];
  let truncated = false;
  if (input.ids) ids = [...new Set(input.ids)];
  else {
    const rows = await Submission.find(bulkFilterQuery(input.action, input.filter!), { _id: 1 })
      .sort({ createdAt: 1, _id: 1 })
      .limit(BULK_MAX + 1)
      .lean<Array<{ _id: string }>>();
    truncated = rows.length > BULK_MAX;
    ids = rows.slice(0, BULK_MAX).map((r) => r._id);
  }
  const status = input.action === 'approve' ? 'approved' : 'rejected';
  const results: BulkItemResult[] = [];
  for (const id of ids) {
    try {
      await reviewSubmission(id, status, reviewer, ip, status === 'rejected' ? input.reviewNote : undefined);
      results.push({ id, ok: true });
    } catch (err) {
      results.push({ id, ok: false, error: (err instanceof HttpError ? err.message : 'Error interno').slice(0, 300) });
    }
  }
  const okCount = results.filter((r) => r.ok).length;
  return { action: input.action, requested: ids.length, ok: okCount, failed: results.length - okCount, truncated, results };
}

// ---- Politica de conflicto del pipeline (S2.3) ---------------------------------------

export const RESOLVE_ACTIONS = ['mantener', 'aceptar', 'solo_imagen'] as const;
export type ResolveAction = (typeof RESOLVE_ACTIONS)[number];

const asStr = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);
const asRec = (v: unknown): Record<string, unknown> => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

export interface CompareDiff {
  campo: string;
  actual: unknown;
  propuesta: unknown;
}
export interface FichaView {
  titulo: string;
  subtitulo: string | null;
  categoria: string;
  descripcion: string | null;
  metadata: Record<string, unknown>;
}
export interface SubmissionCompare {
  submission_id: string;
  estado: SubmissionDoc['status'];
  reason: PipelineReason;
  entity: {
    id: string;
    slug: string;
    titulo: string;
    categoria: string;
    subtitulo: string | null;
    imagen_url: string | null;
    capturaPropiaPendiente: boolean;
    confianza: string | null;
    fuente: string | null;
  } | null;
  actual: FichaView | null;
  propuesta: FichaView & { confianza: string | null; fuente: string | null; fuente_url: string | null };
  diferencias: CompareDiff[];
  imagen: {
    actual_url: string | null;
    propuesta: { bytes: number; sha256: string } | null;
    thumb_url_propuesta: string | null;
  };
  puede_solo_imagen: boolean;
  puede_aceptar: boolean;
}

interface PipelineContext {
  sub: SubmissionDoc;
  payload: Record<string, unknown>;
  entity: EntityDoc | null;
  tarjeta: { buffer: Buffer; value: { bytes: number; sha256: string } } | null;
  /** Hay `payload.tarjeta` pero no es valida (nunca se aplica). */
  tarjetaInvalida: boolean;
}

/** Carga el aporte del pipeline (404 si no existe, 422 si no es una ficha de entidad del pipeline) y su ficha actual. */
async function loadPipelineContext(id: string): Promise<PipelineContext> {
  const sub = await Submission.findById(id).lean<SubmissionDoc>();
  if (!sub) throw resourceNotFound('Aporte no encontrado');
  if (sub.origin !== 'pipeline' || sub.type !== 'entity') throw new HttpError(422, 'Solo aplica a aportes de ficha del pipeline');
  const payload = asRec(sub.payload);
  const slug = asStr(payload['slug']);
  const mod = await Module.findOne({ slug: sub.moduleSlug }, { _id: 1 }).lean<{ _id: string }>();
  const entity = slug && mod ? await Entity.findOne({ module_id: mod._id, slug }).lean<EntityDoc>() : null;
  const raw = payload['tarjeta'];
  let tarjeta: PipelineContext['tarjeta'] = null;
  let tarjetaInvalida = false;
  if (raw !== undefined && raw !== null) {
    const t = parseTarjeta(asRec(raw));
    if (t.ok) tarjeta = { buffer: t.buffer, value: { bytes: t.value.bytes, sha256: t.value.sha256 } };
    else tarjetaInvalida = true;
  }
  return { sub, payload, entity: entity ?? null, tarjeta, tarjetaInvalida };
}

const canReplaceImage = (c: PipelineContext): boolean =>
  c.tarjeta !== null && c.entity !== null && !c.entity.imagen_url && !(c.entity.manualEdits ?? []).includes('imagen_url');

const reasonOf = (payload: Record<string, unknown>): PipelineReason => {
  const r = payload['pipeline_reason'];
  return (PIPELINE_REASONS as readonly string[]).includes(r as string) ? (r as PipelineReason) : 'nueva';
};

const fichaView = (src: { titulo?: unknown; subtitulo?: unknown; categoria?: unknown; metadata_json?: unknown }): FichaView => {
  const metadata = asRec(src.metadata_json);
  return { titulo: asStr(src.titulo) ?? '', subtitulo: asStr(src.subtitulo), categoria: asStr(src.categoria) ?? '', descripcion: asStr(metadata['descripcion']), metadata };
};

/** GET /api/admin/submissions/:id/compare — nunca incluye el base64 de la tarjeta. */
export async function compareSubmission(id: string): Promise<SubmissionCompare> {
  const c = await loadPipelineContext(id);
  const reason = reasonOf(c.payload);
  const propBase = fichaView(c.payload);
  const actual = c.entity ? fichaView(c.entity) : null;
  const diferencias: CompareDiff[] = [];
  if (actual) {
    const add = (campo: string, a: unknown, p: unknown): void => {
      if (!sameJson(a, p)) diferencias.push({ campo, actual: a ?? null, propuesta: p ?? null });
    };
    add('titulo', actual.titulo, propBase.titulo);
    add('subtitulo', actual.subtitulo, propBase.subtitulo);
    add('categoria', actual.categoria, propBase.categoria);
    add('descripcion', actual.descripcion, propBase.descripcion);
    const { descripcion: _a, ...am } = actual.metadata;
    const { descripcion: _p, ...pm } = propBase.metadata;
    for (const k of [...new Set([...Object.keys(am), ...Object.keys(pm)])].sort()) add(`metadata.${k}`, am[k], pm[k]);
    const as = asRec(c.entity?.stats_json);
    const ps = asRec(c.payload['stats_json']);
    for (const k of [...new Set([...Object.keys(as), ...Object.keys(ps)])].sort()) add(`stats.${k}`, as[k], ps[k]);
  }
  const em = c.entity ? asRec(c.entity.metadata_json) : {};
  return {
    submission_id: c.sub._id,
    estado: c.sub.status,
    reason,
    entity: c.entity
      ? {
          id: c.entity._id,
          slug: c.entity.slug,
          titulo: c.entity.titulo,
          categoria: c.entity.categoria,
          subtitulo: c.entity.subtitulo ?? null,
          imagen_url: c.entity.imagen_url || null,
          capturaPropiaPendiente: c.entity.capturaPropiaPendiente === true,
          confianza: asStr(em['confianza']),
          fuente: asStr(em['fuente']),
        }
      : null,
    actual,
    propuesta: {
      ...propBase,
      confianza: asStr(propBase.metadata['confianza']),
      fuente: asStr(propBase.metadata['fuente']),
      fuente_url: asStr(propBase.metadata['fuente_url']),
    },
    diferencias,
    imagen: {
      actual_url: c.entity?.imagen_url || null,
      propuesta: c.tarjeta ? c.tarjeta.value : null,
      thumb_url_propuesta: c.tarjeta ? `/api/admin/submissions/${c.sub._id}/tarjeta.webp` : null,
    },
    puede_solo_imagen: c.sub.status === 'pending' && canReplaceImage(c),
    puede_aceptar: c.sub.status === 'pending',
  };
}

export interface ResolveResult {
  submission: SubmissionDoc;
  accion: ResolveAction;
  entity_id: string | null;
}

/**
 * POST /api/admin/submissions/:id/resolve — politica de conflicto del pipeline.
 * mantener: rechaza el aporte y no toca la ficha. aceptar: aplica la version del pipeline (422 si la ficha tiene manualEdits).
 * solo_imagen: crea el MediaAsset de la tarjeta y fija solo imagen_url + capturaPropiaPendiente + metadata_json.fuente_imagen/fuente_url;
 * el aporte queda approved con reviewNote «Solo imagen…» y payload.pipeline_resolution = 'solo_imagen' (sin campos nuevos de coleccion).
 */
export async function resolvePipelineSubmission(
  id: string,
  accion: ResolveAction,
  nota: string | undefined,
  reviewer: { _id: string; rol: Role },
  ip?: string | null,
): Promise<ResolveResult> {
  const c = await loadPipelineContext(id);
  if (c.sub.status !== 'pending' || c.sub.promotedTo) throw new HttpError(409, 'Aporte ya procesado');
  const actor: Actor = { id: reviewer._id, role: reviewer.rol, ip: ip ?? null };
  const audit = (session: ClientSession | null, extra: Record<string, unknown> = {}) =>
    writeAuditEntry(
      {
        actor_id: actor.id,
        actor_role: actor.role,
        ip: actor.ip ?? null,
        action: 'submission.resolve',
        target_type: 'Submission',
        target_id: id,
        metadata: { accion, entity_id: c.entity?._id ?? null, slug: asStr(c.payload['slug']), ...(nota ? { nota } : {}), ...extra },
      },
      session,
    );
  const withNote = (base: string): string => (nota ? `${base}. ${nota}` : base).slice(0, 500);

  if (accion === 'mantener') {
    const updated = await runAtomic(async (session) => {
      const u = await Submission.findOneAndUpdate(
        { _id: id, status: 'pending', promotedTo: null },
        { $set: { status: 'rejected', reviewedBy: reviewer._id, reviewNote: withNote('Se mantiene la ficha editorial') } },
        { returnDocument: 'after', session },
      ).lean<SubmissionDoc>();
      if (!u) throw new HttpError(409, 'Aporte ya procesado');
      await audit(session);
      return u;
    });
    return { submission: updated, accion, entity_id: c.entity?._id ?? null };
  }

  if (accion === 'aceptar') {
    if (c.entity && (c.entity.manualEdits ?? []).length > 0) {
      throw new HttpError(422, `La ficha tiene campos editados a mano (${(c.entity.manualEdits ?? []).join(', ')}): no se pueden pisar. Usa «mantener».`);
    }
    const done = await reviewSubmission(id, 'approved', reviewer, ip);
    await audit(null, { promotedTo: done.promotedTo });
    return { submission: done, accion, entity_id: done.promotedTo?.id ?? c.entity?._id ?? null };
  }

  // solo_imagen
  if (!c.entity) throw new HttpError(422, 'No existe la ficha: no hay a que asignar la imagen');
  if (!c.tarjeta) throw new HttpError(422, c.tarjetaInvalida ? 'La tarjeta del aporte no es valida' : 'El aporte no trae imagen provisional');
  if (!canReplaceImage(c)) throw new HttpError(422, 'La ficha ya tiene imagen asignada o protegida: no se reemplaza');
  const tarjeta = c.tarjeta;
  const entity = c.entity;
  const pm = asRec(c.payload['metadata_json']);
  const protectedMeta = (entity.manualEdits ?? []).includes('metadata_json');
  const done = await runAtomic(async (session) => {
    const fresh = await Entity.findOne({ _id: entity._id }, { imagen_url: 1, manualEdits: 1 }).session(session).lean<{ imagen_url?: string | null; manualEdits?: string[] }>();
    if (!fresh || fresh.imagen_url || (fresh.manualEdits ?? []).includes('imagen_url')) throw new HttpError(422, 'La ficha ya tiene imagen asignada o protegida: no se reemplaza');
    const claimed = await Submission.findOneAndUpdate(
      { _id: id, status: 'pending', promotedTo: null },
      {
        $set: {
          status: 'approved',
          reviewedBy: reviewer._id,
          reviewNote: withNote('Solo imagen: se conserva el texto editorial'),
          promotedTo: { collection: 'Entity', id: entity._id },
          'payload.pipeline_resolution': 'solo_imagen',
        },
      },
      { returnDocument: 'after', session },
    ).lean<SubmissionDoc>();
    if (!claimed) throw new HttpError(409, 'Aporte ya procesado');
    const url = await createTarjetaAsset({ buffer: tarjeta.buffer, bytes: tarjeta.value.bytes }, reviewer._id, session);
    const set: Record<string, unknown> = { imagen_url: url, capturaPropiaPendiente: true };
    if (!protectedMeta) {
      const fi = asStr(pm['fuente_imagen']);
      const fu = asStr(pm['fuente_url']);
      if (fi) set['metadata_json.fuente_imagen'] = fi;
      if (fu) set['metadata_json.fuente_url'] = fu;
    }
    await Entity.updateOne({ _id: entity._id }, { $set: set }).session(session);
    await audit(session, { imagen_url: url });
    return claimed;
  });
  clearSsrCache();
  return { submission: done, accion, entity_id: entity._id };
}
