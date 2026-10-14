import { NextResponse } from 'next/server';

import { grantDailyCredits } from '@/lib/credits/daily-refill';

// Vercel Cron endpoint - runs at 17:00 UTC, which is midnight in Bangkok.
// Configure in vercel.json with schedule "0 17 * * *"
// Secured by CRON_SECRET to prevent external invocation
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    const granted = await grantDailyCredits();
    return NextResponse.json({ granted, timestamp: new Date().toISOString() });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown';
    return NextResponse.json({ error: 'refill_failed', message }, { status: 500 });
  }
}