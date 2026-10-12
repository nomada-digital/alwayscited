import { NextResponse } from "next/server";

import { constantTimeEqual } from "@/lib/constant-time";
import { dispatchDiyWork } from "@/lib/diy/core/dispatch";
import { freeRead } from "@/lib/diy/core/doors";
import { JOB_HANDLERS } from "@/lib/diy/wiring";
import { reapStalledFreePass, reapStalledGatedPass, STALL_AFTER_MS } from "@/lib/scan/stall";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { reapStalledTrackingRuns } from "@/lib/tracking/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Closes the passes the platform killed.
 *
 * The pipeline gives itself 270s against a 300s function ceiling and writes
 * `failed` itself on the way out, so every failure it can see is already
 * recorded. This is for the one it cannot: the function killed mid-flight,
 * which leaves the row at `running` with a step it will never leave and no
 * code anywhere that will ever touch it again.
 *
 * **The free pass** has a visitor in front of it, and that path no longer waits
 * on this job at all: the status poll and the server render both report a dead
 * pass as failed, and the confirm route closes the row itself when the visitor
 * takes the offer to run it again. That is what makes a daily schedule the
 * right one here rather than a compromise - nobody is sitting on a screen
 * waiting for this to fire. What it does is correct the row, so the admin page
 * stops showing a scan as running a week later.
 *
 * **The gated pass** is the one that actually needs a sweep. Its claim is
 * `.eq("gated_status", "queued")`, so a row left at `running` can never be
 * picked up by anything again, and unlike the free pass there is no second run
 * to fall back on. Nobody polls it either - the address that bought it is in
 * somebody's inbox, and they come back hours later to a report screen that
 * still says the engines are running. Marked failed, ScanFlow says so instead.
 *
 * What this does not do is recover the spend. A pass killed mid-flight was
 * billed by the vendor for every read it had made and never reached the write
 * that records it, so that money is spent and invisible to both ceilings. This
 * job cannot reconstruct it and does not guess at it. That gap is item 2 on the
 * OPEN list in blocked.md and is Danny's to decide.
 *
 * **And the second DIY night pass (13 Oct 2026, DIY P1; spec 10 section
 * 5.7).** A new cron entry needs `vercel.json`, which builders cannot stage,
 * so this 03:45 UTC job carries pass 2 of the DIY dispatch, as
 * `/api/cron/purge-responses` carries pass 1 at 03:30. `dispatchDiyWork`
 * re-queues what is due (idempotent) and posts two more signed workers only
 * while claimable due jobs remain - pass 1's have finished by now (270 s
 * budget), so no more than two run at once. Its own try, like the sweeps
 * above; its errors are logged and answered under `diy`.
 *
 * Vercel Cron calls this with Authorization: Bearer <CRON_SECRET>.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET is not set" }, { status: 503 });
  // Constant-time, to match the purge job next door and the admin proxy rather
  // than be the one secret comparison in this codebase that does not look like
  // the others - which is how the weaker one survives a reading.
  const offered = req.headers.get("authorization") ?? "";
  if (!constantTimeEqual(offered, `Bearer ${secret}`)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const db = supabaseAdmin();

  /**
   * The two sides are reported separately and neither is allowed to hide the
   * other's failure.
   *
   * Run in sequence with their own try, so a gated sweep that cannot write is
   * still attempted when the free sweep threw, and both messages reach the
   * response. Collapsed into one try, a fault on the first would have read as
   * "nothing to close" on the second - which on this job is the same silence it
   * exists to remove.
   */
  const errors: string[] = [];

  let free: string[] = [];
  try {
    free = (await reapStalledFreePass(db)).ids;
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  }

  let gated: string[] = [];
  try {
    gated = (await reapStalledGatedPass(db)).ids;
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  }

  // Daily tracking runs (T1, 29 Sep 2026) left `running` past 15 minutes.
  // Their own try, for the reason above.
  let tracking: string[] = [];
  try {
    tracking = (await reapStalledTrackingRuns()).ids;
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  }
  if (tracking.length) console.warn(`[track] stall sweep closed ${tracking.length} tracking run(s): ${tracking.join(", ")}`);

  // DIY pass 2 (13 Oct 2026). Its own try, for the reason above, and reported
  // under its own key: a DIY fault is logged and answered, and does not turn
  // this job's own answer into a 502 for sweeps that worked.
  let diy: Record<string, unknown>;
  try {
    diy = await dispatchDiyWork({ db, handlers: JOB_HANDLERS, pass: 2, free: freeRead });
    if ((diy.errors as string[]).length) console.warn(`[diy] night pass 2: ${(diy.errors as string[]).join("; ")}`);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.warn(`[diy] night pass 2 failed: ${error}`);
    diy = { error };
  }

  // Logged as well as returned. The response goes to Vercel's cron log, which
  // nobody reads on a quiet day; a scan being closed by this job means a
  // function was killed, and that is worth finding in the log next to whatever
  // else happened at the time.
  if (free.length || gated.length) {
    console.warn(
      `[scan] stall sweep closed ${free.length} free pass(es) and ${gated.length} gated pass(es): ` +
        [...free, ...gated].join(", "),
    );
  }

  return NextResponse.json(
    {
      ok: errors.length === 0,
      stall_after_ms: STALL_AFTER_MS,
      free_passes_closed: free.length,
      gated_passes_closed: gated.length,
      tracking_runs_closed: tracking.length,
      diy,
      // The ids, because the whole point of this job is that something was
      // wrong with these scans and the next question is always which ones.
      scans: free.length || gated.length ? { free, gated } : undefined,
      errors: errors.length ? errors : undefined,
    },
    { status: errors.length ? 502 : 200 },
  );
}
