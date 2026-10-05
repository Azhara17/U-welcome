import { sql } from 'drizzle-orm';
import {
  bigserial,
  jsonb,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const events = pgTable(
  'events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    location: text('location').notNull().default(''),
    // Метка над заголовком, например «Митап · Офлайн».
    category: text('category').notNull().default(''),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    capacity: integer('capacity').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check('events_capacity_positive', sql`${t.capacity} > 0`)],
);

export const registrationStatus = pgEnum('registration_status', ['confirmed', 'waitlisted', 'cancelled']);

export const registrations = pgTable(
  'registrations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventId: uuid('event_id').notNull().references(() => events.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    status: registrationStatus('status').notNull(),
    // Порядок в листе ожидания: монотонный, в отличие от created_at не бывает равных значений.
    seq: bigserial('seq', { mode: 'number' }).notNull(),
    ticketCode: text('ticket_code'),
    manageToken: text('manage_token').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    promotedAt: timestamp('promoted_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    checkedInAt: timestamp('checked_in_at', { withTimezone: true }),
    // Для какой даты события напоминание уже поставлено в очередь. Перенос события
    // меняет дату, поэтому к новой дате придёт новое напоминание.
    reminderEnqueuedFor: timestamp('reminder_enqueued_for', { withTimezone: true }),
    // Когда билет последний раз отправлялся повторно (по повторной регистрации): ограничение частоты.
    lastResentAt: timestamp('last_resent_at', { withTimezone: true }),
  },
  (t) => [
    // Одна активная регистрация на email в рамках события: страховка на уровне БД.
    uniqueIndex('registrations_event_email_active')
      .on(t.eventId, t.email)
      .where(sql`${t.status} <> 'cancelled'`),
    uniqueIndex('registrations_ticket_code').on(t.ticketCode),
    uniqueIndex('registrations_manage_token').on(t.manageToken),
    index('registrations_event_status_seq').on(t.eventId, t.status, t.seq),
    check('registrations_ticket_only_when_confirmed', sql`(${t.status} = 'confirmed') = (${t.ticketCode} is not null) or ${t.status} = 'cancelled'`),
  ],
);

export type Event = typeof events.$inferSelect;
export type Registration = typeof registrations.$inferSelect;

// Журнал отправленных писем: уникальный dedup_key защищает от повторной отправки,
// даже если задача в очереди выполнится дважды (pg-boss гарантирует at-least-once).
export const emailLog = pgTable('email_log', {
  dedupKey: text('dedup_key').primaryKey(),
  kind: text('kind').notNull(),
  registrationId: uuid('registration_id').notNull().references(() => registrations.id, { onDelete: 'cascade' }),
  recipient: text('recipient').notNull(),
  subject: text('subject').notNull(),
  sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
});

export type EmailLogEntry = typeof emailLog.$inferSelect;

// Лента событий для организатора и «последние проверки» на чекине. Пишется в той же
// транзакции, что и само действие, поэтому общая для всех вкладок и переживает перезапуск.
export const activityType = pgEnum('activity_type', [
  'registered', 'cancelled', 'checkin', 'checkin_repeat', 'checkin_not_found', 'checkin_cancelled',
  'reminders', 'rescheduled',
]);

export const activity = pgTable(
  'activity',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    eventId: uuid('event_id').notNull().references(() => events.id, { onDelete: 'cascade' }),
    type: activityType('type').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('activity_event_id').on(t.eventId, t.id)],
);

export type Activity = typeof activity.$inferSelect;
export type ActivityType = (typeof activityType.enumValues)[number];
