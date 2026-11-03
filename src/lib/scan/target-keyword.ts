/**
 * The keyword rule for R39 (Danny, 27 Sep 2026 - search volume returns at
 * keyword level; docs/rules.md). Pure, and not yet called: the model proposes
 * 3-5 candidate head keywords per question, this decides which may stand, and
 * the volume call picks among them. Nothing wires it in until the
 * target_keyword column (migration 20260927000000) is applied and read back.
 *
 * A candidate stands when, after the filler is taken out, it still names a
 * supplier - "business cash flow finance providers" - and is not the bare
 * category. The bare category is what the old keyword tools rank on and is
 * not a buyer choosing someone.
 */

import { type Intent, keywordForm } from "./dataforseo-request.ts";
import type { Market } from "./domain.ts";

/** Words that say "choose" without saying what. Taken out, never kept. */
const FILLER = new Set([
  "best", "top", "which", "who", "offers", "offer", "the", "a", "an", "for", "in", "of", "are", "is",
  "uk", "us", "usa", "america", "britain", "united", "kingdom", "states", "england",
]);

/** What a buyer is choosing between. A candidate must keep one. */
export const SUPPLIER_NOUNS = [
  "providers", "provider", "companies", "company", "lenders", "lender", "software", "tools", "tool",
  "platforms", "platform", "agency", "agencies", "firms", "firm", "consultants", "consultancy",
  "services", "suppliers", "supplier", "vendors", "vendor", "apps", "app", "brands", "partners",
  // 3 Nov 2026: consumer and place-based suppliers. couples.com's every candidate ("couples resorts",
  // "adults only all inclusive resorts") was refused for want of one of the words above, so a category
  // with 9,900 US searches a month read "no keyword had the searches to pick".
  "resorts", "hotels", "clinics", "schools", "retailers", "stores", "manufacturers", "contractors",
  "installers", "dealers", "brokers", "insurers", "operators",
];

/** Years and list sizes - "2026", "top 10". */
const YEAR = /^\d+$/;

/** Lower case, filler and years out, single spaces. */
export function stripFiller(candidate: string): string {
  return candidate
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !FILLER.has(w) && !YEAR.test(w))
    .join(" ");
}

/**
 * The category's own supplier noun, as the model names it, counts as one when
 * it is a single plural word (3 Nov 2026): "resorts" for a resort, "kennels"
 * for a kennel. Not "finance", and not a word ending "ss" ("business").
 */
const ownNoun = (supplierNoun: string): string | null => {
  const n = stripFiller(supplierNoun);
  return /^[a-z]{3,}[^s]s$/.test(n) ? n : null;
};

const hasSupplier = (k: string, own: string | null = null) => k.split(" ").some((w) => SUPPLIER_NOUNS.includes(w) || w === own);

/**
 * The candidate as it would be looked up, or null when it may not stand.
 * With no supplier noun, the category's own is added (`supplierNoun`) rather
 * than the candidate being lost; the bare category is refused either way.
 */
export function normaliseCandidate(candidate: string, category: string, supplierNoun: string): string | null {
  let k = stripFiller(candidate);
  if (!k) return null;
  const own = ownNoun(supplierNoun);
  if (!hasSupplier(k, own)) {
    const noun = stripFiller(supplierNoun);
    if (!noun || !hasSupplier(noun, own)) return null;
    k = k + " " + noun;
  }
  if (k === stripFiller(category)) return null;
  const words = k.split(" ");
  // A supplier noun alone ("agencies") is not a head keyword.
  if (words.length < 2) return null;
  return k;
}

/**
 * The keyword for one question: the highest-volume candidate that stands;
 * when every one reads zero (or has no reading), the shortest. Null when none
 * stands. Ties go to the earlier candidate, which is the model's own order.
 */
export function pickKeyword(
  candidates: string[],
  category: string,
  supplierNoun: string,
  volumes: ReadonlyMap<string, number>,
): string | null {
  const standing = [...new Set(candidates.map((c) => normaliseCandidate(c, category, supplierNoun)).filter((k): k is string => Boolean(k)))];
  if (!standing.length) return null;
  const vol = (k: string) => volumes.get(k) ?? 0;
  const top = standing.reduce((a, b) => (vol(b) > vol(a) ? b : a));
  if (vol(top) > 0) return top;
  return standing.reduce((a, b) => (b.length < a.length ? b : a));
}

/**
 * The cluster keyword - C1 of docs/tracked-dashboard-2026-09-29/BRIEF-3-clusters.md
 * (Danny, 29 Sep 2026). It is the term placements link on, so it must have a
 * measured Google volume above zero (null is not measured and never qualifies,
 * nor does 0) and a primary intent of commercial or transactional. Highest
 * volume among the qualifying wins; ties go to the model's order. There is no
 * shortest fallback - that is `pickKeyword`'s guess, and here a failed check
 * says so and we pick one with the client.
 *
 * `none` says why: no candidate at all, none with volume, or volume but never
 * the intent. Pure; not yet called - C1's route change wires it.
 */
export type ClusterKeywordPick =
  | { keyword: string; volume: number; intent: "commercial" | "transactional" }
  | { none: "no_volume" | "no_intent" | "no_candidate" };

