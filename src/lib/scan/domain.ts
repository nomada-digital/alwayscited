/**
 * Domain normalisation. Trim FIRST, then strip scheme, then cut everything
 * from the first path, query or fragment character, and only then strip
 * credentials, port and www - so that padded input like
 * "  https://WWW.Example.com/about " does not leave a fragment of the scheme
 * behind.
 *
 * The order of those middle two steps is load-bearing and it used to be the
 * other way round. Userinfo is everything before an "@" that contains no "/",
 * and a query string is allowed to contain an "@" - so on
 * "https://example.com?email=me@other.com" the credential strip matched
 * "example.com?email=me@" and left "other.com". The function returned a
 * different company's domain, silently and plausibly: no error, no warning,
 * and isPlausibleDomain says yes to it. Down the visitor path that is a scan
 * run and billed against a site they did not type; down the citation path in
 * engines.ts it files a source under the wrong host, which moves the
 * leaderboard. RFC 3986 does not allow "/", "?" or "#" inside userinfo
 * unencoded, so cutting at the first of them first cannot lose a real
 * credential - "https://user:pass@example.com/path" still normalises to
 * example.com.
 *
 * A backslash cuts the authority exactly as a forward slash does, and leaving
 * it out of that set was the same bug a second time. The WHATWG URL standard
 * every browser implements treats "\" as a path separator for http and https,
 * so "https://example.com\@evil.com" is example.com to every visitor who
 * pastes it - but with only "/" in the cut set the backslash survived into the
 * credential strip, "example.com\@" matched as userinfo, and the function
 * returned evil.com. Silent and plausible again: isPlausibleDomain says yes to
 * evil.com, so the scan runs and is billed against a host the browser would
 * never have gone to, and a cited URL is filed under the wrong company.
 * Verified against `new URL()` on the cases in domain.test.mts. A backslash is
 * no more legal unencoded in userinfo than a slash is, so cutting on it cannot
 * lose a real credential either.
 */
export function normalizeDomain(input: string): string {
  let d = input.trim().toLowerCase();
  d = d.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  d = d.split(/[/\\?#]/)[0];
  d = d.replace(/^[^/@]*@/, "");
  d = d.replace(/:\d+$/, "");
  d = d.replace(/^www\./, "");
  return d.replace(/\.$/, "");
}

/** A conservative hostname check: at least one dot, valid labels, plausible TLD. */
export function isPlausibleDomain(domain: string): boolean {
  if (!domain || domain.length > 253) return false;
  if (!/^[a-z0-9.-]+$/.test(domain)) return false;
  const labels = domain.split(".");
  if (labels.length < 2) return false;
  if (labels.some((l) => l.length === 0 || l.length > 63 || l.startsWith("-") || l.endsWith("-"))) {
    return false;
  }
  const tld = labels[labels.length - 1];
  return /^[a-z]{2,}$/.test(tld);
}

/**
 * Markets the free scan supports, and their Google location codes.
 *
 * JM (29 Oct 2026) is offered only from a partner's page (/partners/the-lab), never by the site's own toggle, which
 * stays UK and US (SITE_MARKETS). Tested live that day: Google's AI Overview, ChatGPT and Perplexity answer as a
 * Jamaican searcher (JN Bank, NCB, Hi-Lo, Kingston) at location 2388 / country JM; Gemini answers generically or
 * errors there, as it often does in the US too. DataForSEO Labs has no Jamaica, so nothing that reads Labs by
 * market may be given JM (dataforseo.ts readRankingFootprint only ever asks UK and US).
 */
export const MARKETS = {
  UK: { location_code: 2826, label: "United Kingdom" },
  US: { location_code: 2840, label: "United States" },
  JM: { location_code: 2388, label: "Jamaica" },
} as const;

export type Market = keyof typeof MARKETS;

/** The two the site offers on its own pages; JM is a partner's (see MARKETS). */
export const SITE_MARKETS: readonly Market[] = ["UK", "US"];

/**
 * UK or US: what every table outside `scans` holds (client_domains, campaigns, walkthrough_requests, the DIY tools
 * and tracking all check market in ('UK','US')), so everything but the free check keeps reading it this way.
 */
export function isMarket(v: unknown): v is Market {
  return v === "UK" || v === "US";
}

/** Any market a free scan may be run in, JM included (29 Oct 2026). Only the scan's own doors read this. */
export function isScanMarket(v: unknown): v is Market {
  return v === "UK" || v === "US" || v === "JM";
}

/** "the United Kingdom", "the United States", "Jamaica": the market as a sentence names it. */
export function marketPlace(m: Market): string {
  return m === "JM" ? "Jamaica" : `the ${MARKETS[m].label}`;
}

/** "the UK", "the US", "Jamaica": the short form. */
export function marketShort(m: Market): string {
  return m === "JM" ? "Jamaica" : `the ${m}`;
}
