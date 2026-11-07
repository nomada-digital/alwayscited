/**
 * The engines a scan reads, and how to parse each one's answer.
 *
 * Pure: no credentials, no network. dataforseo.ts owns the HTTP and imports
 * these parsers, which keeps the parsing testable against recorded responses.
 *
 * Two different DataForSEO families are in play. ChatGPT and Gemini have an
 * LLM Scraper, which reads the consumer product a buyer actually uses, so that
 * is what we call. Perplexity and Claude only expose LLM Responses, which asks
 * the model directly; that is a slightly different question and the UI says so.
 */

// With the extension, so Node's own runner can load this module. It strips
// types but does not resolve extensionless specifiers, and the header above
// claims these parsers are testable against recorded responses - which was not
// true of them while this line read "./domain". tsconfig allows the .ts
// specifier and noEmit means none of it can reach a build artefact.
import { normalizeDomain } from "./domain.ts";

export const ENGINES = ["google_aio", "chatgpt", "gemini", "perplexity", "claude"] as const;
export type Engine = (typeof ENGINES)[number];

export function isEngine(v: unknown): v is Engine {
  return typeof v === "string" && (ENGINES as readonly string[]).includes(v);
}

/**
 * A stored engine list, as the pass actually read it: known names, each once.
 *
 * `scans.engines` and `scans.gated_engines` are jsonb arrays. `settings-merge`
 * stops a repeat reaching a new row, but `pipeline.ts` still dedupes both
 * columns on the way out - explicitly "for rows already written" - so a row
 * whose list repeats a name is a shape this repo already believes exists, and
 * the pass asks that engine once and stores one answer for it.
 *
 * Every other reader filtered and did not dedupe, so each of them disagreed
 * with the pass about the same row:
 *
 * - the campaign headline built a column per entry, counting one answer twice
 *   on both sides of its fraction, while the history strip below it counted
 *   answer rows and counted it once - the page contradicting itself, which is
 *   the whole thing `reading-figures.ts` exists to stop;
 * - the waiting screen rendered a chip per entry, keyed on the engine name, so
 *   the visitor was shown the same engine twice under a duplicate React key
 *   and told the scan reads five engines when it reads four.
 *
 * One door, here rather than beside either of them, because it is a fact about
 * the column and both of those are readers of it. `engines.test.mts` holds the
 * behaviour and `engine-list-readers.test.mts` holds the walk.
 */
export function knownEngines(list: readonly string[] | null | undefined): Engine[] {
  return [...new Set((list ?? []).filter(isEngine))];
}

/**
 * Client-safe. This module is imported by the result screen, so it must carry
 * nothing commercially sensitive: what each call costs us lives in
 * engine-costs.ts, which is server-only.
 */
export type EngineSpec = {
  key: Engine;
  /** Shown in the UI. */
  label: string;
  /** "scraper" reads the consumer product; "model" asks the model directly. */
  kind: "scraper" | "model";
  /**
   * The engine own brand colour, from the design tokens. Used for the logo
   * tiles at a tint, never as text and never recoloured - the point of the
   * tile is that it is recognisably theirs.
   */
  colour: string;
};

export const ENGINE_SPECS: Record<Engine, EngineSpec> = {
  google_aio: { key: "google_aio", label: "Google AI Overviews", kind: "scraper", colour: "#ea4335" },
  chatgpt: { key: "chatgpt", label: "ChatGPT", kind: "scraper", colour: "#10a37f" },
  gemini: { key: "gemini", label: "Gemini", kind: "scraper", colour: "#4285f4" },
  perplexity: { key: "perplexity", label: "Perplexity", kind: "model", colour: "#20808d" },
  claude: { key: "claude", label: "Claude", kind: "model", colour: "#d97757" },
};

/**
 * The split that decides what an email is worth.
 *
 * The free scan reads the four surfaces a buyer actually uses, at about $0.27
 * for fourteen questions. Perplexity moved here because a check that leaves it
 * out is not a credible read of the category, and a visitor who can see that
 * gap has been shown an incomplete answer, not a teaser.
 *
 * Nothing is gated by engine now. The leaderboard and the complete source list
 * went free with 20260919000000: a visitor who can see they are ninth, and see
 * the twelve pages the engines read to decide it, has been shown the problem
 * rather than a teaser of it. What the email buys is which of those pages they
 * could be placed into, and the verbatim answers. Claude stays out of the free
 * scan entirely - at $0.66 a run it is a subscription feature, not a lead
 * magnet.
 *
 * These are defaults. app_settings.scan_engines_free and scan_engines_gated
 * override them at runtime, so the split can be changed without a deploy.
 */
