import assert from "node:assert/strict";
import { test } from "node:test";

import type { FootprintRow, Pull } from "./footprint.ts";
import { pickBand, pickIntent, pickPage, pickSort, pickView, readGoogleKept } from "./keys.ts";
import { PAGE_ROWS, filterRanking, pageOf, rankingKpis, rankingRows, sortRanking } from "./ranking.ts";
import { footprintCandidates, setupSuggestions, suggestedClusters } from "./setup-suggestions.ts";
import { momentum } from "./momentum.ts";

/**
 * The All view, the setup and cluster suggestions, and the page's keys (13
 * Oct 2026, DIY P6; spec 10 sections 3.5, 4.3, 4.10 and 4.12).
 */

const row = (k: string, p: number | null, o: Partial<FootprintRow> = {}): FootprintRow => ({ k, p, u: `/${k.replace(/\s+/g, "-")}`, v: 100, i: "commercial", e: 1, ...o });
const pull = (pulledOn: string, rows: FootprintRow[], total: number | null = null): Pull => ({ pulledOn, labsDate: pulledOn, total, etv: 120.5, rows });
const subject = { brand: "Tallyroo", domain: "tallyroo.com", aliases: [] };

test("All view rows: change against our previous pull, or DataForSEO's own reading with one pull; tracked keywords marked; no difficulty field", () => {
  const latest = pull("2026-10-14", [row("a", 4, { pr: 9 }), row("b", 12, { n: true }), row("c", 30, { pr: 20 }), row("Tracked One", 3)]);
  const ours = rankingRows(latest, pull("2026-10-07", [row("a", 6), row("c", 25)]), new Set(["tracked one"]));
  assert.deepEqual(ours.map((r) => [r.keyword, r.change, r.isNew, r.tracked]), [
    ["a", 2, false, false],
    ["b", null, true, false],
    ["c", -5, false, false],
    ["Tracked One", null, true, true],
  ]);
  const theirs = rankingRows(latest, null, new Set());
  assert.deepEqual(theirs.map((r) => [r.change, r.isNew]), [[5, false], [null, true], [-10, false], [null, false]]);
  for (const r of ours) assert.deepEqual(Object.keys(r).filter((k) => /difficulty|kd|score/i.test(k)), []);
});

test("All view: search, intent and band filters, the sorts, and pages of 100", () => {
  const rows = rankingRows(pull("x", Array.from({ length: 250 }, (_, i) => row(`kw ${i}`, 1 + (i % 40), { i: i % 2 ? "informational" : "commercial", v: i, e: i }))), null, new Set());
  assert.equal(filterRanking(rows, { q: "kw 1", intent: null, band: null }).length, 111);
  assert.ok(filterRanking(rows, { q: "", intent: "informational", band: null }).every((r) => r.intent === "informational"));
  assert.ok(filterRanking(rows, { q: "", intent: null, band: "p2" }).every((r) => r.position! >= 11 && r.position! <= 20));
  assert.equal(sortRanking(rows, "etv", "desc")[0]!.keyword, "kw 249");
  assert.equal(sortRanking(rows, "position", "asc")[0]!.position, 1);
  const p3 = pageOf(sortRanking(rows, "keyword", "asc"), 3);
  assert.deepEqual([p3.page, p3.pages, p3.rows.length], [3, 3, 50]);
  assert.equal(pageOf(rows, 99).page, 3, "a page past the end is the last");
  assert.equal(PAGE_ROWS, 100);
});

test("All view figures: Labs' total, page 1 of the rows read, buying-intent share of those with an intent, etv", () => {
  const k = rankingKpis(pull("x", [row("a", 3), row("b", 11, { i: "informational" }), row("c", 9, { i: null })], 1342));
  assert.deepEqual(k, { total: 1342, read: 3, page1: 2, commercial: { n: 1, of: 2 }, etv: 120.5 });
});

