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

/** Ruta interna: '/mapa', '/guias?x=1'; nunca '//', esquemas ni espacios. */
const internalPath = z.string().regex(/^\/(?!\/)\S*$/,'Ruta interna invalida: debe empezar por / y no contener espacios');
/** Solo https: rechaza javascript:, data: y http:. */
const httpsUrl = z.url({ protocol: /^https$/, message: 'Debe ser un enlace https valido' });
const linkSchema = z.union([internalPath, httpsUrl]);

/** Diapositiva del carrusel del Hero (Arquitectura §2.2). `orden` lo normaliza el servidor al guardar. */
export const heroSlideSchema = z.object({
  id: z.uuid(),
  activa: z.boolean(),
  orden: z.number().int().min(0).max(99),
  kicker: z.string().trim().max(60).default(''),
  titulo: z.string().trim().min(1).max(90),
  descripcion: z.string().trim().min(1).max(220),
  boton_texto: z.string().trim().min(1).max(30),
  boton_enlace: linkSchema,
  boton_secundario_texto: z.string().trim().min(1).max(30).nullable().default(null),
  boton_secundario_enlace: linkSchema.nullable().default(null),
  imagen_url: z.union([z.string().regex(/^\/media\/[0-9a-f-]{36}$/, 'Imagen propia invalida'), httpsUrl]),
  imagen_alt: z.string().trim().min(1).max(140),
}).refine((s) => (s.boton_secundario_texto === null) === (s.boton_secundario_enlace === null), {
  path: ['boton_secundario_enlace'],
  message: 'El boton secundario necesita texto y enlace, o ninguno',
});
export type HeroSlideDTO = z.infer<typeof heroSlideSchema>;
export const HERO_MAX_SLIDES = 6;

/** Escritura (PUT /api/admin/hero): estricta, maximo 6 diapositivas e ids unicos. */
export const heroSlidesWriteSchema = z
  .object({
    slides: z
      .array(heroSlideSchema)
      .max(HERO_MAX_SLIDES, `Maximo ${HERO_MAX_SLIDES} diapositivas`)
      .superRefine((list, ctx) => {
        const ids = new Set<string>();
        list.forEach((s, i) => {
          if (ids.has(s.id)) ctx.addIssue({ code: 'custom', path: [i, 'id'], message: 'Id de diapositiva duplicado' });
          ids.add(s.id);
        });
      }),
  })
  .strict();

/** Ordena por `orden` (estable: a igualdad manda la posicion recibida) y reasigna `orden` a 0..n-1. */
export function normalizeHeroOrder(slides: readonly HeroSlideDTO[]): HeroSlideDTO[] {
  return slides
    .map((s, i) => ({ s, i }))
    .sort((a, b) => a.s.orden - b.s.orden || a.i - b.i)
    .map(({ s }, orden) => ({ ...s, orden }));
}

/** Coleccion nueva autorizada: singleton con key 'global'. */
export const appConfigSchema = z.object({
  maintenance_mode: z.boolean(),
  announcement: z.string().max(500).nullable(),
  feature_flags: z.record(z.string(), z.boolean()),
  enabled_auth_providers: z.array(z.enum(['google', 'discord', 'apple', 'magic-link'])).max(4),
  social_links: z.array(z.object({ platform: z.string().min(1).max(30), url: z.url() })).max(12),
  monetization: monetizationSchema,
  hero_slides: z.array(heroSlideSchema).max(HERO_MAX_SLIDES),
});
export type AppConfigDTO = z.infer<typeof appConfigSchema>;
/** Escritura (PATCH): de 1 a 4 proveedores sin repetir, flags con nombre simple y monetizacion estricta. */
export const appConfigUpdateSchema = appConfigSchema
  .omit({ hero_slides: true }) // el carrusel solo se escribe con PUT /api/admin/hero (ADMIN+)
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
    hero_slides: { type: Schema.Types.Mixed, default: () => [] },
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
