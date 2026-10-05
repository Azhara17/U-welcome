import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { createTestContext } from './helpers/context.js';

const ctx = await createTestContext();

describe('GET /health', () => {
  const { db, jobs, bus } = ctx;
  afterAll(ctx.close);

  it('returns ok when the real database is reachable', async () => {
    const app = buildApp({ db, jobs, bus });
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', db: 'ok' });
  });

  it('returns 503 when the database is down', async () => {
    const app = buildApp({ db, jobs, bus, pingDb: async () => { throw new Error('connection refused'); } });
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: 'degraded', db: 'down' });
  });
});
