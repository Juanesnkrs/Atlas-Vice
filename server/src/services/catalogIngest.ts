// Normalizacion de fichas del catalogo + ingesta por lotes del pipeline de datos.
// Compartido por scripts/importCatalog.ts (CLI) y routes/pipeline.ts (POST /api/pipeline/ingest).
// Contrato: docs/LeonidApp-Rutas-SEO-Monetizacion.md §1.6 y docs/LeonidApp-Arquitectura-Datos-MongoDB.md §2.12.
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { Entity, entitySchema, slugSchema, type EntityDoc } from '../models/Entity.js';
import { mapMarkerSchema, type MapMarkerDTO } from '../models/MapMarker.js';
import { MEDIA_HEIGHT, MEDIA_MAX_BYTES, MEDIA_WIDTH } from '../models/MediaAsset.js';
import { Module } from '../models/Module.js';
import { MAX_REJECTED_PER_RUN, PipelineRun, type PipelineRunDoc } from '../models/PipelineRun.js';
import { Submission } from '../models/Submission.js';
import { diffFields, writeAuditEntry } from './audit.js';
import { probeImage } from './imageProbe.js';
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

/** Tarjeta provisional (§1.6): imagen WebP 1600x900 <= 400 KB en base64 que el pipeline adjunta a la ficha. */
export const tarjetaSchema = z.object({ mime: z.literal('image/webp'), base64: z.string().min(1) });

/**
 * `looseObject`: las claves de 1er nivel desconocidas NO se descartan en silencio; `normalizeFicha` las ignora
 * pero las informa en `avisos[]` del detalle. Los alias de descripcion/pasos se aceptan a 1er nivel y se normalizan.
 */
export const fichaSchema = z.looseObject({
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
  descripcion: z.string().nullish(),
  descripcion_es: z.string().nullish(),
  description: z.string().nullish(),
  summary: z.string().nullish(),
  steps: z.array(z.unknown()).nullish(),
  pasos: z.array(z.unknown()).nullish(),
  capturaPropiaPendiente: z.boolean().optional(),
  tarjeta: tarjetaSchema.optional(),
});
/** Claves de 1er nivel conocidas: cualquier otra se ignora con aviso. */
const KNOWN_TOP_KEYS = new Set([
  'modulo', 'slug', 'titulo', 'subtitulo', 'categoria', 'imagen_url', 'stats_juego', 'metadata', 'confianza', 'evidencia',
  'notas', 'marker', 'descripcion', 'descripcion_es', 'description', 'summary', 'steps', 'pasos', 'capturaPropiaPendiente', 'tarjeta',
]);
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

/** Elementos de la ficha que entran en el hash solo cuando existen (los hashes de fichas sin ellos no cambian). */
export interface HashExtras {
  marker?: Record<string, unknown> | null;
  tarjetaSha256?: string | null;
}

/**
 * SHA-256 (hex) del contenido canónico con claves ordenadas (Arquitectura §2.4). Con `extras`: el `marker` entra tal cual
 * y la tarjeta entra por su sha256 (y `imagen_url` se fija a null, porque la imagen final `/media/<id>` la crea `promote`).
 */
export const contentHashOf = (c: CanonicalContent, extras?: HashExtras): string => {
  const body: Record<string, unknown> = { ...c };
  if (extras?.tarjetaSha256) {
    body['tarjeta'] = extras.tarjetaSha256;
    body['imagen_url'] = null;
  }
  if (extras?.marker) body['marker'] = extras.marker;
  return createHash('sha256').update(stable(body)).digest('hex');
};

// ---- Tarjeta provisional -----------------------------------------------------------------------

export interface ParsedTarjeta {
  mime: 'image/webp';
  base64: string;
  sha256: string;
  bytes: number;
}
const MAX_TARJETA_B64 = Math.ceil(MEDIA_MAX_BYTES / 3) * 4;

