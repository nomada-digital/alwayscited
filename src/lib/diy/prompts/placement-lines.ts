import { addDays, type Day } from "../../tracking/figures.ts";
import { shortDay } from "../../tracking/placement-figures.ts";
import { urlKey } from "../../tracking/placements.ts";

import type { PromptOrigin } from "./origins.ts";

/**
 * The two lines each live placement row gains on /placements (13 Oct 2026,
 * DIY P2; spec 10 section 4.11). Pure; placements-screen.ts reads, and
 * Placements.tsx draws.
 *
 * - **First cited**, always: the earliest check on which each engine cited the
 *   placement's own page (its url_key, citesPlacement's rule) in an answer to
 *   any of the cluster's prompts, from its live day. It reads answers already
 *   loaded, so it needs no switch. A range that starts after the page went live
 *   cannot see its first citation, so the line then says "in this range".
 *   Nothing cited and live under 21 days is "Too early to read" (spec 2.6 rule
 *   9); later, "Not cited yet".
 * - **The prompt line**, only once placement_prompts_enabled is on: the prompt
 *   the placement added, or why there is none. The reasons are the ones a read
 *   can tell; the admin sees every reason, and the retry, on its own page.
 *
 * Nothing here says a placement moved anything (causal-copy.test.mts): a
 * citation is a fact with a date, never an effect.
 */

export const TOO_EARLY_DAYS = 21;
export const TOO_EARLY = "Too early to read";
export const NOT_CITED = "Not cited yet";

export type Cite = { run_date: Day; engine: string; url: string };

/** Per engine, the first day it cited `key` on or after `liveOn`, earliest first, ties in the tier's engine order. */
export function firstCitedBy(cites: readonly Cite[], key: string, liveOn: Day, engines: readonly string[]): { engine: string; day: Day }[] {
  const first = new Map<string, Day>();
  for (const c of cites) {
    if (c.run_date < liveOn || !engines.includes(c.engine)) continue;
    const had = first.get(c.engine);
    if (had !== undefined && had <= c.run_date) continue;
    if (urlKey(c.url) !== key) continue;
    first.set(c.engine, c.run_date);
  }
  return [...first]
    .map(([engine, day]) => ({ engine, day }))
    .sort((a, b) => a.day.localeCompare(b.day) || engines.indexOf(a.engine) - engines.indexOf(b.engine));
}

/**
 * Every live placement of one cluster, with its engines' first citations, from
 * the cluster's prompts' answers only (placements-screen.ts; read-shape.test.mts
 * compares it on the narrow read and the whole one).
 */
export function placementFirstCited(
  placements: readonly { id: string; cluster_id: string; status: string; url_key: string; live_on: Day | null }[],
  clusterId: string,
  cites: readonly (Cite & { question_id: string })[],
  questionIds: readonly string[],
  engines: readonly string[],
): Record<string, { engine: string; day: Day }[]> {
  const ids = new Set(questionIds);
  const mine = cites.filter((c) => ids.has(c.question_id));
  return Object.fromEntries(placements.filter((p) => p.cluster_id === clusterId && p.status === "live" && p.live_on).map((p) => [p.id, firstCitedBy(mine, p.url_key, p.live_on!, engines)]));
}

/** "First cited: Perplexity 12 Oct, ChatGPT 15 Oct", "Not cited yet" or "Too early to read". `label` names an engine. */
export function firstCitedLine(first: readonly { engine: string; day: Day }[], p: { liveOn: Day; today: Day; rangeFrom: Day; label: (engine: string) => string }): string {
  const partial = p.rangeFrom > p.liveOn;
  if (first.length) return `${partial ? "First cited in this range" : "First cited"}: ${first.map((f) => `${p.label(f.engine)} ${shortDay(f.day)}`).join(", ")}`;
  if (addDays(p.liveOn, TOO_EARLY_DAYS) > p.today) return TOO_EARLY;
  return partial ? "Not cited in this range" : NOT_CITED;
}

export type PromptRowLite = { id: string; text: string; added_on: Day; stopped_on: Day | null };

/** The placement's own prompt: a live one before a stopped one, the newest of either. */
export function placementPromptOf(placementId: string, origins: ReadonlyMap<string, PromptOrigin>, prompts: readonly PromptRowLite[]): PromptRowLite | null {
  const mine = prompts.filter((q) => {
    const o = origins.get(q.id);
    return o?.kind === "placement" && o.ref === placementId;
  });
  const pick = (rows: PromptRowLite[]) => [...rows].sort((a, b) => b.added_on.localeCompare(a.added_on))[0] ?? null;
  return pick(mine.filter((q) => q.stopped_on === null)) ?? pick(mine);
}

/**
 * "Prompt added 4 Oct: “best invoicing apps for freelancers”", or "No prompt: <reason>".
 * Null for a placement that is not live: nothing is due from it yet.
 */
export function promptLine(p: { kind: string; live: boolean; prompt: PromptRowLite | null; today: Day; placementPromptsLive: number; allowance: number }): string | null {
  if (!p.live) return null;
  const q = p.prompt;
  if (q) {
    if (q.stopped_on !== null && q.stopped_on <= p.today) return `Prompt “${q.text}” stopped from ${shortDay(q.stopped_on)}`;
    if (q.added_on > p.today) return `Prompt added: “${q.text}”, first asked ${q.added_on === addDays(p.today, 1) ? "tomorrow" : shortDay(q.added_on)}`;
    return `Prompt added ${shortDay(q.added_on)}: “${q.text}”`;
  }
  if (p.kind === "on_site") return "No prompt: on-site work adds none";
  if (p.kind === "link_insertion") return "No prompt: a link in an existing article adds none by default";
  if (p.placementPromptsLive >= p.allowance) return `No prompt: ${p.allowance} placement prompts are already asked daily`;
  return "No prompt added from this article";
}
