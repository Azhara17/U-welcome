import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb } from '../src/db.js';
import { register } from '../src/services/registrations.js';
import { checkinReq, createEvent, registerAll, registerReq } from './helpers/api.js';
import { createTestContext } from './helpers/context.js';
import { openSse } from './helpers/sse.js';

const ctx = await createTestContext();
let base = '';
beforeAll(async () => { base = await ctx.app.listen({ port: 0, host: '127.0.0.1' }); });
afterAll(ctx.close);

describe('INVARIANT: live counters (SSE) — two open tabs see the same updates', () => {
  const { app } = ctx;
  beforeEach(ctx.reset);

  it('first message is a snapshot of the event with stats; proper SSE headers', async () => {
    const ev = await createEvent(app, 3);
    await registerAll(app, ev.id, ['a@x.io']);
    const s = await openSse(`${base}/events/${ev.id}/stream`);
    try {
      expect(s.headers.get('content-type')).toContain('text/event-stream');
      const first = await s.first();
      expect(first.event).toBe('snapshot');
      expect(first.data).toMatchObject({ id: ev.id, capacity: 3, stats: { confirmed: 1, waitlisted: 0, checkedIn: 0 } });
    } finally { s.close(); }
  });

  it('check-in in one "tab" updates the counter in two other open streams', async () => {
    const ev = await createEvent(app, 3);
    const [a] = await registerAll(app, ev.id, ['a@x.io']);
    const organizer = await openSse(`${base}/events/${ev.id}/stream`);
    const secondTab = await openSse(`${base}/events/${ev.id}/stream`);
    try {
      await organizer.first();
      await secondTab.first();

      await checkinReq(app, ev.id, a!.ticketCode!);
      const pred = (m: { data: { stats: { checkedIn: number } } }) => m.data.stats.checkedIn === 1;
      await organizer.next(pred);
      await secondTab.next(pred);
    } finally { organizer.close(); secondTab.close(); }
  });

  it('free seats update live on registration', async () => {
    const ev = await createEvent(app, 3);
    const s = await openSse(`${base}/events/${ev.id}/stream`);
    try {
      await s.first();
      await registerReq(app, ev.id, 'a@x.io');
      await s.next((m) => m.data.stats.confirmed === 1);
    } finally { s.close(); }
  });

  it('changes made by another backend instance (separate connection pool) arrive too', async () => {
    const ev = await createEvent(app, 3);
    const s = await openSse(`${base}/events/${ev.id}/stream`);
    const other = createDb(process.env.DATABASE_URL!);
    try {
      await s.first();
      await register({ db: other.db, jobs: ctx.jobs }, ev.id, 'from-other@x.io');
      await s.next((m) => m.data.stats.confirmed === 1);
    } finally { s.close(); await other.pool.end(); }
  });

  it('streams of other events are not notified', async () => {
    const ev = await createEvent(app, 3);
    const other = await createEvent(app, 3);
    const s = await openSse(`${base}/events/${ev.id}/stream`);
    try {
      await s.first();
      await registerReq(app, other.id, 'a@x.io');
      await expect(s.next(() => true, 500)).rejects.toThrow('no matching message');
    } finally { s.close(); }
  });

  it('LISTEN connection drops (e.g. DB restart): bus reconnects, streams get a fresh snapshot and keep updating', async () => {
    const ev = await createEvent(app, 3);
    const s = await openSse(`${base}/events/${ev.id}/stream`);
    try {
      await s.first();
      const pid = ctx.bus.backendPid!;
      await ctx.pool.query('select pg_terminate_backend($1)', [pid]);

      // Регистрация сразу после обрыва: её уведомление может потеряться, но после
      // переподключения поток всё равно получит актуальный снимок (resync).
      await registerReq(app, ev.id, 'during-outage@x.io');
      await s.next((m) => m.data.stats.confirmed === 1, 10_000);
      expect(ctx.bus.backendPid).not.toBe(pid);

      await registerReq(app, ev.id, 'after@x.io');
      await s.next((m) => m.data.stats.confirmed === 2);
    } finally { s.close(); }
  });

  it('unknown event -> 404', async () => {
    const res = await fetch(`${base}/events/00000000-0000-4000-8000-000000000000/stream`);
    expect(res.status).toBe(404);
  });
});
