import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db.js';
import type { Jobs } from '../jobs/queue.js';
import type { Registration } from '../schema.js';
import { getEvent } from '../services/events.js';
import { cancel, DomainError, findByManageToken, register } from '../services/registrations.js';
import { idParams } from './events.js';

const registerBody = z.object({ email: z.string().trim().email().max(320) });
const tokenParams = z.object({ token: z.string().min(16).max(64) });

/** Полное представление: только для владельца (знает manageToken). */
export function ownerView(r: Registration) {
  return {
    id: r.id,
    eventId: r.eventId,
    email: r.email,
    status: r.status,
    ticketCode: r.status === 'confirmed' ? r.ticketCode : null,
    manageToken: r.manageToken,
    checkedInAt: r.checkedInAt,
  };
}

export async function registrationRoutes(app: FastifyInstance, opts: { db: Db; jobs: Jobs }) {
  const { db } = opts;

  app.post('/events/:id/registrations', async (req, reply) => {
    const { id } = idParams.parse(req.params);
    const { email } = registerBody.parse(req.body);
    const result = await register(opts, id, email);

    if (result.created) return reply.code(201).send(ownerView(result.registration));
    // Повторная регистрация: не раскрываем код билета и токен тому, кто знает только email.
    return reply.code(200).send({ alreadyRegistered: true, status: result.registration.status });
  });

  // Страница билета: по секретному токену из письма или ответа на регистрацию.
  app.get('/registrations/:token', async (req) => {
    const { token } = tokenParams.parse(req.params);
    const reg = await findByManageToken(db, token);
    if (!reg) throw new DomainError('registration_not_found', 404);
    const ev = await getEvent(db, reg.eventId);
    return { ...ownerView(reg), event: ev };
  });

  app.post('/registrations/:token/cancel', async (req) => {
    const { token } = tokenParams.parse(req.params);
    const result = await cancel(opts, token);
    return { ...ownerView(result.registration), alreadyCancelled: result.alreadyCancelled };
  });
}
