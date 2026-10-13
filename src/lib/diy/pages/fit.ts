import { urlKey } from "../../tracking/placements.ts";
import type { KeywordSerp, SerpReading, TopResult } from "./types.ts";

/**
 * Page fit (13 Oct 2026, DIY P8; spec 10 section 6.4): for one cluster this
 * page serves, does the page match what Google ranks for the cluster's
 * keyword? Pure, over the keyword's own readings (tracking_serp: the
 * client's position and ranking URL, day by day, and the latest page of
 * results). Four verdicts, read in this order, each with its denominator:
 *
 * | Verdict | Rule |
 * |---|---|
 * | No page | the ranking URL is the homepage, or none of the client's pages is in the top 20 on at least 20 of the keyword's last 28 readings |
 * | Two pages take turns | 2 or more of the client's URLs held the position on different days in the last 28 readings, with the days each held |
 * | Different page type | of the top 10 we can type by rule (the top 3 by their titles too), at least 7 are of one type, and the rules do not give the client's page that type |
 * | Fits | none of the above, the basics pass, and the schema is valid or not needed |
 *
 * A page whose basics or schema do not pass reads "fix first", not Fits:
 * Fits says the page is probably not the problem, which a 404, a noindex or
 * a missing block is. A keyword out of the top 20 at its latest reading, on
 * fewer than 20 of its readings, is said as that ("not in the top 20"),
 * never read as a fit. A keyword with no reading yet has no verdict.
 *
 * Types by rule only - the URL's path and, for the top 3, the title. A result
 * the rules cannot type is left out of the denominator, never guessed. The
 * model-typed pages P7 classifies (source_kinds) are not read here: fit must
 * stand on rules and its stated count.
 */

export const FIT_READINGS = 28;
export const NO_PAGE_MIN = 20;
export const DIFFERENT_MIN = 7;
export const TOP_TYPED = 10;

export const PAGE_TYPES = ["best_of", "comparison", "alternatives", "review_profile", "how_to", "article", "category", "product", "homepage"] as const;
export type PageType = (typeof PAGE_TYPES)[number];

/** The words each type is called, as "Google answers 'x' with ..." uses them. */
export const TYPE_PLURAL: Record<PageType, string> = {
  best_of: "best-of lists",
  comparison: "comparisons",
  alternatives: "alternatives pages",
  review_profile: "review profiles",
  how_to: "how-to guides",
  article: "articles",
  category: "category pages",
  product: "product pages",
  homepage: "homepages",
};
export const TYPE_ONE: Record<PageType, string> = {
  best_of: "a best-of list",
  comparison: "a comparison",
  alternatives: "an alternatives page",
  review_profile: "a review profile",
  how_to: "a how-to guide",
  article: "an article",
  category: "a category page",
  product: "a product page",
  homepage: "a homepage",
};

const REVIEW_HOSTS = /(^|\.)(g2|capterra|getapp|softwareadvice|trustradius|trustpilot|producthunt|alternativeto|clutch|yelp|tripadvisor)\./;

