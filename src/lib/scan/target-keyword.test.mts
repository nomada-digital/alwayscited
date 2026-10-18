import assert from "node:assert/strict";
import { test } from "node:test";

import type { Intent } from "./dataforseo-request.ts";
import { clusterGoogleTrio, clusterKeywordFits, normaliseCandidate, pickClusterKeyword, pickKeyword, stripFiller } from "./target-keyword.ts";

const CAT = "business cash flow finance";
const NOUN = "providers";

test("Danny's example: the question comes down to the supplier keyword", () => {
  assert.equal(normaliseCandidate("best business cash flow finance providers uk", CAT, NOUN), "business cash flow finance providers");
});

test("the bare category never stands, and gets the supplier noun instead", () => {
  // Offered bare, it is not refused outright: it becomes the supplier keyword.
  assert.equal(normaliseCandidate("business cash flow finance", CAT, NOUN), "business cash flow finance providers");
  // With no supplier noun to add, the bare category is refused.
  assert.equal(normaliseCandidate("business cash flow finance", CAT, ""), null);
  assert.equal(normaliseCandidate("top business cash flow finance 2026", CAT, "finance"), null);
});

test("filler, years and the country word come out", () => {
  assert.equal(stripFiller("Which are the top 10 SEO agencies in the UK 2026?"), "seo agencies");
  assert.equal(normaliseCandidate("who offers invoice finance lenders", CAT, NOUN), "invoice finance lenders");
});

test("a supplier noun alone is not a keyword", () => {
  assert.equal(normaliseCandidate("best providers uk", CAT, NOUN), null);
});

test("the highest volume standing candidate wins", () => {
  const v = new Map([
    ["invoice finance providers", 320],
    ["business cash flow finance providers", 480],
  ]);
  assert.equal(pickKeyword(["best invoice finance providers", "business cash flow finance providers uk", "business cash flow finance"], CAT, NOUN, v), "business cash flow finance providers");
});

test("all zero: the shortest standing candidate", () => {
  assert.equal(
    pickKeyword(["cash flow lenders for small firms", "cash flow lenders", "business cash flow finance"], CAT, NOUN, new Map()),
    "cash flow lenders",
  );
});

test("nothing stands: null, not a guess", () => {
  assert.equal(pickKeyword(["best", "top uk 2026"], CAT, NOUN, new Map()), null);
});

// C1 of BRIEF-3 (Danny, 29 Sep 2026): the cluster keyword never guesses.
const vols = (o: Record<string, number | null>) => new Map(Object.entries(o));
const ints = (o: Record<string, Intent | null>) => new Map(Object.entries(o));

test("cluster keyword: a zero-volume set returns none, not the shortest", () => {
  const got = pickClusterKeyword(["seo agencies", "b2b seo agency"], vols({ "seo agencies": 0, "b2b seo agency": 0 }), ints({ "seo agencies": "commercial", "b2b seo agency": "commercial" }));
  assert.deepEqual(got, { none: "no_volume" });
});

test("cluster keyword: a null volume never qualifies", () => {
  assert.deepEqual(pickClusterKeyword(["retail pos system"], vols({ "retail pos system": null }), ints({ "retail pos system": "commercial" })), { none: "no_volume" });
  assert.deepEqual(pickClusterKeyword(["retail pos system"], vols({}), ints({ "retail pos system": "commercial" })), { none: "no_volume" }, "not read at all");
});

test("cluster keyword: informational at 90k loses to commercial at 400", () => {
  const got = pickClusterKeyword(["what is pos", "retail pos system"], vols({ "what is pos": 90_000, "retail pos system": 400 }), ints({ "what is pos": "informational", "retail pos system": "commercial" }));
  assert.deepEqual(got, { keyword: "retail pos system", volume: 400, intent: "commercial" });
});

test("cluster keyword: navigational never qualifies; volume without the intent says no_intent", () => {
  assert.deepEqual(pickClusterKeyword(["shopify pos"], vols({ "shopify pos": 50_000 }), ints({ "shopify pos": "navigational" })), { none: "no_intent" });
  assert.deepEqual(pickClusterKeyword(["pos"], vols({ pos: 10 }), ints({ pos: null })), { none: "no_intent" }, "intent not read");
});

test("cluster keyword: highest qualifying volume wins, ties to the model's order, transactional counts, no candidate is none", () => {
  const i = ints({ a1: "commercial", b2: "transactional", c3: "commercial" });
  assert.deepEqual(pickClusterKeyword(["a1", "b2", "c3"], vols({ a1: 100, b2: 300, c3: 300 }), i), { keyword: "b2", volume: 300, intent: "transactional" });
  assert.deepEqual(pickClusterKeyword(["B2 "], vols({ b2: 300 }), i), { keyword: "b2", volume: 300, intent: "transactional" }, "read in keywordForm");
  assert.deepEqual(pickClusterKeyword([], vols({}), ints({})), { none: "no_candidate" });
});

test("clusterGoogleTrio: a scan from before C1 keeps its rows' own keyword", () => {
  assert.equal(clusterGoogleTrio(null), null);
  assert.equal(clusterGoogleTrio({ status: null, keyword: null, volume: null, rank: null }), null);
});

test("clusterGoogleTrio: a chosen keyword is the line every prompt reads, rank null meaning not in the top twenty", () => {
  assert.deepEqual(clusterGoogleTrio({ status: "chosen", keyword: "invoicing software", volume: 2400, rank: 7 }), {
    target_keyword: "invoicing software",
    search_volume: 2400,
    keyword_rank: 7,
  });
  assert.deepEqual(clusterGoogleTrio({ status: "chosen", keyword: "invoicing software", volume: 2400, rank: null }), {
    target_keyword: "invoicing software",
    search_volume: 2400,
    keyword_rank: null,
  });
});

test("clusterGoogleTrio: none_qualified and read_failed show no keyword, never one that did not qualify", () => {
  for (const status of ["none_qualified", "read_failed"] as const) {
    assert.deepEqual(clusterGoogleTrio({ status, keyword: "stale keyword", volume: 90, rank: 3 }), {
      target_keyword: null,
      search_volume: null,
      keyword_rank: null,
    });
  }
});

test("a stored cluster keyword is reused only for the topic and market it was read for, never across markets (18 Oct 2026)", () => {
  const read = { status: "chosen", topic: "b2b seo agency", market: "UK" };
  assert.ok(clusterKeywordFits(read, "b2b seo agency", "UK"));
  assert.ok(!clusterKeywordFits(read, "b2b seo agency", "US"), "switched to the US: read again, never the UK keyword and volume");
  assert.ok(!clusterKeywordFits(read, "seo agency", "UK"), "another topic: read again");
  assert.ok(!clusterKeywordFits({ status: "chosen", topic: "b2b seo agency", market: null }, "b2b seo agency", "UK"), "stored before the market was recorded: never guessed");
  assert.ok(!clusterKeywordFits({ status: null, topic: "b2b seo agency", market: "UK" }, "b2b seo agency", "UK"), "never checked");
  assert.ok(clusterKeywordFits({ status: "none_qualified", topic: "b2b seo agency", market: "US" }, "b2b seo agency", "US"), "a 'none qualified' answer is a reading too, reused in its own market");
});
