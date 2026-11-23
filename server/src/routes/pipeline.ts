import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { env } from '../config/env.js';
import { PipelineRun, toPipelineRunDTO, type PipelineRunDoc } from '../models/PipelineRun.js';
import { requireStaffRole } from '../plugins/auth.js';
import { writeAudit } from '../services/audit.js';
import { expireStaleRuns, ingestPipelineBatch, RUN_STALE_MS, sourceSchema } from '../services/catalogIngest.js';
import { HttpError, parse } from '../services/validate.js';

/** Lotes grandes (cientos de fichas con guias en Markdown): solo esta ruta amplia el limite global de 1 MB. */
const INGEST_BODY_LIMIT = 16 * 1024 * 1024;
const MAX_FICHAS = 5000;
/** Sin ejecuciones en este lapso el pipeline se muestra «en espera». */
const ACTIVE_WINDOW_HOURS = 24;
const WEBHOOK_TIMEOUT_MS = 8000;
const NO_STORE = 'private, no-store';

const sha = (v: string): Buffer => createHash('sha256').update(v).digest();

/** Token valido y configurado (>= 32 caracteres). */
const ingestToken = (): string | null => (env.PIPELINE_INGEST_TOKEN && env.PIPELINE_INGEST_TOKEN.length >= 32 ? env.PIPELINE_INGEST_TOKEN : null);

/** Solo URLs https validas; cualquier otra cosa equivale a «sin webhook». */
function webhookUrl(): string | null {
  const raw = env.PIPELINE_WEBHOOK_URL;
  if (!raw) return null;
  try {
    return new URL(raw).protocol === 'https:' ? raw : null;
  } catch {
    return null;
  }
}

/**
 * `onRequest` (antes de parsear el cuerpo): Bearer comparado en tiempo constante sobre hashes (longitud igualada).
 * Cualquier fallo, incluida la variable sin configurar, produce el 404 uniforme de una ruta inexistente.
 */
async function requireIngestToken(req: FastifyRequest): Promise<void> {
  const expected = ingestToken();
  const header = req.headers.authorization;
  const m = typeof header === 'string' ? /^Bearer (\S+)$/i.exec(header) : null;
  if (!expected || !m || !timingSafeEqual(sha(m[1]!), sha(expected))) throw new HttpError(404, 'No encontrado');
}

const envelopeSchema = z.object({
  source: sourceSchema,
  modulo: z.string().trim().min(1).max(60),
  archivo: z.string().max(160).nullish(),
  dryRun: z.boolean().optional(),
  fichas: z.array(z.unknown()).max(MAX_FICHAS),
});

export async function registerPipelineRoutes(app: FastifyInstance): Promise<void> {
  // ---- Maquina a maquina: fuera de /api/admin/*, sin cookies ni CSRF -------------------------
  app.post(
    '/api/pipeline/ingest',
    { onRequest: requireIngestToken, bodyLimit: INGEST_BODY_LIMIT, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const body = parse(envelopeSchema, req.body);
      const query = parse(z.object({ dry: z.enum(['1', 'true']).optional() }), req.query);
      void reply.header('Cache-Control', 'no-store');
      return ingestPipelineBatch({
        source: body.source,
        modulo: body.modulo,
        archivo: body.archivo ?? null,
        dryRun: body.dryRun === true || query.dry !== undefined,
        fichas: body.fichas,
        ip: req.ip,
      });
    },
  );

  // ---- Staff (ADMIN+): RBAC en `onRequest`, antes de Zod ------------------------------------
  const admin = { onRequest: requireStaffRole('ADMIN') };

  app.get('/api/admin/pipeline/runs', admin, async (req, reply) => {
    void reply.header('Cache-Control', NO_STORE);
    const q = parse(z.object({ limit: z.coerce.number().int().min(1).max(100).default(20) }), req.query);
    await expireStaleRuns();
    const since = new Date(Date.now() - ACTIVE_WINDOW_HOURS * 3_600_000);
    const [rows, recent, running, queued] = await Promise.all([
      PipelineRun.find().sort({ startedAt: -1 }).limit(q.limit).lean<PipelineRunDoc[]>(),
      // «Activo» = hubo alguna ejecucion real (no solo encolada) en las ultimas 24 h.
      PipelineRun.findOne({ status: { $ne: 'queued' }, startedAt: { $gte: since } }, { startedAt: 1 }).sort({ startedAt: -1 }).lean<{ startedAt: Date }>(),
      PipelineRun.exists({ status: 'running' }),
      PipelineRun.exists({ status: 'queued' }),
    ]);
    const last = await PipelineRun.findOne({ status: { $ne: 'queued' } }, { startedAt: 1 }).sort({ startedAt: -1 }).lean<{ startedAt: Date }>();
    return {
      runs: rows.map(toPipelineRunDTO),
      estado: {
        activo: recent !== null,
        ventanaHoras: ACTIVE_WINDOW_HOURS,
        ultimoLoteAt: last ? last.startedAt.toISOString() : null,
        enCurso: running !== null || queued !== null,
        webhookConfigurado: webhookUrl() !== null,
        ingestaConfigurada: ingestToken() !== null,
      },
    };
  });

  app.post('/api/admin/pipeline/trigger', admin, async (req, reply) => {
    void reply.header('Cache-Control', NO_STORE);
    const url = webhookUrl();
    if (!url) throw new HttpError(409, 'PIPELINE_WEBHOOK_URL no está configurada', undefined, 'PIPELINE_WEBHOOK_UNSET');
    await expireStaleRuns();
    if (await PipelineRun.exists({ status: { $in: ['queued', 'running'] }, startedAt: { $gte: new Date(Date.now() - RUN_STALE_MS) } })) {
      throw new HttpError(409, 'Ya hay una ejecución del pipeline en curso', undefined, 'PIPELINE_BUSY');
    }
    const run = await PipelineRun.create({ status: 'queued', trigger: 'manual', source: 'manual', modulo: '*', archivo: null, dryRun: false });
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ event: 'pipeline.sync', runId: run._id, requestedAt: new Date().toISOString(), nonce: randomUUID() }),
        signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
        redirect: 'error',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch {
      await PipelineRun.updateOne({ _id: run._id }, { $set: { status: 'error', finishedAt: new Date() } });
      await writeAudit(req, 'pipeline.trigger', 'pipeline_run', run._id, { ok: false });
      throw new HttpError(502, 'No se pudo avisar al pipeline', undefined, 'PIPELINE_WEBHOOK_FAILED');
    }
    await writeAudit(req, 'pipeline.trigger', 'pipeline_run', run._id, { ok: true });
    return reply.code(202).send(toPipelineRunDTO(run.toObject()));
  });
}
