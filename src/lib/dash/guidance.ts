/**
 * Which guide (config/guidance.ts) fits a tracked keyword, from its own
 * figures. Pure, so the rule is tested without a page.
 */

import type { KeywordView } from "./types.ts";

export type KeywordSituation = "swap" | "homepage" | "absent" | "near" | "top";

export function keywordSituation(k: Pick<KeywordView, "pos" | "pageChange" | "homepage">): KeywordSituation {
  if (k.pageChange) return "swap";
  if (k.pos === null) return "absent";
  if (k.homepage && k.pos > 3) return "homepage";
  if (k.pos <= 10) return "top";
  if (k.pos <= 20) return "near";
  return k.homepage ? "homepage" : "absent";
}
