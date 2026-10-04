import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestContext } from './helpers/context.js';

const ctx = await createTestContext();

describe('events API', () => {
  const { app } = ctx;
  beforeEach(ctx.reset);
  afterAll(ctx.close);

  const startsAt = new Date(Date.now() + 7 * 86_400_000).toISOString();

  it('creates an event and returns it with zero stats', async () => {
    const created = await app.inject({
      method: 'POST', url: '/events',
      payload: { title: 'Meetup', description: 'Talks', startsAt, capacity: 3 },
    });
    expect(created.statusCode).toBe(201);
    const ev = created.json();
    expect(ev).toMatchObject({ title: 'Meetup', description: 'Talks', capacity: 3, startsAt });

    const got = await app.inject({ method: 'GET', url: `/events/${ev.id}` });
    expect(got.statusCode).toBe(200);
    expect(got.json().stats).toEqual({ confirmed: 0, waitlisted: 0, checkedIn: 0 });

    const list = await app.inject({ method: 'GET', url: '/events' });
    expect(list.json()).toHaveLength(1);
  });

  it.each([
    ['empty title', { title: ' ', startsAt, capacity: 1 }],
    ['zero capacity', { title: 'x', startsAt, capacity: 0 }],
    ['fractional capacity', { title: 'x', startsAt, capacity: 1.5 }],
    ['bad date', { title: 'x', startsAt: 'not-a-date', capacity: 1 }],
  ])('rejects %s with 400', async (_name, payload) => {
    const res = await app.inject({ method: 'POST', url: '/events', payload });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('validation_error');
  });

  it('returns 404 for an unknown event and 400 for a malformed id', async () => {
    const missing = await app.inject({ method: 'GET', url: '/events/00000000-0000-4000-8000-000000000000' });
    expect(missing.statusCode).toBe(404);
    const bad = await app.inject({ method: 'GET', url: '/events/nope' });
    expect(bad.statusCode).toBe(400);
  });
});
