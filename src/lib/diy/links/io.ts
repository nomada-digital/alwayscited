import type { BacklinkCompetitor, BacklinksSummary, CompetitorDomain, GapDomain, GapPage, LinkRow, MentionCandidate, ParsedPage, SeriesWeek } from "../../scan/dataforseo-request.ts";
import type { GuardedGet } from "../core/fetch.ts";
import type { ReadCtx } from "../core/jobs.ts";
import type { ReadResult } from "../core/ledger.ts";
import type { ClassifyAnswer } from "../opportunities/classify-prompt.ts";

/**
 * The reads Links makes, handed in (13 Oct 2026, DIY P10), as P7's io.ts
 * hands its own: every paid one through P1's doors (a ReadCtx, the ledger),
 * our guarded fetch for the free first read, and P7's classify call for a
 * fallback comparison domain with no type yet. The live ones are reached by
 * dynamic import, so the jobs and the route load under node --test, where
 * the tests hand in fakes and the server-only modules are never imported.
 */
export type LinksIO = {
  get: GuardedGet;
  summary(ctx: ReadCtx): Promise<ReadResult<BacklinksSummary | null>>;
  newLost(ctx: ReadCtx, which: "new" | "lost", since: string): Promise<ReadResult<{ total: number | null; rows: LinkRow[] }>>;
  series(ctx: ReadCtx, from: string, to: string): Promise<ReadResult<SeriesWeek[]>>;
  bulkRanks(ctx: ReadCtx, compared: readonly string[]): Promise<ReadResult<Record<string, number | null>>>;
  bulkDomains(ctx: ReadCtx, compared: readonly string[]): Promise<ReadResult<Record<string, number | null>>>;
  bulkNewLost(ctx: ReadCtx, compared: readonly string[], from: string): Promise<ReadResult<Record<string, { newDomains: number | null; lostDomains: number | null }>>>;
  domainGap(ctx: ReadCtx, p: { targets: readonly string[]; mode: "partial" | "all"; countFilter: boolean }): Promise<ReadResult<{ total: number | null; rows: GapDomain[] }>>;
  pageGap(ctx: ReadCtx, targets: readonly string[]): Promise<ReadResult<{ total: number | null; rows: GapPage[] }>>;
  labsCompetitors(ctx: ReadCtx): Promise<ReadResult<CompetitorDomain[]>>;
  backlinksCompetitors(ctx: ReadCtx): Promise<ReadResult<BacklinkCompetitor[]>>;
  contentSearch(ctx: ReadCtx): Promise<ReadResult<{ total: number | null; rows: MentionCandidate[] }>>;
  parse(ctx: ReadCtx, url: string): Promise<ReadResult<ParsedPage | null>>;
  classify(ctx: ReadCtx, input: { system: string; user: string; items: number }): Promise<ReadResult<ClassifyAnswer>>;
};

/** The live reads: doors.ts for every paid one, crawl.ts guardedRead, and model.ts classifyPages with P7's schema. */
export async function liveLinksIO(): Promise<LinksIO> {
  const [crawl, doors, model, prompt] = await Promise.all([import("../../scan/crawl.ts"), import("../core/doors.ts"), import("../core/model.ts"), import("../opportunities/classify-prompt.ts")]);
  return {
    get: crawl.guardedRead,
    summary: (ctx) => doors.readBacklinksSummary(ctx),
    newLost: (ctx, which, since) => doors.readNewLostLinks(ctx, which, since),
    series: (ctx, from, to) => doors.readNewLostSeries(ctx, from, to),
    bulkRanks: (ctx, compared) => doors.readBulkRanks(ctx, compared),
    bulkDomains: (ctx, compared) => doors.readBulkReferringDomains(ctx, compared),
    bulkNewLost: (ctx, compared, from) => doors.readBulkNewLost(ctx, compared, from),
    domainGap: (ctx, p) => doors.readDomainGap(ctx, p),
    pageGap: (ctx, targets) => doors.readPageGap(ctx, targets),
    labsCompetitors: (ctx) => doors.readCompetitorsDomain(ctx),
    backlinksCompetitors: (ctx) => doors.readBacklinksCompetitors(ctx),
    contentSearch: (ctx) => doors.readContentSearch(ctx),
    parse: (ctx, url) => doors.readContentParsing(ctx, url),
    classify: (ctx, input) => model.classifyPages(ctx, { system: input.system, user: input.user, schema: prompt.ClassifySchema, items: input.items }),
  };
}
