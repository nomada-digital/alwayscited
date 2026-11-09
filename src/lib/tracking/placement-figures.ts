import { type ClusterChart } from "./cluster-figures.ts";
import { type Day, type Rate, rate } from "./figures.ts";
import { type PlacementKind, type PlacementStatus, urlKey } from "./placements.ts";

/**
 * The placements screen's figures (R97 part 1, 30 Sep 2026; BRIEF-2 T13
 * against boards-3/Placements.dc.html). Pure and unwired. Every figure reads
 * the cluster's own chart series (clusterChart), so the strip, the table and
 * the two panels count the same answers.
 *
 * - "At go-live" is the first reading on or after the day a page went live;
 *   "now" is the latest reading in the range. The footnote says this includes
 *   everything else that happened in that time; nothing here claims more.
 * - "Answers citing it" counts answers, from its live day, where an engine
 *   cited a URL with the placement's url_key (computed on read, T12).
 * - Ranges over 35 days draw weekly points, otherwise daily.
 */

/** The board's footnote, word for word (BRIEF-2 T13: mandatory). */
export const PLACEMENTS_FOOTNOTE =
  '"At go-live to now" is where the cluster stood the week a page went live, and where it stands today. It includes everything else that happened in that time. "Answers citing it" counts answers where an engine cited that exact page.';

export const WEEKLY_OVER_DAYS = 35;

/** The tiers that buy placements; the nav shows Placements for these (BRIEF-2 T13: mentioned, cited, everywhere). */
export const PLACED_TIERS = ["mentioned", "cited", "everywhere"] as const;
export const placedTier = (tier: string) => (PLACED_TIERS as readonly string[]).includes(tier);

export const KIND_WORDS: Record<PlacementKind, string> = { guest_post: "Placement", link_insertion: "Link insertion", on_site: "On-site", coverage: "Coverage" };

/** "thesmallbizstack.com" and "/best-accounting-apps", as the board's Page column splits a URL. */
export function pageParts(url: string): { host: string; path: string } {
  try {
    const u = new URL(url);
    return { host: u.hostname.replace(/^www\./, ""), path: u.pathname === "/" ? "" : u.pathname.replace(/\/$/, "") };
  } catch {
    return { host: url, path: "" };
  }
}

/** The cluster the screen opens: `?cluster=` when it is one of the client's, else the first with a placement, else the first. */
export function pickCluster(clusters: readonly { id: string }[], placements: readonly { cluster_id: string; status: string }[], asked: string | null): string | null {
  if (asked && clusters.some((c) => c.id === asked)) return asked;
  const placed = clusters.find((c) => placements.some((p) => p.cluster_id === c.id && p.status !== "removed"));
  return (placed ?? clusters[0])?.id ?? null;
}

export type PlacementRow = { id: string; kind: PlacementKind; url: string; url_key: string; status: PlacementStatus; scheduled_on: Day | null; live_on: Day | null };
/** One citation URL in one answer. */
export type CiteRow = { run_date: Day; question_id: string; engine: string; url: string };

export type Span<T> = { from: T | null; to: T | null };

export type PlacementLine = {
  id: string;
  kind: PlacementKind;
  url: string;
  url_key: string;
  live: boolean;
  /** The live date, or the status in words for a row not live. */
  when: string;
  liveOn: Day | null;
  cited: number;
  /** Engines that cited the page, in the tier's order. */
  citedBy: string[];
  named: Span<number>;
  google: Span<number>;
};

export type PlacementsView = {
  live: number;
  inProgress: number;
  whole: { from: Day | null; named: Span<number>; google: Span<number>; cited: number };
  rows: PlacementLine[];
  weekly: boolean;
};

const STATUS_WORDS: Record<PlacementStatus, string> = { pitched: "Pitched", writing: "Writing", scheduled: "Scheduled", live: "Live", removed: "Removed" };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "11 Jul", as the board writes a day. */
export const shortDay = (d: Day) => `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]}`;

