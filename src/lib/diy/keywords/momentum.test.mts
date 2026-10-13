import assert from "node:assert/strict";
import { test } from "node:test";

import type { FootprintRow, Pull } from "./footprint.ts";
import { MOMENTUM, gainingLabel, gainingSummary, momentum, trackedSet } from "./momentum.ts";

/**
 * Keyword momentum (13 Oct 2026, DIY P6; spec 10 section 6.6): Nomada's rule
 * (build_client.py:220-238) with its three fixes, on two stored pulls.
 */

const today = "2026-10-14";
const subject = { brand: "Tallyroo", domain: "tallyroo.com", aliases: ["Tally Roo"] };
const row = (k: string, p: number | null, o: Partial<FootprintRow> = {}): FootprintRow => ({ k, p, u: `/${k.split(" ")[0]}`, v: 500, i: "commercial", e: 1, ...o });
const pull = (pulledOn: string, rows: FootprintRow[]): Pull => ({ pulledOn, labsDate: pulledOn, total: rows.length, etv: 1, rows });
const run = (latest: Pull, previous: Pull | null, o: { tracked?: { keyword: string; stopped_on: string | null }[]; dismissed?: string[]; showAll?: boolean } = {}) =>
  momentum({ latest, previous, tracked: o.tracked ?? [], dismissed: new Set(o.dismissed ?? []), subject, showAll: o.showAll ?? false, today });

test("Nomada's cases: up 5 or more places is climbing, a new keyword in the top 20 is new, anything less is skipped", () => {
  const prev = pull("2026-10-07", [row("up five", 15), row("up four", 14), row("down", 5), row("deep climb", 60), row("same", 8)]);
  const latest = pull("2026-10-14", [row("up five", 10), row("up four", 10), row("down", 9), row("deep climb", 31), row("same", 8), row("brand new", 12), row("new but deep", 21)]);
  const m = run(latest, prev);
  assert.deepEqual(
    m.rows.map((g) => [g.keyword, g.kind, g.previous, g.position, g.gain]),
    [
      ["brand new", "new", null, 12, 89],
      ["up five", "climbing", 15, 10, 5],
    ],
  );
  assert.equal(m.total, 2);
  assert.equal(m.basis, "ours");
  assert.equal(gainingLabel(m.rows[0]!, m.basis), "New at 12th");
  assert.equal(gainingLabel(m.rows[1]!, m.basis), "Up from 15th to 10th");
});

test("the order key is gain times volume, floored at 10; it is never on a returned row", () => {
  const prev = pull("a", [row("big climb small volume", 30, { v: 10 }), row("small climb big volume", 12, { v: 5000 })]);
  const latest = pull("b", [row("big climb small volume", 5, { v: 10 }), row("small climb big volume", 7, { v: 5000 })]);
  const m = run(latest, prev);
  assert.deepEqual(m.rows.map((g) => g.keyword), ["small climb big volume", "big climb small volume"], "5 x 5000 beats 25 x 10");
  for (const g of m.rows) assert.ok(!("key" in g), "the order key is not a figure the page could show");
});

test("fix 1, the commercial default: commercial and transactional only, unless intent=all", () => {
  const latest = pull("b", [row("buy it", 9, { i: "transactional" }), row("compare it", 8), row("learn it", 7, { i: "informational" }), row("find it", 6, { i: "navigational" }), row("no intent", 5, { i: null })]);
  assert.deepEqual(run(latest, pull("a", [])).rows.map((g) => g.keyword).sort(), ["buy it", "compare it"]);
  assert.deepEqual(run(latest, pull("a", []), { showAll: true }).rows.map((g) => g.keyword).sort(), ["buy it", "compare it", "find it", "learn it", "no intent"]);
});

test("fix 2, one pull only: DataForSEO's own previous reading stands in, and the label says so", () => {
  const latest = pull("b", [row("climbed", 7, { pr: 18 }), row("arrived", 12, { n: true }), row("steady", 9, { pr: 10 })]);
  const m = run(latest, null);
  assert.equal(m.basis, "dataforseo");
  assert.deepEqual(m.rows.map((g) => g.keyword), ["arrived", "climbed"]);
  assert.equal(gainingLabel(m.rows[1]!, m.basis), "Up from 18th to 7th, by DataForSEO's previous reading");
  assert.equal(gainingLabel(m.rows[0]!, m.basis), "New at 12th, by DataForSEO's previous reading");
  // With a previous pull of ours, DataForSEO's own field is not read at all.
  assert.deepEqual(run(latest, pull("a", [row("climbed", 8), row("arrived", 13), row("steady", 9)])).rows, []);
});

