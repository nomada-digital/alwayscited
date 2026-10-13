import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  DIY_FREE_PATHS,
  DIY_LIMIT_CEILING,
  DIY_LIMIT_DEFAULT,
  DIY_PATHS,
  type Task,
  competitorsDomainRequest,
  contentParsingRequest,
  diyLimit,
  diyPageUrl,
  diyTarget,
  firstTask,
  instantPagesRequest,
  isDiyFreePath,
  microdataRequest,
  parseBacklinksFilters,
  parseCompetitorsDomain,
  parseContentParsing,
  parseInstantPage,
  parseLabsStatus,
  parseMicrodata,
  parseRankedKeywords,
  parseRelevantPages,
  rankedKeywordsRequest,
  relevantPagesRequest,
} from "../../scan/dataforseo-request.ts";
import { MARKETS } from "../../scan/domain.ts";
import { DFS_PRICES, dfsEstimate } from "./prices.ts";

/**
 * The DIY launch reads' request builders and allow-list parsers (13 Oct
 * 2026, DIY P1; spec 10 sections 5.2 and 5.6 item 5), run against the saved
 * samples in ./samples - DataForSEO's documented response shapes with
 * made-up values, which carry the fields the parsers must drop.
 */

const sample = (name: string): Task => firstTask(JSON.parse(readFileSync(new URL(`./samples/${name}.json`, import.meta.url), "utf8")));

/** Every key anywhere in a value, at any depth. */
function keysDeep(v: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(v)) for (const x of v) keysDeep(x, out);
  else if (v && typeof v === "object") {
    for (const [k, x] of Object.entries(v)) {
      out.add(k);
      keysDeep(x, out);
    }
  }
  return out;
}
const BANNED_KEYS = /^(sponsored|attributes|spam_score|backlink_spam_score|target_spam_score|keyword_difficulty|rank)$/i;
const assertClean = (parsed: unknown, what: string) => {
  const bad = [...keysDeep(parsed)].filter((k) => BANNED_KEYS.test(k) || /spam|difficulty|sponsor/i.test(k));
  assert.deepEqual(bad, [], `${what} kept a field it must drop`);
};

test("the samples are the documented shapes and carry the fields the parsers must drop", () => {
  const raw = (name: string) => readFileSync(new URL(`./samples/${name}.json`, import.meta.url), "utf8");
  assert.match(raw("ranked_keywords"), /"keyword_difficulty"/);
  assert.match(raw("backlinks_available_filters"), /"backlink_spam_score"/);
  assert.match(raw("backlinks_available_filters"), /sponsored/);
  assert.match(raw("backlinks_available_filters"), /"attributes"/);
  for (const name of ["labs_status", "ranked_keywords", "relevant_pages", "competitors_domain", "instant_pages", "microdata", "content_parsing", "backlinks_available_filters"]) {
    assert.ok(sample(name), name);
  }
});

/**
 * 13 Oct 2026, review of DIY P1: two samples had been written to match their
 * parsers rather than the documentation, so their tests proved nothing. Each
 * sample now carries the paths DataForSEO's v3 documentation gives (read 13 Oct 2026),
 * and these pins hold the samples to those paths, apart from any parser.
 */
test("instant_pages' sample keeps content inside meta, as the documentation does", () => {
  const raw = JSON.parse(readFileSync(new URL("./samples/instant_pages.json", import.meta.url), "utf8"));
  const item = raw.tasks[0].result[0].items[0];
  assert.equal(typeof item.meta.content.plain_text_word_count, "number", "items[].meta.content.plain_text_word_count");
  assert.equal(item.content, undefined, "no content beside meta");
  assert.equal(typeof item.checks.no_title, "boolean", "items[].checks");
});

