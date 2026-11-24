import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { requireStaffRole } from '../plugins/auth.js';
import {
  MEDIA_HEIGHT,
  MEDIA_MAX_BYTES,
  MEDIA_MIMES,
  MEDIA_THUMB_HEIGHT,
  MEDIA_THUMB_WIDTH,
  MEDIA_WIDTH,
  MediaAsset,
} from '../models/MediaAsset.js';
import { Entity, type EntityDoc } from '../models/Entity.js';
import { Module, type ModuleDoc } from '../models/Module.js';
import { writeAudit } from '../services/audit.js';
import { withManualEdits } from '../services/catalogIngest.js';
import { probeImage } from '../services/imageProbe.js';
import { processManualImage, removeOrphanMedia } from '../services/imageStudio.js';
import { clearSsrCache } from '../services/ssrLite.js';
import { HttpError, idParamsSchema, parse, resourceNotFound } from '../services/validate.js';

/** Tope del cuerpo crudo: algo por encima de 400 KB para poder responder con un 400 legible en vez de cortar la conexion. */
const UPLOAD_BODY_LIMIT = 600 * 1024;
const idSchema = z.uuid();

/** Reemplazo manual de la imagen de una ficha: se acepta el original (JPG/PNG/WebP) y el servidor lo procesa (services/imageStudio.ts). */
const REPLACE_MIMES = ['image/jpeg', 'image/png', 'image/webp'] as const;
const REPLACE_BODY_LIMIT = 12 * 1024 * 1024;
const MATCH_MAX_SLUGS = 200;

const escapeRx = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** `?focus=x,y` (0-100) y `?alt=<texto>` (<= 200) de la carga manual. */
const uploadQuerySchema = z.object({
  focus: z
    .string()
    .regex(/^\d{1,3}(?:\.\d+)?,\d{1,3}(?:\.\d+)?$/, 'focus debe ser "x,y" con valores de 0 a 100')
    .transform((v) => {
      const [x = '50', y = '50'] = v.split(',');
      return { x: Number(x), y: Number(y) };
    })
    .refine((f) => f.x <= 100 && f.y <= 100, 'focus debe estar entre 0 y 100')
    .optional(),
  alt: z.string().trim().max(200).optional(),
});

