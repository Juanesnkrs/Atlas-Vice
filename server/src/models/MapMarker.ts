import { model, Schema, type Model } from 'mongoose';
import { z } from 'zod';
import { createdOnly, idField } from './common.js';

export const mapMarkerSchema = z.object({
  id: z.uuid().optional(),
  entity_id: z.uuid().nullable().optional(),
  region: z.string().min(1).max(80),
  titulo: z.string().min(1).max(160),
  descripcion: z.string().max(2000).nullable().optional(),
  coord_x: z.number().finite(),
  coord_y: z.number().finite(),
  media_url: z.string().nullable().optional(),
});
export type MapMarkerDTO = z.infer<typeof mapMarkerSchema>;
export const mapMarkerUpdateSchema = mapMarkerSchema.partial();

export interface MapMarkerDoc {
  _id: string;
  entity_id?: string | null;
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
s.index({ coord: '2d' }, { min: -100000, max: 100000 });
s.index({ region: 1 });

export const MapMarker: Model<MapMarkerDoc> = model<MapMarkerDoc>('MapMarker', s);
export default MapMarker;

export const toMarkerDTO = (m: MapMarkerDoc) => ({
  id: m._id,
  entity_id: m.entity_id ?? null,
  region: m.region,
  titulo: m.titulo,
  descripcion: m.descripcion ?? null,
  coord_x: m.coord.x,
  coord_y: m.coord.y,
  media_url: m.media_url ?? null,
  created_at: m.created_at?.toISOString(),
});
