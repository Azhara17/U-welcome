import Fastify from 'fastify';
import { healthRoutes, type PingDb } from './routes/health.js';

export interface AppDeps {
  pingDb: PingDb;
}

export function buildApp(deps: AppDeps, opts: { logger?: boolean } = {}) {
  const app = Fastify({ logger: opts.logger ?? false });
  app.register(healthRoutes, { pingDb: deps.pingDb });
  return app;
}
