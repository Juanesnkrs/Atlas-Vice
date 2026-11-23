import { model, Schema, type Model } from 'mongoose';
import { z } from 'zod';
import { createdOnly, idField } from './common.js';

export const MEDIA_MIMES = ['image/webp', 'image/jpeg'] as const;
export const MEDIA_WIDTH = 1600;
export const MEDIA_HEIGHT = 900;
export const MEDIA_MAX_BYTES = 409_600;

/** Imagen subida desde el panel (solo diapositivas del Hero). docs/LeonidApp-Arquitectura-Datos-MongoDB.md §2.11. */
export const mediaAssetSchema = z.object({
  id: z.uuid().optional(),
  mime: z.enum(MEDIA_MIMES),
  width: z.literal(MEDIA_WIDTH),
  height: z.literal(MEDIA_HEIGHT),
  bytes: z.number().int().positive().max(MEDIA_MAX_BYTES),
  data: z.instanceof(Buffer),
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
    created_by: { type: String, required: true, ref: 'User' },
  },
  { timestamps: createdOnly, versionKey: false },
);

export const MediaAsset: Model<MediaAssetDoc> = model<MediaAssetDoc>('MediaAsset', s);
export default MediaAsset;
