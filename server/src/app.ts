import compress from '@fastify/compress';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import formbody from '@fastify/formbody';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import { existsSync } from 'node:fs';
import { ZodError } from 'zod';
import { env, isProd } from './config/env.js';
import authPlugin from './plugins/auth.js';
import { registerAdminRoutes } from './routes/admin.js';
import { registerAdminPanelRoutes } from './routes/adminPanel.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerCatalogRoutes } from './routes/catalog.js';
import { registerNewsRoutes } from './routes/news.js';
import { registerSubmissionRoutes } from './routes/submissions.js';
import { registerContactRoutes } from './routes/contact.js';
import { registerConfigRoutes } from './routes/config.js';
import { registerHeroRoutes } from './routes/hero.js';
import { registerMediaRoutes } from './routes/media.js';
import { registerForumRoutes } from './routes/forum.js';
import { registerPipelineRoutes } from './routes/pipeline.js';
import { registerProgressRoutes } from './routes/progress.js';
import { API_POLICY, buildHtmlCsp } from './services/csp.js';
import { HttpError } from './services/validate.js';

/** Origenes con credenciales: web + WebView de Capacitor (iOS/Android). */
const allowedOrigins = new Set([
  env.CLIENT_ORIGIN,
  env.PUBLIC_SITE_URL,
  // `vite preview` (PWA compilada) en local: evita errores CORS con VITE_API_URL absoluto.
  ...(isProd ? [] : ['http://localhost:4173', 'http://127.0.0.1:4173']),
  'capacitor://localhost',
  'ionic://localhost',
  'http://localhost',
  'https://localhost',
]);

type RateClass = 'read' | 'page' | 'default';
const RATE_MAX: Record<RateClass, number> = { read: 3000, page: 1500, default: 200 };
/** GET/HEAD publicos de solo lectura del catalogo y config (sin sesion ni escritura). */
const PUBLIC_READ_RE = /^\/api\/(health|modules|entities|markers|news|config|hero)(\/|$)/;
/**
 * Clasifica la peticion para el rate-limit: lecturas publicas de API (tope muy alto), SSR-lite/estaticos/sitemap
 * (tope alto por IP) y el resto (auth, escrituras, foro, progreso, admin: 200/min, sin debilitar).
 */
function rateClass(req: { method: string; url: string }): RateClass {
  if (req.method !== 'GET' && req.method !== 'HEAD') return 'default';
  const path = req.url.split('?')[0] ?? '';
  if (path.startsWith('/api/')) return PUBLIC_READ_RE.test(path) ? 'read' : 'default';
  // Imagenes subidas desde el panel: una portada carga varias por visita, como una lectura publica de API.
  if (path.startsWith('/media/')) return 'read';
  return 'page';
}

const OAUTH_CALLBACK_RE = /^\/api\/auth\/(google|discord|apple)\/callback$/;

