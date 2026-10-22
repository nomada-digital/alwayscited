/**
 * The pure half of the DataForSEO client: what we ask for, how long we allow
 * it, and how we read a task back. No credentials and no network, so Node's
 * own runner can execute it.
 *
 * It was split out of `dataforseo.ts` on 20 September 2026 for exactly that
 * reason. That file is `server-only` and the module this tree spends the most
 * money through, and it was one of the source files no test named - a test
 * written in place would have had to retype every request body to compare
 * against, which is how this repo's four blind tripwires were built. What is
 * here is the half a test can run; `dataforseo.ts` keeps `auth()`, `post()`
 * and the two exported reads.
 *
 * **It is not the only module that spends**, and this comment said it was
 * until later the same day. `anthropic.ts` bills per model call, and Resend
 * bills per message through `verify-email.ts` and the two public forms. That
 * wrong premise is not harmless prose: it is the one that left
 * `/api/scan/[token]/resend` outside both of the sweeps whose job is to hold
 * every door onto a vendor bill. `src/app/api/spenders.mts` carries the
 * measured set.
 *
 * Imports are relative and carry the extension deliberately. Node strips types
 * but does not resolve `@/` or an extensionless specifier, and tidying either
 * back is what makes this module untestable again.
 */

import { MARKETS, type Market } from "./domain.ts";
import type { Engine } from "./engines.ts";

/** ISO country codes for the markets we support, for the LLM Responses engines. */
export const MARKET_ISO: Record<Market, string> = { UK: "GB", US: "US" };

/** The model each LLM Responses engine is asked. Sonnet, not Opus: same answer, less spend. */
export const RESPONSE_MODELS = {
  perplexity: "sonar",
  claude: "claude-sonnet-5",
} as const;

/**
 * How deep the Google SERP is read.
 *
 * Named because five doc comments across four files describe the rank this
 * produces as "the top twenty", and until now every one of them was a number
 * typed in prose next to a number typed in a request body, with nothing
 * connecting the two. Change the request and the descriptions keep their old
 * value; that is this repo's own defect species and `request-shape.test.mts`
 * now fails when they disagree.
 *
 * The organic results come back on the same response as the Overview, so the
 * depth costs nothing extra.
 */
export const SERP_DEPTH = 20;

/**
 * Per-answer output ceiling on the LLM Responses endpoints, which bill per
 * token. An unbounded answer is an unbounded bill.
 */
export const MAX_OUTPUT_TOKENS = 1200;

/** The floor `budgetFor` will not go below, so a spent budget still tries once. */
export const MIN_BUDGET_MS = 5_000;

export type EngineRequest = { path: string; body: unknown; timeoutMs: number };

/**
 * Per-engine request shape. The two families differ: the scrapers take a
 * keyword and a location code, the LLM Responses endpoints take a prompt and,
 * where supported, a country ISO code.
 *
 * The scrapers document execution times of up to 120 seconds, so their timeout
 * is generous; the whole run is bounded separately by the pipeline.
 */
export function requestFor(engine: Engine, question: string, market: Market): EngineRequest {
  switch (engine) {
    case "google_aio":
      return {
        path: "/v3/serp/google/organic/live/advanced",
        timeoutMs: 60_000,
        body: [
          {
            keyword: question,
            location_code: MARKETS[market].location_code,
            language_code: "en",
            device: "desktop",
            depth: SERP_DEPTH,
            load_async_ai_overview: true,
          },
        ],
      };

    case "chatgpt":
      return {
        path: "/v3/ai_optimization/chat_gpt/llm_scraper/live/advanced",
        timeoutMs: 130_000,
        body: [
          {
            keyword: question,
            location_code: MARKETS[market].location_code,
            language_code: "en",
            // Without this the model answers from memory and cites nothing,
            // which is not the question we are asking.
            force_web_search: true,
          },
        ],
      };

    case "gemini":
      return {
        path: "/v3/ai_optimization/gemini/llm_scraper/live/advanced",
        timeoutMs: 130_000,
        body: [
          {
            keyword: question,
            location_code: MARKETS[market].location_code,
            language_code: "en",
          },
        ],
      };

    case "perplexity":
      return {
        path: "/v3/ai_optimization/perplexity/llm_responses/live",
        timeoutMs: 130_000,
        body: [
          {
            user_prompt: question,
            model_name: RESPONSE_MODELS.perplexity,
            max_output_tokens: MAX_OUTPUT_TOKENS,
            temperature: 0.2,
            web_search_country_iso_code: MARKET_ISO[market],
          },
        ],
      };

    case "claude":
      return {
        path: "/v3/ai_optimization/claude/llm_responses/live",
        timeoutMs: 130_000,
        body: [
          {
            user_prompt: question,
            model_name: RESPONSE_MODELS.claude,
            max_output_tokens: MAX_OUTPUT_TOKENS,
            web_search: true,
            /**
             * The same market parameter Perplexity takes, on the same endpoint
             * family. It was absent, which made Claude the one engine of the
             * five whose request carried nothing derived from the market: a UK
             * scan asked it a question with no country at all, and a "who are
             * the best suppliers" answer with no country is a different answer.
             *
             * It has never shipped a wrong reading, because `GATED_ENGINES` is
             * empty and `FREE_ENGINES` leaves Claude out, so nothing has run
             * this branch on a live scan. It would have on the first run after
             * anyone put Claude in either list from `app_settings`, which is a
             * jsonb edit and no deploy.
             */
            web_search_country_iso_code: MARKET_ISO[market],
          },
        ],
      };
  }
}

/**
 * One Google organic read for a derived head keyword (R40, Danny, 27 Sep 2026),
 * to find where the scan's domain ranks for it. Separate from the google_aio
 * read, which ranks the domain for the question text and stays as it is.
 *
 * Same endpoint and depth as that read, without the Overview: nothing here
 * reads one, and asking for it only slows the task. Not wired to a caller
 * until the R41 columns are applied - see target-keyword.ts.
 */
export function keywordRankRequest(keyword: string, market: Market): EngineRequest {
  return {
    path: "/v3/serp/google/organic/live/advanced",
    timeoutMs: 60_000,
    body: [
      {
        keyword,
        location_code: MARKETS[market].location_code,
        language_code: "en",
        device: "desktop",
        depth: SERP_DEPTH,
      },
    ],
  };
}

/**
 * One point of a map pack geo-grid (22 Oct 2026, lib/local/grid.ts): Google
 * Maps read from a GPS point at a zoom, not from a location code, because the
 * pack changes street by street. `search_this_area: false` asks as a searcher
 * standing there would, so a listing just outside the viewport still counts.
 * One task, one point; the weekly pass (lib/local/run.ts) runs the grid's
 * points together. Built here, sent from `readMapsPoint` alone.
 */
export const MAPS_PATH = "/v3/serp/google/maps/live/advanced";

export function mapsPointRequest(keyword: string, lat: number, lng: number, zoom: number, depth: number): EngineRequest {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) throw new Error(`not a point: ${lat},${lng}`);
  const z = Math.min(21, Math.max(3, Math.round(zoom)));
  return {
    path: MAPS_PATH,
    timeoutMs: 60_000,
    body: [
      {
        keyword,
        location_coordinate: `${lat.toFixed(5)},${lng.toFixed(5)},${z}z`,
        language_code: "en",
        depth: Math.min(100, Math.max(10, Math.round(depth))),
        search_this_area: false,
      },
    ],
  };
}

/**
 * The shorter of what this engine needs and what the run has left, floored so a
 * budget that has already run out still makes one honest attempt rather than
 * aborting on a zero and recording an error nobody can read.
 *
 * The `Number.isFinite` guard is not decoration. `remainingMs` arrives as
 * `deadline - Date.now()`, and `typeof NaN === "number"` is true - so a NaN
 * reached `Math.min`, survived `Math.max`, and was handed to
 * `AbortSignal.timeout`, which coerces it to 0 and aborts the read before the
 * request is sent. Every engine read for the rest of the pass would have
 * failed instantly with a TimeoutError, on a scan already marked running and
 * already billed for whatever went out before it.
 */
export function budgetFor(timeoutMs: number, remainingMs: number | undefined): number {
  if (!Number.isFinite(remainingMs as number)) return timeoutMs;
  return Math.max(MIN_BUDGET_MS, Math.min(timeoutMs, remainingMs as number));
}

export type Task = {
  status_code?: number;
  status_message?: string;
  cost?: number;
  result?: Array<Record<string, unknown>> | null;
  /** Set by `firstTask` on a 40106 it accepted: some pages did not come back. */
  partial?: boolean;
};

/** DataForSEO's "everything is fine" task status. Anything else is an error, bar 40106 below. */
export const TASK_OK = 20000;

/**
 * Two task codes read differently from the rest (R137, Danny, 30 Sep 2026,
 * after 142 of 342 google_aio reads in 14 days errored: 115 x 40101, 27 x
 * 40106, both since 16 Sep). DataForSEO's errors appendix, read 30 Sep:
 *
 * 40101 "internal se server error. - the requested search engine was unable
 * to process your request and responded with an error". Google's side, not
 * ours: retried, twice, on the tracking runner's delays (`readRetryDelay`).
 *
 * 40106 "Task completed with partial results. Some pages could not be
 * retrieved after several retry attempts. You have not been charged for the
 * pages that were not returned. - the task has been completed successfully,
 * but we could not parse some of the requested results ... you will get 80
 * results with this error". So a 40106 with items is a read: used, and
 * marked partial. One with no items is still a failure.
 */
