import { type Intent, keywordForm } from "../../scan/dataforseo-request.ts";
import { type Day, addDays } from "../../tracking/figures.ts";
import { type Subject, namesBrandIn } from "../../tracking/limits.ts";
import { formatDate } from "../../format-date.ts";
import { ordinal } from "../plan/words.ts";

import { type FootprintRow, type Pull, completePull } from "./footprint.ts";

/**
 * Keyword momentum (13 Oct 2026, DIY P6; spec 10 section 6.6): Nomada's rule
 * (build_client.py:220-238), kept, with the three fixes research note 01
 * section 7 records. Pure; it runs whenever the Google page, Clusters, Setup
 * or the Plan's candidates read it, on the two newest stored pulls - never a
 * read of its own.
 *
 *   for each row r in the latest pull with r.position <= 30:
 *     skip if r is tracked (live, or stopped within 30 days), dismissed, or names the brand
 *     skip unless intent=all or r.intent is commercial or transactional   (fix 1)
 *     skip if r.volume < 10
 *     prev = our previous pull's position of r (null when absent there),
 *            or, with one pull only, DataForSEO's own previous reading      (fix 2)
 *     new:      prev is null and r.position <= 20   gain = 101 - r.position
 *     climbing: prev - r.position >= 5              gain = prev - r.position
 *     else skip
 *     key = gain * max(10, r.volume)
 *   keep the top 15 by key, with their volume, intent and URL carried       (fix 3)
 *
 * Positions are organic (`p`, rank_group), as every DIY page shows them, and
 * our two pulls are compared on that basis. DataForSEO's own previous reading
 * is a rank_absolute, so a row compared with it uses the row's rank_absolute
 * (`a`) for the climb and says the climb is in places on the results page,
 * with that reading's date (13 Oct 2026, review of the P6 handoff).
 *
 * A keyword missing from our previous pull is "new" only when that pull was
 * complete. Each pull is the top 1000 rows by estimated traffic, so for a
 * bigger site a missing keyword may only have been below the cut: such a row
 * is compared with DataForSEO's own previous reading instead, and is new only
 * when DataForSEO says its earlier results did not hold the site (`is_new`),
 * never from absence alone (review of the P6 handoff, 13 Oct 2026).
 *
 * The order key is an order, never a figure: it is not returned, and no page
 * shows it (spec 2.6, "no new figure definitions"). Ties go to volume, then
 * the better position, then the keyword, so the list is the same every time.
 */

/** The rule's numbers, as Nomada's rule has them. */
export const MOMENTUM = {
  /** Rows deeper than this are not read. */
  depth: 30,
  /** A new keyword must have arrived at or above this. */
  newDepth: 20,
  /** A climb of fewer places is not a climb. */
  climb: 5,
  /** Less search volume than this is not shown. */
  minVolume: 10,
  /** The volume floor in the order key, so a tiny keyword's climb still orders. */
  keyFloor: 10,
  /** A keyword stopped this recently still counts as tracked. */
  stoppedDays: 30,
  /** Rows kept. */
  top: 15,
} as const;

const COMMERCIAL: ReadonlySet<string> = new Set(["commercial", "transactional"]);

/** What a row is compared with: our previous pull (organic positions), or DataForSEO's own previous reading (places on the results page). */
export type Basis = "ours" | "dataforseo";

export type Gaining = {
  keyword: string;
  /** Organic position, rank_group. */
  position: number;
  /** The reading it is compared with: our previous pull's organic position, or DataForSEO's previous rank_absolute; null for a new one. */
  previous: number | null;
  kind: "new" | "climbing";
  /** Places gained, for a climb: organic places on our basis, places on the results page on DataForSEO's. */
  gain: number;
  basis: Basis;
  /** The compared reading's day: our previous pull's, or DataForSEO's previous_updated_time; null when unknown. */
  since: Day | null;
  volume: number | null;
  intent: Intent | null;
  /** The ranking page's path, as Labs gives it. */
  url: string | null;
  etv: number | null;
};