test("setup suggestions: buying intent, volume, positions 4-30, not branded or tracked, by volume then position; gaining; the checkout keyword last; 10 at most", () => {
  const latest = pull("2026-10-14", [
    row("top spot", 2, { v: 9000 }),
    row("big one", 12, { v: 5000 }),
    row("tied volume deeper", 20, { v: 900 }),
    row("tied volume closer", 8, { v: 900 }),
    row("info one", 6, { i: "informational", v: 9000 }),
    row("no volume", 6, { v: 0 }),
    row("too deep", 31, { v: 9000 }),
    row("tallyroo login", 5, { v: 9000 }),
    row("tracked already", 7, { v: 9000 }),
    ...Array.from({ length: 12 }, (_, i) => row(`filler ${String(i).padStart(2, "0")}`, 10, { v: 50 - i })),
  ]);
  const tracked = new Set(["tracked already"]);
  const list = footprintCandidates(latest, tracked, subject);
  assert.deepEqual(list.slice(0, 3).map((s) => s.keyword), ["big one", "tied volume closer", "tied volume deeper"]);
  assert.match(list[0]!.reason, /^12th on Google, \/big-one; 5,000 searches a month \(DataForSEO estimate, read 14 Oct 2026\)\.$/);
  const gaining = momentum({ latest, previous: pull("2026-10-07", [row("big one", 25)]), tracked: [], dismissed: new Set(), subject, showAll: false, today: "2026-10-14" });
  const setup = setupSuggestions({ latest, gaining, tracked, subject, typed: "Invoicing App For Freelancers" });
  assert.equal(setup.length, 10);
  assert.equal(setup.filter((s) => s.keyword === "big one").length, 1, "each once");
  const few = setupSuggestions({ latest: pull("x", [row("only one", 9)]), gaining: null, tracked: new Set(), subject, typed: "invoicing app for freelancers" });
  assert.deepEqual(few.map((s) => [s.keyword, s.source]), [["only one", "footprint"], ["invoicing app for freelancers", "checkout"]]);
  assert.deepEqual(setupSuggestions({ latest: null, gaining: null, tracked: new Set(), subject, typed: "x y z" }), [], "no footprint: the block does not show");
});

test("suggested clusters: gaining ground first, then the footprint's candidates, 5 at most", () => {
  const latest = pull("2026-10-14", [row("climber", 7, { v: 50 }), row("big", 12, { v: 9000 }), ...Array.from({ length: 8 }, (_, i) => row(`f ${i}`, 10, { v: 800 - i }))]);
  const gaining = momentum({ latest, previous: pull("a", [row("climber", 19), row("big", 12), ...Array.from({ length: 8 }, (_, i) => row(`f ${i}`, 10))]), tracked: [], dismissed: new Set(), subject, showAll: false, today: "2026-10-14" });
  const s = suggestedClusters({ latest, gaining, tracked: new Set(), subject });
  assert.deepEqual(s.map((x) => x.keyword), ["climber", "big", "f 0", "f 1", "f 2"]);
  assert.match(s[0]!.reason, /^Up from 19th to 7th, \/climber; 50 searches a month/);
});

test("the page's keys: each to its own bound, and the route's way back keeps only those", () => {
  assert.equal(pickView("all"), "all");
  assert.equal(pickView("ALL"), "tracked");
  assert.equal(pickBand("p2"), "p2");
  assert.equal(pickBand("page2"), null);
  assert.equal(pickIntent("all"), "all");
  assert.equal(pickIntent("informational"), "informational");
  assert.equal(pickIntent("buy"), null);
  assert.equal(pickPage("50"), 50);
  assert.equal(pickPage("51"), 1);
  assert.equal(pickPage("2.5"), 1);
  assert.equal(pickSort("etv"), "etv");
  assert.equal(pickSort("best"), "best");
  assert.equal(pickSort("drop table"), null);
  const sp = new URLSearchParams({ from: "2026-09-16", to: "2026-10-13", compare: "month", view: "all", gaining: "1", cluster: "c3", band: "top3", intent: "all", q: "x".repeat(200), sort: "volume", dir: "asc", page: "3", row: "k1", done: "dismissed", evil: "<script>" });
  assert.deepEqual(readGoogleKept((k) => sp.get(k), 120), { from: "2026-09-16", to: "2026-10-13", compare: "month", view: "all", gaining: "1", cluster: "c3", band: "top3", intent: "all", q: "x".repeat(120), sort: "volume", dir: "asc", page: "3" });
});
