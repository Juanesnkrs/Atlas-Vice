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

const markerNeedsCoords = (v: { type: string; coords: unknown }): boolean => v.type !== 'marker' || v.coords !== null;

/** Entrada de usuarios con sesion (POST /api/submissions): solo aportes, no Footer. */
export const submissionCreateSchema = submissionBase
  .refine((v) => !isFooterType(v.type), { message: 'Tipo no permitido', path: ['type'] })
  .refine(markerNeedsCoords, { message: 'coords obligatorio para marker', path: ['coords'] });
export type SubmissionCreate = z.infer<typeof submissionCreateSchema>;

/** Esquema completo del documento: userId null solo para contact/newsletter. */
export const submissionSchema = submissionBase
  .extend({
    id: z.uuid().optional(),
    userId: z.uuid().nullable(),
    status: submissionStatusSchema.default('pending'),
    reviewedBy: z.union([z.uuid(), z.literal('system')]).nullable().default(null),
    promotedTo: z
      .object({ collection: z.enum(['MapMarker', 'Entity']), id: z.string() })
      .nullable()
      .default(null),
    createdAt: z.coerce.date().optional(),
  })
  .refine((v) => v.userId !== null || isFooterType(v.type), {
    message: 'userId solo puede ser null en contact/newsletter',
    path: ['userId'],
  })
  .refine(markerNeedsCoords, { message: 'coords obligatorio para marker', path: ['coords'] });
export type SubmissionDTO = z.infer<typeof submissionSchema>;
export const submissionReviewSchema = z.object({ status: z.enum(['approved', 'rejected']) });

export interface SubmissionDoc {
  _id: string;
  userId: string | null;
  moduleSlug: string;
  type: SubmissionType;
  title: string;
  payload: Record<string, unknown>;
  coords: { x: number; y: number } | null;
  status: (typeof SUBMISSION_STATUSES)[number];
  reviewedBy: string | null;
  promotedTo: { collection: 'MapMarker' | 'Entity'; id: string } | null;
  createdAt: Date;
}

const s = new Schema<SubmissionDoc>(
  {
    _id: idField,
    userId: { type: String, default: null, index: true },
    moduleSlug: { type: String, required: true },
    type: { type: String, enum: SUBMISSION_TYPES, required: true },
    title: { type: String, required: true },
    payload: { type: Schema.Types.Mixed, default: {} },
    coords: { type: Schema.Types.Mixed, default: null },
    status: { type: String, enum: SUBMISSION_STATUSES, default: 'pending' },
    reviewedBy: { type: String, default: null },
    promotedTo: { type: Schema.Types.Mixed, default: null },
  },
  { timestamps: { createdAt: 'createdAt', updatedAt: false }, versionKey: false, minimize: false },
);
s.index({ status: 1, createdAt: -1 });

export const Submission: Model<SubmissionDoc> = model<SubmissionDoc>('Submission', s);
export default Submission;

export const toSubmissionDTO = (d: SubmissionDoc) => ({
  id: d._id,
  userId: d.userId ?? null,
  moduleSlug: d.moduleSlug,
  type: d.type,
  title: d.title,
  payload: d.payload ?? {},
  coords: d.coords ?? null,
  status: d.status,
  reviewedBy: d.reviewedBy ?? null,
  promotedTo: d.promotedTo ?? null,
  createdAt: d.createdAt?.toISOString(),
});