/** Misma validación que `POST /api/admin/media` (firma real WebP, 1600x900, <= 400 KB). */
export function parseTarjeta(raw: { mime?: unknown; base64?: unknown }): { ok: true; value: ParsedTarjeta; buffer: Buffer } | { ok: false; message: string } {
  const b64 = typeof raw.base64 === 'string' ? raw.base64 : '';
  if (raw.mime !== 'image/webp') return { ok: false, message: 'tarjeta: solo se admite image/webp' };
  if (b64.length > MAX_TARJETA_B64) return { ok: false, message: `tarjeta: supera el máximo de ${Math.round(MEDIA_MAX_BYTES / 1024)} KB` };
  if (b64.length === 0 || b64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return { ok: false, message: 'tarjeta: base64 inválido' };
  const buffer = Buffer.from(b64, 'base64');
  if (buffer.length > MEDIA_MAX_BYTES) return { ok: false, message: `tarjeta: pesa ${Math.round(buffer.length / 1024)} KB y el máximo es ${Math.round(MEDIA_MAX_BYTES / 1024)} KB` };
  const info = probeImage(buffer);
  if (!info || info.mime !== 'image/webp') return { ok: false, message: 'tarjeta: el contenido no es una imagen WebP válida' };
  if (info.width !== MEDIA_WIDTH || info.height !== MEDIA_HEIGHT) {
    return { ok: false, message: `tarjeta: debe medir ${MEDIA_WIDTH}x${MEDIA_HEIGHT} px (recibida ${info.width}x${info.height})` };
  }
  return { ok: true, buffer, value: { mime: 'image/webp', base64: b64, sha256: createHash('sha256').update(buffer).digest('hex'), bytes: buffer.length } };
}

// ---- Claves canónicas de metadata_json ---------------------------------------------------------

export const DESCRIPCION_MAX = 4000;
const STEPS_MAX = 50;
const STEP_TITLE_MAX = 160;
const STEP_BODY_MAX = 4000;

/** Alias de ingesta -> clave canónica que entiende el cliente. Si ya viene la canónica con valor, esa manda. */
export const ATTRIBUTE_ALIASES: Readonly<Record<string, string>> = {
  fabricante: 'marca',
  asientos: 'plazas',
  cargador: 'municion',
  lugar: 'ubicacion',
};
/** Claves de metadata que son ruido del pipeline: nunca llegan a `metadata_json` público. */
export const PIPELINE_NOISE_KEYS = ['requiere_redaccion', 'estado_verificacion', 'stats_verificadas', 'howto_pendiente', 'fuente_ruta', 'fuente_dato'] as const;
const DESCRIPCION_KEYS = ['descripcion', 'descripcion_es', 'description', 'summary'] as const;

const isBlank = (v: unknown): boolean => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
const TEMPLATE_NOTE = /^\s*redactar\b/i;
const isTemplateNote = (v: unknown): boolean => (Array.isArray(v) ? v.length > 0 && v.every(isTemplateNote) : typeof v === 'string' && TEMPLATE_NOTE.test(v));
const firstText = (o: Record<string, unknown>, keys: string[]): string => {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
};

export interface CanonicalizeInput {
  metadata: Record<string, unknown>;
  /** Alias a 1er nivel de la ficha. */
  top?: {
    descripcion?: string | null;
    descripcion_es?: string | null;
    description?: string | null;
    summary?: string | null;
    steps?: unknown[] | null;
    pasos?: unknown[] | null;
    capturaPropiaPendiente?: boolean;
  };
}
export type CanonicalizeResult =
  | { ok: true; metadata: Record<string, unknown>; capturaPropiaPendiente: boolean; avisos: string[] }
  | { ok: false; message: string };

/**
 * Función pura: lleva `metadata` + alias de 1er nivel a las claves canónicas de `metadata_json` (tabla en
 * docs/LeonidApp-Arquitectura-Datos-MongoDB.md §2.4): descripcion (<= 4000), steps [{id?, title, body}], alias de atributos,
 * sin nulos/vacíos y sin ruido de pipeline. `captura_propia_pendiente` sale como flag del servidor.
 */
export function canonicalizeMetadata(input: CanonicalizeInput): CanonicalizeResult {
  const top = input.top ?? {};
  const meta: Record<string, unknown> = { ...input.metadata };
  const avisos: string[] = [];

  let captura = top.capturaPropiaPendiente === true;
  for (const k of ['captura_propia_pendiente', 'capturaPropiaPendiente']) {
    if (k in meta) {
      if (meta[k] === true) captura = true;
      delete meta[k];
    }
  }

  // Descripción: 1er nivel (descripcion, descripcion_es, description, summary) y luego metadata (mismo orden).
  const candidates = [top.descripcion, top.descripcion_es, top.description, top.summary, ...DESCRIPCION_KEYS.map((k) => meta[k])];
  for (const k of DESCRIPCION_KEYS) delete meta[k];
  const found = candidates.find((v) => !isBlank(v));
  if (found !== undefined) {
    if (typeof found !== 'string') return { ok: false, message: 'descripcion debe ser texto' };
    const text = found.trim();
    if (text.length > DESCRIPCION_MAX) return { ok: false, message: `descripcion supera ${DESCRIPCION_MAX} caracteres (${text.length})` };
    meta['descripcion'] = text;
  }

  // Pasos: steps/pasos a 1er nivel o en metadata -> metadata.steps [{id?, title, body}] (sin duplicar `pasos`).
  const rawSteps = [top.steps, top.pasos, meta['steps'], meta['pasos']].find((v) => Array.isArray(v) && v.length > 0) as unknown[] | undefined;
  delete meta['steps'];
  delete meta['pasos'];
  if (rawSteps) {
    if (rawSteps.length > STEPS_MAX) return { ok: false, message: `steps supera ${STEPS_MAX} pasos (${rawSteps.length})` };
    const steps: Array<{ id?: string; title: string; body: string }> = [];
    for (const [i, item] of rawSteps.entries()) {
      let title = '';
      let body = '';
      let id: string | undefined;
      if (typeof item === 'string') body = item.trim();
      else if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
        const o = item as Record<string, unknown>;
        title = firstText(o, ['titulo', 'title', 'name', 'nombre']);
        body = firstText(o, ['texto', 'body', 'text', 'descripcion', 'description']);
        if (typeof o['id'] === 'string' && /^[\w-]{1,60}$/.test(o['id'])) id = o['id'];
      }
      if (!title && !body) {
        avisos.push(`steps[${i}] vacío o con forma no válida: descartado`);
        continue;
      }
      if (!title) title = `Paso ${steps.length + 1}`;
      if (title.length > STEP_TITLE_MAX) return { ok: false, message: `steps[${i}].title supera ${STEP_TITLE_MAX} caracteres` };
      if (body.length > STEP_BODY_MAX) return { ok: false, message: `steps[${i}].body supera ${STEP_BODY_MAX} caracteres` };
      steps.push({ ...(id ? { id } : {}), title, body });
    }
    if (steps.length > 0) meta['steps'] = steps;
  }

  // Alias de atributos (la clave canónica con valor gana) y ruido.
  for (const [alias, canon] of Object.entries(ATTRIBUTE_ALIASES)) {
    if (!(alias in meta)) continue;
    const v = meta[alias];
    delete meta[alias];
    if (!isBlank(v) && isBlank(meta[canon])) meta[canon] = v;
  }
  for (const k of PIPELINE_NOISE_KEYS) delete meta[k];
  if (isTemplateNote(meta['notas'])) delete meta['notas'];

  // Sin nulos ni textos vacíos.
  for (const [k, v] of Object.entries(meta)) if (isBlank(v)) delete meta[k];
  return { ok: true, metadata: meta, capturaPropiaPendiente: captura, avisos };
}

