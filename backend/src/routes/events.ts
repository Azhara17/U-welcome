import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db.js';
import { createEvent, getEvent, getEventStats, listEvents } from '../services/events.js';

const createBody = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(5000).optional(),
  startsAt: z.coerce.date(),
  capacity: z.number().int().positive().max(100_000),
});

export const idParams = z.object({ id: z.string().uuid() });

export async function eventRoutes(app: FastifyInstance, opts: { db: Db }) {
  const { db } = opts;

  app.post('/events', async (req, reply) => {
    const body = createBody.parse(req.body);
    const ev = await createEvent(db, body);
    return reply.code(201).send(ev);
  });

  app.get('/events', async () => listEvents(db));

  app.get('/events/:id', async (req, reply) => {
    const { id } = idParams.parse(req.params);
    const ev = await getEvent(db, id);
    if (!ev) return reply.code(404).send({ error: 'event_not_found' });
    return { ...ev, stats: await getEventStats(db, id) };
  });
}
