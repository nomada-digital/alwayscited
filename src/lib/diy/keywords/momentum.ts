import { type Intent, keywordForm } from "../../scan/dataforseo-request.ts";
import { type Day, addDays } from "../../tracking/figures.ts";
import { type Subject, namesBrandIn } from "../../tracking/limits.ts";
import { ordinal } from "../plan/words.ts";

import type { FootprintRow, Pull } from "./footprint.ts";

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

export type Gaining = {
  keyword: string;
  position: number;
  /** The reading it is compared with: our previous pull's position, or DataForSEO's own previous rank; null for a new one. */
  previous: number | null;
  kind: "new" | "climbing";
  /** Places gained, for a climb. */
  gain: number;
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
  /** "ours": compared with our previous pull. "dataforseo": one pull only, compared with DataForSEO's own previous reading. */
  basis: "ours" | "dataforseo";
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

export function momentum(input: MomentumInput): Momentum {
  const tracked = trackedSet(input.tracked, input.today);
  const dismissed = new Set([...input.dismissed].map(keywordForm));
  const prevAt = input.previous ? new Map(input.previous.rows.map((r) => [keywordForm(r.k), r.p] as const)) : null;
  const kept: (Gaining & { key: number })[] = [];
  for (const r of input.latest.rows) {
    if (r.p === null || r.p < 1 || r.p > MOMENTUM.depth) continue;
    const key = keywordForm(r.k);
    if (tracked.has(key) || dismissed.has(key) || namesBrandIn(r.k, input.subject)) continue;
    if (!input.showAll && !commercial(r)) continue;
    if ((r.v ?? 0) < MOMENTUM.minVolume) continue;
    const prev = prevAt ? (prevAt.get(key) ?? null) : (r.pr ?? null);
    let gain: number;
    let kind: Gaining["kind"];
    if (prev === null && r.p <= MOMENTUM.newDepth) {
      gain = 101 - r.p;
      kind = "new";
    } else if (prev !== null && prev - r.p >= MOMENTUM.climb) {
      gain = prev - r.p;
      kind = "climbing";
    } else continue;
    kept.push({ keyword: r.k, position: r.p, previous: prev, kind, gain, volume: r.v, intent: r.i, url: r.u, etv: r.e, key: gain * Math.max(MOMENTUM.keyFloor, r.v ?? 0) });
  }
  kept.sort(byKey);
  return {
    rows: kept.slice(0, MOMENTUM.top).map((g) => ({ keyword: g.keyword, position: g.position, previous: g.previous, kind: g.kind, gain: g.gain, volume: g.volume, intent: g.intent, url: g.url, etv: g.etv })),
    total: kept.length,
    climbing: kept.filter((g) => g.kind === "climbing").length,
    new: kept.filter((g) => g.kind === "new").length,
    volume: kept.reduce((s, g) => s + (g.volume ?? 0), 0),
    basis: input.previous ? "ours" : "dataforseo",
    readOn: input.latest.pulledOn,
  };
}

/** "Up from 18th to 7th" or "New at 12th". With one pull only, the comparison is DataForSEO's own previous reading, and says so. */
export function gainingLabel(g: Pick<Gaining, "kind" | "position" | "previous">, basis: Momentum["basis"]): string {
  if (g.kind === "new") return `New at ${ordinal(g.position)}${basis === "dataforseo" ? ", by DataForSEO's previous reading" : ""}`;
  return `Up from ${ordinal(g.previous!)} to ${ordinal(g.position)}${basis === "dataforseo" ? ", by DataForSEO's previous reading" : ""}`;
}

/** The block's one line: "7 untracked keywords gaining ground: 4 climbing, 3 new, 2,900 searches a month between them." */
export function gainingSummary(m: Pick<Momentum, "total" | "climbing" | "new" | "volume">): string {
  if (!m.total) return "No untracked keyword is gaining ground in this pull.";
  const parts = [m.climbing ? `${m.climbing} climbing` : null, m.new ? `${m.new} new` : null].filter(Boolean).join(", ");
  const vol = m.volume ? `, ${m.volume.toLocaleString("en-GB")} searches a month between them` : "";
  return `${m.total} untracked ${m.total === 1 ? "keyword" : "keywords"} gaining ground: ${parts}${vol}.`;
}