function spanFrom<T>(days: Day[], values: (T | null)[], at: Day | null): Span<T> {
  let from: T | null = null;
  let to: T | null = null;
  for (let i = 0; i < days.length; i++) {
    const v = values[i];
    if (v === null || v === undefined) continue;
    if (from === null && (at === null || days[i]! >= at)) from = v;
    to = v;
  }
  return { from: from === null ? null : from, to: from === null ? null : to };
}

/** Whether a range this long draws weekly points. */
export const isWeekly = (days: number) => days > WEEKLY_OVER_DAYS;

/**
 * The strip and the table for one cluster. `chart` is clusterChart's output
 * for the same range; `questionIds` are the cluster's prompts; `cites` are the
 * citation URLs of those prompts' answers.
 */
export function placementsView(input: { chart: ClusterChart; questionIds: readonly string[]; placements: PlacementRow[]; cites: CiteRow[]; engines: readonly string[] }): PlacementsView {
  const { chart } = input;
  const pct = chart.named.map((r: Rate | null) => (r ? r.pct : null));
  const ids = new Set(input.questionIds);
  const inRange = (d: Day) => d >= chart.days[0]! && d <= chart.days[chart.days.length - 1]!;
  const cites = input.cites.filter((c) => ids.has(c.question_id) && inRange(c.run_date));
  const answerKey = (c: CiteRow) => `${c.run_date}|${c.question_id}|${c.engine}`;

  const live = input.placements.filter((p) => p.status === "live" && p.live_on);
  const citingAny = new Set<string>();
  const rows = input.placements
    .filter((p) => p.status !== "removed")
    .map((p): PlacementLine => {
      const isLive = p.status === "live" && p.live_on !== null;
      const hits = isLive ? cites.filter((c) => c.run_date >= p.live_on! && urlKey(c.url) === p.url_key) : [];
      const answers = new Set(hits.map(answerKey));
      for (const a of answers) citingAny.add(a);
      const engines = new Set(hits.map((c) => c.engine));
      return {
        id: p.id,
        kind: p.kind,
        url: p.url,
        url_key: p.url_key,
        live: isLive,
        when: isLive ? shortDay(p.live_on!) : p.status === "scheduled" && p.scheduled_on ? `Scheduled ${shortDay(p.scheduled_on)}` : STATUS_WORDS[p.status],
        liveOn: isLive ? p.live_on : null,
        cited: answers.size,
        citedBy: input.engines.filter((e) => engines.has(e)),
        named: isLive ? spanFrom(chart.days, pct, p.live_on) : { from: null, to: null },
        google: isLive ? spanFrom(chart.days, chart.google, p.live_on) : { from: null, to: null },
      };
    })
    // Live rows by go-live day, then the rest in the order logged.
    .sort((a, b) => (a.live === b.live ? (a.liveOn ?? "").localeCompare(b.liveOn ?? "") : a.live ? -1 : 1));

  return {
    live: live.length,
    inProgress: input.placements.filter((p) => p.status === "pitched" || p.status === "writing" || p.status === "scheduled").length,
    // "Since 4 Jul" is the first day with a reading, not the range's first day.
    whole: { from: chart.days.find((_, i) => chart.named[i] !== null || chart.google[i] !== null) ?? chart.days[0] ?? null, named: spanFrom(chart.days, pct, null), google: spanFrom(chart.days, chart.google, null), cited: citingAny.size },
    rows,
    weekly: isWeekly(chart.days.length),
  };
}

/** The overview's answers (which carry their citations) as one row per cited URL. */
export function citeRows(answers: readonly { run_date: Day; question_id: string; engine: string; answered: boolean; citations: readonly { url: string | null }[] }[]): CiteRow[] {
  return answers.flatMap((a) => (a.answered ? a.citations.flatMap((c) => (c.url ? [{ run_date: a.run_date, question_id: a.question_id, engine: a.engine, url: c.url }] : [])) : []));
}

/** A span as the board writes it: "12% to 44%", "#18 to #4", or a dash. */
export function spanText(s: Span<number>, unit: "pct" | "rank"): string {
  if (s.from === null || s.to === null) return "-";
  return unit === "pct" ? `${s.from}% to ${s.to}%` : `#${s.from} to #${s.to}`;
}

