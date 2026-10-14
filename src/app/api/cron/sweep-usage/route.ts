import { NextResponse } from "next/server";

import { sweepForCron } from "@/lib/credits/sweep-usage";

// Vercel Cron endpoint - see the schedule in vercel.json.
// Secured by CRON_SECRET to prevent external invocation.
//
// Scheduled daily, not every few minutes, because that is the finest this
// project's plan allows: Hobby rejects any cron expression that runs more than
// once per day, and the deployment fails outright rather than degrading. The
// in-memory sweep that runs on every chat request is what actually keeps this
// prompt — this route is the backstop for a user who goes idle between two
// turns. Raising the plan to Pro is what buys a tighter interval.
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const swept = await sweepForCron();
    return NextResponse.json({ swept, timestamp: new Date().toISOString() });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    return NextResponse.json({ error: "sweep_failed", message }, { status: 500 });
  }
}