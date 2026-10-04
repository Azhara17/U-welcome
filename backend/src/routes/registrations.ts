import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db.js';
import type { Registration } from '../schema.js';
import { register } from '../services/registrations.js';
import { idParams } from './events.js';

const registerBody = z.object({ email: z.string().trim().email().max(320) });

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

export async function registrationRoutes(app: FastifyInstance, opts: { db: Db }) {
  const { db } = opts;

  app.post('/events/:id/registrations', async (req, reply) => {
    const { id } = idParams.parse(req.params);
    const { email } = registerBody.parse(req.body);
    const result = await register(db, id, email);

    if (result.created) return reply.code(201).send(ownerView(result.registration));
    // Повторная регистрация: не раскрываем код билета и токен тому, кто знает только email.
    return reply.code(200).send({ alreadyRegistered: true, status: result.registration.status });
  });
}
