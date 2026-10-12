import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { clusterCards, clusterChart, clusterDetail, promptBrands, promptStrip } from "./cluster-figures.ts";
import { type Range, addDays, brandGaps, comparisonRange, firstCheckDay, resolveComparison } from "./figures.ts";
import { type Fixture, expandFixture, fixtureState } from "./fixture-mode.ts";
import type { OverviewData } from "./overview-data.ts";
import { chartSeries, citeRows, placementsView } from "./placement-figures.ts";
import { placementFirstCited } from "../diy/prompts/placement-lines.ts";
import { urlKey } from "./placements.ts";
import { presets } from "./date-range.ts";
import { PAGE } from "../supabase/page.ts";
import { ANSWER_SELECT, DAY_SELECT, type AnswersQuery, type AnswersTable, type DayQuery, type DayTable, type ReadOpts, type StoredAnswer, answerPlan, answerRow, boundStated, clusterQuestionIds, dayPlan, monthSlice, planPrompts, rangeFloor, readAnswerDay, readAnswers, reportSpan, selectColumns, shapeAnswerDay, shapeRead, withoutBrandsOk } from "./read-shape.ts";
import { monthFigures, reportMonths } from "./report-months.ts";
import { askedOnFor, runNote } from "./run-note.ts";

/**
 * The narrow reads (8 Oct 2026, audit perf-4, perf-9, perf-1). Each page on
 * a narrow read is held to draw exactly what it drew on the whole read, on
 * every fixture state with readings: Reports' monthly cards on verdicts only
 * and one month at a time, the one-cluster page on its own prompts, and
 * Placements on its cluster's prompts without brands. The census at the end
 * names the figures those pages draw from their answers, so a new one has to
 * be checked here before it can read a column the page no longer asks for.
 */

const base = expandFixture(JSON.parse(readFileSync(new URL("./fixture.json", import.meta.url), "utf8")));
// young and brands-unread added 8 Oct 2026 (merge of audit packages A, B and C): the first-week comparison
// (audit data-10) must sit inside the read, and an unread brand answer must read the same on a narrow read.
const STATES = ["default", "long", "partial", "failed", "stopped", "uncited", "pilot-mixed", "ungrouped", "new", "young", "brands-unread"];
const fixtures: [string, Fixture][] = STATES.map((s) => [s, fixtureState(base, { TRACKING_FIXTURE_STATE: s })]);
const engines = [...new Set(base.data.answers.map((a) => a.engine))];

/** What the Supabase read returns for a range: the fixture holds every day, the database only the ones asked for. */
function within(data: OverviewData, r: Range): OverviewData {
  const keep = (d: string) => d >= r.from && d <= r.to;
  return { ...data, answers: data.answers.filter((a) => keep(a.run_date)), serp: data.serp.filter((s) => keep(s.run_date)) };
}

test("the shapes select what they say, and an emptied column reads as an empty list", () => {
  assert.match(ANSWER_SELECT.full, /\bbrands\b.*\bcitations\b/);
  assert.doesNotMatch(ANSWER_SELECT.cites, /\bbrands\b/);
  assert.match(ANSWER_SELECT.cites, /\bcitations\b/);
  assert.doesNotMatch(ANSWER_SELECT.verdicts, /\bbrands\b|\bcitations\b/);
  for (const cols of Object.values(ANSWER_SELECT)) assert.match(cols, /^run_date, question_id, engine, answered, named\b/);

  const d = base.data;
  assert.deepEqual(shapeRead(d), d, "unshaped is the whole read");
  assert.deepEqual(shapeRead(d, { answers: "none" }).answers, []);
  assert.ok(shapeRead(d, { answers: "verdicts" }).answers.every((a) => a.brands.length === 0 && a.citations.length === 0));
  assert.ok(d.answers.some((a) => a.citations.length > 0), "the fixture cites nothing, so the cites case proves nothing");
  const cites = shapeRead(d, { answers: "cites" }).answers;
  assert.ok(cites.every((a) => a.brands.length === 0));
  assert.deepEqual(
    cites.map((a) => a.citations),
    d.answers.map((a) => a.citations),
  );
  const c1 = shapeRead(d, { cluster: "c1" });
  const ids = new Set(clusterQuestionIds(d.questions, "c1"));
  assert.equal(ids.size, d.questions.filter((q) => q.cluster_id === "c1").length);
  assert.ok(c1.answers.length > 0 && c1.answers.every((a) => ids.has(a.question_id)));
  assert.equal(c1.answers.length, d.answers.filter((a) => ids.has(a.question_id)).length);
  assert.deepEqual(c1.clusters, d.clusters, "every cluster is still read, for the page's N of M");
  assert.deepEqual(shapeRead(d, { cluster: "nope" }).answers, []);
});

/**
 * Review, 8 Oct 2026: the shaping is one decision (answerPlan, planPrompts)
 * and one read (readAnswers), taken by loadOverview and by the fixture's
 * shapeRead alike. Every equality test in this file runs on shapeRead, so
 * these hold the production read to it: the same function loadOverview calls,
 * on a fake PostgREST that serves the fixture's rows the way the real one
 * does - only the selected columns, only the filtered rows, by id, at most
 * PAGE at a time, with the exact count when asked.
 */
test("the plan: the shape's columns, the cluster's prompts, and no read at all for none", () => {
  assert.deepEqual(answerPlan({}), { select: ANSWER_SELECT.full, cluster: null });
  assert.deepEqual(answerPlan({ answers: "verdicts" }), { select: ANSWER_SELECT.verdicts, cluster: null });
  assert.deepEqual(answerPlan({ answers: "cites", cluster: "c1" }), { select: ANSWER_SELECT.cites, cluster: "c1" });
  assert.equal(answerPlan({ answers: "none" }), null);
  assert.equal(answerPlan({ answers: "none", cluster: "c1" }), null);
  const d = base.data;
  assert.equal(planPrompts(answerPlan({})!, d), null, "every prompt");
  assert.deepEqual(planPrompts(answerPlan({ cluster: "c1" })!, d), clusterQuestionIds(d.questions, "c1"));
  assert.deepEqual(planPrompts(answerPlan({ cluster: "nope" })!, d), [], "a cluster with no prompts reads nothing");
});

