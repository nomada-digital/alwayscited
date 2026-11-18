import { NextResponse } from "next/server";

import { constantTimeEqual } from "@/lib/constant-time";
import { collectClassifyBatches } from "@/lib/diy/opportunities/classify-batches";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { collectBrandBatches } from "@/lib/tracking/brand-batches";
import { readDueVerdicts } from "@/lib/tracking/verdicts";

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
 *
 * 18 Nov 2026: and the comparison verdicts (lib/tracking/verdicts.ts), the third alongside, at most 120 answers a run
 * inside its own 120 s, so a backlog clears over a few runs and a day's new answers are read within ten minutes.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET is not set" }, { status: 503 });
  if (!constantTimeEqual(req.headers.get("authorization") ?? "", `Bearer ${secret}`)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const [report, diy, verdicts] = await Promise.all([
    collectBrandBatches(),
    collectClassifyBatches().catch((err) => ({ checked: 0, collected: 0, fellBack: 0, waiting: 0, errors: [err instanceof Error ? err.message : String(err)] })),
    readDueVerdicts(supabaseAdmin()).catch((err) => ({ read: 0, calls: 0, errors: [err instanceof Error ? err.message : String(err)] })),
  ]);
  if (report.checked) console.log(`[track] brand batches: ${report.checked} checked, ${report.collected} collected, ${report.fellBack} by fallback, ${report.waiting} waiting${report.errors.length ? `; ${report.errors.join("; ")}` : ""}`);
  if (diy.checked || diy.errors.length) console.log(`[diy] classify batches: ${diy.checked} checked, ${diy.collected} collected, ${diy.fellBack} by fallback, ${diy.waiting} waiting${diy.errors.length ? `; ${diy.errors.join("; ")}` : ""}`);
  if (verdicts.read || verdicts.errors.length) console.log(`[track] verdicts: ${verdicts.read} read in ${verdicts.calls} calls${verdicts.errors.length ? `; ${verdicts.errors.slice(0, 3).join("; ")}` : ""}`);
  return NextResponse.json({ ok: !report.errors.length && !diy.errors.length, ...report, diy, verdicts });
}
