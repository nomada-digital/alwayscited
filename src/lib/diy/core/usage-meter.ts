import type { SupabaseClient } from "@supabase/supabase-js";

import { type AllowanceKey, type AllowancePeriod, ALLOWANCES, allowanceFor, allowanceMonth } from "./allowances.ts";
import type { DiyClient } from "./client.ts";
import { type DiyFixtureFile, diyFixtureState, pickState, readDiyFixture } from "./fixture.ts";
import { loadDiyEnabled } from "./settings.ts";

/**
 * This month's research, counted (13 Oct 2026, DIY P1; spec 10 sections 2.5
 * and 4.13): the Settings usage block (P9) and the allowance check every
 * on-demand action makes first (`runOnDemand`). Counts only, never dollars.
 *
 * Each count is read from where the spec says it lives:
 *
 * | Allowance | Counted from |
 * |---|---|
 * | page checks | `diy_reads`, action `page_check`, status ok or partial, this month |
 * | drafted examples | `reopt_examples` (P8), status `ready`, requested this month |
 * | link checks | `diy_reads`, action `link_check` or `verify`, status ok or partial, this month |
 * | link targets | `opportunities` (P7), lens `link_page`, revealed this month (W3) |
 * | pursuing | `opportunities`, status pursuing or pitched, now |
 *
 * So a check that never made a paid read - "Check a link" answered by our own
 * free fetch - writes no ledger row and is not counted (section 2.5 counts
 * ledger rows). And a page check that makes two paid reads must tag only one
 * of them with the action, or it counts twice: P8's to keep.
 *
 * `reopt_examples` and `opportunities` arrive in wave 2. Until then their
 * counts read as unknown - never as zero ("a section error never reads as
 * zero"), each logged as `[diy] usage <key>: ...`. The month is the client's
 * own (allowances.ts allowanceMonth), resetting on the 1st in its zone.
 */

/** The rows of the Settings block, in its order. */
export const USAGE_KEYS = ["page_checks", "examples", "link_checks", "link_targets", "pursuits"] as const satisfies readonly AllowanceKey[];
export type UsageKey = (typeof USAGE_KEYS)[number];

export type UsageRow = {
  key: UsageKey;
  label: string;
  /** Null when it could not be counted: shown as unread, never as 0. */
  used: number | null;
  limit: number;
  period: AllowancePeriod;
  /** "Page checks: 3 of 30 used", "Pursuing: 4 of 10"; null when uncounted. */
  line: string | null;
};

export type DiyUsage = { enabled: boolean; resetsOn: string; resetsLabel: string; rows: UsageRow[] };

/** A ledger row as the meter counts it. */
export type LedgerCountRow = { action: string | null; status: string };

const COUNTED = ["ok", "partial"];

/** Page checks or link checks among ledger rows already narrowed to this client and month. Pure. */
export function countLedger(rows: readonly LedgerCountRow[], key: "page_checks" | "link_checks"): number {
  const actions = key === "page_checks" ? ["page_check"] : ["link_check", "verify"];
  return rows.filter((r) => r.action !== null && actions.includes(r.action) && COUNTED.includes(r.status)).length;
}

const msg = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** One allowance's count for one client this month. Throws when it cannot be read. */
export async function countUsage(db: SupabaseClient, client: Pick<DiyClient, "id" | "market">, key: UsageKey, now: number): Promise<number> {
  const since = allowanceMonth(client.market, now).start;
  const counted = (r: { count: number | null; error: { message: string } | null }, what: string) => {
    if (r.error) throw new Error(`could not count ${what}: ${r.error.message}`);
    if (typeof r.count !== "number") throw new Error(`could not count ${what}: no count came back`);
    return r.count;
  };
  switch (key) {
    case "page_checks":
    case "link_checks": {
      const actions = key === "page_checks" ? ["page_check"] : ["link_check", "verify"];
      const { count, error } = await db
        .from("diy_reads")
        .select("id", { count: "exact", head: true })
        .eq("client_domain_id", client.id)
        .in("action", actions)
        .in("status", COUNTED)
        .gte("created_at", since);
      return counted({ count, error }, key);
    }
    case "examples": {
      const { count, error } = await db
        .from("reopt_examples")
        .select("id", { count: "exact", head: true })
        .eq("client_domain_id", client.id)
        .eq("status", "ready")
        .gte("requested_at", since);
      return counted({ count, error }, key);
    }
    case "link_targets": {
      const { count, error } = await db
        .from("opportunities")
        .select("id", { count: "exact", head: true })
        .eq("client_domain_id", client.id)
        .eq("lens", "link_page")
        .gte("revealed_at", since);
      return counted({ count, error }, key);
    }
    case "pursuits": {
      const { count, error } = await db
        .from("opportunities")
        .select("id", { count: "exact", head: true })
        .eq("client_domain_id", client.id)
        .in("status", ["pursuing", "pitched"]);
      return counted({ count, error }, key);
    }
  }
}

/** One Settings row from a count. Pure. */
export function usageRow(key: UsageKey, used: number | null, client: Pick<DiyClient, "trial">): UsageRow {
  const a = ALLOWANCES[key];
  const limit = allowanceFor(key, client);
  const line = used === null ? null : `${a.label}: ${used} of ${limit}${key === "page_checks" ? " used" : ""}`;
  return { key, label: a.label, used, limit, period: a.period, line };
}

/** The DIY fixture's usage: this month's ledger rows, and the counts other packages' tables hold. */
export type CoreFixture = { reads: LedgerCountRow[]; counts: { examples: number; link_targets: number; pursuits: number } };

/** The usage block. Each count on its own: one that cannot be read is unknown and logged, and the rest still show. */
export async function loadDiyUsage(db: SupabaseClient | null, client: DiyClient, now: number): Promise<DiyUsage> {
  const month = allowanceMonth(client.market, now);
  const enabled = await loadDiyEnabled(db);
  const state = diyFixtureState();
  if (state !== null) {
    const fx = readDiyFixture<CoreFixture>("core");
    const used: Record<UsageKey, number> = {
      page_checks: countLedger(fx.reads, "page_checks"),
      link_checks: countLedger(fx.reads, "link_checks"),
      examples: fx.counts.examples,
      link_targets: fx.counts.link_targets,
      pursuits: fx.counts.pursuits,
    };
    return { enabled, resetsOn: month.resetsOn, resetsLabel: month.resetsLabel, rows: USAGE_KEYS.map((k) => usageRow(k, used[k], client)) };
  }
  const rows = await Promise.all(
    USAGE_KEYS.map(async (key) => {
      if (!db) return usageRow(key, null, client);
      try {
        return usageRow(key, await countUsage(db, client, key, now), client);
      } catch (err) {
        console.warn(`[diy] usage ${key}: ${msg(err)}`);
        return usageRow(key, null, client);
      }
    }),
  );
  return { enabled, resetsOn: month.resetsOn, resetsLabel: month.resetsLabel, rows };
}

/** The fixture file's entry for a state, for tests that read it without the environment. */
export function coreFixtureFor(file: DiyFixtureFile<CoreFixture>, state: Parameters<typeof pickState>[1]): CoreFixture {
  return pickState(file, state);
}