export const TASK_SE_ERROR = 40101;
export const TASK_PARTIAL = 40106;

/**
 * Two account-level codes that come back with no task at all (9 Oct 2026,
 * DataForSEO's errors appendix read that day): 40202 "the rate-limit per
 * minute has been exceeded" and 40209 "too many simultaneous queries" - "the
 * limit for simultaneous requests made by a single user is 30". Both say
 * "not now" about the account, not about the request, so a read that met
 * one is retried on the runner's delays like 40101.
 */
export const TASK_RATE_LIMIT = 40202;
export const TASK_TOO_MANY = 40209;

/**
 * The first task, or a throw. The error carries the task's status code and
 * what it billed (30 Sep 2026): a task DataForSEO failed can still have been
 * paid for, and the tracking runner retries on the code and records the cost
 * rather than a zero. The message is unchanged, so the scan's stored errors
 * read as they always have.
 */
export function firstTask(body: Record<string, unknown>): Task {
  const tasks = body.tasks;
  const task = (Array.isArray(tasks) ? (tasks as Task[]) : [])[0];
  if (!task) {
    // DataForSEO refused the whole request, and says why at the top level. Until 9 Oct 2026 this
    // threw that reason away: 23 of 25 ChatGPT reads that day failed as "returned no task", with
    // nothing to tell a rate limit from an outage. The code rides on the error, so retries can read it.
    const code = typeof body.status_code === "number" ? body.status_code : null;
    const said = typeof body.status_message === "string" ? body.status_message.slice(0, 60) : "";
    const err = new Error(code === null ? "DataForSEO returned no task" : `DataForSEO returned no task (${code}${said ? ` ${said}` : ""})`);
    if (code !== null) Object.assign(err, { taskStatus: code });
    throw err;
  }
  if (task.status_code === TASK_PARTIAL) {
    const items = task.result?.[0]?.items;
    if (Array.isArray(items) && items.length > 0) return { ...task, partial: true };
  }
  if (task.status_code !== TASK_OK) {
    const err = new Error(`DataForSEO task ${task.status_code}: ${task.status_message ?? "unknown"}`);
    Object.assign(err, { taskStatus: task.status_code, cost: taskCost(task) });
    throw err;
  }
  return task;
}

/**
 * What the task billed. A missing or non-numeric cost is zero, and so is a
 * negative one - a cost that moves the run's spend total downwards is the one
 * shape that can talk the daily cap into allowing a scan it should refuse.
 */
export function taskCost(task: Task): number {
  const c = task.cost;
  return typeof c === "number" && Number.isFinite(c) && c > 0 ? c : 0;
}

/**
 * `volumeKey` and `collectVolumes` were here and came out on 20 September 2026
 * with the search volume step - see `dataforseo.ts` for why.
 *
 * They were the only readers of the `keywords_search_volume` response shape.
 * What they got right is recorded here rather than in the commit, because it is
 * the kind of thing that gets re-derived if the endpoint ever comes back:
 * DataForSEO lowercases every keyword it echoes, our questions are only
 * lowercase by convention, and the map was keyed on their string and read with
 * ours - so any question carrying a capital looked up nothing and stored a null
 * volume, which is indistinguishable from a question that genuinely has none.
 */

/**
 * Search volume came back on 27 September 2026 (Danny, R38/R39), narrower:
 * Google Ads volume for the derived head keywords, never the question text,
 * in one batched call per scan. `request-shape.test.mts` holds this path to
 * this file and the old AI-keyword endpoint to nowhere.
 *
 * Not wired to a caller until the R41 columns are applied.
 */
export const KEYWORD_VOLUME_PATH = "/v3/keywords_data/google_ads/search_volume/live";

/** The endpoint's own per-task keyword ceiling. */
export const KEYWORD_VOLUME_MAX = 1000;

/** Lowercased and trimmed: the form DataForSEO echoes a keyword back in. */
export function keywordForm(k: string): string {
  return k.trim().toLowerCase().replace(/\s+/g, " ");
}

export function keywordVolumeRequest(keywords: readonly string[], market: Market): EngineRequest {
  const unique = [...new Set(keywords.map(keywordForm).filter(Boolean))];
  if (unique.length > KEYWORD_VOLUME_MAX) throw new Error(`${unique.length} keywords is over the ${KEYWORD_VOLUME_MAX} one task takes`);
  return {
    path: KEYWORD_VOLUME_PATH,
    timeoutMs: 60_000,
    body: [{ keywords: unique, location_code: MARKETS[market].location_code, language_code: "en" }],
  };
}

/**
 * Keyword -> monthly searches, keyed and read in `keywordForm` on both sides
 * so a capital cannot miss (the defect recorded above). A keyword the task
 * returned without a number maps to null, which is "not measured", not zero.
 */
export function keywordVolumes(task: Task): Map<string, number | null> {
  const out = new Map<string, number | null>();
  for (const row of task.result ?? []) {
    if (typeof row.keyword !== "string") continue;
    const v = row.search_volume;
    out.set(keywordForm(row.keyword), typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);
  }
  return out;
}

/**
 * The cluster keyword's intent - C1 of
 * docs/tracked-dashboard-2026-09-29/BRIEF-3-clusters.md (Danny, 29 Sep 2026,
 * decision 3). DataForSEO Labs' search intent read takes keywords and a
 * language and no location. Only the primary `keyword_intent.label` is read;
 * secondary intents are ignored. Documented example cost $0.0014 for 4
 * keywords - to be measured on the first real scan (docs/scan-setup.md).
 *
 * Built and parsed here, sent from `readKeywordIntents` in `dataforseo.ts`,
 * and not yet called: C1's route change wires it.
 */
export const KEYWORD_INTENT_PATH = "/v3/dataforseo_labs/google/search_intent/live";

/** The endpoint's own per-task keyword ceiling. */
export const KEYWORD_INTENT_MAX = 1000;

export const INTENTS = ["informational", "navigational", "commercial", "transactional"] as const;
export type Intent = (typeof INTENTS)[number];

export function keywordIntentRequest(keywords: readonly string[]): EngineRequest {
  const unique = [...new Set(keywords.map(keywordForm).filter(Boolean))];
  if (unique.length > KEYWORD_INTENT_MAX) throw new Error(`${unique.length} keywords is over the ${KEYWORD_INTENT_MAX} one task takes`);
  return { path: KEYWORD_INTENT_PATH, timeoutMs: 30_000, body: [{ keywords: unique, language_code: "en" }] };
}

/**
 * Keyword -> primary intent, keyed in `keywordForm`. The task's result is one
 * row holding `items`, each `{ keyword, keyword_intent: { label, probability } }`.
 * A label outside the four is null (not read), never a guess.
 */
export function keywordIntents(task: Task): Map<string, Intent | null> {
  const out = new Map<string, Intent | null>();
  for (const row of task.result ?? []) {
    const items = (row as { items?: unknown }).items;
    for (const item of Array.isArray(items) ? (items as Record<string, unknown>[]) : []) {
      if (typeof item.keyword !== "string") continue;
      const label = (item.keyword_intent as { label?: unknown } | null | undefined)?.label;
      out.set(keywordForm(item.keyword), (INTENTS as readonly string[]).includes(String(label)) ? (label as Intent) : null);
    }
  }
  return out;
}

// ───────────────────────────── DIY launch reads ─────────────────────────────

/**
 * The DIY platform's DataForSEO reads (13 Oct 2026, DIY P1; spec 10 section
 * 5.2): the Labs and OnPage requests, their `limit` ceilings and their
 * allow-list parsers, plus the two free paths. Built and parsed here, sent
 * from one door each in `dataforseo.ts`, and called only from
 * `src/lib/diy/core/doors.ts`, through the capped `diyRead` - so every paid
 * one is reserved in the DIY ledger before it goes out (`request-shape.test.mts`
 * holds the path, the door and the caller). The Backlinks and Content
 * Analysis reads are P10's, in wave 3.
 *
 * **Parsers keep named fields only.** What a parser does not name does not
 * survive it, so a field DataForSEO adds tomorrow never reaches a page. In
 * particular `keyword_difficulty` (ranked_keywords carries it on every row)
 * is never read, and nothing here reads a sponsored or spam field. The
 * shapes are DataForSEO's documented responses, read from docs.dataforseo.com
 * on 13 Oct 2026; the saved samples in `src/lib/diy/core/samples/` carry them
 * with made-up values, and `src/lib/diy/core/requests.test.mts` runs every
 * parser on them and pins the documented paths in the samples themselves.
 *
 * 13 Oct 2026, review of DIY P1: two parsers read paths the documentation
 * does not have, and their samples had been written to match. `instant_pages`
 * keeps `content` inside `meta` (`items[].meta.content.plain_text_word_count`),
 * and each `content_parsing` `table_content` entry is a table of `header`,
 * `body` and `footer` rows, each row's `row_cells` holding `text`, `urls`
 * and `is_header`. Both parsers and both samples now follow the docs.
 */

