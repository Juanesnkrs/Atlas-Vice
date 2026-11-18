import { model, Schema, type Model } from 'mongoose';
import { z } from 'zod';
import { createdOnly, idField, jsonRecordSchema } from './common.js';

export const entitySchema = z.object({
  id: z.uuid().optional(),
  module_id: z.uuid(),
  titulo: z.string().min(1).max(160),
  subtitulo: z.string().max(240).nullable().optional(),
  categoria: z.string().min(1).max(80),
  imagen_url: z.string().nullable().optional(),
  stats_json: jsonRecordSchema.default({}),
  metadata_json: jsonRecordSchema.default({}),
});
export type EntityDTO = z.infer<typeof entitySchema>;
export const entityUpdateSchema = entitySchema.partial();

export interface EntityDoc {
  _id: string;
  module_id: string;
  titulo: string;
  subtitulo?: string | null;
  categoria: string;
  imagen_url?: string | null;
  stats_json: Record<string, unknown>;
  metadata_json: Record<string, unknown>;
  created_at: Date;
}

const s = new Schema<EntityDoc>(
  {
    _id: idField,
    module_id: { type: String, required: true, ref: 'Module' },
    titulo: { type: String, required: true },
    subtitulo: { type: String, default: null },
    categoria: { type: String, required: true },
    imagen_url: { type: String, default: null },
    stats_json: { type: Schema.Types.Mixed, default: {} },
    metadata_json: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: createdOnly, versionKey: false, minimize: false },
);
s.index({ module_id: 1, categoria: 1 });

export const Entity: Model<EntityDoc> = model<EntityDoc>('Entity', s);
export default Entity;

export const toEntityDTO = (e: EntityDoc) => ({
  id: e._id,
  module_id: e.module_id,
  titulo: e.titulo,
  subtitulo: e.subtitulo ?? null,
  categoria: e.categoria,
  imagen_url: e.imagen_url ?? null,
  stats_json: e.stats_json ?? {},
  metadata_json: e.metadata_json ?? {},
  created_at: e.created_at?.toISOString(),
});
