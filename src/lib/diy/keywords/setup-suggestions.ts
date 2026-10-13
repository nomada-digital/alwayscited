import { keywordForm } from "../../scan/dataforseo-request.ts";
import type { Day } from "../../tracking/figures.ts";
import { type Subject, namesBrandIn } from "../../tracking/limits.ts";
import { ordinal } from "../plan/words.ts";
import { formatDate } from "../../format-date.ts";

import type { FootprintData } from "./data.ts";
import type { Pull } from "./footprint.ts";
import { type Momentum, commercial, gainingLabel, momentum } from "./momentum.ts";

/**
 * Keywords to start tracking (13 Oct 2026, DIY P6; spec 10 sections 4.10 and
 * 4.12): Setup's "Suggested keywords" and Clusters' "Suggested clusters".
 * Pure. Every suggestion is a keyword the client already ranks for in
 * DataForSEO's index, or the one typed at checkout, and each carries its
 * reason line with the estimate's read date. Using one runs the existing
 * Check keyword (Google Ads volume and intent, 20 a day), which still decides:
 * nothing here changes what the client tracks.
 *
 * The footprint's candidates pass pickClusterKeyword's intent rule
 * (target-keyword.ts: a measured volume above zero, and a commercial or
 * transactional intent), sit at positions 4 to 30 - ranking, not yet on top -
 * and do not name the brand.
 */

/** Setup lists at most this many (spec 4.12). */
export const SETUP_MAX = 10;
/** Clusters lists at most this many (spec 4.10). */
export const CLUSTERS_MAX = 5;
/** The footprint's positions a candidate sits in. */
export const SUGGEST_FROM = 4;
export const SUGGEST_TO = 30;

export type Suggestion = {
  keyword: string;
  source: "footprint" | "gaining" | "checkout";
  position: number | null;
  volume: number | null;
  url: string | null;
  /** One line: where it sits and its volume, with the estimate's read date; or that it was typed at checkout. */
  reason: string;
};

/** "7th on Google, /payroll; 880 searches a month (DataForSEO estimate, read 29 Sep)." */
function footprintReason(p: { position: number | null; url: string | null; volume: number | null; readOn: Day; lead?: string }): string {
  const at = p.lead ?? (p.position !== null ? `${ordinal(p.position)} on Google` : "Ranking on Google");
  const where = p.url ? `, ${p.url}` : "";
  const vol = p.volume !== null ? `; ${p.volume.toLocaleString("en-GB")} searches a month` : "";
  return `${at}${where}${vol} (DataForSEO estimate, read ${formatDate(p.readOn)}).`;
}

/** The footprint rows that may be suggested, by volume then position. */
export function footprintCandidates(latest: Pull, tracked: ReadonlySet<string>, subject: Subject): Suggestion[] {
  return latest.rows
    .filter((r) => r.p !== null && r.p >= SUGGEST_FROM && r.p <= SUGGEST_TO && (r.v ?? 0) > 0 && commercial(r) && !tracked.has(keywordForm(r.k)) && !namesBrandIn(r.k, subject))
    .sort((a, b) => (b.v ?? 0) - (a.v ?? 0) || a.p! - b.p! || a.k.localeCompare(b.k))
    .map((r) => ({ keyword: r.k, source: "footprint" as const, position: r.p, volume: r.v, url: r.u, reason: footprintReason({ position: r.p, url: r.u, volume: r.v, readOn: latest.pulledOn }) }));
}

/** A gaining-ground keyword as a suggestion, its reason the climb. */
function fromGaining(g: Momentum["rows"][number], m: Pick<Momentum, "readOn">): Suggestion {
  return { keyword: g.keyword, source: "gaining", position: g.position, volume: g.volume, url: g.url, reason: footprintReason({ position: g.position, url: g.url, volume: g.volume, readOn: m.readOn, lead: gainingLabel(g) }) };
}

