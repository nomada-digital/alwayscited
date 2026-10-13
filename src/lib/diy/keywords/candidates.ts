import type { SupabaseClient } from "@supabase/supabase-js";

import type { Day } from "../../tracking/figures.ts";
import { CLUSTER_BASE } from "../../tracking/limits.ts";
import type { DiyClient } from "../core/client.ts";
import { formatDate } from "../../format-date.ts";
import type { Candidate, CandidateSource } from "../plan/types.ts";

import { type Dismissal, liveDismissal, readDismissals, readPulls } from "./data.ts";
import { type Momentum, gainingLabel, momentum } from "./momentum.ts";

/**
 * The Plan's keyword candidates (13 Oct 2026, DIY P6; spec 10 section 6.1):
 * Tidy-up, "a gaining-ground keyword while a cluster slot is free". Free: it
 * reads the stored pulls and the client's own rows, never a vendor. Registered
 * in `CANDIDATE_SOURCES` by the wave 2 shell (P9), not here.
 *
 * One candidate per free cluster slot, at most MAX_KEYWORD_CANDIDATES, from
 * the top of the momentum rule's order: each is "Track 'x' as a cluster",
 * kind `track_keyword`, its button "Track" opening Clusters' add panel
 * prefilled with `src=gaining`, so the client presses Check keyword (the
 * existing paid door, 20 a day) and the cluster's prompts carry the Momentum
 * origin. Graded Common practice: tracking a keyword promises nothing, and
 * the copy says no outcome. With no free slot there is no candidate - the
 * Google page's U7 says that instead.
 */

export const MAX_KEYWORD_CANDIDATES = 3;

type ClientFacts = { aliases: string[]; clusterLimit: number; liveClusters: number; tracked: { keyword: string; stopped_on: Day | null }[] };

/** What a candidate needs beyond the pulls: aliases, the cluster limit, the clusters in use and the tracked keywords. */
async function readClientFacts(db: SupabaseClient, clientId: string): Promise<ClientFacts> {
  const [{ data: client, error: clientErr }, { count: liveClusters, error: clustersErr }, { data: keywords, error: keywordsErr }] = await Promise.all([
    db.from("client_domains").select("brand_aliases, cluster_limit").eq("id", clientId).maybeSingle(),
    db.from("tracked_clusters").select("id", { count: "exact", head: true }).eq("client_domain_id", clientId).is("stopped_on", null),
    db.from("tracked_keywords").select("keyword, stopped_on").eq("client_domain_id", clientId).range(0, 999),
  ]);
  if (clientErr) throw new Error(`could not read the client: ${clientErr.message}`);
  if (clustersErr) throw new Error(`could not count the clusters: ${clustersErr.message}`);
  if (keywordsErr) throw new Error(`could not read the keywords: ${keywordsErr.message}`);
  const row = (client ?? {}) as { brand_aliases?: string[] | null; cluster_limit?: number | null };
  return {
    aliases: (row.brand_aliases ?? []).filter(Boolean),
    clusterLimit: typeof row.cluster_limit === "number" && row.cluster_limit > 0 ? row.cluster_limit : CLUSTER_BASE,
    // A failed head count has no body; its error is read above, and an unread count is never a free slot.
    liveClusters: liveClusters ?? Number.POSITIVE_INFINITY,
    tracked: ((keywords ?? []) as { keyword: string; stopped_on: string | null }[]).map((k) => ({ keyword: k.keyword, stopped_on: k.stopped_on ? String(k.stopped_on).slice(0, 10) : null })),
  };
}

/** The candidates, pure: the top gaining keywords while slots are free. */
export function keywordCandidatesFrom(m: Momentum | null, free: number): Candidate[] {
  if (!m || free <= 0) return [];
  return m.rows.slice(0, Math.min(free, MAX_KEYWORD_CANDIDATES)).map((g) => ({
    dedupeKey: `kw-gaining:${g.keyword}`.slice(0, 200),
    kind: "track_keyword",
    severity: "tidy",
    clusterId: null,
    title: `Track '${g.keyword}' as a cluster`,
    why: [
      { text: `${gainingLabel(g, m.basis)} on Google${g.volume !== null ? `, ${g.volume.toLocaleString("en-GB")} searches a month` : ""} (DataForSEO estimate, read ${formatDate(m.readOn)}).`, href: "/google?gaining=1" },
      { text: `${free} of your cluster slots ${free === 1 ? "is" : "are"} free.`, href: "/clusters" },
    ],
    grade: "practice",
    effort: "minutes",
    href: `/clusters?${new URLSearchParams({ add: "1", kw: g.keyword, src: "gaining" })}`,
    ...(g.volume !== null ? { volume: g.volume } : {}),
    evidenceOn: m.readOn,
  }));
}

export const keywordCandidates: CandidateSource = {
  name: "keywords",
  async gather(db, client: DiyClient, today: Day) {
    const [pulls, facts, dismissals] = await Promise.all([readPulls(db, client.id), readClientFacts(db, client.id), readDismissals(db, client.id)]);
    if (!pulls.latest) return [];
    const m = momentum({
      latest: pulls.latest,
      previous: pulls.previous,
      tracked: facts.tracked,
      dismissed: new Set(dismissals.filter((d: Dismissal) => liveDismissal(d, today)).map((d) => d.key)),
      subject: { brand: client.brand, domain: client.domain, aliases: facts.aliases },
      showAll: false,
      today,
    });
    return keywordCandidatesFrom(m, facts.clusterLimit - facts.liveClusters);
  },
};