// ---- Normalizacion de una ficha ----------------------------------------------------------------

const entityContentSchema = entitySchema.omit({ id: true, manualEdits: true, capturaPropiaPendiente: true, contentHash: true });
export type EntityContent = z.infer<typeof entityContentSchema>;
export type NormalizedFicha =
  | {
      ok: true;
      doc: EntityContent;
      marker: MapMarkerDTO | null;
      /** Flag del servidor: la ficha aún no tiene captura propia (viene de `capturaPropiaPendiente`/`captura_propia_pendiente`). */
      capturaPropiaPendiente: boolean;
      tarjeta: ParsedTarjeta | null;
      avisos: string[];
    }
  | { ok: false; message: string };
type NormalizedOk = Extract<NormalizedFicha, { ok: true }>;

/** Hash de ingesta de una ficha normalizada (contenido canónico + marker + sha256 de la tarjeta, solo si existen). */
export function ficheHashOf(n: NormalizedOk, fallbackImage?: string | null): string {
  const m = n.marker;
  return contentHashOf(canonicalOf(n.doc, fallbackImage), {
    marker: m ? { region: m.region, coord_x: m.coord_x, coord_y: m.coord_y, descripcion: m.descripcion ?? null, ...(m.slug ? { slug: m.slug } : {}) } : null,
    tarjetaSha256: n.tarjeta?.sha256 ?? null,
  });
}

