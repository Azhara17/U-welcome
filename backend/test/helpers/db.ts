import { sql } from 'drizzle-orm';
import { createDb } from '../../src/db.js';

export function createTestDb() {
  const { pool, db } = createDb(process.env.DATABASE_URL!);
  return {
    pool,
    db,
    reset: () => db.execute(sql`truncate table registrations, events restart identity cascade`),
  };
}
