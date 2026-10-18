import { NextResponse } from "next/server";

import { constantTimeEqual } from "@/lib/constant-time";
import { dispatchDiyWork } from "@/lib/diy/core/dispatch";
import { freeRead } from "@/lib/diy/core/doors";
import { JOB_HANDLERS } from "@/lib/diy/wiring";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { retentionPass as runRetention } from "@/lib/tracking/retention-purge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The nightly purge, which no longer purges anything - and, since 13 Oct
 * 2026, the first DIY night pass.
 *
 * **Why the DIY dispatch is here (DIY P1; spec 10 section 5.7).** It needs a
 * nightly trigger before the 05:00 UTC tracking burst, and a new cron entry
 * lives in `vercel.json`, which builders cannot stage. This route already runs
 * at 03:30 UTC behind CRON_SECRET and does nothing, so it carries pass 1:
 * `dispatchDiyWork` queues each client's due DIY jobs, makes the two free
 * vendor reads once a UTC day, and posts two signed workers to
 * `/api/diy/run`. Every paid read those workers make is capped by the DIY
 * ledger and refused while `diy_enabled` is false. It runs in its own try, so
 * neither half can hide the other's failure, and it writes nothing here: the
 * retention answer below is unchanged. `/api/cron/reap-stalled-scans` carries
 * pass 2 at 03:45. A dedicated `/api/cron/diy` is a later tidy-up for whoever
 * can edit `vercel.json`.
 *
 * **Danny's decision, 24 September 2026: transcripts are kept indefinitely.**
 * What each engine said is the evidence behind every figure a reading
 * publishes, and a report whose numbers can no longer be read back to the
 * words that produced them is a score nobody can audit - which is the thing
 * `/about` says this product exists not to be.
 *
 * This route used to clear `scan_answers.response_text` for every unclaimed
 * scan past `response_retention_days`. It does not clear anything now, and the
 * body it returns says so rather than reporting a zero that would read like a
 * quiet night.
 *
 * ## Why the route is still here
 *
 * Because the thing that calls it is not in this directory. The cron entry
 * lives in the project's deploy configuration, outside `src`, and a registered
 * cron whose route has been deleted is a nightly 404 in the logs and an alert
 * nobody can action. The route stays, answers, and states the retention
 * decision; removing the schedule is the separate change, and it belongs with
 * whoever can edit that file.
 *
 * ## What was deliberately not done
 *
 * The `response_retention_days` row in `app_settings` is untouched. It is
 * data, deleting live rows is not ours, and nothing reads it now - the same
 * standing the `require_email_verification` row got when the email gate went.
 * `/legal` carries the retention sentence and `reading-retention.test.mts`
 * holds the two in agreement, so the policy and the behaviour cannot drift
 * apart without something failing.
 *
 * Vercel Cron calls this with Authorization: Bearer <CRON_SECRET>.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET is not set" }, { status: 503 });

  /**
   * Still authenticated, even though it now does nothing.
   *
   * An endpoint that answers every caller with the shape of an internal job is
   * an endpoint somebody will point something at. Constant-time, because a
   * comparison that returns early leaks the prefix it matched.
   */
  // Compared against the whole `Bearer <secret>` header, which is what Vercel
  // sends - the same shape as the reaper next door. Splitting the prefix off
  // and comparing the bare secret is the quiet failure `cron-schedule.test.mts`
  // exists for: the schedule still fires and the work silently never runs.
  const offered = req.headers.get("authorization") ?? "";
  if (!constantTimeEqual(offered, `Bearer ${secret}`)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // DIY pass 1, in its own try: a dispatch that throws still answers the retention decision below.
  let diy: Record<string, unknown>;
  try {
    diy = await dispatchDiyWork({ db: supabaseAdmin(), handlers: JOB_HANDLERS, pass: 1, free: freeRead });
    if ((diy.errors as string[]).length) console.warn(`[diy] night pass 1: ${(diy.errors as string[]).join("; ")}`);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.warn(`[diy] night pass 1 failed: ${error}`);
    diy = { error };
  }

  // The retention pass (18 Oct 2026, lib/tracking/retention-purge.ts), in its own try. A dry run until
  // app_settings.retention_purge_enabled is switched on: it reports which ended clients are past their 90 days.
  let retentionPass: Record<string, unknown>;
  try {
    retentionPass = await runRetention(supabaseAdmin());
    if ((retentionPass.errors as string[]).length) console.warn(`[retention] ${(retentionPass.errors as string[]).join("; ")}`);
    if ((retentionPass.due as unknown[]).length) console.info(`[retention] ${retentionPass.enabled ? "purged" : "due (dry run, switch off)"}: ${JSON.stringify(retentionPass.enabled ? retentionPass.purged : retentionPass.due)}`);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.warn(`[retention] pass failed: ${error}`);
    retentionPass = { error };
  }

  return NextResponse.json({
    ok: true,
    diy,
    retention_pass: retentionPass,
    purged: false,
    answers_cleared: 0,
    retention: "indefinite",
    note:
      "Transcripts are kept indefinitely (Danny, 24 September 2026). This job clears nothing. " +
      "The zero above is the decision, not an empty night.",
  });
}
