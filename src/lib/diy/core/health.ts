import type { SupabaseClient } from "@supabase/supabase-js";

import { formatDay } from "../../tracking/figures.ts";

import { MAX_ATTEMPTS, diyDay } from "./jobs.ts";
import { readDiySpend, utcDayStart } from "./ledger.ts";
import { readDiySettings } from "./settings.ts";

/**
 * The DIY line in the daily run-health email (13 Oct 2026, DIY P1; spec 10
 * sections 5.6 and 8.1): what last night's DIY reads cost against the global
 * caps, whether a cap paused them, how many jobs are still due, and whether
 * DIY is switched off. To our own inbox only (health-mail.ts); silent
 * failures are the gotcha this exists for.
 *
 * "Overnight" is the UTC day so far: the night passes run at 03:30 and 03:45
 * UTC and the caps are per UTC day, and the summary goes after the 05:00
 * tracking runs close. The sums come from `diy_spend`, the same function the
 * reservations check, so the line and the caps cannot disagree.
 *
 * "Carried" is what a worker can still take: not done, due, and under three
 * attempts. A row at three attempts is closed (worker.ts `expireAbandoned`)
 * and never carried (13 Oct 2026, review of DIY P1).
 *
 * The mail goes on a day every client's tracking run was complete too, when
 * this line has something to say (`diyAttention`): carries two nights
 * running are the sign the night window is full (section 5.6), and a pause
 * at a cap is Danny's to see whatever tracking did (run-health.ts
 * reportRunHealth).
 */

/** No client: `diy_spend` then answers only the global sums. */
const NO_CLIENT = "00000000-0000-0000-0000-000000000000";

export type DiyHealth = {
  day: string;
  enabled: boolean;
  dfs: number;
  dfsCap: number;
  model: number;
  modelCap: number;
  pausedAtCap: boolean;
  carried: number;
};

const usd = (v: number) => `$${v.toFixed(2)}`;

/** The line. Pure. */
export function diyHealthLine(h: DiyHealth): string {
  return (
    `DIY reads overnight (${formatDay(h.day)}, UTC): DataForSEO ${usd(h.dfs)} of ${usd(h.dfsCap)}, model ${usd(h.model)} of ${usd(h.modelCap)}; ` +
    `paused at cap: ${h.pausedAtCap ? "yes" : "no"}; jobs carried to tonight: ${h.carried}${h.enabled ? "" : "; off"}`
  );
}

/** The facts behind the line. Throws on a failed read. */
export async function readDiyHealth(db: SupabaseClient, now: number): Promise<DiyHealth> {
  const day = diyDay(now);
  const start = utcDayStart(now);
  const settings = await readDiySettings(db);
  const spend = await readDiySpend(db, NO_CLIENT, start, start);
  const { data: paused, error: pausedErr } = await db
    .from("diy_reads")
    .select("id")
    .eq("status", "refused")
    .in("code", ["global_daily", "model_headroom"])
    .gte("created_at", start)
    .limit(1);
  if (pausedErr) throw new Error(`could not read the DIY refusals: ${pausedErr.message}`);
  const { count, error } = await db
    .from("diy_jobs")
    .select("id", { count: "exact", head: true })
    .is("done_at", null)
    .lte("due_on", day)
    .lt("attempts", MAX_ATTEMPTS);
  if (error) throw new Error(`could not count the DIY jobs still due: ${error.message}`);
  return {
    day,
    enabled: settings.enabled,
    dfs: spend.globalDfsToday,
    dfsCap: settings.dailyDfsCapUsd,
    model: spend.globalModelToday,
    modelCap: settings.dailyModelCapUsd,
    pausedAtCap: Array.isArray(paused) && paused.length > 0,
    carried: count ?? 0,
  };
}

/**
 * The line, or why it could not be written. Never throws, not even while
 * making its client (the caller hands in the factory): the run-health mail
 * goes either way.
 */
export async function diyHealthLineFor(db: SupabaseClient | (() => SupabaseClient), now: number = Date.now()): Promise<string> {
  try {
    return diyHealthLine(await readDiyHealth(typeof db === "function" ? db() : db, now));
  } catch (err) {
    return `DIY reads: could not be read (${(err instanceof Error ? err.message : String(err)).slice(0, 200)})`;
  }
}

/**
 * The line when it needs a look - a cap paused the night, jobs are carried to
 * tonight, or the facts could not be read - else null. Never throws. The
 * run-health report sends its daily mail for this on a day every tracking
 * run was complete (health-io.ts wires it).
 */
export async function diyAttention(db: SupabaseClient | (() => SupabaseClient), now: number = Date.now()): Promise<string | null> {
  try {
    const h = await readDiyHealth(typeof db === "function" ? db() : db, now);
    return h.pausedAtCap || h.carried > 0 ? diyHealthLine(h) : null;
  } catch (err) {
    return `DIY reads: could not be read (${(err instanceof Error ? err.message : String(err)).slice(0, 200)})`;
  }
}