/** The two free paths, both cost 0 (04 section 2). `freeRead` in doors.ts accepts these and refuses every other path. */
export const DIY_FREE_PATHS = {
  labs_status: "/v3/dataforseo_labs/status",
  backlinks_filters: "/v3/backlinks/available_filters",
} as const;
export type DiyFreeKind = keyof typeof DIY_FREE_PATHS;
export type DiyFreePath = (typeof DIY_FREE_PATHS)[DiyFreeKind];

export function isDiyFreePath(path: string): path is DiyFreePath {
  return (Object.values(DIY_FREE_PATHS) as string[]).includes(path);
}

/** The launch paid paths. `microdata` is free for a paid `instant_pages` task and rides on its reservation. */
export const DIY_PATHS = {
  ranked_keywords: "/v3/dataforseo_labs/google/ranked_keywords/live",
  relevant_pages: "/v3/dataforseo_labs/google/relevant_pages/live",
  competitors_domain: "/v3/dataforseo_labs/google/competitors_domain/live",
  instant_pages: "/v3/on_page/instant_pages",
  microdata: "/v3/on_page/microdata",
  content_parsing: "/v3/on_page/content_parsing/live",
  // 17 Oct 2026, the dashboards host's keyword research (Search positions, "Find keywords"): Labs, on demand.
  keyword_suggestions: "/v3/dataforseo_labs/google/keyword_suggestions/live",
  related_keywords: "/v3/dataforseo_labs/google/related_keywords/live",
  keyword_difficulty: "/v3/dataforseo_labs/google/bulk_keyword_difficulty/live",
} as const;
/** Every DIY paid path's key: the launch reads above and wave 3's Backlinks and Content Analysis reads (DIY_LINK_PATHS, below). */
export type DiyPathKey = keyof typeof DIY_PATHS | DiyLinkPathKey;

/**
 * Row ceilings (section 5.6 item 5): 100 by default, 1000 only for
 * `ranked_keywords`, and anything higher refused here rather than sent. A
 * Labs read bills every row up to its limit, so the limit is the bill.
 */
export const DIY_LIMIT_DEFAULT = 100;
export const DIY_LIMIT_CEILING = { ranked_keywords: 1000, relevant_pages: DIY_LIMIT_DEFAULT, competitors_domain: DIY_LIMIT_DEFAULT, keyword_suggestions: DIY_LIMIT_DEFAULT, related_keywords: DIY_LIMIT_DEFAULT, keyword_difficulty: DIY_LIMIT_DEFAULT } as const;

export function diyLimit(endpoint: keyof typeof DIY_LIMIT_CEILING, asked: number): number {
  const ceiling = DIY_LIMIT_CEILING[endpoint];
  if (!Number.isInteger(asked) || asked < 1 || asked > ceiling) throw new Error(`${endpoint} limit ${asked} is outside 1-${ceiling}`);
  return asked;
}

/** One DIY request: where it goes, what it asks, and how many rows it can bill. */
export type DiyRequest = EngineRequest & { endpoint: DiyPathKey; rows: number };

const HOST_RE = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** A Labs target: a bare domain, no scheme, no `www.`, no path, as the docs ask. Throws on anything else. */
export function diyTarget(domain: string): string {
  const host = domain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
  if (!HOST_RE.test(host)) throw new Error(`not a domain DataForSEO can be asked about: ${JSON.stringify(domain)}`);
  return host;
}

/** An OnPage URL: absolute http(s), 500 characters at most, no credentials. Throws on anything else. */
export function diyPageUrl(raw: string): string {
  const url = raw.trim();
  if (url.length > 500) throw new Error("a page URL is 500 characters at most");
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error(`not a URL: ${JSON.stringify(raw.slice(0, 80))}`);
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("a page URL is http or https");
  if (u.username || u.password) throw new Error("a page URL carries no credentials");
  if (!HOST_RE.test(u.hostname)) throw new Error(`not a public host: ${u.hostname}`);
  return u.toString();
}

const location = (market: Market) => ({ location_code: MARKETS[market].location_code, language_code: "en" });

/**
 * Every keyword the client's domain ranks for in Google's top 100, highest
 * estimated traffic first (section 5.2; the footprint, momentum and setup
 * suggestions). `item_types` organic: the default adds paid rows, which are
 * not a ranking. 1000 rows is $0.132.
 */
export function rankedKeywordsRequest(p: { target: string; market: Market; limit?: number }): DiyRequest {
  const limit = diyLimit("ranked_keywords", p.limit ?? DIY_LIMIT_CEILING.ranked_keywords);
  return {
    endpoint: "ranked_keywords",
    path: DIY_PATHS.ranked_keywords,
    timeoutMs: 60_000,
    rows: limit,
    body: [
      {
        target: diyTarget(p.target),
        ...location(p.market),
        limit,
        item_types: ["organic"],
        order_by: ["ranked_serp_element.serp_item.etv,desc"],
        filters: ["ranked_serp_element.serp_item.rank_group", "<=", 100],
      },
    ],
  };
}

/** The client's pages by estimated traffic (auto-filling key pages). 20 rows: $0.0144. */
export function relevantPagesRequest(p: { target: string; market: Market }): DiyRequest {
  const limit = diyLimit("relevant_pages", 20);
  return {
    endpoint: "relevant_pages",
    path: DIY_PATHS.relevant_pages,
    timeoutMs: 60_000,
    rows: limit,
    body: [{ target: diyTarget(p.target), ...location(p.market), limit, item_types: ["organic"], order_by: ["metrics.organic.etv,desc"] }],
  };
}

/** Domains sharing the client's Google keywords, the big generalists left out (comparison-set fallback, W3). 20 rows: $0.0144. */
export function competitorsDomainRequest(p: { target: string; market: Market }): DiyRequest {
  const limit = diyLimit("competitors_domain", 20);
  return {
    endpoint: "competitors_domain",
    path: DIY_PATHS.competitors_domain,
    timeoutMs: 60_000,
    rows: limit,
    body: [{ target: diyTarget(p.target), ...location(p.market), limit, exclude_top_domains: true, item_types: ["organic"] }],
  };
}

/** One page read with JavaScript and the structured data validator on, one task (key-page deep check). $0.0015. */
export function instantPagesRequest(url: string): DiyRequest {
  return {
    endpoint: "instant_pages",
    path: DIY_PATHS.instant_pages,
    timeoutMs: 60_000,
    rows: 1,
    body: [{ url: diyPageUrl(url), enable_javascript: true, validate_micromarkup: true }],
  };
}

/** The validator's findings for a page `instant_pages` read with `validate_micromarkup` (its task id). Free. */
export function microdataRequest(taskId: string, url: string): DiyRequest {
  if (!/^[0-9a-z-]{8,64}$/i.test(taskId)) throw new Error("microdata needs the instant_pages task id");
  return { endpoint: "microdata", path: DIY_PATHS.microdata, timeoutMs: 30_000, rows: 0, body: [{ id: taskId, url: diyPageUrl(url) }] };
}

/** A page's structured content: headings, links, text. `markdown` only for the client's own page, as an example's input. $0.00015. */
export function contentParsingRequest(url: string, markdown = false): DiyRequest {
  return { endpoint: "content_parsing", path: DIY_PATHS.content_parsing, timeoutMs: 60_000, rows: 1, body: [{ url: diyPageUrl(url), markdown_view: markdown }] };
}

// ── parsers: named fields only ──

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const numOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const boolOrNull = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);
const text = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const t = v.replace(/\s+/g, " ").trim();
  return t ? t.slice(0, max) : null;
};
const firstResult = (task: Task): Obj => obj(arr(task.result)[0]);
/** A DataForSEO time ("2026-09-09 06:00:00 +00:00") as its day; null for anything else. */
const dayOrNull = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const m = /^(\d{4}-\d{2}-\d{2})[ T]/.exec(v.trim());
  return m && !Number.isNaN(Date.parse(`${m[1]}T00:00:00Z`)) ? m[1]! : null;
};

export type RankedKeyword = {
  keyword: string;
  /** `rank_absolute`: the position among every element on the page of results (an AI overview, a snippet, a video row count). */
  position: number | null;
  /**
   * `rank_group`: the position among the organic results only - the figure our own daily read stores
   * (engines.ts) and the one every DIY page shows as "Nth on Google". Added 13 Oct 2026, DIY P6 (review of
   * the P6 handoff): pages had shown `rank_absolute` in the same words, so one keyword read two ways on one
   * page. DataForSEO v3 docs, ranked_keywords/live, read 13 Oct 2026: "position within a group of elements
   * with identical type values".
   */
  group: number | null;
  /** `relative_url`: the ranking page's path. */
  url: string | null;
  volume: number | null;
  intent: Intent | null;
  /** Estimated traffic from this keyword: a vendor estimate. */
  etv: number | null;
  /** `rank_changes.previous_rank_absolute`: DataForSEO's own previous reading, a `rank_absolute`, taken at `previousOn`. */
  previous: number | null;
  isNew: boolean | null;
  /**
   * The day of that previous reading: `ranked_serp_element.previous_updated_time` (or
   * `keyword_data.serp_info.previous_updated_time`), YYYY-MM-DD. DataForSEO v3 docs, ranked_keywords/live,
   * read 13 Oct 2026: `rank_changes` holds "the ranking changes of the SERP element since the
   * previous_updated_time" - per keyword, so each row says its own date (13 Oct 2026, DIY P6).
   */
  previousOn: string | null;
};
export type RankedKeywords = { total: number | null; etv: number | null; rows: RankedKeyword[] };

