import type pg from 'pg';

/** Ждёт, пока в БД появится n запросов, заблокированных на чужой блокировке. */
export async function waitForLockWaiters(pool: pg.Pool, n: number, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { rows } = await pool.query<{ n: number }>(
      `select count(*)::int as n from pg_stat_activity
       where datname = current_database() and wait_event_type = 'Lock'
         and wait_event <> 'advisory'`, // advisory-блокировки берёт pg-boss, они не наши
    );
    if (rows[0]!.n >= n) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`timeout: expected ${n} lock waiter(s)`);
}
