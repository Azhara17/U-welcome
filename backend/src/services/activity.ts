import { and, desc, eq, inArray } from 'drizzle-orm';
import type { Db } from '../db.js';
import type { Tx } from '../lib/tx.js';
import { notifyEventChanged } from '../realtime/bus.js';
import { activity, type Activity, type ActivityType } from '../schema.js';

export async function logActivity(tx: Tx, eventId: string, type: ActivityType, payload: Record<string, unknown> = {}, now = new Date()) {
  await tx.insert(activity).values({ eventId, type, payload, createdAt: now });
  // Любое изменение, попавшее в ленту, — повод обновить live-экраны.
  await notifyEventChanged(tx, eventId);
}

export async function listActivity(db: Db, eventId: string, opts: { types?: ActivityType[]; limit?: number } = {}): Promise<Activity[]> {
  return db
    .select()
    .from(activity)
    .where(and(eq(activity.eventId, eventId), opts.types?.length ? inArray(activity.type, opts.types) : undefined))
    .orderBy(desc(activity.id))
    .limit(opts.limit ?? 50);
}
