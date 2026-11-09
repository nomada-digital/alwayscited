import { NextResponse } from "next/server";

import { constantTimeEqual } from "@/lib/constant-time";
import { collectClassifyBatches } from "@/lib/diy/opportunities/classify-batches";
import { collectBrandBatches } from "@/lib/tracking/brand-batches";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Collects the daily tracking's brand-extraction batches (8 Nov 2026, lib/tracking/brand-batches.ts), every ten
 * minutes. A batch that has ended is credited; one that errored or ran past the hour is extracted directly, so this is
 * the route that can still spend - a bounded fallback for requests the run already sent. Vercel Cron calls it with
 * Authorization: Bearer <CRON_SECRET>, as /api/cron/track.
 *
 * 9 Nov 2026: it collects the DIY classify batches too (lib/diy/opportunities/classify-batches.ts), alongside, so the
 * two budgets (240 s and 120 s) run at once inside the 300.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET is not set" }, { status: 503 });
  if (!constantTimeEqual(req.headers.get("authorization") ?? "", `Bearer ${secret}`)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const [report, diy] = await Promise.all([
    collectBrandBatches(),
    collectClassifyBatches().catch((err) => ({ checked: 0, collected: 0, fellBack: 0, waiting: 0, errors: [err instanceof Error ? err.message : String(err)] })),
  ]);
  if (report.checked) console.log(`[track] brand batches: ${report.checked} checked, ${report.collected} collected, ${report.fellBack} by fallback, ${report.waiting} waiting${report.errors.length ? `; ${report.errors.join("; ")}` : ""}`);
  if (diy.checked || diy.errors.length) console.log(`[diy] classify batches: ${diy.checked} checked, ${diy.collected} collected, ${diy.fellBack} by fallback, ${diy.waiting} waiting${diy.errors.length ? `; ${diy.errors.join("; ")}` : ""}`);
  return NextResponse.json({ ok: !report.errors.length && !diy.errors.length, ...report, diy });
}
