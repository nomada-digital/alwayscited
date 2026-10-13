import { knownKind, matchKnown, REVIEW_SITES } from "../../scan/source-kinds.ts";

import type { DomainType, PageType } from "./types.ts";

/**
 * Page and domain types by rule (13 Oct 2026, DIY P7; spec 10 section 6.2,
 * "Classification"). Pure. What the rules settle is final; only what they
 * leave unclassified goes to the model (classify.job.ts), and until it is
 * typed the competitor rule fails closed for it (derive.ts).
 *
 * Page type, from the URL's path and the title, in this order (the first
 * that holds wins):
 *
 * | Signal                                                         | Page type        |
 * |----------------------------------------------------------------|------------------|
 * | a reddit, quora or stackexchange host, or a path with /r/, /thread, /forum, /community, a Q&A path, /t/ | thread |
 * | the path is "/" (or empty)                                     | homepage         |
 * | "review" on a review platform's host                           | review_profile   |
 * | " vs " or "-vs-"                                               | comparison       |
 * | "alternative"                                                  | alternatives     |
 * | "best", "top-N", "N-best"                                      | best_of          |
 * | "how-to", "/guide"                                             | how_to           |
 * | /product, /pricing, /features                                  | product          |
 * | /category/, /collections/                                      | category         |
 * | /blog/, /news/                                                 | article          |
 *
 * A homepage is read from its URL before its title, so a homepage titled
 * "Ledgerline - the best accounting app" stays a homepage. Comparisons and
 * alternatives are read before best-of, so "10 best alternatives to X" is an
 * alternatives page.
 *
 * Domain type: the review and directory sites the scan already keeps
 * (source-kinds.ts REVIEW_SITES), community hosts, video, the encyclopaedia,
 * and government and academic sites. The engines' own properties are not
 * typed: they are left out of every list (`isEngineProperty`).
 */

/** The engines' own properties (section 6.2 step 2): google.* and its subdomains, and the engines' and model makers' sites. */
const ENGINE_HOSTS = ["bing.com", "openai.com", "chatgpt.com", "perplexity.ai", "anthropic.com"];

/** Lowercase host, no www. */
export const bare = (host: string): string => host.trim().toLowerCase().replace(/^www\./, "").replace(/\.$/, "");

const under = (host: string, site: string) => host === site || host.endsWith(`.${site}`);

/** Whether a host is one of the engines' own: Google in any country, Bing, OpenAI, ChatGPT, Perplexity, Anthropic. */
export function isEngineProperty(host: string): boolean {
  const h = bare(host);
  if (/(^|\.)google\.[a-z.]{2,6}$/.test(h)) return true;
  return ENGINE_HOSTS.some((s) => under(h, s));
}

const COMMUNITY = ["reddit.com", "quora.com", "stackexchange.com"];

/** A domain's type by rule, or null to ask the model. */
export function domainTypeByRule(host: string): DomainType | null {
  const h = bare(host);
  if (!h || isEngineProperty(h)) return null;
  const review = matchKnown(h, REVIEW_SITES);
  if (review) return /directory/i.test(review) && !/review/i.test(review) ? "directory" : "review_platform";
  if (COMMUNITY.some((s) => under(h, s)) || /^(forum|forums|community|discuss|discussions)\./.test(h)) return "community";
  if (under(h, "youtube.com") || h === "youtu.be") return "video";
  if (under(h, "wikipedia.org")) return "reference";
  // Government and academic sites, as the scan's own table settles them (source-kinds.ts knownKind).
  const known = knownKind(h)?.note;
  if (known === "Government site" || known === "Academic site") return "institutional";
  return null;
}

/** A URL's host and path, lowercase, without a query or fragment; null for anything that is not an http(s) URL. */
function parts(url: string): { host: string; path: string } | null {
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `https://${url}`);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return { host: bare(u.hostname), path: decodeURIComponent(u.pathname).toLowerCase() };
  } catch {
    return null;
  }
}

const THREAD_PATH = /\/r\/|\/threads?(\/|$)|\/forums?(\/|$)|\/community(\/|$)|\/[q]uestions\/|\/t\//;
const VS = /(^|[\s/_-])vs\.?([\s/_-]|$)|-vs-/;
const ALTERNATIVE = /alternative/;
const BEST = /(^|[\s/_-])best([\s/_-]|$)|(^|[\s/_-])top[\s_-]\d+([\s/_-]|$)|(^|[\s/_-])\d+[\s_-]best([\s/_-]|$)/;
const HOW_TO = /how[\s_-]to|\/guides?(\/|$)/;
const PRODUCT = /\/(products?|pricing|features)(\/|$)/;
const CATEGORY = /\/(category|categories|collections)\//;
const ARTICLE = /\/(blog|news)\//;

/**
 * A page's type by rule from its URL and, when read, its title; null to ask
 * the model. `domainType` is the domain's own type when known, so a review
 * platform's review page is a review profile.
 */
export function pageTypeByRule(url: string, title: string | null = null, domainType: DomainType | null = null): PageType | null {
  const p = parts(url);
  if (!p) return null;
  const t = (title ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  const both = `${p.path} ${t}`;
  const community = COMMUNITY.some((s) => under(p.host, s));
  if (community || THREAD_PATH.test(p.path)) return "thread";
  if (p.path === "" || p.path === "/") return "homepage";
  const reviewHost = (domainType ?? domainTypeByRule(p.host)) === "review_platform";
  if (reviewHost && /review/.test(both)) return "review_profile";
  if (VS.test(p.path) || / vs\.? /.test(` ${t} `)) return "comparison";
  if (ALTERNATIVE.test(both)) return "alternatives";
  if (BEST.test(p.path) || BEST.test(t)) return "best_of";
  if (HOW_TO.test(both)) return "how_to";
  if (PRODUCT.test(p.path)) return "product";
  if (CATEGORY.test(p.path)) return "category";
  if (ARTICLE.test(p.path)) return "article";
  return null;
}

/** The source_kinds keys for a domain and a page. */
export const domainKey = (host: string): string => `d:${bare(host)}`;
export const pageKey = (urlKey: string): string => `p:${urlKey}`;
