import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { expandFixture, fixtureState } from "../../tracking/fixture-mode.ts";
import { type AnswerRow, addDays, namedRate, questionsNamed } from "../../tracking/figures.ts";
import {
  MAX_PAGE,
  PAGE_SIZE,
  type PromptRow,
  type RowsInput,
  addedFromWork,
  filterRows,
  inSet,
  isChosen,
  originLabel,
  pageOf,
  pickAngle,
  pickDir,
  pickOrigin,
  pickPage,
  pickSort,
  promptRows,
  readAiKept,
  sortRows,
} from "./prompt-table.ts";

/**
 * The AI visibility prompt table (13 Oct 2026, DIY P4; spec 10 section 4.2
 * rows 5 and 6): n of m, the first-reading flag, the missing lens,
 * origin=chosen, the pickers' bounds, and the fixture.
 */

const ENGINES = ["google_aio", "chatgpt", "gemini", "perplexity"];
const day = (n: number) => `2026-10-${String(n).padStart(2, "0")}`;
const a = (d: number, q: string, engine: string, named: boolean, over: Partial<AnswerRow> = {}): AnswerRow => ({ run_date: day(d), question_id: q, engine, answered: true, named, brands: named ? ["Tallyroo"] : [], ...over });

const input = (answers: AnswerRow[], over: Partial<RowsInput> = {}): RowsInput => ({
  prompts: [
    { id: "q1", text: "best invoicing app for freelancers", cluster_id: "c1", angle: "category", added_on: day(1), stopped_on: null },
    { id: "q2", text: "invoicing app accountants recommend", cluster_id: "c1", angle: "positioning", added_on: day(1), stopped_on: null },
    { id: "q3", text: "best payroll for sole traders", cluster_id: "c2", angle: "category", added_on: day(13), stopped_on: null },
    { id: "q4", text: "cheap bookkeeping app", cluster_id: null, angle: null, added_on: day(1), stopped_on: null },
    { id: "q5", text: "tomorrow's prompt", cluster_id: "c2", angle: "sector", added_on: day(15), stopped_on: null },
  ],
  clusters: [
    { id: "c1", label: "invoicing software" },
    { id: "c2", label: "payroll for sole traders" },
  ],
  answers,
  range: { from: day(1), to: day(14) },
  loadedFrom: day(1),
  engines: ENGINES,
  origins: new Map([["q2", "placement"], ["q3", "opportunity"], ["q4", "client"]]),
  brand: "Tallyroo",
  domain: "tallyroo.com",
  ...over,
});

const rowOf = (rows: PromptRow[], id: string) => rows.find((r) => r.id === id)!;

test("n of m engines at the latest check, an engine that did not answer left out of m, and 'was' at the first", () => {
  const rows = promptRows(
    input([
      a(10, "q1", "google_aio", false),
      a(10, "q1", "chatgpt", false),
      a(10, "q1", "gemini", true),
      a(10, "q1", "perplexity", false),
      a(14, "q1", "google_aio", false, { answered: false }),
      a(14, "q1", "chatgpt", true),
      a(14, "q1", "gemini", true),
      a(14, "q1", "perplexity", false),
    ]),
  );
  const r = rowOf(rows, "q1");
  assert.deepEqual(r.latest, { day: day(14), named: 2, of: 3 }, "Google's silence is out of m");
  assert.deepEqual(r.from, { day: day(10), named: 1, of: 4 });
  // Like for like: the three engines that answered both days; ChatGPT now names you, the others as they were.
  assert.equal(r.change, 1);
  assert.deepEqual([r.answers.num, r.answers.den], [3, 7]);
  assert.equal(r.aio, "none", "the Overview did not show");
  assert.equal(r.first, false);
  assert.equal(r.index, 0);
  assert.equal(r.clusterLabel, "invoicing software");
  // The prompt not asked yet is not a row; the stopped-before-range one would not be either.
  assert.deepEqual(rows.map((x) => x.id), ["q1", "q2", "q3", "q4"]);
  assert.equal(rowOf(rows, "q4").clusterId, null);
  assert.equal(rowOf(rows, "q4").index, null);
});

test("a row's ?prompt= is its place on the cluster card, a prompt starting tomorrow included (review of P4, 13 Oct 2026)", () => {
  // On a range ending today the card lists tomorrow's prompt too (cluster-figures.ts clusterCards, `current`); here it sorts first.
  const cards = [
    { id: "c1", label: "invoicing software", prompts: ["q1", "q2"] },
    { id: "c2", label: "payroll for sole traders", prompts: ["q5", "q3"] },
  ];
  const rows = promptRows(input([a(14, "q3", "chatgpt", true)], { clusters: cards }));
  assert.equal(rowOf(rows, "q3").index, 1, "the card's place, not the place among prompts already asked");
  assert.equal(rowOf(rows, "q2").index, 1);
  // With no card list, the old reading stands (the range's prompts in order).
  assert.equal(rowOf(promptRows(input([a(14, "q3", "chatgpt", true)])), "q3").index, 0);
});

