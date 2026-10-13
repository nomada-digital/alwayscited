import assert from "node:assert/strict";
import { test } from "node:test";

import { filterTracked, inBand, positionBands, readingsByKeyword, sortTracked, trackedKpis, trackedRows, urlAt, urlFlag } from "./tracked.ts";

/**
 * The Google page's Tracked view (13 Oct 2026, DIY P6; spec 10 section 4.3
 * rows 1, 2 and 4), on spec 2.6's measurement rules.
 */

const range = { from: "2026-10-01", to: "2026-10-14" };
const kw = (id: string, added_on = "2026-09-01", stopped_on: string | null = null) => ({ id, keyword: `keyword ${id}`, added_on, stopped_on, search_volume: 100, intent: "commercial" });
const days = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => `2026-10-${String(from + i).padStart(2, "0")}`);

test("the URL flags: one switch is 'URL changed', back and forth is two pages taking turns, with the days each held", () => {
  const rd = (day: string, url: string | null, position: number | null = 7) => ({ day, position, url });
  assert.equal(urlFlag([rd("a", "https://tallyroo.com/x"), rd("b", "https://www.tallyroo.com/x/")]), null, "one page, written two ways");
  assert.deepEqual(urlFlag([rd("2026-10-01", "https://tallyroo.com/a"), rd("2026-10-02", "https://tallyroo.com/b"), rd("2026-10-03", "https://tallyroo.com/b")]), { kind: "changed", on: "2026-10-02", from: "https://tallyroo.com/a", to: "https://tallyroo.com/b" });
  assert.deepEqual(urlFlag([rd("1", "https://tallyroo.com/a"), rd("2", "https://tallyroo.com/b"), rd("3", "https://tallyroo.com/a"), rd("4", null, null), rd("5", "https://tallyroo.com/a")]), {
    kind: "turns",
    held: [
      { url: "https://tallyroo.com/a", days: 3 },
      { url: "https://tallyroo.com/b", days: 1 },
    ],
  });
});

test("rows: first and latest reading in the range, places gained, entering or leaving the top 20 as a move, the best, a first reading alone", () => {
  const serp = [
    ...days(1, 14).map((d, i) => ({ run_date: d, keyword_id: "k1", position: 15 - Math.min(i, 8) })),
    { run_date: "2026-10-01", keyword_id: "k2", position: null },
    { run_date: "2026-10-14", keyword_id: "k2", position: 18 },
    { run_date: "2026-10-01", keyword_id: "k3", position: 9 },
    { run_date: "2026-10-13", keyword_id: "k3", position: null },
    { run_date: "2026-10-14", keyword_id: "k4", position: 12 },
  ];
  const urls = new Map([[urlAt("k1", "2026-10-14"), "https://tallyroo.com/k1"]]);
  const readings = readingsByKeyword(serp, urls);
  const rows = trackedRows({ keywords: [kw("k1"), kw("k2"), kw("k3"), kw("k4", "2026-10-13"), kw("k5", "2026-08-01", "2026-09-01")], clusterOf: new Map([["k1", "c1"]]), readings, range });
  const by = new Map(rows.map((r) => [r.id, r]));
  assert.ok(!by.has("k5"), "stopped before the range");
  assert.equal(by.get("k1")!.change, 8);
  assert.deepEqual(by.get("k1")!.best, { position: 7, day: "2026-10-09" });
  assert.equal(by.get("k1")!.url, "https://tallyroo.com/k1");
  assert.equal(by.get("k1")!.clusterId, "c1");
  assert.equal(by.get("k2")!.move, "entered");
  assert.equal(by.get("k2")!.change, null, "entering the top 20 is not a measurable move");
  assert.equal(by.get("k3")!.move, "left");
  assert.equal(by.get("k3")!.notReadOn, "2026-10-14", "not read on the client's latest check day: not measured, its latest reading shown");
  assert.equal(by.get("k4")!.firstOnly, true);
  assert.equal(by.get("k1")!.notReadOn, null);
  // Rule 7: the moves sort past every measured change.
  assert.deepEqual(sortTracked(rows, "change", "desc").map((r) => r.id), ["k2", "k1", "k3", "k4"]);
  assert.deepEqual(filterTracked(rows, { band: "p2", cluster: null, q: "" }).map((r) => r.id), ["k2", "k4"]);
  assert.deepEqual(filterTracked(rows, { band: "out", cluster: null, q: "" }).map((r) => r.id), ["k3"]);
  assert.ok(inBand(3, "p1") && inBand(3, "top3") && !inBand(11, "p1") && inBand(null, "out"));
});

test("the figures: n of m at the latest reading, and 'was' like for like on the keywords tracked all of both periods", () => {
  const before = { from: "2026-09-17", to: "2026-09-30" };
  const serp = [
    { run_date: "2026-09-30", keyword_id: "k1", position: 12 },
    { run_date: "2026-10-14", keyword_id: "k1", position: 2 },
    { run_date: "2026-09-30", keyword_id: "k2", position: 8 },
    { run_date: "2026-10-14", keyword_id: "k2", position: 9 },
    { run_date: "2026-10-14", keyword_id: "k3", position: 1 },
  ];
  const readings = readingsByKeyword(serp, new Map());
  const keywords = [kw("k1"), kw("k2"), kw("k3", "2026-10-05")];
  const rows = trackedRows({ keywords, clusterOf: new Map(), readings, range });
  const k = trackedKpis({ rows, keywords, readings, range, compare: before, runs: [{ run_date: "2026-10-14", status: "partial" }, { run_date: "2026-09-30", status: "partial" }] });
  assert.deepEqual(k.top3, { n: 2, of: 3 });
  assert.deepEqual(k.page1, { n: 3, of: 3 });
  assert.deepEqual(k.was, { keywords: 2, top3: { n: 0, of: 2 }, page1: { n: 1, of: 2 }, top3Now: 1, page1Now: 2, on: "2026-09-30" }, "k3 was added in the range: left out of 'was'");
  assert.equal(k.partial, 1, "only the range's partial checks");
  assert.equal(k.late, 1);
  assert.equal(k.readings, 1);
});

test("position bands: a point a week by median, and the last point each keyword's latest reading", () => {
  const serp = [
    ...days(1, 7).map((d) => ({ run_date: d, keyword_id: "k1", position: 12 })),
    ...days(8, 13).map((d) => ({ run_date: d, keyword_id: "k1", position: 9 })),
    { run_date: "2026-10-14", keyword_id: "k1", position: 2 },
    ...days(1, 14).map((d) => ({ run_date: d, keyword_id: "k2", position: null })),
  ];
  const readings = readingsByKeyword(serp, new Map());
  const pts = positionBands({ readings, ids: new Set(["k1", "k2"]), range });
  assert.deepEqual(pts, [
    { d: "2026-10-07", b3: 0, b10: 0, b20: 1, out: 1 },
    { d: "2026-10-14", b3: 1, b10: 0, b20: 0, out: 1 },
  ]);
});
