import type pg from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../schema.js';

export type Tx = NodePgDatabase<typeof schema>;

/** Исполнитель SQL в рамках нашей транзакции: в этом формате его принимает pg-boss (`send(..., { db })`). */
export interface SqlExecutor {
  executeSql(text: string, values?: unknown[]): Promise<{ rows: any[] }>;
}

export interface TxContext {
  tx: Tx;
  exec: SqlExecutor;
}

/**
 * Транзакция на отдельном соединении. Drizzle и pg-boss работают через одно и то же
 * соединение, поэтому изменение данных и постановка задачи (письма) коммитятся
 * атомарно: либо оба, либо ничего.
 */
export async function withTx<T>(pool: pg.Pool, fn: (ctx: TxContext) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  let broken = false;
  try {
    await client.query('begin');
    const tx = drizzle(client, { schema });
    const exec: SqlExecutor = { executeSql: (text, values) => client.query(text, values as unknown[]) };
    const result = await fn({ tx, exec });
    await client.query('commit');
    return result;
  } catch (err) {
    await client.query('rollback').catch(() => { broken = true; });
    throw err;
  } finally {
    // Соединение, на котором не удался rollback, в пул не возвращаем.
    client.release(broken);
  }
}