test("fix 3: volume, intent and the ranking URL are carried on each row", () => {
  const m = run(pull("b", [row("payroll software for sole traders", 7, { v: 880, i: "commercial", u: "/payroll", e: 41.2 })]), pull("a", [row("payroll software for sole traders", 18)]));
  assert.deepEqual(m.rows[0], { keyword: "payroll software for sole traders", position: 7, previous: 18, kind: "climbing", gain: 11, volume: 880, intent: "commercial", url: "/payroll", etv: 41.2 });
});

test("left out: tracked (live, or stopped within 30 days), dismissed, and naming the brand, its domain or an alias", () => {
  const latest = pull("b", [row("live tracked", 5), row("stopped lately", 5), row("stopped long ago", 5), row("dismissed one", 5), row("tallyroo pricing", 5), row("tallyroo.com login", 5), row("tally roo app", 5), row("keeps", 5)]);
  const m = run(latest, pull("a", []), {
    tracked: [
      { keyword: "Live Tracked", stopped_on: null },
      { keyword: "stopped lately", stopped_on: "2026-09-20" },
      { keyword: "stopped long ago", stopped_on: "2026-09-13" },
    ],
    dismissed: ["Dismissed One"],
  });
  assert.deepEqual(m.rows.map((g) => g.keyword).sort(), ["keeps", "stopped long ago"]);
  assert.deepEqual([...trackedSet([{ keyword: "x", stopped_on: "2026-09-14" }, { keyword: "y", stopped_on: "2026-09-13" }], today)], ["x"], "30 days back is the edge");
});

test("volume of at least 10, and positions to 30 only", () => {
  const latest = pull("b", [row("nine a month", 5, { v: 9 }), row("no volume read", 5, { v: null }), row("ten a month", 5, { v: 10 }), row("at thirty", 30, { pr: 40 }), row("at thirty one", 31)]);
  const prev = pull("a", [row("nine a month", 15), row("no volume read", 15), row("ten a month", 15), row("at thirty", 40), row("at thirty one", 45)]);
  assert.deepEqual(run(latest, prev).rows.map((g) => g.keyword).sort(), ["at thirty", "ten a month"]);
});

test("the top 15 by the order key, with the total, the counts and the volume of every kept keyword", () => {
  const rows = Array.from({ length: 20 }, (_, i) => row(`keyword ${String(i).padStart(2, "0")}`, 5, { v: 100 + i }));
  const m = run(pull("b", rows), pull("a", rows.slice(0, 8).map((r) => ({ ...r, p: 15 }))));
  assert.equal(m.rows.length, MOMENTUM.top);
  assert.equal(m.total, 20);
  assert.equal(m.climbing, 8);
  assert.equal(m.new, 12);
  assert.equal(m.volume, rows.reduce((s, r) => s + (r.v ?? 0), 0));
  assert.equal(gainingSummary(m), `20 untracked keywords gaining ground: 8 climbing, 12 new, ${m.volume.toLocaleString("en-GB")} searches a month between them.`);
  assert.equal(gainingSummary({ total: 0, climbing: 0, new: 0, volume: 0 }), "No untracked keyword is gaining ground in this pull.");
});

test("ties: the same key goes to volume, then the better position, then the keyword", () => {
  // Every row gains 10 places (key = 10 x 100), so only the tie-breaks order them.
  const latest = pull("b", [row("b same", 6, { v: 100 }), row("a same", 6, { v: 100 }), row("less volume", 10, { v: 100 }), row("better place", 5, { v: 100 })]);
  const prev = pull("a", [row("b same", 16), row("a same", 16), row("less volume", 20), row("better place", 15)]);
  const m = run({ ...latest, rows: latest.rows.map((r) => (r.k === "less volume" ? { ...r, v: 99 } : r)) }, prev);
  assert.deepEqual(m.rows.map((g) => g.keyword), ["better place", "a same", "b same", "less volume"]);
});
