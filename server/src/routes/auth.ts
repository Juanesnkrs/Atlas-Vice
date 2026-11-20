import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { env, secureCookies } from '../config/env.js';
import { requireAuth } from '../plugins/auth.js';
import { getGlobalConfig } from '../models/AppConfig.js';
import { toSelfUserDTO, User, type UserDoc } from '../models/User.js';
import { mailerConfigured, sendMagicLink } from '../services/mailer.js';
import {
  buildAuthorizeUrl,
  exchangeCode,
  newState,
  newVerifier,
  OAUTH_PROVIDERS,
  providerConfigured,
  type OAuthProviderId,
} from '../services/oauth.js';
import {
  clearSessionCookie,
  consumeOnce,
  OAUTH_COOKIE,
  setSessionCookie,
  signPurposeToken,
  signSession,
  verifyPurposeToken,
} from '../services/session.js';
import { HttpError, parse } from '../services/validate.js';
import { findOrCreateUser } from '../services/users.js';

const providerParams = z.object({ provider: z.enum(['google', 'discord', 'apple']) });
const startQuery = z.object({ native: z.enum(['0', '1']).optional(), next: z.string().max(512).optional() });

/** Ruta relativa segura para el retorno: debe iniciar con `/` y no con `//` ni con barra invertida. */
const sanitizeNext = (next: unknown): string | undefined =>
  typeof next === 'string' && next.startsWith('/') && !next.startsWith('//') && !next.includes('\\') && !/[\r\n]/.test(next)
    ? next
    : undefined;

interface PkceCookie {
  state: string;
  verifier: string;
  provider: OAuthProviderId;
  native: boolean;
  next?: string;
}

/** Cierra el login: cookie de sesion (web) o codigo efimero de un solo uso (deep link nativo). */
async function finishLogin(reply: FastifyReply, user: UserDoc, native: boolean, next?: string): Promise<FastifyReply> {
  if (native) {
    const code = await signPurposeToken('exchange', { uid: user._id }, 60);
    return reply.redirect(`${env.APP_DEEPLINK}?code=${encodeURIComponent(code)}`);
  }
  setSessionCookie(reply, await signSession(user._id));
  return reply.redirect(`${env.PUBLIC_SITE_URL}${next ?? '/?auth=ok'}`);
}

/** Parametros del callback (query GET o body form_post de Apple); se toleran claves extra (p. ej. `user`). */
const callbackInputSchema = z.object({
  state: z.string().max(512).optional(),
  code: z.string().max(4096).optional(),
  error: z.string().max(256).optional(),
});

