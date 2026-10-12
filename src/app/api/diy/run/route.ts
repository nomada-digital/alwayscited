import { NextResponse, after } from "next/server";

import { DIY_SIGNATURE_HEADER } from "@/lib/diy/core/dispatch";
import { runDiyWorker } from "@/lib/diy/core/worker";
import { JOB_HANDLERS } from "@/lib/diy/wiring";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { verifyRun } from "@/lib/tracking/decide";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * One DIY night worker (13 Oct 2026, DIY P1; spec 10 sections 3.6 and 5.7).
 * Posted by the DIY dispatcher - two a pass, from the 03:30 and 03:45 UTC
 * crons - with an HMAC-SHA256 of the body keyed on CRON_SECRET, verified
 * against the raw text before it is parsed, as `/api/track/run` verifies a
 * tracking run. Nothing else can start one.
 *
 * Answered at once and run after the response, under this route's 300 s:
 * the worker budgets 270 s, claims each job by compare-and-swap, and closes
 * its own `diy_jobs` rows. Every paid read inside goes through the DIY
 * ledger: `diy_enabled`, the global daily caps, each client's per-door counts
 * and month budgets, reserved before the read.
 */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET is not set" }, { status: 503 });

  const body = await req.text();
  if (!verifyRun(body, req.headers.get(DIY_SIGNATURE_HEADER), secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let worker: unknown;
  try {
    worker = (JSON.parse(body) as { worker?: unknown }).worker;
  } catch {
    return NextResponse.json({ error: "bad body" }, { status: 400 });
  }
  if (typeof worker !== "number" || !Number.isInteger(worker) || worker < 1 || worker > 9) {
    return NextResponse.json({ error: "bad worker" }, { status: 400 });
  }

  after(async () => {
    try {
      const out = await runDiyWorker({ db: supabaseAdmin(), handlers: JOB_HANDLERS });
      console.log(
        `[diy] worker ${worker}: ${out.claimed} claimed (${out.outcomes.ok} ok, ${out.outcomes.skipped} skipped, ` +
          `${out.outcomes.deferred} deferred, ${out.outcomes.failed} failed), stopped: ${out.stopped}` +
          (out.errors.length ? `; ${out.errors.join("; ")}` : ""),
      );
    } catch (err) {
      console.warn(`[diy] worker ${worker} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  });
  return NextResponse.json({ ok: true, worker }, { status: 202 });
}
