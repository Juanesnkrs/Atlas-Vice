import { createHash, randomBytes } from 'node:crypto';
import { createRemoteJWKSet, importPKCS8, jwtVerify, SignJWT } from 'jose';
import { env } from '../config/env.js';
import { HttpError } from './validate.js';

export type OAuthProviderId = 'google' | 'discord' | 'apple';
export const OAUTH_PROVIDERS: readonly OAuthProviderId[] = ['google', 'discord', 'apple'];

export interface OAuthIdentity {
  provider: OAuthProviderId;
  subject: string;
  email?: string;
  emailVerified: boolean;
  name?: string;
  avatarUrl?: string;
}

const b64url = (buf: Buffer): string => buf.toString('base64url');
export const newVerifier = (): string => b64url(randomBytes(48));
export const newState = (): string => b64url(randomBytes(24));
export const challengeOf = (verifier: string): string => b64url(createHash('sha256').update(verifier).digest());

export const redirectUri = (p: OAuthProviderId): string => `${env.API_PUBLIC_URL}/api/auth/${p}/callback`;

interface ProviderDef {
  authUrl: string;
  tokenUrl: string;
  scope: string;
  clientId: string | undefined;
  extraAuthParams?: Record<string, string>;
}

const defs = (): Record<OAuthProviderId, ProviderDef> => ({
  google: {
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scope: 'openid email profile',
    clientId: env.GOOGLE_CLIENT_ID,
  },
  discord: {
    authUrl: 'https://discord.com/oauth2/authorize',
    tokenUrl: 'https://discord.com/api/oauth2/token',
    scope: 'identify email',
    clientId: env.DISCORD_CLIENT_ID,
  },
  apple: {
    authUrl: 'https://appleid.apple.com/auth/authorize',
    tokenUrl: 'https://appleid.apple.com/auth/token',
    scope: 'name email',
    clientId: env.APPLE_CLIENT_ID,
    extraAuthParams: { response_mode: 'form_post' },
  },
});

export function providerConfigured(p: OAuthProviderId): boolean {
  switch (p) {
    case 'google':
      return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
    case 'discord':
      return Boolean(env.DISCORD_CLIENT_ID && env.DISCORD_CLIENT_SECRET);
    case 'apple':
      return Boolean(env.APPLE_CLIENT_ID && env.APPLE_TEAM_ID && env.APPLE_KEY_ID && env.APPLE_PRIVATE_KEY);
  }
}

export function assertConfigured(p: OAuthProviderId): void {
  if (!providerConfigured(p)) throw new HttpError(503, `Proveedor ${p} no configurado en el servidor`);
}

export function buildAuthorizeUrl(p: OAuthProviderId, state: string, verifier: string): string {
  assertConfigured(p);
  const d = defs()[p];
  const u = new URL(d.authUrl);
  u.searchParams.set('client_id', d.clientId ?? '');
  u.searchParams.set('redirect_uri', redirectUri(p));
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', d.scope);
  u.searchParams.set('state', state);
  u.searchParams.set('code_challenge', challengeOf(verifier));
  u.searchParams.set('code_challenge_method', 'S256');
  for (const [k, v] of Object.entries(d.extraAuthParams ?? {})) u.searchParams.set(k, v);
  return u.toString();
}

async function appleClientSecret(): Promise<string> {
  const pk = await importPKCS8((env.APPLE_PRIVATE_KEY ?? '').replace(/\\n/g, '\n'), 'ES256');
  return new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: env.APPLE_KEY_ID ?? '' })
    .setIssuer(env.APPLE_TEAM_ID ?? '')
    .setSubject(env.APPLE_CLIENT_ID ?? '')
    .setAudience('https://appleid.apple.com')
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(pk);
}

const clientSecretOf = async (p: OAuthProviderId): Promise<string> =>
  p === 'google' ? (env.GOOGLE_CLIENT_SECRET ?? '') : p === 'discord' ? (env.DISCORD_CLIENT_SECRET ?? '') : appleClientSecret();

async function getJson<T>(res: Response, what: string): Promise<T> {
  if (!res.ok) throw new HttpError(502, `Fallo al contactar ${what} (${res.status})`);
  return (await res.json()) as T;
}

/** Intercambia code + code_verifier y devuelve la identidad. Los tokens del proveedor nunca salen del servidor. */
export async function exchangeCode(p: OAuthProviderId, code: string, verifier: string): Promise<OAuthIdentity> {
  assertConfigured(p);
  const d = defs()[p];
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri(p),
    client_id: d.clientId ?? '',
    client_secret: await clientSecretOf(p),
    code_verifier: verifier,
  });
  const tokenRes = await fetch(d.tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body,
  });
  const tok = await getJson<{ access_token?: string; id_token?: string }>(tokenRes, p);

  if (p === 'google') {
    const r = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { authorization: `Bearer ${tok.access_token ?? ''}` },
    });
    const u = await getJson<{ sub: string; email?: string; email_verified?: boolean; name?: string; picture?: string }>(r, p);
    return {
      provider: p,
      subject: u.sub,
      ...(u.email ? { email: u.email } : {}),
      emailVerified: u.email_verified === true,
      ...(u.name ? { name: u.name } : {}),
      ...(u.picture ? { avatarUrl: u.picture } : {}),
    };
  }

  if (p === 'discord') {
    const r = await fetch('https://discord.com/api/users/@me', {
      headers: { authorization: `Bearer ${tok.access_token ?? ''}` },
    });
    const u = await getJson<{ id: string; username: string; global_name?: string; email?: string; verified?: boolean; avatar?: string }>(r, p);
    return {
      provider: p,
      subject: u.id,
      ...(u.email ? { email: u.email } : {}),
      emailVerified: u.verified === true,
      name: u.global_name ?? u.username,
      ...(u.avatar ? { avatarUrl: `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png` } : {}),
    };
  }

  // Apple: identidad en el id_token, verificado contra el JWKS de Apple.
  if (!tok.id_token) throw new HttpError(502, 'Apple no devolvio id_token');
  const jwks = createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'));
  const { payload } = await jwtVerify(tok.id_token, jwks, {
    issuer: 'https://appleid.apple.com',
    audience: env.APPLE_CLIENT_ID ?? '',
  });
  const email = typeof payload['email'] === 'string' ? payload['email'] : undefined;
  const ev = payload['email_verified'];
  return {
    provider: p,
    subject: String(payload.sub),
    ...(email ? { email } : {}),
    emailVerified: ev === true || ev === 'true',
  };
}
