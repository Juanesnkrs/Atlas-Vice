import { model, Schema, type Model } from 'mongoose';
import { z } from 'zod';
import { createdOnly, idField } from './common.js';
import { slugSchema } from './Entity.js';

/** Lienzo del mapa: 0–1000 × 0–700 (ver docs/LeonidApp-Arquitectura-Datos-MongoDB.md §2.5). */
export const MAP_WIDTH = 1000;
export const MAP_HEIGHT = 700;

export const mapMarkerSchema = z.object({
  id: z.uuid().optional(),
  entity_id: z.uuid().nullable().optional(),
  slug: slugSchema.optional(),
  region: z.string().min(1).max(80),
  titulo: z.string().min(1).max(160),
  descripcion: z.string().max(2000).nullable().optional(),
  coord_x: z.number().min(0).max(MAP_WIDTH),
  coord_y: z.number().min(0).max(MAP_HEIGHT),
  media_url: z.string().nullable().optional(),
});
export type MapMarkerDTO = z.infer<typeof mapMarkerSchema>;
export const mapMarkerUpdateSchema = mapMarkerSchema.partial();

export interface MapMarkerDoc {
  _id: string;
  entity_id?: string | null;
  slug?: string;
  region: string;
  titulo: string;
  descripcion?: string | null;
  /** coord_x / coord_y del DER, agrupadas para el indice 2d. */
  coord: { x: number; y: number };
  media_url?: string | null;
  created_at: Date;
}

const s = new Schema<MapMarkerDoc>(
  {
    _id: idField,
    entity_id: { type: String, default: null, ref: 'Entity' },
    slug: { type: String },
    region: { type: String, required: true },
    titulo: { type: String, required: true },
    descripcion: { type: String, default: null },
    coord: {
      type: new Schema({ x: { type: Number, required: true }, y: { type: Number, required: true } }, { _id: false }),
      required: true,
    },
    media_url: { type: String, default: null },
  },
  { timestamps: createdOnly, versionKey: false },
);
s.index({ coord: '2d' }, { min: 0, max: MAP_WIDTH });
s.index({ region: 1 });
s.index({ slug: 1 }, { unique: true, sparse: true });

export const MapMarker: Model<MapMarkerDoc> = model<MapMarkerDoc>('MapMarker', s);
export default MapMarker;

export const toMarkerDTO = (m: MapMarkerDoc) => ({
  id: m._id,
  entity_id: m.entity_id ?? null,
  slug: m.slug ?? null,
  region: m.region,
  titulo: m.titulo,
  descripcion: m.descripcion ?? null,
  coord_x: m.coord.x,
  coord_y: m.coord.y,
  media_url: m.media_url ?? null,
  created_at: m.created_at?.toISOString(),
});
