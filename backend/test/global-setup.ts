import pg from 'pg';
import { createDb, runMigrations } from '../src/db.js';

// Создаёт отдельную БД events_test (если её нет) и накатывает миграции.
export default async function setup() {
  const testUrl = process.env.DATABASE_URL!;
  const dbName = new URL(testUrl).pathname.slice(1);

  const admin = new pg.Client({ connectionString: process.env.ADMIN_DATABASE_URL });
  await admin.connect();
  const exists = await admin.query('select 1 from pg_database where datname = $1', [dbName]);
  if (exists.rowCount === 0) await admin.query(`create database "${dbName}"`);
  await admin.end();

  const { pool, db } = createDb(testUrl);
  await runMigrations(db);
  await pool.end();
}
