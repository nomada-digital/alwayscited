import { NextResponse } from "next/server";

import { constantTimeEqual } from "@/lib/constant-time";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { retryPartialRuns } from "@/lib/tracking/retry-partial";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * One more try at today's partial or failed tracking runs (27 Nov 2026). The search engine's internal errors (40101) come and go within
 * hours, so the 05:00 pass leaves some keywords unread that a second pass reads. Scheduled `30 10 * * *` UTC. Asks the re-run the way
 * "Run now" does (the tracking switch and cost cap honoured), once per run: a run already re-run today, by anyone, is left alone.
 *
 * Vercel Cron calls this with Authorization: Bearer <CRON_SECRET>.
 */
export async function GET(req: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET is not set" }, { status: 503 });
  const offered = req.headers.get("authorization") ?? "";
  if (!constantTimeEqual(offered, `Bearer ${secret}`)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json({ ok: true, ...(await retryPartialRuns(supabaseAdmin())) });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
