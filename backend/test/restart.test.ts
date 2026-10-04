import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { createSmtpMailer } from '../src/email/mailer.js';
import { startBoss, startEmailWorker } from '../src/jobs/boss.js';
import { createJobs } from '../src/jobs/queue.js';
import { createEvent, registerReq } from './helpers/api.js';
import { createTestDb } from './helpers/db.js';
import { mailpitMessagesTo, waitForMailpit } from './helpers/mailpit.js';

// Интеграционный: реальный pg-boss, реальный SMTP (Mailpit из docker compose).
describe('INVARIANT: nothing is lost on server restart (queued emails)', () => {
  const { pool, db, reset } = createTestDb();
  afterAll(() => pool.end());

  it('email queued before a "crash" is delivered by the next server instance, exactly once', async () => {
    await reset();
    const email = `restart-${randomUUID()}@x.io`;

    // Инстанс №1: принимает регистрацию и «падает», не успев отправить письмо (воркер не запущен).
    const boss1 = await startBoss(process.env.DATABASE_URL!);
    await boss1.deleteAllJobs();
    const app1 = buildApp({ db, jobs: createJobs(boss1) });
    const ev = await createEvent(app1, 1);
    expect((await registerReq(app1, ev.id, email)).statusCode).toBe(201);
    await app1.close();
    await boss1.stop({ graceful: false, close: true });
    expect(await mailpitMessagesTo(email)).toHaveLength(0);

    // Инстанс №2: поднимается с воркером и дорабатывает очередь.
    const boss2 = await startBoss(process.env.DATABASE_URL!);
    try {
      await startEmailWorker(boss2, {
        db,
        mailer: createSmtpMailer({ host: process.env.SMTP_HOST ?? 'localhost', port: 1025, from: 'test@u-welcome.local' }),
        appUrl: 'http://localhost:8080',
        timeZone: 'UTC',
      });
      const msgs = await waitForMailpit(email, 1);
      expect(msgs).toHaveLength(1);
      expect(msgs[0]!.Subject).toBe('Ваш билет: Test event');

      // Чуть подождём: второго письма появиться не должно.
      await new Promise((r) => setTimeout(r, 1500));
      expect(await mailpitMessagesTo(email)).toHaveLength(1);
    } finally {
      await boss2.stop({ graceful: true, close: true, timeout: 5000 });
    }
  }, 30_000);
});
