import type { FastifyInstance, FastifyReply } from 'fastify';
import sharp, { type Metadata } from 'sharp';
import { z } from 'zod';
import { requireStaffRole } from '../plugins/auth.js';
import { MEDIA_HEIGHT, MEDIA_MAX_BYTES, MEDIA_MIMES, MEDIA_WIDTH, MediaAsset } from '../models/MediaAsset.js';
import { AppConfig } from '../models/AppConfig.js';
import { Entity, type EntityDoc } from '../models/Entity.js';
import { writeAudit } from '../services/audit.js';
import { withManualEdits } from '../services/catalogIngest.js';
import { probeImage } from '../services/imageProbe.js';
import { clearSsrCache } from '../services/ssrLite.js';
import { HttpError, idParamsSchema, parse, resourceNotFound } from '../services/validate.js';

/** Tope del cuerpo crudo: algo por encima de 400 KB para poder responder con un 400 legible en vez de cortar la conexion. */
const UPLOAD_BODY_LIMIT = 600 * 1024;
const idSchema = z.uuid();

/** Reemplazo manual de la imagen de una ficha: se acepta el original (JPG/PNG/WebP) y el servidor lo optimiza. */
const REPLACE_MIMES = ['image/jpeg', 'image/png', 'image/webp'] as const;
const REPLACE_BODY_LIMIT = 12 * 1024 * 1024;
const REPLACE_MAX_PIXELS = 60_000_000;
const OWN_MEDIA_RE = /^\/media\/([0-9a-f-]{36})$/;
const FRAME_BG = '#0b0f1f';
const WEBP_QUALITIES = [82, 74, 66, 58, 50, 42] as const;

/** Encuadra en 1600x900 (`contain`, sin recortar) y baja la calidad WebP hasta caber en MEDIA_MAX_BYTES. */
async function optimizeToMedia(input: Buffer, declared: string): Promise<Buffer> {
  const kind = declared === 'image/jpeg' ? 'jpeg' : declared === 'image/png' ? 'png' : 'webp';
  let meta: Metadata;
  try {
    meta = await sharp(input, { limitInputPixels: REPLACE_MAX_PIXELS }).metadata();
  } catch {
    throw new HttpError(400, 'El archivo no es una imagen JPG, PNG o WebP valida');
  }
  if (meta.format !== kind) throw new HttpError(400, 'El contenido del archivo no coincide con el tipo de imagen declarado');
  for (const quality of WEBP_QUALITIES) {
    let out: Buffer;
    try {
      out = await sharp(input, { limitInputPixels: REPLACE_MAX_PIXELS })
        .rotate()
        .resize({ width: MEDIA_WIDTH, height: MEDIA_HEIGHT, fit: 'contain', background: FRAME_BG })
        .flatten({ background: FRAME_BG })
        .webp({ quality })
        .toBuffer();
    } catch {
      throw new HttpError(400, 'No se pudo procesar la imagen');
    }
    if (out.length <= MEDIA_MAX_BYTES) return out;
  }
  throw new HttpError(400, `La imagen no se puede comprimir por debajo de ${kb(MEDIA_MAX_BYTES)}`);
}

/** ¿Otra ficha o una diapositiva del Hero siguen usando `/media/<id>`? Solo si no, se puede borrar sin dejar enlaces rotos. */
async function mediaStillUsed(url: string, exceptEntityId: string): Promise<boolean> {
  if (await Entity.exists({ _id: { $ne: exceptEntityId }, imagen_url: url })) return true;
  const hero = await AppConfig.findOne({ key: 'global' }).select('hero_slides').lean<{ hero_slides?: unknown } | null>();
  return JSON.stringify(hero?.hero_slides ?? []).includes(url);
}

