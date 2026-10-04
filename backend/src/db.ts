import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import * as schema from './schema.js';

// Папка drizzle/ лежит рядом с src/ и dist/, поэтому путь одинаков в dev и в сборке.
const migrationsFolder = fileURLToPath(new URL('../drizzle', import.meta.url));

export function createDb(databaseUrl: string, poolOptions: pg.PoolConfig = {}) {
  const pool = new pg.Pool({ connectionString: databaseUrl, ...poolOptions });
  const db = drizzle(pool, { schema });
  return { pool, db };
}

export type Db = ReturnType<typeof createDb>['db'];

export async function runMigrations(db: Db) {
  await migrate(db, { migrationsFolder });
}
