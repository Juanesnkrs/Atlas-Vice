import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { requireStaffRole } from '../plugins/auth.js';
import { MEDIA_HEIGHT, MEDIA_MAX_BYTES, MEDIA_MIMES, MEDIA_WIDTH, MediaAsset } from '../models/MediaAsset.js';
import { writeAudit } from '../services/audit.js';
import { probeImage } from '../services/imageProbe.js';
import { HttpError } from '../services/validate.js';

/** Tope del cuerpo crudo: algo por encima de 400 KB para poder responder con un 400 legible en vez de cortar la conexion. */
const UPLOAD_BODY_LIMIT = 600 * 1024;
const idSchema = z.uuid();

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
