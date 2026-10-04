import { and, asc, eq, ne, sql } from 'drizzle-orm';
import type { Db } from '../db.js';
import { emailKey, type Jobs } from '../jobs/queue.js';
import { generateManageToken, generateTicketCode, normalizeEmail } from '../lib/codes.js';
import { isUniqueViolation } from '../lib/pg-errors.js';
import { withTx, type Tx, type TxContext } from '../lib/tx.js';
import { events, registrations, type Event, type Registration } from '../schema.js';

export interface ServiceDeps {
  db: Db;
  jobs: Jobs;
}

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

/** Транзакция с повтором при коллизии случайного кода билета (крайне маловероятна). */
async function inTxWithTicketRetry<T>(db: Db, fn: (ctx: TxContext) => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await withTx(db.$client, fn);
    } catch (err) {
      if (attempt < MAX_ATTEMPTS && isUniqueViolation(err, 'registrations_ticket_code')) continue;
      throw err;
    }
  }
}

/**
 * Заполняет свободные места из листа ожидания по порядку seq и ставит каждому
 * продвинутому письмо «место освободилось» в той же транзакции.
 * Вызывать только под lockEvent.
 */
export async function fillSeatsFromWaitlist(ctx: TxContext, jobs: Jobs, ev: Event, now = new Date()): Promise<Registration[]> {
  const { tx } = ctx;
  const free = ev.capacity - (await countConfirmed(tx, ev.id));
  if (free <= 0) return [];

  const next = await tx
    .select({ id: registrations.id })
    .from(registrations)
    .where(and(eq(registrations.eventId, ev.id), eq(registrations.status, 'waitlisted')))
    .orderBy(asc(registrations.seq))
    .limit(free);

  const promoted: Registration[] = [];
  for (const { id } of next) {
    const [row] = await tx
      .update(registrations)
      .set({ status: 'confirmed', ticketCode: generateTicketCode(), promotedAt: now })
      .where(eq(registrations.id, id))
      .returning();
    await jobs.enqueueEmail(ctx, { kind: 'promoted', registrationId: id, dedupKey: emailKey.promoted(id) });
    promoted.push(row!);
  }
  return promoted;
}

export async function register(deps: ServiceDeps, eventId: string, rawEmail: string, now = new Date()): Promise<RegisterResult> {
  const { db, jobs } = deps;
  const email = normalizeEmail(rawEmail);

  try {
    return await inTxWithTicketRetry(db, async (ctx) => {
      const { tx } = ctx;
      const ev = await lockEvent(tx, eventId);
      if (ev.startsAt <= now) throw new DomainError('event_already_started', 409);

      const existing = await findActive(tx, eventId, email);
      if (existing) return { created: false, registration: existing };

      // Свободного места при непустой очереди не бывает: отказ заполняет его из очереди
      // в той же транзакции. Поэтому новичок не может обогнать лист ожидания.
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
      const id = registration!.id;
      await jobs.enqueueEmail(ctx, hasSeat
        ? { kind: 'registered', registrationId: id, dedupKey: emailKey.registered(id) }
        : { kind: 'waitlisted', registrationId: id, dedupKey: emailKey.waitlisted(id) });
      return { created: true, registration: registration! };
    });
  } catch (err) {
    // Страховка: при блокировке события сюда не попадаем, но если индекс сработал, отдаём существующую запись.
    if (isUniqueViolation(err, 'registrations_event_email_active')) {
      const existing = await findActive(db, eventId, email);
      if (existing) return { created: false, registration: existing };
    }
    throw err;
  }
}

export async function findByManageToken(db: Db, token: string): Promise<Registration | undefined> {
  const [row] = await db.select().from(registrations).where(eq(registrations.manageToken, token));
  return row;
}

export interface CancelResult {
  registration: Registration;
  alreadyCancelled: boolean;
  /** Кто получил место из листа ожидания (им уже поставлено письмо). */
  promoted: Registration[];
}

export async function cancel(deps: ServiceDeps, manageToken: string, now = new Date()): Promise<CancelResult> {
  const { db, jobs } = deps;
  const found = await findByManageToken(db, manageToken);
  if (!found) throw new DomainError('registration_not_found', 404);

  return inTxWithTicketRetry(db, async (ctx) => {
    const { tx } = ctx;
    const ev = await lockEvent(tx, found.eventId);
    // Перечитываем под блокировкой: параллельный отказ мог уже изменить статус.
    const [current] = await tx.select().from(registrations).where(eq(registrations.id, found.id));
    if (current!.status === 'cancelled') return { registration: current!, alreadyCancelled: true, promoted: [] };
    if (ev.startsAt <= now) throw new DomainError('event_already_started', 409);

    const [cancelled] = await tx
      .update(registrations)
      .set({ status: 'cancelled', cancelledAt: now })
      .where(eq(registrations.id, current!.id))
      .returning();

    const promoted = current!.status === 'confirmed' ? await fillSeatsFromWaitlist(ctx, jobs, ev, now) : [];
    return { registration: cancelled!, alreadyCancelled: false, promoted };
  });
}
