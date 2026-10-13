import type { RankedKeywords } from "../../scan/dataforseo-request.ts";
import type { RefusalCode } from "../core/caps.ts";
import type { JobContext, JobHandler, JobOutcome, JobResult, ReadCtx } from "../core/jobs.ts";
import type { ReadResult } from "../core/ledger.ts";

import { compactFootprint, pullDecision } from "./footprint.ts";

/**
 * The `footprint` job (13 Oct 2026, DIY P6; spec 10 sections 5.2, 5.7 and
 * 6.6): DataForSEO Labs' `ranked_keywords` for the client's domain, into one
 * `keyword_footprints` row. Paid, weekly on the client's start weekday, and
 * part of onboarding. Registered by the wave 2 shell in
 * `src/lib/diy/wiring.ts` (P9), never by this package.
 *
 * Every read goes through P1's rails: the worker hands this job a ReadCtx,
 * and the read is P1's `readRankedKeywords` door (doors.ts), which reserves
 * in the DIY ledger at the request's maximum ($0.132 at 1000 rows) before it
 * goes out and settles at what DataForSEO billed. So the kill switch, the
 * global and per-client caps and the door's daily count all refuse here
 * before a cent is spent, and nothing in this file can read uncapped: without
 * a ctx it does not typecheck.
 *
 * The door is imported when the job runs, not when this file loads, so the
 * registry (wiring.ts, which node --test loads) never pulls in the
 * server-only vendor module; a test hands its own reader in.
 *
 * What it does, in order:
 *
 * 1. reads the latest `labs_status` row (the dispatcher stores it nightly,
 *    free) and this client's last pull;
 * 2. asks the Labs date gate (footprint.ts pullDecision): no pull when Labs'
 *    Google date has not moved, or within a week of the last pull - so an
 *    unchanged date costs nothing, as section 5.6 item 6 requires;
 * 3. reads, and on a read writes one row, upserted on (client, pulled_on), so
 *    the worker's 15-minute stale reclaim running it twice costs a repeat,
 *    never a second row.
 *
 * A refusal is not a failure: a daily cap (global, the door's count, a run
 * out of time, an unreadable ledger) defers it to tomorrow; the switch off,
 * the month's scheduled budget used, or an inactive client skips it until its
 * next slot - which is how "footprint weekly falls back to monthly" when the
 * month budget binds (spec 5.6, at a cap), since nothing is spent again until
 * the budget's month turns. Every outcome carries a note, and a failure is
 * never swallowed.
 */

export const FOOTPRINT_KIND = "footprint";

/** Refusals that clear by tomorrow: the worker re-queues a deferred job for the next day. */
const DEFER: ReadonlySet<RefusalCode> = new Set<RefusalCode>(["global_daily", "model_headroom", "door_daily", "deadline", "ledger_unreadable", "tracking_running"]);

export function refusalOutcome(code: RefusalCode): JobOutcome {
  return DEFER.has(code) ? "deferred" : "skipped";
}

export type FootprintReader = (ctx: ReadCtx) => Promise<ReadResult<RankedKeywords>>;

/** P1's door, loaded when a job runs (see above). */
const doorRead: FootprintReader = async (ctx) => (await import("../core/doors.ts")).readRankedKeywords(ctx);

const msg = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 300);

/**
 * The handler, with its reader injectable for tests. Priority 0: it runs
 * before the same night's `plan_refresh` (priority 1), so a keyword gaining
 * ground in tonight's pull reaches the Plan's candidates tonight.
 */
export function footprintHandler(deps: { read?: FootprintReader } = {}): JobHandler {
  const read = deps.read ?? doorRead;
  return {
    kind: FOOTPRINT_KIND,
    paid: true,
    cadence: "weekly",
    priority: 0,
    onboarding: true,
    run: (ctx) => runFootprint(ctx, read),
  };
}

export async function runFootprint(ctx: JobContext, read: FootprintReader): Promise<JobResult> {
  if (!ctx.read) return { outcome: "failed", note: "footprint is a paid kind and was run with no ReadCtx" };
  const clientId = ctx.client.id;
  const [{ data: labs, error: labsErr }, { data: last, error: lastErr }] = await Promise.all([
    ctx.db.from("diy_vendor_status").select("google_date, read_on").eq("kind", "labs_status").order("read_on", { ascending: false }).limit(1),
    ctx.db.from("keyword_footprints").select("pulled_on, labs_date").eq("client_domain_id", clientId).order("pulled_on", { ascending: false }).limit(1),
  ]);
  if (labsErr) return { outcome: "failed", note: `could not read the Labs date: ${labsErr.message}` };
  if (lastErr) return { outcome: "failed", note: `could not read the last footprint: ${lastErr.message}` };
  const labsRow = (labs?.[0] ?? null) as { google_date?: string | null } | null;
  const labsDate = typeof labsRow?.google_date === "string" ? labsRow.google_date.slice(0, 10) : null;
  const lastRow = (last?.[0] ?? null) as { pulled_on: string; labs_date: string | null } | null;
  const decision = pullDecision({ labsDate, last: lastRow ? { pulledOn: lastRow.pulled_on, labsDate: lastRow.labs_date } : null, today: ctx.today });
  if (!decision.pull) return { outcome: "skipped", note: decision.why };

  let got: ReadResult<RankedKeywords>;
  try {
    got = await read(ctx.read);
  } catch (err) {
    return { outcome: "failed", note: `ranked_keywords threw: ${msg(err)}` };
  }
  if (got.kind === "refused") return { outcome: refusalOutcome(got.refusal.code), note: `footprint refused (${got.refusal.code}): ${got.refusal.reason}` };
  if (got.kind === "failed") return { outcome: "failed", note: `ranked_keywords failed: ${got.reason}` };

  const footprint = compactFootprint(got.value);
  const { error } = await ctx.db.from("keyword_footprints").upsert(
    [
      {
        client_domain_id: clientId,
        pulled_on: ctx.today,
        labs_date: labsDate,
        total_count: footprint.total,
        etv: footprint.etv,
        rows: footprint.rows,
        read_id: got.readId,
      },
    ],
    { onConflict: "client_domain_id,pulled_on" },
  );
  // The read is paid for and settled; its rows are lost with this write, so it is a failure, said with what it cost.
  if (error) return { outcome: "failed", note: `ranked_keywords read ($${got.cost}) but not stored: ${error.message}` };
  const of = footprint.total !== null && footprint.total > footprint.rows.length ? ` of ${footprint.total}` : "";
  return { outcome: "ok", note: `${footprint.rows.length} keywords${of} pulled ($${got.cost}${got.partial ? ", partial" : ""}); ${decision.why}` };
}
