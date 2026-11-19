import { model, Schema, type Model } from 'mongoose';
import { z } from 'zod';
import { idField } from './common.js';

export const PROGRESS_TARGETS = ['ENTITY', 'MARKER'] as const;
export type ProgressTargetType = (typeof PROGRESS_TARGETS)[number];

/** `entity_id` / `marker_id` del DER se unifican en target_type + target_id (unicidad por usuario y objetivo). */
export const userProgressSchema = z.object({
  target_type: z.enum(PROGRESS_TARGETS),
  target_id: z.uuid(),
  completado: z.boolean().default(true),
  updated_at: z.coerce.date().optional(),
});
export type UserProgressDTO = z.infer<typeof userProgressSchema>;
export const progressBatchSchema = z.object({ items: z.array(userProgressSchema).max(2000) });

export interface UserProgressDoc {
  _id: string;
  user_id: string;
  target_type: ProgressTargetType;
  target_id: string;
  completado: boolean;
  updated_at: Date;
}

const s = new Schema<UserProgressDoc>(
  {
    _id: idField,
    user_id: { type: String, required: true, ref: 'User' },
    target_type: { type: String, enum: PROGRESS_TARGETS, required: true },
    target_id: { type: String, required: true },
    completado: { type: Boolean, default: true },
    updated_at: { type: Date, default: () => new Date() },
  },
  { versionKey: false },
);
s.index({ user_id: 1, target_type: 1, target_id: 1 }, { unique: true });

export const UserProgress: Model<UserProgressDoc> = model<UserProgressDoc>('UserProgress', s);
export default UserProgress;

export const toProgressDTO = (p: UserProgressDoc) => ({
  target_type: p.target_type,
  target_id: p.target_id,
  completado: p.completado,
  updated_at: p.updated_at.toISOString(),
});
