import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Db } from '../../src/db.js';
import { registrations } from '../../src/schema.js';

export const inAWeek = () => new Date(Date.now() + 7 * 86_400_000).toISOString();

export async function createEvent(app: FastifyInstance, capacity: number, startsAt = inAWeek()) {
  const res = await app.inject({ method: 'POST', url: '/events', payload: { title: 'Test event', startsAt, capacity } });
  if (res.statusCode !== 201) throw new Error(`createEvent failed: ${res.body}`);
  return res.json() as { id: string };
}

export function registerReq(app: FastifyInstance, eventId: string, email: string) {
  return app.inject({ method: 'POST', url: `/events/${eventId}/registrations`, payload: { email } });
}

export async function rowsFor(db: Db, eventId: string) {
  return db.select().from(registrations).where(eq(registrations.eventId, eventId));
}

export const countBy = <T extends { status: string }>(rows: T[], status: string) =>
  rows.filter((r) => r.status === status).length;

export function cancelReq(app: FastifyInstance, manageToken: string) {
  return app.inject({ method: 'POST', url: `/registrations/${manageToken}/cancel` });
}

/** Регистрирует по очереди и возвращает тела ответов (с manageToken). */
export async function registerAll(app: FastifyInstance, eventId: string, emails: string[]) {
  const out: { email: string; status: string; manageToken: string; ticketCode: string | null }[] = [];
  for (const email of emails) out.push((await registerReq(app, eventId, email)).json());
  return out;
}