const QUALIFYING = new Set(["commercial", "transactional"]);

export function pickClusterKeyword(
  candidates: readonly string[],
  volumes: ReadonlyMap<string, number | null>,
  intents: ReadonlyMap<string, Intent | null>,
): ClusterKeywordPick {
  const unique = [...new Set(candidates.map(keywordForm).filter(Boolean))];
  if (!unique.length) return { none: "no_candidate" };
  const measured = (k: string) => {
    const v = volumes.get(k);
    return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;
  };
  const withVolume = unique.filter((k) => measured(k) !== null);
  if (!withVolume.length) return { none: "no_volume" };
  const qualifying = withVolume.filter((k) => QUALIFYING.has(String(intents.get(k))));
  if (!qualifying.length) return { none: "no_intent" };
  const top = qualifying.reduce((a, b) => (measured(b)! > measured(a)! ? b : a));
  return { keyword: top, volume: measured(top)!, intent: intents.get(top) as "commercial" | "transactional" };
}

/** The scan's cluster keyword as stored on `scans` (BRIEF-3 C1). */
export type StoredClusterKeyword = {
  status: "chosen" | "none_qualified" | "read_failed" | null;
  keyword: string | null;
  volume: number | null;
  rank: number | null;
};

/**
 * The Google trio a result row reads, for a scan with a cluster keyword
 * (BRIEF-3 C1 step 8, 30 Sep 2026). A null status is a scan from before C1:
 * null back, and the row keeps its own `target_keyword`, which stays for old
 * scans only. A chosen keyword is the one line every prompt reads. Any other
 * status has no keyword, so the trio is empty and `googleLine` falls back to
 * the rank for the prompt text - never a keyword that did not qualify.
 */
export function clusterGoogleTrio(
  c: StoredClusterKeyword | null,
): { target_keyword: string | null; search_volume: number | null; keyword_rank: number | null } | null {
  if (!c?.status) return null;
  if (c.status !== "chosen" || !c.keyword?.trim()) return { target_keyword: null, search_volume: null, keyword_rank: null };
  return { target_keyword: c.keyword, search_volume: c.volume, keyword_rank: c.rank };
}

/**
 * Whether a scan's stored cluster keyword was read for this topic and market
 * (18 Oct 2026). A keyword, its volume and its intent are a reading in one
 * market for one topic: reused only for that same pair, never across markets.
 * A row stored before the market was recorded (null) never fits, so it is read
 * again rather than guessed.
 */
export function clusterKeywordFits(stored: { status: unknown; topic: unknown; market: unknown }, topic: string, market: string): boolean {
  if (!stored.status || typeof stored.market !== "string" || stored.topic !== topic) return false;
  // A keyword read in one of the market's fallbacks (KEYWORD_FALLBACK) was read for this market.
  return stored.market === market || (KEYWORD_FALLBACK[market as Market] ?? []).includes(stored.market as Market);
}

/**
 * Where a scan market's own Google volumes are too thin to pick a keyword on,
 * the markets its buyers search from, in order (Danny, 3 Nov 2026). Jamaica's
 * best term for couples.com read 390 a month there and 9,900 in the US; the
 * resort's buyers are in the US and the UK. Only JM: a UK or US business is
 * judged on its own market's searches.
 */
export const KEYWORD_FALLBACK: Partial<Record<Market, readonly Market[]>> = { JM: ["US", "UK"] };

/** A keyword under this many searches a month in a market with fallbacks sends the pick to them. */
export const THIN_KEYWORD_VOLUME = 1000;

/**
 * The cluster keyword across a market and its fallbacks: the home market's
 * pick when it reaches THIN_KEYWORD_VOLUME, else the first fallback whose pick
 * beats it, else the home pick (or its `none`). `market` says where the
 * keyword was read, which is where its Google position is checked too.
 */
export function pickAcrossMarkets(
  reads: { market: Market; pick: ClusterKeywordPick }[],
): { market: Market; pick: ClusterKeywordPick } {
  const [home, ...rest] = reads;
  const vol = (p: ClusterKeywordPick) => ("none" in p ? 0 : p.volume);
  if (vol(home.pick) >= THIN_KEYWORD_VOLUME) return home;
  return rest.find((r) => vol(r.pick) > vol(home.pick)) ?? home;
}

/**
 * The confirmed topic as the keyword, when the check found none or could not read (Danny, 3 Nov 2026: alwayscited.com
 * confirmed "ai seo agency", the volume read timed out, and the report said "Keyword: Not picked for this scan" -
 * "should it not default to the keyword selected on the previous screen?"). Saved as chosen with no volume and no
 * intent, which is what the result reads as "volume not read"; its Google position is read like any other and
 * stored unchecked when the read measures nothing. "Not picked" is left for a scan with no topic at all.
 */
export function topicFallback<K extends { keyword: string | null; volume: number | null; intent: string | null; status: string; market: Market }>(out: K, topic: string): K {
  const keyword = keywordForm(topic);
  if ((out.status === "chosen" && out.keyword) || keyword.length < 2) return out;
  return { ...out, keyword, volume: null, intent: null, status: "chosen" };
}
