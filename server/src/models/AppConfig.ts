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

/** Posiciones permitidas por ruta (Rutas-SEO-Monetizacion §6.1). */
export const AD_ALLOWED_POSITIONS: Record<(typeof AD_ROUTES)[number], readonly (typeof AD_POSITIONS)[number][]> = {
  '/catalogo/:categoria/:itemSlug': ['after-content'],
  '/guias': ['after-content'],
  '/guias/:slug': ['in-article', 'after-content', 'sidebar'],
  '/noticias': ['after-content'],
  '/noticias/:slug': ['after-content'],
  '/foro': ['after-content'],
};

/** Validacion estricta al GUARDAR (la lectura publica sigue usando `monetizationSchema`, tolerante). */
export const monetizationWriteSchema = monetizationSchema.superRefine((m, ctx) => {
  const ids = new Set<string>();
  const perRoute = new Map<string, number>();
  m.slots.forEach((s, i) => {
    if (ids.has(s.id)) ctx.addIssue({ code: 'custom', path: ['slots', i, 'id'], message: 'Id de slot duplicado' });
    ids.add(s.id);
    if (!AD_ALLOWED_POSITIONS[s.route].includes(s.position)) {
      ctx.addIssue({ code: 'custom', path: ['slots', i, 'position'], message: `Posicion no permitida en ${s.route}` });
    }
    if (s.enabled) {
      const n = (perRoute.get(s.route) ?? 0) + 1;
      perRoute.set(s.route, n);
      if (n > 2) ctx.addIssue({ code: 'custom', path: ['slots', i, 'route'], message: `Maximo 2 slots activos en ${s.route}` });
    }
  });
  if (m.ads_enabled && m.provider === 'adsense' && !m.publisher_id?.trim()) {
    ctx.addIssue({ code: 'custom', path: ['publisher_id'], message: 'AdSense requiere un publisher_id' });
  }
});

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
/** Escritura (PATCH): de 1 a 4 proveedores sin repetir, flags con nombre simple y monetizacion estricta. */
export const appConfigUpdateSchema = appConfigSchema
  .extend({
    enabled_auth_providers: z
      .array(z.enum(['google', 'discord', 'apple', 'magic-link']))
      .min(1, 'Debe quedar al menos un proveedor de acceso')
      .max(4)
      .refine((l) => new Set(l).size === l.length, 'Proveedores repetidos'),
    feature_flags: z
      .record(z.string().regex(/^[a-zA-Z0-9_.-]{1,40}$/, 'Nombre de flag invalido'), z.boolean())
      .refine((f) => Object.keys(f).length <= 50, 'Maximo 50 flags'),
    monetization: monetizationWriteSchema,
  })
  .partial();

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
