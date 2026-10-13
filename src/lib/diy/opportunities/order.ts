import type { Day } from "../../tracking/figures.ts";

import type { OppEvidence, PageType } from "./types.ts";

/**
 * The order opportunities are listed in (13 Oct 2026, DIY P7; spec 10
 * section 6.2, "Ordering", and section 1.1 row 31). Lexicographic, stated on
 * the page in words, with no hidden weight: the stated rule is the whole
 * rule. Pure.
 *
 * 1. answers citing it that leave you out (28 days), most first;
 * 2. distinct prompts citing it, most first;
 * 3. a best-of list or a comparison first;
 * 4. ranks in Google's top 10 for a cluster keyword first;
 * 5. cited in the last 7 days first;
 * 6. first seen, newest first.
 */

export const ORDER_LINE =
  "Most answers that cite it and leave you out first, then most of your prompts, then best-of lists and comparisons, then pages that rank on page 1 for one of your keywords, then still cited this week, then newest.";

/** The stored tuple (opportunities.order_key): five counts and flags, then the first-seen day. */
export type OrderKey = [number, number, number, number, number, Day];

export function orderKey(e: Pick<OppEvidence, "leaves_out" | "prompt_count" | "rank" | "days_7">, pageType: PageType | null, firstSeen: Day | null): OrderKey {
  return [
    e.leaves_out,
    e.prompt_count,
    pageType === "best_of" || pageType === "comparison" ? 1 : 0,
    e.rank !== null && e.rank <= 10 ? 1 : 0,
    e.days_7 > 0 ? 1 : 0,
    firstSeen ?? "0000-00-00",
  ];
}

/** Sorts by the stated order; ties keep their url order, so the list never shuffles between loads. */
export function compareOrder(a: { key: OrderKey; urlKey: string }, b: { key: OrderKey; urlKey: string }): number {
  for (let i = 0; i < 5; i++) {
    const d = (b.key[i] as number) - (a.key[i] as number);
    if (d) return d;
  }
  if (a.key[5] !== b.key[5]) return a.key[5] < b.key[5] ? 1 : -1;
  return a.urlKey < b.urlKey ? -1 : a.urlKey > b.urlKey ? 1 : 0;
}

/** A stored order_key read back, or the key from the row's own evidence when it is missing or malformed. */
export function readOrderKey(v: unknown, fallback: OrderKey): OrderKey {
  if (!Array.isArray(v) || v.length !== 6) return fallback;
  const nums = v.slice(0, 5);
  if (!nums.every((n) => typeof n === "number" && Number.isFinite(n)) || typeof v[5] !== "string") return fallback;
  return [...(nums as number[]), v[5]] as OrderKey;
}