test("content_parsing's sample: tables of header, body and footer rows of row_cells; elements of text, url and urls", () => {
  const raw = JSON.parse(readFileSync(new URL("./samples/content_parsing.json", import.meta.url), "utf8"));
  const content = raw.tasks[0].result[0].items[0].page_content;
  const topics = [content.header, content.footer, ...content.main_topic, ...content.secondary_topic];
  let tables = 0;
  for (const t of topics) {
    for (const el of [...(t.primary_content ?? []), ...(t.secondary_content ?? [])]) {
      assert.deepEqual(Object.keys(el).filter((k) => !["text", "url", "urls"].includes(k)), [], "an element is text, url and urls");
    }
    for (const table of t.table_content ?? []) {
      tables += 1;
      assert.deepEqual(Object.keys(table).sort(), ["body", "footer", "header"]);
      for (const part of [table.header, table.body, table.footer]) {
        for (const row of part ?? []) {
          assert.deepEqual(Object.keys(row), ["row_cells"]);
          for (const cell of row.row_cells) assert.deepEqual(Object.keys(cell).sort(), ["is_header", "text", "urls"]);
        }
      }
    }
  }
  assert.ok(tables >= 1, "the sample carries a table, so the table walk is tested");
  assert.ok(Array.isArray(content.main_topic), "main_topic is an array");
});

// ───────────────────────────── the builders ─────────────────────────────

test("ranked_keywords: the client's domain in its market, top 100 by etv, organic only, 1000 rows by default and never more", () => {
  for (const market of ["UK", "US"] as const) {
    const req = rankedKeywordsRequest({ target: "https://www.Tallyroo.com/", market });
    assert.equal(req.path, DIY_PATHS.ranked_keywords);
    assert.equal(req.rows, 1000);
    assert.deepEqual(req.body, [
      {
        target: "tallyroo.com",
        location_code: MARKETS[market].location_code,
        language_code: "en",
        limit: 1000,
        item_types: ["organic"],
        order_by: ["ranked_serp_element.serp_item.etv,desc"],
        filters: ["ranked_serp_element.serp_item.rank_group", "<=", 100],
      },
    ]);
  }
  assert.equal(rankedKeywordsRequest({ target: "tallyroo.com", market: "UK", limit: 200 }).rows, 200);
  assert.throws(() => rankedKeywordsRequest({ target: "tallyroo.com", market: "UK", limit: 1001 }), /outside 1-1000/);
  assert.throws(() => rankedKeywordsRequest({ target: "tallyroo.com", market: "UK", limit: 0 }));
  assert.equal(dfsEstimate("ranked_keywords", 1000), 0.132, "$0.012 + 1000 x $0.00012");
});

test("the row ceilings: 100 by default, 1000 only for ranked_keywords", () => {
  assert.equal(DIY_LIMIT_DEFAULT, 100);
  assert.deepEqual(DIY_LIMIT_CEILING, { ranked_keywords: 1000, relevant_pages: 100, competitors_domain: 100 });
  assert.throws(() => diyLimit("relevant_pages", 101));
  assert.throws(() => diyLimit("competitors_domain", 1000));
  assert.throws(() => diyLimit("ranked_keywords", 1.5));
});

test("relevant_pages and competitors_domain: 20 rows each, competitors without the big generalists", () => {
  const pages = relevantPagesRequest({ target: "tallyroo.com", market: "UK" });
  assert.equal(pages.path, DIY_PATHS.relevant_pages);
  assert.equal(pages.rows, 20);
  assert.equal((pages.body as Record<string, unknown>[])[0]!.limit, 20);
  assert.equal(dfsEstimate("relevant_pages", pages.rows), 0.0144);
  const comp = competitorsDomainRequest({ target: "tallyroo.com", market: "US" });
  assert.equal(comp.path, DIY_PATHS.competitors_domain);
  assert.equal((comp.body as Record<string, unknown>[])[0]!.exclude_top_domains, true);
  assert.equal((comp.body as Record<string, unknown>[])[0]!.location_code, MARKETS["US"].location_code);
});

test("OnPage: one task each; instant_pages with JavaScript and the validator; markdown only when asked", () => {
  assert.deepEqual(instantPagesRequest("https://tallyroo.com/payroll").body, [{ url: "https://tallyroo.com/payroll", enable_javascript: true, validate_micromarkup: true }]);
  assert.equal(dfsEstimate("instant_pages", 1), DFS_PRICES.instantPagesJs);
  assert.deepEqual(contentParsingRequest("https://roundup.example/best").body, [{ url: "https://roundup.example/best", markdown_view: false }]);
  assert.deepEqual(contentParsingRequest("https://tallyroo.com/", true).body, [{ url: "https://tallyroo.com/", markdown_view: true }]);
  assert.equal(dfsEstimate("content_parsing", 1), 0.00015);
  assert.deepEqual(microdataRequest("10131234-1111-0066-0000-0123456789ab", "https://tallyroo.com/").body, [{ id: "10131234-1111-0066-0000-0123456789ab", url: "https://tallyroo.com/" }]);
  assert.throws(() => microdataRequest("", "https://tallyroo.com/"), /task id/);
});