export const FREE_ENGINES: Engine[] = ["google_aio", "chatgpt", "gemini", "perplexity"];
export const GATED_ENGINES: Engine[] = [];

export type Citation = {
  source_domain: string;
  url: string | null;
  title: string | null;
  position: number;
};

/** One engine's answer to one question, normalised across all five shapes. */
export type EngineRead = {
  /** Did this engine produce an answer at all? A false here is a measured absence. */
  answered: boolean;
  /** The engine's own prose, with link URLs stripped. Brand matching runs on this. */
  prose: string;
  citations: Citation[];
  /** Google only: the organic results from the same response as the Overview. */
  organic?: OrganicHit[];
  raw: unknown;
};

/** One of Google's organic results. rank is the position among organic results. */
export type OrganicHit = { domain: string; url: string | null; rank: number };

const EMPTY: EngineRead = { answered: false, prose: "", citations: [], raw: null };

/**
 * Markdown to prose. Link labels survive, URLs do not, so a brand whose name
 * appears only inside a URL is not counted as named.
 */
export function stripMarkdownLinks(md: string): string {
  return md
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<https?:\/\/[^>]*>/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[*_`#>]/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * The cited sources on one answer, deduplicated on domain and url.
 *
 * The fallbacks are || and not ??, deliberately, and a sweep that tidies them
 * back to ?? reintroduces the bug. These fields come off a vendor JSON
 * response, and a JSON API that has no value for a string field returns an
 * empty one at least as often as it omits the key. ?? only steps past null
 * and undefined, so a reference carrying an empty domain and a perfectly good
 * url normalised to nothing and was dropped by the guard below - the whole
 * citation lost, not just its domain.
 *
 * source is the last title fallback rather than the first. It is the field
 * Google AI Overview references carry, and it was declared in AioRef and read
 * by nobody, so an Overview reference with no title stored a null one. What
 * the field holds is read off that type rather than off DataForSEO docs,
 * which are not reachable from here - hence last, where the alternative it
 * displaces is null.
 */
function collectCitations(
  refs: Array<{
    domain?: string | null;
    url?: string | null;
    title?: string | null;
    source_name?: string | null;
    source?: string | null;
  }>,
): Citation[] {
  const seen = new Set<string>();
  const out: Citation[] = [];
  for (const r of refs) {
    const domain = normalizeDomain(r.domain || r.url || "");
    if (!domain) continue;
    const key = `${domain}|${r.url ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      source_domain: domain,
      url: r.url ?? null,
      title: r.title || r.source_name || r.source || null,
      position: out.length + 1,
    });
  }
  return out;
}

// ─────────────────────────────── google_aio ───────────────────────────────
type AioRef = { source?: string; domain?: string; url?: string; title?: string };
type AioElement = { text?: string; references?: AioRef[] };
type AioItem = { type: string; markdown?: string; items?: AioElement[]; references?: AioRef[] };
type OrganicItem = { type?: string; rank_group?: number; rank_absolute?: number; domain?: string; url?: string; breadcrumb?: string; website_name?: string };

/**
 * The organic results, from the same response as the Overview. The request is
 * a full SERP at depth 20, so these were always coming back; keeping them is
 * what gives the report a Google rank for every question at no extra cost.
 */
function collectOrganic(items: OrganicItem[]): OrganicHit[] {
  const out: OrganicHit[] = [];
  for (const i of items) {
    if (i.type !== "organic") continue;
    const shown = wrappedLink(i.url ?? null) ? (unwrapByCrumb(i.breadcrumb) ?? unwrapByPlatform(i.website_name)) : null;
    if (shown) {
      const rank = typeof i.rank_group === "number" ? i.rank_group : i.rank_absolute;
      if (typeof rank === "number") out.push({ domain: shown.domain, url: shown.url, rank });
      continue;
    }
    const domain = normalizeDomain(i.domain || i.url || "");
    const rank = typeof i.rank_group === "number" ? i.rank_group : i.rank_absolute;
    if (!domain || typeof rank !== "number") continue;
    out.push({ domain, url: i.url ?? null, rank });
  }
  return out;
}

