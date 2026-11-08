import { NextResponse } from "next/server";

import { constantTimeEqual } from "@/lib/constant-time";
import { collectBrandBatches } from "@/lib/tracking/brand-batches";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Collects the daily tracking's brand-extraction batches (8 Nov 2026, lib/tracking/brand-batches.ts), every ten
 * minutes. A batch that has ended is credited; one that errored or ran past the hour is extracted directly, so this is
 * the route that can still spend - a bounded fallback for requests the run already sent. Vercel Cron calls it with
 * Authorization: Bearer <CRON_SECRET>, as /api/cron/track.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET is not set" }, { status: 503 });
  if (!constantTimeEqual(req.headers.get("authorization") ?? "", `Bearer ${secret}`)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const report = await collectBrandBatches();
  if (report.checked) console.log(`[track] brand batches: ${report.checked} checked, ${report.collected} collected, ${report.fellBack} by fallback, ${report.waiting} waiting${report.errors.length ? `; ${report.errors.join("; ")}` : ""}`);
  return NextResponse.json({ ok: !report.errors.length, ...report });
}
