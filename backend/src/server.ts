import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createDb, runMigrations } from './db.js';
import { createSmtpMailer } from './email/mailer.js';
import { startBoss, startEmailWorker, startReminderSweeper } from './jobs/boss.js';
import { createJobs } from './jobs/queue.js';
import { seedDemoEvent } from './seed.js';

const config = loadConfig();
const { pool, db } = createDb(config.DATABASE_URL);
await runMigrations(db);
if (config.SEED_DEMO) await seedDemoEvent(db);

const boss = await startBoss(config.DATABASE_URL, (err) => console.error('pg-boss error', err));
const mailer = createSmtpMailer({ host: config.SMTP_HOST, port: config.SMTP_PORT, from: config.MAIL_FROM });
await startEmailWorker(boss, { db, mailer, appUrl: config.APP_URL, timeZone: config.DISPLAY_TIMEZONE });

const jobs = createJobs(boss);
await startReminderSweeper(boss, { db, jobs });

const app = buildApp({ db, jobs }, { logger: true });

const shutdown = async () => {
  await app.close();
  await boss.stop({ graceful: true, timeout: 10_000 });
  await pool.end();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ port: config.PORT, host: config.HOST });