/** The organic results off a plain SERP task, the keyword-rank read (R40). */
export function parseOrganic(result: Record<string, unknown> | undefined | null): OrganicHit[] {
  return collectOrganic(((result?.items as OrganicItem[] | undefined) ?? []));
}

/**
 * Where the subject sits in Google's organic results: null outside the depth
 * read, undefined when there were no results to read at all. Subdomains
 * count as the subject. Moved here from pipeline.ts on 27 Sep 2026 so the
 * question read and the keyword read (R40) rank with one function.
 */
export function rankOf(organic: OrganicHit[] | undefined, subject: string): number | null | undefined {
  if (!organic?.length) return undefined;
  const want = normalizeDomain(subject);
  const hit = organic.find((o) => o.domain === want || o.domain.endsWith(`.${want}`));
  return hit ? hit.rank : null;
}

/**
 * Fewer organic results than this on a depth-20 read is a page that did not
 * fully come back. Clean reads in tracking_serp averaged 18.8 a keyword from
 * 20 to 29 Oct 2026, and one in about 120 came in under ten.
 */
export const SERP_MIN_ORGANIC = 10;

/**
 * The site behind a wrapped result, read off its breadcrumb (7 Nov 2026, as the
 * hub's rank pull does since 3 Nov: pull_ranks_dfs.item_link). Google now links
 * most organic results through google.com/goto, and DataForSEO reports those
 * as google.com; the breadcrumb, "https://www.x.com › a › b", still names the
 * site. The url is the site's own when the path is shown whole, its home page
 * when the breadcrumb cuts it short. Null without a readable breadcrumb.
 */
export function unwrapByCrumb(breadcrumb: string | undefined | null): { domain: string; url: string } | null {
  const m = /^(https?:\/\/[^\s/›]+)(.*)$/.exec((breadcrumb ?? "").trim());
  if (!m) return null;
  const domain = normalizeDomain(m[1]);
  if (!domain) return null;
  const parts = m[2].split("›").map((p) => p.trim()).filter(Boolean);
  const cut = parts.some((p) => p.includes("...") || p.includes("…") || p.includes(" "));
  return { domain, url: cut || !parts.length ? `${m[1]}/` : `${m[1]}/${parts.join("/")}` };
}

/**
 * A wrapped social post (7 Nov 2026): its breadcrumb is "350+ followers" or "20+ comments · 2 years ago", not an
 * address, but website_name names the platform first ("Instagram · princetakespictures"). Those platforms are never a
 * customer's own site, and two such posts on a page were enough to call it degraded. Null for any other name.
 */
const PLATFORMS: Record<string, string> = {
  facebook: "facebook.com", instagram: "instagram.com", youtube: "youtube.com", reddit: "reddit.com", linkedin: "linkedin.com",
  tiktok: "tiktok.com", x: "x.com", twitter: "x.com", pinterest: "pinterest.com", quora: "quora.com", medium: "medium.com", threads: "threads.net",
};
export function unwrapByPlatform(websiteName: string | undefined | null): { domain: string; url: null } | null {
  const name = (websiteName ?? "").split(/[\u00a0\s]*\u00b7/)[0].trim().toLowerCase();
  const domain = PLATFORMS[name];
  return domain ? { domain, url: null } : null;
}

/** An organic result whose link is Google's own redirect (`/goto` or `/url` on a google host) rather than the site's. */
function wrappedLink(url: string | null): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    return /(^|\.)google\.[a-z.]+$/.test(u.hostname) && (u.pathname === "/goto" || u.pathname === "/url");
  } catch {
    return false;
  }
}

/**
 * What is wrong with a SERP read, or null when it can be ranked on.
 *
 * "wrapped" (3 Nov 2026): from 30 Oct DataForSEO served a different,
 * localised Google page for most keywords, with a dozen of the twenty links
 * wrapped as google.com/goto and the site only in the breadcrumb. Every
 * tracking_serp read from 30 Oct carried three or more; none before did. The
 * count of results did not drop, so only the links give it away. A wrapped
 * page is the wrong page: nothing on it is a rank or a miss. Since 7 Nov a
 * wrapped result takes its site from its breadcrumb (`unwrapByCrumb`, in
 * `collectOrganic`), so only those with no breadcrumb to read still count here:
 * the page Google serves for MOR's keywords on 7 Nov was the right one, with
 * every one of its twenty links wrapped.
 *
 * "thin": fewer than SERP_MIN_ORGANIC organic results, read like a partial -
 * found is a rank, not found is not measured.
 */
