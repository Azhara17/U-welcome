import { afterAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createDb } from '../src/db.js';

describe('GET /health', () => {
  const { pool, db } = createDb(loadConfig().DATABASE_URL);
  afterAll(() => pool.end());

  it('returns ok when the real database is reachable', async () => {
    const app = buildApp({ pingDb: async () => { await db.execute(sql`select 1`); } });
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', db: 'ok' });
  });

  it('returns 503 when the database is down', async () => {
    const app = buildApp({ pingDb: async () => { throw new Error('connection refused'); } });
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: 'degraded', db: 'down' });
  });
});