test("targets and URLs are refused when they are not a public domain or an http(s) URL", () => {
  assert.equal(diyTarget("WWW.Tallyroo.com/pricing"), "tallyroo.com");
  for (const bad of ["", "localhost", "tallyroo", "http://", "a b", "-x"]) assert.throws(() => diyTarget(bad), bad);
  assert.throws(() => diyPageUrl("ftp://tallyroo.com/"), /http/);
  assert.throws(() => diyPageUrl("https://user:pass@tallyroo.com/"), /credentials/);
  assert.throws(() => diyPageUrl("https://tallyroo.com/" + "a".repeat(500)), /500/);
  assert.throws(() => diyPageUrl("https://10.0.0.1/"), /public host/);
  assert.throws(() => diyPageUrl("not a url"));
});

test("the free paths are exactly two, and nothing else passes the guard", () => {
  assert.deepEqual(Object.values(DIY_FREE_PATHS).sort(), ["/v3/backlinks/available_filters", "/v3/dataforseo_labs/status"]);
  assert.ok(isDiyFreePath("/v3/dataforseo_labs/status"));
  assert.ok(isDiyFreePath("/v3/backlinks/available_filters"));
  for (const p of [DIY_PATHS.ranked_keywords, DIY_PATHS.microdata, "/v3/backlinks/summary/live", "/v3/dataforseo_labs/status/", "/v3/dataforseo_labs/STATUS", ""]) {
    assert.equal(isDiyFreePath(p), false, p);
  }
});

// ───────────────────────────── the parsers ─────────────────────────────

// 13 Oct 2026, DIY P6 (review of the P6 handoff): the fact moved by two fields. `group` is rank_group, the
// organic position our own daily read stores and the DIY pages show; `previousOn` is the day of DataForSEO's
// previous reading (previous_updated_time), which its previous_rank_absolute is taken against. Both are named
// in DataForSEO's v3 docs for ranked_keywords/live, read 13 Oct 2026, and both are in the saved sample.
test("ranked_keywords keeps the named fields, lower-cases the keyword, and never reads keyword_difficulty", () => {
  const got = parseRankedKeywords(sample("ranked_keywords"));
  assert.equal(got.total, 1342);
  assert.equal(got.etv, 1840.5);
  assert.deepEqual(got.rows[0], { keyword: "payroll software for sole traders", position: 7, group: 6, url: "/payroll", volume: 880, intent: "commercial", etv: 41.2, previous: 14, isNew: false, previousOn: "2026-09-09" });
  assert.equal(got.rows[1]!.keyword, "small business payroll uk");
  assert.equal(got.rows[1]!.previous, null);
  assert.equal(got.rows[1]!.isNew, true);
  assert.equal(got.rows[1]!.group, 13);
  assert.deepEqual(Object.keys(got.rows[0]!).sort(), ["etv", "group", "intent", "isNew", "keyword", "position", "previous", "previousOn", "url", "volume"]);
  assertClean(got, "ranked_keywords");
});

test("relevant_pages and competitors_domain keep only the page, its traffic and its position bands; the domain and its overlap", () => {
  const pages = parseRelevantPages(sample("relevant_pages"));
  assert.deepEqual(pages[0], { url: "https://tallyroo.com/payroll", etv: 640.2, count: 210, pos1: 4, pos2_3: 9, pos4_10: 31, pos11_20: 48 });
  assertClean(pages, "relevant_pages");
  const comp = parseCompetitorsDomain(sample("competitors_domain"));
  assert.deepEqual(comp, [
    { domain: "ledgerline.com", intersections: 412, avgPosition: 14.2 },
    { domain: "payroll-rival.example", intersections: 198, avgPosition: 19.8 },
  ]);
  assertClean(comp, "competitors_domain");
});