export function serpFault(organic: OrganicHit[] | undefined): "wrapped" | "thin" | null {
  if (!organic?.length) return null;
  if (organic.filter((o) => wrappedLink(o.url)).length >= 2) return "wrapped";
  return organic.length < SERP_MIN_ORGANIC ? "thin" : null;
}

/**
 * `rankOf` for a read that may be partial (R137, 30 Sep 2026). A 40106 means
 * some SERP pages did not come back, so "not found" no longer means "not in
 * the top SERP_DEPTH": the subject may sit on the missing page. Found is
 * still a rank; not found on a partial read is not measured (undefined).
 * A thin page reads the same way, and a wrapped one is not measured at all
 * (`serpFault`, 3 Nov 2026).
 */
export function rankOfRead(organic: OrganicHit[] | undefined, subject: string, partial: boolean): number | null | undefined {
  const fault = serpFault(organic);
  if (fault === "wrapped") return undefined;
  const rank = rankOf(organic, subject);
  return (partial || fault === "thin") && rank === null ? undefined : rank;
}

export function parseGoogleAio(result: Record<string, unknown> | undefined | null): EngineRead {
  if (!result) return EMPTY;

  const items = (result.items as AioItem[] | undefined) ?? [];
  const organic = collectOrganic(items as unknown as OrganicItem[]);
  const aio = items.find((i) => i.type === "ai_overview");
  if (!aio) {
    const claimed = ((result.item_types as string[] | undefined) ?? []).includes("ai_overview");
    return { ...EMPTY, organic, raw: { claimed_but_absent: claimed } };
  }

  // Element text is the Overview's own prose. The markdown field carries inline
  // link URLs, so it is never used for brand matching.
  const prose = (aio.items ?? [])
    .map((el) => el.text ?? "")
    .filter(Boolean)
    .join("\n\n");

  // Both lists, not whichever one is populated. See the note on the same
  // merge in parseScraper below - an Overview carrying element-level
  // references as well as top-level ones had the element-level set discarded
  // outright, and those citations are what the source list is built from.
  const refs = [...(aio.references ?? []), ...(aio.items ?? []).flatMap((el) => el.references ?? [])];
  const citations = collectCitations(refs);

  /**
   * An Overview element with no prose in it is one we did not get, not one
   * Google answered with nothing.
   *
   * The request sets `load_async_ai_overview`, so the expanded Overview is
   * fetched in a second step on DataForSEO's side; when that step does not
   * land, the element still arrives, carrying no `items` and so no text. That
   * came back `answered: true` with an empty prose, and empty prose names
   * nobody - so the scan recorded "the Overview appeared and did not mention
   * you", which is a statement about Google, on the engine whose measured zero
   * the free result leads with. It also fed `deriveOpportunities`, which reads
   * an answer the brand was absent from as a page worth being placed on.
   *
   * Reported as the same shape as an Overview that never arrived, so it takes
   * the one retry the caller already spends on that - and if the retry is
   * empty too, the scan records no answer from this engine rather than an
   * answer that says nothing. The two are kept apart in `raw` because only one
   * of them is Google's doing.
   *
   * The other two parsers have had this check since they were written; this is
   * the one that did not.
   */
  if (!prose.trim()) {
    return { ...EMPTY, organic, raw: { claimed_but_absent: true, empty_overview: true } };
  }

  return { answered: true, prose, citations, organic, raw: { reference_count: citations.length } };
}

// ──────────────────────── chatgpt / gemini scrapers ────────────────────────
type ScraperSource = { domain?: string; url?: string; title?: string; source_name?: string };
type ScraperItem = {
  type?: string;
  markdown?: string;
  /** Gemini returns unformatted text; ChatGPT does not. */
  original_text?: string;
  sources?: ScraperSource[] | null;
  items?: Array<{ title?: string; url?: string; domain?: string }> | null;
};

