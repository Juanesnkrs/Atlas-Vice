import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import fp from 'fastify-plugin';
import { ROLE_RANK, User, type Role, type UserDoc } from '../models/User.js';
import { HttpError } from '../services/validate.js';
import { SESSION_COOKIE, verifySession } from '../services/session.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Usuario de la sesion (rol leido de la BD en cada peticion: el servidor decide). */
    authUser: UserDoc | null;
  }
}

/**
 * Jerarquia: USER < MODERATOR < ADMIN < SUPER_ADMIN.
 * `requireRole('ADMIN')` admite ADMIN y SUPER_ADMIN (rango >= minimo de los roles listados).
 */
export function requireRole(...roles: Role[]): preHandlerAsyncHookHandler {
  const min = Math.min(...(roles.length ? roles : (['USER'] as Role[])).map((r) => ROLE_RANK[r]));
  return async (req: FastifyRequest, _reply: FastifyReply) => {
    if (!req.authUser) throw new HttpError(401, 'Sesion requerida');
    if (ROLE_RANK[req.authUser.rol] < min) throw new HttpError(403, 'Permisos insuficientes');
  };
}

export const requireAuth = requireRole('USER');

export default fp(async function authPlugin(app: FastifyInstance) {
  app.decorateRequest('authUser', null);

  app.addHook('onRequest', async (req) => {
    req.authUser = null;
    const raw = req.cookies[SESSION_COOKIE];
    if (!raw) return;
    const userId = await verifySession(raw);
    if (!userId) return;
    req.authUser = await User.findById(userId).lean<UserDoc>();
  });
}, { name: 'auth' });
