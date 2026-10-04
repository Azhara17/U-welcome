import Fastify from 'fastify';
import { sql } from 'drizzle-orm';
import { ZodError } from 'zod';
import type { Db } from './db.js';
import { eventRoutes } from './routes/events.js';
import { healthRoutes, type PingDb } from './routes/health.js';
import { registrationRoutes } from './routes/registrations.js';
import { DomainError } from './services/registrations.js';

export interface AppDeps {
  db: Db;
  pingDb?: PingDb;
}

export function buildApp(deps: AppDeps, opts: { logger?: boolean } = {}) {
  const app = Fastify({ logger: opts.logger ?? false });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof DomainError) {
      return reply.code(err.httpStatus).send({ error: err.code });
    }
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: 'validation_error', issues: err.issues });
    }
    const statusCode = (err as { statusCode?: number }).statusCode;
    if (statusCode && statusCode < 500) {
      // Ошибки Fastify уровня запроса: битый JSON, неверный content-type и т.п.
      return reply.code(statusCode).send({ error: (err as Error).message });
    }
    reply.log.error({ err }, 'unhandled error');
    return reply.code(500).send({ error: 'internal_error' });
  });

  const pingDb = deps.pingDb ?? (async () => { await deps.db.execute(sql`select 1`); });
  app.register(healthRoutes, { pingDb });
  app.register(eventRoutes, { db: deps.db });
  app.register(registrationRoutes, { db: deps.db });
  return app;
}
