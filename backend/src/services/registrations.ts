import { and, eq, ne, sql } from 'drizzle-orm';
import type { Db } from '../db.js';
import { generateManageToken, generateTicketCode, normalizeEmail } from '../lib/codes.js';
import { isUniqueViolation } from '../lib/pg-errors.js';
import { events, registrations, type Registration } from '../schema.js';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export class DomainError extends Error {
  constructor(public readonly code: string, public readonly httpStatus: number) {
    super(code);
  }
}

export type RegisterResult = { created: true; registration: Registration } | { created: false; registration: Registration };

/**
 * Блокирует строку события до конца транзакции. Все операции, меняющие
 * распределение мест (регистрация, отказ, продвижение из листа ожидания), идут
 * через неё, поэтому для одного события они выполняются строго по очереди.
 */
export async function lockEvent(tx: Tx, eventId: string) {
  const [ev] = await tx.select().from(events).where(eq(events.id, eventId)).for('update');
  if (!ev) throw new DomainError('event_not_found', 404);
  return ev;
}

async function countConfirmed(tx: Tx, eventId: string): Promise<number> {
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(registrations)
    .where(and(eq(registrations.eventId, eventId), eq(registrations.status, 'confirmed')));
  return row!.n;
}

async function findActive(db: Db | Tx, eventId: string, email: string) {
  const [row] = await db
    .select()
    .from(registrations)
    .where(and(eq(registrations.eventId, eventId), eq(registrations.email, email), ne(registrations.status, 'cancelled')));
  return row;
}

const MAX_ATTEMPTS = 3;

export async function register(db: Db, eventId: string, rawEmail: string, now = new Date()): Promise<RegisterResult> {
  const email = normalizeEmail(rawEmail);

  for (let attempt = 1; ; attempt++) {
    try {
      return await db.transaction(async (tx) => {
        const ev = await lockEvent(tx, eventId);
        if (ev.startsAt <= now) throw new DomainError('event_already_started', 409);

        const existing = await findActive(tx, eventId, email);
        if (existing) return { created: false, registration: existing };

        const hasSeat = (await countConfirmed(tx, eventId)) < ev.capacity;
        const [registration] = await tx
          .insert(registrations)
          .values({
            eventId,
            email,
            status: hasSeat ? 'confirmed' : 'waitlisted',
            ticketCode: hasSeat ? generateTicketCode() : null,
            manageToken: generateManageToken(),
          })
          .returning();
        return { created: true, registration: registration! };
      });
    } catch (err) {
      // Коллизия случайного кода билета: крайне маловероятна, просто повторяем.
      if (attempt < MAX_ATTEMPTS && isUniqueViolation(err, 'registrations_ticket_code')) continue;
      // Страховка: при блокировке события сюда не попадаем, но если индекс сработал, отдаём существующую запись.
      if (isUniqueViolation(err, 'registrations_event_email_active')) {
        const existing = await findActive(db, eventId, email);
        if (existing) return { created: false, registration: existing };
      }
      throw err;
    }
  }
}
