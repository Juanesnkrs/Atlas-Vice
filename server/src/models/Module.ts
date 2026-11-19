import { model, Schema, type Model } from 'mongoose';
import { z } from 'zod';
import { createdOnly, idField } from './common.js';

export const moduleSchema = z.object({
  id: z.uuid().optional(),
  slug: z.string().min(1).max(60),
  nombre: z.string().min(1).max(80),
  icono: z.string().min(1).max(60),
  activo: z.boolean().default(true),
  orden: z.number().int().default(0),
});
export type ModuleDTO = z.infer<typeof moduleSchema>;
export const moduleUpdateSchema = moduleSchema.partial();

export interface ModuleDoc {
  _id: string;
  slug: string;
  nombre: string;
  icono: string;
  activo: boolean;
  orden: number;
  created_at: Date;
}

const s = new Schema<ModuleDoc>(
  {
    _id: idField,
    slug: { type: String, required: true, unique: true },
    nombre: { type: String, required: true },
    icono: { type: String, required: true },
    activo: { type: Boolean, default: true },
    orden: { type: Number, default: 0 },
  },
  { timestamps: createdOnly, versionKey: false },
);

export const Module: Model<ModuleDoc> = model<ModuleDoc>('Module', s);
export default Module;

export const toModuleDTO = (m: ModuleDoc) => ({
  id: m._id,
  slug: m.slug,
  nombre: m.nombre,
  icono: m.icono,
  activo: m.activo,
  orden: m.orden,
  created_at: m.created_at?.toISOString(),
});