test("an engine picked with ?eng= is the only one counted", () => {
  const rows = promptRows(input([a(10, "q1", "chatgpt", false), a(10, "q1", "gemini", true), a(14, "q1", "chatgpt", true), a(14, "q1", "gemini", true)], { engines: ["chatgpt"] }));
  const r = rowOf(rows, "q1");
  assert.deepEqual([r.latest, r.from, r.change, r.answers.num, r.answers.den, r.aio], [{ day: day(14), named: 1, of: 1 }, { day: day(10), named: 0, of: 1 }, 1, 1, 2, null]);
});

test("a first reading is shown, never scored", () => {
  const rows = promptRows(input([a(14, "q3", "chatgpt", true), a(14, "q3", "gemini", false), a(14, "q3", "google_aio", true)]));
  const r = rowOf(rows, "q3");
  assert.equal(r.first, true);
  assert.deepEqual(r.latest, { day: day(14), named: 2, of: 3 });
  assert.equal(r.from, null);
  assert.equal(r.change, null);
  assert.equal(r.aio, "named");
  // One reading of a prompt added before what was read is not its first: it has readings this read does not hold.
  assert.equal(rowOf(promptRows(input([a(14, "q3", "chatgpt", true)], { loadedFrom: day(14) })), "q3").first, false);
});

test("the missing lens: others named in the range, the client never", () => {
  const rows = promptRows(
    input([
      a(10, "q1", "chatgpt", false, { brands: ["Ledgerline"] }),
      a(11, "q1", "gemini", false, { brands: [] }),
      a(10, "q2", "chatgpt", false, { brands: ["Brightbook"] }),
      a(11, "q2", "gemini", true),
      // Only the client's own spelling, or brands not read: not "others".
      a(10, "q4", "chatgpt", false, { brands: ["TallyRoo"] }),
      a(11, "q4", "gemini", false, { brands: ["Sumly"], brands_ok: false }),
    ]),
  );
  assert.deepEqual(rows.filter((r) => r.missing).map((r) => r.id), ["q1"]);
  const f = { cluster: null, angle: null, origin: null, missing: true, q: "" };
  assert.deepEqual(filterRows(rows, f).map((r) => r.id), ["q1"]);
});

test("origin=chosen: setup, the client's own, nomada's and legacy prompts; never placement, opportunity or momentum", () => {
  const rows = promptRows(input([]));
  const chosen = rows.filter((r) => inSet(r, { cluster: null, angle: null, origin: "chosen" })).map((r) => r.id);
  assert.deepEqual(chosen, ["q1", "q4"], "q1 has no origin row (legacy), q4 is the client's");
  assert.deepEqual(rows.filter((r) => inSet(r, { cluster: null, angle: null, origin: "placement" })).map((r) => r.id), ["q2"]);
  for (const o of ["setup", "client", "nomada"] as const) assert.ok(isChosen(o));
  for (const o of ["placement", "opportunity", "momentum"] as const) assert.ok(!isChosen(o));
  assert.ok(isChosen(null));
  // With the origins not wired yet (an empty map), every prompt is chosen.
  assert.equal(promptRows(input([], { origins: new Map() })).filter((r) => inSet(r, { cluster: null, angle: null, origin: "chosen" })).length, 4);
});

test("filters: cluster, angle and search together", () => {
  const rows = promptRows(input([]));
  assert.deepEqual(filterRows(rows, { cluster: "c1", angle: null, origin: null, missing: false, q: "" }).map((r) => r.id), ["q1", "q2"]);
  assert.deepEqual(filterRows(rows, { cluster: null, angle: "category", origin: null, missing: false, q: "" }).map((r) => r.id), ["q1", "q3"]);
  assert.deepEqual(filterRows(rows, { cluster: null, angle: null, origin: null, missing: false, q: "  PAYROLL " }).map((r) => r.id), ["q3"]);
});

test("sort: a fixed key, rows with nothing to sort by last either way, ties in cluster order", () => {
  const rows = promptRows(input([a(14, "q1", "chatgpt", true), a(14, "q2", "chatgpt", false), a(14, "q4", "chatgpt", true), a(13, "q4", "chatgpt", false)]));
  assert.deepEqual(sortRows(rows, "named", "desc").map((r) => r.id), ["q1", "q4", "q2", "q3"]);
  assert.deepEqual(sortRows(rows, "named", "asc").map((r) => r.id), ["q2", "q4", "q1", "q3"]);
  assert.deepEqual(sortRows(rows, "prompt", "asc").map((r) => r.id), ["q1", "q3", "q4", "q2"]);
  assert.deepEqual(sortRows(rows, "cluster", "desc").map((r) => r.id), ["q4", "q3", "q2", "q1"]);
});

