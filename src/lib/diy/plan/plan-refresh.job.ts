import type { JobContext, JobHandler, JobResult } from "../core/jobs.ts";
import { loadPlanItems } from "./data.ts";
import { planRefresh, refreshNote } from "./refresh.ts";
import type { Candidate, CandidateSource } from "./types.ts";
import { applyRefresh } from "./write.ts";

/**
 * The `plan_refresh` job (13 Oct 2026, DIY P3; spec 10 section 5.7): free,
 * daily, per client. It gathers every registered source's candidates, upserts
 * the suggestions, drops the ones that no longer apply, and pins the week's
 * three on the week's first run.
 *
 * A factory, so this file never imports wiring.ts: the shell registers
 * `planRefreshHandler([trackingCandidates, ...])` there, and wiring.ts imports
 * this, never the other way round.
 *
 * Each source runs in its own try. One that throws is named in the job's note
 * and the others still count; but with any source failed, no suggestion is
 * counted as gone that night (refresh.ts), since a source that failed has not
 * said its candidates went away. A failed read of the items, or a failed
 * write, fails the job with its message - never swallowed - so the worker
 * marks it failed and it retries.
 */

export const PLAN_REFRESH = "plan_refresh";

export function planRefreshHandler(sources: readonly CandidateSource[]): JobHandler {
  return {
    kind: PLAN_REFRESH,
    paid: false,
    cadence: "daily",
    priority: 1,
    onboarding: false,
    async run(ctx: JobContext): Promise<JobResult> {
      const candidates: Candidate[] = [];
      const failed: string[] = [];
      for (const s of sources) {
        if (Date.now() > ctx.deadlineMs) {
          failed.push(`${s.name} (out of time)`);
          continue;
        }
        try {
          candidates.push(...(await s.gather(ctx.db, ctx.client, ctx.today)));
        } catch (err) {
          console.warn(`[diy] plan_refresh ${s.name}: ${err instanceof Error ? err.message : String(err)}`);
          failed.push(s.name);
        }
      }
      const items = await loadPlanItems(ctx.db, ctx.client.id);
      const plan = planRefresh({ clientId: ctx.client.id, candidates, complete: failed.length === 0, items, today: ctx.today, now: new Date().toISOString() });
      await applyRefresh(ctx.db, ctx.client.id, plan);
      return { outcome: failed.length && failed.length === sources.length ? "failed" : "ok", note: refreshNote(plan, failed) };
    },
  };
}