export function parseRankedKeywords(task: Task): RankedKeywords {
  const r = firstResult(task);
  const rows: RankedKeyword[] = [];
  for (const raw of arr(r.items)) {
    const item = obj(raw);
    const kd = obj(item.keyword_data);
    const keyword = text(kd.keyword, 120);
    if (!keyword) continue;
    const element = obj(item.ranked_serp_element);
    const serp = obj(element.serp_item);
    const changes = obj(serp.rank_changes);
    const intent = obj(kd.search_intent_info).main_intent;
    rows.push({
      keyword: keywordForm(keyword),
      position: numOrNull(serp.rank_absolute),
      group: numOrNull(serp.rank_group),
      url: text(serp.relative_url, 500),
      volume: numOrNull(obj(kd.keyword_info).search_volume),
      intent: (INTENTS as readonly string[]).includes(String(intent)) ? (intent as Intent) : null,
      etv: numOrNull(serp.etv),
      previous: numOrNull(changes.previous_rank_absolute),
      isNew: boolOrNull(changes.is_new),
      previousOn: dayOrNull(element.previous_updated_time) ?? dayOrNull(obj(kd.serp_info).previous_updated_time),
    });
  }
  return { total: numOrNull(r.total_count), etv: numOrNull(obj(obj(r.metrics).organic).etv), rows };
}

export type RelevantPage = { url: string; etv: number | null; count: number | null; pos1: number | null; pos2_3: number | null; pos4_10: number | null; pos11_20: number | null };

export function parseRelevantPages(task: Task): RelevantPage[] {
  const out: RelevantPage[] = [];
  for (const raw of arr(firstResult(task).items)) {
    const item = obj(raw);
    const url = text(item.page_address, 500);
    if (!url) continue;
    const o = obj(obj(item.metrics).organic);
    out.push({ url, etv: numOrNull(o.etv), count: numOrNull(o.count), pos1: numOrNull(o.pos_1), pos2_3: numOrNull(o.pos_2_3), pos4_10: numOrNull(o.pos_4_10), pos11_20: numOrNull(o.pos_11_20) });
  }
  return out;
}

export type CompetitorDomain = { domain: string; intersections: number | null; avgPosition: number | null };

export function parseCompetitorsDomain(task: Task): CompetitorDomain[] {
  const out: CompetitorDomain[] = [];
  for (const raw of arr(firstResult(task).items)) {
    const item = obj(raw);
    const domain = text(item.domain, 253);
    if (!domain) continue;
    out.push({ domain: domain.toLowerCase(), intersections: numOrNull(item.intersections), avgPosition: numOrNull(item.avg_position) });
  }
  return out;
}

/** The checks kept from `instant_pages`. Its noindex check's field name is [VERIFY]: the documented sample read 13 Oct 2026 carries none, so noindex comes from our own fetch's meta robots and X-Robots-Tag (section 6.4). */
export const INSTANT_CHECKS = ["no_title", "no_h1_tag", "is_https", "has_micromarkup", "has_micromarkup_errors", "canonical"] as const;

export type InstantPage = {
  status: number | null;
  url: string | null;
  title: string | null;
  description: string | null;
  h1: string[];
  canonical: string | null;
  wordCount: number | null;
  checks: Record<(typeof INSTANT_CHECKS)[number], boolean | null>;
};

/** The page, and the task id `microdata` needs. */
export function parseInstantPage(task: Task): { taskId: string | null; page: InstantPage | null } {
  const taskId = text((task as { id?: unknown }).id, 64);
  const item = arr(firstResult(task).items).map(obj)[0];
  if (!item) return { taskId, page: null };
  const meta = obj(item.meta);
  const checks = obj(item.checks);
  return {
    taskId,
    page: {
      status: numOrNull(item.status_code),
      url: text(item.url, 500),
      title: text(meta.title, 300),
      description: text(meta.description, 500),
      h1: arr(obj(meta.htags).h1).map((h) => text(h, 200)).filter((h): h is string => h !== null).slice(0, 10),
      canonical: text(meta.canonical, 500),
      wordCount: numOrNull(obj(meta.content).plain_text_word_count),
      checks: Object.fromEntries(INSTANT_CHECKS.map((k) => [k, boolOrNull(checks[k])])) as InstantPage["checks"],
    },
  };
}

export const MICRO_LEVELS = ["fatal", "error", "warning", "info"] as const;
export type MicroLevel = (typeof MICRO_LEVELS)[number];
export type MicroItem = { types: string[]; fields: { name: string; value: string | null }[]; results: { level: MicroLevel; message: string }[] };
export type Microdata = { summary: Record<MicroLevel, number>; items: MicroItem[] };

/**
 * The validator's findings. Each item's fields nest (`inspection_info.fields[]`,
 * each with `fields` of its own and a `test_results` object), so they are
 * flattened to dotted names; values are cut to 200 characters, messages to
 * 160, and an item keeps at most 40 results. P8 trims further before storing
 * (`capSchemaPayload`: no values at all).
 */
export function parseMicrodata(task: Task): Microdata {
  const r = firstResult(task);
  const s = obj(r.test_summary);
  const summary = Object.fromEntries(MICRO_LEVELS.map((l) => [l, numOrNull(s[l]) ?? 0])) as Record<MicroLevel, number>;
  const items: MicroItem[] = [];
  for (const raw of arr(r.items).slice(0, 50)) {
    const info = obj(obj(raw).inspection_info);
    const fields: MicroItem["fields"] = [];
    const results: MicroItem["results"] = [];
    const walk = (list: unknown, prefix: string, depth: number) => {
      for (const f of arr(list).map(obj)) {
        const name = text(f.name, 80);
        if (!name) continue;
        const full = prefix ? `${prefix}.${name}` : name;
        const v = f.value;
        fields.push({ name: full, value: Array.isArray(v) ? text(v.filter((x) => typeof x === "string").join(", "), 200) : text(v, 200) });
        for (const t of [f.test_results].flat().map(obj)) {
          const level = String(t.level);
          const message = text(t.message, 160);
          if ((MICRO_LEVELS as readonly string[]).includes(level) && message && results.length < 40) results.push({ level: level as MicroLevel, message });
        }
        if (depth < 4) walk(f.fields, full, depth + 1);
      }
    };
    walk(info.fields, "", 0);
    items.push({ types: arr(info.types).map((t) => text(t, 80)).filter((t): t is string => t !== null).slice(0, 10), fields: fields.slice(0, 100), results });
  }
  return { summary, items };
}

export type ParsedPage = {
  status: number | null;
  /** The topic's `main_title`, which DataForSEO describes as the page's title. [VERIFY] against the first paid read. */
  title: string | null;
  h1: string | null;
  /** h2 and h3 headings, at most 40, each at most 120 characters. */
  headings: { level: 2 | 3; text: string }[];
  /** Date-like strings near "updated" or "published", at most 5. */
  dates: string[];
  /** Every link in the content: its URL and anchor. No `rel` comes back, so a link found here is never said to be followed or not. */
  links: { url: string; anchor: string | null }[];
  wordCount: number;
  /** Only when asked for, for the client's own page: at most 24,000 characters, never stored. */
  markdown?: string | null;
};

const DATE_NEAR = /\b(?:updated|published|last modified|posted)\b[^.\n]{0,40}?(\d{1,2}(?:st|nd|rd|th)?\s+[A-Z][a-z]{2,8}\.?,?\s+\d{4}|[A-Z][a-z]{2,8}\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4})/gi;

