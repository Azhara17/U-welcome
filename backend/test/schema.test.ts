import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { events, registrations } from '../src/schema.js';
import { createTestDb } from './helpers/db.js';

// Страховки на уровне БД: даже если код ошибётся, база не примет некорректное состояние.
describe('schema constraints', () => {
  const { pool, db, reset } = createTestDb();
  beforeEach(reset);
  afterAll(() => pool.end());

  const newEvent = () =>
    db.insert(events).values({ title: 'Meetup', startsAt: new Date(Date.now() + 86_400_000 * 7), capacity: 2 })
      .returning().then((r) => r[0]!);

  it('rejects a second active registration for the same email', async () => {
    const ev = await newEvent();
    await db.insert(registrations).values({ eventId: ev.id, email: 'a@x.io', status: 'confirmed', ticketCode: 'T1', manageToken: 'm1' });
    await expect(
      db.insert(registrations).values({ eventId: ev.id, email: 'a@x.io', status: 'waitlisted', manageToken: 'm2' }),
    ).rejects.toThrow();
  });

  it('allows a new registration after the previous one was cancelled', async () => {
    const ev = await newEvent();
    await db.insert(registrations).values({ eventId: ev.id, email: 'a@x.io', status: 'cancelled', manageToken: 'm1' });
    await db.insert(registrations).values({ eventId: ev.id, email: 'a@x.io', status: 'waitlisted', manageToken: 'm2' });
  });

  it('rejects non-positive capacity', async () => {
    await expect(
      db.insert(events).values({ title: 'x', startsAt: new Date(), capacity: 0 }),
    ).rejects.toThrow();
  });

  it('requires ticket code exactly for confirmed registrations', async () => {
    const ev = await newEvent();
    await expect(
      db.insert(registrations).values({ eventId: ev.id, email: 'a@x.io', status: 'confirmed', manageToken: 'm1' }),
    ).rejects.toThrow();
    await expect(
      db.insert(registrations).values({ eventId: ev.id, email: 'b@x.io', status: 'waitlisted', ticketCode: 'T2', manageToken: 'm2' }),
    ).rejects.toThrow();
  });
});
