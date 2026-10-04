import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { deliverEmail } from '../src/jobs/email-worker.js';
import { emailKey } from '../src/jobs/queue.js';
import { withTx } from '../src/lib/tx.js';
import { emailLog, registrations } from '../src/schema.js';
import { cancelReq, createEvent, registerAll, registerReq } from './helpers/api.js';
import { APP_URL, createTestContext } from './helpers/context.js';

const ctx = await createTestContext();

describe('emails', () => {
  const { app, db, pool, jobs, mailer } = ctx;
  beforeEach(ctx.reset);
  afterAll(ctx.close);

  describe('on registration', () => {
    it('confirmed: one email with ticket code and a link to manage the ticket', async () => {
      const ev = await createEvent(app, 1);
      const reg = (await registerReq(app, ev.id, 'a@x.io')).json();
      expect(await ctx.drainEmails()).toEqual(['sent']);

      const [msg] = mailer.to('a@x.io');
      expect(mailer.sent).toHaveLength(1);
      expect(msg!.subject).toBe('Ваш билет: Test event');
      expect(msg!.text).toContain(`Код билета: ${reg.ticketCode}`);
      expect(msg!.text).toContain(`${APP_URL}/tickets/${reg.manageToken}`);
    });

    it('waitlisted: one "waitlist" email without a ticket code', async () => {
      const ev = await createEvent(app, 1);
      await registerAll(app, ev.id, ['a@x.io', 'b@x.io']);
      await ctx.drainEmails();

      const [msg] = mailer.to('b@x.io');
      expect(mailer.to('b@x.io')).toHaveLength(1);
      expect(msg!.subject).toBe('Лист ожидания: Test event');
      expect(msg!.text).not.toContain('Код билета');
    });

    it('repeated registration does not enqueue a second email', async () => {
      const ev = await createEvent(app, 2);
      await registerReq(app, ev.id, 'a@x.io');
      await registerReq(app, ev.id, 'a@x.io');
      await Promise.all(Array.from({ length: 5 }, () => registerReq(app, ev.id, 'a@x.io')));
      expect(await ctx.queuedEmailJobs()).toHaveLength(1);
      await ctx.drainEmails();
      expect(mailer.to('a@x.io')).toHaveLength(1);
    });

    it('failed registration (event already started) enqueues nothing', async () => {
      const past = await createEvent(app, 1, new Date(Date.now() - 60_000).toISOString());
      expect((await registerReq(app, past.id, 'a@x.io')).statusCode).toBe(409);
      expect(await ctx.queuedEmailJobs()).toHaveLength(0);
    });
  });

  describe('transactional enqueue', () => {
    it('a job enqueued in a rolled back transaction disappears with it', async () => {
      const ev = await createEvent(app, 1);
      const reg = (await registerReq(app, ev.id, 'a@x.io')).json();
      await ctx.drainEmails();

      await expect(withTx(pool, async (txc) => {
        await jobs.enqueueEmail(txc, { kind: 'promoted', registrationId: reg.id, dedupKey: 'rollback-probe' });
        throw new Error('boom');
      })).rejects.toThrow('boom');
      expect(await ctx.queuedEmailJobs()).toHaveLength(0);
    });
  });

  describe('delivery is deduplicated by dedupKey', () => {
    it('the same job delivered twice sends one email', async () => {
      const ev = await createEvent(app, 1);
      const reg = (await registerReq(app, ev.id, 'a@x.io')).json();
      const job = { kind: 'registered' as const, registrationId: reg.id, dedupKey: emailKey.registered(reg.id) };

      expect(await deliverEmail(ctx.workerDeps, job)).toBe('sent');
      expect(await deliverEmail(ctx.workerDeps, job)).toBe('duplicate');
      expect(mailer.sent).toHaveLength(1);
    });

    it('the same job delivered 5 times in parallel sends one email', async () => {
      const ev = await createEvent(app, 1);
      const reg = (await registerReq(app, ev.id, 'a@x.io')).json();
      const job = { kind: 'registered' as const, registrationId: reg.id, dedupKey: emailKey.registered(reg.id) };

      const results = await Promise.all(Array.from({ length: 5 }, () => deliverEmail(ctx.workerDeps, job)));
      expect(results.filter((r) => r === 'sent')).toHaveLength(1);
      expect(mailer.sent).toHaveLength(1);
    });

    it('SMTP failure leaves no log entry, so the retry sends exactly one email', async () => {
      const ev = await createEvent(app, 1);
      const reg = (await registerReq(app, ev.id, 'a@x.io')).json();
      const job = { kind: 'registered' as const, registrationId: reg.id, dedupKey: emailKey.registered(reg.id) };

      mailer.failNext();
      await expect(deliverEmail(ctx.workerDeps, job)).rejects.toThrow('SMTP unavailable');
      expect(await db.select().from(emailLog)).toHaveLength(0);

      expect(await deliverEmail(ctx.workerDeps, job)).toBe('sent');
      expect(mailer.sent).toHaveLength(1);
    });

    it('stale emails are skipped: "waitlisted" after promotion, anything after cancellation', async () => {
      const ev = await createEvent(app, 1);
      const [a, b] = await registerAll(app, ev.id, ['a@x.io', 'b@x.io']);
      await cancelReq(app, a!.manageToken); // b продвинут ещё до того, как письма разобраны

      await ctx.drainEmails();
      expect(mailer.to('a@x.io')).toHaveLength(0); // a отказался до отправки билета
      expect(mailer.to('b@x.io').map((m) => m.subject)).toEqual(['Место освободилось: Test event']);
      const [bRow] = await db.select().from(registrations).where(eq(registrations.manageToken, b!.manageToken));
      expect(bRow!.status).toBe('confirmed');
    });
  });
});
