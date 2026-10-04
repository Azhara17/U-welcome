import { and, desc, eq, isNotNull, sql } from 'drizzle-orm';
import type { Db } from '../db.js';
import { events, registrations, type Event } from '../schema.js';

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
