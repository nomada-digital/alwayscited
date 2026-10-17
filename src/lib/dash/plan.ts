import { MONTHLY_INSERTIONS_MIN, MONTHLY_PLACEMENTS, TIERS, TRACKED_CLUSTERS, TRACKED_KEYWORDS, TRACKED_PROMPTS, PACK_CLUSTERS, trackingPackPrice } from "@/config/pricing";

import type { PlanShape } from "./allowance";
import type { RawPlacement, TierKey } from "./types";

/**
 * What a plan allows and delivers, as the dashboards host draws it. Every
 * figure is pricing.ts's; nothing here is typed twice.
 */

/** Prompts and keywords per cluster the plan allows: 50 / 10 and 10 / 10 today. */
export function planShape(): PlanShape {
  return { promptsPerCluster: TRACKED_PROMPTS / TRACKED_CLUSTERS, keywordsPerCluster: TRACKED_KEYWORDS / TRACKED_CLUSTERS };
}

export const TIER_ORDER: readonly TierKey[] = ["tracked", "mentioned", "cited", "everywhere"];

export function tierInfo(tier: TierKey) {
  return TIERS.find((t) => t.key === tier) ?? TIERS[0]!;
}

/** The next tier up, or null on the top one. */
export function nextTier(tier: TierKey): TierKey | null {
  const i = TIER_ORDER.indexOf(tier);
  return i >= 0 && i < TIER_ORDER.length - 1 ? TIER_ORDER[i + 1]! : null;
}

export type Deliverable = { key: "placements" | "insertions" | "schema" | "pr"; label: string; target: number | null; unit: string };

/**
 * What the paid tiers deliver each month on a worked cluster (pricing.ts,
 * Danny 16 Oct 2026). alwaystracked delivers tracking only, so none.
 */
export function deliverables(tier: TierKey): Deliverable[] {
  const out: Deliverable[] = [];
  if (tier === "tracked") return out;
  out.push({ key: "placements", label: "Placements", target: MONTHLY_PLACEMENTS, unit: "a month" });
  if (tier === "cited" || tier === "everywhere") {
    out.push({ key: "insertions", label: "Link insertions", target: MONTHLY_INSERTIONS_MIN, unit: "or more a month" });
    out.push({ key: "schema", label: "Schema work on your pages", target: null, unit: "" });
  }
  if (tier === "everywhere") out.push({ key: "pr", label: "Brand PR for earned media", target: null, unit: "" });
  return out;
}

/** This month's delivery against a deliverable, read off the cluster's placements. */
export function delivered(d: Deliverable, placements: readonly RawPlacement[], monthStart: string): { live: number; inFlight: number } | null {
  const kinds = d.key === "placements" ? ["guest_post", "coverage", "on_site"] : d.key === "insertions" ? ["link_insertion"] : null;
  if (!kinds) return null;
  const mine = placements.filter((p) => kinds.includes(p.kind));
  return {
    live: mine.filter((p) => p.status === "live" && (p.live_on ?? "") >= monthStart).length,
    inFlight: mine.filter((p) => p.status === "pitched" || p.status === "writing" || p.status === "scheduled").length,
  };
}

export function packLine(market: string): string {
  return `${trackingPackPrice(market)} a month adds ${PACK_CLUSTERS} clusters`;
}
