import { INTENTS, type Intent, keywordForm } from "../../scan/dataforseo-request.ts";

import { type FootprintRow, type Pull, completePull } from "./footprint.ts";
import { commercial } from "./momentum.ts";
import { type Band, inBand } from "./tracked.ts";

/**
 * The Google page's "All ranking keywords" view (13 Oct 2026, DIY P6; spec
 * 10 section 4.3, `?view=all`): every keyword the latest footprint pull
 * holds, a DataForSEO estimate labelled with its read date. Pure.
 *
 * No difficulty column, and no difficulty figure anywhere: DataForSEO's
 * keyword_difficulty is a vendor 0-100 score, which spec 2.3 rules out, and
 * the parser never reads it. The change is against our own previous pull;
 * with one pull only, against DataForSEO's own previous reading, said so.
 *
 * Positions are organic (rank_group), as the Tracked view's are, so page 1 and
 * the bands mean the same on both views. Against our previous pull the change
 * is in organic places; against DataForSEO's reading it is rank_absolute
 * against its previous_rank_absolute, as that reading is. A keyword missing
 * from a previous pull that was cut at its row limit has no change and is not
 * called new: it may only have been below the cut (13 Oct 2026, review of the
 * P6 handoff).
 */

export const PAGE_ROWS = 100;
export const MAX_PAGE = 50;

export type RankingRow = {
  keyword: string;
  position: number | null;
  /** Places gained since the previous reading (a positive is up); null when either side has no position. */
  change: number | null;
  /** Not in the previous reading. */
  isNew: boolean;
  volume: number | null;
  etv: number | null;
  intent: Intent | null;
  url: string | null;
  /** The client already tracks it. */
  tracked: boolean;
};

export type RankingSort = "keyword" | "position" | "change" | "volume" | "etv";
export const RANKING_SORTS: readonly RankingSort[] = ["keyword", "position", "change", "volume", "etv"];

/** Every row of the latest pull, each with its change since the previous one. */
export function rankingRows(latest: Pull, previous: Pull | null, tracked: ReadonlySet<string>): RankingRow[] {
  const prev = previous ? new Map(previous.rows.map((r) => [keywordForm(r.k), r.p] as const)) : null;
  const complete = previous ? completePull(previous) : false;
  return latest.rows.map((r: FootprintRow) => {
    const key = keywordForm(r.k);
    let change: number | null = null;
    let isNew = false;
    if (prev) {
      const before = prev.get(key) ?? null;
      if (before !== null && r.p !== null) change = before - r.p;
      isNew = !prev.has(key) && complete;
    } else {
      if (r.pr !== undefined && r.pr !== null && r.a !== undefined && r.a !== null) change = r.pr - r.a;
      isNew = (r.pr === undefined || r.pr === null) && r.n === true;
    }
    return {
      keyword: r.k,
      position: r.p,
      change,
      isNew,
      volume: r.v,
      etv: r.e,
      intent: r.i,
      url: r.u,
      tracked: tracked.has(key),
    };
  });
}

export type RankingFilter = { q: string; intent: Intent | null; band: Band | null };

export function filterRanking(rows: readonly RankingRow[], f: RankingFilter): RankingRow[] {
  const q = f.q.trim().toLowerCase();
  return rows.filter((r) => (!q || r.keyword.includes(q) || (r.url ?? "").toLowerCase().includes(q)) && (!f.intent || r.intent === f.intent) && (!f.band || inBand(r.position, f.band)));
}

export function sortRanking(rows: readonly RankingRow[], sort: RankingSort, dir: "asc" | "desc"): RankingRow[] {
  const sign = dir === "asc" ? 1 : -1;
  const val = (r: RankingRow): number | string | null => (sort === "keyword" ? r.keyword : sort === "position" ? r.position : sort === "change" ? r.change : sort === "volume" ? r.volume : r.etv);
  return [...rows].sort((a, b) => {
    const x = val(a);
    const y = val(b);
    if (x === null && y === null) return a.keyword.localeCompare(b.keyword);
    if (x === null) return 1;
    if (y === null) return -1;
    const c = typeof x === "string" ? x.localeCompare(String(y)) : x - (y as number);
    return c * sign || a.keyword.localeCompare(b.keyword);
  });
}

/** One page of PAGE_ROWS, the page clamped to what exists. */
export function pageOf<T>(rows: readonly T[], page: number): { rows: T[]; page: number; pages: number } {
  const pages = Math.max(1, Math.min(MAX_PAGE, Math.ceil(rows.length / PAGE_ROWS)));
  const at = Math.min(Math.max(1, page), pages);
  return { rows: rows.slice((at - 1) * PAGE_ROWS, at * PAGE_ROWS), page: at, pages };
}

export type RankingKpis = {
  /** Every keyword Labs holds for the domain (`total_count`), which can be more than the rows read. */
  total: number;
  /** Rows read in this pull. */
  read: number;
  /** Of the rows read, on Google's page 1. */
  page1: number;
  /** Of the rows read with an intent, commercial or transactional. */
  commercial: { n: number; of: number };
  /** Estimated monthly traffic across the domain, as Labs totals it; null when it gave none. */
  etv: number | null;
};

export function rankingKpis(latest: Pull): RankingKpis {
  const withIntent = latest.rows.filter((r) => r.i !== null);
  return {
    total: latest.total ?? latest.rows.length,
    read: latest.rows.length,
    page1: latest.rows.filter((r) => r.p !== null && r.p <= 10).length,
    commercial: { n: withIntent.filter(commercial).length, of: withIntent.length },
    etv: latest.etv,
  };
}

export const isIntent = (v: unknown): v is Intent => (INTENTS as readonly string[]).includes(String(v));
