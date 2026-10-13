import { brandKey, subjectKeys } from "../../scan/brand-name.ts";
import { type AnswerRow, type Day, type Range, type Rate, brandsRead, rate } from "../../tracking/figures.ts";
import { ANGLES, type Angle } from "../../tracking/limits.ts";

/**
 * The AI visibility page's prompt table (13 Oct 2026, DIY P4; spec 10
 * section 4.2 rows 5 and 6): one row per prompt asked in the range, its
 * filters and its sort, and the "missing" lens. Pure, so every rule runs
 * under node --test; the page reads the query through the pickers below, each
 * a whitelist or a clamp, and hands the rows to PromptTable.tsx.
 *
 * Figures are counts with their denominators (section 2.6): "n of m engines"
 * at a check leaves out an engine that did not answer, a first reading is
 * shown and never scored, and a change is like for like - only the engines
 * that answered the prompt on both days.
 */

/**
 * Where a prompt came from (section 6.7). P2's `origins.ts` ORIGIN_KINDS owns
 * the list; this package may not import it in wave 1 (spec 7.5), so the
 * spec's list is read here and the shell holds the two equal when it wires
 * the origins in (P5's handoff).
 */
export const ORIGINS = ["setup", "client", "nomada", "placement", "opportunity", "momentum"] as const;
export type PromptOrigin = (typeof ORIGINS)[number];

/** The prompts the client chose (section 6.7 "Honesty"): setup, their own, nomada's - and legacy rows with no origin. */
export const CHOSEN: readonly PromptOrigin[] = ["setup", "client", "nomada"];

export type OriginFilter = PromptOrigin | "chosen";

/** A prompt's origin from the map P5 passes in; a prompt the map does not hold is a legacy one, which the client chose. */
export const originOfRow = (origins: ReadonlyMap<string, string>, id: string): PromptOrigin | null => {
  const o = origins.get(id);
  return (ORIGINS as readonly string[]).includes(o ?? "") ? (o as PromptOrigin) : null;
};

export const isChosen = (o: PromptOrigin | null) => o === null || CHOSEN.includes(o);

/** The chip's words (section 6.7). Agency mode never names nomada. */
export function originLabel(o: PromptOrigin | null, mode: "nomada" | "agency" | "off"): string {
  switch (o) {
    case "client":
      return "You";
    case "nomada":
      return mode === "agency" ? "Your account contact" : "nomada digital";
    case "placement":
      return "Placement";
    case "opportunity":
      return "Opportunity";
    case "momentum":
      return "Momentum";
    default:
      return "Setup";
  }
}

export const SORTS = ["cluster", "prompt", "named", "engines", "change"] as const;
export type Sort = (typeof SORTS)[number];
export const PAGE_SIZE = 100;
export const MAX_PAGE = 50;

/** `?angle=`: one of ANGLES, else none. */
export const pickAngle = (raw: string | null): Angle | null => ((ANGLES as readonly string[]).includes(raw ?? "") ? (raw as Angle) : null);
/** `?origin=`: an origin kind or `chosen`, else none. */
export const pickOrigin = (raw: string | null): OriginFilter | null => (raw === "chosen" || (ORIGINS as readonly string[]).includes(raw ?? "") ? (raw as OriginFilter) : null);
/** `?sort=`: one of SORTS, else the cluster order. */
export const pickSort = (raw: string | null): Sort => ((SORTS as readonly string[]).includes(raw ?? "") ? (raw as Sort) : "cluster");
/** `?dir=`: asc or desc; asc by default. */
export const pickDir = (raw: string | null): "asc" | "desc" => (raw === "desc" ? "desc" : "asc");
/** `?page=`: a whole number 1 to MAX_PAGE, else 1. */
export const pickPage = (raw: string | null): number => (/^\d{1,2}$/.test(raw ?? "") ? Math.min(MAX_PAGE, Math.max(1, Number(raw))) : 1);

/** A check's engines: those that answered, and of them those naming the client. */
export type AtCheck = { day: Day; named: number; of: number };