const queueQuerySchema = z.object({
  module: z.string().trim().min(1).max(60).optional(),
  q: z.string().trim().max(120).optional(),
  estado: z.enum(['pendientes', 'todas']).default('pendientes'),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const matchQuerySchema = z.object({
  slugs: z.string().min(1).max(MATCH_MAX_SLUGS * 130),
  module: z.string().trim().min(1).max(60).optional(),
});

const mimeOf = (header: string | undefined): string => (header ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
const kb = (bytes: number): string => `${Math.round(bytes / 1024)} KB`;
const etagMatches = (header: string | undefined, etag: string): boolean =>
  !!header && header.split(',').some((t) => t.trim() === etag || t.trim() === `W/${etag}`);

const notFound = (reply: FastifyReply): FastifyReply =>
  reply.code(404).header('Cache-Control', 'no-store').type('text/plain; charset=utf-8').send('No encontrado');

export async function registerMediaRoutes(app: FastifyInstance): Promise<void> {
  // La subida vive en un contexto encapsulado: su parser binario no afecta a los parsers globales (JSON, formulario).
  await app.register(async (scope) => {
    scope.addContentTypeParser([...MEDIA_MIMES], { parseAs: 'buffer', bodyLimit: UPLOAD_BODY_LIMIT }, (_req, body, done) => {
      done(null, body);
    });

    scope.post(
      '/api/admin/media',
      // `onRequest` corre antes del parser de cuerpo: sin staff ADMIN+ el 404 es uniforme aunque el Content-Type sea image/*.
      { onRequest: requireStaffRole('ADMIN'), bodyLimit: UPLOAD_BODY_LIMIT, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
      async (req, reply) => {
        const actor = req.authUser;
        if (!actor) throw new HttpError(404, 'No encontrado');
        const declared = mimeOf(req.headers['content-type']);
        const body = req.body;
        if (!Buffer.isBuffer(body) || body.length === 0) throw new HttpError(400, 'No se recibio ninguna imagen');
        if (body.length > MEDIA_MAX_BYTES) {
          throw new HttpError(400, `La imagen pesa ${kb(body.length)} y el maximo permitido es ${kb(MEDIA_MAX_BYTES)}`);
        }
        const info = probeImage(body);
        if (!info) throw new HttpError(400, 'El archivo no es una imagen WebP o JPEG valida');
        if (info.mime !== declared) {
          throw new HttpError(400, 'El contenido del archivo no coincide con el tipo de imagen declarado');
        }
        if (info.width !== MEDIA_WIDTH || info.height !== MEDIA_HEIGHT) {
          throw new HttpError(
            400,
            `La imagen debe medir exactamente ${MEDIA_WIDTH} × ${MEDIA_HEIGHT} px (recibida ${info.width} × ${info.height})`,
          );
        }
        const doc = await MediaAsset.create({
          mime: info.mime,
          width: info.width,
          height: info.height,
          bytes: body.length,
          data: body,
          created_by: actor._id,
        });
        const out = { id: doc._id, url: `/media/${doc._id}`, mime: info.mime, width: info.width, height: info.height, bytes: body.length };
        await writeAudit(req, 'media.upload', 'MediaAsset', doc._id, { mime: out.mime, width: out.width, height: out.height, bytes: out.bytes });
        return reply.code(201).send(out);
      },
    );
  });

  // Reemplazo manual de imagen de una ficha publicada (panel /_staff). Contexto propio: parser binario JPG/PNG/WebP.
  await app.register(async (scope) => {
    scope.addContentTypeParser([...REPLACE_MIMES], { parseAs: 'buffer', bodyLimit: REPLACE_BODY_LIMIT }, (_req, body, done) => {
      done(null, body);
    });

    scope.post(
      '/api/admin/entities/:id/image',
      { onRequest: requireStaffRole('ADMIN'), bodyLimit: REPLACE_BODY_LIMIT, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
      async (req, reply) => {
        const actor = req.authUser;
        if (!actor) throw new HttpError(404, 'No encontrado');
        const { id } = parse(idParamsSchema, req.params);
        const q = parse(uploadQuerySchema, req.query);
        const body = req.body;
        if (!Buffer.isBuffer(body) || body.length === 0) throw new HttpError(400, 'No se recibio ninguna imagen');
        const prev = await Entity.findById(id).lean<EntityDoc>();
        if (!prev) throw resourceNotFound('Entidad no encontrada');

        const img = await processManualImage(body, mimeOf(req.headers['content-type']), q.focus ? { focus: q.focus } : {});
        const mainInfo = probeImage(img.main);
        if (!mainInfo || mainInfo.mime !== 'image/webp' || mainInfo.width !== MEDIA_WIDTH || mainInfo.height !== MEDIA_HEIGHT) {
          throw new HttpError(500, 'La imagen optimizada no cumple el formato esperado');
        }
        const asset = await MediaAsset.create({
          mime: 'image/webp',
          width: MEDIA_WIDTH,
          height: MEDIA_HEIGHT,
          bytes: img.mainBytes,
          data: img.main,
          thumb_data: img.thumb,
          thumb_bytes: img.thumbBytes,
          thumb_width: MEDIA_THUMB_WIDTH,
          thumb_height: MEDIA_THUMB_HEIGHT,
          created_by: actor._id,
        });
        const url = `/media/${asset._id}`;

        // imagen_url entra en manualEdits (el pipeline no la pisa); el flag de imagen provisional ya existe en la raiz de Entity.
        const patch: Record<string, unknown> = { imagen_url: url };
        const meta: Record<string, unknown> = { ...(prev.metadata_json ?? {}) };
        let metaChanged = false;
        if ('capturaPropiaPendiente' in meta || 'captura_propia_pendiente' in meta) {
          delete meta['capturaPropiaPendiente'];
          delete meta['captura_propia_pendiente'];
          metaChanged = true;
        }
        if (q.alt) {
          meta['imagen_alt'] = q.alt;
          metaChanged = true;
        }
        if (metaChanged) patch['metadata_json'] = meta;
        const set = withManualEdits(prev, patch);
        set['capturaPropiaPendiente'] = false;
        try {
          await Entity.updateOne({ _id: id }, { $set: set });
        } catch (err) {
          await MediaAsset.deleteOne({ _id: asset._id });
          throw err;
        }

        const removedId = await removeOrphanMedia(req, prev.imagen_url, id, 'entity.image.replace');

        await writeAudit(req, 'entity.image.replace', 'Entity', id, {
          titulo: prev.titulo,
          previous: prev.imagen_url ?? null,
          next: url,
          media_id: asset._id,
          bytes: img.mainBytes,
          thumb_bytes: img.thumbBytes,
          cropped: img.cropped,
          previous_removed: removedId,
        });
        clearSsrCache();
        return reply.code(200).send({
          id,
          url,
          bytes: img.mainBytes,
          thumb_bytes: img.thumbBytes,
          width: MEDIA_WIDTH,
          height: MEDIA_HEIGHT,
          cropped: img.cropped,
          capturaPropiaPendiente: false,
        });
      },
    );
  });

  // ---- Cola de trabajo del Estudio de Imagenes (ADMIN+, 404 uniforme sin staff) ----
  app.get('/api/admin/images/queue', { onRequest: requireStaffRole('ADMIN') }, async (req, reply) => {
    const q = parse(queueQuerySchema, req.query);
    void reply.header('Cache-Control', 'private, no-store');
    const mods = await Module.find({}).select('slug').lean<ModuleDoc[]>();
    const slugOf = new Map(mods.map((m) => [m._id, m.slug]));
    const and: Array<Record<string, unknown>> = [];
    if (q.module) {
      const mod = mods.find((m) => m.slug === q.module);
      and.push({ module_id: mod ? mod._id : '__none__' });
    }
    if (q.q) {
      const rx = new RegExp(escapeRx(q.q), 'i');
      and.push({ $or: [{ titulo: rx }, { slug: rx }] });
    }
    if (q.estado === 'pendientes') {
      and.push({ $or: [{ capturaPropiaPendiente: true }, { imagen_url: null }, { imagen_url: '' }] });
    }
    const filter: Record<string, unknown> = and.length > 0 ? { $and: and } : {};
    const hasImg = { $gt: [{ $strLenCP: { $ifNull: ['$imagen_url', ''] } }, 0] };
    const isOwn = { $regexMatch: { input: { $ifNull: ['$imagen_url', ''] }, regex: '^/media/' } };
    const [agg] = await Entity.aggregate<{
      items: Array<Record<string, unknown>>;
      total: Array<{ n: number }>;
      stats: Array<{ _id: string; total: number; sin_imagen: number; provisionales: number; propias: number }>;
    }>([
      {
        $facet: {
          items: [
            { $match: filter },
            { $sort: { titulo: 1, _id: 1 } },
            { $skip: (q.page - 1) * q.limit },
            { $limit: q.limit },
            {
              $project: {
                _id: 1,
                slug: 1,
                titulo: 1,
                module_id: 1,
                imagen_url: { $ifNull: ['$imagen_url', null] },
                capturaPropiaPendiente: { $eq: ['$capturaPropiaPendiente', true] },
                imagen_alt: { $ifNull: ['$metadata_json.imagen_alt', null] },
              },
            },
          ],
          total: [{ $match: filter }, { $count: 'n' }],
          stats: [
            {
              $group: {
                _id: '$module_id',
                total: { $sum: 1 },
                sin_imagen: { $sum: { $cond: [hasImg, 0, 1] } },
                provisionales: { $sum: { $cond: [{ $and: [hasImg, { $eq: ['$capturaPropiaPendiente', true] }] }, 1, 0] } },
                propias: { $sum: { $cond: [{ $and: [isOwn, { $ne: ['$capturaPropiaPendiente', true] }] }, 1, 0] } },
              },
            },
          ],
        },
      },
    ]);
    const total = agg?.total[0]?.n ?? 0;
    const stats = { total: 0, sin_imagen: 0, provisionales: 0, propias: 0 };
    const porModulo: Record<string, typeof stats> = {};
    for (const g of agg?.stats ?? []) {
      const row = { total: g.total, sin_imagen: g.sin_imagen, provisionales: g.provisionales, propias: g.propias };
      porModulo[slugOf.get(g._id) ?? g._id] = row;
      stats.total += row.total;
      stats.sin_imagen += row.sin_imagen;
      stats.provisionales += row.provisionales;
      stats.propias += row.propias;
    }
    const items = (agg?.items ?? []).map((e) => ({
      id: e['_id'],
      slug: e['slug'],
      titulo: e['titulo'],
      module_slug: slugOf.get(String(e['module_id'])) ?? null,
      imagen_url: e['imagen_url'] || null,
      capturaPropiaPendiente: e['capturaPropiaPendiente'] === true,
      imagen_alt: e['imagen_alt'] ?? null,
    }));
    return { items, total, page: q.page, pages: Math.max(1, Math.ceil(total / q.limit)), stats, stats_por_modulo: porModulo };
  });

  // ---- Emparejado por slug (nombres de archivo -> fichas) ----
  app.get('/api/admin/images/match', { onRequest: requireStaffRole('ADMIN') }, async (req, reply) => {
    const q = parse(matchQuerySchema, req.query);
    void reply.header('Cache-Control', 'private, no-store');
    const slugs = [...new Set(q.slugs.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean))];
    if (slugs.length === 0) throw new HttpError(400, 'Indica al menos un slug');
    if (slugs.length > MATCH_MAX_SLUGS) throw new HttpError(400, `Maximo ${MATCH_MAX_SLUGS} slugs por consulta`);
    const mods = await Module.find({}).select('slug').lean<ModuleDoc[]>();
    const slugOf = new Map(mods.map((m) => [m._id, m.slug]));
    const filter: Record<string, unknown> = { slug: { $in: slugs } };
    if (q.module) {
      const mod = mods.find((m) => m.slug === q.module);
      filter['module_id'] = mod ? mod._id : '__none__';
    }
    const rows = await Entity.find(filter)
      .select('module_id slug titulo imagen_url capturaPropiaPendiente')
      .lean<Array<Pick<EntityDoc, '_id' | 'module_id' | 'slug' | 'titulo' | 'imagen_url' | 'capturaPropiaPendiente'>>>();
    const matches: Record<string, { estado: 'encontrada' | 'ambigua' | 'no_encontrada'; candidatos: Array<Record<string, unknown>> }> = {};
    for (const slug of slugs) matches[slug] = { estado: 'no_encontrada', candidatos: [] };
    for (const r of rows) {
      matches[r.slug]?.candidatos.push({
        id: r._id,
        module_slug: slugOf.get(r.module_id) ?? null,
        slug: r.slug,
        titulo: r.titulo,
        imagen_url: r.imagen_url || null,
        capturaPropiaPendiente: r.capturaPropiaPendiente === true,
      });
    }
    for (const m of Object.values(matches)) {
      if (m.candidatos.length === 1) m.estado = 'encontrada';
      else if (m.candidatos.length > 1) m.estado = 'ambigua';
    }
    return { matches };
  });

  // Publica y de solo lectura (HEAD lo expone Fastify). Sin listados: solo se sirve por id conocido.
  // `?w=800` sirve la miniatura movil si el asset la tiene; cualquier otro valor (o sin variante) sirve el principal.
  app.get('/media/:id', async (req, reply) => {
    const parsed = idSchema.safeParse((req.params as { id?: string }).id);
    if (!parsed.success) return notFound(reply);
    const id = parsed.data;
    const wantThumb = (req.query as { w?: unknown } | undefined)?.w === '800';
    const send = (tag: string): FastifyReply =>
      reply.header('ETag', tag).header('Cache-Control', 'public, max-age=31536000, immutable').header('X-Content-Type-Options', 'nosniff');

    if (wantThumb) {
      const t = await MediaAsset.findById(id).select({ data: 0 });
      if (!t) return notFound(reply);
      if (t.thumb_data) {
        // El contenido de un id nunca cambia (se reemplaza creando otro): el id (+ variante) es un ETag fuerte suficiente.
        const tag = `"${id}-800"`;
        if (etagMatches(req.headers['if-none-match'], tag)) return send(tag).code(304).send();
        const buf = Buffer.from(t.thumb_data);
        return send(tag).header('Content-Length', buf.length).type(t.mime).send(buf);
      }
    }
    const etag = `"${id}"`;
    if (etagMatches(req.headers['if-none-match'], etag)) {
      if (!(await MediaAsset.exists({ _id: id }))) return notFound(reply);
      return send(etag).code(304).send();
    }
    const doc = await MediaAsset.findById(id).select({ thumb_data: 0 });
    if (!doc) return notFound(reply);
    const data = Buffer.from(doc.data);
    return send(etag).header('Content-Length', data.length).type(doc.mime).send(data);
  });
}
