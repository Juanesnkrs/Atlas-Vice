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
import { createUserSubmission, reviewSubmission } from '../services/submissions.js';
import { idParamsSchema, parse } from '../services/validate.js';

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
        limit: z.coerce.number().int().min(1).max(200).default(50),
        page: z.coerce.number().int().min(1).max(10_000).default(1),
        envelope: z.enum(['1']).optional(),
      }),
      req.query,
    );
    const filter: Record<string, unknown> = { ...(q.status ? { status: q.status } : {}), ...visibleTypes(req.authUser!.rol) };
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

  /** Insignia de pendientes de la pestana de moderacion (consulta ligera, sin cuerpo de aportes). */
  app.get('/api/admin/submissions/pending-count', moderation, async (req, reply) => {
    void reply.header('Cache-Control', 'private, no-store');
    return { pending: await Submission.countDocuments({ status: 'pending', ...visibleTypes(req.authUser!.rol) }) };
  });

  app.patch('/api/admin/submissions/:id', moderation, async (req) => {
    const { id } = parse(idParamsSchema, req.params);
    const { status, reviewNote } = parse(submissionReviewSchema, req.body);
    const updated = await reviewSubmission(id, status, req.authUser!, req.ip, reviewNote);
    return toSubmissionDTO(updated);
  });
}
