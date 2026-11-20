import { createHash } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';

/** Cache publica corta con revalidacion: ETag debil sobre el contenido + `Cache-Control: public, max-age`. */
export const PUBLIC_MAX_AGE = 60;

/**
 * Responde un JSON publico (sin datos de sesion) con ETag y 304 si el cliente ya lo tiene.
 * No se emite `Vary: Cookie`: solo usar en rutas cuyo contenido no depende de la sesion.
 */
export function sendPublicJson(
  req: FastifyRequest,
  reply: FastifyReply,
  body: unknown,
  maxAge: number = PUBLIC_MAX_AGE,
): FastifyReply {
  const json = JSON.stringify(body);
  const etag = `W/"${createHash('sha1').update(json).digest('base64url')}"`;
  void reply.header('ETag', etag).header('Cache-Control', `public, max-age=${maxAge}, must-revalidate`);
  const inm = req.headers['if-none-match'];
  if (inm && inm.split(',').some((t) => t.trim().replace(/^W\//, '') === etag.replace(/^W\//, ''))) {
    return reply.code(304).send();
  }
  return reply.type('application/json; charset=utf-8').send(json);
}
