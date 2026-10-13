import { type Day, type Range, UNRANKED_AS, addDays, daysIn, liveThroughout } from "../../tracking/figures.ts";
import { urlKey } from "../../tracking/placements.ts";

import type { Reading } from "./losing.ts";

/**
 * The Google page's Tracked view (13 Oct 2026, DIY P6; spec 10 section 4.3,
 * rows 1, 2 and 4): the client's tracked keywords as we read them on Google
 * every day. Pure. Positions are ours (tracking_serp), never an estimate.
 *
 * The measurement rules this keeps (spec 2.6):
 *
 * - a reading is a day the keyword was read; a row with no position is "not
 *   in the top 20" (a finding), a day with no row is "not measured" (rule 2);
 * - a keyword added in the range is compared only from its first reading,
 *   and a first reading alone is shown, never scored (rules 3 and 4);
 * - entering or leaving the top 20 is a move but not a measurable one: it is
 *   counted apart from the places gained or lost, and sorts past them (rule 7);
 * - "was" is like for like: the keywords tracked all of both periods (rule 11
 *   and figures.ts liveThroughout).
 */

export type Band = "top3" | "p1" | "p2" | "out";
export const BANDS: readonly Band[] = ["top3", "p1", "p2", "out"];
/** The band filter's words. Page 1 includes the top 3, as Google's page 1 does. */
export const BAND_LABEL: Record<Band, string> = { top3: "Top 3", p1: "Page 1", p2: "11th-20th", out: "Not in the top 20" };

/** Whether a position is in a band. Null (not in the top 20) is only `out`. */
export function inBand(position: number | null, band: Band): boolean {
  if (position === null) return band === "out";
  if (band === "top3") return position <= 3;
  if (band === "p1") return position <= 10;
  if (band === "p2") return position >= 11 && position <= 20;
  return position > 20;
}

export type UrlFlag =
  | { kind: "changed"; on: Day; from: string; to: string }
  /** Two or more of the client's pages held the position on different days; each with the days it held. */
  | { kind: "turns"; held: { url: string; days: number }[] };

/** Readings the sparkline, the URL flags and the best position look back over. */
export const LAST_READINGS = 28;

export type TrackedRow = {
  id: string;
  keyword: string;
  clusterId: string | null;
  volume: number | null;
  intent: string | null;
  added: Day;
  /** The first and the latest reading in the range. */
  from: Reading | null;
  to: Reading | null;
  /** Places gained from the first reading to the latest, both inside the top 20 (11th to 7th is +4). */
  change: number | null;
  /** Entered or left the top 20 between the two: a move, not a measurable one. */
  move: "entered" | "left" | null;
  /** Its best position in the range, and the first day it held it. */
  best: { position: number; day: Day } | null;
  /** The ranking page at its latest ranked reading. */
  url: string | null;
  urlFlag: UrlFlag | null;
  /** Its last LAST_READINGS readings to the range's end, oldest first: positions, null for not in the top 20. */
  spark: (number | null)[];
  /** A first reading only: shown, not scored. */
  firstOnly: boolean;
  /** The client's latest check day, when this keyword was not read on it. */
  notReadOn: Day | null;
};

type SerpIn = { run_date: Day; keyword_id: string; position: number | null };
type KeywordIn = { id: string; keyword: string; added_on: Day; stopped_on: Day | null; search_volume: number | null; intent: string | null };

/** Every reading of every keyword, oldest first, with its URL where one was read. */
export function readingsByKeyword(serp: readonly SerpIn[], urls: ReadonlyMap<string, string | null>): Map<string, Reading[]> {
  const by = new Map<string, Map<Day, Reading>>();
  for (const s of serp) {
    const m = by.get(s.keyword_id) ?? new Map<Day, Reading>();
    m.set(s.run_date, { day: s.run_date, position: s.position, url: s.position === null ? null : (urls.get(urlAt(s.keyword_id, s.run_date)) ?? null) });
    by.set(s.keyword_id, m);
  }
  return new Map([...by].map(([k, m]) => [k, [...m.values()].sort((a, b) => a.day.localeCompare(b.day))]));
}

/** The key a keyword's URL on one day is held under. */
export const urlAt = (keywordId: string, day: Day) => `${keywordId} ${day}`;

/** "URL changed" once, or two of the client's pages taking turns, over the ranked readings given (oldest first). */
export function urlFlag(readings: readonly Reading[]): UrlFlag | null {
  const ranked = readings.filter((r) => r.position !== null && r.url);
  if (ranked.length < 2) return null;
  const keyOf = (u: string) => urlKey(u) ?? u;
  let switches = 0;
  let on: Day | null = null;
  for (let i = 1; i < ranked.length; i++) {
    if (keyOf(ranked[i]!.url!) !== keyOf(ranked[i - 1]!.url!)) {
      switches++;
      on = ranked[i]!.day;
    }
  }
  if (switches === 0) return null;
  if (switches === 1) return { kind: "changed", on: on!, from: ranked[0]!.url!, to: ranked[ranked.length - 1]!.url! };
  const held = new Map<string, { url: string; days: number }>();
  for (const r of ranked) {
    const k = keyOf(r.url!);
    const h = held.get(k) ?? { url: r.url!, days: 0 };
    h.days++;
    held.set(k, h);
  }
  return { kind: "turns", held: [...held.values()].sort((a, b) => b.days - a.days || a.url.localeCompare(b.url)) };
}

