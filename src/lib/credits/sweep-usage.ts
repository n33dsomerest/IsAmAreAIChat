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

  return swept;
}

/**
 * Runs on the way into a chat turn rather than only on a schedule.
 *
 * Vercel's cron on Hobby fires once a day, which is far too coarse for a
 * fifteen minute window, and a sweep nobody triggers is a sweep that quietly
 * stops happening. Doing it here means the cleanup rides along with traffic the
 * app already receives, and the cost is one indexed range scan per turn.
 */
export async function sweepIfDue(): Promise<void> {
  try {
    await sweepExpiredUsage();
  } catch {
    // A failed sweep must never fail a chat. The next request tries again.
  }
}