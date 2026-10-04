import type { PgBoss } from 'pg-boss';
import type { TxContext } from '../lib/tx.js';

export const EMAIL_QUEUE = 'email';

export type EmailKind = 'registered' | 'waitlisted' | 'promoted' | 'reminder' | 'rescheduled';

export interface EmailJob {
  kind: EmailKind;
  registrationId: string;
  /** Уникальный ключ письма: одно письмо на ключ, сколько бы раз ни выполнилась задача. */
  dedupKey: string;
  /** Для reminder/rescheduled: на какую дату события письмо. Устаревшие письма не отправляются. */
  startsAt?: string;
}

export interface Jobs {
  /** Ставит письмо в очередь внутри текущей транзакции. */
  enqueueEmail(ctx: TxContext, job: EmailJob): Promise<void>;
}

export function createJobs(boss: PgBoss): Jobs {
  return {
    async enqueueEmail({ exec }, job) {
      await boss.send(EMAIL_QUEUE, job, { db: exec });
    },
  };
}

export const emailKey = {
  registered: (registrationId: string) => `registered:${registrationId}`,
  waitlisted: (registrationId: string) => `waitlisted:${registrationId}`,
  promoted: (registrationId: string) => `promoted:${registrationId}`,
  reminder: (registrationId: string, startsAt: Date) => `reminder:${registrationId}:${startsAt.toISOString()}`,
  rescheduled: (registrationId: string, startsAt: Date) => `rescheduled:${registrationId}:${startsAt.toISOString()}`,
};