test("instant_pages keeps the meta, the word count, six checks and the task id; no score", () => {
  const got = parseInstantPage(sample("instant_pages"));
  assert.equal(got.taskId, "10131234-1111-0066-0000-0123456789ab");
  assert.equal(got.page?.status, 200);
  assert.equal(got.page?.title, "Payroll for small businesses | Tallyroo");
  assert.deepEqual(got.page?.h1, ["Payroll that runs itself"]);
  assert.equal(got.page?.canonical, "https://tallyroo.com/payroll");
  assert.equal(got.page?.wordCount, 1240);
  assert.deepEqual(got.page?.checks, { no_title: false, no_h1_tag: false, is_https: true, has_micromarkup: true, has_micromarkup_errors: true, canonical: true });
  assert.ok(!keysDeep(got).has("onpage_score"), "a 0-100 score is never kept (section 2.3)");
  assertClean(got, "instant_pages");
});

test("microdata flattens nested fields and keeps each finding's level and message", () => {
  const got = parseMicrodata(sample("microdata"));
  assert.deepEqual(got.summary, { fatal: 0, error: 1, warning: 2, info: 0 });
  assert.deepEqual(got.items[0]!.types, ["Organization"]);
  assert.deepEqual(
    got.items[0]!.fields.map((f) => f.name),
    ["@type", "name", "logo", "logo.width", "sameAs"],
  );
  assert.equal(got.items[0]!.fields.find((f) => f.name === "sameAs")!.value, "https://social.example/tallyroo, https://video.example/tallyroo");
  assert.deepEqual(got.items[0]!.results, [
    { level: "error", message: "The property url is required for ImageObject." },
    { level: "warning", message: "The value is not a valid width." },
    { level: "warning", message: "Duplicate value." },
  ]);
});

test("content_parsing keeps headings, links with anchors, dates near 'updated' or 'published', and a word count; no prices, contacts or ratings", () => {
  const got = parseContentParsing(sample("content_parsing"))!;
  assert.equal(got.status, 200);
  assert.equal(got.title, "Best payroll tools for sole traders (2026)");
  assert.equal(got.h1, "The best payroll tools for sole traders");
  assert.deepEqual(got.headings, [
    { level: 2, text: "How we picked" },
    { level: 3, text: "Ledgerline" },
    { level: 2, text: "Related reading" },
  ]);
  assert.deepEqual(got.dates, ["3 October 2026", "12 May 2026"]);
  assert.ok(got.links.some((l) => l.url === "https://tallyroo.com/payroll" && l.anchor === "Tallyroo"));
  assert.ok(
    got.links.some((l) => l.url === "https://tallyroo.com/pricing" && l.anchor === "Tallyroo pricing"),
    "a client link inside a comparison table's body cell is found (13 Oct 2026)",
  );
  assert.ok(got.links.some((l) => l.url === "https://ledgerline.com/" && l.anchor === "Ledgerline"));
  assert.ok(got.wordCount > 20);
  assert.equal("markdown" in got, false, "markdown only when asked");
  const keys = keysDeep(got);
  for (const k of ["offers", "price", "contacts", "emails", "telephones", "ratings", "rel"]) assert.ok(!keys.has(k), k);
  assert.doesNotMatch(JSON.stringify(got), /editor@|\+44/, "no contact survives the parse");
  const md = parseContentParsing(sample("content_parsing"), { markdown: true })!;
  assert.match(md.markdown ?? "", /^# Best payroll tools/);
});

test("labs/status keeps only the three refresh dates, as days", () => {
  assert.deepEqual(parseLabsStatus(sample("labs_status")), { googleDate: "2026-10-10", payload: { google: "2026-10-10", bing: "2026-10-10", amazon: "2026-10-06" } });
});

test("available_filters keeps the filter names, drops the spam, sponsored and attributes family, and stores no types", () => {
  const got = parseBacklinksFilters(sample("backlinks_available_filters"));
  assert.ok(got.groups.backlinks!.includes("domain_from_platform_type"));
  assert.ok(got.groups.backlinks!.includes("ranked_keywords_info.page_from_keywords_count_top_10"));
  assert.doesNotMatch(JSON.stringify(got), /spam|sponsored|attributes/i);
  assert.ok(Object.values(got.groups).every((names) => names.every((n) => typeof n === "string")));
});
