// Normalizacion de fichas del catalogo + ingesta por lotes del pipeline de datos.
// Compartido por scripts/importCatalog.ts (CLI) y routes/pipeline.ts (POST /api/pipeline/ingest).
// Contrato: docs/LeonidApp-Rutas-SEO-Monetizacion.md §1.6 y docs/LeonidApp-Arquitectura-Datos-MongoDB.md §2.12.
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { Entity, entitySchema, slugSchema, type EntityDoc } from '../models/Entity.js';
import { mapMarkerSchema, type MapMarkerDTO } from '../models/MapMarker.js';
import { Module } from '../models/Module.js';
import { MAX_REJECTED_PER_RUN, PipelineRun, type PipelineRunDoc } from '../models/PipelineRun.js';
import { Submission } from '../models/Submission.js';
import { diffFields, writeAuditEntry } from './audit.js';
import { HttpError } from './validate.js';

export const DEFAULT_SOURCE = 'editorial';
export const sourceSchema = z.string().regex(/^[a-z0-9_-]{1,40}$/i, 'nombre de fuente inválido (a-z, 0-9, _ y -, máx. 40)');

export const markerBlockSchema = z.object({
  region: z.string().min(1),
  coord_x: z.number().finite(),
  coord_y: z.number().finite(),
  descripcion: z.string().optional(),
  slug: slugSchema.optional(),
});

export const fichaSchema = z.object({
  modulo: z.string().min(1),
  slug: z.string(),
  titulo: z.string(),
  subtitulo: z.string().nullable().optional(),
  categoria: z.string(),
  /** Solo `null` o una ruta interna permitida (se valida por ítem en `normalizeFicha`). */
  imagen_url: z.string().nullable().optional(),
  stats_juego: z.record(z.string(), z.number().min(0).max(10)).default({}),
  metadata: z.record(z.string(), z.unknown()).default({}),
  confianza: z.enum(['alta', 'media', 'baja']),
  evidencia: z.array(z.string()).max(5).default([]),
  notas: z.union([z.string(), z.array(z.string())]).optional(),
  marker: markerBlockSchema.optional(),
});
export type Ficha = z.infer<typeof fichaSchema>;
/** En el lote HTTP el módulo viaja en el sobre: el `modulo` de cada ítem es opcional (si llega, debe coincidir). */
export const pipelineFichaSchema = fichaSchema.extend({ modulo: z.string().min(1).optional() });
type PipelineFicha = z.infer<typeof pipelineFichaSchema>;

// ---- imagen_url: cero hotlinking ---------------------------------------------------------------

const THIRD_PARTY_PREFIX = /^(complexmusic_|rockstargames_|theofficialselfridges_)/i;
const ALLOWED_IMAGE_PATH = /^\/(assets|media)\/[A-Za-z0-9._/-]+$/;

/** `null` si la ruta es válida; si no, el motivo del rechazo. */
export function imagePathError(url: string): string | null {
  if (!url.startsWith('/') || url.startsWith('//')) return 'imagen_url debe ser null o una ruta interna que empiece por /';
  if (url.includes('..') || url.includes('//') || url.includes('\\')) return 'imagen_url contiene un segmento no permitido';
  if (!ALLOWED_IMAGE_PATH.test(url)) return 'imagen_url fuera de las rutas de assets propias (/assets/, /media/)';
  if (url.split('/').some((seg) => THIRD_PARTY_PREFIX.test(seg))) return 'imagen_url con prefijo de terceros no permitido';
  return null;
}

// ---- Hash canonico -----------------------------------------------------------------------------

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v !== null && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(o)
        .sort()
        .map((k) => [k, sortKeys(o[k])]),
    );
  }
  return v;
}
const stable = (v: unknown): string => JSON.stringify(sortKeys(v));

export const CANONICAL_FIELDS = ['titulo', 'subtitulo', 'categoria', 'imagen_url', 'stats_json', 'metadata_json'] as const;
export type CanonicalField = (typeof CANONICAL_FIELDS)[number];
export interface CanonicalContent {
  titulo: string;
  subtitulo: string | null;
  categoria: string;
  imagen_url: string | null;
  stats_json: Record<string, unknown>;
  metadata_json: Record<string, unknown>;
}

