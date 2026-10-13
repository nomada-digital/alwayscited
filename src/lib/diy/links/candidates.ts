import type { SupabaseClient } from "@supabase/supabase-js";

import { type Day, addDays, formatDay } from "../../tracking/figures.ts";
import { urlKey } from "../../tracking/placements.ts";
import type { DiyClient } from "../core/client.ts";
import { loadDiyEnabled } from "../core/settings.ts";
import { readKeyPages } from "../opportunities/data.ts";
import type { Candidate, CandidateSource } from "../plan/types.ts";

import { readLinksAccess } from "./access.ts";
import { readLatest } from "./data.ts";
import { type Placed, excludePlacedDomains, readPlacedDomains } from "./nomada-placements.ts";
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
 *
 * **This week's lost set only** (13 Oct 2026, review of DIY P10): the latest
 * new and lost read counts only when it was made in the last RECLAIM_DAYS
 * (the weekly read, with a day's slack for a deferred night). When the
 * weekly job stops - Backlinks access inactive, the month's budget falling
 * back to monthly, repeated failures - an old loss would otherwise make a
 * fresh Slipping card every day. And none while the latest Backlinks call
 * failed with an access code: the card's link opens a section the page then
 * hides.
 */

export const MAX_RECLAIM = 3;
/** How old the new and lost read may be for its losses to be this week's: the weekly read, and a day for a deferred night. */
export const RECLAIM_DAYS = 8;

const pathOf = (url: string): string => {
  try {
    return new URL(url).pathname || "/";
  } catch {
    return url;
  }
};

/** The cards, pure: lost links to a live key page, newest loss first, from a read made this week. */
export function reclaimCandidates(read: Stored<NewLost> | null, keyPages: readonly { url: string; clusterIds: string[] }[], placed: Placed, today: Day): Candidate[] {
  if (!read || read.readOn < addDays(today, -(RECLAIM_DAYS - 1)) || read.readOn > today) return [];
  const pages = new Map(keyPages.map((k) => [urlKey(k.url), k] as const).filter(([k]) => k !== null) as [string, { url: string; clusterIds: string[] }][]);
  const lost = excludePlacedDomains(read.value.lost, placed, (l) => ({ domain: l.domain, url: l.urlFrom }))
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
  async gather(db: SupabaseClient, client: DiyClient, today: Day): Promise<Candidate[]> {
    if (!(await loadDiyEnabled(db))) return [];
    if ((await readLinksAccess(db)).state === "inactive") return [];
    const [read, keyPages, placed] = await Promise.all([readLatest<NewLost>(db, client.id, "new_lost"), readKeyPages(db, client.id), readPlacedDomains(db, client.id)]);
    return reclaimCandidates(read, keyPages, placed, today);
  },
};