/** A page's type by rule, from its URL and (when known) its title; null when the rules cannot tell. */
export function typeByRule(url: string, title: string | null = null): PageType | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const path = u.pathname.toLowerCase().replace(/\/+$/, "");
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  const t = (title ?? "").toLowerCase();
  const both = `${path} ${t}`;
  if (path === "" || path === "/index.html") return "homepage";
  if (/\balternatives?\b/.test(both)) return "alternatives";
  if (/(-vs-|\bvs\.?\b|\bversus\b|\bcompare\b|\bcomparison\b)/.test(both)) return "comparison";
  if (/\b(best|top-\d+|top \d+|\d+-best|\d+ best)\b/.test(both)) return "best_of";
  if (REVIEW_HOSTS.test(`.${host}`) && /(review|product|software|listing|company)/.test(path)) return "review_profile";
  if (/(how-to|how to|\bguide\b|tutorial)/.test(both)) return "how_to";
  if (/\/(blog|news|articles?|posts?|insights)\//.test(`${path}/`)) return "article";
  if (/\/(category|categories|collections?|c)\//.test(`${path}/`)) return "category";
  if (/\/(products?|pricing|features?|software|app|solutions?)(\/|$)/.test(`${path}/`)) return "product";
  return null;
}

export type FitVerdict =
  | { kind: "none_read" }
  | { kind: "no_page"; homepage: boolean; out: number; readings: number }
  | { kind: "split"; held: { urlKey: string; days: number }[]; readings: number }
  | { kind: "different"; dominant: PageType; n: number; typed: number; yours: PageType | null }
  | { kind: "out"; out: number; readings: number }
  | { kind: "fix_first"; what: "basics" | "schema" }
  | { kind: "fits"; offPage1: number; readings: number };

export type FitInput = {
  /** The client's page, as a url_key. */
  pageKey: string;
  pageUrl: string;
  pageTitle: string | null;
  /** The client's homepage, as a url_key. */
  homeKey: string;
  serp: KeywordSerp;
  /** Titles of the top 3, by url_key, when read (top_structures). */
  titles: ReadonlyMap<string, string | null>;
  basicsPass: boolean;
  schemaOk: boolean;
};

/** The keyword's last FIT_READINGS readings: the days it was read. A day it was not read is not a reading. */
export function lastReadings(readings: readonly SerpReading[], n = FIT_READINGS): SerpReading[] {
  return [...readings].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0)).slice(-n);
}

/** The latest page of results' top 10, typed where the rules can (the top 3 by title too). */
export function typedTop(top: readonly TopResult[], titles: ReadonlyMap<string, string | null>): { url: string; type: PageType | null }[] {
  return [...top]
    .sort((a, b) => a.rank - b.rank)
    .slice(0, TOP_TYPED)
    .map((r, i) => ({ url: r.url, type: typeByRule(r.url, i < 3 ? (titles.get(urlKey(r.url) ?? "") ?? null) : null) }));
}

export function fitVerdict(p: FitInput): FitVerdict {
  const last = lastReadings(p.serp.readings);
  if (!last.length) return { kind: "none_read" };
  const latest = last[last.length - 1]!;
  const latestKey = latest.url ? urlKey(latest.url) : null;
  const out = last.filter((r) => r.position === null).length;
  if ((latest.position !== null && latestKey === p.homeKey) || out >= NO_PAGE_MIN) {
    return { kind: "no_page", homepage: latest.position !== null && latestKey === p.homeKey, out, readings: last.length };
  }
  // Out of the top 20 now, on fewer readings than No page asks for: said as it is, never read as a fit.
  if (latest.position === null) return { kind: "out", out, readings: last.length };
  const held = new Map<string, number>();
  for (const r of last) {
    if (r.position === null || !r.url) continue;
    const k = urlKey(r.url);
    if (k) held.set(k, (held.get(k) ?? 0) + 1);
  }
  if (held.size >= 2) return { kind: "split", held: [...held].map(([urlKey, days]) => ({ urlKey, days })).sort((a, b) => b.days - a.days), readings: last.length };
  const yours = typeByRule(p.pageUrl, p.pageTitle);
  // The client's own results are not "what Google answers with" against its own page.
  const ownHost = p.homeKey.split("/")[0]!;
  const typed = typedTop(p.serp.top, p.titles).filter((x): x is { url: string; type: PageType } => {
    const host = (urlKey(x.url) ?? "").split("/")[0]!;
    return x.type !== null && host !== ownHost && !host.endsWith(`.${ownHost}`);
  });
  // One type answers for at least DIFFERENT_MIN of the typed results, and the rules do not give the client's page that type.
  const counts = new Map<PageType, number>();
  for (const x of typed) if (x.type !== yours) counts.set(x.type, (counts.get(x.type) ?? 0) + 1);
  const dominant = [...counts].sort((a, b) => b[1] - a[1])[0];
  if (dominant && dominant[1] >= DIFFERENT_MIN) return { kind: "different", dominant: dominant[0], n: dominant[1], typed: typed.length, yours };
  if (!p.basicsPass || !p.schemaOk) return { kind: "fix_first", what: !p.basicsPass ? "basics" : "schema" };
  return { kind: "fits", offPage1: last.filter((r) => r.position !== null && r.position >= 11 && r.position <= 20).length, readings: last.length };
}

