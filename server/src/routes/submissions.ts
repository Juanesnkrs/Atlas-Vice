import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth, requireStaffRole } from '../plugins/auth.js';
import {
  Submission,
  submissionCreateSchema,
  submissionReviewSchema,
  submissionStatusSchema,
  submissionTypeSchema,
  toSubmissionDTO,
  type SubmissionDoc,
} from '../models/Submission.js';
import { bulkReview, createUserSubmission, PIPELINE_REASONS, reviewSubmission } from '../services/submissions.js';
import { parseTarjeta } from '../services/catalogIngest.js';
import { writeAudit } from '../services/audit.js';
import { HttpError, idParamsSchema, parse } from '../services/validate.js';

const bulkSchema = z
  .object({
    action: z.enum(['approve', 'reject']),
    ids: z.array(z.uuid()).min(1).max(200).optional(),
    filter: z
      .object({
        origin: z.literal('pipeline'),
        status: z.literal('pending'),
        runId: z.uuid().optional(),
        reason: z.enum(PIPELINE_REASONS).optional(),
      })
      .optional(),
    reviewNote: z.string().trim().max(500).optional(),
  })
  .refine((v) => (v.ids === undefined) !== (v.filter === undefined), { message: 'Indica ids o filter (uno solo)', path: ['ids'] })
  .refine((v) => v.action === 'reject' || v.reviewNote === undefined, { message: 'reviewNote solo se admite al rechazar', path: ['reviewNote'] });

export async function registerSubmissionRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/api/submissions',
    { preHandler: requireAuth, config: { rateLimit: { max: 20, timeWindow: '1 hour' } } },
    async (req, reply) => {
      const body = parse(submissionCreateSchema, req.body);
      const doc = await createUserSubmission(req.authUser!, body, req.ip);
      return reply.code(201).send(toSubmissionDTO(doc));
    },
  );

  app.get('/api/submissions/mine', { preHandler: requireAuth }, async (req) => {
    const rows = await Submission.find({ userId: req.authUser!._id })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean<SubmissionDoc[]>();
    return rows.map(toSubmissionDTO);
  });

  const moderation = { onRequest: requireStaffRole('MODERATOR') };

  /** La bandeja contact/newsletter es solo ADMIN+: un MODERATOR nunca la ve (ni la cuenta). */
  const visibleTypes = (rol: string): Record<string, unknown> =>
    rol === 'ADMIN' || rol === 'SUPER_ADMIN' ? {} : { type: { $nin: ['contact', 'newsletter'] } };

  /**
   * Cola de moderacion. Sin `envelope` devuelve un array (limit hasta 200); con `envelope=1` pagina de verdad
   * y responde { items, total, page, pages } (filtros: status, type).
   */
  app.get('/api/admin/submissions', moderation, async (req, reply) => {
    void reply.header('Cache-Control', 'private, no-store');
    const q = parse(
      z.object({
        status: submissionStatusSchema.optional(),
        type: submissionTypeSchema.optional(),
        origin: z.enum(['user', 'pipeline']).optional(),
        runId: z.uuid().optional(),
        reason: z.enum(PIPELINE_REASONS).optional(),
        limit: z.coerce.number().int().min(1).max(200).default(50),
        page: z.coerce.number().int().min(1).max(10_000).default(1),
        envelope: z.enum(['1']).optional(),
      }),
      req.query,
    );
    const filter: Record<string, unknown> = {
      ...(q.status ? { status: q.status } : {}),
      ...(q.origin ? { origin: q.origin } : {}),
      ...(q.runId ? { 'payload.pipeline_run_id': q.runId } : {}),
      ...(q.reason ? { 'payload.pipeline_reason': q.reason } : {}),
      ...visibleTypes(req.authUser!.rol),
    };
    if (q.type) {
      const hidden = (visibleTypes(req.authUser!.rol).type as { $nin: string[] } | undefined)?.$nin ?? [];
      filter['type'] = hidden.includes(q.type) ? '__none__' : q.type;
    }
    const [total, rows] = await Promise.all([
      Submission.countDocuments(filter),
      Submission.find(filter)
        .sort({ createdAt: -1, _id: 1 })
        .skip((q.page - 1) * q.limit)
        .limit(q.limit)
        .lean<SubmissionDoc[]>(),
    ]);
    const items = rows.map(toSubmissionDTO);
    return q.envelope ? { items, total, page: q.page, pages: Math.max(1, Math.ceil(total / q.limit)) } : items;
  });

  /** Miniatura de la tarjeta provisional de un aporte del pipeline (solo staff; el base64 nunca va en los listados). */
  app.get('/api/admin/submissions/:id/tarjeta.webp', moderation, async (req, reply) => {
    void reply.header('Cache-Control', 'private, no-store');
    const { id } = parse(idParamsSchema, req.params);
    const sub = await Submission.findOne({ _id: id, origin: 'pipeline' }, { payload: 1 }).lean<Pick<SubmissionDoc, 'payload'>>();
    const t = sub ? parseTarjeta((sub.payload as { tarjeta?: { mime?: unknown; base64?: unknown } }).tarjeta ?? {}) : null;
    if (!t || !t.ok) throw new HttpError(404, 'No encontrado');
    return reply.header('X-Content-Type-Options', 'nosniff').type('image/webp').send(t.buffer);
  });

  /**
   * Lote de moderacion (MODERATOR+; RBAC en onRequest, antes de Zod). Por ids (<= 200) o por filter del pipeline
   * (tope BULK_MAX por llamada). Procesa en secuencia sin abortar; devuelve el resultado por item.
   */
  app.post('/api/admin/submissions/bulk', { ...moderation, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    void reply.header('Cache-Control', 'private, no-store');
    const body = parse(bulkSchema, req.body);
    const result = await bulkReview(body, req.authUser!, req.ip);
    await writeAudit(req, 'submission.bulk', 'Submission', null, { action: body.action, requested: result.requested, ok: result.ok, failed: result.failed });
    return result;
  });

  /** Insignia de pendientes de la pestana de moderacion (consulta ligera, sin cuerpo de aportes). */
  app.get('/api/admin/submissions/pending-count', moderation, async (req, reply) => {
    void reply.header('Cache-Control', 'private, no-store');
    return { pending: await Submission.countDocuments({ status: 'pending', ...visibleTypes(req.authUser!.rol) }) };
  });

  app.patch('/api/admin/submissions/:id', moderation, async (req) => {
    const { id } = parse(idParamsSchema, req.params);
    const { status, reviewNote, coords } = parse(submissionReviewSchema, req.body);
    const updated = await reviewSubmission(id, status, req.authUser!, req.ip, reviewNote, coords);
    return toSubmissionDTO(updated);
  });
}
