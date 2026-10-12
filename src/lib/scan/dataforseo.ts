import "server-only";

import {
  budgetFor,
  type CompetitorDomain,
  DIY_FREE_PATHS,
  DIY_PATHS,
  type DiyRequest,
  firstTask,
  type InstantPage,
  type Intent,
  type LabsStatus,
  type Microdata,
  type ParsedPage,
  parseBacklinksFilters,
  parseCompetitorsDomain,
  parseContentParsing,
  parseInstantPage,
  parseLabsStatus,
  parseMicrodata,
  parseRankedKeywords,
  parseRelevantPages,
  type RankedKeywords,
  type RelevantPage,
  keywordIntentRequest,
  keywordIntents,
  keywordRankRequest,
  keywordVolumeRequest,
  keywordVolumes,
  requestFor,
  SERP_DEPTH,
  taskCost,
} from "./dataforseo-request.ts";
import { type Market } from "./domain";
import { type Engine, type EngineRead, type OrganicHit, PARSERS, parseOrganic, rankOfRead } from "./engines";

/**
 * The HTTP half. Everything that can be decided without a credential or a
 * socket - what we ask for, how long we allow it, how a task is read back -
 * lives in `dataforseo-request.ts`, where `request-shape.test.mts` runs it.
 * Do not move any of it back: this module imports `server-only`, and Node's
 * runner cannot load that, so anything in here has no executor.
 */

const BASE = "https://api.dataforseo.com";

/** partial: DataForSEO answered 40106 with items - some pages missing, the rest used (R137). */
export type EngineResult = EngineRead & { cost: number; partial: boolean };

function auth(): string {
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!login || !password) {
    throw new Error("DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD must be set.");
  }
  return Buffer.from(`${login}:${password}`).toString("base64");
}

async function post(path: string, body: unknown, timeoutMs: number): Promise<Record<string, unknown>> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { authorization: `Basic ${auth()}`, "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    const err = new Error(`DataForSEO ${res.status}: ${detail.slice(0, 300)}`);
    (err as { status?: number }).status = res.status;
    throw err;
  }
  return (await res.json()) as Record<string, unknown>;
}

/**
 * Ask one engine one question. Cost is whatever DataForSEO billed for the task.
 *
 * budgetMs is what is left of the whole run. The per-engine timeouts go up to
 * 130 seconds because that is what the scrapers document, and a read started
 * near the end of a run would happily spend all of it - past the pipeline
 * deadline, past the platform ceiling, and into a function that gets killed
 * with the scan still marked running. So the shorter of the two wins, and a
 * read that cannot finish inside what is left is abandoned rather than allowed
 * to outlive the run it belongs to.
 */
export async function readEngine(
  engine: Engine,
  question: string,
  market: Market,
  budgetMs?: number,
): Promise<EngineResult> {
  const { path, body, timeoutMs } = requestFor(engine, question, market);
  const raw = await post(path, body, budgetFor(timeoutMs, budgetMs));
  const task = firstTask(raw);
  return { ...PARSERS[engine](task.result?.[0]), cost: taskCost(task), partial: task.partial === true };
}

/**
 * `readSearchVolumes` was here and came out on 20 September 2026.
 *
 * It called `/v3/ai_optimization/ai_keyword_data/keywords_search_volume/live`
 * once per scan for the whole question set. Removed on Danny's instruction: it
 * was a serial third-party round trip inside the phase the progress bar holds
 * at 85%, for a figure this site already tells visitors it does not use.
 *
 * That last part is not a rationalisation after the fact - it is published
 * copy on two surfaces and it predates the removal. The homepage FAQ answers
 * "Why is there no search volume anywhere in this?" with a dated reading
 * ("On a real scan we ran in September, every question came back at zero
 * volume"), and the confirm screen's own footer reads "No search volume
 * against them, deliberately". The code was paying for the number on every
 * scan while both surfaces said we do not use one; the removal closes that,
 * and no copy changed because none of it was false.
 *
 * `request-shape.test.mts` refuses the endpoint by name. A removal rots back
 * in, so it is asserted rather than merely done.
 *
 * Both of those copy lines changed on 27 Sep 2026 (R42), when volume came
 * back for a derived head keyword - `readKeywordVolumes` below. The FAQ now
 * answers "Do you use search volume?" and the confirm footer promises the
 * keyword line the result shows.
 */

/**
 * Where a domain ranks on Google, UK against US - 25 September 2026.
 *
 * Feeds rule 3 of `market-pick.ts`: a .com, .ai or .co says nothing about
 * where a company's buyers are, so the scan asks DataForSEO Labs for the
 * domain's organic footprint in each market and opens on the larger one. Two
 * `domain_rank_overview/live` tasks, run together, a few cents between them.
 *
 * Never fatal and never slow: each read has its own short timeout, and a read
 * that fails or returns nothing is a null footprint, which `pickMarket`
 * answers with the US default. A visitor must never lose a scan to this.
 */
