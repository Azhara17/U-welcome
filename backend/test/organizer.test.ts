import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { register } from '../src/services/registrations.js';
import { cancelReq, checkinReq, createEvent, registerAll, registerReq } from './helpers/api.js';
import { createTestContext } from './helpers/context.js';

const ctx = await createTestContext();
afterAll(ctx.close);
const MIN = 60_000;

describe('organizer views and ticket page', () => {
  const { app } = ctx;
  beforeEach(ctx.reset);

  it('participants: confirmed first, then waitlist with positions; search by email; cancelled hidden', async () => {
    const ev = await createEvent(app, 2);
    const [a] = await registerAll(app, ev.id, ['a@x.io', 'b@x.io', 'c@x.io', 'dan@x.io']);
    await cancelReq(app, a!.manageToken); // c получает место, dan → №1

    const list = (await app.inject({ method: 'GET', url: `/events/${ev.id}/participants` })).json();
    expect(list.map((p: { email: string; status: string; waitlistPosition: number | null }) => [p.email, p.status, p.waitlistPosition]))
      .toEqual([['b@x.io', 'confirmed', null], ['c@x.io', 'confirmed', null], ['dan@x.io', 'waitlisted', 1]]);

    const found = (await app.inject({ method: 'GET', url: `/events/${ev.id}/participants?q=DAN` })).json();
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ email: 'dan@x.io', waitlistPosition: 1 });
  });

  it('ticket page shows waitlist position and reminder date', async () => {
    const ev = await createEvent(app, 1);
    const [a, , c] = await registerAll(app, ev.id, ['a@x.io', 'b@x.io', 'c@x.io']);

    const ticketC = (await app.inject({ method: 'GET', url: `/registrations/${c!.manageToken}` })).json();
    expect(ticketC).toMatchObject({ status: 'waitlisted', waitlistPosition: 2, reminderAt: null, ticketCode: null });

    const ticketA = (await app.inject({ method: 'GET', url: `/registrations/${a!.manageToken}` })).json();
    const { startsAt } = ticketA.event;
    expect(ticketA.reminderAt).toBe(new Date(new Date(startsAt).getTime() - 24 * 60 * MIN).toISOString());
  });

  it('activity feed: registration, cancellation with promotion, check-in', async () => {
    const ev = await createEvent(app, 1);
    const [a, b] = await registerAll(app, ev.id, ['a@x.io', 'b@x.io']);
    await cancelReq(app, a!.manageToken);
    const ticketB = (await app.inject({ method: 'GET', url: `/registrations/${b!.manageToken}` })).json();
    await checkinReq(app, ev.id, ticketB.ticketCode);

    const feed = (await app.inject({ method: 'GET', url: `/events/${ev.id}/activity` })).json();
    expect(feed.map((f: { type: string; payload: unknown }) => [f.type, f.payload])).toEqual([
      ['checkin', { code: ticketB.ticketCode, email: 'b@x.io' }],
      ['cancelled', { email: 'a@x.io', wasStatus: 'confirmed', promoted: ['b@x.io'] }],
      ['registered', { email: 'b@x.io', status: 'waitlisted' }],
      ['registered', { email: 'a@x.io', status: 'confirmed' }],
    ]);
  });
});

describe('repeated registration re-sends the ticket by email (at most once per 10 minutes)', () => {
  const { app, mailer } = ctx;
  beforeEach(ctx.reset);

  it('right after registering: no resend; after 10 minutes: one resend; parallel repeats: still one', async () => {
    const ev = await createEvent(app, 1);
    await registerReq(app, ev.id, 'a@x.io');
    expect((await registerReq(app, ev.id, 'a@x.io')).json().resent).toBe(false);

    const later = new Date(Date.now() + 11 * MIN);
    const results = await Promise.all(Array.from({ length: 5 }, () => register(ctx, ev.id, 'a@x.io', later)));
    expect(results.filter((r) => !r.created && r.resent)).toHaveLength(1);

    await ctx.drainEmails();
    expect(mailer.to('a@x.io').map((m) => m.subject)).toEqual(['Ваш билет: Test event', 'Ваш билет: Test event']);
  });

  it('POST /registrations/resend: 202 for any email, sends only for an existing registration', async () => {
    const ev = await createEvent(app, 1);
    await registerReq(app, ev.id, 'a@x.io');
    await ctx.drainEmails();
    mailer.sent = [];

    for (const email of ['a@x.io', 'nobody@x.io']) {
      const res = await app.inject({ method: 'POST', url: '/registrations/resend', payload: { email } });
      expect(res.statusCode).toBe(202);
    }
    await ctx.drainEmails();
    expect(mailer.sent).toHaveLength(0); // для a@x.io ещё не прошло 10 минут с регистрации
  });
});
