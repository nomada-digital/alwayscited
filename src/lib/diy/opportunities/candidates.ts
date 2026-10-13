import type { SupabaseClient } from "@supabase/supabase-js";

import { type Day, addDays, formatDay } from "../../tracking/figures.ts";
import type { DiyClient } from "../core/client.ts";
import type { Candidate, CandidateSource } from "../plan/types.ts";

import { readOpportunityRows } from "./data.ts";
import { readPlacedKeys, withoutPlaced } from "./derive.ts";
import { compareOrder, orderKey } from "./order.ts";
import { planCandidate } from "./status.ts";
import type { Opportunity } from "./types.ts";

/**
 * Opportunities' Plan candidates (13 Oct 2026, DIY P7; spec 10 section 6.1),
 * registered in wiring.ts `CANDIDATE_SOURCES` by the wave's shell:
 *
 * - **Biggest gap**: the top `cited` opportunity by the stated order
 *   (order.ts) that is still new. Its dedupe key is the one a pursuit's Plan
 *   item uses, `opp:<id>`, so pursuing it moves the same item.
 * - **Slipping**: a pursued or won page whose latest watch found the link or
 *   the mention gone (watch.job.ts `removed`), in the last week.
 *
 * Other clients' placements are subtracted before either is picked.
 */

/** Pure: the candidates from one client's rows. */
export function opportunityCandidatesFrom(rows: readonly Opportunity[], today: Day): Candidate[] {
  const out: Candidate[] = [];
  const top = rows
    .filter((o) => o.lens === "cited" && o.status === "new" && o.live)
    .sort((a, b) => compareOrder({ key: orderKey(a.evidence, a.pageType, a.firstSeen), urlKey: a.urlKey }, { key: orderKey(b.evidence, b.pageType, b.firstSeen), urlKey: b.urlKey }))[0];
  if (top) out.push(planCandidate(top));
  const since = addDays(today, -7);
  for (const o of rows) {
    const v = o.verified;
    if (!v?.removed || v.at < since || !(o.status === "pursuing" || o.status === "pitched" || o.status === "won")) continue;
    const link = v.removed === "link";
    out.push({
      dedupeKey: `opp-removed:${o.id}:${v.at}`,
      kind: link ? "reclaim_link" : "get_onto_page",
      severity: "slipping",
      clusterId: o.clusterId,
      title: link ? `Ask ${o.domain} to restore your link` : `Ask ${o.domain} to restore your mention`,
      why: [{ text: link ? `The link to your site was on the page before, and not on ${formatDay(v.at)}.` : `The page named you before, and didn't on ${formatDay(v.at)}.`, href: `/opportunities/${o.id}` }],
      grade: "your_data",
      effort: "minutes",
      href: `/opportunities/${o.id}`,
      ref: { table: "opportunities", id: o.id },
      evidenceOn: v.at,
    });
  }
  return out;
}

/** The source, as wiring.ts registers it. A failed read throws, so the plan job says so rather than finding nothing. */
export const opportunityCandidates: CandidateSource = {
  name: "opportunities",
  async gather(db: SupabaseClient, client: DiyClient, today: Day): Promise<Candidate[]> {
    const [rows, placed] = await Promise.all([readOpportunityRows(db, client.id), readPlacedKeys(db, client.id)]);
    return opportunityCandidatesFrom(withoutPlaced(rows, placed), today);
  },
};