export async function readRankingFootprint(
  domain: string,
): Promise<{ uk: { etv: number; count: number } | null; us: { etv: number; count: number } | null; cost: number }> {
  const one = async (location_code: number) => {
    try {
      const raw = await post(
        "/v3/dataforseo_labs/google/domain_rank_overview/live",
        [{ target: domain, location_code, language_code: "en" }],
        6000,
      );
      const task = firstTask(raw) as { cost?: number; result?: { items?: { metrics?: { organic?: { etv?: number; count?: number } } }[] }[] };
      const organic = task.result?.[0]?.items?.[0]?.metrics?.organic;
      const footprint = organic ? { etv: Number(organic.etv) || 0, count: Number(organic.count) || 0 } : null;
      return { footprint, cost: Number(task.cost) || 0 };
    } catch (err) {
      console.warn(`[scan] ranking footprint read failed for ${domain} at ${location_code}: ${err instanceof Error ? err.message : String(err)}`);
      return { footprint: null, cost: 0 };
    }
  };
  const [uk, us] = await Promise.all([one(2826), one(2840)]);
  return { uk: uk.footprint, us: us.footprint, cost: uk.cost + us.cost };
}

/**
 * Monthly Google searches for the derived head keywords - one task for the
 * whole scan (R39, Danny, 27 Sep 2026). The request shape and the reader live
 * in `dataforseo-request.ts`; this is the one door that sends it.
 */
export async function readKeywordVolumes(
  keywords: readonly string[],
  market: Market,
  budgetMs?: number,
): Promise<{ volumes: Map<string, number | null>; cost: number }> {
  const { path, body, timeoutMs } = keywordVolumeRequest(keywords, market);
  const task = firstTask(await post(path, body, budgetFor(timeoutMs, budgetMs)));
  return { volumes: keywordVolumes(task), cost: taskCost(task) };
}

/**
 * The primary search intent of each candidate cluster keyword (BRIEF-3 C1,
 * decision 3). One batched task; no location. Not yet called - C1's
 * `/api/scan/[token]/questions` change wires it, as a registered paid door.
 */
export async function readKeywordIntents(
  keywords: readonly string[],
  budgetMs?: number,
): Promise<{ intents: Map<string, Intent | null>; cost: number }> {
  const { path, body, timeoutMs } = keywordIntentRequest(keywords);
  const task = firstTask(await post(path, body, budgetFor(timeoutMs, budgetMs)));
  return { intents: keywordIntents(task), cost: taskCost(task) };
}

/**
 * Where the scan's domain ranks in Google's top SERP_DEPTH for one chosen
 * keyword (R40). Null outside the depth read, undefined when the SERP came
 * back empty - `rankOf`'s contract, shared with the question-level read.
 */
export async function readKeywordRank(
  keyword: string,
  domain: string,
  market: Market,
  budgetMs?: number,
): Promise<{ rank: number | null | undefined; cost: number }> {
  const { path, body, timeoutMs } = keywordRankRequest(keyword, market);
  const task = firstTask(await post(path, body, budgetFor(timeoutMs, budgetMs)));
  return { rank: rankOfRead(parseOrganic(task.result?.[0]), domain, task.partial === true), cost: taskCost(task) };
}

/**
 * The same read as `readKeywordRank`, keeping the URL of the domain's
 * best-ranking page as well - the daily tracking runner stores both (T1,
 * 29 Sep 2026). One request shape, one ranker; only what is kept differs.
 */
export async function readKeywordPosition(
  keyword: string,
  domain: string,
  market: Market,
  budgetMs?: number,
): Promise<{ rank: number | null | undefined; url: string | null; cost: number; top: OrganicHit[] }> {
  const { path, body, timeoutMs } = keywordRankRequest(keyword, market);
  const task = firstTask(await post(path, body, budgetFor(timeoutMs, budgetMs)));
  const organic = parseOrganic(task.result?.[0]);
  const rank = rankOfRead(organic, domain, task.partial === true);
  const url = typeof rank === "number" ? (organic.find((o) => o.rank === rank)?.url ?? null) : null;
  // MS-1 (12 Oct 2026): the page of results this read already paid for - rank, domain and
  // URL of each organic result to SERP_DEPTH - so who else ranks for the cluster keyword is
  // kept day by day rather than thrown away. No new request and no new cost.
  const top = organic.filter((o) => o.rank <= SERP_DEPTH).map((o) => ({ rank: o.rank, domain: o.domain, url: o.url }));
  return { rank, url, cost: taskCost(task), top };
}

// ───────────────────────────── DIY launch doors ─────────────────────────────

