import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

import { selectAll } from "../supabase/page.ts";
import { rerunMarker } from "./rerun.ts";
import { dispatchTrackingRun, requestRerun } from "./runner";
import { trackingDay } from "./decide.ts";

/**
 * The mid-morning pass over today's runs that finished partial or failed (27 Nov 2026, Danny: "60% of York reads failing with 40101"; the
 * search engine's errors come and go within hours). One re-run per run, asked the way "Run now" asks it (requestRerun: today's run only,
 * the tracking switch and the day's cost cap honoured), so it reads again only what has no row yet and a failed re-read keeps what the run
 * holds. A run that has been re-run already today, by this pass or by a person, is left alone: this is one more try, not a loop.
 */
export type RetryOutcome = { day: string; retried: string[]; skipped: { run: string; why: string }[] };

export async function retryPartialRuns(db: SupabaseClient, now: Date = new Date()): Promise<RetryOutcome> {
  const day = trackingDay(now);
  const out: RetryOutcome = { day, retried: [], skipped: [] };
  type Row = { id: string; run_date: string; status: string; error: string | null; started_at: string | null; step_ms: unknown };
  const runs = await selectAll<Row>((from, to) =>
    db.from("tracking_runs").select("id, run_date, status, error, started_at, step_ms").eq("run_date", day).in("status", ["partial", "failed"]).order("id").range(from, to),
  );
  for (const r of runs) {
    const id = r.id as string;
    if (rerunMarker(r.step_ms as never)) { out.skipped.push({ run: id, why: "already re-run today" }); continue; }
    const asked = await requestRerun({ id, run_date: r.run_date as string, status: r.status as string, error: (r.error as string | null) ?? null, started_at: (r.started_at as string | null) ?? null, step_ms: r.step_ms as never }, day);
    if (!asked.ok) { out.skipped.push({ run: id, why: asked.message }); continue; }
    try {
      await dispatchTrackingRun(id);
      out.retried.push(id);
    } catch (e) {
      out.skipped.push({ run: id, why: `dispatch failed: ${e instanceof Error ? e.message : String(e)}`.slice(0, 160) });
    }
  }
  return out;
}