test("the pickers are whitelists and clamps", () => {
  assert.equal(pickAngle("sector"), "sector");
  assert.equal(pickAngle("<script>"), null);
  assert.equal(pickOrigin("chosen"), "chosen");
  assert.equal(pickOrigin("momentum"), "momentum");
  assert.equal(pickOrigin("scan"), null);
  assert.equal(pickSort("change"), "change");
  assert.equal(pickSort("score"), "cluster");
  assert.equal(pickDir("desc"), "desc");
  assert.equal(pickDir("DESC"), "asc");
  assert.equal(pickPage("3"), 3);
  assert.equal(pickPage("0"), 1);
  assert.equal(pickPage("99"), MAX_PAGE);
  assert.equal(pickPage("2.5"), 1);
  assert.equal(pickPage(null), 1);
  assert.equal(PAGE_SIZE, 100);
  const many = Array.from({ length: 250 }, (_, i) => i);
  assert.deepEqual([pageOf(many, 3).rows.length, pageOf(many, 3).page, pageOf(many, 3).pages], [50, 3, 3]);
  assert.equal(pageOf(many, 9).page, 3, "clamped to the last page there is");
  assert.deepEqual(pageOf([], 1), { rows: [], page: 1, pages: 1 });
});

test("origin chips' words, and agency mode never names nomada", () => {
  assert.deepEqual(
    (["setup", "client", "nomada", "placement", "opportunity", "momentum", null] as const).map((o) => originLabel(o, "nomada")),
    // Review of P4 (13 Oct 2026): no recorded origin is no chip, never "Setup".
    ["Setup", "You", "nomada digital", "Placement", "Opportunity", "Momentum", null],
  );
  assert.equal(originLabel("nomada", "agency"), "Your account contact");
});

test("the Overview's basis line: only when prompts from work are live", () => {
  const origins = new Map([["a", "placement"], ["b", "opportunity"], ["c", "opportunity"], ["d", "client"], ["e", "momentum"]]);
  assert.deepEqual(addedFromWork(origins, ["a", "b", "c", "d"]), { count: 3, text: "Includes 3 prompts added from placements and opportunities." });
  assert.deepEqual(addedFromWork(origins, ["e", "a"]), { count: 2, text: "Includes 2 prompts added from placements and rising keywords." });
  assert.deepEqual(addedFromWork(origins, ["b"]), { count: 1, text: "Includes 1 prompt added from opportunities." });
  assert.equal(addedFromWork(origins, ["d", "z"]), null);
  assert.equal(addedFromWork(new Map(), ["a"]), null);
});

test("on the fixture: the table's counts are figures.ts's, per prompt and over the set", () => {
  const fx = expandFixture(JSON.parse(readFileSync(new URL("../../tracking/fixture.json", import.meta.url), "utf8")));
  for (const state of ["default", "partial", "young"]) {
    const d = fixtureState(fx, { TRACKING_FIXTURE_STATE: state }).data;
    const range = { from: addDays(fx.today, -27), to: fx.today };
    const rows = promptRows({
      prompts: d.questions,
      clusters: d.clusters.map((c) => ({ id: c.id, label: c.name })),
      answers: d.answers,
      range,
      loadedFrom: addDays(range.from, -28),
      engines: ENGINES,
      origins: new Map(),
      brand: fx.client.brand,
      domain: fx.client.domain,
    });
    assert.ok(rows.length >= 40, `${state}: ${rows.length} rows`);
    for (const r of rows) {
      const n = namedRate(d.answers, range, new Set([r.id]));
      assert.deepEqual([r.answers.num, r.answers.den], [n.num, n.den], `${state} ${r.id}`);
      assert.ok(!r.latest || r.latest.named <= r.latest.of, `${state} ${r.id}: n of m`);
    }
    // "Prompts you are named in" over the set is questionsNamed's.
    const q = questionsNamed(d.answers, range);
    assert.equal(rows.filter((r) => r.answers.num > 0).length, q.num, state);
  }
});

test("the /ai view a hide or ask returns to: each key through its page's bound, the rest dropped (review of P4, 13 Oct 2026)", () => {
  const q = (o: Record<string, string>) => (k: string) => o[k] ?? null;
  const good = { from: "2026-09-02", to: "2026-09-29", compare: "month", cluster: "c1", angle: "category", origin: "chosen", eng: "chatgpt", lfl: "1", missing: "1", q: "invoicing", sort: "named", dir: "desc", page: "2" };
  assert.deepEqual(readAiKept(q(good), 120), good);
  const bad = { from: "2 Sep", to: "<script>", compare: "prev", cluster: "c1;drop", angle: "price", origin: "everyone", eng: "bing", lfl: "yes", missing: "0", sort: "random", dir: "up", page: "99", filter: "never", hid: "1", ask: "sent", next: "https://evil.example" };
  assert.deepEqual(readAiKept(q(bad), 120), {});
  assert.equal(readAiKept(q({ q: "x".repeat(300) }), 120).q!.length, 120);
});
