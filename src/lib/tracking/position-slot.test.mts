import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { clusterCards } from "./cluster-figures.ts";
import { marketOf, positionSlot } from "./position-slot.ts";

/**
 * A cluster keyword's Google slot in words (13 Oct 2026, Danny; spec 10
 * section 2.6 rule 2): read and outside the top 20 is said with its market,
 * and is never worded as a keyword not read - before its first check, or on
 * a day or range with no reading - nor as one with no keyword.
 */

const kw = (o: Partial<Parameters<typeof positionSlot>[0]> = {}) => ({ keyword: "b2b seo agency", position: null, positionRead: true, positionOn: "2026-10-12", status: "live" as const, ...o });

test("the five slots: ranked, out of the top 20 with its market, not checked yet, not measured, no keyword", () => {
  assert.deepEqual(positionSlot(kw({ position: 3 }), "UK"), { kind: "ranked", short: "#3", full: "'b2b seo agency' is 3rd on Google in the UK at its latest reading, 12 Oct." });
  assert.deepEqual(positionSlot(kw(), "UK"), { kind: "out", short: "Not in top 20 (UK)", full: "'b2b seo agency' is not in Google's top 20 in the UK at its latest reading, 12 Oct." });
  assert.equal(positionSlot(kw(), "US").short, "Not in top 20 (US)");
  assert.deepEqual(positionSlot(kw({ positionRead: false, positionOn: null, status: "pending" }), "UK"), { kind: "pending", short: "Not checked yet", full: "'b2b seo agency' has not been checked on Google yet. Its first check is the next daily check." });
  assert.equal(positionSlot(kw({ positionRead: false, positionOn: null }), "UK", { from: "2026-10-12", to: "2026-10-12" }).short, "Not measured that day");
  assert.equal(positionSlot(kw({ positionRead: false, positionOn: null }), "UK", { from: "2026-10-12", to: "2026-10-12" }).full, "'b2b seo agency' was not read on Google on 12 Oct.");
  assert.deepEqual(positionSlot(kw({ positionRead: false, positionOn: null }), "UK", { from: "2026-09-15", to: "2026-10-12" }), { kind: "unread", short: "Not measured in this range", full: "'b2b seo agency' was not read on Google between 15 Sep and 12 Oct." });
  assert.equal(positionSlot(kw({ keyword: null, positionRead: false }), "UK").kind, "none");
  assert.equal(positionSlot(kw({ position: 11 }), "UK").full, "'b2b seo agency' is 11th on Google in the UK at its latest reading, 12 Oct.");
});

test("rule 2: a keyword read and out of the top 20 never shares words with one not read", () => {
  const out = positionSlot(kw(), "UK");
  for (const s of [positionSlot(kw({ positionRead: false, status: "pending" }), "UK"), positionSlot(kw({ positionRead: false }), "UK", { from: "2026-10-12", to: "2026-10-12" }), positionSlot(kw({ positionRead: false }), "UK")]) {
    assert.notEqual(s.kind, "out");
    assert.doesNotMatch(s.short + s.full, /top 20/, s.short);
    assert.doesNotMatch(out.short, new RegExp(s.short));
  }
});

// Review, 13 Oct 2026: ON-1 lets a live cluster with no keyword take one, checked from the next daily check
// (rekey.ts). Until that check its slot said "Not measured in this range", worded as a reading missed.
test("a keyword a live cluster took after it started is 'Not checked yet' until its first check, then measured as any other", () => {
  const range = { from: "2026-09-16", to: "2026-10-13" };
  const input = {
    clusters: [{ id: "c1", name: "B2B SEO", keyword_id: "k1", started_on: "2026-09-01", stopped_on: null }],
    questions: [],
    keywords: [{ id: "k1", keyword: "b2b seo agency", added_on: "2026-10-14", search_volume: null, intent: null }],
    answers: [],
    serp: [],
    range,
    before: null,
    today: "2026-10-13",
    engines: [],
  };
  const [c] = clusterCards(input);
  assert.equal(c!.status, "live");
  assert.equal(c!.keywordAhead, true);
  assert.equal(positionSlot(c!, "UK", range).kind, "pending");
  assert.equal(positionSlot(c!, "UK", range).short, "Not checked yet");
  // From its first check on, a day with no reading is a day not measured, and a reading out of the top 20 says so.
  const day = { from: "2026-10-14", to: "2026-10-14" };
  const [d] = clusterCards({ ...input, range: day, today: "2026-10-14" });
  assert.equal(d!.keywordAhead, false);
  assert.equal(positionSlot(d!, "UK", day).short, "Not measured that day");
  const [e] = clusterCards({ ...input, range: day, today: "2026-10-14", serp: [{ keyword_id: "k1", run_date: "2026-10-14", position: null }] });
  assert.equal(positionSlot(e!, "UK", day).short, "Not in top 20 (UK)");
});

test("the market is the runner's: UK or US, anything else read as the US, as the Clusters page reads it", () => {
  assert.equal(marketOf("UK"), "UK");
  assert.equal(marketOf("US"), "US");
  assert.equal(marketOf("uk"), "US");
  assert.equal(marketOf(""), "US");
});

// The help line about our reading (help.ts, Google positions) says desktop, the market and no account: that is the
// request the runner makes. If keywordRankRequest stops saying so, the help line is wrong and this fails first.
test("the keyword read the help describes: desktop, the market's location, the top 20, organic only, and no account or cookie", async () => {
  const { keywordRankRequest, SERP_DEPTH } = await import("../scan/dataforseo-request.ts");
  const uk = keywordRankRequest("b2b seo agency", "UK").body as Record<string, unknown>[];
  assert.deepEqual(Object.keys(uk[0]!).sort(), ["depth", "device", "keyword", "language_code", "location_code"]);
  assert.equal(uk[0]!.device, "desktop");
  assert.equal(uk[0]!.depth, SERP_DEPTH);
  assert.equal(SERP_DEPTH, 20);
  assert.equal(uk[0]!.location_code, 2826);
  assert.equal((keywordRankRequest("b2b seo agency", "US").body as Record<string, unknown>[])[0]!.location_code, 2840);
  // The daily tracking read is readKeywordPosition (runner.ts); the line is asserted in that function's own body,
  // since readKeywordRank (the scan's read) holds the same line (review, 13 Oct 2026).
  const src = readFileSync(join(fileURLToPath(import.meta.url), "..", "..", "scan", "dataforseo.ts"), "utf8");
  const start = src.indexOf("export async function readKeywordPosition(");
  assert.ok(start > 0, "readKeywordPosition is in dataforseo.ts");
  const body = src.slice(start, src.indexOf("\n}\n", start));
  assert.ok(body.includes("const { path, body, timeoutMs } = keywordRankRequest(keyword, market);"), "the tracking read is keywordRankRequest's");
  assert.ok(body.includes("post(path, body, "), "and posts that request as built");
  const runner = readFileSync(join(fileURLToPath(import.meta.url), "..", "runner.ts"), "utf8");
  assert.ok(runner.includes("await readKeywordPosition(k.keyword as string, domain, market, remainingMs())"), "the tracking runner reads each keyword through readKeywordPosition");
  // Only organic results count: a map place, an ad or an AI Overview link is not a position (help.ts says so).
  const engines = readFileSync(join(fileURLToPath(import.meta.url), "..", "..", "scan", "engines.ts"), "utf8");
  assert.ok(engines.includes('if (i.type !== "organic") continue;'), "collectOrganic keeps organic results only");
});
