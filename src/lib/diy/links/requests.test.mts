import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  DIY_LINK_DOOR,
  DIY_LINK_PATHS,
  type Task,
  backlinksCompetitorsRequest,
  backlinksNewLostRequest,
  backlinksSeriesRequest,
  backlinksSummaryRequest,
  bulkNewLostRequest,
  bulkRanksRequest,
  bulkReferringDomainsRequest,
  contentSearchRequest,
  domainGapRequest,
  firstTask,
  followSplit,
  pageGapRequest,
  parseBacklinkList,
  parseBacklinksCompetitors,
  parseBacklinksSummary,
  parseBulkNewLost,
  parseBulkRanks,
  parseBulkReferringDomains,
  parseContentSearch,
  parseDomainIntersection,
  parseNewLostSeries,
  parsePageIntersection,
  brandPhrase,
  searchBrand,
} from "../../scan/dataforseo-request.ts";
import { DOOR_OF, dfsEstimate } from "../core/prices.ts";

/**
 * The Links reads' request builders and allow-list parsers (13 Oct 2026, DIY
 * P10; spec 10 sections 5.2 and 7.11), run against the saved samples in
 * ../core/samples - each built from the example response on its endpoint's
 * page of DataForSEO's v3 documentation (read 13 Oct 2026), with made-up
 * hosts and text, keeping the fields the parsers must drop.
 */

const raw = (name: string) => readFileSync(new URL(`../core/samples/${name}.json`, import.meta.url), "utf8");
const sample = (name: string): Task => firstTask(JSON.parse(raw(name)));
const THREE = ["ledgerline.com", "brightbook.example", "countwise.example"];

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
const clean = (parsed: unknown, what: string) => {
  const bad = [...keysDeep(parsed)].filter((k) => /sponsor|spam|attribute|difficulty|^rank_changes$/i.test(k));
  assert.deepEqual(bad, [], `${what} kept a field it must drop`);
  assert.doesNotMatch(JSON.stringify(parsed), /sponsored/i, `${what} carries the word sponsored`);
};

