import { model, Schema, type Model } from 'mongoose';
import { z } from 'zod';
import { idField, jsonRecordSchema } from './common.js';

/** Coleccion nueva autorizada: aportes comunitarios moderados. */
export const SUBMISSION_STATUSES = ['pending', 'approved', 'rejected'] as const;
export const submissionStatusSchema = z.enum(SUBMISSION_STATUSES);

export const submissionCreateSchema = z.object({
  moduleSlug: z.string().min(1).max(60),
  type: z.string().min(1).max(60),
  title: z.string().min(3).max(160),
  payload: jsonRecordSchema.default({}),
  coords: z.object({ x: z.number(), y: z.number() }).nullable().default(null),
});
export type SubmissionCreate = z.infer<typeof submissionCreateSchema>;

export const submissionSchema = submissionCreateSchema.extend({
  id: z.uuid().optional(),
  userId: z.uuid(),
  status: submissionStatusSchema.default('pending'),
  reviewedBy: z.uuid().nullable().default(null),
  createdAt: z.coerce.date().optional(),
});
export type SubmissionDTO = z.infer<typeof submissionSchema>;
export const submissionReviewSchema = z.object({ status: z.enum(['approved', 'rejected']) });

export interface SubmissionDoc {
  _id: string;
  userId: string;
  moduleSlug: string;
  type: string;
  title: string;
  payload: Record<string, unknown>;
  coords: { x: number; y: number } | null;
  status: (typeof SUBMISSION_STATUSES)[number];
  reviewedBy: string | null;
  createdAt: Date;
}

const s = new Schema<SubmissionDoc>(
  {
    _id: idField,
    userId: { type: String, required: true, index: true },
    moduleSlug: { type: String, required: true },
    type: { type: String, required: true },
    title: { type: String, required: true },
    payload: { type: Schema.Types.Mixed, default: {} },
    coords: { type: Schema.Types.Mixed, default: null },
    status: { type: String, enum: SUBMISSION_STATUSES, default: 'pending' },
    reviewedBy: { type: String, default: null },
  },
  { timestamps: { createdAt: 'createdAt', updatedAt: false }, versionKey: false, minimize: false },
);
s.index({ status: 1, createdAt: -1 });

export const Submission: Model<SubmissionDoc> = model<SubmissionDoc>('Submission', s);
export default Submission;

export const toSubmissionDTO = (d: SubmissionDoc) => ({
  id: d._id,
  userId: d.userId,
  moduleSlug: d.moduleSlug,
  type: d.type,
  title: d.title,
  payload: d.payload ?? {},
  coords: d.coords ?? null,
  status: d.status,
  reviewedBy: d.reviewedBy ?? null,
  createdAt: d.createdAt?.toISOString(),
});
