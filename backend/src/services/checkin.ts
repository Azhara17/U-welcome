import { and, eq, isNull } from 'drizzle-orm';
import { normalizeTicketCode } from '../lib/codes.js';
import { withTx } from '../lib/tx.js';
import { events, registrations } from '../schema.js';
import { logActivity } from './activity.js';
import { DomainError, type ServiceDeps } from './registrations.js';

export type CheckinResult =
  | { result: 'accepted'; code: string; email: string; checkedInAt: Date }
  | { result: 'already_checked_in'; code: string; email: string; checkedInAt: Date }
  | { result: 'cancelled'; code: string; email: string }
  | { result: 'not_found'; code: string };

/**
 * Чекин по коду. Отметка ставится одним условным UPDATE (… AND checked_in_at IS NULL):
 * из параллельных попыток с одним кодом проходит ровно одна. Каждая попытка,
 * включая отклонённые, попадает в ленту событий.
 */
export async function checkIn(deps: ServiceDeps, eventId: string, rawCode: string, now = new Date()): Promise<CheckinResult> {
  const code = normalizeTicketCode(rawCode);

  return withTx(deps.db.$client, async ({ tx }) => {
    const [ev] = await tx.select({ id: events.id }).from(events).where(eq(events.id, eventId));
    if (!ev) throw new DomainError('event_not_found', 404);

    const [accepted] = await tx
      .update(registrations)
      .set({ checkedInAt: now })
      .where(and(
        eq(registrations.eventId, eventId),
        eq(registrations.ticketCode, code),
        eq(registrations.status, 'confirmed'),
        isNull(registrations.checkedInAt),
      ))
      .returning();
    if (accepted) {
      await logActivity(tx, eventId, 'checkin', { code, email: accepted.email }, now);
      return { result: 'accepted', code, email: accepted.email, checkedInAt: now };
    }

    const [reg] = await tx
      .select()
      .from(registrations)
      .where(and(eq(registrations.eventId, eventId), eq(registrations.ticketCode, code)));
    if (!reg) {
      await logActivity(tx, eventId, 'checkin_not_found', { code }, now);
      return { result: 'not_found', code };
    }
    if (reg.status === 'cancelled') {
      await logActivity(tx, eventId, 'checkin_cancelled', { code, email: reg.email }, now);
      return { result: 'cancelled', code, email: reg.email };
    }
    await logActivity(tx, eventId, 'checkin_repeat', { code, email: reg.email, checkedInAt: reg.checkedInAt }, now);
    return { result: 'already_checked_in', code, email: reg.email, checkedInAt: reg.checkedInAt! };
  });
}