test("a column the select left out reads as an empty list, and a stray brand is dropped", () => {
  const row = { run_date: "2026-09-01", question_id: "q1", engine: "chatgpt", answered: true, named: false };
  assert.deepEqual(answerRow(row), { ...row, brands: [], citations: [] });
  assert.deepEqual(answerRow({ ...row, brands: ["Xero", 3, null], citations: null }).brands, ["Xero"]);
  const a = base.data.answers.find((x) => x.brands.length && x.citations.length)!;
  assert.deepEqual(answerRow(selectColumns(a, ANSWER_SELECT.full)), a);
  assert.deepEqual(answerRow(selectColumns(a, ANSWER_SELECT.cites)), { ...a, brands: [] });
  assert.deepEqual(answerRow(selectColumns(a, ANSWER_SELECT.verdicts)), { ...a, brands: [], citations: [] });
});

/** Two reads' rows equal, failing on the count or the first row that differs - a diff of thousands of rows takes a minute. */
function sameRows(got: readonly object[], want: readonly object[], what: string) {
  assert.equal(got.length, want.length, `${what}: row count`);
  const i = got.findIndex((g, k) => JSON.stringify(g) !== JSON.stringify(want[k]));
  if (i >= 0) assert.deepEqual(got[i], want[i], `${what}: row ${i}`);
}

/**
 * A fake PostgREST holding one client's tracking_answers, ids in fixture order. `lacks` is a column the table does
 * not have yet (review of the integration, 8 Oct 2026): a select naming it is refused as PostgREST refuses it (42703).
 */
function postgrest(rows: readonly object[], clientId: string, lacks?: string) {
  const calls: string[][] = [];
  const table: AnswersTable = () => ({
    select(columns, options) {
      const log = [`select ${columns}${options.count ? " (count)" : ""}`];
      calls.push(log);
      const keep: ((r: Record<string, unknown>) => boolean)[] = [];
      let byId = false;
      let [lo, hi] = [0, Number.MAX_SAFE_INTEGER];
      const q: AnswersQuery = {
        eq: (c, v) => (log.push(`eq ${c}`), keep.push(c === "client_domain_id" ? () => v === clientId : (r) => r[c] === v), q),
        gte: (c, v) => (log.push(`gte ${c}`), keep.push((r) => String(r[c]) >= v), q),
        lte: (c, v) => (log.push(`lte ${c}`), keep.push((r) => String(r[c]) <= v), q),
        in: (c, vs) => (log.push(`in ${c}`), keep.push((r) => vs.includes(r[c] as string)), q),
        order: (c) => (log.push(`order ${c}`), (byId = c === "id"), q),
        range: (a, b) => (([lo, hi] = [a, b]), q),
        then: (ok, fail) => {
          if (lacks && columns.split(",").some((c) => c.trim() === lacks)) return Promise.resolve({ data: null, error: { message: `column tracking_answers.${lacks} does not exist` }, count: null }).then(ok, fail);
          const all = rows.map((r, id) => ({ id, ...r })).filter((r) => keep.every((k) => k(r)));
          // Unordered, the planner's order is not the id order: reversed here, so a dropped order shows.
          const ordered = byId ? all : all.reverse();
          const data = ordered.slice(lo, Math.min(hi + 1, lo + PAGE)).map((r) => selectColumns(r, columns));
          return Promise.resolve({ data, error: null, count: options.count ? all.length : null }).then(ok, fail);
        },
      };
      return q;
    },
  });
  return { table, calls };
}

test("readAnswers, loadOverview's own read, returns on PostgREST exactly what shapeRead gives the fixture", async () => {
  let reads = 0;
  for (const state of ["default", "pilot-mixed", "ungrouped"]) {
    const f = fixtures.find(([s]) => s === state)![1];
    const db = postgrest(f.data.answers, f.client.id);
    const where = (r: Range) => ({ clientId: f.client.id, from: r.from, to: r.to });
    const ranges: Range[] = [{ from: addDays(f.today, -55), to: f.today }, { from: "2026-09-01", to: "2026-09-14" }];
    const clusters = [undefined, ...f.data.clusters.slice(0, 2).map((c) => c.id), "nope"];
    for (const answers of [undefined, "full", "cites", "verdicts", "none"] as const) {
      for (const cluster of clusters) {
        for (const r of ranges) {
          const opts: ReadOpts = { answers, cluster };
          const plan = answerPlan(opts);
          const want = within(shapeRead(f.data, opts), r).answers;
          const got = plan === null ? [] : await readAnswers(db.table, plan, planPrompts(plan, f.data), where(r));
          sameRows(got, want, `${state} ${answers ?? "unsaid"} ${cluster ?? "every cluster"} ${r.from}`);
          reads++;
        }
      }
    }
    const other = await readAnswers(db.table, answerPlan({})!, null, { ...where(ranges[0]), clientId: "someone-else" });
    assert.equal(other.length, 0, "another client's id reads none of these rows");
  }
  // 5 shapes x 2 ranges x (every cluster, up to two clusters, none): 40 on default, 30 on pilot-mixed's one cluster, 20 ungrouped.
  assert.ok(reads >= 90, `only ${reads} reads compared`);
});

