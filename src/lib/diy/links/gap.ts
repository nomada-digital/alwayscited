import { allowanceFor } from "../core/allowances.ts";

import { type Placed, bareHost, excludePlacedDomains } from "./nomada-placements.ts";
import type { GapDomain, Hedge, ListCount } from "./types.ts";

/**
 * The link gap by domain (13 Oct 2026, DIY P10; spec 10 sections 4.8 row 3
 * and 6.3): referring domains that link to at least 2 of the 3 compared
 * sites and not to the client, followed links only. Pure.
 *
 * - **From the filter**: one `partial` read over the 3 with
 *   `intersections_count >= 2` (when the stored filter names carry it).
 * - **From the pairwise fallback**: one `all` read per pair of the 3, their
 *   union - a domain in any pair's answer links to both of that pair, so the
 *   union is the n >= 2 set, and its "links to n of 3" is the union of the
 *   pairs it was found in. That holds only while every pair's `total_count`
 *   is within the 100 rows read: past it, the union is the head of each pair
 *   and its count is a floor (gapCount).
 *
 * Either way the rows are checked here again (n >= 2 counted from the
 * targets each row names), the client's own domain and the compared sites
 * themselves are dropped, and so is every domain where Nomada has placed
 * another client - silently, before any count. Then they are sorted here,
 * whatever order the vendor returned: links to 3 before 2, then DataForSEO
 * rank, high first (spec 10 section 6.3: whether the vendor orders them so
 * is [VERIFY], so this does not rely on it).
 */

export const GAP_MIN = 2;

/** The pairs of the compared sites, for the fallback: three pairs of three, one of two. */
export function pairsOf(targets: readonly string[]): [string, string][] {
  const out: [string, string][] = [];
  for (let i = 0; i < targets.length; i++) for (let j = i + 1; j < targets.length; j++) out.push([targets[i]!, targets[j]!]);
  return out;
}

/**
 * One pairwise read's rows, kept only when they link to both of the pair -
 * what `intersection_mode "all"` asks for - so a row the vendor answered with
 * one target's block missing never counts towards n >= 2 in the union.
 */
export function pairRows(rows: readonly GapDomain[], pair: readonly [string, string]): GapDomain[] {
  const want = pair.map(bareHost);
  return rows.filter((r) => want.every((t) => r.linksTo.map(bareHost).includes(t)));
}

/** Many reads' rows as one row per domain: the targets it links to, its best rank, its earliest first seen. */
export function unionRows(reads: readonly (readonly GapDomain[])[]): GapDomain[] {
  const by = new Map<string, GapDomain>();
  for (const rows of reads) {
    for (const r of rows) {
      const d = bareHost(r.domain);
      const had = by.get(d);
      if (!had) {
        by.set(d, { domain: d, linksTo: [...new Set(r.linksTo.map(bareHost))], rank: r.rank, firstSeen: r.firstSeen });
        continue;
      }
      had.linksTo = [...new Set([...had.linksTo, ...r.linksTo.map(bareHost)])];
      if (r.rank !== null) had.rank = Math.max(had.rank ?? 0, r.rank);
      if (r.firstSeen && (!had.firstSeen || r.firstSeen < had.firstSeen)) had.firstSeen = r.firstSeen;
    }
  }
  return [...by.values()];
}

/** The order the gap is shown in: links to more of the 3 first, then rank (high first; unread last), then name. */
export function byGap(a: GapDomain, b: GapDomain): number {
  return b.linksTo.length - a.linksTo.length || (b.rank ?? -1) - (a.rank ?? -1) || a.domain.localeCompare(b.domain);
}

/**
 * The gap as read: `rows`, n >= 2 of the compared sites, not the client, not
 * a compared site, not a placed domain, sorted; and `seen`, how many rows met
 * n >= 2 before those were taken out (what ListCount.read holds).
 */
export function gapRead(reads: readonly (readonly GapDomain[])[], p: { client: string; targets: readonly string[]; placed: Placed }): { rows: GapDomain[]; seen: number } {
  const client = bareHost(p.client);
  const targets = new Set(p.targets.map(bareHost));
  const met = unionRows(reads)
    .map((r) => ({ ...r, linksTo: r.linksTo.filter((t) => targets.has(t)) }))
    .filter((r) => r.linksTo.length >= GAP_MIN);
  const own = met.filter((r) => r.domain !== client && !r.domain.endsWith(`.${client}`) && !targets.has(r.domain));
  return { rows: excludePlacedDomains(own, p.placed).sort(byGap), seen: met.length };
}

/** The gap rows (gapRead's), for a page that draws them. */
export function gapRows(reads: readonly (readonly GapDomain[])[], p: { client: string; targets: readonly string[]; placed: Placed }): GapDomain[] {
  return gapRead(reads, p).rows;
}

/**
 * What one read or the pairwise reads say about how much there is: the rows
 * the vendor returned and its `total_count` for each. Capped when a total is
 * past its rows, or, with no total, when the rows reached the limit. The
 * total is the filtered read's own, or the largest pair's - the union is at
 * least that.
 */
export function listCount(reads: readonly { rows: number; total: number | null }[], seen: number, limit: number): ListCount {
  const capped = reads.some((r) => (r.total !== null ? r.total > r.rows : r.rows >= limit));
  const totals = reads.map((r) => r.total).filter((t): t is number => t !== null);
  return { read: seen, total: totals.length ? Math.max(...totals) : null, capped };
}

/**
 * The count beside a capped list (13 Oct 2026, review of DIY P10: "75 more
 * sites" was counted from the 100 rows read, when DataForSEO's own count of
 * the set ran to hundreds or thousands). Every row read: the rows left,
 * exactly. Rows left unread: DataForSEO's total less the rows the read showed
 * were taken out (placed domains, the client's, the compared sites'), never
 * below what is left of the rows read - "about" for the filtered read, whose
 * total is the set's own; "at least" for the pairwise reads, whose total is
 * one pair's; "at least" with no total. Every other client's placements in
 * the unread rows cannot be seen, which is why the capped count is never
 * worded as exact. Pure.
 */
export function gapCount(p: { kept: number; shown: number; count: ListCount; via: "filter" | "pairwise" }): { more: number; hedge: Hedge } {
  if (!p.count.capped) return { more: Math.max(0, p.kept - p.shown), hedge: "exact" };
  const dropped = Math.max(0, p.count.read - p.kept);
  const est = Math.max(p.kept, (p.count.total ?? 0) - dropped);
  const hedge: Hedge = p.count.total === null || p.via === "pairwise" ? "at_least" : "about";
  return { more: roughly(Math.max(0, est - p.shown), hedge), hedge };
}

/** An estimate as it is said: to the nearest 10 past 100, the nearest 100 past 1,000; a floor is rounded down, so it stays a floor. */
export function roughly(n: number, hedge: Hedge): number {
  if (hedge === "exact" || n < 100) return n;
  const step = n < 1000 ? 10 : 100;
  return hedge === "at_least" ? Math.floor(n / step) * step : Math.round(n / step) * step;
}

/** What the page shows of the gap: the top 25 (10 in the trial), and how many more. Counted after the subtraction. */
export function shownGap<T>(rows: readonly T[], client: { trial: boolean }): { shown: T[]; limit: number } {
  const limit = allowanceFor("gap_rows", client);
  return { shown: rows.slice(0, limit), limit };
}

/** "Links to 2 of 3" - of the compared sites, by name in the row's title. */
export function linksToWords(r: Pick<GapDomain, "linksTo">, of: number): string {
  return `links to ${r.linksTo.length} of ${of}`;
}