export type Momentum = {
  /** At most MOMENTUM.top, in the rule's order. */
  rows: Gaining[];
  /** Every keyword the rule kept, before the top 15. */
  total: number;
  climbing: number;
  new: number;
  /** Search volume across every kept keyword, a DataForSEO estimate. */
  volume: number;
  /** "ours": there is a previous pull of ours. "dataforseo": one pull only, every row compared with DataForSEO's own previous reading. */
  basis: Basis;
  /** With a previous pull, the kept rows compared with DataForSEO's reading instead (absent from a pull cut at its row limit). */
  fallback: number;
  /** Our previous pull's day, when there is one. */
  previousOn: Day | null;
  /** Our previous pull's rows read, and whether it held every keyword Labs had. */
  previousRows: number;
  previousComplete: boolean;
  /** The latest pull's day: its "read <date>" label. */
  readOn: Day;
};

export type MomentumInput = {
  latest: Pull;
  previous: Pull | null;
  /** Every tracked keyword row of the client, live or stopped. */
  tracked: readonly { keyword: string; stopped_on: Day | null }[];
  /** Live gaining-keyword dismissals, as their keys. */
  dismissed: ReadonlySet<string>;
  subject: Subject;
  /** `?intent=all`: every intent, not only commercial and transactional. */
  showAll: boolean;
  today: Day;
};

/** The keywords the rule leaves out because the client tracks them: live, or stopped within MOMENTUM.stoppedDays. */
export function trackedSet(tracked: MomentumInput["tracked"], today: Day): Set<string> {
  const since = addDays(today, -MOMENTUM.stoppedDays);
  return new Set(tracked.filter((k) => k.stopped_on === null || k.stopped_on >= since).map((k) => keywordForm(k.keyword)));
}

/** Whether a footprint row passes the intent rule: commercial or transactional, unless every intent is asked for. */
export const commercial = (r: Pick<FootprintRow, "i">): boolean => r.i !== null && COMMERCIAL.has(r.i);

/** The order: key, then volume, then position, then keyword. */
function byKey(a: Gaining & { key: number }, b: Gaining & { key: number }): number {
  return b.key - a.key || (b.volume ?? 0) - (a.volume ?? 0) || a.position - b.position || a.keyword.localeCompare(b.keyword);
}

/** What one row is compared with, or null when nothing it can honestly be compared with says it gained. */
function compare(r: FootprintRow & { p: number }, prevAt: ReadonlyMap<string, number | null> | null, complete: boolean, previousOn: Day | null): Pick<Gaining, "previous" | "kind" | "gain" | "basis" | "since"> | null {
  const key = keywordForm(r.k);
  if (prevAt && (prevAt.has(key) || complete)) {
    // Our own two pulls, organic on both sides.
    const prev = prevAt.get(key) ?? null;
    if (prevAt.has(key) && prev === null) return null; // in the pull, position unread: unknown, not new
    if (prev === null) return r.p <= MOMENTUM.newDepth ? { previous: null, kind: "new", gain: 101 - r.p, basis: "ours", since: previousOn } : null;
    return prev - r.p >= MOMENTUM.climb ? { previous: prev, kind: "climbing", gain: prev - r.p, basis: "ours", since: previousOn } : null;
  }
  // DataForSEO's own previous reading: rank_absolute against rank_absolute.
  const since = r.pd ?? null;
  if (r.pr !== undefined && r.pr !== null) {
    if (r.a === undefined || r.a === null) return null;
    return r.pr - r.a >= MOMENTUM.climb ? { previous: r.pr, kind: "climbing", gain: r.pr - r.a, basis: "dataforseo", since } : null;
  }
  return r.n === true && r.p <= MOMENTUM.newDepth ? { previous: null, kind: "new", gain: 101 - r.p, basis: "dataforseo", since } : null;
}

