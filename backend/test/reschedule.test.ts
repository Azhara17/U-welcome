import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { enqueueDueReminders } from '../src/jobs/reminders.js';
import { cancelReq, createEvent, registerAll } from './helpers/api.js';
import { createTestContext } from './helpers/context.js';

const ctx = await createTestContext();
afterAll(ctx.close);
const HOUR = 3_600_000;

const reschedule = (eventId: string, startsAt: Date) =>
  ctx.app.inject({ method: 'PATCH', url: `/events/${eventId}`, payload: { startsAt: startsAt.toISOString() } });

describe('INVARIANT: rescheduling an event emails all participants', () => {
  const { app, mailer } = ctx;
  beforeEach(ctx.reset);

  const rescheduled = (email: string) => mailer.to(email).filter((m) => m.subject.startsWith('Событие перенесено'));

  it('confirmed and waitlisted participants get one email with the new date; cancelled do not', async () => {
    const ev = await createEvent(app, 2);
    const [a] = await registerAll(app, ev.id, ['a@x.io', 'b@x.io', 'c@x.io', 'd@x.io']);
    await cancelReq(app, a!.manageToken); // a отказался, c получил место, d в листе ожидания
    await ctx.drainEmails();
    mailer.sent = [];

    const newDate = new Date('2030-03-15T15:00:00Z');
    const res = await reschedule(ev.id, newDate);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ startsAt: newDate.toISOString(), notified: 3 });
    await ctx.drainEmails();

    expect(rescheduled('a@x.io')).toHaveLength(0);
    for (const e of ['b@x.io', 'c@x.io', 'd@x.io']) {
      expect(rescheduled(e)).toHaveLength(1);
      expect(rescheduled(e)[0]!.text).toContain('Новая дата: 15 марта 2030');
    }
    expect(rescheduled('b@x.io')[0]!.text).toContain('Ваш билет остаётся в силе');
    expect(rescheduled('d@x.io')[0]!.text).toContain('Вы по-прежнему в листе ожидания');
  });

  it('the same date again: no emails', async () => {
    const ev = await createEvent(app, 2);
    await registerAll(app, ev.id, ['a@x.io']);
    const { startsAt } = (await app.inject({ method: 'GET', url: `/events/${ev.id}` })).json();
    const res = await reschedule(ev.id, new Date(startsAt));
    expect(res.json().notified).toBe(0);
  });

  it('two quick reschedules: only the email about the latest date is sent', async () => {
    const ev = await createEvent(app, 2);
    await registerAll(app, ev.id, ['a@x.io']);
    await ctx.drainEmails();
    mailer.sent = [];

    await reschedule(ev.id, new Date('2030-03-15T15:00:00Z'));
    await reschedule(ev.id, new Date('2030-04-20T15:00:00Z'));
    await ctx.drainEmails();

    expect(rescheduled('a@x.io')).toHaveLength(1);
    expect(rescheduled('a@x.io')[0]!.text).toContain('20 апреля 2030');
  });

  it('reminder: one for the old date, then one more for the new date', async () => {
    const startsAt = new Date(Date.now() + 48 * HOUR);
    const ev = await createEvent(app, 2, startsAt.toISOString());
    await registerAll(app, ev.id, ['a@x.io']);
    await enqueueDueReminders(ctx, new Date(startsAt.getTime() - 20 * HOUR));
    await ctx.drainEmails();

    const newStart = new Date(startsAt.getTime() + 72 * HOUR);
    await reschedule(ev.id, newStart);
    expect(await enqueueDueReminders(ctx, new Date(newStart.getTime() - 20 * HOUR))).toBe(1);
    await ctx.drainEmails();
    expect(mailer.to('a@x.io').filter((m) => m.subject.startsWith('Напоминание'))).toHaveLength(2);
  });

  it('a reminder queued for the old date is not sent after rescheduling', async () => {
    const startsAt = new Date(Date.now() + 48 * HOUR);
    const ev = await createEvent(app, 2, startsAt.toISOString());
    await registerAll(app, ev.id, ['a@x.io']);
    await enqueueDueReminders(ctx, new Date(startsAt.getTime() - 20 * HOUR)); // в очереди, ещё не отправлено
    await reschedule(ev.id, new Date(startsAt.getTime() + 72 * HOUR));
    await ctx.drainEmails();
    expect(mailer.to('a@x.io').filter((m) => m.subject.startsWith('Напоминание'))).toHaveLength(0);
  });

  it('rejects a date in the past (400) and an unknown event (404)', async () => {
    const ev = await createEvent(app, 2);
    expect((await reschedule(ev.id, new Date(Date.now() - HOUR))).statusCode).toBe(400);
    expect((await reschedule('00000000-0000-4000-8000-000000000000', new Date('2030-01-01'))).statusCode).toBe(404);
  });
});
