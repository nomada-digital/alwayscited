import type { SupabaseClient } from "@supabase/supabase-js";

import { formatDay } from "../../tracking/figures.ts";
import { urlKey } from "../../tracking/placements.ts";
import type { DiyClient } from "../core/client.ts";
import { loadDiyEnabled } from "../core/settings.ts";
import { readKeyPages } from "../opportunities/data.ts";
import type { Candidate, CandidateSource } from "../plan/types.ts";

import { readLatest } from "./data.ts";
import { type Placed, readPlacedDomains, withoutPlacedDomains } from "./nomada-placements.ts";
import { ESTIMATE, type NewLost, type Stored } from "./types.ts";

/**
 * Links' Plan candidate (13 Oct 2026, DIY P10; spec 10 sections 6.1 and
 * 6.3): **Reclaim**, a Slipping card. A referring domain in this week's lost
 * set whose link pointed at one of the client's live key pages (P8's
 * `key_pages`, read through P7's tolerant reader: none while the table is
 * absent). The fact is DataForSEO's, so the line says so with its read date;
 * the card is graded Common practice - asking for a lost link back promises
 * nothing, and the copy states no outcome.
 *
 * Dark as the page is: plan_refresh is free and runs while `diy_enabled` is
 * off, so gather reads the switch first and offers nothing while it is off.
 * Domains where Nomada has placed another client are left out, as on every
 * Links list. At most MAX_RECLAIM cards.
 */

export const MAX_RECLAIM = 3;

const pathOf = (url: string): string => {
  try {
    return new URL(url).pathname || "/";
  } catch {
    return url;
  }
};

/** The cards, pure: lost links to a live key page, newest loss first. */
export function reclaimCandidates(read: Stored<NewLost> | null, keyPages: readonly { url: string; clusterIds: string[] }[], placed: Placed): Candidate[] {
  if (!read) return [];
  const pages = new Map(keyPages.map((k) => [urlKey(k.url), k] as const).filter(([k]) => k !== null) as [string, { url: string; clusterIds: string[] }][]);
  const lost = withoutPlacedDomains(read.value.lost.map((l) => ({ ...l, url: l.urlFrom })), placed)
    .filter((l) => l.urlTo && pages.has(urlKey(l.urlTo) ?? ""))
    .sort((a, b) => (b.lastSeen ?? "").localeCompare(a.lastSeen ?? "") || a.domain.localeCompare(b.domain));
  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const l of lost) {
    if (seen.has(l.domain)) continue;
    seen.add(l.domain);
    const page = pages.get(urlKey(l.urlTo!) ?? "")!;
    out.push({
      dedupeKey: `reclaim:${l.domain}`.slice(0, 200),
      kind: "reclaim_link",
      severity: "slipping",
      clusterId: page.clusterIds[0] ?? null,
      title: `Reclaim the link from ${l.domain}`.slice(0, 70),
      why: [{ text: `${l.domain} linked to ${pathOf(l.urlTo!)} and the link is gone (${ESTIMATE}, read ${formatDay(read.readOn)}).`, href: "/links?view=profile#lost" }],
      grade: "practice",
      effort: "hour",
      href: "/links?view=profile#lost",
      evidenceOn: read.readOn,
    });
    if (out.length >= MAX_RECLAIM) break;
  }
  return out;
}

export const linksCandidates: CandidateSource = {
  name: "links",
  async gather(db: SupabaseClient, client: DiyClient): Promise<Candidate[]> {
    if (!(await loadDiyEnabled(db))) return [];
    const [read, keyPages, placed] = await Promise.all([readLatest<NewLost>(db, client.id, "new_lost"), readKeyPages(db, client.id), readPlacedDomains(db, client.id)]);
    return reclaimCandidates(read, keyPages, placed);
  },
};
