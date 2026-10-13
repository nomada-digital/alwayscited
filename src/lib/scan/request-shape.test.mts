import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  MARKET_ISO,
  MAX_OUTPUT_TOKENS,
  MIN_BUDGET_MS,
  RESPONSE_MODELS,
  SERP_DEPTH,
  TASK_OK,
  budgetFor,
  KEYWORD_INTENT_PATH,
  KEYWORD_VOLUME_PATH,
  firstTask,
  keywordIntentRequest,
  keywordIntents,
  keywordForm,
  keywordRankRequest,
  keywordVolumeRequest,
  keywordVolumes,
  requestFor,
  taskCost,
  type Task,
} from "./dataforseo-request.ts";
import { code, sourceFiles } from "../source-read.mts";
import { MARKETS, type Market } from "./domain.ts";
import { ENGINES } from "./engines.ts";

/**
 * The module this tree spends the most money through had no executor until
 * 20 September 2026.
 *
 * It said "the only module in this tree that spends money" until later that
 * day, and that was false three ways over: `anthropic.ts` bills per model
 * call, and Resend bills per message through three senders. The sentence is
 * corrected rather than deleted because it is the same wrong premise that left
 * `scan/[token]/resend` outside both spend sweeps - see `spenders.mts`. **The
 * denominator of "what spends" is bigger than the scan pipeline**, and a
 * comment that says otherwise is how it stays that way.
 *
 * `dataforseo.ts` is `server-only`, so Node's runner cannot load it, and it was
 * one of the source files named by no test - swept for text by the four walking
 * sweeps, with nothing anywhere running the behaviour. Its pure half is now
 * `dataforseo-request.ts` and this file runs it.
 *
 * Nothing here retypes a request body to compare against. Every expectation is
 * derived: the engine list off `ENGINES`, the location codes off `MARKETS`, the
 * country codes off `MARKET_ISO`, the depth off `SERP_DEPTH`. A test that
 * duplicates the value it is checking is true by construction - this repo has
 * shipped four of those - so what is asserted here is the *shape*, and the one
 * place a literal appears it is read back out of the source file rather than
 * typed.
 */

const QUESTION = "Who are the best analytics consultants for Shopify stores?";
const MARKET_LIST = Object.keys(MARKETS) as Market[];

/** The single task object every DataForSEO endpoint here is posted. */
function taskOf(engine: (typeof ENGINES)[number], market: Market = "UK"): Record<string, unknown> {
  const { body } = requestFor(engine, QUESTION, market);
  assert.ok(Array.isArray(body), `${engine}: the body must be an array of tasks`);
  assert.equal(body.length, 1, `${engine}: one question is one task`);
  return body[0] as Record<string, unknown>;
}

// ───────────────────────────── the request shape ─────────────────────────────

