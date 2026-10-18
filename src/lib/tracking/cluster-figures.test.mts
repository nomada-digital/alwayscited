import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { clusterCards, clusterChart, clusterDetail, daysOfLine, clusterSearch, clusterSummary, filterClusters, keyFigureChanges, pendingBasis, positionMove, promptBrands, promptIndex, promptStrip, searchPrompts } from "./cluster-figures.ts";
import { addDays, comparisonRange, keywordsIn, overview, periodPair, pointsDelta, resolveComparison, ungroupedRead } from "./figures.ts";
import { expandFixture, fixtureState } from "./fixture-mode.ts";

/**
 * T4b part 1 (30 Sep 2026): the overview's cluster figures, checked against
 * what boards-3/dataset.py prints for the same made-up Tallyroo (`python3
 * dataset.py`). The fixture copies the board's current-period readings and
 * Google positions exactly, so this period's rates, prompts named and
 * positions must match the board; the previous period was re-drawn from each
 * prompt's rate by make-fixture.py, so only the presence of a change is held.
 */

const fx = expandFixture(JSON.parse(readFileSync(new URL("./fixture.json", import.meta.url), "utf8")));
const range = { from: "2026-09-02", to: fx.today };
const cards = clusterCards({
  ...fx.data,
  range,
  before: comparisonRange(range, "prev"),
  today: fx.today,
  engines: ["google_aio", "chatgpt", "gemini", "perplexity"],
});
const by = (id: string) => cards.find((c) => c.id === id)!;

// dataset.py, 30 Sep 2026: id -> [rate, prompts named, position, places gained, per-prompt rates]
const BOARD: Record<string, [number, number, number | null, number | null, number[]]> = {
  c1: [42, 5, 4, 3, [34, 56, 41, 47, 29]],
  c2: [32, 5, 7, 4, [23, 43, 29, 41, 24]],
  c3: [33, 5, 11, 1, [39, 44, 22, 40, 18]],
  c4: [16, 4, 12, 3, [18, 24, 0, 20, 19]],
  c5: [37, 5, 3, 0, [34, 45, 44, 38, 24]],
  c6: [24, 5, 8, 3, [36, 18, 29, 21, 17]],
  c7: [34, 5, 5, 2, [39, 29, 27, 39, 35]],
  c8: [8, 3, 14, -1,[10, 12, 0, 17, 0]],
  // #23 on the board; the fixture keeps positions past #20 as unranked.
  c9: [4, 3, null, null, [5, 0, 11, 5, 0]],
};

test("every cluster card's rate, prompts named, position and prompt rates match the board", () => {
  assert.equal(cards.length, 10);
  for (const [id, [pct, named, pos, gained, prompts]] of Object.entries(BOARD)) {
    const c = by(id);
    assert.equal(c.now.pct, pct, `${id} rate`);
    assert.equal(c.promptsNamed.num, named, `${id} prompts named`);
    assert.equal(c.promptsNamed.den, 5);
    assert.equal(c.position, pos, `${id} position`);
    assert.equal(c.positionChange, gained, `${id} places gained`);
    assert.deepEqual(c.prompts.map((p) => p.now.pct), prompts, `${id} prompt rates`);
  }
});

test("status: tracked throughout is live, begun mid-range is added, first check after today is pending", () => {
  assert.deepEqual(cards.map((c) => c.status), ["live", "live", "live", "live", "live", "live", "live", "live", "added", "pending"]);
  for (const c of cards.filter((c) => c.status === "live")) assert.notEqual(c.delta, null, `${c.id} has a like-for-like change`);
  assert.equal(by("c9").delta, null, "a cluster added mid-range has no change");
  assert.equal(by("c9").positionChange, null);
});

test("a pending cluster has no readings: no rate, no heat, no engine marks", () => {
  const c = by("c10");
  assert.equal(c.now.pct, null);
  assert.ok(c.heat.every((h) => h === null));
  assert.ok(c.prompts.every((p) => p.namedBy.length === 0 && p.now.den === 0));
  assert.equal(c.keyword, "payroll and accounting software");
  assert.equal(c.volume, 1600);
  assert.equal(c.intent, "transactional");
  assert.ok(c.prompts.every((p) => !p.fixed), "drafted prompts have no reading, so every one is editable");
  assert.equal(pendingBasis(c), null, "no readings, no rate to explain");
  assert.equal(pendingBasis(by("c1")), null, "only a pending cluster's rate needs saying");
});

