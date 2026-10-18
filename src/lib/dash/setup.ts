/**
 * Setup on the dashboards host (18 Oct 2026 brief 2b / 2c / 2d): what each
 * cluster still needs before the first reading, in the order the page asks it -
 * keyword (checked on Google, with its plural ticked), target page, then the
 * five prompts, which the customer saves; nothing is approved for them.
 *
 * A worked cluster (tier mentioned, cited or everywhere) cannot be confirmed
 * without its target page: it is where every placement for it links. A
 * tracking-only cluster may go without one.
 *
 * Pure, so the page, the confirm route and the tests share one rule.
 */

import { chosenTarget, type KeyPageRow } from "./target.ts";
import { MANAGED_TIERS } from "./types.ts";

export type SetupCluster = { id: string; name: string; tier: string; keywordId: string | null; keyword: string | null; pair: string | null; target: string | null; prompts: number };

type Live = { stopped_on: string | null };
type Rows = {
  clusters: readonly ({ id: string; name: string; tier: string; keyword_id: string | null } & Live)[];
  keywords: readonly ({ id: string; keyword: string; pair_of?: string | null } & Live)[];
  prompts: readonly ({ cluster_id: string | null; allowance?: string | null } & Live)[];
  keyPages?: readonly KeyPageRow[];
};

export const worked = (tier: string) => (MANAGED_TIERS as readonly string[]).includes(tier);

export function setupClusters(r: Rows): SetupCluster[] {
  const live = <T extends Live>(x: T) => x.stopped_on === null;
  return r.clusters.filter(live).map((c) => {
    const head = c.keyword_id ? r.keywords.find((k) => k.id === c.keyword_id && live(k)) ?? null : null;
    const pair = head ? r.keywords.find((k) => live(k) && k.pair_of === head.id) ?? null : null;
    return {
      id: c.id,
      name: c.name,
      tier: c.tier,
      keywordId: head?.id ?? null,
      keyword: head?.keyword ?? null,
      pair: pair?.keyword ?? null,
      target: chosenTarget(r.keyPages ?? [], c.id),
      prompts: r.prompts.filter((p) => live(p) && p.cluster_id === c.id && p.allowance !== "placement").length,
    };
  });
}

/** What still stands between a client and Confirm, one line per gap; empty when it can be confirmed. */
export function setupGaps(clusters: readonly SetupCluster[]): string[] {
  const out: string[] = [];
  if (!clusters.length) out.push("Add a cluster first.");
  for (const c of clusters) {
    if (!c.keyword) out.push(`${c.name}: check and set its Google keyword.`);
    if (worked(c.tier) && !c.target) out.push(`${c.name}: choose its target page - every placement for it links there.`);
    if (c.prompts === 0) out.push(`${c.name}: save its prompts.`);
  }
  return out;
}

/** The step a cluster is on: the first thing it lacks, or done. */
export function stepOf(c: SetupCluster): "keyword" | "target" | "prompts" | "done" {
  if (!c.keyword) return "keyword";
  if (!c.target && worked(c.tier)) return "target";
  if (c.prompts === 0) return "prompts";
  return "done";
}

const pageKey = (u: string) => u.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/[?#].*$/, "").replace(/\/+$/, "");

/** Where a given page ranks in a read's top results, or null when it is not in them. */
export function rankOfPage(top: readonly { rank: number; url: string | null }[], url: string | null): number | null {
  if (!url) return null;
  const k = pageKey(url);
  return top.find((t) => t.url && pageKey(t.url) === k)?.rank ?? null;
}

/**
 * Share of the two keywords' Google top 10 that is the same pages (brief 2c's
 * hint): above ~70% Google is treating them as one search, so one page may
 * rank for both. Null when either read is empty.
 */
export function topOverlap(a: readonly { url: string | null }[], b: readonly { url: string | null }[]): number | null {
  const ka = new Set(a.slice(0, 10).map((x) => x.url && pageKey(x.url)).filter(Boolean) as string[]);
  const kb = new Set(b.slice(0, 10).map((x) => x.url && pageKey(x.url)).filter(Boolean) as string[]);
  if (!ka.size || !kb.size) return null;
  const shared = [...ka].filter((k) => kb.has(k)).length;
  return shared / Math.min(ka.size, kb.size);
}

export const ONE_SEARCH = 0.7;