const mimeOf = (header: string | undefined): string => (header ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
const kb = (bytes: number): string => `${Math.round(bytes / 1024)} KB`;

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
        const body = req.body;
        if (!Buffer.isBuffer(body) || body.length === 0) throw new HttpError(400, 'No se recibio ninguna imagen');
        const prev = await Entity.findById(id).lean<EntityDoc>();
        if (!prev) throw resourceNotFound('Entidad no encontrada');

        const webp = await optimizeToMedia(body, mimeOf(req.headers['content-type']));
        const info = probeImage(webp);
        if (!info || info.mime !== 'image/webp' || info.width !== MEDIA_WIDTH || info.height !== MEDIA_HEIGHT) {
          throw new HttpError(500, 'La imagen optimizada no cumple el formato esperado');
        }
        const asset = await MediaAsset.create({ mime: 'image/webp', width: MEDIA_WIDTH, height: MEDIA_HEIGHT, bytes: webp.length, data: webp, created_by: actor._id });
        const url = `/media/${asset._id}`;

        // imagen_url entra en manualEdits (el pipeline no la pisa); el flag de imagen provisional ya existe en la raiz de Entity.
        const patch: Record<string, unknown> = { imagen_url: url };
        const meta = { ...(prev.metadata_json ?? {}) };
        if ('capturaPropiaPendiente' in meta || 'captura_propia_pendiente' in meta) {
          delete meta['capturaPropiaPendiente'];
          delete meta['captura_propia_pendiente'];
          patch['metadata_json'] = meta;
        }
        const set = withManualEdits(prev, patch);
        set['capturaPropiaPendiente'] = false;
        try {
          await Entity.updateOne({ _id: id }, { $set: set });
        } catch (err) {
          await MediaAsset.deleteOne({ _id: asset._id });
          throw err;
        }

        let removedId: string | null = null;
        const oldId = prev.imagen_url ? OWN_MEDIA_RE.exec(prev.imagen_url)?.[1] : undefined;
        if (oldId && prev.imagen_url && oldId !== asset._id) {
          try {
            if (!(await mediaStillUsed(prev.imagen_url, id))) {
              const gone = await MediaAsset.findOneAndDelete({ _id: oldId }, { projection: { data: 0 } }).lean();
              if (gone) {
                removedId = oldId;
                await writeAudit(req, 'media.delete', 'MediaAsset', oldId, { mime: gone.mime, bytes: gone.bytes, reason: 'entity.image.replace' });
              }
            }
          } catch (err) {
            req.log.warn({ err, id: oldId }, 'No se pudo eliminar la imagen anterior de la ficha');
          }
        }

        await writeAudit(req, 'entity.image.replace', 'Entity', id, {
          titulo: prev.titulo,
          previous: prev.imagen_url ?? null,
          next: url,
          media_id: asset._id,
          bytes: webp.length,
          previous_removed: removedId,
        });
        clearSsrCache();
        return reply.code(200).send({ id, url, bytes: webp.length, width: MEDIA_WIDTH, height: MEDIA_HEIGHT, capturaPropiaPendiente: false });
      },
    );
  });

  // Publica y de solo lectura (HEAD lo expone Fastify). Sin listados: solo se sirve por id conocido.
  app.get('/media/:id', async (req, reply) => {
    const parsed = idSchema.safeParse((req.params as { id?: string }).id);
    if (!parsed.success) return notFound(reply);
    const id = parsed.data;
    // El contenido de un id nunca cambia (se reemplaza creando otro), asi que el id es un ETag fuerte suficiente.
    const etag = `"${id}"`;
    const inm = req.headers['if-none-match'];
    if (inm && inm.split(',').some((t) => t.trim() === etag || t.trim() === `W/${etag}`)) {
      if (!(await MediaAsset.exists({ _id: id }))) return notFound(reply);
      return reply.header('ETag', etag).header('Cache-Control', 'public, max-age=31536000, immutable').code(304).send();
    }
    const doc = await MediaAsset.findById(id);
    if (!doc) return notFound(reply);
    const data = Buffer.from(doc.data);
    return reply
      .header('ETag', etag)
      .header('Cache-Control', 'public, max-age=31536000, immutable')
      .header('X-Content-Type-Options', 'nosniff')
      .header('Content-Length', data.length)
      .type(doc.mime)
      .send(data);
  });
}
