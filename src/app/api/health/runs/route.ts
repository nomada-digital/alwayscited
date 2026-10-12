import { NextResponse } from "next/server";

import { supabaseAdmin, supabaseConfigured } from "@/lib/supabase/admin";
import { trackingDay } from "@/lib/tracking/decide";
import { healthAnswer, readRunHealth } from "@/lib/tracking/run-health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Whether today's alwaystracked runs were all read, for an uptime monitor
 * (9 Oct 2026, audit reliability-6, spec OP-1).
 *
 * 200 until 07:00 UTC whatever the runs are doing, then 503 for the rest of
 * the London day if any client that should have been read has no complete or
 * partial run - failed, stalled, never claimed, not dispatched, or no run at
 * all (run-health.ts healthAnswer). A monitor that knows only status codes
 * alerts on the 503; the summary mail to our own inbox says which client and
 * why, and /admin/tracking can re-run it. 503 too when the runs cannot be
 * read, which is the check itself being down.
 *
 * Read-only: it sends nothing and writes nothing, so a crawler or a stranger
 * polling it costs a few database reads and no vendor call (spend-gates,
 * paid-get). No secret, no client and no count in the answer: the day, the
 * deadline, whether it was met, and the names of the states unread clients
 * are in (run-health.ts healthAnswer; counts said how many clients there
 * are, so they are on /admin/tracking only).
 */
export async function GET() {
  const headers = new Headers();
  headers.set("cache-control", "no-store");
  headers.set("x-robots-tag", "noindex, nofollow");
  const now = Date.now();
  const day = trackingDay(new Date(now));

  if (!supabaseConfigured()) {
    return NextResponse.json({ day, ok: false, error: "the database is not configured" }, { status: 503, headers });
  }
  // One retry, 12 Oct 2026: a single failed read on a cold function answered
  // 503 "the runs could not be read" once and 200 on the next three polls, and
  // a monitor pages on that one 503. Two failures in a row is the check down.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const out = healthAnswer(await readRunHealth(supabaseAdmin(), day, now), now);
      return NextResponse.json(out.body, { status: out.status, headers });
    } catch (err) {
      console.warn(`[track] run health could not be read (attempt ${attempt + 1}): ${err instanceof Error ? err.message : String(err)}`);
      if (attempt === 0) await new Promise((r) => setTimeout(r, 500));
    }
  }
  return NextResponse.json({ day, ok: false, error: "the runs could not be read" }, { status: 503, headers });
}
