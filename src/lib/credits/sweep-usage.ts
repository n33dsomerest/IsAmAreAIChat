import 'server-only';

import { and, eq, lt, sql } from 'drizzle-orm';

import { db } from '@/lib/db';
import { usageEvents } from '@/lib/db/schema';

/**
 * A usage event stays `pending` from the moment the credit is taken until the
 * turn settles. Normally the route settles it — on success, on abort, on error.
 *
 * But a turn can end without settling: the platform terminates the function at
 * its duration limit and nothing after that point runs. The credit is then held
 * forever and the user is charged for an answer they never got. Production had
 * four such rows, the oldest a day old.
 *
 * The refund itself is `complete_usage`, already written and already tested: it
 * moves the balance, writes the ledger entry, and gives back the daily counter
 * together. Reusing it is the point — hand-writing those three updates in
 * TypeScript is how they drift apart and make the books stop reconciling.
 */
export const EXPIRY_MINUTES = 15;

const BATCH = 50;

/** In-memory timestamp of last successful sweep (process lifetime). */
let lastSweepAt = 0;
const SWEEP_INTERVAL_MS = 15 * 60_000; // 15 minutes

export async function sweepExpiredUsage(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - EXPIRY_MINUTES * 60_000);

  const stale = await db
    .select({ id: usageEvents.id })
    .from(usageEvents)
    .where(and(eq(usageEvents.status, 'pending'), lt(usageEvents.createdAt, cutoff)))
    .limit(BATCH);

  let swept = 0;
  for (const row of stale) {
    // complete_usage re-reads the row under a row lock and returns immediately
    // unless it is still pending, so a turn that settles in the meantime is
    // never double-refunded and a concurrent sweep cannot double-count.
    const result = await db.execute(sql`
      select public.complete_usage(
        ${row.id}::uuid, 0, 0, 0, 0, 0::numeric, 'expired'::text
      ) as done
    `);
    if (Array.isArray(result) && result.length) swept += 1;
  }

  if (swept > 0) {
    lastSweepAt = Date.now();
  }

  return swept;
}

/**
 * Lightweight check: only runs sweep if >15min since last sweep.
 * Called on every chat request — cheap indexed range scan.
 */
export async function sweepIfDue(): Promise<void> {
  const now = Date.now();
  if (now - lastSweepAt < SWEEP_INTERVAL_MS) {
    return; // Skip: sweep ran recently
  }
  try {
    await sweepExpiredUsage();
  } catch {
    // A failed sweep must never fail a chat. The next request tries again.
  }
}

/**
 * Full sweep for Vercel Cron (runs every 5 min).
 * Ignores the in-memory interval — always attempts to sweep.
 */
export async function sweepForCron(): Promise<number> {
  return sweepExpiredUsage();
}