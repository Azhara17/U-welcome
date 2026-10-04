import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { registrations } from '../src/schema.js';
import { fillSeatsFromWaitlist, lockEvent } from '../src/services/registrations.js';
import { cancelReq, countBy, createEvent, registerAll, registerReq, rowsFor } from './helpers/api.js';
import { createTestDb } from './helpers/db.js';
import { waitForLockWaiters } from './helpers/locks.js';

describe('cancellation', () => {
  const { pool, db, reset } = createTestDb();
  const app = buildApp({ db });
  beforeEach(reset);
  afterAll(async () => { await app.close(); await pool.end(); });

  const byEmail = async (eventId: string) =>
    Object.fromEntries((await rowsFor(db, eventId)).map((r) => [r.email, r]));

  describe('INVARIANT: cancellation -> first on the waitlist automatically gets the seat', () => {
    it('cancelling a confirmed seat promotes the earliest waitlisted person with a ticket code', async () => {
      const ev = await createEvent(app, 1);
      const [a] = await registerAll(app, ev.id, ['a@x.io', 'b@x.io', 'c@x.io']);

      const res = await cancelReq(app, a!.manageToken);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ status: 'cancelled', alreadyCancelled: false, ticketCode: null });

      const rows = await byEmail(ev.id);
      expect(rows['a@x.io']!.status).toBe('cancelled');
      expect(rows['b@x.io']!.status).toBe('confirmed');
      expect(rows['b@x.io']!.ticketCode).toMatch(/^[2-9A-HJKMNP-Z]{8}$/);
      expect(rows['b@x.io']!.promotedAt).not.toBeNull();
      expect(rows['c@x.io']!.status).toBe('waitlisted');
    });

    it('promoted person sees their new ticket via their manage token', async () => {
      const ev = await createEvent(app, 1);
      const [a, b] = await registerAll(app, ev.id, ['a@x.io', 'b@x.io']);
      expect(b!.ticketCode).toBeNull();
      await cancelReq(app, a!.manageToken);

      const ticket = await app.inject({ method: 'GET', url: `/registrations/${b!.manageToken}` });
      expect(ticket.statusCode).toBe(200);
      expect(ticket.json()).toMatchObject({ status: 'confirmed', email: 'b@x.io', event: { id: ev.id } });
      expect(ticket.json().ticketCode).toMatch(/^[2-9A-HJKMNP-Z]{8}$/);
    });

    it('cancelling a waitlisted registration promotes nobody and keeps the queue order', async () => {
      const ev = await createEvent(app, 1);
      const [, b] = await registerAll(app, ev.id, ['a@x.io', 'b@x.io', 'c@x.io']);
      await cancelReq(app, b!.manageToken);

      const rows = await byEmail(ev.id);
      expect(rows['a@x.io']!.status).toBe('confirmed');
      expect(rows['b@x.io']!.status).toBe('cancelled');
      expect(rows['c@x.io']!.status).toBe('waitlisted');
    });

    it('a free seat with an empty waitlist simply stays free', async () => {
      const ev = await createEvent(app, 2);
      const [a] = await registerAll(app, ev.id, ['a@x.io']);
      await cancelReq(app, a!.manageToken);
      const rows = await rowsFor(db, ev.id);
      expect(countBy(rows, 'confirmed')).toBe(0);
    });

    it('a newcomer cannot jump the queue: after a cancel the seat goes to the waitlist, newcomer waits', async () => {
      const ev = await createEvent(app, 1);
      const [a] = await registerAll(app, ev.id, ['a@x.io', 'b@x.io']);
      await cancelReq(app, a!.manageToken);
      const c = await registerReq(app, ev.id, 'c@x.io');
      expect(c.json().status).toBe('waitlisted');
      expect((await byEmail(ev.id))['b@x.io']!.status).toBe('confirmed');
    });
  });

  it('repeated cancel is idempotent: 200, alreadyCancelled, no second promotion', async () => {
    const ev = await createEvent(app, 1);
    const [a] = await registerAll(app, ev.id, ['a@x.io', 'b@x.io', 'c@x.io']);
    await cancelReq(app, a!.manageToken);
    const again = await cancelReq(app, a!.manageToken);
    expect(again.statusCode).toBe(200);
    expect(again.json().alreadyCancelled).toBe(true);

    const rows = await byEmail(ev.id);
    expect(rows['b@x.io']!.status).toBe('confirmed');
    expect(rows['c@x.io']!.status).toBe('waitlisted');
  });

  it('after cancelling, the same email can register again and goes to the end of the queue', async () => {
    const ev = await createEvent(app, 1);
    const [a] = await registerAll(app, ev.id, ['a@x.io', 'b@x.io']);
    await cancelReq(app, a!.manageToken);
    const again = await registerReq(app, ev.id, 'a@x.io');
    expect(again.statusCode).toBe(201);
    expect(again.json().status).toBe('waitlisted');
    expect((await rowsFor(db, ev.id)).filter((r) => r.email === 'a@x.io')).toHaveLength(2);
  });

  it('unknown token -> 404, malformed token -> 400', async () => {
    expect((await cancelReq(app, 'x'.repeat(32))).statusCode).toBe(404);
    expect((await cancelReq(app, 'short')).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: `/registrations/${'x'.repeat(32)}` })).statusCode).toBe(404);
  });

  describe('concurrency', () => {
    it('the same cancel sent 5 times in parallel promotes exactly one person', async () => {
      const ev = await createEvent(app, 1);
      const [a] = await registerAll(app, ev.id, ['a@x.io', 'b@x.io', 'c@x.io']);
      const results = await Promise.all(Array.from({ length: 5 }, () => cancelReq(app, a!.manageToken)));

      expect(results.every((r) => r.statusCode === 200)).toBe(true);
      expect(results.filter((r) => r.json().alreadyCancelled === false)).toHaveLength(1);
      const rows = await byEmail(ev.id);
      expect(rows['b@x.io']!.status).toBe('confirmed');
      expect(rows['c@x.io']!.status).toBe('waitlisted');
    });

    it('3 parallel cancels with a long waitlist -> exactly the next 3 by order get seats, never over capacity', async () => {
      const ev = await createEvent(app, 3);
      const emails = Array.from({ length: 10 }, (_, i) => `p${i}@x.io`);
      const regs = await registerAll(app, ev.id, emails);
      const confirmed = regs.filter((r) => r.status === 'confirmed');

      await Promise.all(confirmed.map((r) => cancelReq(app, r.manageToken)));

      const rows = await rowsFor(db, ev.id);
      expect(countBy(rows, 'confirmed')).toBe(3);
      const nowConfirmed = rows.filter((r) => r.status === 'confirmed').map((r) => r.email).sort();
      expect(nowConfirmed).toEqual(['p3@x.io', 'p4@x.io', 'p5@x.io']);
    });

    it('cancel racing with new registrations: the seat goes to the waitlist, newcomers are waitlisted', async () => {
      const ev = await createEvent(app, 1);
      const [a] = await registerAll(app, ev.id, ['a@x.io', 'b@x.io']);
      await Promise.all([
        cancelReq(app, a!.manageToken),
        ...Array.from({ length: 5 }, (_, i) => registerReq(app, ev.id, `new${i}@x.io`)),
      ]);

      const rows = await rowsFor(db, ev.id);
      expect(countBy(rows, 'confirmed')).toBe(1);
      expect(rows.find((r) => r.status === 'confirmed')!.email).toBe('b@x.io');
      expect(countBy(rows, 'waitlisted')).toBe(5);
    });

    it('mixed storm of registrations and cancels never exceeds capacity', async () => {
      const ev = await createEvent(app, 4);
      const initial = await registerAll(app, ev.id, Array.from({ length: 8 }, (_, i) => `s${i}@x.io`));
      await Promise.all([
        ...initial.filter((_, i) => i % 2 === 0).map((r) => cancelReq(app, r.manageToken)),
        ...Array.from({ length: 10 }, (_, i) => registerReq(app, ev.id, `n${i}@x.io`)),
      ]);

      const rows = await rowsFor(db, ev.id);
      expect(countBy(rows, 'confirmed')).toBe(4);
      expect(countBy(rows, 'cancelled')).toBe(4);
      expect(countBy(rows, 'waitlisted')).toBe(10);
    });
  
    it('cancel decides by the status under the lock, not by a stale read before it', async () => {
      // Детерминированно воспроизводим окно гонки: b в листе ожидания отправляет отказ,
      // но пока его запрос ждёт блокировку события, a отказывается и b получает место.
      // Отказ b должен увидеть, что b уже confirmed, и отдать место следующему (c).
      const ev = await createEvent(app, 1);
      const [a, b] = await registerAll(app, ev.id, ['a@x.io', 'b@x.io', 'c@x.io']);
      expect(b!.status).toBe('waitlisted');

      let releaseLock!: () => void;
      const lockHeld = new Promise<void>((r) => { releaseLock = r; });
      let lockAcquired!: () => void;
      const acquired = new Promise<void>((r) => { lockAcquired = r; });

      const holder = db.transaction(async (tx) => {
        const locked = await lockEvent(tx, ev.id);
        lockAcquired();
        await lockHeld;
        await tx.update(registrations).set({ status: 'cancelled', cancelledAt: new Date() })
          .where(eq(registrations.manageToken, a!.manageToken));
        await fillSeatsFromWaitlist(tx, locked);
      });

      await acquired;
      const bCancel = cancelReq(app, b!.manageToken);
      await waitForLockWaiters(pool, 1);
      releaseLock();
      await holder;
      expect((await bCancel).statusCode).toBe(200);

      const rows = await byEmail(ev.id);
      expect(rows['a@x.io']!.status).toBe('cancelled');
      expect(rows['b@x.io']!.status).toBe('cancelled');
      expect(rows['c@x.io']!.status).toBe('confirmed');
    });
  });
});
