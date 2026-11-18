import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import formbody from '@fastify/formbody';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import { existsSync } from 'node:fs';
import { ZodError } from 'zod';
import { env, isProd } from './config/env.js';
import authPlugin from './plugins/auth.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerCatalogRoutes } from './routes/catalog.js';
import { registerConfigRoutes } from './routes/config.js';
import { registerForumRoutes } from './routes/forum.js';
import { registerProgressRoutes } from './routes/progress.js';
import { HttpError } from './services/validate.js';

/** Origenes con credenciales: web + WebView de Capacitor (iOS/Android). */
const allowedOrigins = new Set([
  env.CLIENT_ORIGIN,
  env.PUBLIC_SITE_URL,
  'capacitor://localhost',
  'ionic://localhost',
  'http://localhost',
  'https://localhost',
]);

/** Carga modulos del agente de workers/SEO solo si existen (compilados o en fuente). */
async function optionalModule<T>(relative: string): Promise<T | null> {
  const base = new URL(relative, import.meta.url);
  const candidates = [base, new URL(relative.replace(/\.js$/, '.ts'), import.meta.url)];
  if (!candidates.some((u) => existsSync(u))) return null;
  return (await import(/* @vite-ignore */ base.href)) as T;
}

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: isProd ? 'info' : 'debug' },
    trustProxy: isProd,
    bodyLimit: 1_048_576,
  });

  await app.register(cors, {
    origin: (origin, cb) => cb(null, !origin || allowedOrigins.has(origin)),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });
  await app.register(cookie, { secret: env.COOKIE_SECRET });
  await app.register(formbody);
  await app.register(rateLimit, { global: true, max: 200, timeWindow: '1 minute' });
  await app.register(authPlugin);

  // Defensa CSRF adicional para sesiones por cookie: mutaciones solo desde origenes propios.
  app.addHook('onRequest', async (req) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return;
    if (req.url.startsWith('/api/auth/') && req.url.includes('/callback')) return; // Apple form_post
    const origin = req.headers.origin;
    if (origin && !allowedOrigins.has(origin)) throw new HttpError(403, 'Origen no permitido');
  });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof HttpError) {
      return reply.code(err.statusCode).send({ error: err.message, ...(err.details ? { details: err.details } : {}) });
    }
    if (err instanceof ZodError) return reply.code(400).send({ error: 'Datos invalidos' });
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) app.log.error(err);
    return reply.code(status).send({ error: status >= 500 ? 'Error interno' : (err as Error).message });
  });

  app.get('/api/health', async () => ({ ok: true }));

  await registerConfigRoutes(app);
  await registerAuthRoutes(app);
  await registerCatalogRoutes(app);
  await registerProgressRoutes(app);
  await registerForumRoutes(app);

  // --- Agente 05 (SEO + noticias oficiales): cableado tolerante ---------------
  const seo = await optionalModule<{ registerSeoRoutes: (a: FastifyInstance) => Promise<void> }>('./routes/seo.js');
  if (seo) await seo.registerSeoRoutes(app);

  const worker = await optionalModule<{ startOfficialNewsWorker: (a?: FastifyInstance) => void }>(
    './workers/officialNewsWorker.js',
  );
  if (worker) app.addHook('onReady', async () => worker.startOfficialNewsWorker(app));

  return app;
}
