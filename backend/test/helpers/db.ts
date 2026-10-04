import { sql } from 'drizzle-orm';
import { createDb } from '../../src/db.js';

export function createTestDb() {
  // Пул побольше, чтобы параллельные запросы в тестах на гонки реально шли в БД одновременно.
  const { pool, db } = createDb(process.env.DATABASE_URL!, { max: 30 });
  return {
    pool,
    db,
    reset: () => db.execute(sql`truncate table registrations, events restart identity cascade`),
  };
}
