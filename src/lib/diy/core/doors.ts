import "server-only";

import {
  readBacklinksFilters,
  readDiyBacklinkList,
  readDiyBacklinksCompetitors,
  readDiyBacklinksSummary,
  readDiyBulkNewLost,
  readDiyBulkRanks,
  readDiyBulkReferringDomains,
  readDiyContentSearch,
  readDiyDomainGap,
  readDiyNewLostSeries,
  readDiyPageGap,
  readDiyCompetitorsDomain,
  readDiyContentParsing,
  readDiyInstantPage,
  readDiyMicrodata,
  readDiyKeywordDifficulty,
  readDiyKeywordSuggestions,
  readDiyRankedKeywords,
  readDiyRelatedKeywords,
  readDiyRelevantPages,
  readLabsStatus,
} from "@/lib/scan/dataforseo";
import {
  type BacklinkCompetitor,
  type BacklinksSummary,
  backlinksCompetitorsRequest,
  backlinksNewLostRequest,
  backlinksSeriesRequest,
  backlinksSummaryRequest,
  bulkNewLostRequest,
  bulkRanksRequest,
  bulkReferringDomainsRequest,
  contentSearchRequest,
  domainGapRequest,
  type GapDomain,
  type GapPage,
  type LinkRow,
  type MentionCandidate,
  pageGapRequest,
  type SeriesWeek,
  type CompetitorDomain,
  competitorsDomainRequest,
  contentParsingRequest,
  DIY_FREE_PATHS,
  type DiyFreePath,
  type DiyRequest,
  type InstantPage,
  instantPagesRequest,
  isDiyFreePath,
  type Microdata,
  microdataRequest,
  type ParsedPage,
  type RankedKeywords,
  type ResearchedKeyword,
  keywordDifficultyRequest,
  keywordSuggestionsRequest,
  relatedKeywordsRequest,
  rankedKeywordsRequest,
  type RelevantPage,
  relevantPagesRequest,
} from "@/lib/scan/dataforseo-request";
import { isMarket, type Market } from "@/lib/scan/domain";

import type { ReadCtx } from "./jobs.ts";
import { paidRead, type ReadResult, type VendorAnswer } from "./ledger.ts";
import { type DiyEndpoint, type Door, DOOR_OF, dfsEstimate } from "./prices.ts";

/**
 * The DIY platform's two doors onto DataForSEO (13 Oct 2026, DIY P1; spec 10
 * sections 5.2 and 5.6 item 1).
 *
 * - **`diyRead(ctx, door, request, send)`** is the only way to make a paid
 *   read. It takes a `ReadCtx`, which only the worker and `runOnDemand` can
 *   mint, and goes through the ledger: reserve at the request's maximum, read
 *   inside the worker's pool, settle at what was billed. A feature package
 *   cannot make an uncapped paid read: without a ctx it does not typecheck,
 *   and with a forged one the ledger refuses.
 * - **`freeRead(path)`** takes no ctx and writes no ledger row. It accepts
 *   exactly the two cost-0 paths and refuses every other one at runtime, so it
 *   can never become a side door; the dispatcher calls it once a night
 *   whatever `diy_enabled` says.
 *
 * Below them, one typed function per launch endpoint, each building its
 * request here and sending it through its one door in `dataforseo.ts`
 * (`request-shape.test.mts` holds both to this file). Each answers a
 * `ReadResult`: the read, a refusal (a job defers or skips on it, a route
 * shows its words), or a failure with what it cost.
 */

export type { ReadResult } from "./ledger.ts";

/** One capped paid read. `send` is the request's door in dataforseo.ts. */
export async function diyRead<T>(
  ctx: ReadCtx,
  door: Door,
  request: DiyRequest,
  send: (request: DiyRequest, budgetMs: number) => Promise<VendorAnswer<T>>,
): Promise<ReadResult<T>> {
  if (request.endpoint === "microdata") throw new Error("microdata rides on its instant_pages read (readPageDeep)");
  const endpoint = request.endpoint as DiyEndpoint;
  if (DOOR_OF[endpoint] !== door) throw new Error(`${endpoint} goes through the ${DOOR_OF[endpoint]} door, not ${door}`);
  return paidRead(ctx, { door, endpoint, estimate: dfsEstimate(endpoint, request.rows), params: request.body }, (budgetMs) => send(request, budgetMs));
}

function marketOf(ctx: ReadCtx): Market {
  if (!isMarket(ctx.client.market)) throw new Error(`${ctx.client.domain} is in market ${ctx.client.market}, which DataForSEO is not asked about`);
  return ctx.client.market;
}

