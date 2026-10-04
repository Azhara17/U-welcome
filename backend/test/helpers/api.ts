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
