import { model, Schema, type Model } from 'mongoose';
import { z } from 'zod';

export const AD_ROUTES = [
  '/catalogo/:categoria/:itemSlug',
  '/guias',
  '/guias/:slug',
  '/noticias',
  '/noticias/:slug',
  '/foro',
] as const;
export const AD_POSITIONS = ['in-article', 'after-content', 'sidebar'] as const;

/** Reglas de colocación: docs/LeonidApp-Rutas-SEO-Monetizacion.md §6. */
export const monetizationSchema = z.object({
  ads_enabled: z.boolean().default(false), // interruptor global
  provider: z.enum(['none', 'adsense']).default('none'),
  publisher_id: z.string().max(60).nullable().default(null), // p. ej. 'ca-pub-…'; no es secreto
  require_consent: z.literal(true).default(true), // sin consentimiento "Marketing" no se carga ningún script
  slots: z
    .array(
      z.object({
        id: z.string().min(1).max(40),
        // Los valores guardados con el nombre anterior de la ruta se normalizan al leerlos.
        route: z.preprocess((v) => (v === '/catalogo/:modulo/:slug' ? '/catalogo/:categoria/:itemSlug' : v), z.enum(AD_ROUTES)),
        position: z.enum(AD_POSITIONS),
        width: z.number().int().positive(), // reserva fija → CLS = 0
        height: z.number().int().positive(),
        enabled: z.boolean().default(true),
      }),
    )
    .max(20)
    .default([]),
});
export type MonetizationDTO = z.infer<typeof monetizationSchema>;

export const DEFAULT_MONETIZATION: MonetizationDTO = {
  ads_enabled: false,
  provider: 'none',
  publisher_id: null,
  require_consent: true,
  slots: [],
};

/** Coleccion nueva autorizada: singleton con key 'global'. */
export const appConfigSchema = z.object({
  maintenance_mode: z.boolean(),
  announcement: z.string().max(500).nullable(),
  feature_flags: z.record(z.string(), z.boolean()),
  enabled_auth_providers: z.array(z.enum(['google', 'discord', 'apple', 'magic-link'])).max(4),
  social_links: z.array(z.object({ platform: z.string().min(1).max(30), url: z.url() })).max(12),
  monetization: monetizationSchema,
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
    social_links: { type: Schema.Types.Mixed, default: [] },
    monetization: {
      type: Schema.Types.Mixed,
      default: () => ({ ...DEFAULT_MONETIZATION, slots: [] }),
    },
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
