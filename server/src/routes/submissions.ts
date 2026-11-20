import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth, requireStaffRole } from '../plugins/auth.js';
import {
  Submission,
  submissionCreateSchema,
  submissionReviewSchema,
  submissionStatusSchema,
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

  app.get('/api/admin/submissions', moderation, async (req) => {
    const q = parse(
      z.object({ status: submissionStatusSchema.optional(), limit: z.coerce.number().int().min(1).max(200).default(50) }),
      req.query,
    );
    // La bandeja contact/newsletter es solo ADMIN+.
    const isAdmin = req.authUser!.rol === 'ADMIN' || req.authUser!.rol === 'SUPER_ADMIN';
    const filter: Record<string, unknown> = q.status ? { status: q.status } : {};
    if (!isAdmin) filter['type'] = { $nin: ['contact', 'newsletter'] };
    const rows = await Submission.find(filter)
      .sort({ createdAt: -1 })
      .limit(q.limit)
      .lean<SubmissionDoc[]>();
    return rows.map(toSubmissionDTO);
  });

  app.patch('/api/admin/submissions/:id', moderation, async (req) => {
    const { id } = parse(idParamsSchema, req.params);
    const { status } = parse(submissionReviewSchema, req.body);
    const updated = await reviewSubmission(id, status, req.authUser!, req.ip);
    return toSubmissionDTO(updated);
  });
}
