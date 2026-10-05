import { and, asc, desc, eq, ilike, inArray, isNotNull, sql } from 'drizzle-orm';
import type { Db } from '../db.js';
import { emailKey } from '../jobs/queue.js';
import { withTx } from '../lib/tx.js';
import { events, registrations, type Event } from '../schema.js';
import { logActivity } from './activity.js';
import { DomainError, lockEvent, type ServiceDeps } from './registrations.js';

export interface NewEvent {
  title: string;
  description?: string;
  location?: string;
  category?: string;
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
    await logActivity(ctx.tx, eventId, 'rescheduled', { from: ev.startsAt, to: startsAt, notified: participants.length }, now);
    return { event: updated!, notified: participants.length };
  });
}

export interface Participant {
  id: string;
  email: string;
  status: 'confirmed' | 'waitlisted';
  waitlistPosition: number | null;
  registeredAt: Date;
  checkedInAt: Date | null;
}

/** Участники для организатора: сначала с местом, потом лист ожидания по очереди. */
export async function listParticipants(db: Db, eventId: string, query?: string): Promise<Participant[]> {
  const rows = await db
    .select()
    .from(registrations)
    .where(and(
      eq(registrations.eventId, eventId),
      inArray(registrations.status, ['confirmed', 'waitlisted']),
      query ? ilike(registrations.email, `%${query.replace(/[%_\\]/g, '\\$&')}%`) : undefined,
    ))
    .orderBy(asc(registrations.seq));

  // Номер в очереди считаем по полному списку, а не по отфильтрованному поиском.
  const positions = new Map(
    (await db.select({ id: registrations.id }).from(registrations)
      .where(and(eq(registrations.eventId, eventId), eq(registrations.status, 'waitlisted')))
      .orderBy(asc(registrations.seq)))
      .map((r, i) => [r.id, i + 1]),
  );

  const toParticipant = (r: (typeof rows)[number]): Participant => ({
    id: r.id,
    email: r.email,
    status: r.status as Participant['status'],
    waitlistPosition: positions.get(r.id) ?? null,
    registeredAt: r.createdAt,
    checkedInAt: r.checkedInAt,
  });
  return [
    ...rows.filter((r) => r.status === 'confirmed').map(toParticipant),
    ...rows.filter((r) => r.status === 'waitlisted').map(toParticipant),
  ];
}
