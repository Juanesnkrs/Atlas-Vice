import type { FastifyReply } from 'fastify';
import { jwtVerify, SignJWT } from 'jose';
import { randomUUID } from 'node:crypto';
import { env, isProd } from '../config/env.js';

export const SESSION_COOKIE = 'lv_session';
export const OAUTH_COOKIE = 'lv_oauth';
const SESSION_TTL_S = 60 * 60 * 24 * 7;

const key = new TextEncoder().encode(env.JWT_SECRET);
const ISSUER = 'leonidapp';

export async function signSession(userId: string, ttlSeconds: number = SESSION_TTL_S): Promise<string> {
  return new SignJWT({ typ: 'session' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(key);
}

export async function verifySession(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, key, { issuer: ISSUER, algorithms: ['HS256'] });
    return payload['typ'] === 'session' && typeof payload.sub === 'string' ? payload.sub : null;
  } catch {
    return null;
  }
}

/** Token efimero de un solo uso ('exchange' = retorno nativo, 'magic' = enlace por correo). */
export async function signPurposeToken(
  purpose: 'exchange' | 'magic',
  claims: Record<string, string | boolean>,
  ttlSeconds: number,
): Promise<string> {
  return new SignJWT({ typ: purpose, ...claims })
    .setProtectedHeader({ alg: 'HS256' })
    .setJti(randomUUID())
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(key);
}

const used = new Map<string, number>();
/** Marca un jti como consumido; false si ya se uso. (Memoria por instancia.) */
export function consumeOnce(jti: string, ttlMs: number): boolean {
  const now = Date.now();
  for (const [k, exp] of used) if (exp < now) used.delete(k);
  if (used.has(jti)) return false;
  used.set(jti, now + ttlMs);
  return true;
}

export async function verifyPurposeToken(
  token: string,
  purpose: 'exchange' | 'magic',
): Promise<Record<string, unknown> | null> {
  try {
    const { payload } = await jwtVerify(token, key, { issuer: ISSUER, algorithms: ['HS256'] });
    if (payload['typ'] !== purpose || !payload.jti) return null;
    return payload;
  } catch {
    return null;
  }
}

export function setSessionCookie(reply: FastifyReply, token: string): void {
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_S,
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, { path: '/', httpOnly: true, secure: isProd, sameSite: 'lax' });
}