const within = (d: Day, r: Range) => d >= r.from && d <= r.to;

/** The keywords tracked at some point in the range: added by its end, not stopped before its start (figures.ts keywordsIn). */
export function inRange<T extends { added_on: Day; stopped_on: Day | null }>(keywords: readonly T[], range: Range): T[] {
  return keywords.filter((k) => k.added_on <= range.to && (k.stopped_on === null || k.stopped_on > range.from));
}

export function trackedRows(p: { keywords: readonly KeywordIn[]; clusterOf: ReadonlyMap<string, string>; readings: ReadonlyMap<string, Reading[]>; range: Range }): TrackedRow[] {
  // The client's latest check day in the range: a keyword with no reading that day was not measured on it.
  let lastDay: Day | null = null;
  for (const rs of p.readings.values()) for (const r of rs) if (within(r.day, p.range) && (lastDay === null || r.day > lastDay)) lastDay = r.day;
  return inRange(p.keywords, p.range).map((k) => {
    const all = (p.readings.get(k.id) ?? []).filter((r) => r.day <= p.range.to);
    const inR = all.filter((r) => within(r.day, p.range));
    const from = inR[0] ?? null;
    const to = inR[inR.length - 1] ?? null;
    const both = from && to && from !== to;
    const change = both && from.position !== null && to.position !== null ? from.position - to.position : null;
    const move = both && (from.position === null) !== (to.position === null) ? (to.position === null ? "left" : "entered") : null;
    let best: TrackedRow["best"] = null;
    for (const r of inR) if (r.position !== null && (best === null || r.position < best.position)) best = { position: r.position, day: r.day };
    const last = all.slice(-LAST_READINGS);
    const ranked = [...last].reverse().find((r) => r.position !== null && r.url);
    const live = k.stopped_on === null || k.stopped_on > p.range.to;
    return {
      id: k.id,
      keyword: k.keyword,
      clusterId: p.clusterOf.get(k.id) ?? null,
      volume: k.search_volume,
      intent: k.intent,
      added: k.added_on,
      from,
      to,
      change,
      move,
      best,
      url: ranked?.url ?? null,
      urlFlag: urlFlag(last),
      spark: last.map((r) => r.position),
      firstOnly: inR.length === 1,
      notReadOn: live && lastDay !== null && to?.day !== lastDay && k.added_on <= lastDay ? lastDay : null,
    };
  });
}

export type TrackedSort = "keyword" | "position" | "change" | "volume" | "best";
export const TRACKED_SORTS: readonly TrackedSort[] = ["keyword", "position", "change", "volume", "best"];

/** The position a row sorts by: its latest, a keyword outside the top 20 as UNRANKED_AS, a keyword never read last. */
const sortPosition = (r: TrackedRow) => (r.to === null ? 999 : (r.to.position ?? UNRANKED_AS));

/** Measured changes by size; then the moves in or out of the top 20 (rule 7: they sort past every measured move); then no change. */
const sortChange = (r: TrackedRow) => (r.change !== null ? r.change : r.move === "entered" ? 1000 : r.move === "left" ? -1000 : null);

