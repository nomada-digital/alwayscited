/**
 * Names that are never a competitor, whatever an answer says (Luke and Danny, 5 Nov 2026: COMMON, a Craft CMS
 * agency, was shown Craft CMS, Pixel & Tonic, WordPress, Shopify, HubSpot and Sanity as the names "instead").
 * Pure; the tracking runner, the opportunity pages and the recompute all use it. The judgement that catches what a
 * list cannot - a platform's maker, a tool nobody listed - is `classifyBrands`, run by the tracking runner.
 *
 * Imports are relative and carry the extension, for the reason dataforseo-request.ts gives.
 */

import { brandKey } from "./brand-name.ts";

/**
 * Platforms and tools the work is done on or with. Only applied where the category is a service (an agency, a
 * consultancy): for a product category the same names are often the very competitors (an ecommerce platform's rival
 * is Shopify), which is the mistake AGENTS.md records the other way round.
 */
export const PLATFORMS: ReadonlySet<string> = new Set(
  [
    "WordPress", "WooCommerce", "Shopify", "Shopify Plus", "BigCommerce", "Magento", "Adobe Commerce", "Wix", "Squarespace",
    "Webflow", "Drupal", "Joomla", "Craft CMS", "Craft", "Sanity", "Contentful", "Strapi", "Storyblok", "Prismic",
    "Directus", "Payload CMS", "Statamic", "Kirby", "Umbraco", "Sitecore", "Adobe Experience Manager", "Ghost",
    "HubSpot", "Salesforce", "Marketo", "Mailchimp", "Klaviyo", "Zapier", "Notion", "Figma", "Slack", "Asana", "Jira",
    "Google", "Google Analytics", "Google Ads", "Google Cloud", "Google Cloud Storage", "Microsoft", "Azure", "Amazon",
    "AWS", "Amazon S3", "Cloudflare", "Netlify", "Vercel", "GitHub", "Git", "Docker", "DDEV", "Laravel", "React",
    "Next.js", "Vue", "Nuxt", "Gatsby", "PHP", "Semrush", "Ahrefs", "Moz", "Screaming Frog", "Yoast",
    "Meta", "Facebook", "Instagram", "LinkedIn", "YouTube", "TikTok", "X", "Twitter", "Reddit", "Pinterest",
    "ChatGPT", "OpenAI", "Gemini", "Perplexity", "Claude", "Anthropic", "Bing",
    "Clutch", "G2", "Capterra", "Trustpilot", "DesignRush", "Upwork", "Fiverr", "Toptal",
  ].map((n) => brandKey(n)),
);

/** A category whose buyers hire a service rather than buy a product. */
export function isServiceCategory(term: string): boolean {
  return /\b(agenc(y|ies)|consult(ant|ants|ancy|ancies|ing)|services?|firms?|studios?|freelanc\w*|developers?|partners?|specialists?|experts?|advis(or|ors|ers|ory))\b/i.test(term);
}

/**
 * Whether a name is ruled out as a competitor for this client. The subject of the keyword itself - "Craft CMS" for
 * "craft cms agency" - is the thing sold around, never a rival; and in a service category so is every platform.
 */
export function notACompetitor(name: string, terms: readonly (string | null | undefined)[]): boolean {
  const key = brandKey(name);
  if (!key) return true;
  const ts = terms.filter((t): t is string => Boolean(t && t.trim()));
  if (ts.some((t) => key.length >= 3 && brandKey(t).includes(key))) return true;
  // A client that sells a product as well (alwayscited: "ai visibility tracker" beside "ai seo agency") competes with
  // the tools, so the platform list only applies to a client whose every term is a service.
  return ts.some(isServiceCategory) && !ts.some(isProductCategory) && PLATFORMS.has(key);
}

/** A category that is a product or a tool, not a service. */
export function isProductCategory(term: string): boolean {
  return /\b(tools?|software|platforms?|trackers?|apps?|saas|plugins?|extensions?|systems?)\b/i.test(term);
}

/** Every term a client is tracked on, once each, for the supplier judgement: it judges against all of them. */
export function judgedTopic(terms: readonly (string | null | undefined)[]): string {
  return [...new Set(terms.filter((t): t is string => Boolean(t && t.trim())).map((t) => t.trim().toLowerCase()))].join("; ");
}
