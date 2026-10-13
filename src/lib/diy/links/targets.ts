import { allowanceFor } from "../core/allowances.ts";
import { urlKey } from "../../tracking/placements.ts";

import { type Placed, bareHost, isPlacedUrl, onPlacedDomain } from "./nomada-placements.ts";
import type { GapPage } from "./types.ts";

/**
 * Link targets by page, and the reveal (13 Oct 2026, DIY P10; spec 10
 * sections 2.4, 2.5, 4.8 row 4 and 6.3). Pure.
 *
 * The pages kept link to at least one of the 3 compared sites from inside an
 * article, with a followed link, and not to the client (the request asks for
 * exactly that and the parser keeps only such links). Pages on the client's
 * own site or a compared site's are dropped, and so is every page on a
 * domain where Nomada has placed another client, and every placed page -
 * before anything is revealed or counted.
 *
 * Order: more of the 3 linked first, then DataForSEO's page rank (high
 * first), then the address. (The spec's first key, "this page ranks in
 * Google's top 10", is not in page_intersection's documented response, so it
 * is not used; see dataforseo-request.ts.)
 *
 * **The reveal** is the list closest to paid inventory, so it is capped:
 * "Show the next 5" reveals the next unrevealed pages in that order, as
 * many as this month's allowance has left (5, or 2 in the trial; allowances.ts
 * `link_targets`). Each revealed page is an `opportunities` row with lens
 * `link_page` and `revealed_at`, so it is kept across months and counted from
 * the table. A reveal is idempotent: the form carries how many pages were
 * revealed this month when it was drawn, and a post that does not match -
 * the same form sent twice - reveals nothing more.
 */

export const REVEAL_STEP = 5;

/** The order targets are revealed in. */
export function byTarget(a: GapPage, b: GapPage): number {
  return b.links.length - a.links.length || (b.pageRank ?? -1) - (a.pageRank ?? -1) || a.urlFrom.localeCompare(b.urlFrom);
}

/** A page's key, as `opportunities.url_key` holds it. */
export const pageKeyOf = (p: Pick<GapPage, "urlFrom">): string => urlKey(p.urlFrom) ?? p.urlFrom;

/** The target rows: followed in-article links to the compared sites, nothing on the client's, a compared site's or a placed domain; sorted. */
export function targetRows(rows: readonly GapPage[], p: { client: string; targets: readonly string[]; placed: Placed }): GapPage[] {
  const client = bareHost(p.client);
  const targets = new Set(p.targets.map(bareHost));
  const seen = new Set<string>();
  return rows
    .map((r) => ({ ...r, domain: bareHost(r.domain), links: r.links.filter((l) => targets.has(bareHost(l.target))) }))
    .filter((r) => r.links.length > 0)
    .filter((r) => r.domain !== client && !r.domain.endsWith(`.${client}`) && !targets.has(r.domain))
    .filter((r) => !onPlacedDomain(r.domain, p.placed) && !isPlacedUrl(r.urlFrom, p.placed))
    .filter((r) => {
      const k = pageKeyOf(r);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort(byTarget);
}

export type RevealPlan = { ok: true; pages: GapPage[] } | { ok: false; why: "cap" | "none" | "stale" };

/**
 * What one "Show the next 5" reveals: the next unrevealed pages in order, as
 * many as the month has left. `seen` is the month's count the form was drawn
 * with: a mismatch is a repeat or a stale form, and reveals nothing.
 */
export function planReveal(p: { rows: readonly GapPage[]; revealed: ReadonlySet<string>; usedThisMonth: number; seen: number | null; client: { trial: boolean } }): RevealPlan {
  if (p.seen === null || p.seen !== p.usedThisMonth) return { ok: false, why: "stale" };
  const left = Math.max(0, allowanceFor("link_targets", p.client) - p.usedThisMonth);
  if (left === 0) return { ok: false, why: "cap" };
  const next = p.rows.filter((r) => !p.revealed.has(pageKeyOf(r))).slice(0, Math.min(REVEAL_STEP, left));
  return next.length ? { ok: true, pages: next } : { ok: false, why: "none" };
}

/** The pages still unrevealed in this read: the "N more pages" count, after the subtraction. */
export function unrevealed(rows: readonly GapPage[], revealed: ReadonlySet<string>): number {
  return rows.filter((r) => !revealed.has(pageKeyOf(r))).length;
}
