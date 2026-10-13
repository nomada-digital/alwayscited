import { INTENTS, type Intent } from "../../scan/dataforseo-request.ts";

import { RANKING_SORTS, type RankingSort, MAX_PAGE } from "./ranking.ts";
import { BANDS, type Band, TRACKED_SORTS, type TrackedSort } from "./tracked.ts";

/**
 * The Google page's query keys (13 Oct 2026, DIY P6; spec 10 section 3.5),
 * each read against its own bound, so a page may read only these and a
 * malformed one is ignored rather than trusted:
 *
 * - range keys `from`, `to`, `compare` (overview-data.ts rangeFrom);
 * - `view`: `tracked` (the default) or `all`;
 * - `gaining`: `1` expands the gaining-ground block;
 * - `cluster`: one of this client's cluster ids (the page checks it against its own);
 * - `band`: `top3`, `p1`, `p2` or `out`;
 * - `intent`: one of DataForSEO's four, or `all` (gaining ground: every intent);
 * - `q`: at most APP_LIMITS.search (120) characters;
 * - `sort` and `dir`: from each view's fixed list;
 * - `page`: a whole number 1-50;
 * - `row`: one of this client's tracked keyword ids (the page checks it);
 * - `done` and `why`: the keywords route's toast codes, each from a fixed map,
 *   never echoed - added beside section 3.5's list because every write page
 *   answers a JS-off post with a 303 and a toast (section 3.6). Recorded for
 *   the wave 2 shell's client-pages registry.
 *
 * `readGoogleKept` is the same reading for the keywords route, so a dismiss
 * comes back to the view it was posted from.
 */

export type View = "tracked" | "all";
export type IntentKey = Intent | "all";

const ID = /^[0-9A-Za-z_-]{1,64}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export const pickView = (v: string | null): View => (v === "all" ? "all" : "tracked");
export const pickBand = (v: string | null): Band | null => ((BANDS as readonly string[]).includes(String(v)) ? (v as Band) : null);
export const pickIntent = (v: string | null): IntentKey | null => (v === "all" ? "all" : (INTENTS as readonly string[]).includes(String(v)) ? (v as Intent) : null);
export const pickDir = (v: string | null): "asc" | "desc" | null => (v === "asc" || v === "desc" ? v : null);
export const pickId = (v: string | null): string | null => (v !== null && ID.test(v) ? v : null);

export function pickPage(v: string | null): number {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= MAX_PAGE ? n : 1;
}

/** A sort from either view's list, as the URL carries it; each view reads its own from it. */
export function pickSort(v: string | null): string | null {
  return v !== null && ((TRACKED_SORTS as readonly string[]).includes(v) || (RANKING_SORTS as readonly string[]).includes(v)) ? v : null;
}

export function pickTrackedSort(v: string | null): TrackedSort {
  return (TRACKED_SORTS as readonly string[]).includes(String(v)) ? (v as TrackedSort) : "position";
}

export function pickRankingSort(v: string | null): RankingSort {
  return (RANKING_SORTS as readonly string[]).includes(String(v)) ? (v as RankingSort) : "etv";
}

/** The page's view state as the keywords route carries it back: each key to its own bound. */
export function readGoogleKept(get: (k: string) => string | null, search: number): Record<string, string> {
  const out: Record<string, string> = {};
  const set = (k: string, v: string | null) => {
    if (v !== null && v !== "") out[k] = v;
  };
  const from = get("from");
  const to = get("to");
  if (from && to && DAY.test(from) && DAY.test(to)) {
    out.from = from;
    out.to = to;
  }
  const compare = get("compare");
  if (compare === "none" || compare === "month") out.compare = compare;
  if (get("view") === "all") out.view = "all";
  if (get("gaining") === "1") out.gaining = "1";
  set("cluster", pickId(get("cluster")));
  set("band", pickBand(get("band")));
  set("intent", pickIntent(get("intent")));
  const q = get("q");
  if (q) out.q = q.slice(0, search);
  const sort = get("sort");
  if (sort && ((TRACKED_SORTS as readonly string[]).includes(sort) || (RANKING_SORTS as readonly string[]).includes(sort))) out.sort = sort;
  set("dir", pickDir(get("dir")));
  const page = pickPage(get("page"));
  if (page > 1) out.page = String(page);
  return out;
}
