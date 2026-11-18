import { model, Schema, type Model } from 'mongoose';
import { z } from 'zod';

/** Coleccion nueva autorizada: singleton con key 'global'. */
export const appConfigSchema = z.object({
  maintenance_mode: z.boolean(),
  announcement: z.string().max(500).nullable(),
  feature_flags: z.record(z.string(), z.boolean()),
  enabled_auth_providers: z.array(z.enum(['google', 'discord', 'apple', 'magic-link'])).max(4),
});
export type AppConfigDTO = z.infer<typeof appConfigSchema>;
export const appConfigUpdateSchema = appConfigSchema.partial();

export interface AppConfigDoc extends AppConfigDTO {
  key: 'global';
  updatedAt: Date;
}

const s = new Schema<AppConfigDoc>(
  {
    key: { type: String, required: true, unique: true, default: 'global' },
    maintenance_mode: { type: Boolean, default: false },
    announcement: { type: String, default: null },
    feature_flags: { type: Schema.Types.Mixed, default: {} },
    enabled_auth_providers: { type: [String], default: ['google', 'discord', 'apple', 'magic-link'] },
  },
  { timestamps: { createdAt: false, updatedAt: 'updatedAt' }, versionKey: false, minimize: false },
);

export const AppConfig: Model<AppConfigDoc> = model<AppConfigDoc>('AppConfig', s);
export default AppConfig;

export async function getGlobalConfig(): Promise<AppConfigDoc> {
  const doc = await AppConfig.findOneAndUpdate(
    { key: 'global' },
    { $setOnInsert: { key: 'global' } },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
  ).lean<AppConfigDoc>();
  if (!doc) throw new Error('No se pudo inicializar AppConfig');
  return doc;
}