test("readAnswers asks PostgREST for the plan's columns and, for one cluster, only its prompts", async () => {
  const f = fixtures[0][1];
  const r = { from: addDays(f.today, -55), to: f.today };
  const db = postgrest(f.data.answers, f.client.id);
  const plan = answerPlan({ answers: "cites", cluster: "c1" })!;
  const got = await readAnswers(db.table, plan, planPrompts(plan, f.data), { clientId: f.client.id, from: r.from, to: r.to });
  assert.ok(got.length > 0);
  assert.deepEqual(db.calls[0], [`select ${ANSWER_SELECT.cites} (count)`, "eq client_domain_id", "gte run_date", "lte run_date", "in question_id", "order id"]);
  assert.ok(db.calls.slice(1).every((c) => c[0] === `select ${ANSWER_SELECT.cites}` && c.includes("in question_id")), "a later page lost the filter");
  const all = postgrest(f.data.answers, f.client.id);
  const whole = await readAnswers(all.table, answerPlan({})!, null, { clientId: f.client.id, from: r.from, to: r.to });
  assert.ok(whole.length > PAGE, `${whole.length} rows is one page, so the paging went untested`);
  assert.ok(all.calls.length > 2 && all.calls.every((c) => !c.includes("in question_id")));
  const none = postgrest(f.data.answers, f.client.id);
  assert.deepEqual(await readAnswers(none.table, plan, [], { clientId: f.client.id, from: r.from, to: r.to }), []);
  assert.equal(none.calls.length, 0, "a cluster with no prompts asks for nothing");
});

/**
 * Review of the integration of audit packages A, B and C (8 Oct 2026): brands_ok arrives with 20261008020000, and
 * a deploy can land before it (AGENTS.md). Package A read the overview again without the column; the merge with
 * C's planned read dropped that, so every full-plan page threw until the migration was applied. On a table
 * without the column the full plan reads every row, each as read, as the rows written before it are.
 */
test("readAnswers reads again without brands_ok when the table does not have it yet, and every row reads as read", async () => {
  const strip = (rows: readonly object[]) => rows.map((a) => Object.fromEntries(Object.entries(a).filter(([k]) => k !== "brands_ok")));
  let rows = 0;
  for (const state of ["default", "brands-unread"]) {
    const f = fixtures.find(([s]) => s === state)![1];
    const r = { from: addDays(f.today, -55), to: f.today };
    const where = { clientId: f.client.id, from: r.from, to: r.to };
    // The table before 20261008020000: no brands_ok on any row, and a select naming it refused.
    const before = strip(f.data.answers);
    for (const cluster of [undefined, "c1"]) {
      const plan = answerPlan({ cluster })!;
      assert.match(plan.select, /\bbrands_ok\b/);
      const db = postgrest(before, f.client.id, "brands_ok");
      const got = await readAnswers(db.table, plan, planPrompts(plan, f.data), where);
      const want = within(shapeRead({ ...f.data, answers: before as OverviewData["answers"] }, { cluster }), r).answers;
      sameRows(got, want, `${state} ${cluster ?? "every cluster"}`);
      assert.ok(got.every((a) => !("brands_ok" in a)), "every row reads as read");
      assert.equal(db.calls[0]![0], `select ${ANSWER_SELECT.full} (count)`, "the plan's own columns first");
      assert.equal(db.calls[1]![0], "select run_date, question_id, engine, answered, named, brands, citations (count)", "then the same without brands_ok");
      assert.ok(db.calls.slice(1).every((c) => !c[0]!.includes("brands_ok")), "and no page after it names the column");
      if (cluster) assert.ok(db.calls.slice(1).every((c) => c.includes("in question_id")), "the retry keeps the cluster's prompts");
      rows += got.length;
    }
  }
  assert.ok(rows > PAGE * 2, `only ${rows} rows read`);
  // Once the column is there, the brands-unread state's unread answers come back unread.
  const u = fixtures.find(([s]) => s === "brands-unread")![1];
  const live = await readAnswers(postgrest(u.data.answers, u.client.id).table, answerPlan({})!, null, { clientId: u.client.id, from: addDays(u.today, -55), to: u.today });
  assert.ok(live.filter((a) => a.brands_ok === false).length >= 40);
  // Only brands_ok's absence is read past: another missing column, or a select that does not name brands_ok, throws.
  const f = fixtures[0][1];
  const where = { clientId: f.client.id, from: addDays(f.today, -6), to: f.today };
  await assert.rejects(readAnswers(postgrest(f.data.answers, f.client.id, "citations").table, answerPlan({})!, null, where), /column tracking_answers\.citations does not exist/);
  const odd = { select: "run_date, question_id, engine, answered, named, brands_ok_v2", cluster: null };
  await assert.rejects(readAnswers(postgrest(f.data.answers, f.client.id, "brands_ok_v2").table, odd, null, where), /brands_ok_v2 does not exist/, "a select without brands_ok is not retried");
  assert.equal(withoutBrandsOk(ANSWER_SELECT.full), "run_date, question_id, engine, answered, named, brands, citations");
  for (const cols of [ANSWER_SELECT.cites, ANSWER_SELECT.verdicts]) assert.equal(withoutBrandsOk(cols), cols, "the narrow shapes never name it");
});

/**
 * DB-2 (9 Oct 2026): the one-cluster page's answers panel reads one prompt's
 * answers at one check - `?day=`'s, or the latest with an answer. Its read
 * moved here from overview-data.ts so it runs on the same kind of fake as
 * readAnswers: a table holding two clients' rows, `client_domain_id` on each,
 * serving only the selected columns of the rows its filters keep - by `id`
 * when ordered, the planner's order (reversed here) when not - and refusing a
 * select that names a column it lacks, as PostgREST does (42703).
 */