export type PromptRow = {
  id: string;
  text: string;
  clusterId: string | null;
  clusterLabel: string | null;
  /** The prompt's place on its cluster's card, the one-cluster page's `?prompt=`. */
  index: number | null;
  angle: Angle | null;
  origin: PromptOrigin | null;
  /** n of m engines at the latest check in the range; null with no answered read. */
  latest: AtCheck | null;
  /** The same at the first check in the range, when it is not the latest. */
  from: AtCheck | null;
  /** Engines naming the client at the latest check less at the first, on the engines that answered both; null when not comparable. */
  change: number | null;
  /** Answers naming the client over the range, of the answers returned. */
  answers: Rate;
  /** Google's AI Overview at the latest check; null when the tier has none or it was not read that day. */
  aio: "named" | "shown" | "none" | null;
  /** The prompt has one reading so far: shown, scored from the next full check. */
  first: boolean;
  /** In the range, answers named at least one other brand and never the client. */
  missing: boolean;
};

export type RowsInput = {
  prompts: readonly { id: string; text: string; cluster_id: string | null; angle: Angle | null; added_on: Day; stopped_on: Day | null }[];
  clusters: readonly { id: string; label: string }[];
  /** Every answer read, the comparison's included: a prompt's first reading may be before the range. */
  answers: readonly AnswerRow[];
  range: Range;
  /** The first day `answers` holds (the comparison's first, or the range's): a prompt added before it has readings this read does not hold. */
  loadedFrom: Day;
  /** The tier's engines in its order, or the one `?eng=` picks. */
  engines: readonly string[];
  origins: ReadonlyMap<string, string>;
  brand: string;
  domain: string;
};

const AIO = "google_aio";

/** One row per prompt asked in the range, in the order the clusters and their prompts are listed. */
export function promptRows(input: RowsInput): PromptRow[] {
  const { range } = input;
  const engines = new Set(input.engines);
  const you = subjectKeys(input.brand, input.domain);
  const byPrompt = new Map<string, AnswerRow[]>();
  for (const a of input.answers) {
    const list = byPrompt.get(a.question_id);
    if (list) list.push(a);
    else byPrompt.set(a.question_id, [a]);
  }
  const asked = input.prompts.filter((q) => q.added_on <= range.to && (q.stopped_on === null || q.stopped_on > range.from));
  const clusterOrder = new Map(input.clusters.map((c, i) => [c.id, i]));
  const ordered = [...asked].sort((a, b) => (clusterOrder.get(a.cluster_id ?? "") ?? Infinity) - (clusterOrder.get(b.cluster_id ?? "") ?? Infinity));
  return ordered.map((q) => {
    const all = byPrompt.get(q.id) ?? [];
    const mine = all.filter((a) => engines.has(a.engine));
    const inRange = mine.filter((a) => a.run_date >= range.from && a.run_date <= range.to);
    const days = [...new Set(inRange.filter((a) => a.answered).map((a) => a.run_date))].sort();
    const at = (day: Day | undefined): AtCheck | null => {
      if (!day) return null;
      const rows = inRange.filter((a) => a.run_date === day && a.answered);
      return { day, named: rows.filter((a) => a.named).length, of: rows.length };
    };
    const latest = at(days[days.length - 1]);
    const from = days.length > 1 ? at(days[0]) : null;
    // One reading ever: only knowable for a prompt added inside what was read; an older one has readings before it.
    const everRead = new Set(all.filter((a) => a.answered).map((a) => a.run_date));
    const first = everRead.size === 1 && q.added_on >= input.loadedFrom;
    let change: number | null = null;
    if (latest && from && !first) {
      const on = (day: Day) => new Map(inRange.filter((a) => a.run_date === day && a.answered).map((a) => [a.engine, a.named]));
      const a = on(from.day);
      const b = on(latest.day);
      const both = [...a.keys()].filter((e) => b.has(e));
      if (both.length) change = both.filter((e) => b.get(e)).length - both.filter((e) => a.get(e)).length;
    }
    const answered = inRange.filter((a) => a.answered);
    const named = answered.filter((a) => a.named).length;
    const others = answered.some((a) => brandsRead(a) && a.brands.some((b) => { const k = brandKey(b); return !!k && !you.has(k); }));
    const aioRow = engines.has(AIO) && latest ? inRange.find((a) => a.engine === AIO && a.run_date === latest.day) : undefined;
    const cluster = input.clusters.find((c) => c.id === q.cluster_id) ?? null;
    const index = cluster ? input.prompts.filter((p) => p.cluster_id === cluster.id && (p.stopped_on === null || p.stopped_on > range.from) && p.added_on <= range.to).findIndex((p) => p.id === q.id) : -1;
    return {
      id: q.id,
      text: q.text,
      clusterId: cluster?.id ?? null,
      clusterLabel: cluster?.label ?? null,
      index: index >= 0 ? index : null,
      angle: q.angle,
      origin: originOfRow(input.origins, q.id),
      latest,
      from,
      change,
      answers: rate(named, answered.length),
      aio: !aioRow ? null : aioRow.answered ? (aioRow.named ? "named" : "shown") : "none",
      first,
      missing: named === 0 && others,
    };
  });
}