export function parseContentParsing(task: Task, opts: { markdown?: boolean } = {}): ParsedPage | null {
  const item = arr(firstResult(task).items).map(obj)[0];
  if (!item) return null;
  const content = obj(item.page_content);
  const topics = [...arr(content.main_topic), ...[content.main_topic].filter((t) => t && !Array.isArray(t)), ...arr(content.secondary_topic)].map(obj);
  const blocks = [obj(content.header), obj(content.footer), ...topics];

  const words: string[] = [];
  const links = new Map<string, { url: string; anchor: string | null }>();
  const addLink = (url: unknown, anchor: unknown) => {
    const u = text(url, 500);
    if (!u || links.size >= 300) return;
    const a = text(anchor, 200);
    links.set(`${u} ${a ?? ""}`, { url: u, anchor: a });
  };
  const readElements = (list: unknown) => {
    for (const el of arr(list).map(obj)) {
      const t = text(el.text, 5000);
      if (t) words.push(t);
      addLink(el.url, el.text);
      for (const l of arr(el.urls).map(obj)) addLink(l.url, l.anchor_text);
    }
  };
  // A table: its header, body and footer rows, each row's cells read like
  // content elements (text, and urls with their anchors). A client link in a
  // "best of" comparison table is a common place for one.
  const readTables = (list: unknown) => {
    for (const table of arr(list).map(obj)) {
      for (const part of [table.header, table.body, table.footer]) {
        for (const row of [part].flat().map(obj)) readElements(row.row_cells);
      }
    }
  };
  for (const b of blocks) {
    readElements(b.primary_content);
    readElements(b.secondary_content);
    readTables(b.table_content);
  }

  let title: string | null = null;
  let h1: string | null = null;
  const headings: ParsedPage["headings"] = [];
  for (const t of topics) {
    title ??= text(t.main_title, 300);
    const h = text(t.h_title, 120);
    const level = numOrNull(t.level);
    if (!h) continue;
    if (level === 1) h1 ??= h;
    else if ((level === 2 || level === 3) && headings.length < 40) headings.push({ level, text: h });
  }

  const joined = words.join("\n");
  const dates = [...new Set([...joined.matchAll(DATE_NEAR)].map((m) => m[1]!.slice(0, 40)))].slice(0, 5);
  const out: ParsedPage = {
    status: numOrNull(item.status_code),
    title,
    h1,
    headings,
    dates,
    links: [...links.values()],
    wordCount: joined.split(/\s+/).filter(Boolean).length,
  };
  if (opts.markdown) out.markdown = typeof item.page_as_markdown === "string" ? item.page_as_markdown.slice(0, 24_000) : null;
  return out;
}

export type LabsStatus = { googleDate: string | null; payload: { google: string | null; bing: string | null; amazon: string | null } };

const day = (v: unknown): string | null => {
  const m = typeof v === "string" ? /^(\d{4}-\d{2}-\d{2})/.exec(v) : null;
  return m ? m[1]! : null;
};

/** When Labs data last refreshed: the footprint is pulled only when Google's date has moved. */
export function parseLabsStatus(task: Task): LabsStatus {
  const r = firstResult(task);
  const payload = { google: day(obj(r.google).date_update), bing: day(obj(r.bing).date_update), amazon: day(obj(r.amazon).date_update) };
  return { googleDate: payload.google, payload };
}

/** Filter names that are never kept, even as a name in a list: the spam and sponsored family, and link attributes (section 2.3). */
export const DROPPED_FILTER = /sponsored|spam|(^|\.)attributes(\.|$)/i;

/**
 * The Backlinks filterable field names, per object group (`backlinks`,
 * `domain_pages`, `anchors`, ...), as sorted lists of names. Types are not
 * kept, and neither are the dropped names: W3 needs to know a filter exists,
 * not to store the family it may not show.
 */
export function parseBacklinksFilters(task: Task): { groups: Record<string, string[]> } {
  const r = firstResult(task);
  const groups: Record<string, string[]> = {};
  for (const [group, fields] of Object.entries(r)) {
    if (!/^[a-z_]{2,60}$/.test(group)) continue;
    const names = Object.keys(obj(fields)).filter((n) => n.length <= 120 && !DROPPED_FILTER.test(n));
    if (names.length) groups[group] = names.sort();
  }
  return { groups };
}

// ───────────────────────────── DIY wave 3: Backlinks and Content Analysis ─────────────────────────────

/**
 * The Links page's reads (13 Oct 2026, DIY P10; spec 10 sections 5.2, 6.3
 * and 7.11): every `backlinks/*` live endpoint the page uses and Content
 * Analysis `search`. Built and parsed here, sent from one door each in
 * `dataforseo.ts`, and called only from `src/lib/diy/core/doors.ts` through
 * the capped `diyRead` - so each is reserved in the DIY ledger before it goes
 * out, on the `backlinks` or `content` door (`request-shape.test.mts` holds
 * the path, the door and the caller). Nothing calls them while `diy_enabled`
 * is off.
 *
 * **The shapes are DataForSEO's documented ones**, read from the v3
 * documentation's `.md` pages on 13 Oct 2026 (each dated 2026-10-12 there):
 * backlinks/summary, backlinks/backlinks, timeseries_new_lost_summary,
 * bulk_ranks, bulk_referring_domains, bulk_new_lost_referring_domains,
 * domain_intersection, page_intersection, backlinks/competitors,
 * content_analysis/search, backlinks/filters and appendix/errors. The saved
 * samples in `src/lib/diy/core/samples/backlinks_*.json` and
 * `content_analysis_search.json` were built from each page's own example
 * response with made-up hosts and text, and `src/lib/diy/links/requests.test.mts`
 * runs every parser on them.
 *
 * **Parsers keep named fields only.** No `attributes`, no `sponsored` (the
 * summary's attribute counts are folded into followed, not followed and
 * other here, before anything is stored), no spam score of any kind (the
 * domain gap uses one as a request filter only), no `keyword_difficulty`.
 * DataForSEO's `rank` is kept, and every page that shows it says "DataForSEO
 * estimate, 0-1000, read <date>"; `rank_scale` is asked for explicitly where
 * a rank is read, so the scale is the one the words state.
 *
 * **The [VERIFY] items of spec 10 section 6.10, as the documentation read on
 * 13 Oct 2026 answers them** (the first paid call of each still logs its
 * `task.cost`, and the stored `available_filters` names decide at run time):
 *
 * - `domain_intersection` can filter and order on `intersections_count`: the
 *   backlinks/filters page lists it among the domain_intersection filters
 *   ("intersections_count": "num"). So the gap asks for `intersections_count
 *   > 1` when the night's stored filter names carry it (`>` as the pages'
 *   own examples write it; their operator lists name neither `>` nor `>=`),
 *   ordered by it and then by rank, and falls back to the pairwise
 *   `intersection_mode "all"` reads when they do not (links/gap.ts).
 * - Every list read is capped at 100 rows, so its `total_count` is kept
 *   beside the rows (13 Oct 2026, review of DIY P10: the "N more" counts were
 *   counted from the 100 rows read and shown as exact). The page says a count
 *   is exact only when every row was read, and otherwise words it as
 *   DataForSEO's estimate (links/gap.ts gapCount, links/targets.ts).
 * - `domain_intersection` does not return `domain_from_platform_type`: its
 *   per-target object carries `referring_links_platform_types`, which counts
 *   links per platform type, not the site's own type. So there is no
 *   platform column (spec 10 section 4.8 row 3: "the column is dropped if
 *   not"; 13 Oct 2026, review of DIY P10).
 * - `page_intersection` neither returns nor filters on
 *   `ranked_keywords_info.page_from_keywords_count_top_10` (absent from both
 *   its response table and its filter list), so the "ranks in Google's top
 *   10" column is not built and targets order on links and page rank.
 * - backlinks/backlinks has no `lost_date` on a link: `last_seen` is kept.
 * - The summary has no `backlinks_nofollow`: follow status comes from
 *   `referring_links_attributes`, which counts each link once under every
 *   attribute it carries - a `rel="nofollow ugc"` link is in both `nofollow`
 *   and `ugc`. So only `nofollow` is read: not followed is the links marked
 *   nofollow, followed is the rest, and no other attribute is summed (13 Oct
 *   2026, review of DIY P10: subtracting `ugc` and `sponsored` as well took
 *   overlapping links off twice, and showed 20% followed for 60%).
 * - The access error: appendix/errors lists 40204 "access denied. visit plans
 *   and subscriptions to activate your subscription and get access to this
 *   api", the Backlinks commitment's code; the other access and payment
 *   codes are read the same way (links/access.ts).
 */
export const DIY_LINK_PATHS = {
  backlinks_summary: "/v3/backlinks/summary/live",
  backlinks_links: "/v3/backlinks/backlinks/live",
  backlinks_series: "/v3/backlinks/timeseries_new_lost_summary/live",
  backlinks_bulk_ranks: "/v3/backlinks/bulk_ranks/live",
  backlinks_bulk_domains: "/v3/backlinks/bulk_referring_domains/live",
  backlinks_bulk_new_lost: "/v3/backlinks/bulk_new_lost_referring_domains/live",
  backlinks_domain_gap: "/v3/backlinks/domain_intersection/live",
  backlinks_page_gap: "/v3/backlinks/page_intersection/live",
  backlinks_competitors: "/v3/backlinks/competitors/live",
  content_search: "/v3/content_analysis/search/live",
} as const;
export type DiyLinkPathKey = keyof typeof DIY_LINK_PATHS;

/** Which ledger door each wave 3 read goes through (`diy_reads.door`). */
export const DIY_LINK_DOOR: Record<DiyLinkPathKey, "backlinks" | "content"> = {
  backlinks_summary: "backlinks",
  backlinks_links: "backlinks",
  backlinks_series: "backlinks",
  backlinks_bulk_ranks: "backlinks",
  backlinks_bulk_domains: "backlinks",
  backlinks_bulk_new_lost: "backlinks",
  backlinks_domain_gap: "backlinks",
  backlinks_page_gap: "backlinks",
  backlinks_competitors: "backlinks",
  content_search: "content",
};

