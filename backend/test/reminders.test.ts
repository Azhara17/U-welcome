import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { enqueueDueReminders } from '../src/jobs/reminders.js';
import { withTx } from '../src/lib/tx.js';
import { cancelReq, createEvent, registerAll } from './helpers/api.js';
import { createTestContext } from './helpers/context.js';

const ctx = await createTestContext();
afterAll(ctx.close);
const HOUR = 3_600_000;

describe('INVARIANT: exactly one reminder a day before the event', () => {
  const { app, mailer } = ctx;
  beforeEach(ctx.reset);

  const sweep = (at: Date) => enqueueDueReminders(ctx, at);
  const reminders = (email: string) => mailer.to(email).filter((m) => m.subject.startsWith('Напоминание'));

  async function eventIn(hours: number, capacity = 5) {
    const startsAt = new Date(Date.now() + hours * HOUR);
    const ev = await createEvent(app, capacity, startsAt.toISOString());
    return { ...ev, startsAt };
  }

  it('is not sent earlier than 24h before, then sent once, never again', async () => {
    const ev = await eventIn(48);
    await registerAll(app, ev.id, ['a@x.io']);

    expect(await sweep(new Date(ev.startsAt.getTime() - 30 * HOUR))).toBe(0);
    expect(await sweep(new Date(ev.startsAt.getTime() - 23 * HOUR))).toBe(1);
    expect(await sweep(new Date(ev.startsAt.getTime() - 22 * HOUR))).toBe(0);
    expect(await sweep(new Date(ev.startsAt.getTime() - 1 * HOUR))).toBe(0);
    await ctx.drainEmails();

    const [msg] = reminders('a@x.io');
    expect(reminders('a@x.io')).toHaveLength(1);
    expect(msg!.subject).toBe('Напоминание: завтра Test event');
  });

  it('5 parallel sweeps enqueue one reminder per person', async () => {
    const ev = await eventIn(48);
    await registerAll(app, ev.id, ['a@x.io', 'b@x.io', 'c@x.io']);
    const at = new Date(ev.startsAt.getTime() - 20 * HOUR);

    const counts = await Promise.all(Array.from({ length: 5 }, () => sweep(at)));
    expect(counts.reduce((a, b) => a + b, 0)).toBe(3);
    await ctx.drainEmails();
    for (const e of ['a@x.io', 'b@x.io', 'c@x.io']) expect(reminders(e)).toHaveLength(1);
  });

  it('a duplicated reminder job still produces one email', async () => {
    const ev = await eventIn(48);
    await registerAll(app, ev.id, ['a@x.io']);
    await sweep(new Date(ev.startsAt.getTime() - 20 * HOUR));
    const [job] = (await ctx.queuedEmailJobs()).filter((j) => j.kind === 'reminder');
    await withTx(ctx.pool, (txc) => ctx.jobs.enqueueEmail(txc, job!));

    await ctx.drainEmails();
    expect(reminders('a@x.io')).toHaveLength(1);
  });

  it('only confirmed participants get it: not waitlisted, not cancelled', async () => {
    const ev = await eventIn(48, 1);
    const [a] = await registerAll(app, ev.id, ['a@x.io', 'b@x.io', 'c@x.io']);
    await cancelReq(app, a!.manageToken); // b получает место (давно, до окна напоминаний)

    expect(await sweep(new Date(ev.startsAt.getTime() - 20 * HOUR))).toBe(1);
    await ctx.drainEmails();
    expect(reminders('a@x.io')).toHaveLength(0);
    expect(reminders('b@x.io')).toHaveLength(1);
    expect(reminders('c@x.io')).toHaveLength(0);
  });

  it('registered less than 24h before the event: no reminder (the ticket email just arrived)', async () => {
    const ev = await eventIn(10);
    await registerAll(app, ev.id, ['late@x.io']);
    expect(await sweep(new Date())).toBe(0);
    expect(await sweep(new Date(ev.startsAt.getTime() - HOUR))).toBe(0);
  });

  it('no reminder once the event has started', async () => {
    const ev = await eventIn(48);
    await registerAll(app, ev.id, ['a@x.io']);
    expect(await sweep(new Date(ev.startsAt.getTime() + HOUR))).toBe(0);
  });
});

describe('INVARIANT: cancellation -> first on the waitlist gets the seat AND an email', () => {
  const { app, mailer } = ctx;
  beforeEach(ctx.reset);

  it('promoted person gets exactly one "seat available" email with their new ticket code', async () => {
    const ev = await createEvent(app, 1);
    const [a, b] = await registerAll(app, ev.id, ['a@x.io', 'b@x.io', 'c@x.io']);
    await ctx.drainEmails();
    mailer.sent = [];

    await cancelReq(app, a!.manageToken);
    await ctx.drainEmails();

    const ticket = (await app.inject({ method: 'GET', url: `/registrations/${b!.manageToken}` })).json();
    expect(mailer.sent.map((m) => [m.to, m.subject])).toEqual([['b@x.io', 'Место освободилось: Test event']]);
    expect(mailer.sent[0]!.text).toContain(`Код билета: ${ticket.ticketCode}`);
  });
});
