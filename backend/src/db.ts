import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';

export function createDb(databaseUrl: string) {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  const db = drizzle(pool);
  return { pool, db };
}

export type Db = ReturnType<typeof createDb>['db'];
