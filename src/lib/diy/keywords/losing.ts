import { type Day, UNRANKED_AS } from "../../tracking/figures.ts";
import { urlKey } from "../../tracking/placements.ts";

/**
 * Losing ground (13 Oct 2026, DIY P6; spec 10 section 4.3 row 6): tracked
 * keywords that fell 5 or more places and now sit outside Google's top 20,
 * held over 2 of the keyword's last 3 readings. Pure; read by us
 * (tracking_serp), never a vendor estimate.
 *
 * Readings, not days (spec 2.6 rules 1 and 10): a reading is a day the
 * keyword was actually read. A row with no position is a reading - "not in
 * the top 20", a finding - and a day with no row is not a reading at all, so
 * a partial day hides nothing and invents nothing.
 *
 * "Fell 5 or more places" when the keyword now sits outside the top 20: we
 * read Google to position 20, so a keyword that left it is somewhere from 21
 * down, and leaving the top 20 is a move but not a measurable one (spec 2.6
 * rule 7). The fall is therefore counted from its last place inside the top
 * 20 to UNRANKED_AS (21), the shallowest it can now be: a keyword that was
 * 16th or better has fallen at least 5. One that was 17th to 20th may have
 * fallen as far, but we cannot say so, and it is not listed. The copy says
 * where it was and that it is now outside the top 20 - never a number of
 * places it fell.
 */

/** Places fallen, counted to UNRANKED_AS, for a keyword to be losing ground. */
export const LOSING_FALL = 5;
/** Of the keyword's last LOSING_OF readings, at least LOSING_HELD outside the top 20, the latest among them. */
export const LOSING_HELD = 2;
export const LOSING_OF = 3;
/** How far back its last place inside the top 20 is looked for. */
export const LOSING_LOOKBACK = 28;

export type Reading = { day: Day; position: number | null; url: string | null };

export type Losing = {
  keywordId: string;
  keyword: string;
  clusterId: string | null;
  /** Its last reading inside the top 20. */
  was: { position: number; day: Day; url: string | null };
  /** Readings outside the top 20 of its last LOSING_OF. */
  out: number;
  /** The latest reading's day. */
  latest: Day;
  /** The page that was ranking, as Your pages keys it (`/pages?url=`); null when no URL was read. */
  pageKey: string | null;
};

/**
 * One keyword's readings, oldest first, on or before `to`: each day it has a
 * row once, the last row of a day winning.
 */
export function readingsOf(rows: readonly { run_date: Day; keyword_id: string; position: number | null; url?: string | null }[], keywordId: string, to: Day): Reading[] {
  const byDay = new Map<Day, Reading>();
  for (const r of rows) if (r.keyword_id === keywordId && r.run_date <= to) byDay.set(r.run_date, { day: r.run_date, position: r.position, url: r.url ?? null });
  return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
}

/** Whether one keyword's readings (oldest first) are losing ground, and from where. */
export function losingFrom(readings: readonly Reading[]): Pick<Losing, "was" | "out" | "latest"> | null {
  if (readings.length < LOSING_OF) return null;
  const last = readings.slice(-LOSING_OF);
  const latest = last[last.length - 1]!;
  const out = last.filter((r) => r.position === null).length;
  if (latest.position !== null || out < LOSING_HELD) return null;
  const window = readings.slice(-LOSING_LOOKBACK);
  const before = [...window].reverse().find((r) => r.position !== null);
  if (!before || before.position === null) return null;
  if (UNRANKED_AS - before.position < LOSING_FALL) return null;
  return { was: { position: before.position, day: before.day, url: before.url }, out, latest: latest.day };
}

/** Every live tracked keyword losing ground at `to`, the deepest fall (the best place it held) first. */
export function losingGround(p: {
  keywords: readonly { id: string; keyword: string; stopped_on: Day | null }[];
  clusterOf: ReadonlyMap<string, string>;
  serp: readonly { run_date: Day; keyword_id: string; position: number | null; url?: string | null }[];
  to: Day;
}): Losing[] {
  const out: Losing[] = [];
  for (const k of p.keywords) {
    if (k.stopped_on !== null && k.stopped_on <= p.to) continue;
    const hit = losingFrom(readingsOf(p.serp, k.id, p.to));
    if (!hit) continue;
    out.push({ keywordId: k.id, keyword: k.keyword, clusterId: p.clusterOf.get(k.id) ?? null, ...hit, pageKey: hit.was.url ? urlKey(hit.was.url) : null });
  }
  return out.sort((a, b) => a.was.position - b.was.position || a.keyword.localeCompare(b.keyword));
}
