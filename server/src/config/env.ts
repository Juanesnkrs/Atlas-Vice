import 'dotenv/config';
import { z } from 'zod';

const optional = z.string().optional().transform((v) => (v && v.length > 0 ? v : undefined));

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(3000),
  HOST: z.string().default('0.0.0.0'),
  MONGODB_URI: z.string().default('mongodb://127.0.0.1:27017/leonidapp'),
  JWT_SECRET: z.string().min(32).default('dev-only-jwt-secret-change-me-0000000000'),
  COOKIE_SECRET: z.string().min(32).default('dev-only-cookie-secret-change-me-00000000'),
  CLIENT_ORIGIN: z.string().default('http://localhost:5173'),
  PUBLIC_SITE_URL: z.string().default('http://localhost:5173'),
  API_PUBLIC_URL: z.string().default('http://localhost:3000'),
  APP_DEEPLINK: z.string().default('leonidapp://auth/callback'),
  GOOGLE_CLIENT_ID: optional,
  GOOGLE_CLIENT_SECRET: optional,
  DISCORD_CLIENT_ID: optional,
  DISCORD_CLIENT_SECRET: optional,
  APPLE_CLIENT_ID: optional,
  APPLE_TEAM_ID: optional,
  APPLE_KEY_ID: optional,
  APPLE_PRIVATE_KEY: optional,
  SMTP_HOST: optional,
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_USER: optional,
  SMTP_PASS: optional,
  SMTP_FROM: z.string().default('LeonidApp <no-reply@localhost>'),
  SUPER_ADMIN_EMAIL: optional,
});

export type Env = z.infer<typeof envSchema>;
export const env: Env = envSchema.parse(process.env);
export const isProd = env.NODE_ENV === 'production';
/** Cookies Secure en produccion o cuando el sitio/API publico usa https. */
export const secureCookies = isProd || env.PUBLIC_SITE_URL.startsWith('https://') || env.API_PUBLIC_URL.startsWith('https://');

if (isProd && (env.JWT_SECRET.startsWith('dev-only') || env.COOKIE_SECRET.startsWith('dev-only'))) {
  throw new Error('JWT_SECRET y COOKIE_SECRET deben definirse en produccion.');
}