/** Every keyword the client ranks for in Google's top 100, by estimated traffic (P6's footprint). Up to 1000 rows. */
export function readRankedKeywords(ctx: ReadCtx, opts: { limit?: number } = {}): Promise<ReadResult<RankedKeywords>> {
  return diyRead(ctx, "labs", rankedKeywordsRequest({ target: ctx.client.domain, market: marketOf(ctx), limit: opts.limit }), readDiyRankedKeywords);
}

/** 17 Oct 2026, keyword research: keywords containing the seed, in the client's market (lib/dash/research.ts). */
export function readKeywordSuggestions(ctx: ReadCtx, seed: string): Promise<ReadResult<ResearchedKeyword[]>> {
  return diyRead(ctx, "labs", keywordSuggestionsRequest({ seed, market: marketOf(ctx) }), readDiyKeywordSuggestions);
}

/** Keywords searched alongside the seed, in the client's market. */
export function readRelatedKeywords(ctx: ReadCtx, seed: string): Promise<ReadResult<ResearchedKeyword[]>> {
  return diyRead(ctx, "labs", relatedKeywordsRequest({ seed, market: marketOf(ctx) }), readDiyRelatedKeywords);
}

/** Difficulty for up to 100 keywords, in the client's market. */
export function readKeywordDifficulty(ctx: ReadCtx, keywords: readonly string[]): Promise<ReadResult<{ keyword: string; kd: number | null }[]>> {
  return diyRead(ctx, "labs", keywordDifficultyRequest({ keywords, market: marketOf(ctx) }), readDiyKeywordDifficulty);
}

/** The client's pages by estimated traffic (P8's key pages). */
export function readRelevantPages(ctx: ReadCtx): Promise<ReadResult<RelevantPage[]>> {
  return diyRead(ctx, "labs", relevantPagesRequest({ target: ctx.client.domain, market: marketOf(ctx) }), readDiyRelevantPages);
}

/** Domains sharing the client's Google keywords (P10's comparison-set fallback). */
export function readCompetitorsDomain(ctx: ReadCtx): Promise<ReadResult<CompetitorDomain[]>> {
  return diyRead(ctx, "labs", competitorsDomainRequest({ target: ctx.client.domain, market: marketOf(ctx) }), readDiyCompetitorsDomain);
}

export type DeepPage = { page: InstantPage | null; microdata: Microdata | null; microdataError: string | null };

/**
 * One page read with JavaScript and the validator, then the validator's
 * findings - one reservation, one ledger row: `microdata` is free for a paid
 * task (04 section 2), so it is not a read of its own. A microdata read that
 * fails leaves the page and says why; it never fails the page read.
 */
export function readPageDeep(ctx: ReadCtx, url: string): Promise<ReadResult<DeepPage>> {
  return diyRead(ctx, "onpage", instantPagesRequest(url), async (req, budgetMs) => {
    const got = await readDiyInstantPage(req, budgetMs);
    const { taskId, page } = got.value;
    let microdata: Microdata | null = null;
    let microdataError: string | null = null;
    let cost = got.cost;
    if (taskId && page?.checks.has_micromarkup) {
      try {
        const micro = await readDiyMicrodata(microdataRequest(taskId, page.url ?? url), budgetMs);
        microdata = micro.value;
        cost += micro.cost;
      } catch (err) {
        microdataError = (err instanceof Error ? err.message : String(err)).slice(0, 160);
      }
    }
    return { value: { page, microdata, microdataError }, cost, rows: 1, partial: got.partial };
  });
}

/** A page's headings, links and text (cited-page reads, top-3 structure, the verify and link-check fallback). `markdown` only for the client's own page. */
export function readContentParsing(ctx: ReadCtx, url: string, opts: { markdown?: boolean } = {}): Promise<ReadResult<ParsedPage | null>> {
  return diyRead(ctx, "onpage", contentParsingRequest(url, opts.markdown === true), readDiyContentParsing);
}

// ── Wave 3: Backlinks and Content Analysis (13 Oct 2026, DIY P10; spec 10 sections 5.2 and 6.3) ──
//
// Each through diyRead, on the backlinks or content door, reserved at the request's maximum (the request's
// rows at $0.000036 on top of $0.024). The client's own domain is the target or the excluded site; the
// comparison set is handed in by the links jobs, which derive it (links/comparison-set.ts).