/** The list's Fit chip (section 4.9): Fits · Different page type · No page · Two pages take turns. */
export function fitChip(v: FitVerdict | null): { label: string; tone: "good" | "warn" | "bad" | "none" } {
  if (!v || v.kind === "none_read") return { label: "Not read yet", tone: "none" };
  switch (v.kind) {
    case "no_page":
      return { label: "No page", tone: "bad" };
    case "split":
      return { label: "Two pages take turns", tone: "warn" };
    case "different":
      return { label: "Different page type", tone: "warn" };
    case "out":
      return { label: "Not in the top 20", tone: "warn" };
    case "fix_first":
      return { label: "Fix first", tone: "warn" };
    case "fits":
      return { label: "Fits", tone: "good" };
  }
}

/** What to publish of one's own, by the type Google answers with. */
export function ownRoute(t: PageType): string {
  if (t === "best_of" || t === "comparison") return "your own comparison";
  if (t === "how_to" || t === "article") return "a guide that answers it";
  if (t === "review_profile") return "on the review sites where you have a profile";
  return `${TYPE_ONE[t]} of your own`;
}

/** The fit's words: the advice id and its blanks. `count` is the Opportunities count for this cluster's lists, or null while it cannot be read. */
export function fitWords(v: FitVerdict, keyword: string, count: number | null): { id: string; vars: Record<string, string | number> } | null {
  switch (v.kind) {
    case "none_read":
      return null;
    case "no_page":
      return v.homepage ? { id: "pages.fit.homepage", vars: { keyword } } : { id: "pages.fit.no_page", vars: { keyword } };
    case "split":
      return { id: "pages.fit.split", vars: {} };
    case "different":
      return {
        id: "pages.fit.different",
        vars: {
          keyword,
          kind: TYPE_PLURAL[v.dominant],
          n: v.n,
          of: v.typed,
          yours: v.yours ? `Yours is ${TYPE_ONE[v.yours]}.` : "",
          opps: count === null ? "see Opportunities" : `Opportunities, ${count} found`,
          own: ownRoute(v.dominant),
        },
      };
    case "out":
      return { id: "pages.fit.out", vars: { keyword, n: v.out, of: v.readings } };
    case "fix_first":
      return { id: "pages.fit.fix_first", vars: { what: v.what } };
    case "fits":
      return { id: "pages.fit.fits", vars: {} };
  }
}

/** The fit's evidence, in counts with their denominators. */
export function fitEvidence(v: FitVerdict, keyword: string): string | null {
  switch (v.kind) {
    case "no_page":
      return v.homepage ? `Your homepage held '${keyword}' at the latest reading.` : `None of your pages was in the top 20 for '${keyword}' on ${v.out} of its last ${v.readings} readings.`;
    case "split":
      return `${v.held.map((h) => `${h.urlKey} held it on ${h.days} ${h.days === 1 ? "reading" : "readings"}`).join("; ")}, of the last ${v.readings}.`;
    case "different":
      return `${v.n} of the ${v.typed} results we could type in Google's top 10 are ${TYPE_PLURAL[v.dominant]}.`;
    case "out":
      return `None of your pages was in the top 20 for '${keyword}' on ${v.out} of its last ${v.readings} readings.`;
    case "fits":
      // Said only when it is the fact U6 stands on: a keyword on page 1 has no #11-#20 count to state.
      return v.offPage1 ? `'${keyword}' read #11-#20 on ${v.offPage1} of its last ${v.readings} readings.` : null;
    default:
      return null;
  }
}
