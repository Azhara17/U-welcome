import { sql } from 'drizzle-orm';
import type { Db } from './db.js';
import { events } from './schema.js';
import { createEvent } from './services/events.js';

/** Демо-событие при первом запуске (пустая база), чтобы сразу было что открыть. */
export async function seedDemoEvent(db: Db, now = new Date()) {
  const [{ n }] = (await db.select({ n: sql<number>`count(*)::int` }).from(events)) as [{ n: number }];
  if (n > 0) return null;

  // Через 10 дней в 19:00 по Бишкеку (UTC+6, без перехода на летнее время).
  const startsAt = new Date(now.getTime() + 10 * 86_400_000);
  startsAt.setUTCHours(13, 0, 0, 0);

  return createEvent(db, {
    title: 'Вечер фронтенд-разработчиков',
    category: 'Митап · Офлайн',
    location: '[Адрес площадки], Бишкек',
    description: 'Доклады о React и производительности, разбор реальных кейсов и нетворкинг. Для фронтенд-разработчиков любого уровня.',
    startsAt,
    capacity: 50,
  });
}