/** Carga modulos del agente de workers/SEO solo si existen (compilados o en fuente). */
async function optionalModule<T>(relative: string): Promise<T | null> {
  const base = new URL(relative, import.meta.url);
  const candidates = [base, new URL(relative.replace(/\.js$/, '.ts'), import.meta.url)];
  if (!candidates.some((u) => existsSync(u))) return null;
  return (await import(/* @vite-ignore */ base.href)) as T;
}

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: env.NODE_ENV === 'test' ? 'silent' : isProd ? 'info' : 'debug' },
    trustProxy: isProd,
    bodyLimit: 1_048_576,
  });

  await app.register(cors, {
    origin: (origin, cb) => cb(null, !origin || allowedOrigins.has(origin)),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    // Metadatos de paginacion de GET /api/entities legibles desde el cliente.
    exposedHeaders: ['X-Total-Count', 'X-Page', 'X-Per-Page', 'X-Total-Pages', 'Link', 'ETag'],
  });
  // gzip/brotli segun Accept-Encoding (JSON, HTML, XML, JS, CSS; ignora imagenes y binarios ya comprimidos).
  await app.register(compress, { threshold: 1024, encodings: ['br', 'gzip'] });
  await app.register(cookie, { secret: env.COOKIE_SECRET });
  await app.register(formbody);
  await app.register(rateLimit, {
    global: true,
    timeWindow: '1 minute',
    // Cubos separados por IP: las lecturas publicas no consumen el cupo de escrituras/auth (200/min).
    keyGenerator: (req) => `${req.ip}|${rateClass(req)}`,
    max: (req) => RATE_MAX[rateClass(req)],
  });
  await app.register(authPlugin);

  // Defensa CSRF adicional para sesiones por cookie: mutaciones solo desde origenes propios.
  app.addHook('onRequest', async (req) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return;
    // Apple form_post: exencion unicamente para el callback exacto de los 3 proveedores OAuth (path sin query).
    if (OAUTH_CALLBACK_RE.test(req.url.split('?')[0] ?? '')) return;
    // Ingesta del pipeline (maquina a maquina): sin sesion/cookies; su unica credencial es el Bearer.
    if ((req.url.split('?')[0] ?? '') === '/api/pipeline/ingest') return;
    const origin = req.headers.origin;
    if (origin && !allowedOrigins.has(origin)) throw new HttpError(403, 'Origen no permitido');
  });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof HttpError) {
      return reply.code(err.statusCode).send({
        error: err.message,
        ...(err.code ? { code: err.code } : {}),
        ...(err.details ? { details: err.details } : {}),
      });
    }
    if ((err as { code?: unknown }).code === 11000) {
      return reply.code(409).send({ error: 'Conflicto: el slug o identificador ya existe' });
    }
    if (err instanceof ZodError) return reply.code(400).send({ error: 'Datos invalidos' });
    const fastifyCode = (err as { code?: unknown }).code;
    if (fastifyCode === 'FST_ERR_CTP_BODY_TOO_LARGE') return reply.code(413).send({ error: 'El contenido enviado supera el tamano permitido' });
    if (fastifyCode === 'FST_ERR_CTP_INVALID_MEDIA_TYPE') return reply.code(415).send({ error: 'Tipo de contenido no admitido' });
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) app.log.error(err);
    return reply.code(status).send({ error: status >= 500 ? 'Error interno' : (err as Error).message });
  });

  // Cabeceras de seguridad en todas las respuestas.
  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    // CSP: el SSR-lite fija la suya (con hashes) para HTML. La API (JSON/XML/texto) recibe la cerrada. Los scripts
    // estaticos (sw.js, workers) heredan su politica de la respuesta: llevan la de la app (sin hashes), no la cerrada.
    if (!reply.hasHeader('Content-Security-Policy')) {
      const ct = String(reply.getHeader('content-type') ?? '');
      if (/javascript/i.test(ct)) reply.header('Content-Security-Policy', buildHtmlCsp(''));
      else if (/json|xml|text\/plain/i.test(ct)) reply.header('Content-Security-Policy', API_POLICY);
    }
    if (isProd) reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    return payload;
  });

  app.get('/api/health', async () => ({ ok: true }));

  await registerConfigRoutes(app);
  await registerHeroRoutes(app);
  await registerMediaRoutes(app);
  await registerAdminRoutes(app);
  await registerAdminPanelRoutes(app);
  await registerPipelineRoutes(app);
  await registerAuthRoutes(app);
  await registerCatalogRoutes(app);
  await registerProgressRoutes(app);
  await registerForumRoutes(app);
  await registerSubmissionRoutes(app);
  await registerContactRoutes(app);
  await registerNewsRoutes(app);

  // --- Agente 05 (SEO + noticias oficiales): cableado tolerante ---------------
  const seo = await optionalModule<{ registerSeoRoutes: (a: FastifyInstance) => Promise<void> }>('./routes/seo.js');
  if (seo) await seo.registerSeoRoutes(app);

  const worker = await optionalModule<{ startOfficialNewsWorker: (a?: FastifyInstance) => void }>(
    './workers/officialNewsWorker.js',
  );
  if (worker) app.addHook('onReady', async () => worker.startOfficialNewsWorker(app));

  return app;
}
