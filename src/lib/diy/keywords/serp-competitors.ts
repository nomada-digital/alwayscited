import type { Day } from "../../tracking/figures.ts";
import { urlKey } from "../../tracking/placements.ts";

/**
 * Who holds Google's page 1 for the client's keywords (13 Oct 2026, DIY P6;
 * spec 10 section 4.3 rows 5 and 7). Pure, and read by us: the organic
 * results the daily keyword read already pays for, kept in `tracking_serp.top`
 * since 13 Oct 2026 (MS-1) - rank, domain and URL to position 20, per keyword
 * per day. Facts only: which domains hold the top 10, and where. Nothing here
 * calls a domain a competitor, ranks one by a score, or says why it ranks.
 *
 * Nomada's inventory never reaches a list here by another route (spec 2.3,
 * 6.2 step 2): a result whose page is one where Nomada has placed any other
 * client (that client's `placements` rows, any status, by url_key) is left
 * out of the "who holds page 1" list and not counted for its domain, with no
 * label. Its rank is not renumbered: the ranks shown are Google's.
 */

export type TopHit = { rank: number; domain: string; url: string | null };

const bare = (h: string) => h.trim().toLowerCase().replace(/^www\./, "");

/** A stored `top` read strictly: rank, domain and URL only, rank order, at most 20; null when there is none (a row from before MS-1). */
export function parseTop(v: unknown): TopHit[] | null {
  if (!Array.isArray(v)) return null;
  const out: TopHit[] = [];
  for (const raw of v) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const rank = typeof r.rank === "number" && Number.isInteger(r.rank) && r.rank >= 1 && r.rank <= 100 ? r.rank : null;
    const domain = typeof r.domain === "string" ? bare(r.domain) : "";
    if (rank === null || !domain) continue;
    const url = typeof r.url === "string" && /^https?:\/\//i.test(r.url) && r.url.length <= 500 ? r.url : null;
    out.push({ rank, domain, url });
  }
  return out.sort((a, b) => a.rank - b.rank).slice(0, 20);
}

/** Whether a host is the client's own domain or one of its subdomains. */
export function isOwn(domain: string, own: string): boolean {
  const d = bare(domain);
  const o = bare(own);
  return d === o || d.endsWith(`.${o}`);
}

/** Google's page 1 for one keyword: ranks 1-10, less any page where Nomada has placed another client. */
export function pageOne(top: readonly TopHit[], others: ReadonlySet<string>): TopHit[] {
  return top.filter((h) => h.rank <= 10 && !(h.url && others.has(urlKey(h.url) ?? "")));
}

export type SerpCompetitor = {
  domain: string;
  /** Cluster keywords it holds a page-1 place for, at each keyword's latest reading. */
  keywords: number;
  /** Its average best rank across those keywords, to one decimal. */
  avg: number;
};

export type SerpCompetitors = {
  rows: SerpCompetitor[];
  /** Keywords with a stored top 10 at their latest reading: the denominator. */
  read: number;
  /** The latest reading's day across them. */
  latest: Day | null;
  /** Whether those readings are on more than one day. */
  mixed: boolean;
};

/**
 * Domains by how many of the client's keywords they hold on page 1, at each
 * keyword's latest reading, with their average position; the client's own
 * domain left out; the top `limit` (spec 4.3 row 7: 10). One keyword counts a
 * domain once, at its best rank there.
 */
export function serpCompetitors(latest: readonly { keywordId: string; day: Day; top: readonly TopHit[] }[], own: string, others: ReadonlySet<string>, limit = 10): SerpCompetitors {
  const per = new Map<string, number[]>();
  for (const k of latest) {
    const best = new Map<string, number>();
    for (const h of pageOne(k.top, others)) {
      if (isOwn(h.domain, own)) continue;
      const had = best.get(h.domain);
      if (had === undefined || h.rank < had) best.set(h.domain, h.rank);
    }
    for (const [d, rank] of best) per.set(d, [...(per.get(d) ?? []), rank]);
  }
  const rows = [...per.entries()]
    .map(([domain, ranks]) => ({ domain, keywords: ranks.length, avg: Math.round((ranks.reduce((s, r) => s + r, 0) / ranks.length) * 10) / 10 }))
    .sort((a, b) => b.keywords - a.keywords || a.avg - b.avg || a.domain.localeCompare(b.domain))
    .slice(0, limit);
  const days = [...new Set(latest.map((k) => k.day))].sort();
  return { rows, read: latest.length, latest: days[days.length - 1] ?? null, mixed: days.length > 1 };
}
