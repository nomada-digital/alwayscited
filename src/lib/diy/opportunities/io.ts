import type { ParsedPage } from "../../scan/dataforseo-request.ts";
import type { GuardedGet } from "../core/fetch.ts";
import type { ReadCtx } from "../core/jobs.ts";
import type { ReadResult } from "../core/ledger.ts";

import type { ClassifyAnswer } from "./classify-prompt.ts";

/**
 * The reads Opportunities makes, handed in (13 Oct 2026, DIY P7): our own
 * guarded fetch (free), the `content_parsing` door and the classify call
 * (paid, each through a ReadCtx and P1's ledger). The live ones are reached
 * by dynamic import, so the jobs and routes load under node --test, where
 * the tests hand in fakes and the server-only modules are never imported.
 */
export type OppIO = {
  get: GuardedGet;
  parse: (ctx: ReadCtx, url: string) => Promise<ReadResult<ParsedPage | null>>;
  classify: (ctx: ReadCtx, input: { system: string; user: string; items: number }) => Promise<ReadResult<ClassifyAnswer>>;
};

/** The live reads: crawl.ts guardedRead, doors.ts readContentParsing, model.ts classifyPages with this package's schema. */
export async function liveIO(): Promise<OppIO> {
  const [crawl, doors, model, prompt] = await Promise.all([import("../../scan/crawl.ts"), import("../core/doors.ts"), import("../core/model.ts"), import("./classify-prompt.ts")]);
  return {
    get: crawl.guardedRead,
    parse: (ctx, url) => doors.readContentParsing(ctx, url),
    classify: (ctx, input) => model.classifyPages(ctx, { system: input.system, user: input.user, schema: prompt.ClassifySchema, items: input.items }),
  };
}
