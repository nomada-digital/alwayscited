/**
 * Ranking researched keywords for a business or a consumer audience (18 Oct
 * 2026). Pure: the words in config/keyword-audience.ts and DataForSEO's
 * intent, nothing else, so the same search always ranks the same way.
 *
 * A keyword scores +2 for a word of its own side and -2 for a word of the
 * other side; intent adds +1 where it fits the side (commercial for business
 * buyers, transactional for consumers) and +0.5 for the next best, and a
 * navigational search - someone looking for one brand - loses 1. Keywords
 * with a positive score come first, by score then volume; neutral ones fill
 * in after them so a narrow seed still returns something; keywords that read
 * as the other side are dropped.
 */

import { AUDIENCE_TERMS, SECTOR_AUDIENCE, type Audience } from "../../config/keyword-audience.ts";

export type Ranked<T> = T & { fit: number };
type Row = { keyword: string; volume: number | null; intent: string | null };

const pattern = (words: readonly string[]) => new RegExp(`(?<![\\p{L}\\p{N}])(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?![\\p{L}\\p{N}])`, "iu");
const B2B = pattern(AUDIENCE_TERMS.b2b);
const B2C = pattern(AUDIENCE_TERMS.b2c);

export function audienceFit(row: Row, audience: Audience): number {
  if (audience === "all") return 0;
  const own = audience === "b2b" ? B2B : B2C;
  const other = audience === "b2b" ? B2C : B2B;
  let fit = 0;
  if (own.test(row.keyword)) fit += 2;
  if (other.test(row.keyword)) fit -= 2;
  const best = audience === "b2b" ? "commercial" : "transactional";
  const next = audience === "b2b" ? "transactional" : "commercial";
  if (row.intent === best) fit += 1;
  else if (row.intent === next) fit += 0.5;
  else if (row.intent === "navigational") fit -= 1;
  return fit;
}

/** Merge, de-duplicate, rank and filter for an audience. "all" keeps the vendor's order by volume. */
export function rankForAudience<T extends Row>(rows: readonly T[], audience: Audience, limit = 60): Ranked<T>[] {
  const seen = new Set<string>();
  const unique = rows.filter((r) => {
    const k = r.keyword.toLowerCase().trim();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const scored = unique.map((r) => ({ ...r, fit: audienceFit(r, audience) }));
  if (audience === "all") return scored.sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0)).slice(0, limit);
  const byFit = (a: Ranked<T>, b: Ranked<T>) => b.fit - a.fit || (b.volume ?? 0) - (a.volume ?? 0);
  const fits = scored.filter((r) => r.fit > 0).sort(byFit);
  const neutral = scored.filter((r) => r.fit === 0).sort(byFit);
  return [...fits, ...neutral].slice(0, limit);
}

/** The toggle's starting value for a client: its order's sector when that says, else All. */
export function defaultAudience(sector: string | null | undefined): Audience {
  return (sector && SECTOR_AUDIENCE[sector]) || "all";
}