test("every engine has a request, and no two share a path", () => {
  const paths = new Set<string>();
  for (const engine of ENGINES) {
    const req = requestFor(engine, QUESTION, "UK");
    assert.ok(req, `${engine} builds no request at all`);
    assert.match(req.path, /^\/v3\//, `${engine}: path is not a v3 endpoint`);
    assert.ok(req.timeoutMs > 0, `${engine}: no timeout`);
    assert.ok(!paths.has(req.path), `${engine} reuses another engine's path: ${req.path}`);
    paths.add(req.path);
  }
  assert.equal(paths.size, ENGINES.length);
});

test("every engine is asked the question verbatim", () => {
  for (const engine of ENGINES) {
    const task = taskOf(engine);
    const asked = task.keyword ?? task.user_prompt;
    assert.equal(asked, QUESTION, `${engine} did not send the question under keyword or user_prompt`);
  }
});

/**
 * The assertion that found the defect this file was written for.
 *
 * Four of the five engines took something derived from the market - a
 * `location_code` on the scrapers, a country ISO on Perplexity - and Claude
 * took nothing, on the same endpoint family as Perplexity and with
 * `web_search: true` set. A UK scan asked it with no country at all, and "who
 * are the best suppliers" answered without a country is a different answer.
 *
 * It had never shipped a wrong reading: `GATED_ENGINES` is empty and
 * `FREE_ENGINES` leaves Claude out, so nothing has run that branch on a live
 * scan. It would have on the first run after anyone added Claude to either
 * list, which is a jsonb edit in `app_settings` and no deploy - the same shape
 * as every other defect `settings-merge.ts` was split out to catch.
 */
test("every engine's request changes with the market", () => {
  assert.ok(MARKET_LIST.length > 1, "this test needs two markets to compare");
  const [a, b] = MARKET_LIST;
  for (const engine of ENGINES) {
    assert.notDeepEqual(
      requestFor(engine, QUESTION, a),
      requestFor(engine, QUESTION, b),
      `${engine} sends an identical request for ${a} and ${b}, so its answer is not a reading of either market`,
    );
  }
});

test("the market reaches the request as the value MARKETS and MARKET_ISO hold", () => {
  for (const market of MARKET_LIST) {
    for (const engine of ENGINES) {
      const task = taskOf(engine, market);
      const code = task.location_code;
      const iso = task.web_search_country_iso_code;
      assert.ok(
        code !== undefined || iso !== undefined,
        `${engine}/${market}: neither a location code nor a country ISO`,
      );
      if (code !== undefined) assert.equal(code, MARKETS[market].location_code, `${engine}/${market}`);
      if (iso !== undefined) assert.equal(iso, MARKET_ISO[market], `${engine}/${market}`);
    }
  }
});

test("every LLM Responses engine is capped and named, so no answer is an unbounded bill", () => {
  for (const engine of ENGINES) {
    const task = taskOf(engine);
    if (!("user_prompt" in task)) continue;
    assert.equal(task.max_output_tokens, MAX_OUTPUT_TOKENS, `${engine} is not capped`);
    const model = (RESPONSE_MODELS as Record<string, string | undefined>)[engine];
    assert.ok(model, `${engine} posts to an llm_responses endpoint with no entry in RESPONSE_MODELS`);
    assert.equal(task.model_name, model, `${engine} asks a model RESPONSE_MODELS does not name`);
  }
});

/**
 * The ladder. `depth` is typed in one request body and described in prose in
 * four other files as "the top twenty"; nothing connected the two, so changing
 * the request would have left every one of those descriptions stating a number
 * the scan no longer measures. A fixed rung named in prose beside a fixed rung
 * typed in code is this repo's own defect species.
 *
 * Read out of the sources rather than typed here, so this fails on either side
 * moving.
 */
test("the SERP depth and the prose that describes it agree", () => {
  const WORDS: Record<number, string> = { 10: "ten", 20: "twenty", 30: "thirty" };
  const word = WORDS[SERP_DEPTH];
  assert.ok(word, `SERP_DEPTH is ${SERP_DEPTH} and this test has no word for it - add one`);

  assert.equal(taskOf("google_aio").depth, SERP_DEPTH, "the request no longer sends SERP_DEPTH");

  const files = [
    "src/lib/scan/pipeline.ts",
    "src/lib/scan/contract.ts",
    "src/lib/scan/unlock.ts",
    "src/components/scan/ScanFlow.tsx",
  ];
  let found = 0;
  for (const file of files) {
    const text = readFileSync(new URL(`../../../${file}`, import.meta.url), "utf8");
    for (const m of text.matchAll(/top (\w+)/gi)) {
      const said = m[1].toLowerCase();
      if (!/^\d+$/.test(said) && !Object.values(WORDS).includes(said)) continue;
      found += 1;
      const asNumber = /^\d+$/.test(said) ? Number(said) : SERP_DEPTH;
      assert.equal(
        /^\d+$/.test(said) ? asNumber : said,
        /^\d+$/.test(said) ? SERP_DEPTH : word,
        `${file} describes the Google rank as "top ${said}" and the request reads ${SERP_DEPTH}`,
      );
    }
  }
  assert.ok(found > 3, `only ${found} descriptions of the depth were found - the census has gone blind`);
});

// ──────────────────────────────── the budget ────────────────────────────────

test("the budget is the shorter of the two, floored, and survives a NaN", () => {
  const engineNeeds = 130_000;

  assert.equal(budgetFor(engineNeeds, undefined), engineNeeds, "no run budget means the engine's own");
  assert.equal(budgetFor(engineNeeds, 200_000), engineNeeds, "a longer run budget does not extend a read");
  assert.equal(budgetFor(engineNeeds, 40_000), 40_000, "a shorter run budget wins");
  assert.equal(budgetFor(engineNeeds, 0), MIN_BUDGET_MS, "a spent budget still tries once");
  assert.equal(budgetFor(engineNeeds, -90_000), MIN_BUDGET_MS, "an overrun budget still tries once");

  /**
   * `remainingMs` is `deadline - Date.now()` and `typeof NaN === "number"`, so
   * a NaN passed the old guard, survived both Math calls and reached
   * `AbortSignal.timeout`, which coerces it to 0. Every remaining read in the
   * pass would have aborted before its request was sent - on a scan already
   * marked running, with the calls already counted against the spend ceiling.
   */
  assert.equal(budgetFor(engineNeeds, Number.NaN), engineNeeds, "a NaN budget must not abort the read");
  assert.equal(budgetFor(engineNeeds, Number.POSITIVE_INFINITY), engineNeeds);
});

// ───────────────────────────── reading a task back ─────────────────────────────

const okTask: Task = { status_code: TASK_OK, cost: 0.0025, result: [{ items: [] }] };

test("firstTask refuses everything that is not one successful task", () => {
  assert.deepEqual(firstTask({ tasks: [okTask] }), okTask);

  assert.throws(() => firstTask({}), /no task/, "a response with no tasks key");
  assert.throws(() => firstTask({ tasks: null }), /no task/, "a null tasks list");
  assert.throws(() => firstTask({ tasks: [] }), /no task/, "an empty tasks list");
  assert.throws(() => firstTask({ tasks: {} as unknown as Task[] }), /no task/, "tasks as an object");

  /**
   * Asserted on the message, because the message is the only thing the
   * `Array.isArray` guard changes.
   *
   * Without it, `("x" ?? [])[0]` is the string "x", which is truthy, so the
   * next line reads `status_code` off a string and throws `DataForSEO task
   * undefined` - a sentence that names a task status DataForSEO never sent,
   * for a response that carried no task at all. That message is sliced into
   * `scan_answers.error`, the one column whose job is to say which kind of
   * failure this was, so a wrong diagnosis there is the whole cost.
   *
   * The injection that reverted the guard was MISSED on the first run of the
   * harness for exactly the reason `77a4a5b` records: a guard can be real and
   * still have no observable effect on the *value*. Both versions throw. Find
   * what the guard actually changes or the assertion is decoration.
   */
  assert.throws(() => firstTask({ tasks: "x" as unknown as Task[] }), /no task/, "tasks as a string");

  assert.throws(
    () => firstTask({ tasks: [{ status_code: 40501, status_message: "Invalid Field" }] }),
    /40501/,
    "a task that failed must not be read as a result",
  );
  assert.throws(() => firstTask({ tasks: [{ cost: 1 }] }), /undefined/, "a task with no status at all");
});

test("a cost that is not a positive finite number is zero", () => {
  assert.equal(taskCost(okTask), 0.0025);
  assert.equal(taskCost({ status_code: TASK_OK }), 0, "no cost field");
  assert.equal(taskCost({ cost: "0.01" as unknown as number }), 0, "a cost as a string");
  assert.equal(taskCost({ cost: Number.NaN }), 0, "a NaN cost");
  assert.equal(taskCost({ cost: Number.POSITIVE_INFINITY }), 0, "an infinite cost");
  /**
   * A negative cost is the one shape that can talk the daily cap into allowing
   * a scan it should refuse: `spend.dfsCost += read.cost` runs against a
   * ceiling, so a single negative read subsidises every read after it.
   */
  assert.equal(taskCost({ cost: -5 }), 0, "a negative cost must not credit the run");
});

// ───────────────────── the step that came out, and stays out ─────────────────────

/**
 * The search volume step, refused by name.
 *
 * Removed on 20 September 2026 on Danny's instruction: one DataForSEO call per
 * scan to `keywords_search_volume`, plus a write per question, sitting inside
 * the phase the progress bar holds at 85% - for a figure this site tells
 * visitors twice over that it does not use. The homepage FAQ answers "Why is
 * there no search volume anywhere in this?" with a dated reading, and the
 * confirm screen's footer says "No search volume against them, deliberately".
 * Both predate the removal, so no copy changed: the code was buying a number
 * the site already said it does not use.
 *
 * Search volume came back on 27 September 2026 (Danny, R39), for a derived
 * head keyword rather than the question text, through a different endpoint -
 * the two tests after this one hold that. This endpoint stays refused.
 *
 * **A removal rots back in, which is why this is a test and not a commit
 * message** - the shape the engine-count sweep already has. What is asserted is
 * that nothing in the shipped tree reaches this endpoint again, never that
 * today's diff deleted some lines. The endpoint PATH is the thing named,
 * because a path is what survives a reintroduction under a different function
 * name, and a different function name is exactly how a removal comes back.
 *
 * Read over the whole of `src` rather than over `scan/`: the door it would
 * return through need not be in the same directory. Comments stripped first -
 * the two doc comments recording this removal both name the endpoint, and a
 * sweep that read those would report the record of the removal as the defect,
 * which is this repo's most-paid-for reading error.
 */
const ROOT = new URL("../../../", import.meta.url).pathname;

test("nothing in the tree calls the search volume endpoint", () => {
  const callers: string[] = [];
  for (const file of sourceFiles(ROOT)) {
    if (/keywords_search_volume|readSearchVolumes|collectVolumes|volumeKey/.test(code(readFileSync(join(ROOT, file), "utf8")))) {
      callers.push(file);
    }
  }
  assert.deepEqual(
    callers,
    [],
    "the question-text search volume step is back. Volume returned on 27 Sep 2026 for derived head " +
      "keywords only, through keywordVolumeRequest - not this endpoint",
  );
});

/**
 * The narrower return (Danny, reversed 27 Sep 2026, R39): Google Ads volume
 * for the derived head keywords, one batched call a scan. The old endpoint
 * above stays refused by name. This one's path is held to the module that
 * builds its request, and the builder is called from exactly one sender,
 * `readKeywordVolumes` in `dataforseo.ts` - wired 27 Sep 2026 once R41's
 * columns were applied - so a second door onto the same bill is the defect
 * this reports.
 *
 * Asserted as an exact list, which is its own floor: a sweep that stopped
 * matching the path would fail here, not pass a tree with the call in five
 * places.
 */
test("the keyword volume endpoint is built in one module and sent from at most one", () => {
  const files: string[] = [];
  for (const file of sourceFiles(ROOT)) {
    if (code(readFileSync(join(ROOT, file), "utf8")).includes("keywords_data/google_ads/search_volume")) files.push(file);
  }
  assert.deepEqual(files, ["src/lib/scan/dataforseo-request.ts"]);
});

// Volume has two callers since 30 Sep 2026 (BRIEF-3 C1): the paid pass's
// per-question keywords (old scans), and /api/scan/[token]/questions reading
// the cluster keyword's candidates before the prompts are written, once per
// topic and market inside that route's CALL_CEILING reservation. And since 30
// Sep 2026 (BRIEF-3 T6 part 3b) check-keyword.ts, the Clusters page's Check
// keyword: one typed keyword, under CHECKS_PER_CLIENT_PER_DAY.
test("the keyword volume and keyword rank reads are each sent from one door, called from the passes named", () => {
  const senders: Record<string, string[]> = { keywordVolumeRequest: [], keywordRankRequest: [], readKeywordVolumes: [], readKeywordRank: [] };
  for (const file of sourceFiles(ROOT)) {
    const src = code(readFileSync(join(ROOT, file), "utf8"));
    for (const name of Object.keys(senders)) if (new RegExp("(?<![\\w.])(?<!function\\s+)" + name + "\\(").test(src)) senders[name].push(file);
  }
  assert.deepEqual(senders, {
    keywordVolumeRequest: ["src/lib/scan/dataforseo.ts"],
    keywordRankRequest: ["src/lib/scan/dataforseo.ts"],
    readKeywordVolumes: ["src/app/api/scan/[token]/questions/route.ts", "src/lib/scan/pipeline.ts", "src/lib/tracking/check-keyword.ts"],
    readKeywordRank: ["src/lib/scan/pipeline.ts"],
  });
});

/**
 * The cluster keyword's intent read (BRIEF-3 C1, 30 Sep 2026): built in one
 * module, sent from one door, called from one route - `/api/scan/[token]/questions`,
 * which picks the cluster keyword before the prompts are written - and, since
 * 30 Sep 2026 (T6 part 3b), check-keyword.ts, which checks one keyword a
 * member typed in Add a cluster. An exact list, so the sweep is its own floor.
 */
test("the keyword intent endpoint is built in one module, sent from one door, called from the questions route", () => {
  const files: string[] = [];
  const senders: Record<string, string[]> = { keywordIntentRequest: [], readKeywordIntents: [] };
  for (const file of sourceFiles(ROOT)) {
    const src = code(readFileSync(join(ROOT, file), "utf8"));
    if (src.includes("dataforseo_labs/google/search_intent")) files.push(file);
    for (const name of Object.keys(senders)) if (new RegExp("(?<![\\w.])(?<!function\\s+)" + name + "\\(").test(src)) senders[name].push(file);
  }
  assert.deepEqual(files, ["src/lib/scan/dataforseo-request.ts"]);
  assert.deepEqual(senders, { keywordIntentRequest: ["src/lib/scan/dataforseo.ts"], readKeywordIntents: ["src/app/api/scan/[token]/questions/route.ts", "src/lib/tracking/check-keyword.ts"] });
});

test("keyword intent request (C1): one task, keywords in the echoed form, a language and no location", () => {
  const req = keywordIntentRequest(["Retail POS System", "retail pos system ", "b2b seo agency"]);
  assert.equal(req.path, KEYWORD_INTENT_PATH);
  assert.deepEqual(req.body, [{ keywords: ["retail pos system", "b2b seo agency"], language_code: "en" }]);
  assert.throws(() => keywordIntentRequest(Array.from({ length: 1001 }, (_, i) => "k" + i)));
});

test("keyword intents (C1): the primary label from DataForSEO's documented shape; secondary ignored, unknown is null", () => {
  // The documented response: result[0].items[], each keyword_intent { label, probability }.
  const got = keywordIntents({
    status_code: TASK_OK,
    result: [
      {
        language_code: "en",
        items_count: 4,
        items: [
          { keyword: "retail pos system", keyword_intent: { label: "commercial", probability: 0.83 }, secondary_keyword_intents: [{ label: "transactional", probability: 0.4 }] },
          { keyword: "what is a pos system", keyword_intent: { label: "informational", probability: 0.97 }, secondary_keyword_intents: null },
          { keyword: "odd", keyword_intent: { label: "local", probability: 0.5 } },
          { keyword: "none", keyword_intent: null },
        ],
      },
    ],
  });
  assert.equal(got.get("retail pos system"), "commercial");
  assert.equal(got.get("what is a pos system"), "informational");
  assert.equal(got.get("odd"), null);
  assert.equal(got.get("none"), null);
  assert.equal(keywordIntents({ status_code: TASK_OK, result: null }).size, 0);
});

test("keyword volume request (R39): one batched task, deduplicated in the form DataForSEO echoes", () => {
  const req = keywordVolumeRequest(["SEO Agencies", "seo agencies ", "invoice finance lenders"], "UK");
  assert.equal(req.path, KEYWORD_VOLUME_PATH);
  assert.equal((req.body as unknown[]).length, 1);
  const [body] = req.body as Record<string, unknown>[];
  assert.deepEqual(body.keywords, ["seo agencies", "invoice finance lenders"]);
  assert.equal(body.location_code, MARKETS.UK.location_code);
  assert.throws(() => keywordVolumeRequest(Array.from({ length: 1001 }, (_, i) => "k" + i), "US"));
});

test("keyword volumes (R39): a capital cannot miss, and no number is null not zero", () => {
  const v = keywordVolumes({
    status_code: TASK_OK,
    result: [
      { keyword: "seo agencies", search_volume: 2400 },
      { keyword: "invoice finance lenders", search_volume: null },
      { keyword: "odd", search_volume: -1 },
    ],
  });
  assert.equal(v.get(keywordForm("SEO Agencies")), 2400);
  assert.equal(v.get("invoice finance lenders"), null);
  assert.equal(v.get("odd"), null);
  assert.equal(v.has("never asked"), false);
});

/**
 * And that nothing writes the column, which is the half a call-site sweep
 * cannot see: the endpoint could stay gone while some later change starts
 * populating `search_volume` from another source, and then one column means two
 * things at once.
 *
 * The column is deliberately still there. Dropping one is destructive and is on
 * AGENTS.md's absolute list, and keeping it is also the honest choice - rows
 * written before 20 September 2026 hold real measurements, and a reader can see
 * they stopped. A column written again by something new is what makes that
 * unreadable.
 *
 * **Word-bounded, and the first draft was not.** `ai_search_volume` ends in
 * `search_volume`, so a bare substring reported three files that carried the
 * payload field rather than the column - `started_at` inside `gated_started_at`
 * for the fourth time in this repo. The leading `(?<![\w])` is the whole rule.
 */
/*
 * Updated 27 Sep 2026 (Danny, reversed, R39): the column has one writer again,
 * `deriveKeywords` in pipeline.ts, and it writes `target_keyword` in the same
 * update - which is what keeps the two eras apart: a row with a keyword
 * carries keyword volume, a pre-20-Sep row without one carries question-text
 * volume. So the rule is now one writer, and that writer names the keyword.
 * `unlock.ts` names the key too, as a reader carrying it to the client, which
 * is why the sweep reads the object literal off .update/.insert/.upsert.
 */
/*
 * Updated 2 Oct 2026 (R179): `tracked_keywords` has a `search_volume` column of
 * its own - a tracked cluster keyword's checked volume - and rekey.ts writes it
 * when a pending cluster's keyword changes. That is not scan_questions, so it is
 * listed here by file and held to that table: the write must sit in a
 * `.from("tracked_keywords")` chain, or the sweep counts it as a second writer.
 */
const OTHER_TABLE: Record<string, string> = { "src/lib/tracking/rekey.ts": "tracked_keywords" };

test("one thing writes scan_questions.search_volume, and it writes target_keyword with it", () => {
  const writers: string[] = [];
  for (const file of sourceFiles(ROOT)) {
    const src = code(readFileSync(join(ROOT, file), "utf8"));
    for (const m of src.matchAll(/\.(?:update|insert|upsert)\(\s*\{[^}]*(?<![\w])search_volume\s*:[^}]*\}/g)) {
      const table = OTHER_TABLE[file];
      if (table && new RegExp(`\\.from\\("${table}"\\)\\s*$`).test(src.slice(0, m.index))) continue;
      writers.push(file);
      assert.match(m[0], /(?<![\w])target_keyword\s*:/, file + " writes search_volume without target_keyword");
    }
  }
  assert.deepEqual(
    writers,
    ["src/lib/scan/pipeline.ts"],
    "search_volume has a second writer. A row's volume means keyword volume only beside a target_keyword",
  );
});

