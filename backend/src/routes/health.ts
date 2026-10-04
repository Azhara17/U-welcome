import type { FastifyInstance } from 'fastify';

export type PingDb = () => Promise<void>;

export async function healthRoutes(app: FastifyInstance, opts: { pingDb: PingDb }) {
  app.get('/health', async (_req, reply) => {
    try {
      await opts.pingDb();
      return { status: 'ok', db: 'ok' };
    } catch (err) {
      app.log.warn({ err }, 'health: db ping failed');
      return reply.code(503).send({ status: 'degraded', db: 'down' });
    }
  });
}
