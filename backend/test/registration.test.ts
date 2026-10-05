import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { countBy, createEvent, registerReq, rowsFor } from './helpers/api.js';
import { createTestContext } from './helpers/context.js';

const ctx = await createTestContext();

describe('registration', () => {
  const { app, db } = ctx;
  beforeEach(ctx.reset);
  afterAll(ctx.close);

  it('gives a seat with a ticket code and a manage token while seats remain', async () => {
    const ev = await createEvent(app, 1);
    const res = await registerReq(app, ev.id, 'Alice@Example.com ');
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body).toMatchObject({ email: 'alice@example.com', status: 'confirmed' });
    expect(body.ticketCode).toMatch(/^[2-9A-HJKMNP-Z]{8}$/);
    expect(body.manageToken).toHaveLength(32);
  });

  it('puts registrations beyond capacity on the waitlist without a ticket code', async () => {
    const ev = await createEvent(app, 1);
    await registerReq(app, ev.id, 'a@x.io');
    const res = await registerReq(app, ev.id, 'b@x.io');
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ status: 'waitlisted', ticketCode: null });
  });

  describe('INVARIANT: repeated registration with the same email does not create a second seat', () => {
    it('sequential repeat (also with different case/whitespace) returns 200 and changes nothing', async () => {
      const ev = await createEvent(app, 5);
      const first = await registerReq(app, ev.id, 'a@x.io');
      const again = await registerReq(app, ev.id, '  A@X.IO');
      expect(first.statusCode).toBe(201);
      expect(again.statusCode).toBe(200);
      // Повтор не раскрывает код билета и токен: их знает только тот, кто регистрировался.
      expect(again.json()).toEqual({ alreadyRegistered: true, status: 'confirmed', resent: false });

      const rows = await rowsFor(db, ev.id);
      expect(rows).toHaveLength(1);
    });

    it('10 parallel requests with the same email create exactly one registration', async () => {
      const ev = await createEvent(app, 5);
      const results = await Promise.all(Array.from({ length: 10 }, () => registerReq(app, ev.id, 'same@x.io')));

      expect(results.filter((r) => r.statusCode === 201)).toHaveLength(1);
      expect(results.filter((r) => r.statusCode === 200)).toHaveLength(9);
      const rows = await rowsFor(db, ev.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.status).toBe('confirmed');
    });

    it('repeat while on the waitlist keeps a single waitlisted row', async () => {
      const ev = await createEvent(app, 1);
      await registerReq(app, ev.id, 'a@x.io');
      await registerReq(app, ev.id, 'b@x.io');
      const again = await registerReq(app, ev.id, 'b@x.io');
      expect(again.json()).toEqual({ alreadyRegistered: true, status: 'waitlisted', resent: false });
      expect(countBy(await rowsFor(db, ev.id), 'waitlisted')).toBe(1);
    });
  });

  describe('INVARIANT: two people racing for the last seat -> one gets it, the other is waitlisted', () => {
    it('2 parallel registrations for 1 seat', async () => {
      const ev = await createEvent(app, 1);
      const results = await Promise.all([registerReq(app, ev.id, 'a@x.io'), registerReq(app, ev.id, 'b@x.io')]);

      expect(results.map((r) => r.statusCode)).toEqual([201, 201]);
      expect(results.map((r) => r.json().status).sort()).toEqual(['confirmed', 'waitlisted']);
      const rows = await rowsFor(db, ev.id);
      expect(countBy(rows, 'confirmed')).toBe(1);
      expect(countBy(rows, 'waitlisted')).toBe(1);
    });

    it('last seat: 1 of 3 left, 5 people race -> exactly 1 more seat, 4 waitlisted', async () => {
      const ev = await createEvent(app, 3);
      await registerReq(app, ev.id, 'early1@x.io');
      await registerReq(app, ev.id, 'early2@x.io');
      await Promise.all(Array.from({ length: 5 }, (_, i) => registerReq(app, ev.id, `late${i}@x.io`)));

      const rows = await rowsFor(db, ev.id);
      expect(countBy(rows, 'confirmed')).toBe(3);
      expect(countBy(rows, 'waitlisted')).toBe(4);
    });

    it('20 parallel registrations for 5 seats -> exactly 5 confirmed, 15 waitlisted, unique ticket codes', async () => {
      const ev = await createEvent(app, 5);
      await Promise.all(Array.from({ length: 20 }, (_, i) => registerReq(app, ev.id, `u${i}@x.io`)));

      const rows = await rowsFor(db, ev.id);
      const confirmed = rows.filter((r) => r.status === 'confirmed');
      expect(confirmed).toHaveLength(5);
      expect(countBy(rows, 'waitlisted')).toBe(15);
      expect(new Set(confirmed.map((r) => r.ticketCode)).size).toBe(5);
    });
  });

  it('waitlist order follows registration order (seq)', async () => {
    const ev = await createEvent(app, 1);
    for (const e of ['a', 'b', 'c', 'd']) await registerReq(app, ev.id, `${e}@x.io`);
    const waitlisted = (await rowsFor(db, ev.id)).filter((r) => r.status === 'waitlisted').sort((x, y) => x.seq - y.seq);
    expect(waitlisted.map((r) => r.email)).toEqual(['b@x.io', 'c@x.io', 'd@x.io']);
  });

  it('rejects invalid email (400), unknown event (404), event already started (409)', async () => {
    const ev = await createEvent(app, 1);
    expect((await registerReq(app, ev.id, 'not-an-email')).statusCode).toBe(400);
    expect((await registerReq(app, '00000000-0000-4000-8000-000000000000', 'a@x.io')).statusCode).toBe(404);

    const past = await createEvent(app, 1, new Date(Date.now() - 60_000).toISOString());
    const res = await registerReq(app, past.id, 'a@x.io');
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'event_already_started' });
  });

  it('stats reflect confirmed and waitlisted counts', async () => {
    const ev = await createEvent(app, 2);
    await Promise.all(['a', 'b', 'c'].map((e) => registerReq(app, ev.id, `${e}@x.io`)));
    const res = await app.inject({ method: 'GET', url: `/events/${ev.id}` });
    expect(res.json().stats).toEqual({ confirmed: 2, waitlisted: 1, checkedIn: 0 });
  });
});
