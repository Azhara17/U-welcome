import { sql } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';
import { buildApp } from '../../src/app.js';
import type { EmailMessage, Mailer } from '../../src/email/mailer.js';
import { startBoss } from '../../src/jobs/boss.js';
import { deliverEmail, type DeliveryResult } from '../../src/jobs/email-worker.js';
import { createJobs, EMAIL_QUEUE, type EmailJob } from '../../src/jobs/queue.js';
import { EventBus } from '../../src/realtime/bus.js';
import { createTestDb } from './db.js';

/** Почта в памяти. failNext(n) имитирует падения SMTP. */
export class FakeMailer implements Mailer {
  sent: EmailMessage[] = [];
  private failures = 0;
  failNext(n = 1) { this.failures = n; }
  async send(msg: EmailMessage) {
    if (this.failures > 0) { this.failures--; throw new Error('SMTP unavailable'); }
    this.sent.push(msg);
  }
  to(email: string) { return this.sent.filter((m) => m.to === email); }
}

export const APP_URL = 'http://app.test';

/**
 * Полный тестовый контекст: БД, pg-boss (без фоновых воркеров, задачи разбираем
 * вручную через drainEmails), приложение и фейковая почта.
 */
export async function createTestContext() {
  const { pool, db } = createTestDb();
  const boss: PgBoss = await startBoss(process.env.DATABASE_URL!);
  const jobs = createJobs(boss);
  const bus = new EventBus(process.env.DATABASE_URL!);
  await bus.start();
  const app = buildApp({ db, jobs, bus });
  const mailer = new FakeMailer();
  const workerDeps = { db, mailer, appUrl: APP_URL, timeZone: 'UTC' };

  return {
    pool, db, boss, jobs, bus, app, mailer, workerDeps,

    async reset() {
      await db.execute(sql`truncate table email_log, registrations, events restart identity cascade`);
      await boss.deleteAllJobs();
      mailer.sent = [];
    },

    /** Задачи в очереди писем (ещё не обработанные). */
    async queuedEmailJobs(): Promise<EmailJob[]> {
      const { rows } = await pool.query(`select data from pgboss.job where name = $1 and state in ('created', 'retry')`, [EMAIL_QUEUE]);
      return rows.map((r) => r.data as EmailJob);
    },

    /** Разбирает очередь писем так же, как воркер: deliverEmail + complete/fail. */
    async drainEmails(): Promise<DeliveryResult[]> {
      const results: DeliveryResult[] = [];
      for (;;) {
        const batch = await boss.fetch<EmailJob>(EMAIL_QUEUE, { batchSize: 50, ignoreStartAfter: true });
        if (batch.length === 0) return results;
        for (const job of batch) {
          try {
            results.push(await deliverEmail(workerDeps, job.data));
            await boss.complete(EMAIL_QUEUE, job.id);
          } catch (err) {
            await boss.fail(EMAIL_QUEUE, job.id, { message: (err as Error).message });
            throw err;
          }
        }
      }
    },

    async close() {
      await app.close();
      await bus.close();
      await boss.stop({ graceful: false, close: true });
      await pool.end();
    },
  };
}

export type TestContext = Awaited<ReturnType<typeof createTestContext>>;