export type RowFilter = { cluster: string | null; angle: Angle | null; origin: OriginFilter | null; missing: boolean; q: string };

/** The set filters - cluster, angle and origin - which the page's figures read too. */
export function inSet(row: Pick<PromptRow, "clusterId" | "angle" | "origin">, f: Pick<RowFilter, "cluster" | "angle" | "origin">): boolean {
  if (f.cluster && row.clusterId !== f.cluster) return false;
  if (f.angle && row.angle !== f.angle) return false;
  if (f.origin === "chosen") return isChosen(row.origin);
  if (f.origin && row.origin !== f.origin) return false;
  return true;
}

/** Every filter: the set's, the missing lens and the search. */
export function filterRows(rows: readonly PromptRow[], f: RowFilter): PromptRow[] {
  const term = f.q.trim().toLowerCase();
  return rows.filter((r) => inSet(r, f) && (!f.missing || r.missing) && (!term || r.text.toLowerCase().includes(term)));
}

/** Sorted by a fixed key; a row with nothing to sort by goes last either way, and ties keep the cluster order. */
export function sortRows(rows: readonly PromptRow[], sort: Sort, dir: "asc" | "desc"): PromptRow[] {
  const key = (r: PromptRow): number | string | null =>
    sort === "prompt" ? r.text.toLowerCase() : sort === "cluster" ? null : sort === "named" ? r.answers.pct : sort === "engines" ? (r.latest && r.latest.of ? r.latest.named / r.latest.of : null) : r.change;
  if (sort === "cluster") return dir === "asc" ? [...rows] : [...rows].reverse();
  const sign = dir === "asc" ? 1 : -1;
  return rows
    .map((r, i) => ({ r, i, k: key(r) }))
    .sort((a, b) => {
      if (a.k === null || b.k === null) return a.k === b.k ? a.i - b.i : a.k === null ? 1 : -1;
      return (a.k < b.k ? -1 : a.k > b.k ? 1 : 0) * sign || a.i - b.i;
    })
    .map((x) => x.r);
}

/** One page of rows, the page clamped to the last there is. */
export function pageOf<R>(rows: readonly R[], page: number): { rows: R[]; page: number; pages: number } {
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const at = Math.min(Math.max(1, page), pages);
  return { rows: rows.slice((at - 1) * PAGE_SIZE, at * PAGE_SIZE), page: at, pages };
}

const WORDS: Record<PromptOrigin, string> = { setup: "setup", client: "you", nomada: "your account", placement: "placements", opportunity: "opportunities", momentum: "rising keywords" };

/**
 * The Overview's basis line (section 4.1 row 4, audit data-2): how many live
 * prompts were added from placements, opportunities or rising keywords -
 * prompts likelier to name the client, which the headline counts. Null when
 * there are none, so the line is drawn only when it has something to say.
 */
export function addedFromWork(origins: ReadonlyMap<string, string>, live: readonly string[]): { count: number; text: string } | null {
  const kinds: PromptOrigin[] = [];
  let count = 0;
  for (const id of live) {
    const o = originOfRow(origins, id);
    if (isChosen(o)) continue;
    count++;
    if (!kinds.includes(o!)) kinds.push(o!);
  }
  if (!count) return null;
  const order = kinds.sort((a, b) => ORIGINS.indexOf(a) - ORIGINS.indexOf(b)).map((k) => WORDS[k]);
  const and = order.length > 1 ? `${order.slice(0, -1).join(", ")} and ${order[order.length - 1]}` : order[0]!;
  return { count, text: `Includes ${count} ${count === 1 ? "prompt" : "prompts"} added from ${and}.` };
}