function dedupe(list: readonly Suggestion[], max: number): Suggestion[] {
  const seen = new Set<string>();
  const out: Suggestion[] = [];
  for (const s of list) {
    const k = keywordForm(s.keyword);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

/** Footprint candidates Setup lists before the gaining-ground keywords; the rest follow them. */
export const SETUP_FOOTPRINT_HEAD = 5;

/**
 * Setup's list (spec 4.12), up to SETUP_MAX, each keyword once and none the
 * client tracks: the footprint's first SETUP_FOOTPRINT_HEAD candidates, then
 * the gaining-ground keywords, then the rest of the footprint's, and the
 * keyword typed at checkout always among them - last, on a slot kept for it
 * (or where it already sits, when the footprint or gaining ground has it).
 * A site with ten or more candidates would otherwise fill every slot before
 * gaining ground or the checkout keyword were reached (13 Oct 2026, review of
 * the P6 handoff). Empty with no footprint: the block only shows when one
 * exists.
 */
export function setupSuggestions(p: { latest: Pull | null; gaining: Momentum | null; tracked: ReadonlySet<string>; subject: Subject; typed: string | null }): Suggestion[] {
  if (!p.latest) return [];
  const typedKey = p.typed?.trim() ? keywordForm(p.typed) : "";
  const typed: Suggestion[] = typedKey && !p.tracked.has(typedKey) ? [{ keyword: typedKey, source: "checkout", position: null, volume: null, url: null, reason: "The keyword you gave at checkout." }] : [];
  const gaining = p.gaining ? p.gaining.rows.filter((g) => !p.tracked.has(keywordForm(g.keyword))).map((g) => fromGaining(g, p.gaining!)) : [];
  const footprint = footprintCandidates(p.latest, p.tracked, p.subject);
  const ordered = [...footprint.slice(0, SETUP_FOOTPRINT_HEAD), ...gaining, ...footprint.slice(SETUP_FOOTPRINT_HEAD)];
  const listed = dedupe(ordered, SETUP_MAX);
  if (!typed.length || listed.some((s) => keywordForm(s.keyword) === typedKey)) return listed;
  // The checkout keyword on its kept slot: as the footprint or gaining ground has it when they do, with its figures.
  const own = ordered.find((s) => keywordForm(s.keyword) === typedKey) ?? typed[0]!;
  return [...dedupe(ordered.filter((s) => keywordForm(s.keyword) !== typedKey), SETUP_MAX - 1), own];
}

/**
 * Clusters' list (spec 4.10), up to CLUSTERS_MAX: gaining ground first, then
 * the footprint's candidates. Drawn only while a cluster slot is free; the
 * page decides that.
 */
export function suggestedClusters(p: { latest: Pull | null; gaining: Momentum | null; tracked: ReadonlySet<string>; subject: Subject }): Suggestion[] {
  if (!p.latest) return [];
  const gaining = p.gaining ? p.gaining.rows.map((g) => fromGaining(g, p.gaining!)) : [];
  return dedupe([...gaining, ...footprintCandidates(p.latest, p.tracked, p.subject)], CLUSTERS_MAX);
}

/**
 * The pages' one way from a loaded footprint to the rule's answer: the
 * latest pull and the momentum rule over it (buying intent only), or nulls
 * while dark, unread or with no pull yet - the suggestions then do not draw.
 */
export function footprintFacts(fp: FootprintData, p: { tracked: readonly { keyword: string; stopped_on: Day | null }[]; subject: Subject; today: Day }): { latest: Pull | null; gaining: Momentum | null } {
  const latest = fp.enabled && fp.pulls?.ok ? fp.pulls.value.latest : null;
  if (!latest || !latest.rows.length) return { latest: null, gaining: null };
  const dismissed = new Set((fp.dismissals?.ok ? fp.dismissals.value : []).filter((d) => d.until >= p.today).map((d) => d.key));
  const previous = fp.pulls?.ok ? fp.pulls.value.previous : null;
  return { latest, gaining: momentum({ latest, previous, tracked: p.tracked, dismissed, subject: p.subject, showAll: false, today: p.today }) };
}