/** Weekly points: each week's answers summed (a rate over the week, not an average of days), and its last Google reading. */
export function weeklyPoints(chart: ClusterChart): { days: Day[]; named: (Rate | null)[]; google: (number | null)[] } {
  const out = { days: [] as Day[], named: [] as (Rate | null)[], google: [] as (number | null)[] };
  for (let i = 0; i < chart.days.length; i += 7) {
    const end = Math.min(i + 7, chart.days.length);
    let num = 0;
    let den = 0;
    let g: number | null = null;
    for (let j = i; j < end; j++) {
      const r = chart.named[j];
      if (r) {
        num += r.num;
        den += r.den;
      }
      if (chart.google[j] !== null && chart.google[j] !== undefined) g = chart.google[j]!;
    }
    out.days.push(chart.days[i]!);
    out.named.push(den ? rate(num, den) : null);
    out.google.push(g);
  }
  return out;
}

/**
 * The two panels' series (R97 part 4b): weekly points over 35 days, daily
 * otherwise, the named rate as a whole percentage. The axis starts at the
 * first reading, as the strip's "since" does, not at a range start before it.
 */
export function chartSeries(input: ClusterChart): { days: Day[]; named: (number | null)[]; google: (number | null)[]; weekly: boolean } {
  const start = Math.max(0, input.days.findIndex((_, i) => input.named[i] !== null || input.google[i] !== null));
  const chart = { ...input, days: input.days.slice(start), named: input.named.slice(start), google: input.google.slice(start) };
  const weekly = isWeekly(chart.days.length);
  const s = weekly ? weeklyPoints(chart) : chart;
  return { days: s.days, named: s.named.map((r) => (r ? r.pct : null)), google: s.google, weekly };
}

/** The table's and the chart's type filter: `?type=` when it is a kind, else every kind. */
export function pickKind(asked: string | null | undefined): PlacementKind | null {
  return asked && Object.hasOwn(KIND_WORDS, asked) ? (asked as PlacementKind) : null;
}

const KIND_PLURAL: Record<PlacementKind, string> = { guest_post: "Placements", link_insertion: "Link insertions", on_site: "On-site", coverage: "Coverage" };

/** The board's filter pills: "All 18", then one per kind the cluster has, in KIND_WORDS order. */
export function kindFilters(rows: readonly { kind: PlacementKind }[]): { kind: PlacementKind | null; label: string }[] {
  const kinds = (Object.keys(KIND_WORDS) as PlacementKind[]).filter((k) => rows.some((r) => r.kind === k));
  return [{ kind: null, label: `All ${rows.length}` }, ...kinds.map((k) => ({ kind: k, label: `${KIND_PLURAL[k]} ${rows.filter((r) => r.kind === k).length}` }))];
}

/**
 * The overview chart's placement lines (R97 part 5, BRIEF-2 T13 "Show
 * placements"): each live placement on the cluster whose live day is one of
 * the chart's days, as that day's index. Removed and not-live rows draw none.
 */
export function chartMarkers(days: readonly Day[], rows: readonly (PlacementRow & { cluster_id: string })[], clusterId: string): { id: string; i: number; kind: PlacementKind; label: string }[] {
  return rows
    .filter((p) => p.cluster_id === clusterId && p.status === "live" && p.live_on !== null)
    .map((p) => ({ p, i: days.indexOf(p.live_on!) }))
    .filter(({ i }) => i >= 0)
    .sort((a, b) => a.i - b.i)
    .map(({ p, i }) => ({ id: p.id, i, kind: p.kind, label: `${KIND_WORDS[p.kind]} on ${pageParts(p.url).host}, live ${shortDay(p.live_on!)}` }));
}

/** Where a day falls along an axis from `first` to `last`, 0 to 1, clamped. */
export function axisAt(d: Day, first: Day, last: Day): number {
  const span = Date.parse(last) - Date.parse(first);
  if (span <= 0) return 0;
  return Math.min(1, Math.max(0, (Date.parse(d) - Date.parse(first)) / span));
}