/** Contenido canónico; si la ficha entrante no trae `imagen_url`, se mantiene la de la existente. */
export function canonicalOf(
  c: {
    titulo: string;
    subtitulo?: string | null;
    categoria: string;
    imagen_url?: string | null;
    stats_json?: Record<string, unknown>;
    metadata_json?: Record<string, unknown>;
  },
  fallbackImage?: string | null,
): CanonicalContent {
  return {
    titulo: c.titulo,
    subtitulo: c.subtitulo ?? null,
    categoria: c.categoria,
    imagen_url: c.imagen_url ?? fallbackImage ?? null,
    stats_json: c.stats_json ?? {},
    metadata_json: c.metadata_json ?? {},
  };
}

/**
 * `$set` para editar una ficha a mano (PATCH de staff o corrección aprobada): añade a `manualEdits` los campos
 * canónicos que cambian y recalcula `contentHash`. Compartido por routes/catalog.ts y services/submissions.ts.
 */
export function withManualEdits(prev: EntityDoc, patch: Record<string, unknown>): Record<string, unknown> {
  const changed = diffFields(prev as unknown as Record<string, unknown>, patch).after;
  const edited = CANONICAL_FIELDS.filter((k) => k in changed);
  const set: Record<string, unknown> = { ...patch };
  if (edited.length > 0) {
    set['manualEdits'] = [...new Set([...(prev.manualEdits ?? []), ...edited])];
    set['contentHash'] = contentHashOf(canonicalOf({ ...prev, ...patch }));
  }
  return set;
}

/** SHA-256 (hex) del contenido canónico con claves ordenadas (Arquitectura §2.4). */
export const contentHashOf = (c: CanonicalContent): string => createHash('sha256').update(stable(c)).digest('hex');

// ---- Normalizacion de una ficha ----------------------------------------------------------------

const entityContentSchema = entitySchema.omit({ id: true, manualEdits: true, capturaPropiaPendiente: true, contentHash: true });
export type EntityContent = z.infer<typeof entityContentSchema>;
export type NormalizedFicha = { ok: true; doc: EntityContent; marker: MapMarkerDTO | null } | { ok: false; message: string };

const issuesText = (e: z.ZodError): string => e.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ');

/** Ficha editorial -> documento Entity (+ marcador validado). Stats de UI en 0-100; el valor exacto 0-10 queda en metadata. */
export function normalizeFicha(f: Ficha | PipelineFicha, source: string, module_id: string): NormalizedFicha {
  // "" equivale a "sin imagen": se normaliza a null (como un null explícito, canonicalOf conserva la existente).
  const imagen = f.imagen_url === '' ? null : f.imagen_url;
  if (imagen) {
    const bad = imagePathError(imagen);
    if (bad) return { ok: false, message: bad };
  }
  const stats_json = Object.fromEntries(Object.entries(f.stats_juego).map(([k, v]) => [k, Math.round(v * 10)]));
  const parsed = entityContentSchema.safeParse({
    module_id,
    slug: f.slug,
    titulo: f.titulo,
    subtitulo: f.subtitulo ?? null,
    categoria: f.categoria,
    ...(imagen !== undefined ? { imagen_url: imagen } : {}),
    stats_json,
    metadata_json: {
      ...f.metadata,
      stats_juego: f.stats_juego,
      ...(f.notas !== undefined ? { notas: f.notas } : {}),
      fuente: source,
      confianza: f.confianza,
      evidencia: f.evidencia,
    },
  });
  if (!parsed.success) return { ok: false, message: issuesText(parsed.error) };
  let marker: MapMarkerDTO | null = null;
  if (f.marker) {
    const m = mapMarkerSchema.safeParse({
      slug: f.marker.slug,
      region: f.marker.region,
      titulo: f.titulo,
      descripcion: f.marker.descripcion ?? null,
      coord_x: f.marker.coord_x,
      coord_y: f.marker.coord_y,
    });
    if (!m.success) return { ok: false, message: `marker ${issuesText(m.error)}` };
    marker = m.data;
  }
  return { ok: true, doc: parsed.data, marker };
}

