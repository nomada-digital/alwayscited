import { PROMPT_MAX, PROMPT_MIN } from "../../tracking/prompt-text.ts";

import { type TitlePrompt, promptFromTitle, wordCount } from "./title-rule.ts";

/**
 * The prompt a pursued opportunity offers (13 Oct 2026, DIY P2 rules; P7's
 * route calls it; spec 10 section 6.7). Pure.
 *
 * | Page type                              | Rule                                              |
 * |----------------------------------------|---------------------------------------------------|
 * | best_of, comparison, alternatives      | the title rule                                    |
 * | thread                                 | its title when it reads as a request, else the title rule |
 * | review_profile, directory              | "best <cluster keyword>" (usually a duplicate, which links the existing prompt) |
 * | article, how_to, and any other page    | the title rule                                    |
 * | a link lens (link_domain, link_page, mention) | none: the page is watched, not asked       |
 *
 * A thread reads as a request when it ends with "?" or starts with how, what,
 * which, best or recommend. Its words are the asker's, so they are kept as
 * written, cut at the site's own separator (" : r/freelance", " - Forum").
 */

export const LINK_LENSES = ["link_domain", "link_page", "mention"] as const;
export const WATCH_ONLY = "link targets are watched, not asked";
export const NO_KEYWORD = "its cluster has no keyword yet";

export type OpportunityInput = { lens: string; page_type: string | null; keyword?: string | null };
export type PageInput = { title: string | null; h1?: string | null };

/** The types the title rule is named for; any type not in the table reads as an article and takes it too. */
export const TITLE_RULE_TYPES = ["best_of", "comparison", "alternatives", "article", "how_to"] as const;
const KEYWORD_TYPES = new Set(["review_profile", "directory"]);
const REQUEST = /^(how|what|which|best|recommend)\b/i;
const THREAD_SITE = / : r\/\S+$| \| [^|]+$| - [^-]+$| \u2013 [^\u2013]+$/;

/** A thread's title as its asker wrote it, the forum's name cut, spaces collapsed; null when it is not a request. */
export function threadRequest(title: string | null | undefined): string | null {
  const t = (title ?? "").replace(/\s+/g, " ").trim().replace(THREAD_SITE, "").trim();
  if (!t) return null;
  return t.endsWith("?") || REQUEST.test(t) ? t : null;
}

/** The prompt an opportunity offers, or why none. `market` is the client's, for the title rule's qualifier. */
export function promptForOpportunity(opp: OpportunityInput, page: PageInput, market: string | null | undefined): TitlePrompt {
  if ((LINK_LENSES as readonly string[]).includes(opp.lens)) return { ok: false, reason: WATCH_ONLY };
  const title = page.title?.trim() || page.h1?.trim() || null;
  const type = opp.page_type ?? "";
  if (KEYWORD_TYPES.has(type)) {
    const kw = (opp.keyword ?? "").replace(/\s+/g, " ").trim().toLowerCase();
    if (!kw) return { ok: false, reason: NO_KEYWORD };
    const text = kw.startsWith("best ") ? kw : `best ${kw}`;
    return text.length >= PROMPT_MIN && text.length <= PROMPT_MAX && wordCount(text) >= 2 ? { ok: true, text } : { ok: false, reason: NO_KEYWORD };
  }
  if (type === "thread") {
    const asked = threadRequest(title);
    if (asked && asked.length >= PROMPT_MIN && asked.length <= PROMPT_MAX && wordCount(asked) >= 3) return { ok: true, text: asked };
    return promptFromTitle(title, market);
  }
  // TITLE_RULE_TYPES, and any type not named, which reads as an article.
  return promptFromTitle(title, market);
}
