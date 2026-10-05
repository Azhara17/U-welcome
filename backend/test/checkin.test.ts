import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { cancelReq, checkinReq, createEvent, registerAll } from './helpers/api.js';
import { createTestContext } from './helpers/context.js';

const ctx = await createTestContext();
afterAll(ctx.close);

describe('INVARIANT: a ticket passes check-in only once', () => {
  const { app } = ctx;
  beforeEach(ctx.reset);

  const stats = async (eventId: string) => (await app.inject({ method: 'GET', url: `/events/${eventId}` })).json().stats;

  it('first check-in is accepted, the repeat is rejected with the time of the first one', async () => {
    const ev = await createEvent(app, 2);
    const [a] = await registerAll(app, ev.id, ['a@x.io']);

    const first = (await checkinReq(app, ev.id, a!.ticketCode!)).json();
    expect(first).toMatchObject({ result: 'accepted', email: 'a@x.io', code: a!.ticketCode });

    const again = (await checkinReq(app, ev.id, a!.ticketCode!)).json();
    expect(again).toMatchObject({ result: 'already_checked_in', email: 'a@x.io', checkedInAt: first.checkedInAt });
    expect((await stats(ev.id)).checkedIn).toBe(1);
  });

  it('10 parallel check-ins of the same code: exactly one accepted, counter +1', async () => {
    const ev = await createEvent(app, 2);
    const [a] = await registerAll(app, ev.id, ['a@x.io']);

    const results = (await Promise.all(Array.from({ length: 10 }, () => checkinReq(app, ev.id, a!.ticketCode!)))).map((r) => r.json());
    expect(results.filter((r) => r.result === 'accepted')).toHaveLength(1);
    expect(results.filter((r) => r.result === 'already_checked_in')).toHaveLength(9);
    expect((await stats(ev.id)).checkedIn).toBe(1);
  });

  it('code typed by hand: lowercase, dash and spaces are accepted', async () => {
    const ev = await createEvent(app, 2);
    const [a] = await registerAll(app, ev.id, ['a@x.io']);
    const typed = ` ${a!.ticketCode!.slice(0, 4).toLowerCase()}-${a!.ticketCode!.slice(4)} `;
    expect((await checkinReq(app, ev.id, typed)).json().result).toBe('accepted');
  });

  it('unknown code, code from another event, cancelled ticket are rejected', async () => {
    const ev = await createEvent(app, 2);
    const other = await createEvent(app, 2);
    const [a, b] = await registerAll(app, ev.id, ['a@x.io', 'b@x.io']);
    const [c] = await registerAll(app, other.id, ['c@x.io']);
    await cancelReq(app, b!.manageToken);

    expect((await checkinReq(app, ev.id, 'ZZ001234')).json().result).toBe('not_found');
    expect((await checkinReq(app, ev.id, c!.ticketCode!)).json().result).toBe('not_found');
    expect((await checkinReq(app, ev.id, b!.ticketCode!)).json().result).toBe('cancelled');
    expect((await stats(ev.id)).checkedIn).toBe(0);
    expect(a).toBeDefined();
  });

  it('a checked-in participant cannot cancel anymore (409)', async () => {
    const ev = await createEvent(app, 2);
    const [a] = await registerAll(app, ev.id, ['a@x.io']);
    await checkinReq(app, ev.id, a!.ticketCode!);
    const res = await cancelReq(app, a!.manageToken);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'already_checked_in' });
  });

  it('every check-in attempt lands in the activity feed (shared "recent checks")', async () => {
    const ev = await createEvent(app, 2);
    const [a] = await registerAll(app, ev.id, ['a@x.io']);
    await checkinReq(app, ev.id, a!.ticketCode!);
    await checkinReq(app, ev.id, a!.ticketCode!);
    await checkinReq(app, ev.id, 'ZZ001234');

    const feed = (await app.inject({
      method: 'GET', url: `/events/${ev.id}/activity?types=checkin,checkin_repeat,checkin_not_found,checkin_cancelled`,
    })).json();
    expect(feed.map((f: { type: string }) => f.type)).toEqual(['checkin_not_found', 'checkin_repeat', 'checkin']);
  });
});