// ---- Ingesta por lotes (pipeline) --------------------------------------------------------------

/** Una ejecución en `queued`/`running` sin cerrar tras este tiempo se considera caída. */
export const RUN_STALE_MS = 15 * 60 * 1000;

export type IngestResultado = 'nueva' | 'actualizada' | 'conflicto' | 'rechazada';
export interface IngestDetail {
  slug: string;
  resultado: IngestResultado;
  motivo?: string;
}
export interface IngestResult {
  ok: true;
  runId: string;
  dryRun: boolean;
  nuevas: number;
  actualizadas: number;
  sin_cambios: number;
  conflictos: number;
  rechazados: number;
  errores: number;
  details: IngestDetail[];
}
export interface IngestInput {
  source: string;
  modulo: string;
  archivo: string | null;
  dryRun: boolean;
  fichas: unknown[];
  ip?: string | null;
}

/** Cierra como `error` las ejecuciones que nunca terminaron (best effort). */
export async function expireStaleRuns(): Promise<void> {
  await PipelineRun.updateMany(
    { status: { $in: ['queued', 'running'] }, startedAt: { $lt: new Date(Date.now() - RUN_STALE_MS) } },
    { $set: { status: 'error', finishedAt: new Date() } },
  );
}

const sameJson = (a: unknown, b: unknown): boolean => stable(a ?? null) === stable(b ?? null);

