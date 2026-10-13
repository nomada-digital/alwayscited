import { allowanceFor } from "../core/allowances.ts";

import { type Placed, bareHost, onPlacedDomain } from "./nomada-placements.ts";
import type { GapDomain } from "./types.ts";

/**
 * The link gap by domain (13 Oct 2026, DIY P10; spec 10 sections 4.8 row 3
 * and 6.3): referring domains that link to at least 2 of the 3 compared
 * sites and not to the client, followed links only. Pure.
 *
 * - **From the filter**: one `partial` read over the 3 with
 *   `intersections_count >= 2` (when the stored filter names carry it).
 * - **From the pairwise fallback**: one `all` read per pair of the 3, their
 *   union - a domain in any pair's answer links to both of that pair, so the
 *   union is the n >= 2 set exactly, and its "links to n of 3" is the union of
 *   the pairs it was found in.
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

/** Many reads' rows as one row per domain: the targets it links to, its best rank, its earliest first seen, a platform. */
export function unionRows(reads: readonly (readonly GapDomain[])[]): GapDomain[] {
  const by = new Map<string, GapDomain>();
  for (const rows of reads) {
    for (const r of rows) {
      const d = bareHost(r.domain);
      const had = by.get(d);
      if (!had) {
        by.set(d, { ...r, domain: d, linksTo: [...new Set(r.linksTo.map(bareHost))] });
        continue;
      }
      had.linksTo = [...new Set([...had.linksTo, ...r.linksTo.map(bareHost)])];
      if (r.rank !== null) had.rank = Math.max(had.rank ?? 0, r.rank);
      if (r.firstSeen && (!had.firstSeen || r.firstSeen < had.firstSeen)) had.firstSeen = r.firstSeen;
      had.platform ??= r.platform;
    }
  }
  return [...by.values()];
}

/** The order the gap is shown in: links to more of the 3 first, then rank (high first; unread last), then name. */
export function byGap(a: GapDomain, b: GapDomain): number {
  return b.linksTo.length - a.linksTo.length || (b.rank ?? -1) - (a.rank ?? -1) || a.domain.localeCompare(b.domain);
}

/** The gap rows: n >= 2 of the compared sites, not the client, not a compared site, not a placed domain; sorted. */
export function gapRows(reads: readonly (readonly GapDomain[])[], p: { client: string; targets: readonly string[]; placed: Placed }): GapDomain[] {
  const client = bareHost(p.client);
  const targets = new Set(p.targets.map(bareHost));
  return unionRows(reads)
    .map((r) => ({ ...r, linksTo: r.linksTo.filter((t) => targets.has(t)) }))
    .filter((r) => r.linksTo.length >= GAP_MIN)
    .filter((r) => r.domain !== client && !r.domain.endsWith(`.${client}`) && !targets.has(r.domain))
    .filter((r) => !onPlacedDomain(r.domain, p.placed))
    .sort(byGap);
}

/** What the page shows of the gap: the top 25 (10 in the trial), and how many more. Counted after the subtraction. */
export function shownGap<T>(rows: readonly T[], client: { trial: boolean }): { shown: T[]; more: number; limit: number } {
  const limit = allowanceFor("gap_rows", client);
  return { shown: rows.slice(0, limit), more: Math.max(0, rows.length - limit), limit };
}

/** "Links to 2 of 3" - of the compared sites, by name in the row's title. */
export function linksToWords(r: Pick<GapDomain, "linksTo">, of: number): string {
  return `links to ${r.linksTo.length} of ${of}`;
}
