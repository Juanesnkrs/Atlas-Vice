import { model, Schema, type Model } from 'mongoose';
import { z } from 'zod';
import { idField, jsonRecordSchema } from './common.js';

/** Coleccion nueva autorizada: aportes comunitarios moderados + bandeja de Footer. */
export const SUBMISSION_STATUSES = ['pending', 'approved', 'rejected'] as const;
export const submissionStatusSchema = z.enum(SUBMISSION_STATUSES);

export const SUBMISSION_TYPES = ['marker', 'entity', 'correction', 'contact', 'newsletter'] as const;
export type SubmissionType = (typeof SUBMISSION_TYPES)[number];
export const submissionTypeSchema = z.enum(SUBMISSION_TYPES);
/** Tipos de Footer: admiten invitados (userId null) y nunca se promueven. */
export const FOOTER_SUBMISSION_TYPES = ['contact', 'newsletter'] as const;
export const isFooterType = (t: string): boolean => (FOOTER_SUBMISSION_TYPES as readonly string[]).includes(t);

const coordsSchema = z.object({ x: z.number().min(0).max(1000), y: z.number().min(0).max(700) });

const submissionBase = z.object({
  moduleSlug: z.string().min(1).max(60),
  type: submissionTypeSchema,
  title: z.string().min(3).max(160),
  payload: jsonRecordSchema.default({}),
  coords: coordsSchema.nullable().default(null),
});

/** Entrada de usuarios con sesion (POST /api/submissions): solo aportes, no Footer. */
export const SUBMISSION_ORIGINS = ['user', 'pipeline'] as const;
export type SubmissionOrigin = (typeof SUBMISSION_ORIGINS)[number];

export const submissionCreateSchema = submissionBase
  .refine((v) => !isFooterType(v.type), { message: 'Tipo no permitido', path: ['type'] });
export type SubmissionCreate = z.infer<typeof submissionCreateSchema>;

/** Esquema completo del documento: userId null solo para contact/newsletter. */
export const submissionSchema = submissionBase
  .extend({
    id: z.uuid().optional(),
    userId: z.uuid().nullable(),
    origin: z.enum(SUBMISSION_ORIGINS).default('user'),
    status: submissionStatusSchema.default('pending'),
    reviewedBy: z.union([z.uuid(), z.literal('system')]).nullable().default(null),
    promotedTo: z
      .object({ collection: z.enum(['MapMarker', 'Entity']), id: z.string() })
      .nullable()
      .default(null),
    reviewNote: z.string().trim().max(500).optional(),
    createdAt: z.coerce.date().optional(),
  })
  .refine((v) => v.userId !== null || isFooterType(v.type) || v.origin === 'pipeline', {
    message: 'userId solo puede ser null en contact/newsletter o con origin pipeline',
    path: ['userId'],
  });
export type SubmissionDTO = z.infer<typeof submissionSchema>;
/** reviewNote (motivo de rechazo) solo aplica a `rejected`; coords (ubicacion del pin) solo a `approved`. */
export const submissionReviewSchema = z
  .object({ status: z.enum(['approved', 'rejected']), reviewNote: z.string().trim().max(500).optional(), coords: coordsSchema.optional() })
  .refine((v) => v.status === 'rejected' || v.reviewNote === undefined, { message: 'reviewNote solo se admite al rechazar', path: ['reviewNote'] })
  .refine((v) => v.status === 'approved' || v.coords === undefined, { message: 'coords solo se admite al aprobar', path: ['coords'] });

export interface SubmissionDoc {
  _id: string;
  userId: string | null;
  origin?: SubmissionOrigin;
  moduleSlug: string;
  type: SubmissionType;
  title: string;
  payload: Record<string, unknown>;
  coords: { x: number; y: number } | null;
  status: (typeof SUBMISSION_STATUSES)[number];
  reviewedBy: string | null;
  promotedTo: { collection: 'MapMarker' | 'Entity'; id: string } | null;
  reviewNote?: string;
  createdAt: Date;
}

const s = new Schema<SubmissionDoc>(
  {
    _id: idField,
    userId: { type: String, default: null, index: true },
    origin: { type: String, enum: SUBMISSION_ORIGINS, default: 'user' },
    moduleSlug: { type: String, required: true },
    type: { type: String, enum: SUBMISSION_TYPES, required: true },
    title: { type: String, required: true },
    payload: { type: Schema.Types.Mixed, default: {} },
    coords: { type: Schema.Types.Mixed, default: null },
    status: { type: String, enum: SUBMISSION_STATUSES, default: 'pending' },
    reviewedBy: { type: String, default: null },
    promotedTo: { type: Schema.Types.Mixed, default: null },
    reviewNote: { type: String },
  },
  { timestamps: { createdAt: 'createdAt', updatedAt: false }, versionKey: false, minimize: false },
);
s.index({ status: 1, createdAt: -1 });
s.index({ origin: 1, status: 1, createdAt: -1 });
s.index({ origin: 1, 'payload.pipeline_run_id': 1, status: 1 });

export const Submission: Model<SubmissionDoc> = model<SubmissionDoc>('Submission', s);
export default Submission;

/** `payload.tarjeta` (imagen en base64) nunca viaja en JSON: se sustituye por sus metadatos `{ bytes, sha256 }`. */
function publicPayload(payload: Record<string, unknown> | undefined): Record<string, unknown> {
  const p = payload ?? {};
  const t = p['tarjeta'];
  if (t === undefined || t === null || typeof t !== 'object') return p;
  const { bytes, sha256 } = t as { bytes?: unknown; sha256?: unknown };
  return { ...p, tarjeta: { bytes: typeof bytes === 'number' ? bytes : 0, sha256: typeof sha256 === 'string' ? sha256 : null } };
}
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

export const toSubmissionDTO = (d: SubmissionDoc) => ({
  id: d._id,
  userId: d.userId ?? null,
  origin: d.origin ?? 'user',
  moduleSlug: d.moduleSlug,
  type: d.type,
  title: d.title,
  payload: publicPayload(d.payload),
  ...(d.origin === 'pipeline'
    ? {
        pipeline_reason: str(d.payload?.['pipeline_reason']),
        pipeline_run_id: str(d.payload?.['pipeline_run_id']),
        conflict_fields: Array.isArray(d.payload?.['conflict_fields']) ? (d.payload['conflict_fields'] as unknown[]).filter((x): x is string => typeof x === 'string') : [],
      }
    : {}),
  coords: d.coords ?? null,
  status: d.status,
  reviewedBy: d.reviewedBy ?? null,
  promotedTo: d.promotedTo ?? null,
  ...(d.reviewNote ? { reviewNote: d.reviewNote } : {}),
  createdAt: d.createdAt?.toISOString(),
});