/**
 * One door per DIY launch endpoint (13 Oct 2026, DIY P1; spec 10 section 5.2).
 * Each takes a request built in `dataforseo-request.ts`, refuses one built for
 * another path, posts it, and answers the allow-listed parse with what the
 * task billed. **Called only from `src/lib/diy/core/doors.ts`**, inside the
 * capped `diyRead` - a reservation in the DIY ledger before every paid one -
 * and `request-shape.test.mts` holds each door to that one caller. The two
 * free reads are GETs with no body and cost 0, called only by `freeRead`.
 */

/** What a DIY door answers: the parse, what the task billed, and how many rows came back (Labs bills per row). */
export type DiyAnswer<T> = { value: T; cost: number; rows: number | null; partial: boolean };

async function get(path: string, timeoutMs: number): Promise<Record<string, unknown>> {
  const res = await fetch(`${BASE}${path}`, {
    method: "GET",
    headers: { authorization: `Basic ${auth()}` },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    const err = new Error(`DataForSEO ${res.status}: ${detail.slice(0, 300)}`);
    (err as { status?: number }).status = res.status;
    throw err;
  }
  return (await res.json()) as Record<string, unknown>;
}

function diyTask(req: DiyRequest, path: string) {
  if (req.path !== path) throw new Error(`a ${req.endpoint} request was handed to the ${path} door`);
}

const itemsOf = (result: unknown): number => {
  const first = Array.isArray(result) ? (result[0] as { items?: unknown } | undefined) : undefined;
  return Array.isArray(first?.items) ? first.items.length : 0;
};

export async function readDiyRankedKeywords(req: DiyRequest, budgetMs: number): Promise<DiyAnswer<RankedKeywords>> {
  diyTask(req, DIY_PATHS.ranked_keywords);
  const task = firstTask(await post(req.path, req.body, budgetFor(req.timeoutMs, budgetMs)));
  return { value: parseRankedKeywords(task), cost: taskCost(task), rows: itemsOf(task.result), partial: task.partial === true };
}

export async function readDiyRelevantPages(req: DiyRequest, budgetMs: number): Promise<DiyAnswer<RelevantPage[]>> {
  diyTask(req, DIY_PATHS.relevant_pages);
  const task = firstTask(await post(req.path, req.body, budgetFor(req.timeoutMs, budgetMs)));
  return { value: parseRelevantPages(task), cost: taskCost(task), rows: itemsOf(task.result), partial: task.partial === true };
}

export async function readDiyCompetitorsDomain(req: DiyRequest, budgetMs: number): Promise<DiyAnswer<CompetitorDomain[]>> {
  diyTask(req, DIY_PATHS.competitors_domain);
  const task = firstTask(await post(req.path, req.body, budgetFor(req.timeoutMs, budgetMs)));
  return { value: parseCompetitorsDomain(task), cost: taskCost(task), rows: itemsOf(task.result), partial: task.partial === true };
}

export async function readDiyInstantPage(req: DiyRequest, budgetMs: number): Promise<DiyAnswer<{ taskId: string | null; page: InstantPage | null }>> {
  diyTask(req, DIY_PATHS.instant_pages);
  const task = firstTask(await post(req.path, req.body, budgetFor(req.timeoutMs, budgetMs)));
  return { value: parseInstantPage(task), cost: taskCost(task), rows: 1, partial: task.partial === true };
}

export async function readDiyMicrodata(req: DiyRequest, budgetMs: number): Promise<DiyAnswer<Microdata>> {
  diyTask(req, DIY_PATHS.microdata);
  const task = firstTask(await post(req.path, req.body, budgetFor(req.timeoutMs, budgetMs)));
  return { value: parseMicrodata(task), cost: taskCost(task), rows: 0, partial: task.partial === true };
}

export async function readDiyContentParsing(req: DiyRequest, budgetMs: number): Promise<DiyAnswer<ParsedPage | null>> {
  diyTask(req, DIY_PATHS.content_parsing);
  const markdown = (req.body as { markdown_view?: unknown }[])[0]?.markdown_view === true;
  const task = firstTask(await post(req.path, req.body, budgetFor(req.timeoutMs, budgetMs)));
  return { value: parseContentParsing(task, { markdown }), cost: taskCost(task), rows: 1, partial: task.partial === true };
}

/** Free: when Labs data last refreshed. */
export async function readLabsStatus(): Promise<LabsStatus> {
  return parseLabsStatus(firstTask(await get(DIY_FREE_PATHS.labs_status, 15_000)));
}

/** Free: the Backlinks filter names. It answers whatever the account's access; it does not prove access (04 section 1). */
export async function readBacklinksFilters(): Promise<{ groups: Record<string, string[]> }> {
  return parseBacklinksFilters(firstTask(await get(DIY_FREE_PATHS.backlinks_filters, 15_000)));
}
