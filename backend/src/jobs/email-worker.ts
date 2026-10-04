import { eq, sql } from 'drizzle-orm';
import type { Db } from '../db.js';
import type { Mailer } from '../email/mailer.js';
import { renderEmail } from '../email/templates.js';
import { withTx } from '../lib/tx.js';
import { emailLog, events, registrations } from '../schema.js';
import type { EmailJob } from './queue.js';

export interface EmailWorkerDeps {
  db: Db;
  mailer: Mailer;
  appUrl: string;
  timeZone: string;
}

export type DeliveryResult = 'sent' | 'duplicate' | 'stale';

/**
 * Доставляет одно письмо. Под advisory-блокировкой по dedupKey:
 * проверить журнал → проверить, что письмо ещё актуально → отправить → записать в журнал.
 * Ошибка SMTP откатывает транзакцию, и pg-boss повторит задачу.
 */
export async function deliverEmail(deps: EmailWorkerDeps, job: EmailJob): Promise<DeliveryResult> {
  return withTx(deps.db.$client, async ({ tx }) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${job.dedupKey}))`);

    const [already] = await tx.select().from(emailLog).where(eq(emailLog.dedupKey, job.dedupKey));
    if (already) return 'duplicate';

    const [row] = await tx
      .select({ registration: registrations, event: events })
      .from(registrations)
      .innerJoin(events, eq(events.id, registrations.eventId))
      .where(eq(registrations.id, job.registrationId));
    if (!row || !isStillRelevant(job, row.registration.status, row.event.startsAt)) return 'stale';

    const msg = renderEmail(job.kind, { ...row, appUrl: deps.appUrl, timeZone: deps.timeZone });
    await deps.mailer.send({ to: row.registration.email, ...msg });
    await tx.insert(emailLog).values({
      dedupKey: job.dedupKey,
      kind: job.kind,
      registrationId: job.registrationId,
      recipient: row.registration.email,
      subject: msg.subject,
    });
    return 'sent';
  });
}

function isStillRelevant(job: EmailJob, status: string, startsAt: Date): boolean {
  switch (job.kind) {
    case 'registered':
    case 'promoted':
      return status === 'confirmed';
    case 'waitlisted':
      // Если человека уже продвинули, вместо этого письма придёт «место освободилось».
      return status === 'waitlisted';
    case 'reminder':
      return status === 'confirmed' && job.startsAt === startsAt.toISOString();
    case 'rescheduled':
      return status !== 'cancelled' && job.startsAt === startsAt.toISOString();
  }
}