export function sortTracked(rows: readonly TrackedRow[], sort: TrackedSort, dir: "asc" | "desc"): TrackedRow[] {
  const sign = dir === "asc" ? 1 : -1;
  const val = (r: TrackedRow): number | string | null =>
    sort === "keyword" ? r.keyword : sort === "position" ? sortPosition(r) : sort === "change" ? sortChange(r) : sort === "volume" ? r.volume : (r.best?.position ?? null);
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

export type TrackedFilter = { band: Band | null; cluster: string | null; q: string };

export function filterTracked(rows: readonly TrackedRow[], f: TrackedFilter): TrackedRow[] {
  const q = f.q.trim().toLowerCase();
  return rows.filter((r) => (!f.band || (r.to !== null && inBand(r.to.position, f.band))) && (!f.cluster || r.clusterId === f.cluster) && (!q || r.keyword.toLowerCase().includes(q)));
}

export type Count = { n: number; of: number };

export type TrackedKpis = {
  /** Keywords tracked in the range with at least one reading: the denominator. */
  of: number;
  top3: Count;
  page1: Count;
  /** Like for like, on the keywords tracked all of both periods; null without a comparison. */
  was: { keywords: number; top3: Count; page1: Count; top3Now: number; page1Now: number; on: Day } | null;
  improved: number;
  slipped: number;
  entered: number;
  left: number;
  /** Days with a reading in the range, and how many of them were partial or failed checks. */
  readings: number;
  partial: number;
  /** Keywords added inside the range, each compared from its own first reading. */
  late: number;
};

/** The latest reading of a keyword within a range, or null when it was not read in it. */
function latestIn(readings: readonly Reading[] | undefined, r: Range): Reading | null {
  let out: Reading | null = null;
  for (const x of readings ?? []) if (within(x.day, r) && (out === null || x.day > out.day)) out = x;
  return out;
}

export function trackedKpis(p: {
  rows: readonly TrackedRow[];
  keywords: readonly KeywordIn[];
  readings: ReadonlyMap<string, Reading[]>;
  range: Range;
  compare: Range | null;
  runs: readonly { run_date: Day; status: string }[];
}): TrackedKpis {
  const read = p.rows.filter((r) => r.to !== null);
  const at = (rows: readonly (Reading | null)[], n: number) => rows.filter((r) => r !== null && r.position !== null && r.position <= n).length;
  const tos = read.map((r) => r.to);
  let was: TrackedKpis["was"] = null;
  if (p.compare) {
    const c = p.compare;
    const lfl = p.keywords.filter((k) => liveThroughout(k, { from: c.from, to: p.range.to }));
    const before = lfl.map((k) => latestIn(p.readings.get(k.id), c));
    const now = lfl.map((k) => latestIn(p.readings.get(k.id), p.range));
    const readBoth = lfl.filter((_, i) => before[i] !== null && now[i] !== null).length;
    if (readBoth > 0) {
      const b = before.filter((_, i) => now[i] !== null && before[i] !== null);
      const n = now.filter((_, i) => now[i] !== null && before[i] !== null);
      was = { keywords: readBoth, top3: { n: at(b, 3), of: readBoth }, page1: { n: at(b, 10), of: readBoth }, top3Now: at(n, 3), page1Now: at(n, 10), on: c.to };
    }
  }
  const days = new Set<Day>();
  for (const rs of p.readings.values()) for (const r of rs) if (within(r.day, p.range)) days.add(r.day);
  const partial = new Set(p.runs.filter((r) => within(r.run_date, p.range) && (r.status === "partial" || r.status === "failed")).map((r) => r.run_date));
  return {
    of: read.length,
    top3: { n: at(tos, 3), of: read.length },
    page1: { n: at(tos, 10), of: read.length },
    was,
    improved: read.filter((r) => r.change !== null && r.change > 0).length,
    slipped: read.filter((r) => r.change !== null && r.change < 0).length,
    entered: read.filter((r) => r.move === "entered").length,
    left: read.filter((r) => r.move === "left").length,
    readings: days.size,
    partial: partial.size,
    late: p.rows.filter((r) => r.added > p.range.from).length,
  };
}

export type BandPoint = { d: Day; b3: number; b10: number; b20: number; out: number };

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

function bandCount(positions: readonly number[]): Omit<BandPoint, "d"> {
  const out = { b3: 0, b10: 0, b20: 0, out: 0 };
  for (const p of positions) {
    if (p <= 3) out.b3++;
    else if (p <= 10) out.b10++;
    else if (p <= 20) out.b20++;
    else out.out++;
  }
  return out;
}

/**
 * Position bands over time (spec 4.3 row 2): top 3, 4-10, 11-20 and not in
 * the top 20, counting each tracked keyword once a point. A point is a week:
 * the median of the keyword's readings that week, a reading outside the top
 * 20 counted as UNRANKED_AS. The last point is each keyword's latest reading
 * in the range instead, so it agrees with the figures above it. A week in
 * which a keyword was not read leaves it out of that point.
 */
export function positionBands(p: { readings: ReadonlyMap<string, Reading[]>; ids: ReadonlySet<string>; range: Range }): BandPoint[] {
  const days = daysIn(p.range);
  if (!days.length) return [];
  const ends: Day[] = [];
  for (let end = p.range.to; end >= p.range.from; end = addDays(end, -7)) ends.unshift(end);
  const points: BandPoint[] = [];
  ends.forEach((end, i) => {
    const last = i === ends.length - 1;
    const start = addDays(end, -6);
    const block: Range = { from: start > p.range.from ? start : p.range.from, to: end };
    const positions: number[] = [];
    for (const id of p.ids) {
      const rs = (p.readings.get(id) ?? []).filter((r) => within(r.day, last ? p.range : block));
      if (!rs.length) continue;
      positions.push(last ? (rs[rs.length - 1]!.position ?? UNRANKED_AS) : median(rs.map((r) => r.position ?? UNRANKED_AS)));
    }
    if (positions.length) points.push({ d: end, ...bandCount(positions) });
  });
  return points;
}
