import type { FastifyInstance, FastifyRequest } from 'fastify';
import { requireStaffRole } from '../plugins/auth.js';
import {
  AppConfig,
  getGlobalConfig,
  HERO_MAX_SLIDES,
  heroSlideSchema,
  heroSlidesWriteSchema,
  normalizeHeroOrder,
  type HeroSlideDTO,
} from '../models/AppConfig.js';
import { MediaAsset } from '../models/MediaAsset.js';
import { diffFields, writeAudit } from '../services/audit.js';
import { sendPublicJson } from '../services/httpCache.js';
import { clearSsrCache } from '../services/ssrLite.js';
import { parse } from '../services/validate.js';

const OWN_MEDIA_RE = /^\/media\/([0-9a-f-]{36})$/;

/** Lectura tolerante: descarta las entradas guardadas que ya no validan y devuelve el resto ordenado. */
function readSlides(raw: unknown): HeroSlideDTO[] {
  if (!Array.isArray(raw)) return [];
  const ok: HeroSlideDTO[] = [];
  for (const item of raw) {
    const r = heroSlideSchema.safeParse(item);
    if (r.success) ok.push(r.data);
  }
  return normalizeHeroOrder(ok);
}

/** Ids de las imagenes propias (`/media/<uuid>`) referenciadas por una lista de diapositivas. */
function ownMediaIds(raw: unknown): Set<string> {
  const ids = new Set<string>();
  if (!Array.isArray(raw)) return ids;
  for (const s of raw) {
    const url = (s as { imagen_url?: unknown } | null)?.imagen_url;
    const id = typeof url === 'string' ? OWN_MEDIA_RE.exec(url)?.[1] : undefined;
    if (id) ids.add(id);
  }
  return ids;
}

/** Best effort: borra los MediaAsset que ninguna diapositiva referencia ya y deja rastro de cada borrado. */
async function deleteOrphans(req: FastifyRequest, before: Set<string>, after: Set<string>): Promise<void> {
  for (const id of before) {
    if (after.has(id)) continue;
    try {
      const gone = await MediaAsset.findOneAndDelete({ _id: id }, { projection: { data: 0 } }).lean();
      if (gone) await writeAudit(req, 'media.delete', 'MediaAsset', id, { mime: gone.mime, bytes: gone.bytes });
    } catch (err) {
      req.log.warn({ err, id }, 'No se pudo eliminar la imagen huerfana del Hero');
    }
  }
}

export async function registerHeroRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/hero', async (req, reply) => {
    const c = await getGlobalConfig();
    const slides = readSlides(c.hero_slides)
      .filter((s) => s.activa)
      .map(({ activa: _activa, orden: _orden, ...pub }) => pub);
    return sendPublicJson(req, reply, { slides }, 30);
  });

  app.get('/api/admin/hero', { onRequest: requireStaffRole('ADMIN') }, async (_req, reply) => {
    const c = await getGlobalConfig();
    return reply.header('Cache-Control', 'private, no-store').send({ slides: readSlides(c.hero_slides), max: HERO_MAX_SLIDES });
  });

  app.put('/api/admin/hero', { onRequest: requireStaffRole('ADMIN') }, async (req) => {
    const { slides } = parse(heroSlidesWriteSchema, req.body);
    const next = normalizeHeroOrder(slides);
    const prev = await getGlobalConfig();
    const prevRaw: unknown = prev.hero_slides ?? [];
    await AppConfig.findOneAndUpdate({ key: 'global' }, { $set: { hero_slides: next } });
    await writeAudit(req, 'hero.update', 'AppConfig', 'global', diffFields({ hero_slides: prevRaw }, { hero_slides: next }));
    clearSsrCache();
    await deleteOrphans(req, ownMediaIds(prevRaw), ownMediaIds(next));
    return { slides: next };
  });
}