export async function ingestPipelineBatch(input: IngestInput): Promise<IngestResult> {
  const { source, modulo, archivo, dryRun, fichas } = input;
  const mod = await Module.findOne({ slug: modulo }, { _id: 1 }).lean<{ _id: string }>();
  if (!mod) throw new HttpError(422, `El módulo "${modulo}" no existe`);
  await expireStaleRuns();

  // La primera ingesta tras «Sincronizar ahora» adopta la ejecución en cola; las demás crean la suya.
  const adopted = await PipelineRun.findOneAndUpdate(
    { status: 'queued', trigger: 'manual' },
    { $set: { status: 'running', source, modulo, archivo, dryRun } },
    { sort: { startedAt: 1 }, returnDocument: 'after' },
  ).lean<PipelineRunDoc>();
  const runId = adopted?._id ?? (await PipelineRun.create({ status: 'running', trigger: 'push', source, modulo, archivo, dryRun }))._id;

  const counts = { created: 0, updated: 0, unchanged: 0, conflicts: 0, rejected: 0 };
  const rejected: Array<{ slug: string; reason: string }> = [];
  const details: IngestDetail[] = [];
  let errores = 0;
  const seen = new Set<string>();

  const reject = (slug: string, reason: string): void => {
    counts.rejected++;
    details.push({ slug, resultado: 'rechazada', motivo: reason.slice(0, 300) });
    if (rejected.length < MAX_REJECTED_PER_RUN) rejected.push({ slug, reason: reason.slice(0, 300) });
  };

  try {
    for (const [i, raw] of fichas.entries()) {
      const rawSlug = (raw as { slug?: unknown } | null)?.slug;
      const label = typeof rawSlug === 'string' && rawSlug ? rawSlug : `#${i}`;
      const parsed = pipelineFichaSchema.safeParse(raw);
      if (!parsed.success) {
        reject(label, issuesText(parsed.error));
        continue;
      }
      const f = parsed.data;
      if (f.modulo !== undefined && f.modulo !== modulo) {
        reject(f.slug, `el módulo de la ficha ("${f.modulo}") no coincide con el del lote`);
        continue;
      }
      if (seen.has(f.slug)) {
        reject(f.slug, 'slug repetido en el lote');
        continue;
      }
      seen.add(f.slug);
      const n = normalizeFicha(f, source, mod._id);
      if (!n.ok) {
        reject(f.slug, n.message);
        continue;
      }

      try {
        const existing = await Entity.findOne({ module_id: mod._id, slug: f.slug }).lean<EntityDoc>();
        const incoming = canonicalOf(n.doc, existing?.imagen_url);
        const hash = contentHashOf(incoming);
        let reason: 'nueva' | 'actualizada' | 'conflicto' = 'nueva';
        let motivo: string | undefined;
        let conflictFields: string[] = [];
        if (existing) {
          const current = canonicalOf(existing);
          if ((existing.contentHash ?? contentHashOf(current)) === hash) {
            counts.unchanged++;
            continue;
          }
          const changed = CANONICAL_FIELDS.filter((k) => !sameJson(incoming[k], current[k]));
          conflictFields = changed.filter((k) => (existing.manualEdits ?? []).includes(k));
          const prevSource = (existing.metadata_json as Record<string, unknown> | undefined)?.['fuente'];
          if (conflictFields.length > 0) {
            reason = 'conflicto';
            motivo = `campos editados a mano: ${conflictFields.join(', ')}`;
          } else if (typeof prevSource === 'string' && prevSource !== source) {
            reason = 'conflicto';
            motivo = `la ficha pertenece a la fuente "${prevSource}"`;
          } else reason = 'actualizada';
        }
        if (reason === 'nueva') counts.created++;
        else if (reason === 'actualizada') counts.updated++;
        else counts.conflicts++;

        let duplicate = false;
        if (!dryRun) {
          duplicate = Boolean(
            await Submission.exists({
              origin: 'pipeline',
              status: 'pending',
              type: 'entity',
              moduleSlug: modulo,
              'payload.slug': f.slug,
              'payload.contentHash': hash,
            }),
          );
          if (!duplicate) {
            await Submission.create({
              userId: null,
              origin: 'pipeline',
              moduleSlug: modulo,
              type: 'entity',
              title: n.doc.titulo.length >= 3 ? n.doc.titulo.slice(0, 160) : `${n.doc.titulo} (${f.slug})`.slice(0, 160),
              payload: {
                slug: f.slug,
                titulo: n.doc.titulo,
                subtitulo: n.doc.subtitulo ?? null,
                categoria: n.doc.categoria,
                ...(n.doc.imagen_url !== undefined ? { imagen_url: n.doc.imagen_url } : {}),
                stats_json: n.doc.stats_json,
                metadata_json: n.doc.metadata_json,
                contentHash: hash,
                ...(reason === 'nueva' ? { capturaPropiaPendiente: incoming.imagen_url === null } : {}),
                ...(f.marker ? { marker: f.marker } : {}),
                pipeline_reason: reason,
                pipeline_run_id: runId,
                ...(conflictFields.length ? { conflict_fields: conflictFields } : {}),
              },
              coords: null,
              status: 'pending',
              reviewedBy: null,
              promotedTo: null,
            });
          }
        }
        const note = duplicate ? 'ya hay un aporte pendiente idéntico; no se duplica' : motivo;
        details.push({ slug: f.slug, resultado: reason, ...(note ? { motivo: note } : {}) });
      } catch (err) {
        errores++;
        const msg = `error de escritura: ${err instanceof Error ? err.message : 'desconocido'}`.slice(0, 300);
        details.push({ slug: f.slug, resultado: 'rechazada', motivo: 'error de escritura' });
        if (rejected.length < MAX_REJECTED_PER_RUN) rejected.push({ slug: f.slug, reason: msg });
      }
    }
  } catch (err) {
    await PipelineRun.updateOne({ _id: runId }, { $set: { status: 'error', finishedAt: new Date(), counts, rejected } });
    throw err;
  }

  await PipelineRun.updateOne({ _id: runId }, { $set: { status: errores > 0 ? 'error' : 'ok', finishedAt: new Date(), counts, rejected } });
  await writeAuditEntry({
    actor_id: 'system',
    actor_role: 'system',
    actor_label: 'system:pipeline',
    action: 'pipeline.batch',
    target_type: 'pipeline_run',
    target_id: runId,
    metadata: { source, modulo, archivo, dryRun, counts, errores },
    ip: input.ip ?? null,
  });
  return {
    ok: true,
    runId,
    dryRun,
    nuevas: counts.created,
    actualizadas: counts.updated,
    sin_cambios: counts.unchanged,
    conflictos: counts.conflicts,
    rechazados: counts.rejected,
    errores,
    details,
  };
}