function dayPostgrest(rows: readonly Record<string, unknown>[], lacks?: string) {
  const calls: string[][] = [];
  const table: DayTable = () => ({
    select(columns) {
      const log = [`select ${columns}`];
      calls.push(log);
      const keep: ((r: Record<string, unknown>) => boolean)[] = [];
      let by: { column: string; up: boolean } | null = null;
      let max = Number.MAX_SAFE_INTEGER;
      const q: DayQuery = {
        eq: (c, v) => (log.push(`eq ${c}`), keep.push((r) => r[c] === v), q),
        lte: (c, v) => (log.push(`lte ${c}`), keep.push((r) => String(r[c]) <= v), q),
        order: (c, o) => (log.push(`order ${c}${o.ascending ? "" : " desc"}`), (by = { column: c, up: o.ascending }), q),
        limit: (n) => (log.push(`limit ${n}`), (max = n), q),
        then: (ok, fail) => {
          if (lacks && columns.split(",").some((c) => c.trim() === lacks)) return Promise.resolve({ data: null, error: { message: `column tracking_answers.${lacks} does not exist` } }).then(ok, fail);
          const all = rows.map((r, id) => ({ id, ...r })).filter((r) => keep.every((k) => k(r)));
          const o = by;
          const cmp = (a: Record<string, unknown>, b: Record<string, unknown>) => {
            const [x, y] = [a[o!.column], b[o!.column]];
            const d = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
            return o!.up ? d : -d;
          };
          const ordered = o ? [...all].sort(cmp) : all.reverse();
          return Promise.resolve({ data: ordered.slice(0, max).map((r) => selectColumns(r, columns)), error: null }).then(ok, fail);
        },
      };
      return q;
    },
  });
  return { table, calls };
}

/** One fixture state's answers as tracking_answers holds them for the panel: the words on the fixture's one check with words, and a stored time. */
function stored(f: Fixture): StoredAnswer[] {
  const on = f.textsOn ?? f.today;
  return f.data.answers.map((a, i) => ({ ...a, response_text: a.run_date === on ? (f.texts[`${a.question_id} ${a.engine}`] ?? null) : null, created_at: `${a.run_date}T0${5 + (i % 2)}:1${i % 4}:00Z` }));
}

/** Two clients in one table: this one's rows, and another's - the same prompt ids, every verdict the other way. */
function twoClients(rows: readonly StoredAnswer[], clientId: string) {
  return [...rows.map((a) => ({ client_domain_id: clientId, ...a })), ...rows.map((a) => ({ client_domain_id: "someone-else", ...a, named: !a.named, response_text: "Not this client's words." }))];
}

test("DB-2: readAnswerDay, the panel's read, returns on PostgREST exactly what shapeAnswerDay gives the fixture", async () => {
  let reads = 0;
  let latest = 0;
  let blank = 0;
  let none = 0;
  for (const state of ["default", "failed", "partial", "young", "stopped", "brands-unread", "pilot-mixed", "ungrouped"]) {
    const f = fixtures.find(([s]) => s === state)![1];
    const rows = stored(f);
    const db = dayPostgrest(twoClients(rows, f.client.id));
    const prompts = [...new Set(f.data.answers.map((a) => a.question_id))].filter((_, i) => i < 6 || i % 9 === 0);
    // Latest on or before: today, ten days back, and before any answer; picked: today, yesterday, a mid day, the first, and a day with none.
    const plans = (q: string) => [
      ...[f.today, addDays(f.today, -10), "2026-08-01"].map((to) => dayPlan(q, to, null)),
      ...[f.today, addDays(f.today, -1), "2026-09-14", "2026-08-05", "2026-07-01"].map((d) => dayPlan(q, f.today, d)),
    ];
    for (const q of prompts) {
      for (const plan of plans(q)) {
        const got = await readAnswerDay(db.table, plan, f.client.id);
        const want = shapeAnswerDay(rows, plan);
        assert.deepEqual(got, want, `${state} ${q} ${plan.day ?? `latest to ${plan.to}`}`);
        reads++;
        if (plan.day === null && got.day) latest++;
        if (got.rows.length && got.rows.every((r) => !r.answered)) blank++;
        if (plan.day && !got.rows.length) none++;
        assert.ok(got.rows.every((r) => r.text !== "Not this client's words."), "another client's row was read");
      }
    }
  }
  assert.ok(reads >= 400, `only ${reads} reads compared`);
  assert.ok(latest >= 100 && none >= 50, `${latest} latest days found, ${none} picked days with no check`);
  assert.ok(blank >= 5, `${blank} failed checks read - the failed state's blank day went untested`);
});

test("DB-2: the latest skips a failed check; a picked day is read as it is; each read is one client's one prompt", async () => {
  const f = fixtures.find(([s]) => s === "failed")![1];
  const rows = stored(f);
  const db = dayPostgrest(twoClients(rows, f.client.id));
  const latest = await readAnswerDay(db.table, dayPlan("q1-1", f.today, null), f.client.id);
  assert.equal(latest.day, f.textsOn, "the latest is the last check with an answer, not today's failed one");
  assert.ok(latest.rows.some((r) => r.answered && r.text), "with its words");
  assert.deepEqual(db.calls[0], ["select run_date", "eq client_domain_id", "eq question_id", "eq answered", "lte run_date", "order run_date desc", "limit 1"]);
  assert.deepEqual(db.calls[1], [`select ${DAY_SELECT}`, "eq client_domain_id", "eq question_id", "eq run_date", "order id"]);
  const failedDay = await readAnswerDay(db.table, dayPlan("q1-1", f.today, f.today), f.client.id);
  assert.equal(failedDay.day, f.today);
  assert.ok(failedDay.rows.length > 0 && failedDay.rows.every((r) => !r.answered), "today's failed check, as stored: every read unanswered");
  assert.equal(db.calls.length, 3, "a picked day is one read, not two");
  assert.deepEqual(await readAnswerDay(db.table, dayPlan("q1-1", f.today, "2026-07-01"), f.client.id), { day: "2026-07-01", rows: [] }, "a day with no check: the day, no rows");
  // Another client's id, or a prompt that is not this client's, reads nothing - the page passes its own, never the URL's.
  assert.deepEqual(await readAnswerDay(dayPostgrest(rows.map((a) => ({ client_domain_id: f.client.id, ...a }))).table, dayPlan("q1-1", f.today, null), "someone-else"), { day: null, rows: [] });
  assert.deepEqual(await readAnswerDay(db.table, dayPlan("not-a-prompt", f.today, f.today), f.client.id), { day: f.today, rows: [] });
});

