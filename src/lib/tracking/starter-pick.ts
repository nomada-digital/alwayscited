import { keywordForm } from "../scan/dataforseo-request.ts";
import { pickClusterKeyword } from "../scan/target-keyword.ts";
import type { Intent } from "../scan/dataforseo-request.ts";

import { draftPrompts, refuseDrafts } from "./add-cluster.ts";
import { otherForm } from "./plural.ts";

/**
 * Starter clusters (Danny, 22 Oct 2026): no paying customer sits without a reading. A signup whose scan gave no
 * keyword or no usable prompt (no scan at all, a scan from the other market, or every scan prompt named the brand),
 * and every extra cluster a managed plan buys, gets a cluster made for it from the buyer's site in the market paid
 * for: the keyword picked by the scan's own rule (pickClusterKeyword - measured Google volume in that market, a
 * commercial or transactional intent, the highest wins) and five prompts drafted the way setup drafts them
 * (draftPrompts, one per angle in ANGLES order), each naming the market where a buyer would say it.
 *
 * Pure: the picks from the reads, and the market's drafts. starter.ts makes the reads and the writes.
 */

export type StarterPick = { keyword: string; volume: number; intent: "commercial" | "transactional" };

/**
 * Up to `count` keywords from the candidates, best first, each by pickClusterKeyword's rule over what is left.
 * A keyword already tracked, or the other form of one picked or tracked ("seo agency" / "seo agencies"), is never
 * picked: two clusters on one search would measure the same thing twice.
 */
export function pickStarters(
  candidates: readonly string[],
  volumes: ReadonlyMap<string, number | null>,
  intents: ReadonlyMap<string, Intent | null>,
  count: number,
  taken: readonly string[] = [],
): StarterPick[] {
  const blocked = new Set<string>();
  const block = (k: string) => {
    const f = keywordForm(k);
    blocked.add(f);
    const o = otherForm(f);
    if (o) blocked.add(keywordForm(o.keyword));
  };
  taken.forEach(block);
  const out: StarterPick[] = [];
  let left = [...new Set(candidates.map(keywordForm).filter(Boolean))].filter((k) => !blocked.has(k));
  while (out.length < count && left.length) {
    const p = pickClusterKeyword(left, volumes, intents);
    if ("none" in p) break;
    out.push(p);
    block(p.keyword);
    left = left.filter((k) => !blocked.has(k));
  }
  return out;
}

const MARKET_WORDS: Record<string, string> = { UK: "in the UK", US: "in the US" };

/**
 * Setup's five drafts for a keyword (draftPrompts, ANGLES order: category, positioning, sector, outcome,
 * comparison), with the market named in the two a buyer would place - "What are the best seo agencies in the UK?",
 * "Which seo agencies do small businesses in the UK recommend?" - so the engines answer for the market paid for.
 * Falls back to the plain drafts if the market's would break the drafts' rule (length, two the same).
 */
export function marketDrafts(keyword: string, market: string): string[] {
  const base = draftPrompts(keyword);
  const where = MARKET_WORDS[market];
  if (!where) return base;
  const out = base.map((p, i) => (i === 0 ? p.replace(/\?$/, ` ${where}?`) : i === 2 ? p.replace(/small businesses/, `small businesses ${where}`) : p));
  return refuseDrafts(out) ? base : out;
}

/** The candidates' topics, most likely first: the site's category, then its phrases for what it sells, each once. */
export function starterTopics(topic: string | null, variants: readonly string[] = [], services: readonly string[] = []): string[] {
  const all = [topic, ...variants, ...services].map((t) => String(t ?? "").trim().toLowerCase()).filter((t) => t.length >= 3 && t.length <= 120);
  return [...new Set(all)];
}
