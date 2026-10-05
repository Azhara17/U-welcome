import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db.js';
import type { Jobs } from '../jobs/queue.js';
import { activityType } from '../schema.js';
import { listActivity } from '../services/activity.js';
import { checkIn } from '../services/checkin.js';
import { createEvent, getEvent, getEventStats, listEvents, listParticipants, rescheduleEvent } from '../services/events.js';
import { DomainError } from '../services/registrations.js';

const createBody = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(5000).optional(),
  location: z.string().max(500).optional(),
  category: z.string().max(100).optional(),
  startsAt: z.coerce.date(),
  capacity: z.number().int().positive().max(100_000),
});

const rescheduleBody = z.object({ startsAt: z.coerce.date() });
const checkinBody = z.object({ code: z.string().trim().min(1).max(32) });
const participantsQuery = z.object({ q: z.string().trim().max(320).optional() });
const activityQuery = z.object({
  types: z.string().optional().transform((s) => s?.split(',').filter(Boolean)).pipe(z.array(z.enum(activityType.enumValues)).optional()),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const idParams = z.object({ id: z.string().uuid() });

export async function eventRoutes(app: FastifyInstance, opts: { db: Db; jobs: Jobs }) {
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

  // Чекин по коду (ввод с клавиатуры вместо сканера). 200 и для отклонённых: это результат проверки, а не ошибка.
  app.post('/events/:id/checkin', async (req) => {
    const { id } = idParams.parse(req.params);
    const { code } = checkinBody.parse(req.body);
    return checkIn(opts, id, code);
  });

  app.get('/events/:id/participants', async (req) => {
    const { id } = idParams.parse(req.params);
    const { q } = participantsQuery.parse(req.query);
    if (!(await getEvent(db, id))) throw new DomainError('event_not_found', 404);
    return listParticipants(db, id, q || undefined);
  });

  app.get('/events/:id/activity', async (req) => {
    const { id } = idParams.parse(req.params);
    const { types, limit } = activityQuery.parse(req.query);
    if (!(await getEvent(db, id))) throw new DomainError('event_not_found', 404);
    return listActivity(db, id, { types, limit });
  });

  // Перенос события: письмо всем участникам (с местом и в листе ожидания).
  app.patch('/events/:id', async (req) => {
    const { id } = idParams.parse(req.params);
    const { startsAt } = rescheduleBody.parse(req.body);
    const result = await rescheduleEvent(opts, id, startsAt);
    return { ...result.event, notified: result.notified };
  });
}
