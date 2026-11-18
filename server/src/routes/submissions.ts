import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth, requireRole } from '../plugins/auth.js';
import {
  Submission,
  submissionCreateSchema,
  submissionReviewSchema,
  submissionStatusSchema,
  toSubmissionDTO,
  type SubmissionDoc,
} from '../models/Submission.js';
import { writeAudit } from '../services/audit.js';
import { HttpError, idParamsSchema, parse } from '../services/validate.js';

export async function registerSubmissionRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/api/submissions',
    { preHandler: requireAuth, config: { rateLimit: { max: 20, timeWindow: '1 hour' } } },
    async (req, reply) => {
      const body = parse(submissionCreateSchema, req.body);
      const doc = await Submission.create({ ...body, userId: req.authUser!._id, status: 'pending', reviewedBy: null });
      return reply.code(201).send(toSubmissionDTO(doc.toObject() as SubmissionDoc));
    },
  );

  app.get('/api/submissions/mine', { preHandler: requireAuth }, async (req) => {
    const rows = await Submission.find({ userId: req.authUser!._id })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean<SubmissionDoc[]>();
    return rows.map(toSubmissionDTO);
  });

  const admin = { preHandler: requireRole('ADMIN') };

  app.get('/api/admin/submissions', admin, async (req) => {
    const q = parse(
      z.object({ status: submissionStatusSchema.optional(), limit: z.coerce.number().int().min(1).max(200).default(50) }),
      req.query,
    );
    const rows = await Submission.find(q.status ? { status: q.status } : {})
      .sort({ createdAt: -1 })
      .limit(q.limit)
      .lean<SubmissionDoc[]>();
    return rows.map(toSubmissionDTO);
  });

  app.patch('/api/admin/submissions/:id', admin, async (req) => {
    const { id } = parse(idParamsSchema, req.params);
    const { status } = parse(submissionReviewSchema, req.body);
    const prev = await Submission.findById(id).lean<SubmissionDoc>();
    if (!prev) throw new HttpError(404, 'Aporte no encontrado');
    const updated = await Submission.findByIdAndUpdate(
      id,
      { $set: { status, reviewedBy: req.authUser!._id } },
      { returnDocument: 'after' },
    ).lean<SubmissionDoc>();
    await writeAudit(req, `submission.${status}`, 'Submission', id, { from: prev.status, to: status });
    return updated ? toSubmissionDTO(updated) : null;
  });
}
