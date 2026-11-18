import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createContactSubmission, createNewsletterSubscription } from '../services/submissions.js';
import { parse } from '../services/validate.js';

const email = z.email().max(254).transform((v) => v.toLowerCase());
// Honeypot: campo oculto en el cliente; si llega con texto se trata como bot.
const honeypot = z.string().optional();

const contactBody = z.object({
  email,
  message: z.string().trim().min(10).max(2000),
  website: honeypot,
});
const subscribeBody = z.object({
  email,
  locale: z.enum(['es', 'en']),
  website: honeypot,
});

const isBot = (website: string | undefined): boolean => Boolean(website && website.trim());

/** Endpoints publicos del Footer (sin sesion). Persisten como Submission userId null. */
export async function registerContactRoutes(app: FastifyInstance): Promise<void> {
  const limit = { rateLimit: { max: 5, timeWindow: '1 hour' } };

  app.post('/api/contact', { config: limit }, async (req, reply) => {
    const { website, ...data } = parse(contactBody, req.body);
    if (!isBot(website)) await createContactSubmission(data);
    return reply.code(201).send({ ok: true });
  });

  app.post('/api/subscribe', { config: limit }, async (req, reply) => {
    const { website, ...data } = parse(subscribeBody, req.body);
    if (!isBot(website)) await createNewsletterSubscription(data);
    return reply.code(201).send({ ok: true });
  });
}
