import { and, eq, gt, isNull, lte, ne, or, sql } from 'drizzle-orm';
import type { Db } from '../db.js';
import { withTx } from '../lib/tx.js';
import { events, registrations } from '../schema.js';
import { emailKey, type Jobs } from './queue.js';

export const REMINDER_SWEEP_QUEUE = 'reminder-sweep';
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Ставит напоминания всем, у кого событие начнётся в ближайшие 24 часа и кому напоминание
 * для текущей даты события ещё не ставилось. Кто зарегистрировался (или получил место)
 * уже внутри этих суток, напоминание не получает: письмо с билетом пришло только что.
 *
 * SKIP LOCKED + отметка reminder_enqueued_for в той же транзакции: параллельные
 * сканеры не поставят одно напоминание дважды. Повтор выполнения задачи в очереди
 * дополнительно отсекает email_log.
 */
export async function enqueueDueReminders(deps: { db: Db; jobs: Jobs }, now = new Date()): Promise<number> {
  const windowEnd = new Date(now.getTime() + DAY_MS);

  return withTx(deps.db.$client, async (ctx) => {
    const due = await ctx.tx
      .select({ id: registrations.id, startsAt: events.startsAt })
      .from(registrations)
      .innerJoin(events, eq(events.id, registrations.eventId))
      .where(and(
        eq(registrations.status, 'confirmed'),
        gt(events.startsAt, now),
        lte(events.startsAt, windowEnd),
        or(isNull(registrations.reminderEnqueuedFor), ne(registrations.reminderEnqueuedFor, events.startsAt)),
        sql`coalesce(${registrations.promotedAt}, ${registrations.createdAt}) <= ${events.startsAt} - interval '24 hours'`,
      ))
      .for('update', { of: registrations, skipLocked: true });

    for (const r of due) {
      await ctx.tx.update(registrations).set({ reminderEnqueuedFor: r.startsAt }).where(eq(registrations.id, r.id));
      await deps.jobs.enqueueEmail(ctx, {
        kind: 'reminder',
        registrationId: r.id,
        dedupKey: emailKey.reminder(r.id, r.startsAt),
        startsAt: r.startsAt.toISOString(),
      });
    }
    return due.length;
  });
}