test("DB-2: the panel's read goes again without brands_ok while the column is missing, and only then", async () => {
  const f = fixtures.find(([s]) => s === "brands-unread")![1];
  const before = stored(f).map((a) => Object.fromEntries(Object.entries(a).filter(([k]) => k !== "brands_ok")) as StoredAnswer);
  const db = dayPostgrest(before.map((a) => ({ client_domain_id: f.client.id, ...a })), "brands_ok");
  const plan = dayPlan("q1-1", f.today, null);
  const got = await readAnswerDay(db.table, plan, f.client.id);
  assert.deepEqual(got, shapeAnswerDay(before, plan));
  assert.ok(got.rows.length > 0 && got.rows.every((r) => !("brands_ok" in r)), "every row reads as read");
  assert.deepEqual(db.calls.map((c) => c[0]), ["select run_date", `select ${DAY_SELECT}`, `select ${withoutBrandsOk(DAY_SELECT)}`]);
  assert.equal(withoutBrandsOk(DAY_SELECT), "engine, answered, named, response_text, brands, citations, created_at", "the columns loadLatestAnswers read before the column");
  const live = await readAnswerDay(dayPostgrest(stored(f).map((a) => ({ client_domain_id: f.client.id, ...a }))).table, plan, f.client.id);
  assert.deepEqual(live, shapeAnswerDay(stored(f), plan));
  await assert.rejects(readAnswerDay(dayPostgrest(before.map((a) => ({ client_domain_id: f.client.id, ...a })), "response_text").table, plan, f.client.id), /response_text does not exist/, "another missing column is not read past");
});