export function momentum(input: MomentumInput): Momentum {
  const tracked = trackedSet(input.tracked, input.today);
  const dismissed = new Set([...input.dismissed].map(keywordForm));
  const prev = input.previous;
  const prevAt = prev ? new Map(prev.rows.map((r) => [keywordForm(r.k), r.p] as const)) : null;
  const complete = prev ? completePull(prev) : false;
  const kept: (Gaining & { key: number })[] = [];
  for (const r of input.latest.rows) {
    if (r.p === null || r.p < 1 || r.p > MOMENTUM.depth) continue;
    const key = keywordForm(r.k);
    if (tracked.has(key) || dismissed.has(key) || namesBrandIn(r.k, input.subject)) continue;
    if (!input.showAll && !commercial(r)) continue;
    if ((r.v ?? 0) < MOMENTUM.minVolume) continue;
    const c = compare({ ...r, p: r.p }, prevAt, complete, prev?.pulledOn ?? null);
    if (!c) continue;
    kept.push({ keyword: r.k, position: r.p, ...c, volume: r.v, intent: r.i, url: r.u, etv: r.e, key: c.gain * Math.max(MOMENTUM.keyFloor, r.v ?? 0) });
  }
  kept.sort(byKey);
  return {
    rows: kept.slice(0, MOMENTUM.top).map(({ key: _key, ...g }) => g),
    total: kept.length,
    climbing: kept.filter((g) => g.kind === "climbing").length,
    new: kept.filter((g) => g.kind === "new").length,
    volume: kept.reduce((s, g) => s + (g.volume ?? 0), 0),
    basis: prev ? "ours" : "dataforseo",
    fallback: prev ? kept.slice(0, MOMENTUM.top).filter((g) => g.basis === "dataforseo").length : 0,
    previousOn: prev?.pulledOn ?? null,
    previousRows: prev?.rows.length ?? 0,
    previousComplete: complete,
    readOn: input.latest.pulledOn,
  };
}

/** "DataForSEO's reading of 9 Sep", or "DataForSEO's previous reading" when its day is unknown. */
const theirs = (since: Day | null) => (since ? `DataForSEO's reading of ${formatDate(since)}` : "DataForSEO's previous reading");

/**
 * "Up from 18th to 7th" or "New at 12th", against our previous pull. Against
 * DataForSEO's own reading the climb is counted in places on the results page
 * (rank_absolute, as that reading is) and the position shown is the organic
 * one, each said: "Up 7 places on the results page since DataForSEO's reading
 * of 9 Sep; now 6th", or "New at 12th since DataForSEO's reading of 9 Sep".
 */
export function gainingLabel(g: Pick<Gaining, "kind" | "position" | "previous" | "gain" | "basis" | "since">): string {
  if (g.basis === "ours") return g.kind === "new" ? `New at ${ordinal(g.position)}` : `Up from ${ordinal(g.previous!)} to ${ordinal(g.position)}`;
  if (g.kind === "new") return `New at ${ordinal(g.position)} since ${theirs(g.since)}`;
  return `Up ${g.gain} ${g.gain === 1 ? "place" : "places"} on the results page since ${theirs(g.since)}; now ${ordinal(g.position)}`;
}

/** The block's one line: "7 untracked keywords gaining ground: 4 climbing, 3 new, 2,900 searches a month between them." */
export function gainingSummary(m: Pick<Momentum, "total" | "climbing" | "new" | "volume">, showAll = true): string {
  if (!m.total) return showAll ? "No untracked keyword is gaining ground in this pull." : "No untracked keyword with a buying intent is gaining ground in this pull.";
  const parts = [m.climbing ? `${m.climbing} climbing` : null, m.new ? `${m.new} new` : null].filter(Boolean).join(", ");
  const vol = m.volume ? `, ${m.volume.toLocaleString("en-GB")} searches a month between them` : "";
  return `${m.total} untracked ${m.total === 1 ? "keyword" : "keywords"} gaining ground: ${parts}${vol}.`;
}