function parseScraper(result: Record<string, unknown> | undefined | null): EngineRead {
  if (!result) return EMPTY;

  const items = (result.items as ScraperItem[] | undefined) ?? [];
  if (!items.length) return EMPTY;

  const prose = items
    .map((i) => {
      if (i.original_text) return i.original_text;
      if (i.markdown) return stripMarkdownLinks(i.markdown);
      return "";
    })
    .filter(Boolean)
    .join("\n\n");

  // Local business panels name suppliers without citing a page; those names are
  // part of the answer and must count towards being named.
  const panelNames = items
    .flatMap((i) => i.items ?? [])
    .map((b) => b?.title)
    .filter((t): t is string => Boolean(t));

  /**
   * Both lists, merged - not whichever one happens to be non-empty.
   *
   * This was `topLevel.length ? topLevel : perItem`, so on any response
   * carrying both, every per-item source was discarded. Those citations are
   * the source list on the report and, through `deriveOpportunities`, the
   * gated placement list: a page the engine actually cited and we silently
   * dropped is a placement we never offered.
   *
   * The reason it was an either/or was a worry about double counting, and the
   * worry does not survive checking. `collectCitations` dedupes on domain and
   * url, so a source in both lists is one citation. A near-duplicate that
   * escapes that - the same page in both lists under different tracking
   * parameters - costs one extra row, and no reader counts rows: `scan_teaser`
   * selects a distinct `(source_domain, question_id, engine)`, `total_sources`
   * is `count(distinct source_domain)`, `scan_source_coverage` the same,
   * `buildUnlockPayload` and `deriveOpportunities` key a set on that same
   * triple, and `classifySources` keys on domain alone. The one reader that
   * did count raw rows was the campaign reading, and it is keyed on the triple
   * now too - see `countCitedDomains`. So merging cannot move a number on any
   * report; it can only stop losing sources.
   *
   * Top-level first so that a response with only top-level sources produces
   * exactly what it produced before, positions included.
   */
  const topLevel = (result.sources as ScraperSource[] | undefined) ?? [];
  const perItem = items.flatMap((i) => i.sources ?? []);
  const citations = collectCitations([...topLevel, ...perItem]);

  const fullProse = panelNames.length ? `${panelNames.join("\n")}\n\n${prose}` : prose;
  if (!fullProse.trim()) return { ...EMPTY, raw: { empty_answer: true } };

  return { answered: true, prose: fullProse, citations, raw: { reference_count: citations.length } };
}

export const parseChatGpt = parseScraper;
export const parseGemini = parseScraper;

// ─────────────────── perplexity / claude llm responses ───────────────────
type ResponseAnnotation = { title?: string; url?: string };
type ResponseSection = { type?: string; text?: string; annotations?: ResponseAnnotation[] | null };
type ResponseItem = { type?: string; sections?: ResponseSection[] };

function parseLlmResponse(result: Record<string, unknown> | undefined | null): EngineRead {
  if (!result) return EMPTY;

  const items = (result.items as ResponseItem[] | undefined) ?? [];
  const sections = items.flatMap((i) => i.sections ?? []);
  if (!sections.length) return EMPTY;

  // These come back as many small sections; joined without blank lines so
  // sentences split across sections still read as sentences.
  const prose = sections
    .map((s) => s.text ?? "")
    .join("")
    .trim();

  const annotations = sections.flatMap((s) => s.annotations ?? []);
  const citations = collectCitations(annotations);

  if (!prose) return { ...EMPTY, raw: { empty_answer: true } };

  return {
    answered: true,
    prose,
    citations,
    raw: {
      reference_count: citations.length,
      web_search: result.web_search ?? null,
      money_spent: result.money_spent ?? null,
    },
  };
}

export const parsePerplexity = parseLlmResponse;
export const parseClaude = parseLlmResponse;

export const PARSERS: Record<Engine, (r: Record<string, unknown> | undefined | null) => EngineRead> = {
  google_aio: parseGoogleAio,
  chatgpt: parseChatGpt,
  gemini: parseGemini,
  perplexity: parsePerplexity,
  claude: parseClaude,
};

/**
 * `namesBrand` used to live here and is now in `./brand-name`, beside
 * `brandKey` - the other half of the same job, and the one this file never
 * had. It moved because it could not be tested where it was: this module
 * imports `./domain` without a file extension, which Node's own runner cannot
 * resolve, so the one function in the tree whose output is the number the
 * product sells had no check at all. `brand-name.ts` imports nothing.
 */
