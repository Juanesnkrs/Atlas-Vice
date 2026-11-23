import { model, Schema, type Model } from 'mongoose';
import { z } from 'zod';
import { idField } from './common.js';

export const PIPELINE_STATUSES = ['queued', 'running', 'ok', 'error'] as const;
export const PIPELINE_TRIGGERS = ['push', 'manual', 'scheduled'] as const;
/** Los ciclos del worker de noticias se registran con este `modulo` (no son lotes de catálogo). */
export const NEWS_RUN_MODULE = 'noticias';
/** Tope de motivos de rechazo guardados por ejecucion (Arquitectura §2.12). */
export const MAX_REJECTED_PER_RUN = 200;

const countSchema = z.number().int().min(0);

/** Registro de cada ejecucion del pipeline de datos y catalogo. docs/LeonidApp-Arquitectura-Datos-MongoDB.md §2.12. */
export const pipelineRunSchema = z.object({
  id: z.uuid().optional(),
  startedAt: z.coerce.date(),
  finishedAt: z.coerce.date().nullable(),
  status: z.enum(PIPELINE_STATUSES),
  trigger: z.enum(PIPELINE_TRIGGERS),
  source: z.string().min(1).max(40),
  modulo: z.string().min(1).max(60),
  archivo: z.string().max(160).nullable(),
  dryRun: z.boolean(),
  counts: z.object({ created: countSchema, updated: countSchema, unchanged: countSchema, conflicts: countSchema, rejected: countSchema }),
  rejected: z.array(z.object({ slug: z.string(), reason: z.string().max(300) })).max(MAX_REJECTED_PER_RUN),
});
export type PipelineRunDTO = z.infer<typeof pipelineRunSchema>;

export interface PipelineRunDoc {
  _id: string;
  startedAt: Date;
  finishedAt: Date | null;
  status: (typeof PIPELINE_STATUSES)[number];
  trigger: (typeof PIPELINE_TRIGGERS)[number];
  source: string;
  modulo: string;
  archivo: string | null;
  dryRun: boolean;
  counts: { created: number; updated: number; unchanged: number; conflicts: number; rejected: number };
  rejected: Array<{ slug: string; reason: string }>;
}

const num = { type: Number, default: 0 } as const;
const s = new Schema<PipelineRunDoc>(
  {
    _id: idField,
    startedAt: { type: Date, required: true, default: (): Date => new Date() },
    finishedAt: { type: Date, default: null },
    status: { type: String, enum: PIPELINE_STATUSES, required: true },
    trigger: { type: String, enum: PIPELINE_TRIGGERS, required: true },
    source: { type: String, required: true },
    modulo: { type: String, required: true },
    archivo: { type: String, default: null },
    dryRun: { type: Boolean, default: false },
    counts: {
      type: new Schema({ created: num, updated: num, unchanged: num, conflicts: num, rejected: num }, { _id: false }),
      default: () => ({}),
    },
    rejected: { type: [new Schema({ slug: String, reason: String }, { _id: false })], default: [] },
  },
  { versionKey: false, minimize: false },
);
s.index({ startedAt: -1 });

export const PipelineRun: Model<PipelineRunDoc> = model<PipelineRunDoc>('PipelineRun', s);
export default PipelineRun;

export const toPipelineRunDTO = (r: PipelineRunDoc) => ({
  id: r._id,
  startedAt: r.startedAt.toISOString(),
  finishedAt: r.finishedAt ? r.finishedAt.toISOString() : null,
  status: r.status,
  trigger: r.trigger,
  kind: r.modulo === NEWS_RUN_MODULE ? ('noticias' as const) : ('catalogo' as const),
  source: r.source,
  modulo: r.modulo,
  archivo: r.archivo ?? null,
  dryRun: r.dryRun,
  counts: r.counts,
  rejected: r.rejected ?? [],
});