/**
 * Row ceilings (section 5.6 item 5): 100 at most on every wave 3 list, 20 for
 * backlinks competitors; anything higher is refused here rather than sent. A
 * Backlinks read bills $0.000036 a row on top of its $0.024 (section 5.1), so
 * the limit is the bill's upper bound.
 */
export const DIY_LINK_LIMIT = { backlinks_links: 100, backlinks_domain_gap: 100, backlinks_page_gap: 100, backlinks_competitors: 20, content_search: 100 } as const;

function linkLimit(endpoint: keyof typeof DIY_LINK_LIMIT, asked: number): number {
  const ceiling = DIY_LINK_LIMIT[endpoint];
  if (!Number.isInteger(asked) || asked < 1 || asked > ceiling) throw new Error(`${endpoint} limit ${asked} is outside 1-${ceiling}`);
  return asked;
}

/** The comparison set and the client: at most 4 targets on a bulk read (the client and 3), at most 3 compared. */
export const BULK_TARGETS_MAX = 4;
export const GAP_TARGETS_MAX = 3;

const DAY_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const isDay = (d: string) => DAY_ONLY.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`));
/** A Backlinks filter time: "yyyy-mm-dd hh:mm:ss +00:00" (backlinks/filters, the `time` type). */
const filterTime = (d: string) => {
  if (!isDay(d)) throw new Error(`not a day: ${d}`);
  return `${d} 00:00:00 +00:00`;
};

function targetList(domains: readonly string[], max: number): string[] {
  const out = domains.map(diyTarget);
  if (out.length < 1 || out.length > max) throw new Error(`${out.length} targets: 1-${max} only`);
  if (new Set(out).size !== out.length) throw new Error("a target is asked twice");
  return out;
}

/** The intersection endpoints take their targets keyed "1", "2", "3" (domain_intersection and page_intersection, `targets` object). */
function keyedTargets(domains: readonly string[], min: number): Record<string, string> {
  const list = targetList(domains, GAP_TARGETS_MAX);
  if (list.length < min) throw new Error(`${list.length} targets: at least ${min}`);
  return Object.fromEntries(list.map((d, i) => [String(i + 1), d]));
}

/** The client's profile: one object, billed as one row ([VERIFY] on the first call's task.cost). $0.024036. */
export function backlinksSummaryRequest(target: string): DiyRequest {
  return {
    endpoint: "backlinks_summary",
    path: DIY_LINK_PATHS.backlinks_summary,
    timeoutMs: 60_000,
    rows: 1,
    body: [{ target: diyTarget(target), include_subdomains: true, backlinks_status_type: "live", rank_scale: "one_thousand" }],
  };
}

/**
 * The week's new or lost referring domains, one link per domain, newest
 * first (spec 10 section 5.2: two filtered calls, because one call returning
 * both is not confirmed). New links are live ones first seen since `since`;
 * lost ones are asked for with `backlinks_status_type: "lost"` - a lost link
 * is not in the default `live` set (backlinks/backlinks, read 13 Oct 2026) -
 * last seen since `since`. 100 rows: $0.0276.
 */
export function backlinksNewLostRequest(p: { target: string; which: "new" | "lost"; since: string; limit?: number }): DiyRequest {
  const limit = linkLimit("backlinks_links", p.limit ?? 100);
  const at = filterTime(p.since);
  const isNew = p.which === "new";
  return {
    endpoint: "backlinks_links",
    path: DIY_LINK_PATHS.backlinks_links,
    timeoutMs: 60_000,
    rows: limit,
    body: [
      {
        target: diyTarget(p.target),
        mode: "one_per_domain",
        backlinks_status_type: isNew ? "live" : "lost",
        filters: isNew ? [["is_new", "=", true], "and", ["first_seen", ">", at]] : [["is_lost", "=", true], "and", ["last_seen", ">", at]],
        order_by: [isNew ? "first_seen,desc" : "last_seen,desc"],
        limit,
      },
    ],
  };
}

/** New and lost referring domains per week since `from` (the 13-week bars). About 14 rows: $0.0245. */
export function backlinksSeriesRequest(p: { target: string; from: string; to: string }): DiyRequest {
  if (!isDay(p.from) || !isDay(p.to) || p.from > p.to) throw new Error(`not a range: ${p.from} to ${p.to}`);
  const weeks = Math.ceil((Date.parse(`${p.to}T00:00:00Z`) - Date.parse(`${p.from}T00:00:00Z`)) / (7 * 86_400_000)) + 1;
  if (weeks > 27) throw new Error("the series is 26 weeks at most");
  return {
    endpoint: "backlinks_series",
    path: DIY_LINK_PATHS.backlinks_series,
    timeoutMs: 60_000,
    rows: weeks,
    body: [{ target: diyTarget(p.target), date_from: p.from, date_to: p.to, group_range: "week", include_subdomains: true }],
  };
}

/** DataForSEO's rank for the client and its comparison set. 4 targets: $0.0241. */
export function bulkRanksRequest(targets: readonly string[]): DiyRequest {
  const list = targetList(targets, BULK_TARGETS_MAX);
  return { endpoint: "backlinks_bulk_ranks", path: DIY_LINK_PATHS.backlinks_bulk_ranks, timeoutMs: 60_000, rows: list.length, body: [{ targets: list, rank_scale: "one_thousand" }] };
}

/** Referring domains for the client and its comparison set. 4 targets: $0.0241. */
export function bulkReferringDomainsRequest(targets: readonly string[]): DiyRequest {
  const list = targetList(targets, BULK_TARGETS_MAX);
  return { endpoint: "backlinks_bulk_domains", path: DIY_LINK_PATHS.backlinks_bulk_domains, timeoutMs: 60_000, rows: list.length, body: [{ targets: list }] };
}

/** New and lost referring domains since `from` (30 days back) for the client and its comparison set. 4 targets: $0.0241. */
export function bulkNewLostRequest(p: { targets: readonly string[]; from: string }): DiyRequest {
  const list = targetList(p.targets, BULK_TARGETS_MAX);
  if (!isDay(p.from)) throw new Error(`not a day: ${p.from}`);
  return { endpoint: "backlinks_bulk_new_lost", path: DIY_LINK_PATHS.backlinks_bulk_new_lost, timeoutMs: 60_000, rows: list.length, body: [{ targets: list, date_from: p.from }] };
}

/**
 * Rank keys for `order_by`, one per target key ("1.rank,desc"), at most
 * `room` of them: the intersection endpoints sort on a target's own block
 * (backlinks/filters lists `$key.rank` and `$key.page_from_rank`), and take
 * three sorting rules at most.
 */
const rankKeys = (keys: readonly string[], field: "rank" | "page_from_rank", room: number): string[] => keys.slice(0, room).map((k) => `${k}.${field},desc`);

/**
 * The link gap by domain (spec 10 sections 5.2 and 6.3): referring domains
 * linking to the comparison set and not to the client, followed links only,
 * with a spam score under 30 as a request filter only (never stored or
 * shown). Two forms:
 *
 * - `partial` over the 3, with `intersections_count > 1` when the stored
 *   filter names carry it, so `total_count` is the n >= 2 count; ordered by
 *   that count, then rank, so the 100 rows read are the head of the set;
 * - `all` over one pair, the pairwise fallback: three of these, ordered by
 *   rank. Their union is the n >= 2 set only while each pair's
 *   `total_count` is within the rows read; past that it is the head of each
 *   pair, and the page words its count as at least (links/gap.ts).
 *
 * 100 rows: $0.0276 each.
 */
export function domainGapRequest(p: { targets: readonly string[]; exclude: string; mode: "partial" | "all"; countFilter: boolean; limit?: number }): DiyRequest {
  const limit = linkLimit("backlinks_domain_gap", p.limit ?? 100);
  const targets = keyedTargets(p.targets, 2);
  const keys = Object.keys(targets);
  if (p.mode === "all" && keys.length !== 2) throw new Error("the pairwise read takes one pair");
  const order = p.countFilter ? ["intersections_count,desc", ...rankKeys(keys, "rank", 2)] : rankKeys(keys, "rank", 3);
  return {
    endpoint: "backlinks_domain_gap",
    path: DIY_LINK_PATHS.backlinks_domain_gap,
    timeoutMs: 60_000,
    rows: limit,
    body: [
      {
        targets,
        exclude_targets: [diyTarget(p.exclude)],
        intersection_mode: p.mode,
        include_subdomains: true,
        backlinks_filters: [["dofollow", "=", true], "and", ["backlink_spam_score", "<", 30]],
        ...(p.countFilter ? { filters: ["intersections_count", ">", 1] } : {}),
        order_by: order,
        rank_scale: "one_thousand",
        limit,
      },
    ],
  };
}

/**
 * Link targets by page (spec 10 sections 5.2 and 6.3): pages linking to at
 * least one of the comparison set and not to the client, from inside an
 * article, followed - each target's link tested on its own key
 * (`$key.dofollow`, `$key.semantic_location`), six conditions under the
 * documented eight. Ordered by how many of the set a page links to, then by
 * the page's rank, so the 100 rows read are the head of the list (13 Oct
 * 2026, review of DIY P10: unordered, the 100 were an arbitrary 100).
 * 100 rows: $0.0276.
 */
export function pageGapRequest(p: { targets: readonly string[]; exclude: string; limit?: number }): DiyRequest {
  const limit = linkLimit("backlinks_page_gap", p.limit ?? 100);
  const targets = keyedTargets(p.targets, 1);
  const keys = Object.keys(targets);
  const each = keys.map((k) => [[`${k}.dofollow`, "=", true], "and", [`${k}.semantic_location`, "=", "article"]]);
  const filters = each.length === 1 ? each[0] : each.flatMap((f, i) => (i === 0 ? [f] : ["or", f]));
  const order_by = keys.length > 1 ? ["intersections_count,desc", ...rankKeys(keys, "page_from_rank", 2)] : rankKeys(keys, "page_from_rank", 1);
  return {
    endpoint: "backlinks_page_gap",
    path: DIY_LINK_PATHS.backlinks_page_gap,
    timeoutMs: 60_000,
    rows: limit,
    body: [{ targets, exclude_targets: [diyTarget(p.exclude)], intersection_mode: "partial", include_subdomains: true, filters, order_by, rank_scale: "one_thousand", limit }],
  };
}

/** Domains sharing backlinks with the client, the large generalists left out (comparison-set fallback, second source). 20 rows: $0.0247. */
export function backlinksCompetitorsRequest(target: string): DiyRequest {
  const limit = linkLimit("backlinks_competitors", 20);
  return {
    endpoint: "backlinks_competitors",
    path: DIY_LINK_PATHS.backlinks_competitors,
    timeoutMs: 60_000,
    rows: limit,
    body: [{ target: diyTarget(target), limit, main_domain: true, exclude_large_domains: true, rank_scale: "one_thousand" }],
  };
}

const PHRASE = /^[\p{L}\p{N}][\p{L}\p{N} .&'-]{1,59}$/u;

/** A brand as the content search asks for it: 2-60 letters, digits, spaces and . & ' -; nothing that could break the quoted phrase. Throws on anything else. */
export function searchBrand(raw: string): string {
  const b = raw.trim().replace(/\s+/g, " ");
  if (!PHRASE.test(b)) throw new Error(`not a brand the content search can be asked for: ${JSON.stringify(raw.slice(0, 80))}`);
  return b;
}

/**
 * The phrase a client's mentions are searched for, worked out before any
 * paid read (13 Oct 2026, review of DIY P10: an ordinary company name -
 * "Smith, Jones & Co", "Yahoo!", "Brand (UK)" - threw in the request builder
 * after the month's other reads were bought, and the job was retried and
 * re-bought). The brand with a bracketed qualifier dropped and every
 * character the quoted phrase cannot take turned to a space, cut at a word
 * by 60 characters; when that leaves fewer than 3 letters or digits, the
 * first label of the client's domain ("tallyroo" for tallyroo.com); and when
 * neither can be asked, null - the job notes it and reads no mentions. Pure.
 */
export function brandPhrase(brand: string | null | undefined, domain: string): string | null {
  const tidy = (raw: string): string | null => {
    let b = raw
      .replace(/\([^)]*\)/g, " ")
      .replace(/[^\p{L}\p{N} .&'-]+/gu, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/^[^\p{L}\p{N}]+/u, "")
      .replace(/[\s.&'-]+$/u, "");
    if (b.length > 60) b = b.slice(0, 61).replace(/\s+\S*$/u, "").trim();
    return (b.match(/[\p{L}\p{N}]/gu) ?? []).length >= 3 && PHRASE.test(b) ? b : null;
  };
  const label = domain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[./]/)[0] ?? "";
  return (brand ? tidy(brand) : null) ?? tidy(label);
}

/**
 * Pages that mention the brand, one per domain (mention candidates, confirmed
 * by our own read before any is shown): English-language pages only, every
 * market reading English (as the Labs reads' `language_code`), most
 * prominent citation first (`score`, which the documentation describes as
 * built from the page's and domain's rank and the phrase in its title, URL
 * and snippet). Without an `order_by` the documented default is
 * `content_info.sentiment_connotations.anger,desc` (13 Oct 2026, review of
 * DIY P10). 100 rows: $0.0276.
 */
export function contentSearchRequest(p: { phrase: string; limit?: number }): DiyRequest {
  const limit = linkLimit("content_search", p.limit ?? 100);
  return {
    endpoint: "content_search",
    path: DIY_LINK_PATHS.content_search,
    timeoutMs: 60_000,
    rows: limit,
    body: [{ keyword: `"${searchBrand(p.phrase)}"`, search_mode: "one_per_domain", filters: ["content_info.language", "=", "en"], order_by: ["score,desc"], limit }],
  };
}

// ── wave 3 parsers: named fields only ──

const host = (v: unknown): string | null => {
  const t = text(v, 253);
  return t ? t.toLowerCase().replace(/^www\./, "") : null;
};
const nonNeg = (v: unknown): number | null => {
  const n = numOrNull(v);
  return n !== null && n >= 0 ? n : null;
};

/**
 * Follow status of the profile's links, from the attribute counts: the links
 * marked `nofollow` are not followed, and the rest are followed. Nothing else
 * is summed: the counts overlap (a link is counted under every attribute it
 * carries), so `ugc` or `sponsored` subtracted as well would take a
 * `rel="nofollow ugc"` link off twice (13 Oct 2026, review of DIY P10).
 */
export type FollowSplit = { followed: number; notFollowed: number };

export function followSplit(total: number | null, attrs: unknown): FollowSplit | null {
  if (total === null) return null;
  const notFollowed = Math.min(total, nonNeg(obj(attrs).nofollow) ?? 0);
  return { followed: total - notFollowed, notFollowed };
}

export type BacklinksSummary = {
  /** DataForSEO's rank, 0-1000 (a vendor estimate). */
  rank: number | null;
  backlinks: number | null;
  referringDomains: number | null;
  referringMainDomains: number | null;
  firstSeen: string | null;
  follow: FollowSplit | null;
};

export function parseBacklinksSummary(task: Task): BacklinksSummary | null {
  const r = firstResult(task);
  if (!Object.keys(r).length) return null;
  const backlinks = nonNeg(r.backlinks);
  return {
    rank: nonNeg(r.rank),
    backlinks,
    referringDomains: nonNeg(r.referring_domains),
    referringMainDomains: nonNeg(r.referring_main_domains),
    firstSeen: dayOrNull(r.first_seen),
    follow: followSplit(backlinks, r.referring_links_attributes),
  };
}

/** One link of the week's new or lost set: the domain, the page it is on, the page of the client's it points at. */
export type LinkRow = { domain: string; urlFrom: string | null; urlTo: string | null; followed: boolean | null; firstSeen: string | null; lastSeen: string | null };

export function parseBacklinkList(task: Task): { total: number | null; rows: LinkRow[] } {
  const r = firstResult(task);
  const rows: LinkRow[] = [];
  for (const raw of arr(r.items)) {
    const it = obj(raw);
    const domain = host(it.domain_from);
    if (!domain) continue;
    rows.push({ domain, urlFrom: text(it.url_from, 500), urlTo: text(it.url_to, 500), followed: boolOrNull(it.dofollow), firstSeen: dayOrNull(it.first_seen), lastSeen: dayOrNull(it.last_seen) });
  }
  return { total: nonNeg(r.total_count), rows };
}

export type SeriesWeek = { week: string; newDomains: number; lostDomains: number };

/** The weekly bars: each week's last day, its new and lost referring domains. */
export function parseNewLostSeries(task: Task): SeriesWeek[] {
  const out: SeriesWeek[] = [];
  for (const raw of arr(firstResult(task).items)) {
    const it = obj(raw);
    const week = dayOrNull(it.date);
    if (!week) continue;
    out.push({ week, newDomains: nonNeg(it.new_referring_domains) ?? 0, lostDomains: nonNeg(it.lost_referring_domains) ?? 0 });
  }
  return out.sort((a, b) => a.week.localeCompare(b.week));
}

/** A bulk read, per target as DataForSEO echoes it (lower case, no `www.`). */
export function parseBulkRanks(task: Task): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const raw of arr(firstResult(task).items)) {
    const it = obj(raw);
    const t = host(it.target);
    if (t) out[t] = nonNeg(it.rank);
  }
  return out;
}

export function parseBulkReferringDomains(task: Task): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const raw of arr(firstResult(task).items)) {
    const it = obj(raw);
    const t = host(it.target);
    if (t) out[t] = nonNeg(it.referring_domains);
  }
  return out;
}

export function parseBulkNewLost(task: Task): Record<string, { newDomains: number | null; lostDomains: number | null }> {
  const out: Record<string, { newDomains: number | null; lostDomains: number | null }> = {};
  for (const raw of arr(firstResult(task).items)) {
    const it = obj(raw);
    const t = host(it.target);
    if (t) out[t] = { newDomains: nonNeg(it.new_referring_domains), lostDomains: nonNeg(it.lost_referring_domains) };
  }
  return out;
}

/** One referring domain of the gap: which of the compared sites it links to, its best rank among them, its earliest first seen. */
export type GapDomain = { domain: string; linksTo: string[]; rank: number | null; firstSeen: string | null };

/**
 * domain_intersection's rows. Each item's `domain_intersection` holds one
 * object per target key ("1"-"3"), absent or null where the domain does not
 * link to that target (which of the two is [VERIFY] on the first partial
 * read; both read the same here); `linksTo` names the targets from the
 * result's own `targets` echo.
 */
export function parseDomainIntersection(task: Task): { total: number | null; rows: GapDomain[] } {
  const r = firstResult(task);
  const names = obj(r.targets);
  const rows: GapDomain[] = [];
  for (const raw of arr(r.items)) {
    const di = obj(obj(raw).domain_intersection);
    let domain: string | null = null;
    const linksTo: string[] = [];
    let rank: number | null = null;
    let firstSeen: string | null = null;
    for (const key of Object.keys(di).sort()) {
      const b = di[key];
      if (!b || typeof b !== "object") continue;
      const block = obj(b);
      const target = host(names[key]);
      const from = host(block.target);
      if (!target || !from) continue;
      domain ??= from;
      linksTo.push(target);
      const rk = nonNeg(block.rank);
      if (rk !== null) rank = Math.max(rank ?? 0, rk);
      const fs = dayOrNull(block.first_seen);
      if (fs && (!firstSeen || fs < firstSeen)) firstSeen = fs;
    }
    if (!domain || !linksTo.length) continue;
    rows.push({ domain, linksTo, rank, firstSeen });
  }
  return { total: nonNeg(r.total_count), rows };
}

/** One page of the link targets: the page, and its followed in-article link to each compared site it links to. */
export type GapPage = {
  urlFrom: string;
  title: string | null;
  domain: string;
  links: { target: string; urlTo: string | null; anchor: string | null }[];
  pageRank: number | null;
  firstSeen: string | null;
};

/**
 * page_intersection's rows. Each item's `page_intersection` holds, per target
 * key, an array of that page's links to the target. Only links that are
 * followed and inside an article are kept (the request filters on them too):
 * a page with none is dropped.
 */
export function parsePageIntersection(task: Task): { total: number | null; rows: GapPage[] } {
  const r = firstResult(task);
  const names = obj(r.targets);
  const rows: GapPage[] = [];
  for (const raw of arr(r.items)) {
    const pi = obj(obj(raw).page_intersection);
    let page: Omit<GapPage, "links"> | null = null;
    const links: GapPage["links"] = [];
    for (const key of Object.keys(pi).sort()) {
      const target = host(names[key]);
      if (!target) continue;
      const kept = arr(pi[key]).map(obj).find((l) => l.dofollow === true && l.semantic_location === "article");
      if (!kept) continue;
      const urlFrom = text(kept.url_from, 500);
      const domain = host(kept.domain_from);
      if (!urlFrom || !domain) continue;
      const fs = dayOrNull(kept.first_seen);
      page ??= { urlFrom, title: text(kept.page_from_title, 300), domain, pageRank: nonNeg(kept.page_from_rank), firstSeen: fs };
      if (fs && page.firstSeen && fs < page.firstSeen) page.firstSeen = fs;
      links.push({ target, urlTo: text(kept.url_to, 500), anchor: text(kept.anchor, 200) });
    }
    if (page && links.length) rows.push({ ...page, links });
  }
  return { total: nonNeg(r.total_count), rows };
}

export type BacklinkCompetitor = { domain: string; rank: number | null; intersections: number | null };

export function parseBacklinksCompetitors(task: Task): BacklinkCompetitor[] {
  const out: BacklinkCompetitor[] = [];
  for (const raw of arr(firstResult(task).items)) {
    const it = obj(raw);
    const domain = host(it.target);
    if (domain) out.push({ domain, rank: nonNeg(it.rank), intersections: nonNeg(it.intersections) });
  }
  return out;
}

/** A page that mentions the brand: a candidate only, until our own read confirms it names the client and does not link. */
export type MentionCandidate = { url: string; domain: string; title: string | null; published: string | null; snippet: string | null };

export function parseContentSearch(task: Task): { total: number | null; rows: MentionCandidate[] } {
  const r = firstResult(task);
  const rows: MentionCandidate[] = [];
  for (const raw of arr(r.items)) {
    const it = obj(raw);
    const url = text(it.url, 500);
    const domain = host(it.domain);
    if (!url || !domain) continue;
    const c = obj(it.content_info);
    rows.push({ url, domain, title: text(c.main_title, 300) ?? text(c.title, 300), published: dayOrNull(c.date_published), snippet: text(c.snippet, 200) });
  }
  return { total: nonNeg(r.total_count), rows };
}


// ── keyword research (17 Oct 2026, the dashboards host's "Find keywords") ──

/** One researched keyword: what Search positions shows beside "Track". Every figure is DataForSEO's estimate. */
export type ResearchedKeyword = { keyword: string; volume: number | null; kd: number | null; cpc: number | null; intent: Intent | null };

/** The longest seed keyword a search takes. */
export const RESEARCH_SEED_MAX = 80;

/** A seed as asked: lower-case, single-spaced, 2 to RESEARCH_SEED_MAX characters. Throws on anything else. */
export function researchSeed(raw: string): string {
  const s = keywordForm(raw).slice(0, RESEARCH_SEED_MAX);
  if (s.length < 2) throw new Error("a seed keyword is 2 to 80 characters");
  return s;
}

/** Keywords that contain the seed (Labs keyword_suggestions), most searched first. 50 rows is $0.018. */
export function keywordSuggestionsRequest(p: { seed: string; market: Market; limit?: number }): DiyRequest {
  const limit = diyLimit("keyword_suggestions", p.limit ?? 50);
  return {
    endpoint: "keyword_suggestions",
    path: DIY_PATHS.keyword_suggestions,
    timeoutMs: 30_000,
    rows: limit,
    body: [{ keyword: researchSeed(p.seed), ...location(p.market), limit, include_seed_keyword: true, order_by: ["keyword_info.search_volume,desc"] }],
  };
}

/** Keywords searched alongside the seed (Labs related_keywords, depth 1), most searched first. */
export function relatedKeywordsRequest(p: { seed: string; market: Market; limit?: number }): DiyRequest {
  const limit = diyLimit("related_keywords", p.limit ?? 50);
  return {
    endpoint: "related_keywords",
    path: DIY_PATHS.related_keywords,
    timeoutMs: 30_000,
    rows: limit,
    body: [{ keyword: researchSeed(p.seed), ...location(p.market), depth: 1, limit, order_by: ["keyword_data.keyword_info.search_volume,desc"] }],
  };
}

/** Difficulty for up to 100 keywords at once (Labs bulk_keyword_difficulty). */
export function keywordDifficultyRequest(p: { keywords: readonly string[]; market: Market }): DiyRequest {
  const keywords = [...new Set(p.keywords.map((k) => keywordForm(k)).filter((k) => k.length >= 2))].slice(0, DIY_LIMIT_CEILING.keyword_difficulty);
  if (!keywords.length) throw new Error("difficulty needs at least one keyword");
  return { endpoint: "keyword_difficulty", path: DIY_PATHS.keyword_difficulty, timeoutMs: 30_000, rows: keywords.length, body: [{ keywords, ...location(p.market) }] };
}

/** A Labs keyword record - suggestions' item, or related's keyword_data - as a ResearchedKeyword. */
function researched(data: Obj): ResearchedKeyword | null {
  const keyword = text(data.keyword, 120);
  if (!keyword) return null;
  const info = obj(data.keyword_info);
  const intent = obj(data.search_intent_info).main_intent;
  const kd = numOrNull(obj(data.keyword_properties).keyword_difficulty);
  const cpc = numOrNull(info.cpc);
  return {
    keyword: keywordForm(keyword),
    volume: numOrNull(info.search_volume),
    kd: kd === null ? null : Math.max(0, Math.min(100, Math.round(kd))),
    cpc: cpc === null ? null : Math.round(cpc * 100) / 100,
    intent: (INTENTS as readonly string[]).includes(String(intent)) ? (intent as Intent) : null,
  };
}

export function parseKeywordSuggestions(task: Task): ResearchedKeyword[] {
  return arr(firstResult(task).items).map((i) => researched(obj(i))).filter((x): x is ResearchedKeyword => x !== null);
}

export function parseRelatedKeywords(task: Task): ResearchedKeyword[] {
  return arr(firstResult(task).items).map((i) => researched(obj(obj(i).keyword_data))).filter((x): x is ResearchedKeyword => x !== null);
}

export function parseKeywordDifficulty(task: Task): { keyword: string; kd: number | null }[] {
  return arr(firstResult(task).items)
    .map((i) => {
      const o = obj(i);
      const keyword = text(o.keyword, 120);
      const kd = numOrNull(o.keyword_difficulty);
      return keyword ? { keyword: keywordForm(keyword), kd: kd === null ? null : Math.max(0, Math.min(100, Math.round(kd))) } : null;
    })
    .filter((x): x is { keyword: string; kd: number | null } => x !== null);
}
