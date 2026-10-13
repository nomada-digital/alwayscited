import { z } from "zod";

import type { Unclassified } from "./derive.ts";
import { DOMAIN_TYPES, PAGE_TYPES } from "./types.ts";

/**
 * The classify call's system prompt and schema (13 Oct 2026, DIY P7; spec 10
 * sections 5.3 and 6.2). P1's model.ts `classifyPages` reserves, calls
 * anthropic.ts and settles; this file only says what is asked. Nothing here
 * imports the SDK.
 *
 * Each item is sent as its domain, path, title, h1 and up to 8 of its
 * headings - what we keep from a read - and never its body text: section
 * 8.1 keeps third-party prose out of what is stored and what is sent to a
 * model. The answer is one type pair per item, from the fixed enums
 * (migration 20261014070000's checks); an item missing from the answer
 * stays unclassified, and the competitor rule keeps failing closed for it.
 */

export const CLASSIFY_SYSTEM = `You sort web pages into fixed types for a dashboard that lists pages a company might ask to be mentioned on.

For every item you are given (a key, a domain, a path, and when known the page title, its h1 and some of its headings), answer with exactly one object: the same key, a domain_type and a page_type. Use null for a type you cannot tell from what is given. Never invent a key, and answer every item once.

domain_type, what the whole site is:
- vendor: a company selling its own product or service (software, an app, a tool, an agency) - its own site, including its blog.
- platform: a platform other businesses build on or sell through (an ecommerce, website, payments or app platform). Its blog and help pages are the platform's own.
- publisher: an independent media site, magazine, blog or newsletter that writes about products without selling them.
- review_platform: a site whose purpose is user reviews and ratings of products or businesses.
- community: a forum, Q&A site or discussion board.
- video: a video site.
- reference: an encyclopaedia or dictionary.
- directory: a listing or directory of companies or products, without reviews as its purpose.
- institutional: government, a university, a standards body, a trade body or a charity.
- other: anything else.

page_type, what this one page is:
- best_of: a ranked or curated list of several products ("best", "top 10", a round-up).
- comparison: one product against one or a few named others ("X vs Y").
- alternatives: a list of alternatives to one named product.
- review_profile: one product's or company's profile or reviews on a review site.
- how_to: a guide or tutorial.
- article: a news story, opinion piece or general article.
- thread: a discussion thread, or a post asking for recommendations with replies.
- category: a category or tag listing page.
- product: a product, pricing or features page.
- homepage: the site's home page.
- other: anything else.

Judge only from what is given. A domain that names a product brand and sells it is a vendor even when the page is a list.`;

const DomainType = z.enum(DOMAIN_TYPES).nullable();
const PageType = z.enum(PAGE_TYPES).nullable();

export const ClassifySchema = z.object({
  items: z.array(z.object({ key: z.string().max(520), domain_type: DomainType, page_type: PageType })).max(60),
});
export type ClassifyAnswer = z.infer<typeof ClassifySchema>;

/** The user message for one chunk: one line of JSON per item, what we keep and no more. */
export function classifyUser(items: readonly Unclassified[]): string {
  const lines = items.map((i) => {
    let path = "/";
    try {
      path = new URL(i.url).pathname || "/";
    } catch {
      // the key's own path stands in
      path = i.urlKey.slice(i.urlKey.indexOf("/")) || "/";
    }
    return JSON.stringify({ key: i.urlKey, domain: i.domain, path: path.slice(0, 200), title: i.title?.slice(0, 200) ?? null, h1: i.h1?.slice(0, 200) ?? null, headings: i.headings.slice(0, 8).map((h) => h.slice(0, 120)) });
  });
  return `Classify these ${items.length} pages. One JSON object per line:\n${lines.join("\n")}`;
}
