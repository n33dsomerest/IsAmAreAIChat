import { NextResponse } from "next/server";

import { sweepForCron } from "@/lib/credits/sweep-usage";

// Vercel Cron endpoint - runs every 5 minutes
// Configure in vercel.json with schedule "*/5 * * * *"
// Secured by CRON_SECRET to prevent external invocation
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