test("DS3: a read prompt moved into a pending cluster is fixed, and the card says its rate counts that prompt only", () => {
  const moved = fx.data.questions.find((q) => q.cluster_id === "c1")!;
  const mixed = clusterCards({
    ...fx.data,
    questions: fx.data.questions.map((q) => (q.id === moved.id ? { ...q, cluster_id: "c10" } : q)),
    range,
    before: comparisonRange(range, "prev"),
    today: fx.today,
    engines: ["google_aio", "chatgpt", "gemini", "perplexity"],
  });
  const c = mixed.find((x) => x.id === "c10")!;
  assert.equal(c.status, "pending");
  assert.deepEqual(c.prompts.filter((p) => p.fixed).map((p) => p.id), [moved.id]);
  const one = c.prompts.find((p) => p.id === moved.id)!;
  assert.deepEqual([c.now.num, c.now.den], [one.now.num, one.now.den], "the card's rate is the moved prompt's alone");
  assert.equal(pendingBasis(c), `Its rate counts 1 moved prompt only: ${one.now.num} of ${one.now.den} answers`);
});

test("heat: one cell a day, each of a live cluster's 20 answers; outlined (null) before an added cluster's first check", () => {
  const c1 = by("c1");
  assert.equal(c1.heat.length, 28);
  assert.ok(c1.heat.every((h) => h !== null && h.den === 20));
  const c9 = by("c9").heat;
  assert.ok(c9.slice(0, 14).every((h) => h === null), "before 16 Sep");
  assert.ok(c9.slice(14).every((h) => h !== null && h.den === 20));
});

test("engine marks: a prompt that never named the client has none; one prompt's marks are the engines that named it", () => {
  const c4 = by("c4");
  assert.deepEqual(c4.prompts[2]!.namedBy, [], "c4's sector prompt never names Tallyroo");
  for (const p of c4.prompts.filter((p) => p.now.num > 0)) assert.ok(p.namedBy.length > 0);
  assert.deepEqual(c4.prompts.map((p) => p.angle), ["category", "positioning", "sector", "outcome", "comparison"]);
});