test("the keyword-rank read (R40) is the Google organic read at SERP_DEPTH, in market, without the Overview", () => {
  for (const market of Object.keys(MARKETS) as Market[]) {
    const req = keywordRankRequest("business cash flow finance providers", market);
    assert.equal(req.path, requestFor("google_aio", QUESTION, market).path);
    const [body] = req.body as Record<string, unknown>[];
    assert.equal(body.keyword, "business cash flow finance providers");
    assert.equal(body.depth, SERP_DEPTH);
    assert.equal(body.location_code, MARKETS[market].location_code);
    assert.equal(body.load_async_ai_overview, undefined);
  }
});

test("a request DataForSEO refused whole says why, and an account's 'not now' is retried (9 Oct 2026)", async () => {
  const { readRetryDelay } = await import("../tracking/decide.ts");
  let err: unknown;
  try {
    firstTask({ status_code: 40209, status_message: "Too many simultaneous queries.", tasks: [] });
  } catch (e) {
    err = e;
  }
  assert.match(String((err as Error).message), /^DataForSEO returned no task \(40209 Too many simultaneous queries\.\)$/);
  assert.equal((err as { taskStatus?: number }).taskStatus, 40209);
  assert.equal(readRetryDelay(err, 0, 200_000), 1_000, "40209 is retried");
  try {
    firstTask({ status_code: 40202, status_message: "Rate-limit per minute exceeded.", tasks: null });
  } catch (e) {
    err = e;
  }
  assert.equal(readRetryDelay(err, 1, 200_000), 3_000, "40202 is retried");
  try {
    firstTask({ status_code: 40501, status_message: "Invalid Field.", tasks: [] });
  } catch (e) {
    err = e;
  }
  assert.equal(readRetryDelay(err, 0, 200_000), null, "a bad request is not");
  assert.throws(() => firstTask({}), /^Error: DataForSEO returned no task$/, "no top-level code: the old words");
});