function failRedirect(reply: FastifyReply, native: boolean, reason: string): FastifyReply {
  const base = native ? env.APP_DEEPLINK : `${env.PUBLIC_SITE_URL}/`;
  return reply.redirect(`${base}${base.includes('?') ? '&' : '?'}auth_error=${encodeURIComponent(reason)}`);
}

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  const strict = { config: { rateLimit: { max: 15, timeWindow: '1 minute' } } };

  app.get('/api/auth/providers', async () => {
    const cfg = await getGlobalConfig();
    const enabled = new Set<string>(cfg.enabled_auth_providers);
    return {
      providers: [
        ...OAUTH_PROVIDERS.map((p) => ({ id: p, enabled: enabled.has(p), configured: providerConfigured(p) })),
        { id: 'magic-link', enabled: enabled.has('magic-link'), configured: mailerConfigured() },
      ],
    };
  });

  // --- OAuth2 Authorization Code + PKCE ---------------------------------------
  app.get('/api/auth/:provider/start', strict, async (req, reply) => {
    const { provider } = parse(providerParams, req.params);
    const { native, next } = parse(startQuery, req.query);
    const safe = sanitizeNext(next);
    const state = newState();
    const verifier = newVerifier();
    const url = buildAuthorizeUrl(provider, state, verifier); // 503 si falta credencial
    const payload: PkceCookie = { state, verifier, provider, native: native === '1', ...(safe ? { next: safe } : {}) };
    reply.setCookie(OAUTH_COOKIE, JSON.stringify(payload), {
      httpOnly: true,
      signed: true,
      path: '/api/auth',
      maxAge: 600,
      // Apple vuelve con POST cross-site (form_post): Lax no enviaria la cookie.
      secure: secureCookies || provider === 'apple',
      sameSite: provider === 'apple' ? 'none' : 'lax',
    });
    return reply.redirect(url);
  });

  const callback = async (req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
    const { provider } = parse(providerParams, req.params);
    const rawInput = req.method === 'POST' ? req.body : req.query;

    const raw = req.cookies[OAUTH_COOKIE];
    const un = raw ? req.unsignCookie(raw) : null;
    reply.clearCookie(OAUTH_COOKIE, { path: '/api/auth' });
    if (!un?.valid || !un.value) return failRedirect(reply, false, 'sesion_oauth_invalida');
    let pkce: PkceCookie;
    try {
      pkce = JSON.parse(un.value) as PkceCookie;
    } catch {
      return failRedirect(reply, false, 'sesion_oauth_invalida');
    }
    const parsedInput = callbackInputSchema.safeParse(rawInput ?? {});
    if (!parsedInput.success) return failRedirect(reply, pkce.native, 'state_invalido');
    const input = parsedInput.data;
    if (pkce.provider !== provider || !input.state || input.state !== pkce.state) {
      return failRedirect(reply, pkce.native, 'state_invalido');
    }
    if (input.error || !input.code) return failRedirect(reply, pkce.native, 'acceso_denegado');

    try {
      const identity = await exchangeCode(provider, input.code, pkce.verifier);
      const user = await findOrCreateUser(identity);
      return await finishLogin(reply, user, pkce.native, sanitizeNext(pkce.next));
    } catch (err) {
      req.log.error({ err }, 'oauth callback');
      return failRedirect(reply, pkce.native, 'fallo_proveedor');
    }
  };
  app.get('/api/auth/:provider/callback', strict, callback);
  app.post('/api/auth/:provider/callback', strict, callback);

  // --- Magic Link --------------------------------------------------------------
  app.post('/api/auth/magic/request', { config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } }, async (req, reply) => {
    const body = parse(z.object({ email: z.email(), native: z.boolean().optional(), next: z.string().max(512).optional() }), req.body);
    if (!mailerConfigured()) throw new HttpError(503, 'Magic Link no configurado (SMTP)');
    const email = body.email.toLowerCase();
    const token = await signPurposeToken('magic', { email, native: body.native === true, ...(sanitizeNext(body.next) ? { next: sanitizeNext(body.next) } : {}) }, 15 * 60);
    await sendMagicLink(email, `${env.API_PUBLIC_URL}/api/auth/magic/verify?token=${encodeURIComponent(token)}`);
    return reply.code(202).send({ ok: true }); // respuesta identica exista o no la cuenta
  });

  app.get('/api/auth/magic/verify', strict, async (req, reply) => {
    const { token } = parse(z.object({ token: z.string().min(20) }), req.query);
    const payload = await verifyPurposeToken(token, 'magic');
    const native = payload?.['native'] === true;
    if (!payload || typeof payload['email'] !== 'string' || !consumeOnce(String(payload.jti), 15 * 60_000)) {
      return failRedirect(reply, native, 'enlace_invalido');
    }
    const email = payload['email'];
    const user = await findOrCreateUser({
      provider: 'magic-link',
      subject: email,
      email,
      emailVerified: true,
      name: email.split('@')[0] ?? 'jugador',
    });
    return finishLogin(reply, user, native, sanitizeNext(payload['next']));
  });

  // --- Intercambio del codigo nativo (leonidapp://auth/callback?code=...) -------
  app.post('/api/auth/exchange', strict, async (req, reply) => {
    const { code } = parse(z.object({ code: z.string().min(20) }), req.body);
    const payload = await verifyPurposeToken(code, 'exchange');
    if (!payload || typeof payload['uid'] !== 'string' || !consumeOnce(String(payload.jti), 60_000)) {
      throw new HttpError(401, 'Codigo invalido o caducado');
    }
    const user = await User.findById(payload['uid']).lean<UserDoc>();
    if (!user) throw new HttpError(401, 'Usuario inexistente');
    setSessionCookie(reply, await signSession(user._id));
    return { user: toSelfUserDTO(user) };
  });

  app.get('/api/auth/me', async (req) => ({ user: req.authUser ? toSelfUserDTO(req.authUser) : null }));

  app.post('/api/auth/logout', { preHandler: requireAuth }, async (_req, reply) => {
    clearSessionCookie(reply);
    return { ok: true };
  });
}
