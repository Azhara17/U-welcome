import { and, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import type { Db } from '../db.js';
import { emailKey } from '../jobs/queue.js';
import { withTx } from '../lib/tx.js';
import { events, registrations, type Event } from '../schema.js';
import { DomainError, lockEvent, type ServiceDeps } from './registrations.js';

export interface NewEvent {
  title: string;
  description?: string;
  startsAt: Date;
  capacity: number;
}

export interface EventStats {
  confirmed: number;
  waitlisted: number;
  checkedIn: number;
}

export async function createEvent(db: Db, input: NewEvent): Promise<Event> {
  const [ev] = await db.insert(events).values(input).returning();
  return ev!;
}

export async function listEvents(db: Db): Promise<Event[]> {
  return db.select().from(events).orderBy(desc(events.startsAt));
}

export async function getEvent(db: Db, id: string): Promise<Event | undefined> {
  const [ev] = await db.select().from(events).where(eq(events.id, id));
  return ev;
}

export async function getEventStats(db: Db, eventId: string): Promise<EventStats> {
  const [row] = await db
    .select({
      confirmed: sql<number>`count(*) filter (where ${registrations.status} = 'confirmed')::int`,
      waitlisted: sql<number>`count(*) filter (where ${registrations.status} = 'waitlisted')::int`,
      checkedIn: sql<number>`count(*) filter (where ${registrations.status} = 'confirmed' and ${isNotNull(registrations.checkedInAt)})::int`,
    })
    .from(registrations)
    .where(and(eq(registrations.eventId, eventId)));
  return row!;
}

export interface RescheduleResult {
  event: Event;
  /** Скольким участникам поставлено письмо о переносе. */
  notified: number;
}

/**
 * Перенос события. Под блокировкой события меняет дату и ставит письмо всем
 * участникам (с местом и в листе ожидания) в той же транзакции.
 */
export async function rescheduleEvent(deps: ServiceDeps, eventId: string, startsAt: Date, now = new Date()): Promise<RescheduleResult> {
  if (startsAt <= now) throw new DomainError('starts_at_in_past', 400);

  return withTx(deps.db.$client, async (ctx) => {
    const ev = await lockEvent(ctx.tx, eventId);
    if (ev.startsAt <= now) throw new DomainError('event_already_started', 409);
    if (ev.startsAt.getTime() === startsAt.getTime()) return { event: ev, notified: 0 };

    const [updated] = await ctx.tx
      .update(events)
      .set({ startsAt, updatedAt: now })
      .where(eq(events.id, eventId))
      .returning();

    const participants = await ctx.tx
      .select({ id: registrations.id })
      .from(registrations)
      .where(and(eq(registrations.eventId, eventId), inArray(registrations.status, ['confirmed', 'waitlisted'])));

    for (const { id } of participants) {
      await deps.jobs.enqueueEmail(ctx, {
        kind: 'rescheduled',
        registrationId: id,
        dedupKey: emailKey.rescheduled(id, startsAt),
        startsAt: startsAt.toISOString(),
      });
    }
    return { event: updated!, notified: participants.length };
  });
}
