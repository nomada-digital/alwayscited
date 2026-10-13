import type { SchemaFound } from "./own-parse.ts";
import type { Basics, KeyPage, KeywordSerp, PageCheck, SerpReading } from "./types.ts";

/**
 * Your pages' test rows (13 Oct 2026, DIY P8): a page's basics, a key page,
 * an own read, and a keyword's readings, each with the fewest fields a test
 * has to say. Test support, not a test: the runner does not run it. The
 * tracking fixture's made-up world only (tallyroo.com and .example hosts).
 */

export function basics(over: Partial<Basics> = {}): Basics {
  return {
    title: "Tallyroo | Accounting",
    description: "Accounting software.",
    canonical: "https://tallyroo.com/",
    metaRobots: null,
    xRobots: null,
    noindex: false,
    ogSiteName: "Tallyroo",
    ogImage: null,
    publishedTime: null,
    modifiedTime: null,
    byline: null,
    h1: ["Accounting software"],
    headings: [],
    images: 0,
    imagesWithAlt: 0,
    hasTable: false,
    dateShown: false,
    breadcrumbs: null,
    logo: { url: "https://tallyroo.com/logo.svg", from: "header" },
    social: ["https://linkedin.com/company/tallyroo"],
    facts: { price: false, phone: false, address: false, hours: false, priceText: null, addressText: null, phoneText: null },
    internal: [],
    markupOnly: [],
    reviewsVisible: false,
    ...over,
  };
}

export const found = (...blocks: [string[], string[]][]): SchemaFound => ({ blocks: blocks.map(([types, props]) => ({ types, props, via: "static" })), errors: 0, conflicts: [], microdata: false });

export function keyPage(over: Partial<KeyPage> & { id: string; url: string }): KeyPage {
  const u = new URL(over.url);
  return { urlKey: `${u.hostname.replace(/^www\./, "")}${u.pathname.replace(/\/+$/, "")}`, origin: "ranking", clusterIds: [], addedBy: "system", addedOn: "2026-09-01", removedOn: null, removedBy: null, ...over };
}

export function ownCheck(page: KeyPage, day: string, over: Partial<PageCheck> = {}): PageCheck {
  return {
    id: `pc-${page.id}-${day}`,
    keyPageId: page.id,
    url: page.url,
    urlKey: page.urlKey,
    checkedAt: `${day}T03:40:00.000Z`,
    via: "own",
    trigger: "scheduled",
    status: "ok",
    httpStatus: 200,
    finalUrl: page.url,
    basics: basics({ canonical: page.url }),
    fix: [],
    schemaFound: found(),
    schemaResults: null,
    contentHash: "h1",
    wordCount: 800,
    renderedWordCount: null,
    ...over,
  };
}

/** Readings, one a day ending on `last`, oldest first: each a position (null is out of the top 20) and the page that held it. */
export function readings(last: string, list: [number | null, string | null][]): SerpReading[] {
  const end = Date.parse(`${last}T00:00:00Z`);
  return list.map(([position, url], i) => ({ day: new Date(end - (list.length - 1 - i) * 86_400_000).toISOString().slice(0, 10), position, url }));
}

export function serp(keywordId: string, rs: SerpReading[], top: string[] = []): KeywordSerp {
  return { keywordId, readings: rs, top: top.map((url, i) => ({ rank: i + 1, domain: new URL(url).hostname, url })), topOn: rs[rs.length - 1]?.day ?? null };
}
