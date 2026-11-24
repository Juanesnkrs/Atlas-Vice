import { model, Schema, type Model } from 'mongoose';
import { z } from 'zod';
import { createdOnly, idField } from './common.js';

export const MEDIA_MIMES = ['image/webp', 'image/jpeg'] as const;
export const MEDIA_WIDTH = 1600;
export const MEDIA_HEIGHT = 900;
/** Tope del Hero (canvas) y de la tarjeta del pipeline. */
export const MEDIA_MAX_BYTES = 409_600;
/** Tope del principal de una carga manual del Estudio de Imagenes (600 KB). */
export const MEDIA_MAX_BYTES_MANUAL = 614_400;
export const MEDIA_THUMB_WIDTH = 800;
export const MEDIA_THUMB_HEIGHT = 450;

/** Imagen subida desde el panel (solo diapositivas del Hero). docs/LeonidApp-Arquitectura-Datos-MongoDB.md §2.11. */
export const mediaAssetSchema = z.object({
  id: z.uuid().optional(),
  mime: z.enum(MEDIA_MIMES),
  width: z.literal(MEDIA_WIDTH),
  height: z.literal(MEDIA_HEIGHT),
  bytes: z.number().int().positive().max(MEDIA_MAX_BYTES_MANUAL),
  data: z.instanceof(Buffer),
  /** Variante movil opcional 800x450 (solo cargas manuales); los assets antiguos no la tienen. */
  thumb_data: z.instanceof(Buffer).optional(),
  thumb_bytes: z.number().int().positive().optional(),
  thumb_width: z.literal(MEDIA_THUMB_WIDTH).optional(),
  thumb_height: z.literal(MEDIA_THUMB_HEIGHT).optional(),
  /** UUID del usuario que la subió, o `'system'` si la crea `promote()` desde la tarjeta de una ficha del pipeline. */
  created_by: z.union([z.uuid(), z.literal('system')]),
  created_at: z.coerce.date().optional(),
});
export type MediaAssetDTO = z.infer<typeof mediaAssetSchema>;

export interface MediaAssetDoc {
  _id: string;
  mime: (typeof MEDIA_MIMES)[number];
  width: number;
  height: number;
  bytes: number;
  data: Buffer;
  thumb_data?: Buffer;
  thumb_bytes?: number;
  thumb_width?: number;
  thumb_height?: number;
  created_by: string;
  created_at: Date;
}

const s = new Schema<MediaAssetDoc>(
  {
    _id: idField,
    mime: { type: String, enum: MEDIA_MIMES, required: true },
    width: { type: Number, required: true },
    height: { type: Number, required: true },
    bytes: { type: Number, required: true },
    data: { type: Buffer, required: true },
    thumb_data: { type: Buffer },
    thumb_bytes: { type: Number },
    thumb_width: { type: Number },
    thumb_height: { type: Number },
    created_by: { type: String, required: true, ref: 'User' },
  },
  { timestamps: createdOnly, versionKey: false },
);

export const MediaAsset: Model<MediaAssetDoc> = model<MediaAssetDoc>('MediaAsset', s);
export default MediaAsset;