test("census DB-2: the panel's read is read-shape.ts's in Supabase and on the fixture, on the page's own client and prompt", () => {
  const data = src("./overview-data.ts");
  const at = data.indexOf("export async function loadAnswerDay(");
  const load = data.slice(at, data.indexOf("\n}\n", at));
  assert.ok(at >= 0, "loadAnswerDay not found");
  assert.ok(load.includes('return readAnswerDay((() => db.from("tracking_answers")) as unknown as DayTable, plan, clientId);'), "loadAnswerDay no longer reads through readAnswerDay - hold its read to shapeAnswerDay again before updating this census");
  assert.doesNotMatch(data, /\.select\([^)]*response_text/, "overview-data.ts selects the words itself again");
  const repo = src("./repo.ts");
  assert.match(repo, /answerDay: loadAnswerDay/);
  assert.match(repo, /return shapeAnswerDay\(stored, plan\);/);
  assert.match(repo, /if \(clientId !== f\.client\.id\) return \{ day: null, rows: \[\] \};\n[^]*?return shapeAnswerDay/, "the fixture answers only its own client");
  // The scoping: the client is the session's member client, the prompt one of this cluster's, the day the only thing the URL moves.
  const page = src("../../app/app/[client]/clusters/[cluster]/page.tsx");
  for (const line of [
    "const client = clients.find((c) => c.slug === slug);",
    "const picked = detail.card.prompts[prompt];",
    "const day = pickedDay(sp.day, today);",
    'picked && detail.card.status !== "pending" ? repo.answerDay(client.id, dayPlan(picked.id, range.to, day)) : null,',
  ]) {
    assert.ok(page.includes(line), `the one-cluster page: "${line}" is gone`);
  }
  assert.equal((page.match(/repo\.answerDay\(/g) ?? []).length, 1, "one panel read");
});

test("census: loadOverview takes its plan, prompts and read from read-shape.ts, and the fixture repo its shapeRead", () => {
  const data = src("./overview-data.ts");
  const at = data.indexOf("export async function loadOverview(");
  const load = data.slice(at, data.indexOf("\n}\n", at));
  assert.ok(at >= 0 && load.length > 500, "loadOverview not found");
  for (const line of [
    "const plan = answerPlan(opts);",
    "readAnswers(answersTable, p, ids, { clientId, from: earliest, to: range.to })",
    'db.from("tracking_answers")) as unknown as AnswersTable',
    "plan === null ? Promise.resolve([]) : plan.cluster === null ? answersRead(plan, null) : structureP.then((s) => answersRead(plan, planPrompts(plan, s)))",
  ]) {
    assert.ok(load.includes(line), `loadOverview: "${line}" is gone - hold its read to shapeRead again before updating this census`);
  }
  // One copy: the decisions are not taken again beside the plan.
  for (const second of ["ANSWER_SELECT", "clusterQuestionIds"]) assert.ok(!data.includes(second), `overview-data.ts shapes the answers itself again: ${second}`);
  for (const second of ['"question_id"', "brands", "citations"]) assert.ok(!load.includes(second), `loadOverview filters or maps the answers itself again: ${second}`);
  assert.match(src("./repo.ts"), /shapeRead\(fixture\(\)\.data, opts\)/);
});

test("Reports reads from the oldest month's own comparison, not the whole span's", () => {
  const months = reportMonths("2026-06-10", "2026-09-29");
  const span = reportSpan(months, "2026-09-29");
  assert.deepEqual(span, { from: comparisonRange({ from: "2026-06-01", to: "2026-06-30" }, "prev")!.from, to: "2026-09-29" });
  for (const m of months) assert.ok(comparisonRange(m.range, "prev")!.from >= span.from, `${m.label} reaches before the read`);
  // The old read: the whole span on "prev", as long again before June as June to today.
  const whole = { from: "2026-06-01", to: "2026-09-29" };
  assert.ok(comparisonRange(whole, "prev")!.from < span.from);
  // A year of history read two; it now reads a year and a month (October's 31 days before 1 Oct).
  const year = reportMonths("2025-10-01", "2026-09-29");
  assert.equal(reportSpan(year, "2026-09-29").from, "2025-08-31");
  assert.equal(comparisonRange({ from: "2025-10-01", to: "2026-09-29" }, "prev")!.from, "2024-10-02", "the old read");
});

test("every Reports card is the same on the verdicts-only, month-sliced read, on every fixture state", () => {
  let cards = 0;
  for (const [state, f] of fixtures) {
    const months = reportMonths(f.client.started_on, f.today);
    const span = reportSpan(months, f.today);
    const narrow = within(shapeRead(f.data, { answers: "verdicts" }), span);
    const opts = { startedOn: f.client.started_on, today: f.today, engines };
    for (const m of months) {
      assert.deepEqual(monthFigures(monthSlice(narrow, m.range), m.range, opts), monthFigures(f.data, m.range, opts), `${state} ${m.label}`);
      cards++;
    }
  }
  assert.ok(cards >= 30, `only ${cards} cards compared`);
});

/**
 * Merge of audit packages B and C (8 Oct 2026): Reports shows the picked range's lost checks (runNote, audit
 * data-3) from its verdicts-only read. runNote reads the runs and, for a failed day, whether it stored an
 * answer - run_date and answered, which verdicts keep - so the note is the full read's. A day that failed
 * after storing its answers is added to the states, as the fixture has none.
 */
test("Reports' range note is the same on the verdicts-only read as on the whole read", () => {
  let notes = 0;
  let said = 0;
  const stored = (f: Fixture): Fixture => ({ ...f, data: { ...f.data, runs: f.data.runs?.map((r) => (r.run_date === f.today ? { ...r, status: "failed", error: "could not store the keyword positions: timeout" } : r)) } });
  for (const [state, f] of [...fixtures, ["failed-after-storing", stored(base)] as [string, Fixture]]) {
    const span = reportSpan(reportMonths(f.client.started_on, f.today), f.today);
    const narrow = within(shapeRead(f.data, { answers: "verdicts" }), span);
    for (const range of [{ from: addDays(f.today, -27), to: f.today }, { from: addDays(f.today, -13), to: addDays(f.today, -1) }, { from: span.from, to: f.today }]) {
      const note = runNote(f.data, range, f.today);
      assert.equal(runNote(narrow, range, f.today), note, `${state} ${range.from}`);
      notes++;
      if (note) said++;
    }
  }
  assert.ok(notes >= 30 && said >= 5, `${notes} notes compared, ${said} of them saying something`);
});

/** The one-cluster page's figures, as clusters/[cluster]/page.tsx and OneCluster.tsx draw them. */
function oneCluster(data: OverviewData, f: Fixture, range: Range, before: Range | null, id: string) {
  const input = { clusters: data.clusters, questions: data.questions, keywords: data.keywords, answers: data.answers, serp: data.serp, range, before, today: f.today, engines };
  const detail = clusterDetail(input, id);
  const cards = clusterCards(input);
  const prompts = detail?.card.prompts ?? [];
  return {
    detail,
    index: cards.findIndex((c) => c.id === id) + 1,
    total: cards.length,
    chart: clusterChart(input, id),
    strips: prompts.map((p) => promptStrip({ answers: data.answers, range, engines }, p.id)),
    brands: prompts.map((p) => promptBrands({ answers: data.answers, range }, p.id, f.client.brand)),
    // Merge of audit packages A, B and C (8 Oct 2026): each prompt's unread brand answers (A), and the range's note
    // (B), asked as OneCluster.tsx asks it - with the days the cluster's prompts were asked (run-note.ts askedOnFor,
    // the page's own helper since the review the same day, not a copy of the runner's rule).
    unread: prompts.map((p) => brandGaps(data.answers.filter((a) => a.question_id === p.id), range)),
    note: runNote(data, range, f.today, { askedOn: askedOnFor(data.questions, id) }),
  };
}

test("the one-cluster page draws the same from its own prompts' answers as from every cluster's", () => {
  let pages = 0;
  // Merge of audit packages B and C (8 Oct 2026): a check that failed after storing its answers, which the
  // fixture has none of, so the range note's "did not finish" is compared on the narrow read too.
  const stored: Fixture = { ...base, data: { ...base.data, runs: base.data.runs?.map((r) => (r.run_date === base.today ? { ...r, status: "failed", error: "could not store the keyword positions: timeout" } : r)) } };
  for (const [state, f] of [...fixtures, ["failed-after-storing", stored] as [string, Fixture]]) {
    const ranges: [Range, "prev" | "month" | "none"][] = [
      [{ from: addDays(f.today, -27), to: f.today }, "prev"],
      [{ from: "2026-08-10", to: "2026-09-20" }, "month"],
      [{ from: "2026-09-01", to: "2026-09-14" }, "none"],
    ];
    for (const [range, compare] of ranges) {
      // loadOverview reads from the picked comparison's first day; the page compares with resolveComparison's,
      // the first week for a young client (audit data-10, merged 8 Oct 2026), which lies inside that read.
      const read = comparisonRange(range, compare);
      const before = resolveComparison(range, compare, f.client.started_on, firstCheckDay(f.client.started_on, f.data.questions)).range;
      const full = within(f.data, { from: read?.from ?? range.from, to: range.to });
      for (const c of [...f.data.clusters.map((x) => x.id), "not-a-cluster"]) {
        const narrow = within(shapeRead(f.data, { cluster: c }), { from: read?.from ?? range.from, to: range.to });
        assert.deepEqual(oneCluster(narrow, f, range, before, c), oneCluster(full, f, range, before, c), `${state} ${c} ${range.from}`);
        pages++;
      }
    }
  }
  assert.ok(pages >= 150, `only ${pages} pages compared`);
});

/** The placements screen's view, as placements-screen.ts builds it. */
function placements(data: OverviewData, f: Fixture, range: Range, id: string) {
  const clusters = data.clusters.filter((c) => c.stopped_on === null || c.stopped_on > range.from);
  const chart = clusterChart({ clusters, questions: data.questions, keywords: data.keywords, answers: data.answers, serp: data.serp, range, before: null, today: f.today, engines }, id);
  if (!chart) return null;
  const questionIds = data.questions.filter((q) => q.cluster_id === id && (q.stopped_on === null || q.stopped_on > range.from)).map((q) => q.id);
  const rows = f.placements.filter((p) => p.cluster_id === id).map((p) => ({ ...p, url_key: urlKey(p.url) ?? "" }));
  // 13 Oct 2026, DIY P2: each live placement's first citation per engine, from the same cites (spec 10 section 4.11).
  return { view: placementsView({ chart, questionIds, placements: rows, cites: citeRows(data.answers), engines }), series: chartSeries(chart), firstCited: placementFirstCited(rows, id, citeRows(data.answers), questionIds, engines) };
}

test("Placements draws the same from its cluster's prompts, without brands, as from the whole read", () => {
  let screens = 0;
  for (const [state, f] of fixtures) {
    for (const range of [{ from: f.client.started_on, to: f.today }, { from: "2026-09-01", to: f.today }]) {
      for (const c of f.data.clusters.map((x) => x.id)) {
        const narrow = shapeRead(f.data, { answers: "cites", cluster: c });
        assert.deepEqual(placements(narrow, f, range, c), placements(f.data, f, range, c), `${state} ${c} ${range.from}`);
        screens++;
      }
    }
  }
  assert.ok(screens >= 100, `only ${screens} screens compared`);
  assert.ok(base.placements.length > 0, "no placements in the fixture, so the table compared nothing");
});

/**
 * Census, 8 Oct 2026: every use of the answers on a page that reads a narrow
 * shape, each one compared above. A new use fails here until it is compared
 * too - a figure that needs a column the read leaves out would otherwise read
 * it as an empty list, and say zero.
 */
const src = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
/**
 * Review of the integration of audit packages A, B and C (8 Oct 2026): `data` handed on whole is a use of its
 * answers too. OneCluster's runNote(data, ...) reads them through storedAnswers, and /data\.answers/ never saw
 * it - which is how B's note passed this census on C's narrow read and said "none of its reads came back" of a
 * pending cluster. So the one-cluster page and the placements screen also count a bare `data` that is not a
 * member read, a JSX attribute or a type (`data.questions`, `data={{`, `data: OverviewData`): the structure,
 * runs and positions are read whole on every shape, so their member reads are not uses. `binds` is the
 * destructure that names `data`, which is not a use. Each recorded use is paired with the line above that
 * compares it, so dropping a comparison fails here too.
 */
const WHOLE = /data\.answers|(?<![-\w.])data\b(?![-\w.]|\s*[:=])/g;
const USES: { what: string; path: string; use: RegExp; binds: number; lines: [page: string, compared: string][] }[] = [
  {
    what: "the one-cluster page",
    path: "../../components/app/OneCluster.tsx",
    use: WHOLE,
    binds: 1,
    lines: [
      ["answers: data.answers, serp: data.serp, range, before, today, engines", "chart: clusterChart(input, id)"],
      ["promptStrip({ answers: data.answers", "promptStrip({ answers: data.answers, range, engines }, p.id)"],
      ["promptBrands({ answers: data.answers", "promptBrands({ answers: data.answers, range }, p.id, f.client.brand)"],
      // 8 Oct 2026 (merge of audit packages A and C): the picked prompt's unread brand answers - its own answers, inside the narrow read.
      ["brandGaps(data.answers.filter((a) => a.question_id === P.id), range)", "brandGaps(data.answers.filter((a) => a.question_id === p.id), range)"],
      // 8 Oct 2026 (review of the integration): the range's lost checks, on the days the cluster's prompts were asked.
      ["runNote(data, range, today, { askedOn })", "note: runNote(data, range, f.today, { askedOn: askedOnFor(data.questions, id) })"],
    ],
  },
  {
    what: "the placements screen",
    path: "./placements-screen.ts",
    use: WHOLE,
    binds: 0,
    lines: [
      ["answers: data.answers, serp: data.serp, range, before: null", "answers: data.answers, serp: data.serp, range, before: null, today: f.today, engines }, id)"],
      ["cites: citeRows(data.answers)", "cites: citeRows(data.answers), engines"],
      // 13 Oct 2026, DIY P2: the first-cited line on each live placement (spec 10 section 4.11), from the same cluster's cites.
      ["placementFirstCited(rows, cluster.id, citeRows(data.answers)", "placementFirstCited(rows, id, citeRows(data.answers), questionIds, engines)"],
    ],
  },
  {
    what: "Reports",
    path: "../../app/app/[client]/reports/page.tsx",
    use: /(?<![-\w])data\b(?!\.clusters)/g,
    binds: 1,
    lines: [
      ["monthFigures(monthSlice(data, m.range)", "monthFigures(monthSlice(narrow, m.range), m.range, opts)"],
      // 8 Oct 2026 (merge of audit packages B and C): the range's lost checks, compared above on the verdicts read.
      ["note={runNote(data, range, today)}", "assert.equal(runNote(narrow, range, f.today), note"],
    ],
  },
];

test("census: the pages on a narrow read use their answers only where compared above", () => {
  // The comparisons are this file's own lines above the census, so a recorded pair cannot match itself.
  const self = src("./read-shape.test.mts");
  const compared = self.slice(0, self.indexOf("const WHOLE = "));
  for (const { what, path, use, binds, lines } of USES) {
    const text = src(path);
    const hits = [...text.matchAll(use)].length;
    for (const [l, c] of lines) {
      assert.ok(text.includes(l), `${what}: "${l}" is gone - check its figures above and update this census`);
      assert.ok(compared.includes(c), `${what}: "${l}" is no longer compared above ("${c}") - compare it again before updating this census`);
    }
    const expected = lines.length + binds;
    assert.equal(hits, expected, `${what} uses its answers ${hits} times, ${expected} recorded`);
  }
  const reports = src("../../app/app/[client]/reports/page.tsx");
  assert.match(reports, /\{ answers: "verdicts" \}/);
  assert.match(src("./placements-screen.ts"), /\{ answers: "cites", cluster: cluster\.id, structure \}/);
  assert.match(src("../../app/app/[client]/clusters/[cluster]/page.tsx"), /\{ cluster: id \}/);
  for (const p of ["settings", "setup"]) {
    const page = src(`../../app/app/[client]/${p}/page.tsx`);
    assert.doesNotMatch(page, /loadOverview\(/, `${p} reads answers again`);
    assert.match(page, /repo\.structure\(client\.id\)/);
  }
});

/**
 * perf-8 (8 Oct 2026): a stated range has a lower bound. On the fixture dev
 * server /app/tallyroo/clusters/c1?from=1900-01-01 rendered 134 MB in 66 s.
 */
test("a stated from before the floor starts on it; one wholly before it is no range", () => {
  const today = "2026-09-29";
  // Review, 8 Oct 2026: the floor is the first of its month, so a Reports month card's range is never cut (below).
  assert.equal(rangeFloor(today, "2026-06-10"), "2025-09-01", "the month a year back, for a client younger than that");
  assert.equal(rangeFloor(today, null), "2025-09-01", "no start yet: the month a year back");
  assert.equal(rangeFloor(today, "2024-03-01"), "2024-03-01", "a client older than a year keeps all of its history");
  assert.equal(rangeFloor(today, "2024-03-17"), "2024-03-01", "from the first of the month tracking began in");
  assert.deepEqual(boundStated({ from: "1900-01-01", to: today }, today, "2026-06-10"), { from: "2025-09-01", to: today });
  assert.deepEqual(boundStated({ from: "1900-01-01", to: today }, today, "2024-03-01"), { from: "2024-03-01", to: today });
  assert.equal(boundStated({ from: "1900-01-01", to: "1900-01-31" }, today, "2026-06-10"), null, "the page takes its default");
  assert.equal(boundStated({ from: "2020-01-01", to: "2025-08-31" }, today, null), null);
  assert.deepEqual(boundStated({ from: "2025-09-01", to: "2025-09-01" }, today, null), { from: "2025-09-01", to: "2025-09-01" }, "the floor itself is a day");
  assert.deepEqual(boundStated({ from: "2025-08-20", to: "2025-09-03" }, today, null), { from: "2025-09-01", to: "2025-09-03" });
});

test("every Reports month card's range, which its CSV links state, passes the floor unmoved", () => {
  // Review, 8 Oct 2026: on the day-exact floor a client started 15 Sep 2025 had its September card's
  // files cut to start on the 15th, and one started 20 Oct 2025 had October's cut to the 8th.
  let cards = 0;
  for (const today of ["2026-10-08", "2026-09-29", "2026-03-31", "2026-01-01", "2028-02-29"]) {
    const ages = [0, 27, 200, 330, 360, 364, 365, 366, 370, 380, 400, 500, 800];
    for (const back of ages) {
      const started = addDays(today, -back);
      for (const m of reportMonths(started, today)) {
        assert.deepEqual(boundStated(m.range, today, started), m.range, `${m.label} for a client started ${started}, today ${today}`);
        cards++;
      }
    }
    for (const started of ["2025-09-15", "2025-10-20", "2024-03-17"]) {
      for (const m of reportMonths(started, today)) assert.deepEqual(boundStated(m.range, today, started), m.range, `${m.label}, started ${started}`);
    }
  }
  assert.ok(cards >= 200, `only ${cards} cards checked`);
});

test("a from before tracking began is honoured inside the year: the default range and its links state one", () => {
  const today = "2026-09-29";
  // Nine days old (the trial): the default 28 days start 19 days before tracking did, and every page's links carry them.
  const young = "2026-09-20";
  const dflt = { from: addDays(today, -27), to: today };
  assert.deepEqual(boundStated(dflt, today, young), dflt);
  assert.deepEqual(boundStated({ from: "2026-06-01", to: today }, today, young), { from: "2026-06-01", to: today });
  // Nothing the picker offers moves, whatever the client's age.
  for (const started of [null, today, young, "2026-06-10", "2025-12-01", "2025-10-20", "2025-09-15", "2024-03-01", "2024-03-17", "2026-10-05"]) {
    for (const p of presets(today, started)) assert.deepEqual(boundStated(p.range, today, started), p.range, `${p.id} for a client started ${started}`);
    assert.deepEqual(boundStated(dflt, today, started), dflt);
  }
});

test("rangeFrom applies the floor, and every page and the CSV route pass it the client's start", () => {
  const data = src("./overview-data.ts");
  assert.match(data, /boundStated\(\{ from, to \}, today, startedOn\)/, "rangeFrom no longer bounds a stated range");
  assert.match(src("../../app/api/app/[client]/report/route.ts"), /rangeFrom\(Object\.fromEntries\(sp\), repo\.today\(\), client\.started_on\)/);
  assert.match(src("./placements-screen.ts"), /rangeFrom\(sp, today, client\.started_on \?\? null\)/);
  let calls = 0;
  for (const p of ["", "/clusters", "/clusters/[cluster]", "/named", "/cited", "/reports"]) {
    const page = src(`../../app/app/[client]${p}/page.tsx`);
    assert.match(page, /rangeFrom\(sp, today, client\.started_on\)/, `${p || "/"} reads its range without the client's start`);
    calls++;
  }
  assert.equal(calls, 6);
});