// ───────────────────────────── the DIY launch reads ─────────────────────────────

/**
 * 13 Oct 2026, DIY P1 (spec 10 sections 5.2 and 5.6). The DIY platform's
 * Labs and OnPage reads and its two free paths, each held the way the keyword
 * reads above are: its path built in `dataforseo-request.ts` and nowhere else,
 * its one door in `dataforseo.ts`, and that door referenced from exactly one
 * module, `src/lib/diy/core/doors.ts` - where every paid one goes through the
 * capped `diyRead`, reserved in the DIY ledger before it is sent. A second
 * caller of a door is a read no cap can see. The Backlinks and Content
 * Analysis reads are P10's, in wave 3, and add their own rows here.
 *
 * "Referenced", not "called": the doors are handed to `diyRead` as values, so
 * a call-only sweep would find none and report a clean tree. An import of a
 * door anywhere else fails this too, which is the stricter reading and the
 * right one.
 */
const DIY_DOORS = [
  "readDiyRankedKeywords",
  "readDiyRelevantPages",
  "readDiyCompetitorsDomain",
  "readDiyInstantPage",
  "readDiyMicrodata",
  "readDiyContentParsing",
  "readLabsStatus",
  "readBacklinksFilters",
];
const DIY_BUILDERS = ["rankedKeywordsRequest", "relevantPagesRequest", "competitorsDomainRequest", "instantPagesRequest", "microdataRequest", "contentParsingRequest"];

