import 'server-only';

import { sql } from 'drizzle-orm';

import { db } from '@/lib/db';

/**
 * Midnight Bangkok.
 *
 * `0 17 * * *` in UTC. Written here rather than only in `vercel.json` because
 * the two have to be read together to know what "daily" means — a reader who
 * finds `0 17` in the schedule has no way to guess 07:00 ICT without this.
 *
 * The day *key* the function stamps is still UTC, not Bangkok: that is the
 * clock `rate_limits.day`, `consume_credit` and the `day()` helper in the chat
 * route already use. On a strict 24-hour spacing the UTC key still yields
 * exactly one refill per Bangkok day — the label just trails the local date by
 * seven hours, which is invisible and never collides.
 */
export const DAILY_REFILL_CRON = '0 17 * * *';

/**
 * Runs the nightly top-up for everyone.
 *
 * Deliberately thin. The threshold arithmetic, the "once per day" guard and the
 * ledger row all live in `public.grant_daily_credits`, because they have to be
 * one atomic statement over a locked row set — reimplementing them here in
 * TypeScript is how a retried cron ends up granting twice. The same split
 * `sweep-usage.ts` uses, for the same reason.
 *
 * `day` is the UTC date to stamp. Defaults to today when a caller does not
 * care, which is the only mode the cron uses.
 */
export async function grantDailyCredits(day?: string): Promise<number> {
  const result = day
    ? await db.execute(sql`select public.grant_daily_credits(${day}::text) as granted`)
    : await db.execute(sql`select public.grant_daily_credits() as granted`);

  const row = (Array.isArray(result) ? result[0] : result) as unknown as { granted: number };
  return Number(row?.granted ?? 0);
}