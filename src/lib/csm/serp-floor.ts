/**
 * The DR a placement host must reach to have a chance of ranking for a cluster's keyword (phase 1, 5 Nov 2026; the
 * fatgrid skill's Workflow 5): the average DR of the current top three organic results, read off the top 20 the
 * daily tracking run already stores (tracking_serp.top) - so no Ahrefs pull is needed. A static floor is right for a
 * general inventory pull and wrong for a keyword: a DR 50 host will not move a SERP held by DR 75 sites.
 *
 * - The reading is the latest one that is not degraded (engines.ts serpFault): from 30 Oct 2026 DataForSEO served
 *   pages of google.com/goto links, and their "top three" is not the SERP.
 * - The client's own domain is left out: it is not a bar it has to clear. So are the social and user-generated
 *   platforms (NOT_A_HOST): a LinkedIn or Reddit result at DR 95+ is not a site a placement competes with, and on
 *   Common's 29 Oct reading uk.linkedin.com was second.
 * - Fewer than two DRs known among the top three is too little to set a floor on, so DEFAULT_DR_FLOOR stands, and the
 *   result says so - Kev sees whether a floor came from the SERP.
 *
 * Pure. Imports are relative and carry the extension, for the reason dataforseo-request.ts gives.
 */

import { DEFAULT_DR_FLOOR } from "../../config/csm.ts";
import { normalizeDomain } from "../scan/domain.ts";
import { type OrganicHit, serpFault } from "../scan/engines.ts";

export type TopRow = { run_date: string; top: { rank: number; domain: string; url?: string | null }[] | null };

export type DrFloor = {
  floor: number;
  source: "serp" | "default";
  /** The reading the floor was set from, and the top three it averaged (domain and DR, null where unknown). */
  readOn: string | null;
  used: { domain: string; dr: number | null }[];
};

/** The newest reading whose top 20 can be ranked on: present, and not a degraded page. */
export function latestUsableTop(rows: readonly TopRow[]): TopRow | null {
  const usable = rows.filter((r) => r.top?.length && serpFault(r.top.map((t) => ({ rank: t.rank, domain: t.domain, url: t.url ?? null })) as OrganicHit[]) === null);
  return usable.sort((a, b) => b.run_date.localeCompare(a.run_date))[0] ?? null;
}

/** Platforms whose results are not placement hosts: their DR would set a bar nobody buys against. */
export const NOT_A_HOST = ["linkedin.com", "reddit.com", "youtube.com", "facebook.com", "instagram.com", "x.com", "twitter.com", "tiktok.com", "pinterest.com", "quora.com", "medium.com", "wikipedia.org", "amazon.com", "amazon.co.uk", "github.com"];

const isPlatform = (d: string) => NOT_A_HOST.some((p) => d === p || d.endsWith(`.${p}`));

/** The top three organic hosts, the client's own, Google's own and the platforms left out, in rank order. */
export function topThree(row: TopRow, clientDomain: string): string[] {
  const own = normalizeDomain(clientDomain);
  const out: string[] = [];
  for (const t of [...(row.top ?? [])].sort((a, b) => a.rank - b.rank)) {
    const d = normalizeDomain(t.domain);
    if (!d || d === own || d.endsWith(`.${own}`) || /(^|\.)google\.[a-z.]+$/.test(d) || isPlatform(d) || out.includes(d)) continue;
    out.push(d);
    if (out.length === 3) break;
  }
  return out;
}

/** The floor from the top three's DRs (from Fatgrid, or any DR source keyed by bare domain). */
export function drFloor(rows: readonly TopRow[], clientDomain: string, drOf: ReadonlyMap<string, number | null>): DrFloor {
  const row = latestUsableTop(rows);
  if (!row) return { floor: DEFAULT_DR_FLOOR, source: "default", readOn: null, used: [] };
  const used = topThree(row, clientDomain).map((domain) => ({ domain, dr: drOf.get(domain) ?? null }));
  const known = used.map((u) => u.dr).filter((d): d is number => typeof d === "number" && Number.isFinite(d));
  if (known.length < 2) return { floor: DEFAULT_DR_FLOOR, source: "default", readOn: row.run_date, used };
  return { floor: Math.round(known.reduce((a, b) => a + b, 0) / known.length), source: "serp", readOn: row.run_date, used };
}