const issuesText = (e: z.ZodError): string => e.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ');

/** Ficha editorial -> documento Entity (+ marcador validado). Stats de UI en 0-100; el valor exacto 0-10 queda en metadata. */
export function normalizeFicha(f: Ficha | PipelineFicha, source: string, module_id: string): NormalizedFicha {
  // "" equivale a "sin imagen": se normaliza a null (como un null explícito, canonicalOf conserva la existente).
  const imagen = f.imagen_url === '' ? null : f.imagen_url;
  if (imagen) {
    const bad = imagePathError(imagen);
    if (bad) return { ok: false, message: bad };
  }
  const canon = canonicalizeMetadata({
    metadata: f.metadata,
    top: {
      descripcion: f.descripcion,
      descripcion_es: f.descripcion_es,
      description: f.description,
      summary: f.summary,
      steps: f.steps,
      pasos: f.pasos,
      ...(f.capturaPropiaPendiente !== undefined ? { capturaPropiaPendiente: f.capturaPropiaPendiente } : {}),
    },
  });
  if (!canon.ok) return { ok: false, message: canon.message };
  const avisos = [...canon.avisos];
  for (const k of Object.keys(f)) if (!KNOWN_TOP_KEYS.has(k)) avisos.push(`clave de primer nivel desconocida "${k}": ignorada`);
  let tarjeta: ParsedTarjeta | null = null;
  if (f.tarjeta) {
    if (imagen) return { ok: false, message: 'tarjeta e imagen_url son excluyentes: envía solo una' };
    const t = parseTarjeta(f.tarjeta);
    if (!t.ok) return { ok: false, message: t.message };
    tarjeta = t.value;
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
      ...canon.metadata,
      stats_juego: f.stats_juego,
      ...(f.notas !== undefined && !isTemplateNote(f.notas) ? { notas: f.notas } : {}),
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
  return { ok: true, doc: parsed.data, marker, capturaPropiaPendiente: canon.capturaPropiaPendiente, tarjeta, avisos };
}

// ---- Ingesta por lotes (pipeline) --------------------------------------------------------------

/** Una ejecución en `queued`/`running` sin cerrar tras este tiempo se considera caída. */
export const RUN_STALE_MS = 15 * 60 * 1000;

export type IngestResultado = 'nueva' | 'actualizada' | 'conflicto' | 'rechazada';
export interface IngestDetail {
  slug: string;
  resultado: IngestResultado;
  motivo?: string;
  /** Avisos no bloqueantes (claves desconocidas ignoradas, pasos descartados). */
  avisos?: string[];
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

export const sameJson = (a: unknown, b: unknown): boolean => stable(a ?? null) === stable(b ?? null);

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
        const hash = ficheHashOf(n, existing?.imagen_url);
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
            // Excepción de transición (D-03): un extracto externo antiguo (confianza 'baja') sin ediciones a mano
            // se actualiza; las fichas editoriales (confianza media/alta) o editadas a mano siguen en conflicto.
            const prevConfianza = (existing.metadata_json as Record<string, unknown> | undefined)?.['confianza'];
            if (prevConfianza === 'baja' && (existing.manualEdits ?? []).length === 0) {
              reason = 'actualizada';
              motivo = `sustituye un extracto de confianza baja de la fuente "${prevSource}"`;
            } else {
              reason = 'conflicto';
              motivo = `la ficha pertenece a la fuente "${prevSource}"`;
            }
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
                ...(reason === 'nueva' ? { capturaPropiaPendiente: incoming.imagen_url === null || n.capturaPropiaPendiente } : n.capturaPropiaPendiente ? { capturaPropiaPendiente: true } : {}),
                ...(f.marker ? { marker: f.marker } : {}),
                ...(n.tarjeta ? { tarjeta: n.tarjeta } : {}),
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
        details.push({ slug: f.slug, resultado: reason, ...(note ? { motivo: note } : {}), ...(n.avisos.length ? { avisos: n.avisos } : {}) });
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
