import { model, Schema, type Model } from 'mongoose';
import { createdOnly, idField } from './common.js';

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

export const AuditLog: Model<AuditLogDoc> = model<AuditLogDoc>('AuditLog', s);
export default AuditLog;
