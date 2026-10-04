import { PgBoss } from 'pg-boss';
import { deliverEmail, type EmailWorkerDeps } from './email-worker.js';
import { EMAIL_QUEUE, type EmailJob } from './queue.js';

export async function startBoss(connectionString: string, onError: (err: Error) => void = () => {}) {
  const boss = new PgBoss({ connectionString, schema: 'pgboss' });
  boss.on('error', onError);
  await boss.start();
  if (!(await boss.getQueue(EMAIL_QUEUE))) {
    await boss.createQueue(EMAIL_QUEUE, { retryLimit: 10, retryDelay: 5, retryBackoff: true });
  }
  return boss;
}

export async function startEmailWorker(boss: PgBoss, deps: EmailWorkerDeps) {
  return boss.work<EmailJob>(EMAIL_QUEUE, { batchSize: 1, pollingIntervalSeconds: 1 }, async ([job]) => {
    await deliverEmail(deps, job!.data);
  });
}
