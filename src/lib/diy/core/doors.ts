import "server-only";

import {
  readBacklinksFilters,
  readDiyCompetitorsDomain,
  readDiyContentParsing,
  readDiyInstantPage,
  readDiyMicrodata,
  readDiyRankedKeywords,
  readDiyRelevantPages,
  readLabsStatus,
} from "@/lib/scan/dataforseo";
import {
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
