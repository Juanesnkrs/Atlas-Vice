import { model, Schema, type Model } from 'mongoose';
import { z } from 'zod';
import { createdOnly, idField, jsonRecordSchema } from './common.js';

export const slugSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(120);

export const entitySchema = z.object({
  id: z.uuid().optional(),
  module_id: z.uuid(),
  slug: slugSchema,
  titulo: z.string().min(1).max(160),
  subtitulo: z.string().max(240).nullable().optional(),
  categoria: z.string().min(1).max(80),
  imagen_url: z.string().nullable().optional(),
  stats_json: jsonRecordSchema.default({}),
  metadata_json: jsonRecordSchema.default({}),
  /** SHA-256 del contenido canonico (Arquitectura §2.4). Lo calcula el pipeline/servidor; no es editable por el cliente. */
  contentHash: z.string().regex(/^[a-f0-9]{64}$/).nullable().optional(),
  /** Campos editados a mano en /_staff: el pipeline nunca los sobrescribe. */
  manualEdits: z.array(z.string().max(60)).default([]),
  capturaPropiaPendiente: z.boolean().default(false),
});
export type EntityDTO = z.infer<typeof entitySchema>;
/** Sin `.default()`: un PATCH parcial no debe vaciar `stats_json` ni `metadata_json`. */
export const entityUpdateSchema = entitySchema
  .extend({
    stats_json: jsonRecordSchema,
    metadata_json: jsonRecordSchema,
    manualEdits: z.array(z.string().max(60)),
    capturaPropiaPendiente: z.boolean(),
  })
  .partial();

export interface EntityDoc {
  _id: string;
  module_id: string;
  slug: string;
  titulo: string;
  subtitulo?: string | null;
  categoria: string;
  imagen_url?: string | null;
  stats_json: Record<string, unknown>;
  metadata_json: Record<string, unknown>;
  contentHash?: string | null;
  manualEdits?: string[];
  capturaPropiaPendiente?: boolean;
  created_at: Date;
}

const s = new Schema<EntityDoc>(
  {
    _id: idField,
    module_id: { type: String, required: true, ref: 'Module' },
    slug: { type: String, required: true },
    titulo: { type: String, required: true },
    subtitulo: { type: String, default: null },
    categoria: { type: String, required: true },
    imagen_url: { type: String, default: null },
    stats_json: { type: Schema.Types.Mixed, default: {} },
    metadata_json: { type: Schema.Types.Mixed, default: {} },
    contentHash: { type: String, default: null },
    manualEdits: { type: [String], default: [] },
    capturaPropiaPendiente: { type: Boolean, default: false },
  },
  { timestamps: createdOnly, versionKey: false, minimize: false },
);
s.index({ module_id: 1, categoria: 1 });
s.index({ module_id: 1, slug: 1 }, { unique: true });

export const Entity: Model<EntityDoc> = model<EntityDoc>('Entity', s);
export default Entity;

export const toEntityDTO = (e: EntityDoc) => ({
  id: e._id,
  module_id: e.module_id,
  slug: e.slug,
  titulo: e.titulo,
  subtitulo: e.subtitulo ?? null,
  categoria: e.categoria,
  imagen_url: e.imagen_url ?? null,
  stats_json: e.stats_json ?? {},
  metadata_json: e.metadata_json ?? {},
  capturaPropiaPendiente: e.capturaPropiaPendiente === true,
  created_at: e.created_at?.toISOString(),
});
