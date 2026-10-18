/**
 * The plan's allowances on the dashboards host (17 Oct 2026).
 *
 * The numbers are pricing.ts's, passed in by the caller as a PlanShape -
 * `planShape()` in plan.ts builds it from TRACKED_CLUSTERS, TRACKED_PROMPTS
 * and TRACKED_KEYWORDS - so this file carries no figure of its own and runs
 * under `node --test` without the `@/` imports pricing.ts needs.
 *
 * A client's `cluster_limit` (10, plus 5 per pack, set by the Stripe webhook)
 * scales all three: prompts and keywords are per cluster the plan allows.
 * Unlike /app, where a cluster is one keyword and five prompts, the pool here
 * is client-wide, so a cluster split into groups can hold a keyword per group.
 * The client's totals are exactly the plan's either way, and so is the cost
 * of the daily check, which is per prompt and keyword, not per cluster.
 *
 * Placement prompts (allowance = 'placement') are their own allowance
 * (limits.ts PLACEMENT_PROMPTS_PER_CLIENT) and are not counted here.
 */

import type { Allowances, Raw } from "./types.ts";

export type PlanShape = { promptsPerCluster: number; keywordsPerCluster: number };

export function allowanceLimits(clusterLimit: number, plan: PlanShape): { clusters: number; prompts: number; keywords: number } {
  const c = Number.isFinite(clusterLimit) && clusterLimit > 0 ? Math.floor(clusterLimit) : 0;
  return { clusters: c, prompts: c * plan.promptsPerCluster, keywords: c * plan.keywordsPerCluster };
}

export function allowances(raw: Pick<Raw, "client" | "clusters" | "prompts" | "keywords">, plan: PlanShape): Allowances {
  const lim = allowanceLimits(raw.client.cluster_limit, plan);
  const liveN = (rows: readonly { stopped_on: string | null }[]) => rows.filter((r) => r.stopped_on === null).length;
  return {
    clusters: { used: liveN(raw.clusters), limit: lim.clusters },
    prompts: { used: raw.prompts.filter((p) => p.stopped_on === null && (p as { allowance?: string | null }).allowance !== "placement").length, limit: lim.prompts },
    // 18 Oct 2026 (brief 2c): a keyword's plural or singular rides free beside it - only primaries are counted.
    keywords: { used: raw.keywords.filter((k) => k.stopped_on === null && (k.form ?? "primary") === "primary").length, limit: lim.keywords },
  };
}

/** How full an allowance is, for the meter: calm under 80%, warn from 80%, full at the limit. */
export function fullness(a: { used: number; limit: number }): "calm" | "warn" | "full" {
  if (a.limit <= 0 || a.used >= a.limit) return "full";
  return a.used / a.limit >= 0.8 ? "warn" : "calm";
}