test("the samples are the documented shapes, and carry the fields the parsers must drop", () => {
  const doc = (name: string) => JSON.parse(raw(name)).tasks[0];
  assert.match(raw("backlinks_summary"), /"sponsored": 12/, "the summary's attribute counts include sponsored");
  assert.match(raw("backlinks_summary"), /"backlinks_spam_score"/);
  assert.match(raw("backlinks_backlinks"), /"attributes": \[/);
  assert.match(raw("backlinks_domain_intersection"), /"backlinks_spam_score"/);
  assert.match(raw("backlinks_page_intersection"), /"sponsored"/);
  assert.match(raw("content_analysis_search"), /"spam_score"/);
  // The documented paths, apart from any parser: a sample written to suit its parser proves nothing (13 Oct 2026, review of DIY P1).
  assert.equal(typeof doc("backlinks_summary").result[0].referring_links_attributes, "object", "summary: result[0] is the profile itself");
  assert.equal(typeof doc("backlinks_domain_intersection").result[0].items[0].domain_intersection["1"].target, "string", "domain_intersection: one object per target key, its target the referring domain");
  assert.equal(typeof doc("backlinks_domain_intersection").result[0].items[0].summary.intersections_count, "number");
  assert.ok(Array.isArray(doc("backlinks_page_intersection").result[0].items[0].page_intersection["1"]), "page_intersection: an array of links per target key");
  assert.equal(typeof doc("content_analysis_search").result[0].items[0].content_info.snippet, "string", "content search: content_info.snippet");
  assert.equal(typeof doc("backlinks_timeseries_new_lost_summary").result[0].items[0].new_referring_domains, "number");
  for (const name of ["backlinks_summary", "backlinks_backlinks", "backlinks_timeseries_new_lost_summary", "backlinks_bulk_ranks", "backlinks_bulk_referring_domains", "backlinks_bulk_new_lost_referring_domains", "backlinks_domain_intersection", "backlinks_page_intersection", "backlinks_competitors", "content_analysis_search"]) {
    assert.ok(sample(name), name);
  }
});

test("the summary: rank, links, domains, first seen, and the follow split from nofollow alone", () => {
  const s = parseBacklinksSummary(sample("backlinks_summary"))!;
  assert.deepEqual(s, { rank: 212, backlinks: 1840, referringDomains: 312, referringMainDomains: 288, firstSeen: "2021-03-02", follow: { followed: 1580, notFollowed: 260 } });
  clean(s, "parseBacklinksSummary");
  assert.deepEqual(followSplit(100, { nofollow: 10, ugc: 3, sponsored: 2, noopener: 80 }), { followed: 90, notFollowed: 10 }, "only nofollow is not followed; no other attribute is summed");
  assert.deepEqual(followSplit(10, { nofollow: 30 }), { followed: 0, notFollowed: 10 }, "never more than the links");
  assert.equal(followSplit(null, {}), null);
  assert.equal(parseBacklinksSummary({ status_code: 20000, result: [] }), null, "no result is no profile, never zeros");
});

test("the follow split when the attribute counts overlap: a link is counted under every attribute it carries, so none is taken off twice", () => {
  // 13 Oct 2026, review of DIY P10: 400 links rel="nofollow ugc" are in both counts; subtracting ugc too showed 20% followed for 60%.
  assert.deepEqual(followSplit(1000, { nofollow: 400, ugc: 400, noopener: 300 }), { followed: 600, notFollowed: 400 });
  assert.deepEqual(followSplit(1000, { nofollow: 400, sponsored: 400 }), { followed: 600, notFollowed: 400 }, "nofollow sponsored, the same");
  assert.deepEqual(followSplit(1000, {}), { followed: 1000, notFollowed: 0 }, "no nofollow count: every link followed");
});

test("the week's new or lost links: the domain, both pages, follow status, first and last seen; never the attributes", () => {
  const got = parseBacklinkList(sample("backlinks_backlinks"));
  assert.equal(got.total, 3);
  assert.deepEqual(got.rows.map((r) => [r.domain, r.urlTo, r.followed, r.firstSeen]), [
    ["booksandbills.example", "https://tallyroo.com/invoicing", true, "2026-10-08"],
    ["smallbizdesk.example", "https://tallyroo.com/", true, "2026-10-07"],
    ["ownerledger.co", "https://tallyroo.com/pricing", false, "2026-10-06"],
  ]);
  clean(got, "parseBacklinkList");
});

test("the series, the three bulk reads and the competitors parse by target, named fields only", () => {
  assert.deepEqual(parseNewLostSeries(sample("backlinks_timeseries_new_lost_summary")).map((w) => [w.week, w.newDomains, w.lostDomains]), [
    ["2026-09-27", 9, 4],
    ["2026-10-04", 6, 7],
    ["2026-10-11", 11, 3],
  ]);
  assert.deepEqual(parseBulkRanks(sample("backlinks_bulk_ranks")), { "tallyroo.com": 212, "ledgerline.com": 405, "brightbook.example": 371, "countwise.example": 298 });
  assert.deepEqual(parseBulkReferringDomains(sample("backlinks_bulk_referring_domains"))["ledgerline.com"], 1480);
  assert.deepEqual(parseBulkNewLost(sample("backlinks_bulk_new_lost_referring_domains"))["tallyroo.com"], { newDomains: 26, lostDomains: 14 });
  assert.deepEqual(parseBacklinksCompetitors(sample("backlinks_competitors")).map((c) => [c.domain, c.intersections]), [
    ["ledgerline.com", 88],
    ["countwise.example", 41],
    ["sumly.example", 19],
  ]);
  for (const [name, fn] of [["backlinks_bulk_ranks", parseBulkRanks], ["backlinks_competitors", parseBacklinksCompetitors]] as const) clean(fn(sample(name)), name);
});

test("the domain gap: which compared sites each domain links to, from the result's own targets, a missing or null target read alike", () => {
  const got = parseDomainIntersection(sample("backlinks_domain_intersection"));
  assert.equal(got.total, 4);
  assert.deepEqual(got.rows.map((r) => [r.domain, r.linksTo, r.rank, r.firstSeen]), [
    ["thesmallbizstack.com", THREE, 310, "2024-05-11"],
    ["freelancefieldnotes.com", ["ledgerline.com", "countwise.example"], 240, "2025-02-19"],
    ["accountingforum.example", ["ledgerline.com", "brightbook.example"], 205, "2025-08-02"],
    ["softwarecritic.com", ["brightbook.example", "countwise.example"], 330, "2023-11-30"],
  ]);
  clean(got, "parseDomainIntersection");
  // referring_links_platform_types counts links per platform, not the site's own type: no platform is kept (spec 10 section 4.8 row 3).
  assert.ok(![...keysDeep(got)].some((k) => /platform/.test(k)), "no platform word built from link counts");
});

test("the page gap keeps only followed links inside an article, per target, and drops a page with none", () => {
  const got = parsePageIntersection(sample("backlinks_page_intersection"));
  assert.deepEqual(
    got.rows.map((r) => [r.domain, r.links.map((l) => [l.target, l.anchor])]),
    [
      ["thesmallbizstack.com", [["ledgerline.com", "Ledgerline"], ["brightbook.example", "Brightbook"]]],
      ["booksandbills.example", [["countwise.example", "Countwise's guide"]]],
    ],
    "the not-followed aside link is gone, and its page with it",
  );
  assert.equal(got.rows[0]!.title, "The best invoicing software for small teams");
  clean(got, "parsePageIntersection");
});

test("the content search: the page, its domain, its title, the published day and a 200-character snippet; no score or rank", () => {
  const got = parseContentSearch(sample("content_analysis_search"));
  assert.equal(got.rows.length, 3);
  assert.equal(got.rows[0]!.title, "The tools we run the business on", "main_title first");
  assert.equal(got.rows[0]!.published, "2026-09-14");
  assert.ok(got.rows[0]!.snippet!.length <= 200, "the snippet is cut to 200 characters");
  assert.equal(got.rows[2]!.published, null);
  clean(got, "parseContentSearch");
  assert.ok(![...keysDeep(got)].some((k) => /rank|score/.test(k)), "no url_rank, domain_rank or score");
});

test("every builder: its path, its door, a fixed body, and the reservation at its maximum", () => {
  const reqs = [
    backlinksSummaryRequest("tallyroo.com"),
    backlinksNewLostRequest({ target: "tallyroo.com", which: "new", since: "2026-10-06" }),
    backlinksNewLostRequest({ target: "tallyroo.com", which: "lost", since: "2026-10-06" }),
    backlinksSeriesRequest({ target: "tallyroo.com", from: "2026-07-13", to: "2026-10-12" }),
    bulkRanksRequest(["tallyroo.com", ...THREE]),
    bulkReferringDomainsRequest(["tallyroo.com", ...THREE]),
    bulkNewLostRequest({ targets: ["tallyroo.com", ...THREE], from: "2026-09-12" }),
    domainGapRequest({ targets: THREE, exclude: "tallyroo.com", mode: "partial", countFilter: true }),
    pageGapRequest({ targets: THREE, exclude: "tallyroo.com" }),
    backlinksCompetitorsRequest("tallyroo.com"),
    contentSearchRequest({ phrase: "Tallyroo" }),
  ];
  for (const r of reqs) {
    assert.equal(r.path, DIY_LINK_PATHS[r.endpoint as keyof typeof DIY_LINK_PATHS], `${r.endpoint}: its own path`);
    assert.equal(DOOR_OF[r.endpoint as keyof typeof DOOR_OF], DIY_LINK_DOOR[r.endpoint as keyof typeof DIY_LINK_DOOR], `${r.endpoint}: prices.ts and the builders agree on its door`);
    assert.ok(Array.isArray(r.body) && (r.body as unknown[]).length === 1, `${r.endpoint}: one task`);
    const body = JSON.stringify(r.body);
    assert.doesNotMatch(body, /sponsored|"attributes"/, `${r.endpoint}: never asks for or filters on sponsored or attributes`);
  }
  assert.equal(dfsEstimate("backlinks_summary", 1), 0.02404, "$0.024 + 1 x $0.000036");
  assert.equal(dfsEstimate("backlinks_domain_gap", 100), 0.0276, "$0.024 + 100 x $0.000036");
  assert.equal(dfsEstimate("content_search", 100), 0.0276);
  assert.equal(dfsEstimate("backlinks_bulk_ranks", 4), 0.02414);
});

test("the request shapes: lost links come from the lost set, the gap is followed and spam-filtered, the targets are followed in an article", () => {
  const lost = (backlinksNewLostRequest({ target: "www.tallyroo.com", which: "lost", since: "2026-10-06" }).body as Record<string, unknown>[])[0]!;
  assert.equal(lost.target, "tallyroo.com", "a bare domain");
  assert.equal(lost.backlinks_status_type, "lost", "a lost link is not in the default live set");
  assert.deepEqual(lost.filters, [["is_lost", "=", true], "and", ["last_seen", ">", "2026-10-06 00:00:00 +00:00"]]);
  assert.equal(lost.mode, "one_per_domain");
  const gap = (domainGapRequest({ targets: THREE, exclude: "tallyroo.com", mode: "partial", countFilter: true }).body as Record<string, unknown>[])[0]!;
  assert.deepEqual(gap.targets, { "1": "ledgerline.com", "2": "brightbook.example", "3": "countwise.example" });
  assert.deepEqual(gap.exclude_targets, ["tallyroo.com"]);
  assert.deepEqual(gap.backlinks_filters, [["dofollow", "=", true], "and", ["backlink_spam_score", "<", 30]], "spam used as a request filter only");
  assert.deepEqual(gap.filters, ["intersections_count", ">", 1], "n >= 2, with the operator the documentation's examples use");
  assert.deepEqual(gap.order_by, ["intersections_count,desc", "1.rank,desc", "2.rank,desc"], "the 100 read are the head: most of the 3 first, then rank (three rules at most)");
  const pair = (domainGapRequest({ targets: THREE.slice(0, 2), exclude: "tallyroo.com", mode: "all", countFilter: false }).body as Record<string, unknown>[])[0]!;
  assert.equal(pair.intersection_mode, "all");
  assert.equal(pair.filters, undefined, "no count filter on the pairwise read");
  assert.deepEqual(pair.order_by, ["1.rank,desc", "2.rank,desc"]);
  assert.throws(() => domainGapRequest({ targets: THREE, exclude: "tallyroo.com", mode: "all", countFilter: false }), /one pair/);
  const pages = (pageGapRequest({ targets: THREE, exclude: "tallyroo.com" }).body as Record<string, unknown>[])[0]!;
  assert.equal(JSON.stringify(pages.filters).match(/dofollow/g)!.length, 3, "followed, per target");
  assert.equal(JSON.stringify(pages.filters).match(/"article"/g)!.length, 3, "inside an article, per target");
  assert.deepEqual(pages.order_by, ["intersections_count,desc", "1.page_from_rank,desc", "2.page_from_rank,desc"]);
  assert.deepEqual((pageGapRequest({ targets: THREE.slice(0, 1), exclude: "tallyroo.com" }).body as Record<string, unknown>[])[0]!.order_by, ["1.page_from_rank,desc"]);
  const search = (contentSearchRequest({ phrase: "Tallyroo" }).body as Record<string, unknown>[])[0]!;
  assert.equal(search.keyword, '"Tallyroo"', "the brand as an exact phrase");
  assert.equal(search.search_mode, "one_per_domain");
  // Not the documented default order (content_info.sentiment_connotations.anger,desc): the most prominent citation first, English pages only.
  assert.deepEqual(search.order_by, ["score,desc"]);
  assert.deepEqual(search.filters, ["content_info.language", "=", "en"]);
  assert.throws(() => searchBrand('Tally"roo'), "nothing that breaks the phrase");
  assert.throws(() => backlinksSummaryRequest("not a domain"));
  assert.throws(() => backlinksSeriesRequest({ target: "tallyroo.com", from: "2026-01-01", to: "2026-10-12" }), /26 weeks/);
});

test("the mentions phrase, worked out before anything is bought: a company name tidied, a domain's name when the brand can't be asked, else none", () => {
  assert.equal(brandPhrase("Tallyroo", "tallyroo.com"), "Tallyroo");
  assert.equal(brandPhrase("Smith, Jones & Co.", "smithjones.example"), "Smith Jones & Co");
  assert.equal(brandPhrase("Yahoo!", "yahoo.example"), "Yahoo");
  assert.equal(brandPhrase("Brand (UK)", "brand.example"), "Brand", "a bracketed qualifier is dropped");
  assert.equal(brandPhrase("Pay+", "payplus.example"), "Pay");
  assert.equal(brandPhrase("O'Neill & Sons", "oneill.example"), "O'Neill & Sons", "what the phrase can take is kept");
  assert.equal(brandPhrase("X", "xcorp.example"), "xcorp", "too short: the domain's first label");
  assert.equal(brandPhrase(null, "www.tallyroo.com"), "tallyroo");
  assert.equal(brandPhrase("X", "x.example"), null, "nothing that can be asked");
  assert.equal(brandPhrase("™®", "q.example"), null);
  const long = "The Very Long Company Name Of Accounting Software For Small Businesses Limited";
  const cut = brandPhrase(long, "long.example")!;
  assert.ok(cut.length <= 60 && long.startsWith(cut) && !cut.endsWith(" "), `cut at a word: ${cut}`);
  for (const b of ["Smith, Jones & Co.", "Yahoo!", "Brand (UK)", "Pay+", long]) assert.doesNotThrow(() => contentSearchRequest({ phrase: brandPhrase(b, "fallback.example")! }), b);
});
