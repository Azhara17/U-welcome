import { PgBoss } from 'pg-boss';
import { deliverEmail, type EmailWorkerDeps } from './email-worker.js';
import { EMAIL_QUEUE, type EmailJob, type Jobs } from './queue.js';
import { enqueueDueReminders, REMINDER_SWEEP_QUEUE } from './reminders.js';
import type { Db } from '../db.js';

export async function startBoss(connectionString: string, onError: (err: Error) => void = () => {}) {
  const boss = new PgBoss({ connectionString, schema: 'pgboss' });
  boss.on('error', onError);
  await boss.start();
  if (!(await boss.getQueue(EMAIL_QUEUE))) {
    await boss.createQueue(EMAIL_QUEUE, { retryLimit: 10, retryDelay: 5, retryBackoff: true });
  }
  if (!(await boss.getQueue(REMINDER_SWEEP_QUEUE))) {
    await boss.createQueue(REMINDER_SWEEP_QUEUE);
  }
  return boss;
}

export async function startEmailWorker(boss: PgBoss, deps: EmailWorkerDeps) {
  return boss.work<EmailJob>(EMAIL_QUEUE, { batchSize: 1, pollingIntervalSeconds: 1 }, async ([job]) => {
    await deliverEmail(deps, job!.data);
  });
}

/** Сканер напоминаний раз в минуту (cron pg-boss хранится в БД и переживает перезапуск). */
export async function startReminderSweeper(boss: PgBoss, deps: { db: Db; jobs: Jobs }) {
  await boss.schedule(REMINDER_SWEEP_QUEUE, '* * * * *');
  return boss.work(REMINDER_SWEEP_QUEUE, async () => {
    await enqueueDueReminders(deps);
  });
}
