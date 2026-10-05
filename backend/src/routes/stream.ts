import type { FastifyInstance } from 'fastify';
import type { ServerResponse } from 'node:http';
import type { Db } from '../db.js';
import type { EventBus } from '../realtime/bus.js';
import { getEvent, getEventStats } from '../services/events.js';
import { DomainError } from '../services/registrations.js';
import { idParams } from './events.js';

const HEARTBEAT_MS = 15_000;
const COALESCE_MS = 50;

/**
 * SSE: GET /events/:id/stream. Сразу шлёт снимок (событие + счётчики), дальше новый снимок
 * после каждого изменения. EventSource в браузере сам переподключается после рестарта
 * сервера и снова получает свежий снимок первым сообщением.
 */
export async function streamRoutes(app: FastifyInstance, opts: { db: Db; bus: EventBus }) {
  const { db, bus } = opts;
  const open = new Set<ServerResponse>();

  app.addHook('onClose', async () => {
    for (const res of open) res.end();
  });

  app.get('/events/:id/stream', async (req, reply) => {
    const { id } = idParams.parse(req.params);
    if (!(await getEvent(db, id))) throw new DomainError('event_not_found', 404);

    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    open.add(res);

    let pending: NodeJS.Timeout | null = null;
    let closed = false;
    const sendSnapshot = async () => {
      pending = null;
      try {
        const ev = await getEvent(db, id);
        if (!ev || closed) return;
        res.write(`event: snapshot\ndata: ${JSON.stringify({ ...ev, stats: await getEventStats(db, id) })}\n\n`);
      } catch (err) {
        req.log.warn({ err }, 'sse: snapshot failed');
      }
    };
    // Несколько изменений подряд (например, отказ + продвижение) склеиваем в один снимок.
    const schedule = () => { if (!pending && !closed) pending = setTimeout(sendSnapshot, COALESCE_MS); };

    res.write('retry: 2000\n\n');
    const unsubscribe = bus.subscribe(id, schedule);
    await sendSnapshot();
    const heartbeat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);

    res.on('close', () => {
      closed = true;
      unsubscribe();
      clearInterval(heartbeat);
      if (pending) clearTimeout(pending);
      open.delete(res);
    });
  });
}
