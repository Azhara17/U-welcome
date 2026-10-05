import { EventEmitter } from 'node:events';
import pg from 'pg';
import { sql } from 'drizzle-orm';
import type { Tx } from '../lib/tx.js';

export const CHANNEL = 'event_changed';

/**
 * Сообщает подписчикам, что у события что-то изменилось. pg_notify внутри транзакции
 * доставляется только после COMMIT (и не доставляется при ROLLBACK), поэтому клиент
 * никогда не увидит незакоммиченное состояние.
 */
export async function notifyEventChanged(tx: Tx, eventId: string) {
  await tx.execute(sql`select pg_notify(${CHANNEL}, ${eventId})`);
}

export type Listener = (reason: 'changed' | 'resync') => void;

/**
 * Одно выделенное соединение LISTEN на процесс. Уведомления идут через Postgres,
 * поэтому обновления видны всем вкладкам и всем экземплярам backend.
 * При обрыве соединения переподключается и шлёт всем подписчикам 'resync':
 * за время обрыва уведомления могли потеряться, клиенты перечитают снимок.
 */
export class EventBus {
  private emitter = new EventEmitter().setMaxListeners(0);
  private client: pg.Client | null = null;
  private closed = false;
  private retryMs = 250;

  constructor(private readonly connectionString: string, private readonly onError: (err: Error) => void = () => {}) {}

  async start() {
    await this.connect();
  }

  private async connect(): Promise<void> {
    const client = new pg.Client({ connectionString: this.connectionString });
    client.on('notification', (msg) => {
      if (msg.channel === CHANNEL && msg.payload) this.emitter.emit(msg.payload, 'changed');
    });
    client.on('error', (err) => {
      this.onError(err);
      void this.reconnect(client);
    });
    client.on('end', () => void this.reconnect(client));
    await client.connect();
    await client.query(`listen ${CHANNEL}`);
    this.client = client;
    this.retryMs = 250;
  }

  private async reconnect(dead: pg.Client) {
    if (this.closed || this.client !== dead) return;
    this.client = null;
    dead.removeAllListeners();
    dead.end().catch(() => {});
    while (!this.closed) {
      await new Promise((r) => setTimeout(r, this.retryMs));
      try {
        await this.connect();
        for (const name of this.emitter.eventNames()) this.emitter.emit(name, 'resync');
        return;
      } catch (err) {
        this.onError(err as Error);
        this.retryMs = Math.min(this.retryMs * 2, 5000);
      }
    }
  }

  subscribe(eventId: string, listener: Listener): () => void {
    this.emitter.on(eventId, listener);
    return () => this.emitter.off(eventId, listener);
  }

  /** Для тестов: pid соединения LISTEN. */
  get backendPid(): number | undefined {
    return (this.client as unknown as { processID?: number } | null)?.processID;
  }

  async close() {
    this.closed = true;
    const c = this.client;
    this.client = null;
    if (c) {
      c.removeAllListeners();
      await c.end().catch(() => {});
    }
  }
}
