import { model, Schema, type Model } from 'mongoose';
import { z } from 'zod';
import { createdOnly, idField, jsonRecordSchema } from './common.js';

/** Schema Zod equivalente del modelo (convencion de metadata: Arquitectura §2.10). */
export const auditLogSchema = z.object({
  id: z.uuid().optional(),
  actor_id: z.string().min(1),
  actor_role: z.string().min(1),
  action: z.string().min(1),
  target_type: z.string().min(1),
  target_id: z.string().nullable(),
  metadata: jsonRecordSchema.default({}),
  ip: z.string().nullable(),
  created_at: z.coerce.date().optional(),
});
export type AuditLogDTO = z.infer<typeof auditLogSchema>;

export interface AuditLogDoc {
  _id: string;
  actor_id: string;
  actor_role: string;
  action: string;
  target_type: string;
  target_id: string | null;
  metadata: Record<string, unknown>;
  ip: string | null;
  created_at: Date;
}

const s = new Schema<AuditLogDoc>(
  {
    _id: idField,
    actor_id: { type: String, required: true },
    actor_role: { type: String, required: true },
    action: { type: String, required: true },
    target_type: { type: String, required: true },
    target_id: { type: String, default: null },
    metadata: { type: Schema.Types.Mixed, default: {} },
    ip: { type: String, default: null },
  },
  { timestamps: createdOnly, versionKey: false, minimize: false },
);
s.index({ created_at: -1 });
s.index({ actor_id: 1, created_at: -1 });
s.index({ target_type: 1, target_id: 1, created_at: -1 });

export const AuditLog: Model<AuditLogDoc> = model<AuditLogDoc>('AuditLog', s);
export default AuditLog;