test("each DIY launch path is built in one module", async () => {
  const { DIY_PATHS, DIY_FREE_PATHS } = await import("./dataforseo-request.ts");
  const paths = [...Object.values(DIY_PATHS), ...Object.values(DIY_FREE_PATHS)].map((p) => p.replace(/^\/v3\//, ""));
  assert.equal(paths.length, 8, "six paid paths (microdata rides on instant_pages) and two free ones");
  const where: Record<string, string[]> = Object.fromEntries(paths.map((p) => [p, []]));
  for (const file of sourceFiles(ROOT)) {
    const src = code(readFileSync(join(ROOT, file), "utf8"));
    for (const p of paths) if (src.includes(p)) where[p]!.push(file);
  }
  for (const p of paths) assert.deepEqual(where[p], ["src/lib/scan/dataforseo-request.ts"], p);
});

test("each DIY door lives in dataforseo.ts and is referenced from doors.ts alone; each builder is called from doors.ts alone", () => {
  const refs: Record<string, string[]> = Object.fromEntries([...DIY_DOORS, ...DIY_BUILDERS].map((n) => [n, []]));
  for (const file of sourceFiles(ROOT)) {
    const src = code(readFileSync(join(ROOT, file), "utf8"));
    for (const name of DIY_DOORS) if (new RegExp(`(?<![\\w.])${name}\\b`).test(src.replace(new RegExp(`export async function ${name}\\b`, "g"), ""))) refs[name]!.push(file);
    for (const name of DIY_BUILDERS) if (new RegExp(`(?<![\\w.])(?<!function\\s+)${name}\\(`).test(src)) refs[name]!.push(file);
  }
  const want = Object.fromEntries([...DIY_DOORS, ...DIY_BUILDERS].map((n) => [n, ["src/lib/diy/core/doors.ts"]]));
  assert.deepEqual(refs, want);
  const doors = readFileSync(join(ROOT, "src/lib/scan/dataforseo.ts"), "utf8");
  for (const name of DIY_DOORS) assert.match(doors, new RegExp(`export async function ${name}\\(`), `${name} is a door in dataforseo.ts`);
});

test("the DIY row ceilings: 100 by default, 1000 only for ranked_keywords, anything higher refused in code", async () => {
  const { DIY_LIMIT_CEILING, DIY_LIMIT_DEFAULT, rankedKeywordsRequest, relevantPagesRequest, competitorsDomainRequest } = await import("./dataforseo-request.ts");
  assert.equal(DIY_LIMIT_DEFAULT, 100);
  assert.deepEqual(DIY_LIMIT_CEILING, { ranked_keywords: 1000, relevant_pages: 100, competitors_domain: 100 });
  assert.equal(rankedKeywordsRequest({ target: "tallyroo.com", market: "UK" }).rows, 1000);
  assert.throws(() => rankedKeywordsRequest({ target: "tallyroo.com", market: "UK", limit: 1001 }));
  for (const req of [relevantPagesRequest({ target: "tallyroo.com", market: "UK" }), competitorsDomainRequest({ target: "tallyroo.com", market: "US" })]) {
    const limit = (req.body as { limit: number }[])[0]!.limit;
    assert.ok(limit <= DIY_LIMIT_DEFAULT, `${req.endpoint} asks for ${limit} rows`);
    assert.equal(limit, req.rows, "the rows reserved are the rows asked for");
  }
});

test("the two free paths cost 0: GETs with no body, outside the ledger, and freeRead refuses every other path", () => {
  const doors = readFileSync(join(ROOT, "src/lib/scan/dataforseo.ts"), "utf8");
  for (const name of ["readLabsStatus", "readBacklinksFilters"]) {
    const body = doors.slice(doors.indexOf(`export async function ${name}(`)).split("\n}\n")[0]!;
    assert.match(body, /await get\(DIY_FREE_PATHS\./, `${name} is a GET of a free path`);
    assert.doesNotMatch(body, /post\(|taskCost/, `${name} posts nothing and bills nothing`);
  }
  // 13 Oct 2026, DIY P1 review: the cost-0 fact is the account's price table
  // (04 section 2, read 12 Oct 2026), recorded in prices.ts - not a sample
  // response's cost field, which says only what the sample's writer typed.
  const prices = readFileSync(join(ROOT, "src/lib/diy/core/prices.ts"), "utf8");
  assert.match(prices, /export const DIY_FREE_COST = \{ labs_status: 0, backlinks_filters: 0 \} as const;/, "both free paths recorded at cost 0");
  assert.match(prices, /DIY_FREE_COST_SOURCE = "research note 04 \([^)]*04-dataforseo\.md\) section 2, the account's price table read 12 Oct 2026"/, "and where that was read, with the date");
  const free = readFileSync(join(ROOT, "src/lib/diy/core/doors.ts"), "utf8");
  assert.match(free, /export async function freeRead\(path: DiyFreePath\): Promise<FreeAnswer> \{\n\s+if \(!isDiyFreePath\(path\)\) throw/);
  assert.doesNotMatch(free.slice(free.indexOf("export async function freeRead")), /paidRead|diyRead/, "the free door writes no ledger row");
});

/**
 * The endpoints spec 10 section 5.2 says are never called, refused by name
 * across the tree (13 Oct 2026, DIY P1): LLM Mentions ($0.10 a call, its
 * ChatGPT data US-only), historical rank overview (history is not
 * backfilled), keyword overview as a stand-in for Check keyword (R38/R39),
 * Lighthouse, OnPage site crawls, and Google Trends.
 */
test("the endpoints the DIY build never calls appear nowhere", () => {
  const banned = /llm_mentions|historical_rank_overview|keyword_overview|lighthouse|on_page\/task_post|dataforseo_trends|google_trends/;
  const found = sourceFiles(ROOT).filter((f) => banned.test(code(readFileSync(join(ROOT, f), "utf8"))));
  assert.deepEqual(found, []);
});

// ───────────────────────────── the DIY wave 3 reads ─────────────────────────────

/**
 * 13 Oct 2026, DIY P10 (spec 10 sections 5.2, 5.6 and 7.11): the Links
 * page's Backlinks and Content Analysis reads, each held as the launch reads
 * above are - its path built in `dataforseo-request.ts` alone, its one door in
 * `dataforseo.ts`, that door referenced from `src/lib/diy/core/doors.ts`
 * alone, where `diyRead` reserves it in the DIY ledger on its own door before
 * it is sent - plus their row ceilings. The fact moved with wave 3: ten more
 * paid paths, ten more doors and ten more builders.
 */
const DIY_LINK_DOORS = [
  "readDiyBacklinksSummary",
  "readDiyBacklinkList",
  "readDiyNewLostSeries",
  "readDiyBulkRanks",
  "readDiyBulkReferringDomains",
  "readDiyBulkNewLost",
  "readDiyDomainGap",
  "readDiyPageGap",
  "readDiyBacklinksCompetitors",
  "readDiyContentSearch",
];
const DIY_LINK_BUILDERS = [
  "backlinksSummaryRequest",
  "backlinksNewLostRequest",
  "backlinksSeriesRequest",
  "bulkRanksRequest",
  "bulkReferringDomainsRequest",
  "bulkNewLostRequest",
  "domainGapRequest",
  "pageGapRequest",
  "backlinksCompetitorsRequest",
  "contentSearchRequest",
];

test("DIY wave 3: each Backlinks and Content Analysis path is built in one module", async () => {
  const { DIY_LINK_PATHS } = await import("./dataforseo-request.ts");
  const paths = Object.values(DIY_LINK_PATHS).map((p) => p.replace(/^\/v3\//, ""));
  assert.equal(paths.length, 10, "nine Backlinks reads and the content search");
  for (const p of paths) assert.match(p, /^(backlinks\/[a-z_]+\/live|content_analysis\/search\/live)$/, p);
  const where: Record<string, string[]> = Object.fromEntries(paths.map((p) => [p, []]));
  for (const file of sourceFiles(ROOT)) {
    const src = code(readFileSync(join(ROOT, file), "utf8"));
    for (const p of paths) if (src.includes(p)) where[p]!.push(file);
  }
  for (const p of paths) assert.deepEqual(where[p], ["src/lib/scan/dataforseo-request.ts"], p);
});

test("DIY wave 3: each door lives in dataforseo.ts and is referenced from doors.ts alone; each builder is called from doors.ts alone", () => {
  const refs: Record<string, string[]> = Object.fromEntries([...DIY_LINK_DOORS, ...DIY_LINK_BUILDERS].map((n) => [n, []]));
  for (const file of sourceFiles(ROOT)) {
    const src = code(readFileSync(join(ROOT, file), "utf8"));
    for (const name of DIY_LINK_DOORS) if (new RegExp(`(?<![\\w.])${name}\\b`).test(src.replace(new RegExp(`export async function ${name}\\b`, "g"), ""))) refs[name]!.push(file);
    for (const name of DIY_LINK_BUILDERS) if (new RegExp(`(?<![\\w.])(?<!function\\s+)${name}\\(`).test(src)) refs[name]!.push(file);
  }
  const want = Object.fromEntries([...DIY_LINK_DOORS, ...DIY_LINK_BUILDERS].map((n) => [n, ["src/lib/diy/core/doors.ts"]]));
  assert.deepEqual(refs, want);
  const doors = readFileSync(join(ROOT, "src/lib/scan/dataforseo.ts"), "utf8");
  for (const name of DIY_LINK_DOORS) assert.match(doors, new RegExp(`export async function ${name}\\(`), `${name} is a door in dataforseo.ts`);
});

test("DIY wave 3: every read goes through diyRead on the door its path is recorded under", async () => {
  const { DIY_LINK_DOOR } = await import("./dataforseo-request.ts");
  const doors = code(readFileSync(join(ROOT, "src/lib/diy/core/doors.ts"), "utf8"));
  const builderDoor: Record<string, string> = {
    backlinksSummaryRequest: DIY_LINK_DOOR.backlinks_summary,
    backlinksNewLostRequest: DIY_LINK_DOOR.backlinks_links,
    backlinksSeriesRequest: DIY_LINK_DOOR.backlinks_series,
    bulkRanksRequest: DIY_LINK_DOOR.backlinks_bulk_ranks,
    bulkReferringDomainsRequest: DIY_LINK_DOOR.backlinks_bulk_domains,
    bulkNewLostRequest: DIY_LINK_DOOR.backlinks_bulk_new_lost,
    domainGapRequest: DIY_LINK_DOOR.backlinks_domain_gap,
    pageGapRequest: DIY_LINK_DOOR.backlinks_page_gap,
    backlinksCompetitorsRequest: DIY_LINK_DOOR.backlinks_competitors,
    contentSearchRequest: DIY_LINK_DOOR.content_search,
  };
  for (const [builder, door] of Object.entries(builderDoor)) {
    assert.match(doors, new RegExp(`return diyRead\\(ctx, "${door}", ${builder}\\(`), `${builder} goes out through diyRead on the ${door} door`);
  }
  assert.equal(Object.values(DIY_LINK_DOOR).filter((d) => d === "content").length, 1, "the content search is the one content read");
});

test("DIY wave 3: the row ceilings - 100 a list, 20 for backlinks competitors, anything higher refused in code", async () => {
  const m = await import("./dataforseo-request.ts");
  assert.deepEqual(m.DIY_LINK_LIMIT, { backlinks_links: 100, backlinks_domain_gap: 100, backlinks_page_gap: 100, backlinks_competitors: 20, content_search: 100 });
  const three = ["ledgerline.com", "brightbook.example", "countwise.example"];
  const reqs = [
    m.backlinksNewLostRequest({ target: "tallyroo.com", which: "new", since: "2026-10-06" }),
    m.domainGapRequest({ targets: three, exclude: "tallyroo.com", mode: "partial", countFilter: true }),
    m.pageGapRequest({ targets: three, exclude: "tallyroo.com" }),
    m.backlinksCompetitorsRequest("tallyroo.com"),
    m.contentSearchRequest({ brand: "Tallyroo" }),
  ];
  for (const req of reqs) {
    const limit = (req.body as { limit: number }[])[0]!.limit;
    assert.ok(limit <= m.DIY_LIMIT_DEFAULT, `${req.endpoint} asks for ${limit} rows`);
    assert.equal(limit, req.rows, `${req.endpoint}: the rows reserved are the rows asked for`);
  }
  assert.throws(() => m.backlinksNewLostRequest({ target: "tallyroo.com", which: "lost", since: "2026-10-06", limit: 101 }));
  assert.throws(() => m.contentSearchRequest({ brand: "Tallyroo", limit: 1000 }));
  assert.equal(m.backlinksSummaryRequest("tallyroo.com").rows, 1, "the summary reserves one row");
  assert.equal(m.bulkRanksRequest(["tallyroo.com", ...three]).rows, 4, "a bulk read reserves a row a target");
  assert.throws(() => m.bulkRanksRequest(["tallyroo.com", ...three, "sumly.example"]), "the client and three at most");
});
