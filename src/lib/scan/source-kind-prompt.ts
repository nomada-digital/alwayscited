/**
 * The words `classifyBatch` in anthropic.ts sends when it sorts cited domains
 * into competitor, placement and other.
 *
 * Pure and on its own so `source-kind-prompt.test.mts` can read the rule
 * without the SDK or a network - anthropic.ts is server-only.
 *
 * 25 September 2026 (N9): on scan 28a07760 the placement list carried
 * nextiva.com, getvoip.com, oncehub.com, dapta.ai, herothemes.com and
 * cloudtalk.io - category vendors cited for their own blog posts and
 * listicles. A competitor's blog is not somewhere an agency can place a
 * client. Two things let them through: the prompt called any "blog" or
 * "listicle site" a placement, and the leaderboard it was given was empty,
 * because the classification read `scan_brands` before the brand chain had
 * written it. The rule below settles the first; sources.ts and pipeline.ts
 * settle the second.
 */

export type SourceDomain = { domain: string; pages: { url: string | null; title: string | null }[] };

/** Query strings are most of the length of a cited URL and none of the meaning. */
export function trimUrl(url: string | null): string {
  if (!url) return "";
  const cut = url.split("?")[0].split("#")[0];
  return cut.length > 120 ? `${cut.slice(0, 120)}...` : cut;
}

/**
 * The same for every scan (8 Nov 2026, prompt caching): the category is in the request's context block, so this
 * prompt and that block are cached and a scan's later batches read both.
 */
export function sourceKindSystem(): string {
  return [
    "You are given website domains that AI search engines cited when answering",
    "buyers' questions about the category named in the request. Sort each one.",
    "",
    "competitor: the domain belongs to a company that sells this to the same",
    "buyers. A domain that is plainly one of the named competitors is a",
    "competitor. So is a seller in this category you recognise even when it is",
    "not named.",
    "",
    "A site that sells a product or service in this category is a competitor",
    "EVEN WHEN the cited page is a blog post, a guide, a listicle or a",
    "comparison. A vendor ranking itself against its rivals on its own blog is",
    "still a vendor: nobody can be placed on a competitor's own site. Judge",
    "what the company sells, not what the page looks like.",
    "",
    "placement: an independent publication, magazine, newspaper, trade title,",
    "industry body, comparison or listicle site, or any editorial site that",
    "does not itself sell in this category, where an article about this",
    "category could be published, or a brand written into an existing one.",
    "",
    "other: anything else. A community or social site, an encyclopaedia, a",
    "government or academic site, a marketplace, a search engine's own",
    "property, a tool or product unrelated to the category.",
    "",
    "Then judge on_topic SEPARATELY from kind, using the page titles and URLs",
    "under each domain. kind is what the site is; on_topic is whether these",
    "particular pages are about this category. A national newspaper is a",
    "placement, but a page about horse racing owners or an unrelated company",
    "filing is not on topic, and neither is a fashion title cited for a shoe",
    "trends piece. Set on_topic false whenever the cited pages are about",
    "something else, however good the publication. Being unsure is not a",
    "reason to say true.",
    "",
    "The note is one short line a business reader takes in at a glance: what",
    "the site is and, for a placement, who reads it. Twelve words at most. No",
    "marketing language. Examples: 'UK trade title for finance teams',",
    "'Sells the same thing to the same buyers', 'Comparison site ranking",
    "suppliers in this category'.",
    "",
    "Return every domain you were given, spelled exactly as given, once each.",
  ].join("\n");
}

/** The scan's context: who the subject is, its category and the competitors named. The cached block. */
export function sourceKindContext(input: { topic: string; brand: string; competitors: string[] }): string {
  return [
    `Subject brand: ${input.brand}`,
    `Category: ${input.topic || "not stated"}`,
    `Named competitors (the brands the engines named instead of the subject): ${
      input.competitors.length ? input.competitors.join(", ") : "none identified"
    }`,
  ].join("\n");
}

/** One batch's domains, each with the pages the engines cited. */
export function sourceKindDomains(domains: SourceDomain[]): string {
  return [
    "Domains, each with the pages the engines cited:",
    ...domains.flatMap((d) => [
      `- ${d.domain}`,
      ...d.pages.slice(0, 3).map((p) => `    ${p.title ?? "(no title)"}  ${trimUrl(p.url)}`),
    ]),
  ].join("\n");
}

/** The whole request as one text: the context, then the domains (as the call sends it, in two blocks). */
export function sourceKindRequest(
  input: { topic: string; brand: string; competitors: string[] },
  domains: SourceDomain[],
): string {
  return `${sourceKindContext(input)}\n\n${sourceKindDomains(domains)}`;
}