// dataset.py, 30 Sep 2026: each prompt's days named per engine (AIO, ChatGPT, Gemini, Perplexity) and days checked - T6's row counts.
const BOARD_DAYS: Record<string, [number[][], number]> = {
  c1: [[[8, 9, 10, 11], [13, 18, 14, 18], [13, 8, 11, 14], [15, 18, 10, 10], [9, 10, 5, 9]], 28],
  c4: [[[3, 10, 2, 5], [5, 6, 7, 9], [0, 0, 0, 0], [4, 6, 5, 7], [6, 9, 2, 4]], 28],
  c8: [[[3, 1, 3, 4], [3, 3, 1, 6], [0, 0, 0, 0], [4, 7, 4, 4], [0, 0, 0, 0]], 28],
  c9: [[[2, 0, 0, 1], [0, 0, 0, 0], [0, 2, 1, 3], [1, 1, 1, 0], [0, 0, 0, 0]], 14],
  c10: [[[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], 0],
};

test("T6 day counts: per engine, the days it named the client for a prompt, of the days checked, match the board", () => {
  for (const [id, [days, checked]] of Object.entries(BOARD_DAYS)) {
    const c = by(id);
    assert.deepEqual(c.prompts.map((p) => p.daysNamed.map((d) => d.days)), days, `${id} days named`);
    assert.ok(c.prompts.every((p) => p.daysChecked === checked), `${id} days checked`);
    assert.deepEqual(c.prompts[0]!.daysNamed.map((d) => d.engine), ["google_aio", "chatgpt", "gemini", "perplexity"]);
  }
});

test("DS73: on a partial check each engine's days are of the days it answered, and the row says of up to", () => {
  const p = fixtureState(fx, { TRACKING_FIXTURE_STATE: "partial" });
  const row = clusterCards({ ...p.data, range, before: null, today: fx.today, engines: ["google_aio", "chatgpt", "gemini", "perplexity"] }).find((c) => c.id === "c1")!.prompts[0]!;
  // 8 Oct 2026 (audit data-3): the partial state also lost one earlier day's Google AI Overview reads, so 26.
  assert.deepEqual(row.daysNamed.map((d) => d.of), [26, 28, 28, 28], "Google AI Overviews failed today and one earlier day");
  assert.equal(daysOfLine(row), "days named, of up to 28");
  const whole = by("c1").prompts[0]!;
  assert.ok(whole.daysNamed.every((d) => d.of === 28));
  assert.equal(daysOfLine(whole), "days named, of 28");
});

test("no comparison: no change anywhere, and a cluster begun before the range is still live", () => {
  const none = clusterCards({ ...fx.data, range, before: null, today: fx.today, engines: ["google_aio"] });
  assert.ok(none.every((c) => c.delta === null && c.positionChange === null));
  assert.equal(none.find((c) => c.id === "c1")!.status, "live");
});

test("the headline and four figures by cluster match dataset.py's summary (T4b part 2)", () => {
  const s = clusterSummary(cards);
  assert.deepEqual([s.now.num, s.now.den, s.now.pct], [1272, 4760, 27], "1,272 of 4,760 answers, 27%");
  assert.deepEqual([s.lfl.den, s.lfl.pct], [4480, 28], "like-for-like on the 8 clusters tracked all period");
  assert.equal(s.lflBefore?.den, 4480);
  assert.ok(s.lflDelta !== null);
  assert.deepEqual([s.clusters, s.clustersLfl, s.prompts, s.promptsLfl], [9, 8, 45, 40]);
  assert.deepEqual([s.promptsNamed.num, s.promptsNamed.den], [40, 45]);
  assert.equal(s.promptsNamedBefore?.den, 40);
  assert.deepEqual(s.never, [
    { cluster: "bookkeeping software", text: "What bookkeeping software do US restaurants use?" },
    { cluster: "cloud accounting software", text: "What accounting software with built-in payroll do cloud-first startups use?" },
    { cluster: "cloud accounting software", text: "What's the cheapest accounting software that's still good?" },
    { cluster: "accounting software for nonprofits", text: "What accounting software do nonprofits recommend?" },
    { cluster: "accounting software for nonprofits", text: "Which is better for a nonprofit, Ledgerline or Brightbook?" },
  ]);
  assert.deepEqual([s.page1.num, s.page1.den, s.page1Before], [5, 9, 3], "5 of 9 on page 1, was 3");
  // The board averages 9.7 with c9 at #23; the fixture keeps #23 unranked. 8 Oct 2026 (audit data-7): unranked
  // counts as #21, so 9.4 (it was the eight ranked alone, 8 - better for every keyword that dropped out).
  assert.equal(s.page1.avg, 9.4);
  assert.deepEqual([s.page1.ranked, s.page1.unranked], [8, 1]);
  assert.deepEqual(s.offPage1, ["invoicing software", "bookkeeping software", "cloud accounting software"]);
});

test("the cluster chart counts what the card and heat row count (T4b part 5a)", () => {
  const input = { ...fx.data, range, before: comparisonRange(range, "prev"), today: fx.today, engines: ["google_aio", "chatgpt", "gemini", "perplexity"] };
  const first = clusterChart(input, "c1")!;
  const card1 = cards.find((c) => c.id === "c1")!;
  assert.equal(first.days.length, 28);
  assert.deepEqual(first.named, card1.heat, "top panel and heat row agree day for day");
  assert.equal(first.named.reduce((s, r) => s + (r?.num ?? 0), 0), card1.now.num);
  assert.equal([...first.google].reverse().find((p) => p !== null), card1.position, "last Google reading is the card's position");
  assert.equal(first.namedBefore?.length, 28, "a live cluster has a previous period");
  const added = clusterChart(input, "c9")!;
  assert.equal(added.namedBefore, null, "a cluster added mid-range has no previous period");
  assert.equal(added.named[0], null, "before its first check a day is a gap, not a zero");
  const pending = clusterChart(input, "c10")!;
  assert.ok(pending.named.every((r) => r === null), "a pending cluster has no readings");
  assert.equal(clusterChart(input, "nope"), null);
});

test("summary with no comparison has no like-for-like change or 'was' figures", () => {
  const s = clusterSummary(clusterCards({ ...fx.data, range, before: null, today: fx.today, engines: ["google_aio"] }));
  assert.equal(s.lflBefore, null);
  assert.equal(s.lflDelta, null);
  assert.equal(s.promptsNamedBefore, null);
  assert.equal(s.page1Before, null);
});

test("T6 filters: all 10, naming you 9 and with prompts that never name you 3, as the board counts; search matches keyword or prompt", () => {
  assert.equal(filterClusters(cards, "all", "").length, 10);
  assert.equal(filterClusters(cards, "named", "").length, 9, "every checked cluster names Tallyroo somewhere");
  assert.deepEqual(filterClusters(cards, "never", "").map((c) => c.id), ["c4", "c8", "c9"]);
  assert.deepEqual(filterClusters(cards, "all", "  PAYROLL ").map((c) => c.id), ["c8", "c10"], "c10's keyword and a c8 prompt about payroll");
  assert.ok(filterClusters(cards, "all", "ledgerline").length > 1, "a prompt naming a rival matches, not only the keyword");
  assert.ok(!filterClusters(cards, "named", "payroll").some((c) => c.id === "c10"), "a pending cluster is in all only");
  assert.ok(!filterClusters(cards, "never", "").some((c) => c.status === "pending"));
});

test("DS55: the Clusters search narrows ungrouped prompts on their text, as it does a cluster's", () => {
  const rows = fx.data.questions.map((q) => ({ ...q, cluster_id: null }));
  assert.equal(searchPrompts(rows, "").length, rows.length, "no search keeps every row");
  assert.equal(searchPrompts(rows, "   ").length, rows.length);
  const hits = searchPrompts(rows, "  PAYROLL ");
  assert.ok(hits.length > 0 && hits.length < rows.length, "fixture has no payroll prompt, or only payroll prompts");
  assert.ok(hits.every((r) => /payroll/i.test(r.text)));
  assert.equal(searchPrompts(rows, "zzz-no-such-prompt").length, 0);
});

test("T6 search: ?q= is cut to APP_LIMITS.search (120) before it is used", () => {
  assert.equal(clusterSearch(null), "");
  assert.equal(clusterSearch("x".repeat(500)).length, 120);
});

test("T7 summary: cluster 1's most reliable engine and its earlier Google reading match detail.py", () => {
  // dataset.py, 30 Sep 2026: c1 days named per engine, summed over its 5 prompts = [58, 63, 50, 62] of 140; posPrev #7.
  const input = { ...fx.data, range, before: comparisonRange(range, "prev"), today: fx.today, engines: ["google_aio", "chatgpt", "gemini", "perplexity"] };
  const d = clusterDetail(input, "c1")!;
  assert.equal(d.card.id, "c1");
  assert.deepEqual([d.reliable?.engine, d.reliable?.rate.num, d.reliable?.rate.den], ["chatgpt", 63, 140]);
  assert.equal(d.card.positionBefore, 7);
  assert.ok(d.positionBeforeOn && d.positionBeforeOn < range.from, "the earlier reading's day is in the comparison range");
  assert.equal(clusterDetail(input, "not-a-cluster"), null);
  // A pending cluster has no readings, so no engine to name.
  const pending = cards.find((c) => c.status === "pending")!;
  assert.equal(clusterDetail(input, pending.id)!.reliable, null);
});

test("T7 strip: cluster 1's second prompt, day by day per engine, matches detail.py", () => {
  // dataset.py, 30 Sep 2026: c1 prompt 2, days[engine][day] over 28 days; h = [13, 18, 14, 18] of 28.
  const board = ["0110010110101010110101000001", "0110010101110101101110111101", "1100100001000010111101001111", "1101010011011110100110101111"];
  const engines = ["google_aio", "chatgpt", "gemini", "perplexity"];
  const prompt = by("c1").prompts[1]!;
  const rows = promptStrip({ answers: fx.data.answers, range, engines }, prompt.id);
  assert.deepEqual(rows.map((r) => r.engine), engines);
  assert.deepEqual(rows.map((r) => r.cells.map((c) => (c ? "1" : "0")).join("")), board);
  assert.deepEqual(rows.map((r) => [r.named, r.answered]), [[13, 28], [18, 28], [14, 28], [18, 28]]);
  // The strip's totals are T6's day counts for the same prompt.
  assert.deepEqual(rows.map((r) => r.named), prompt.daysNamed.map((d) => d.days));
  // A prompt with no answers draws empty cells, never "not named".
  assert.ok(promptStrip({ answers: [], range, engines }, prompt.id).every((r) => r.cells.every((c) => c === null) && r.answered === 0));
});

test("promptIndex: ?prompt= picks 0-4 of the cluster's prompts, anything else is the first (T7 part 2b)", () => {
  assert.equal(promptIndex("1", 5), 1);
  assert.equal(promptIndex("4", 5), 4);
  assert.equal(promptIndex("4", 4), 0);
  for (const bad of [undefined, "", "-1", "1.5", "12", "x", ["1", "2"]]) assert.equal(promptIndex(bad, 5), 0);
  // Review of 95a8747 (9 Oct 2026): five live prompts and five or more stopped in the range pass ten.
  assert.equal(promptIndex("10", 11), 10);
  assert.equal(promptIndex("12", 13), 12);
  assert.equal(promptIndex("10", 10), 0, "past the last is the first");
  assert.equal(promptIndex("100", 120), 0, "three digits is not an index");
  assert.equal(promptIndex("07", 10), 7);
});

test("T7 brands: answers naming each brand for one prompt, the client always listed (part 3a)", () => {
  const prompt = by("c1").prompts[1]!;
  const b = promptBrands({ answers: fx.data.answers, range }, prompt.id, "Tallyroo");
  // 4 engines x 28 days; the client's row is the card's named answers for this prompt.
  assert.equal(b.answers, prompt.now.den);
  assert.equal(b.rows.find((r) => r.you)!.n, prompt.now.num);
  assert.ok(b.rows.length <= 4 && b.rows.every((r) => r.n <= b.answers));
  assert.deepEqual(b.rows.map((r) => r.n), [...b.rows.map((r) => r.n)].sort((x, y) => y - x));
  // Stub: a brand twice in one answer counts once; another prompt's and an unanswered row count nowhere; on a tie the client stays ahead.
  const r = { from: "2026-09-01", to: "2026-09-02" };
  const row = (q: string, answered: boolean, named: boolean, brands: string[]) => ({ run_date: "2026-09-01", question_id: q, engine: "chatgpt", answered, named, brands });
  const s = promptBrands({ answers: [row("p", true, false, ["Acme", "acme", "Zed"]), row("p", true, true, ["Zed"]), row("p", false, false, ["Acme"]), row("x", true, false, ["Acme"])], range: r }, "p", "Me");
  assert.deepEqual(s, { answers: 2, rows: [{ name: "Zed", you: false, n: 2 }, { name: "Me", you: true, n: 1 }, { name: "Acme", you: false, n: 1 }] });
});

test("8 Oct 2026 (audit data-6): a prompt's brands leave out an answer whose other brands were not read, the client's mention included", () => {
  const r = { from: "2026-09-01", to: "2026-09-02" };
  const row = (named: boolean, brands: string[], brands_ok?: boolean) => ({ run_date: "2026-09-01", question_id: "p", engine: "chatgpt", answered: true, named, brands, ...(brands_ok === undefined ? {} : { brands_ok }) });
  const read = [row(false, ["Zed"]), row(true, ["Zed"])];
  const clean = promptBrands({ answers: read, range: r }, "p", "Me");
  assert.deepEqual(promptBrands({ answers: [...read, row(true, [], false)], range: r }, "p", "Me"), clean);
  assert.deepEqual(clean, { answers: 2, rows: [{ name: "Zed", you: false, n: 2 }, { name: "Me", you: true, n: 1 }] });
});

test("8 Oct 2026 (audit data-1): a past range counts only the clusters, prompts and keywords that existed in it", () => {
  // c9 (5 prompts, k9) started 16 Sep and c10 starts tomorrow; August knew neither.
  const aug = { from: "2026-08-05", to: "2026-09-01" };
  const august = clusterCards({ ...fx.data, range: aug, before: null, today: fx.today, engines: [] });
  assert.ok(!august.some((c) => c.id === "c9" || c.id === "c10"), "no card for a cluster that started after the range");
  const s = clusterSummary(august);
  assert.equal(s.clusters, 8);
  assert.equal(s.prompts, 40);
  assert.equal(`${s.promptsNamed.num} of ${s.promptsNamed.den}`, "37 of 40");
  assert.equal(s.page1.den, 8);
  // The flat path's keyword count, for an ungrouped client.
  assert.equal(keywordsIn(fx.data.keywords, aug), 8);
  assert.equal(keywordsIn(fx.data.keywords, { from: addDays(fx.today, -27), to: fx.today }), 9, "tomorrow's k10 is not counted today");
});

test("8 Oct 2026 (audit data-1): a prompt added for tomorrow is listed but counts in no denominator", () => {
  const range = { from: addDays(fx.today, -27), to: fx.today };
  const before = { from: addDays(fx.today, -55), to: addDays(fx.today, -28) };
  const base = clusterSummary(clusterCards({ ...fx.data, range, before, today: fx.today, engines: [] }));
  const tomorrow = addDays(fx.today, 1);
  const added = { ...fx.data.questions.find((q) => q.cluster_id === "c1")!, id: "q1-new", text: "A prompt asked from tomorrow", added_on: tomorrow, stopped_on: null };
  const cards = clusterCards({ ...fx.data, questions: [...fx.data.questions, added], range, before, today: fx.today, engines: [] });
  const c1 = cards.find((c) => c.id === "c1")!;
  assert.ok(c1.prompts.some((p) => p.id === "q1-new" && p.pending), "listed as pending");
  assert.equal(c1.promptsNamed.den, cards.find((c) => c.id === "c1")!.prompts.filter((p) => !p.pending).length);
  const s = clusterSummary(cards);
  assert.equal(s.promptsNamed.den, base.promptsNamed.den, "the headline denominator does not move for tomorrow's prompt");
  assert.deepEqual(s.promptsNamedBefore, base.promptsNamedBefore, "the 'was' line is kept");
});

test("8 Oct 2026 (audit data-4): prompts named and page 1 change like-for-like - 37 of 40 both periods is no change, and page 1 is 8 clusters on both sides", () => {
  const s = clusterSummary(cards);
  // The strip read "40 of 45, was 37 of 40": the 3 were c9's prompts, added 16 Sep.
  assert.deepEqual([s.promptsNamed.num, s.promptsNamed.den], [40, 45], "the figure counts every prompt read");
  assert.deepEqual([s.promptsNamedLfl?.num, s.promptsNamedLfl?.den], [37, 40]);
  assert.deepEqual([s.promptsNamedBefore?.num, s.promptsNamedBefore?.den], [37, 40]);
  assert.equal(s.promptsNamedLfl!.num - s.promptsNamedBefore!.num, 0, "no change");
  assert.deepEqual([s.page1Lfl, s.page1Before], [5, 3]);
  // c9 (added 16 Sep) put on page 1: the figure gains it, the change does not - it took 'now' over 9 and 'before' over 8.
  const k9 = fx.data.clusters.find((c) => c.id === "c9")!.keyword_id!;
  const serp = [...fx.data.serp.filter((x) => x.keyword_id !== k9), ...fx.data.serp.filter((x) => x.keyword_id === k9).map((x) => ({ ...x, position: 6 }))];
  const up = clusterSummary(clusterCards({ ...fx.data, serp, range, before: comparisonRange(range, "prev"), today: fx.today, engines: [] }));
  assert.equal(up.page1.num, 6);
  assert.equal(up.page1Lfl! - up.page1Before!, 2, "a cluster added on page 1 is not a gain");
  // Without a comparison there is no like-for-like count either.
  assert.equal(clusterSummary(clusterCards({ ...fx.data, range, before: null, today: fx.today, engines: [] })).promptsNamedLfl, null);
});

/** The fixture with one keyword's readings from `from` on replaced by `position`. */
const serpWith = (keywordId: string, from: string, position: number | null) => fx.data.serp.map((x) => (x.keyword_id === keywordId && x.run_date >= from ? { ...x, position } : x));

test("8 Oct 2026 (audit data-7): a keyword leaving the top 20 is 'dropped', never 'New' or 'same as', and makes the average worse", () => {
  const before = comparisonRange(range, "prev");
  // k8, cloud accounting software, #13 on 1 Sep, unranked from 27 Sep.
  const serp = serpWith("k8", "2026-09-27", null);
  const dropped = clusterCards({ ...fx.data, serp, range, before, today: fx.today, engines: [] });
  const c8 = dropped.find((c) => c.id === "c8")!;
  assert.deepEqual([c8.status, c8.position, c8.positionRead, c8.positionBefore, c8.positionChange, c8.positionEvent], ["live", null, true, 13, null, "dropped"]);
  const detail = clusterDetail({ ...fx.data, serp, range, before, today: fx.today, engines: [] }, "c8")!;
  assert.equal(positionMove(detail.card, detail.positionBeforeOn), ", down from #13 on 1 Sep");
  // The average counted only the ranked: 8 with k8 at #14, 7.1 with it gone. Unranked counts as #21 now.
  const base = clusterSummary(cards).page1.avg!;
  const worse = clusterSummary(dropped).page1.avg!;
  assert.ok(worse > base, `average ${base} -> ${worse} when #14 drops out`);
  assert.equal(worse, 10.2);
  // A keyword drop from #11 (k3) is worse too, not better.
  assert.ok(clusterSummary(clusterCards({ ...fx.data, serp: serpWith("k3", "2026-09-27", null), range, before, today: fx.today, engines: [] })).page1.avg! > base);
});

test("8 Oct 2026 (audit data-7): a keyword entering the top 20 is 'entered'; one out of it both periods is 'unranked'; positionMove never says 'same as'", () => {
  const before = comparisonRange(range, "prev")!;
  // k3, invoicing software, unranked through the previous period, ranked now.
  const entered = clusterDetail({ ...fx.data, serp: fx.data.serp.map((x) => (x.keyword_id === "k3" && x.run_date <= before.to ? { ...x, position: null } : x)), range, before, today: fx.today, engines: [] }, "c3")!;
  assert.deepEqual([entered.card.positionBefore, entered.card.positionEvent], [null, "entered"]);
  assert.equal(positionMove(entered.card, entered.positionBeforeOn), ", up from outside the top 20 on 1 Sep");
  const out = clusterCards({ ...fx.data, serp: serpWith("k3", "2026-01-01", null), range, before, today: fx.today, engines: [] }).find((c) => c.id === "c3")!;
  assert.equal(out.positionEvent, "unranked");
  // Every card's line, and a null change of every kind: "unchanged from" only at 0, never "same as".
  for (const c of cards) assert.doesNotMatch(positionMove(c, "2026-09-01"), /same as/, c.id);
  assert.equal(positionMove(by("c5"), "2026-09-01"), ", unchanged from #3 on 1 Sep", "c5 held #3");
  assert.equal(positionMove({ positionEvent: null, positionChange: null, positionBefore: 13 }, "2026-09-01"), "");
  assert.equal(positionMove({ positionEvent: "dropped", positionChange: null, positionBefore: 13 }, null), "", "no comparison reading, no line");
  assert.equal(by("c1").positionEvent, null, "a ranked keyword's change is places");
});

test("8 Oct 2026 (audit data-10): a young client's clusters change against its first week", () => {
  const y = fixtureState(fx, { TRACKING_FIXTURE_STATE: "young" });
  const r = { from: addDays(y.today, -27), to: y.today };
  const cmp = resolveComparison(r, "prev", y.client.started_on);
  assert.equal(cmp.kind, "start");
  const young = clusterCards({ ...y.data, range: r, before: cmp.range, today: y.today, engines: [] });
  const live = young.filter((c) => c.status === "live");
  assert.ok(live.length >= 8, `${live.length} clusters tracked since the first week`);
  assert.ok(live.every((c) => c.delta !== null), "every one has a change against its first week (it read 'New' on every card)");
  const s = clusterSummary(young);
  assert.ok(s.lflDelta !== null && s.promptsNamedLfl && s.page1Lfl !== null);
  // Review of data-10 (8 Oct 2026): the one-cluster page's line under "Answers naming you" said "43% the one
  // before" of a first week seven days inside this period. Against the first week it says so.
  const c1 = clusterDetail({ ...y.data, range: r, before: cmp.range, today: y.today, engines: ["google_aio", "chatgpt", "gemini", "perplexity"] }, "c1")!.card;
  assert.equal(periodPair(c1.now, c1.before, cmp.kind), "45% this period, 43% in your first week");
  assert.equal(periodPair(c1.now, c1.before, "prev"), "45% this period, 43% the one before", "an earlier period keeps its words");
  assert.equal(periodPair(c1.now, null, null), "45% this period");
  // 18 Oct 2026, brief 2d: the page half (OneCluster.tsx saying it through periodPair) retired with /app; every /app
  // address 308s to the dashboards host, which does not draw this line. periodPair's own wording above still holds.
});

test("8 Oct 2026 (review of audit data-4): the key-figure chips the Overview prints, by cluster and flat", () => {
  const r = { from: addDays(fx.today, -27), to: fx.today };
  const strip = (data: typeof fx.data) => {
    const o = overview({ range: r, compare: "prev", startedOn: fx.client.started_on, engines: [], questions: data.questions, answers: data.answers, serp: data.serp, keywordCount: keywordsIn(data.keywords, r), keywords: data.keywords });
    const grouped = !!data.clusters?.length && data.questions.some((q) => q.cluster_id);
    const cs = grouped ? clusterSummary(clusterCards({ ...data, range: r, before: o.compare, today: fx.today, engines: [] })) : null;
    const byCluster = cs && !ungroupedRead(data.questions, data.answers, r) ? cs : null;
    return { o, cs, byCluster, chg: keyFigureChanges(o, cs, byCluster) };
  };
  // By cluster: "40 of 45" with the like-for-like 37 of 40 in both periods - no change, where it read "was 37 of 40".
  const d = strip(fx.data);
  assert.ok(d.byCluster);
  assert.deepEqual({ ...d.chg, prompts: null }, { named: 3, prompts: null, promptsLine: "like-for-like 37 of 40, no change", sov: 2, page1: 2 });
  assert.equal(d.chg.named, d.byCluster.lflDelta, "the headline's chip");
  assert.equal(d.chg.page1, d.cs!.page1Lfl! - d.cs!.page1Before!, "page 1 on the clusters tracked all period");
  // Flat (no prompt grouped): the chip is the headline's +3; it read +2, the all-prompts change, under a +3 headline.
  const u = strip(fixtureState(fx, { TRACKING_FIXTURE_STATE: "ungrouped" }).data);
  assert.equal(u.cs, null);
  assert.equal(u.chg.named, 3);
  assert.equal(u.chg.named, pointsDelta(u.o.lfl!.now, u.o.lfl!.before));
  assert.notEqual(pointsDelta(u.o.named, u.o.namedBefore!), u.chg.named, "the all-prompts change it read before");
  assert.equal(u.chg.page1, u.o.change!.keywords!.now - u.o.change!.keywords!.before);
  // The prompts line's other wordings.
  const line = (now: [number, number], before: [number, number]) =>
    keyFigureChanges({ lfl: null, change: null }, null, { ...d.byCluster!, promptsNamedLfl: { num: now[0], den: now[1], pct: null }, promptsNamedBefore: { num: before[0], den: before[1], pct: null } }).promptsLine;
  assert.equal(line([38, 40], [37, 40]), "like-for-like 38 of 40, was 37");
  assert.equal(line([38, 40], [37, 41]), "like-for-like 38 of 40, was 37 of 41");
  // 18 Oct 2026, brief 2d: the page half (the /app Overview printing these, not a copy of its own) retired with /app;
  // every /app address 308s to the dashboards host, which does not draw these chips. keyFigureChanges above still holds.
});