/** The client's link profile: rank, links, referring domains, follow split (Links, Your links). */
export function readBacklinksSummary(ctx: ReadCtx): Promise<ReadResult<BacklinksSummary | null>> {
  return diyRead(ctx, "backlinks", backlinksSummaryRequest(ctx.client.domain), readDiyBacklinksSummary);
}

/** The client's referring domains new since `since`, or lost since it, one link per domain. */
export function readNewLostLinks(ctx: ReadCtx, which: "new" | "lost", since: string): Promise<ReadResult<{ total: number | null; rows: LinkRow[] }>> {
  return diyRead(ctx, "backlinks", backlinksNewLostRequest({ target: ctx.client.domain, which, since }), readDiyBacklinkList);
}

/** New and lost referring domains per week (the 13-week bars). */
export function readNewLostSeries(ctx: ReadCtx, from: string, to: string): Promise<ReadResult<SeriesWeek[]>> {
  return diyRead(ctx, "backlinks", backlinksSeriesRequest({ target: ctx.client.domain, from, to }), readDiyNewLostSeries);
}

/** DataForSEO rank for the client and the comparison set. */
export function readBulkRanks(ctx: ReadCtx, compared: readonly string[]): Promise<ReadResult<Record<string, number | null>>> {
  return diyRead(ctx, "backlinks", bulkRanksRequest([ctx.client.domain, ...compared]), readDiyBulkRanks);
}

/** Referring domains for the client and the comparison set. */
export function readBulkReferringDomains(ctx: ReadCtx, compared: readonly string[]): Promise<ReadResult<Record<string, number | null>>> {
  return diyRead(ctx, "backlinks", bulkReferringDomainsRequest([ctx.client.domain, ...compared]), readDiyBulkReferringDomains);
}

/** New and lost referring domains since `from` for the client and the comparison set. */
export function readBulkNewLost(ctx: ReadCtx, compared: readonly string[], from: string): Promise<ReadResult<Record<string, { newDomains: number | null; lostDomains: number | null }>>> {
  return diyRead(ctx, "backlinks", bulkNewLostRequest({ targets: [ctx.client.domain, ...compared], from }), readDiyBulkNewLost);
}

/** The link gap by domain: the compared sites (or one pair of them), the client excluded. */
export function readDomainGap(ctx: ReadCtx, p: { targets: readonly string[]; mode: "partial" | "all"; countFilter: boolean }): Promise<ReadResult<{ total: number | null; rows: GapDomain[] }>> {
  return diyRead(ctx, "backlinks", domainGapRequest({ targets: p.targets, exclude: ctx.client.domain, mode: p.mode, countFilter: p.countFilter }), readDiyDomainGap);
}

/** Link targets by page: the compared sites, the client excluded. */
export function readPageGap(ctx: ReadCtx, targets: readonly string[]): Promise<ReadResult<{ total: number | null; rows: GapPage[] }>> {
  return diyRead(ctx, "backlinks", pageGapRequest({ targets, exclude: ctx.client.domain }), readDiyPageGap);
}

/** Sites sharing backlinks with the client (comparison-set fallback, second source). */
export function readBacklinksCompetitors(ctx: ReadCtx): Promise<ReadResult<BacklinkCompetitor[]>> {
  return diyRead(ctx, "backlinks", backlinksCompetitorsRequest(ctx.client.domain), readDiyBacklinksCompetitors);
}

/**
 * Pages that mention the client, one per domain (mention candidates), for the
 * phrase the links job worked out before its first paid read
 * (dataforseo-request.ts brandPhrase), so a brand the search cannot take is
 * known before anything is bought.
 */
export function readContentSearch(ctx: ReadCtx, phrase: string): Promise<ReadResult<{ total: number | null; rows: MentionCandidate[] }>> {
  return diyRead(ctx, "content", contentSearchRequest({ phrase }), readDiyContentSearch);
}

export type FreeAnswer =
  | { kind: "labs_status"; googleDate: string | null; payload: unknown }
  | { kind: "backlinks_filters"; googleDate: null; payload: unknown };

/** The free door: exactly two paths, cost 0, no ledger row. Anything else throws before a request is made. */
export async function freeRead(path: DiyFreePath): Promise<FreeAnswer> {
  if (!isDiyFreePath(path)) throw new Error(`freeRead takes only the two free paths, not ${String(path)}`);
  if (path === DIY_FREE_PATHS.labs_status) {
    const status = await readLabsStatus();
    return { kind: "labs_status", googleDate: status.googleDate, payload: status.payload };
  }
  return { kind: "backlinks_filters", googleDate: null, payload: await readBacklinksFilters() };
}
