import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { type BrandGap, failureSummary, runOutcome } from "./decide.ts";
import { type Row, fakeDb } from "./fake-db.mts";
import { healthAnswer, runHealth } from "./run-health.ts";
import { runLostReads, runNote, todayRun } from "./run-note.ts";
import {
  type Kept,
  type RunForRerun,
  RERUN_BUTTON,
  askRerun,
  brandGapEngines,
  claimRerun,
  closedMarker,
  dayRows,
  hasBrandsOk,
  keepsOld,
  nextMarker,
  readKept,
  readStoredTexts,
  rebrandAnswers,
  rerunLine,
  rerunMarker,
  rerunVerdict,
  restored,
  retryAnswers,
  retryKeywords,
} from "./rerun.ts";

/**
 * Re-running a day's failed reads (9 Oct 2026, audit reliability-4).
 *
 * A failed, partial or killed run could never be read again: "Run now"
 * refused anything not queued and the claim moves only queued to running.
 * These hold the ask and the claim (compare-and-swaps that never take a run
 * still reading), what a re-run asks again, what it reads again from the text
 * stored, what it leaves alone, and that it never leaves the day worse than
 * it found it - against an in-memory database (fake-db.mts), nothing real
 * read or written.
 *
 * Review of b2e0019 (9 Oct 2026): the first version moved the run back to
 * queued before dispatching it. For the minutes a re-run read, the client's
 * Overview lost the partial day; a dispatch that failed, a re-run never
 * claimed or one the platform killed left the day queued, or failed by the
 * stall sweep, for good; and the health JSON turned 503. The ask now writes
 * only a marker, so the tests below read the run as each reader reads it at
 * every step - asked, claimed, never claimed, killed - and find it as it was.
 */

const DAY = "2026-10-09";
const at = (hhmm: string) => Date.parse(`${DAY}T${hhmm}:00Z`);
const LINE = "4 of 21 reads failed - google_aio: 4 x HTTP 429";

const row = (over: Partial<RunForRerun> = {}): RunForRerun => ({ id: "r1", run_date: DAY, status: "partial", error: LINE, started_at: `${DAY}T05:00:03Z`, step_ms: { total: 61_000 }, ...over });

/** A partial run of 05:00 as tracking_runs holds it. */
const partialRow = (over: Row = {}): Row => ({ id: "r1", client_domain_id: "a", run_date: DAY, status: "partial", error: LINE, created_at: `${DAY}T05:00:01Z`, started_at: `${DAY}T05:00:03Z`, finished_at: `${DAY}T05:01:04Z`, dfs_cost: 0.42, model_calls: 3, engines: ["chatgpt", "google_aio"], step_ms: { total: 61_000 }, ...over });

function runs(rows: Row[]) {
  return fakeDb({ tracking_runs: rows.map((r) => ({ ...r })) });
}

const asRun = (r: Row): RunForRerun => ({ id: r.id as string, run_date: r.run_date as string, status: r.status as string, error: (r.error as string | null) ?? null, started_at: (r.started_at as string | null) ?? null, step_ms: r.step_ms });

/**
 * The run as every reader outside the re-run reads it: the Overview's lastRun
 * (complete or partial, newest), the range's run note and today's run, the
 * health JSON after its deadline, and whether the stall sweep would close it.
 */
async function seenFrom(db: ReturnType<typeof fakeDb>["db"], now: number) {
  const { data: last } = (await db.from("tracking_runs").select("run_date, status, finished_at, error").eq("client_domain_id", "a").in("status", ["complete", "partial"]).order("run_date", { ascending: false }).limit(1)) as { data: Row[] };
  const { data: all } = (await db.from("tracking_runs").select("run_date, status, error, started_at").eq("client_domain_id", "a")) as { data: Row[] };
  const r = all[0]!;
  const range = { from: "2026-10-03", to: DAY };
  const runRows = all.map((x) => ({ run_date: x.run_date as string, status: x.status as string, error: (x.error as string | null) ?? null }));
  const health = runHealth({ day: DAY, now, clients: [{ id: "a", domain: "tallyroo.com", status: "active", started_on: "2026-10-01", tier: "tracked", activeQuestions: 7, track: true }], runs: [{ client_domain_id: "a", status: r.status as string, error: (r.error as string | null) ?? null, created_at: `${DAY}T05:00:01Z`, started_at: (r.started_at as string | null) ?? null }] });
  return {
    lastRun: last[0] ? { status: last[0].status, finished_at: last[0].finished_at, error: last[0].error } : null,
    note: runNote({ lastRun: (last[0] as never) ?? null, runs: runRows }, range, DAY),
    today: todayRun(runRows, DAY)?.status,
    lost: runLostReads(runRows[0]!),
    monitor: healthAnswer(health, now).status,
    // reapStalledTrackingRuns' filter (runner.ts): running, started before the cutoff.
    swept: r.status === "running" && String(r.started_at) < new Date(now - 15 * 60_000).toISOString(),
  };
}

test("which runs may be re-run: today's failed, partial or stalled; never one, or a re-run, still reading inside 15 minutes", () => {
  assert.deepEqual(rerunVerdict(row({ status: "failed" }), DAY, at("08:00")), { ok: true, of: "failed" });
  assert.deepEqual(rerunVerdict(row({ status: "partial" }), DAY, at("08:00")), { ok: true, of: "partial" });
  const reading = rerunVerdict(row({ status: "running", started_at: `${DAY}T07:55:00Z` }), DAY, at("08:00"));
  assert.equal(reading.ok, false, "running five minutes: genuinely still reading");
  assert.match((reading as { message: string }).message, /running \(since 07:55Z\).*after 15 minutes/);
  assert.deepEqual(rerunVerdict(row({ status: "running", started_at: `${DAY}T05:00:03Z` }), DAY, at("05:15")), { ok: false, message: "Today's run is running (since 05:00Z). It can be re-run once it ends, or after 15 minutes if it never does." });
  assert.deepEqual(rerunVerdict(row({ status: "running", started_at: `${DAY}T05:00:03Z` }), DAY, at("05:16")), { ok: true, of: "stalled" });
  assert.deepEqual(rerunVerdict(row({ status: "complete" }), DAY, at("08:00")), { ok: false, message: "Today's run is already complete." });
  assert.equal(rerunVerdict(row({ run_date: "2026-10-08" }), DAY, at("08:00")).ok, false, "a reading is dated the day it is read: never yesterday's run");
  // A partial run whose re-run was claimed at 08:00 is still partial, and is reading.
  const claimed = row({ started_at: `${DAY}T08:00:00Z`, step_ms: { rerun: { ...nextMarker(row(), "partial", at("07:59")), state: "reading" } } });
  assert.deepEqual(rerunVerdict(claimed, DAY, at("08:05")), { ok: false, message: "A re-run of today's run is reading (since 08:00Z). Look again once it closes, or after 15 minutes if it never does." });
  assert.deepEqual(rerunVerdict(claimed, DAY, at("08:16")), { ok: true, of: "partial" }, "a re-run the platform killed can be asked again");
});

test("the ask writes only its marker: status, error line and finished_at are as they were", async () => {
  const { db, tables } = runs([partialRow(), partialRow({ id: "r2", client_domain_id: "b" })]);
  const before = { ...tables.tracking_runs![0]! };
  assert.equal(await askRerun(db, asRun(before), "partial", at("08:00")), true);
  const r = tables.tracking_runs![0]!;
  assert.deepEqual([r.status, r.error, r.finished_at, r.started_at, r.dfs_cost], [before.status, before.error, before.finished_at, before.started_at, before.dfs_cost]);
  assert.deepEqual(rerunMarker(r.step_ms), { of: "partial", error: LINE, at: `${DAY}T08:00:00.000Z`, n: 1, landed: true, state: "asked", why: null });
  assert.equal((r.step_ms as Row).total, 61_000, "the first pass's timing is kept beside it");
  assert.equal(rerunMarker(tables.tracking_runs![1]!.step_ms), null, "only the row named");
  // A double click from the same page: the row it read had no marker, and now has one.
  assert.equal(await askRerun(db, asRun(before), "partial", at("08:00")), false);
  // A second ask from a fresh read replaces the ask, counted.
  assert.equal(await askRerun(db, asRun(r), "partial", at("08:01")), true);
  assert.equal(rerunMarker(r.step_ms)!.n, 2);
});

test("the ask is a compare-and-swap: it refuses a run genuinely still running inside 15 minutes, whatever the caller decided", async () => {
  const live = partialRow({ status: "running", error: null, started_at: `${DAY}T07:55:00Z`, finished_at: null, step_ms: null });
  const { db, tables } = runs([live]);
  // Called past the verdict, as a stale page's second click would.
  assert.equal(await askRerun(db, asRun(live), "stalled", at("08:00")), false);
  assert.equal(tables.tracking_runs![0]!.step_ms, null, "the run reading is untouched");
  // The same row 16 minutes on is dead, and is asked; it stays running - dead - until a pass closes it.
  assert.equal(await askRerun(db, asRun(live), "stalled", at("08:11")), true);
  assert.equal(tables.tracking_runs![0]!.status, "running");
  assert.equal(rerunMarker(tables.tracking_runs![0]!.step_ms)!.error, "the run was stopped before it could record a result");
});

test("the claim: only an ask of today, once; the status and error line untouched; the cron posting twice still skips", async () => {
  const { db, tables } = runs([partialRow(), partialRow({ id: "cron", client_domain_id: "b", status: "running", step_ms: null })]);
  const r = tables.tracking_runs![0]!;
  assert.equal(await claimRerun(db, "r1", at("08:00")), null, "nothing asked: nothing to claim");
  assert.equal(await claimRerun(db, "cron", at("05:02")), null, "the cron's run in flight, posted twice: skipped, as before");
  await askRerun(db, asRun(r), "partial", at("08:00"));
  assert.equal(await claimRerun(db, "r1", Date.parse("2026-10-10T00:01:00Z")), null, "asked before London midnight, posted after: a reading is dated the day it is read");
  const claimed = await claimRerun(db, "r1", at("08:00") + 5_000);
  assert.ok(claimed);
  assert.deepEqual([claimed.run.dfs_cost, claimed.run.model_calls, claimed.run.client_domain_id], [0.42, 3, "a"], "what the first pass billed, for the cap");
  assert.equal(claimed.marker.state, "reading");
  assert.deepEqual([r.status, r.error, r.finished_at], ["partial", LINE, `${DAY}T05:01:04Z`]);
  assert.equal(r.started_at, `${DAY}T08:00:05.000Z`, "the pass's clock, for the stall check and a second ask");
  assert.equal(await claimRerun(db, "r1", at("08:00") + 6_000), null, "a second post of the same ask claims nothing");
});

test("two posts of one ask at once: both read it asked, one claims it", async () => {
  const { db, tables } = runs([partialRow()]);
  await askRerun(db, asRun(tables.tracking_runs![0]!), "partial", at("08:00"));
  const both = await Promise.all([claimRerun(db, "r1", at("08:00") + 1_000), claimRerun(db, "r1", at("08:00") + 1_000)]);
  assert.equal(both.filter(Boolean).length, 1, "the swap is on the ask's state, not only on what each read");
});

test("never worse: asked and never claimed, claimed and killed, refused or thrown - every reader sees the run as it was", async () => {
  const { db, tables } = runs([partialRow()]);
  const r = tables.tracking_runs![0]!;
  const as = await seenFrom(db, at("08:00"));
  assert.match(as.note!, /^Today's check was partial \(Google AI Overviews?\)\. /);
  assert.deepEqual([as.today, as.lost, as.monitor, as.swept], ["partial", true, 200, false]);

  // Asked at 08:59:30, and the dispatch failed (or the run route never claimed it).
  await askRerun(db, asRun(r), "partial", at("08:59") + 30_000);
  assert.deepEqual(await seenFrom(db, at("09:00")), as, "asked: nothing a reader reads has moved, and the monitor does not page");
  assert.deepEqual(await seenFrom(db, Date.parse("2026-10-10T03:45:00Z")), as, "never claimed, through the night: as it was");

  // Claimed at 09:00 and killed by the platform mid-read.
  await claimRerun(db, "r1", at("09:00"));
  assert.deepEqual(await seenFrom(db, at("09:02")), as, "reading: the Overview still has the partial day, and its note");
  assert.deepEqual(await seenFrom(db, Date.parse("2026-10-10T03:45:00Z")), as, "killed: the stall sweep closes running rows only, so partial stays partial");
  assert.equal(rerunLine({ started_at: r.started_at as string, step_ms: r.step_ms }, at("09:20")), "re-run stopped before it closed (claimed 09:00Z); the run's status is as it was");

  // Refused at the claim, or thrown: the close writes no status, line or finished_at.
  const m = rerunMarker(r.step_ms)!;
  assert.equal(restored(m, "re-run refused: today's tracking spend $25.00 has reached the cap of $25.00"), null);
  assert.equal(restored({ ...m, of: "failed" }, "re-run failed: x"), null);
  assert.deepEqual(
    restored({ ...m, of: "stalled", error: "the run was stopped before it could record a result" }, "re-run failed: x"),
    { status: "failed", error: "the run was stopped before it could record a result - re-run failed: x" },
    "a stalled run was dead: failed, as the sweep would close it, never running again",
  );
  assert.deepEqual(closedMarker(m, "re-run refused: x"), { ...m, state: "closed", why: "re-run refused: x" });
  assert.equal(rerunLine({ started_at: null, step_ms: { rerun: closedMarker(m, "re-run refused: x") } }, at("09:30")), "re-run left the run as it was: re-run refused: x");
  assert.equal(rerunLine({ started_at: null, step_ms: { rerun: closedMarker({ ...m, of: "stalled" }, "re-run refused: x") } }, at("09:30")), "re-run closed the stopped run as failed: re-run refused: x");
  assert.equal(rerunLine({ started_at: null, step_ms: { rerun: closedMarker(m, null) } }, at("09:30")), "re-run asked at 08:59Z has closed");
});

test("a stalled run asked and claimed reads as running for its own 15 minutes, not stalled from 05:00", async () => {
  const dead = partialRow({ status: "running", error: null, started_at: `${DAY}T05:00:03Z`, finished_at: null, step_ms: null });
  const { db, tables } = runs([dead]);
  await askRerun(db, asRun(dead), "stalled", at("08:00"));
  await claimRerun(db, "r1", at("08:00"));
  const seen = await seenFrom(db, at("08:05"));
  assert.equal(seen.swept, false, "its clock restarted at the claim");
  assert.equal(tables.tracking_runs![0]!.status, "running");
});

test("the marker: counted, its landing carried, and a stalled run's line said", () => {
  const first = nextMarker(row({ status: "partial" }), "partial", at("08:00"));
  assert.deepEqual([first.n, first.landed, first.state], [1, true, "asked"], "a partial pass landed: first_reading was considered then");
  // That re-run threw, so it was closed with the run left failed; then asked again.
  const again = nextMarker(row({ status: "failed", error: "x", step_ms: { total: 1, rerun: closedMarker(first, "re-run failed: y") } }), "failed", at("09:00"));
  assert.deepEqual([again.n, again.landed, again.of, again.why], [2, true, "failed", null], "landed stays true however the day went after");
  const failedFirst = nextMarker(row({ status: "failed", error: "today's tracking spend $25.00 has reached the cap of $25.00", step_ms: { total: 5 } }), "failed", at("08:00"));
  assert.equal(failedFirst.landed, false, "a run that only ever failed never sent first_reading, so a re-run that lands may");
  const stalled = nextMarker(row({ status: "running", error: null, step_ms: null }), "stalled", at("08:00"));
  assert.equal(stalled.error, "the run was stopped before it could record a result");
  assert.equal(rerunMarker({ total: 3 }), null, "the cron's pass carries none");
  assert.equal(rerunMarker(null), null);
  assert.equal(rerunMarker({ rerun: { of: "complete" } }), null, "a marker from nowhere is not trusted");
  assert.equal(rerunMarker({ rerun: { of: "partial", state: "something" } })!.state, "closed", "a state it does not know is never claimed");
  assert.equal(rerunLine({ started_at: null, step_ms: { rerun: first } }, at("08:01")), "re-run asked at 08:00Z and not claimed yet");
  assert.equal(rerunLine({ started_at: `${DAY}T09:00:02Z`, step_ms: { rerun: { ...again, state: "reading" } } }, at("09:05")), "re-run 2 reading since 09:00Z");
  assert.equal(rerunLine({ started_at: null, step_ms: { total: 3 } }, at("09:05")), null);
});

const kept = (over: Partial<Kept> = {}): Kept => ({
  answers: [
    { run_date: DAY, question_id: "q1", engine: "chatgpt", answered: true, named: true, brands: ["Rival"], brands_ok: true },
    { run_date: DAY, question_id: "q1", engine: "google_aio", answered: false, named: false, brands: [], brands_ok: true },
    { run_date: DAY, question_id: "q2", engine: "chatgpt", answered: true, named: false, brands: [], brands_ok: false },
  ],
  serp: [{ run_date: DAY, keyword_id: "k1", position: 4 }],
  ...over,
});

test("what a re-run asks the engine again: no row, or an answer that did not come back - never one that did", () => {
  const ask = retryAnswers(kept());
  assert.equal(ask("q1", "chatgpt"), false, "answered with its brands read: kept as it was read");
  assert.equal(ask("q1", "google_aio"), true, "unanswered: a failure and a silence look the same, so both are asked");
  assert.equal(ask("q2", "chatgpt"), false, "came back, brands not read: its text is kept, and the engine not asked (review of b2e0019)");
  assert.equal(ask("q2", "google_aio"), true, "no row at all");
  const read = retryKeywords(kept());
  assert.equal(read("k1"), false);
  assert.equal(read("k2"), true, "a failed keyword read stores no row");
});

test("an answer whose brands were not read has its brands read again from the stored text, and nothing else", async () => {
  const again = rebrandAnswers(kept(), null);
  assert.equal(again("q2", "chatgpt"), true, "brands_ok false");
  assert.equal(again("q1", "chatgpt"), false, "its brands were read");
  assert.equal(again("q1", "google_aio"), false, "no text to read brands from: it is asked of the engine instead");
  // The texts are read for those rows only, and not at all when there are none.
  const answers: Row[] = [
    { id: "a1", run_id: "r1", question_id: "q1", engine: "chatgpt", answered: true, named: true, response_text: "Rival and Tallyroo" },
    { id: "a2", run_id: "r1", question_id: "q2", engine: "chatgpt", answered: true, named: false, response_text: "Rival, Other" },
    { id: "a3", run_id: "r1", question_id: "q1", engine: "google_aio", answered: false, named: false, response_text: null },
    { id: "a4", run_id: "r9", question_id: "q2", engine: "chatgpt", answered: true, named: false, response_text: "another run" },
  ];
  const { db, calls } = fakeDb({ tracking_answers: answers });
  assert.deepEqual(await readStoredTexts(db, "r1", kept(), again), [{ question_id: "q2", engine: "chatgpt", named: false, response_text: "Rival, Other" }]);
  const clean = kept({ answers: kept().answers.map((a) => ({ ...a, brands_ok: true })) });
  const before = calls.length;
  assert.deepEqual(await readStoredTexts(db, "r1", clean, rebrandAnswers(clean, null)), []);
  assert.equal(calls.length, before, "nothing to read: no read");
});

test("before brands_ok exists, the engines the error line names as a brand gap have their brands read again, not their answers", () => {
  const gap: BrandGap[] = [{ engine: "chatgpt", unread: 12, answered: 20, reason: "language model error 529: Overloaded" }];
  const line = failureSummary(21, [{ engine: "google_aio", reason: "HTTP 429" }], gap);
  assert.deepEqual([...brandGapEngines(line)], ["chatgpt"], "read off failureSummary's own words");
  assert.deepEqual([...brandGapEngines(LINE)], []);
  assert.deepEqual([...brandGapEngines(null)], []);
  const noColumn = kept({ answers: kept().answers.map(({ brands_ok: _, ...a }) => a) });
  assert.equal(hasBrandsOk(noColumn), false);
  assert.equal(rebrandAnswers(noColumn, line)("q1", "chatgpt"), true, "the rows cannot say which chatgpt answers were missed");
  assert.equal(retryAnswers(noColumn)("q1", "chatgpt"), false, "and none of them is asked of the engine again");
  assert.equal(rebrandAnswers(noColumn, null)("q1", "chatgpt"), false, "with no gap named, an answered row is read, as the column's default says");
});

test("a re-read that fails again leaves the row it found; the cron's pass, keeping nothing, writes every row", () => {
  assert.equal(keepsOld(kept(), { question_id: "q1", engine: "google_aio", failed: true }), true);
  assert.equal(keepsOld(kept(), { question_id: "q1", engine: "google_aio", failed: false }), false, "a read that landed replaces the unanswered row");
  assert.equal(keepsOld(kept(), { question_id: "q9", engine: "chatgpt", failed: true }), false, "nothing to keep: the failed row is written");
  assert.equal(keepsOld(null, { question_id: "q1", engine: "google_aio", failed: true }), false);
  const day = dayRows(kept(), [{ question_id: "q1", engine: "google_aio", answered: true, named: true }], [{ keyword_id: "k2", position: 9 }]);
  assert.equal(day.answers.length, 3, "the re-read replaces its row; the rest are the day's own");
  assert.equal(day.answers.filter((a) => a.answered && a.named).length, 2);
  assert.deepEqual(day.serp.map((s) => s.keyword_id).sort(), ["k1", "k2"]);
});

test("acceptance: a partial run re-run ends complete when its failed reads come back, partial when one does not", () => {
  // The runner's arithmetic (runner.ts): the denominator is the whole day; the failures are the reads asked again that failed again.
  const every = 21 + 2; // 7 prompts x 3 engines, 2 keywords
  const before = runOutcome(every, 4);
  assert.equal(before, "partial");
  assert.equal(runOutcome(every, 0, 0), "complete", "all four came back");
  assert.equal(runOutcome(every, 1, 0), "partial");
  assert.equal(runOutcome(every, 0, 1), "partial", "a brand gap still unread after its re-read");
  assert.equal(failureSummary(every, [{ engine: "google_aio", reason: "HTTP 429" }]), "1 of 23 reads failed - google_aio: 1 x HTTP 429");
});

test("readKept reads the run's rows, and again without brands_ok while 20261008020000 is not applied", async () => {
  const answers: Row[] = [{ id: "a1", run_id: "r1", run_date: DAY, question_id: "q1", engine: "chatgpt", answered: true, named: false, brands: ["X", 3], brands_ok: false }, { id: "a2", run_id: "other", run_date: DAY, question_id: "q1", engine: "chatgpt", answered: true, named: true, brands: [] }];
  const { db } = fakeDb({ tracking_answers: answers, tracking_serp: [{ id: "s1", run_id: "r1", run_date: DAY, keyword_id: "k1", position: null }] });
  const k = await readKept(db, "r1");
  assert.deepEqual(k.answers, [{ run_date: DAY, question_id: "q1", engine: "chatgpt", answered: true, named: false, brands: ["X"], brands_ok: false }]);
  assert.deepEqual(k.serp, [{ run_date: DAY, keyword_id: "k1", position: null }]);
  // A table without the column: the first select is refused as PostgREST refuses it (42703).
  const base = fakeDb({ tracking_answers: answers.map(({ brands_ok: _, ...a }) => a), tracking_serp: [] });
  const from = base.db.from.bind(base.db);
  (base.db as unknown as { from: (t: string) => unknown }).from = (t: string) => {
    const b = from(t) as unknown as { select: (c: string) => unknown };
    const select = b.select.bind(b);
    b.select = (c: string) => (c.includes("brands_ok") ? { eq: () => ({ order: () => ({ range: () => Promise.resolve({ data: null, error: { message: "column tracking_answers.brands_ok does not exist" } }) }) }) } : select(c));
    return b;
  };
  const without = await readKept(base.db, "r1");
  assert.equal(without.answers.length, 1);
  assert.equal("brands_ok" in without.answers[0]!, false, "absent, as figures.ts reads a row from before the column");
});

test("census: the cron's pass is claimed and closed as before; a re-run is the same pass with what it kept", () => {
  const runner = readFileSync(new URL("./runner.ts", import.meta.url), "utf8");
  const body = runner.slice(runner.indexOf("export async function runTrackingDay"), runner.indexOf("async function mailFirstReading"));
  // The cron's claim is the one it always was; an ask is claimed only when that took nothing.
  assert.match(body, /\.eq\("status", "queued"\)\s*\.select\("id, client_domain_id, run_date, engines"\);/);
  assert.match(body, /const again = claimed\?\.\[0\] \? null : await claimRerun\(db, runId\);/);
  assert.match(body, /const rerun = again\?\.marker \?\? null;/);
  // Spend adds to what the run's earlier passes billed, so the daily cap still counts them.
  assert.match(body, /dfs_cost: Number\(\(prior\.dfs \+ spend\.dfs\)\.toFixed\(4\)\),\s*model_calls: prior\.calls \+ spend\.calls,/);
  // A close with no fields writes no status, line or finished_at.
  assert.match(body, /\.\.\.\(fields \? \{ \.\.\.fields, finished_at: new Date\(\)\.toISOString\(\) \} : \{\}\),/);
  // Only what did not come back is asked again; on the cron's pass kept is null and jobs is every.
  assert.match(body, /const kept = rerun \? await readKept\(db, runId\) : null;/);
  assert.match(body, /const askAgain = kept \? retryAnswers\(kept\) : null;/);
  assert.match(body, /const jobs = askAgain \? every\.filter\(\(\{ q, engine \}\) => askAgain\(q\.id as string, engine\)\) : every;/);
  assert.match(body, /mapWithConcurrency\(jobs, CONCURRENCY/);
  assert.match(body, /mapWithConcurrency\(keywordJobs, CONCURRENCY/);
  // A brand gap is read again from the text stored, in the same one extraction per engine, and only brands written.
  assert.match(body, /const read = \[\.\.\.answers, \.\.\.stored\]\.filter\(/);
  assert.match(body, /\.update\(hasBrandsOk\(kept!\) \? \{ brands, brands_ok: true \} : \{ brands \}\)/);
  assert.match(body, /const written = answerRows\.filter\(\(_, i\) => !keepsOld\(kept, answers\[i\]!\)\);/);
  assert.match(body, /const reads = every\.length \+ keywords\.length;/);
  // Never worse: refused or thrown, it leaves the run as it was (restored is null but for a stalled run).
  assert.match(body, /const out = rerun \? restored\(rerun, why\) : \{ status: "failed", error: refusal \};\s*await close\(out, rerun \? why : null\);/);
  assert.match(body, /await close\(rerun \? restored\(rerun, why\) : \{ status: "failed", error: message\(err\) \}, rerun \? why : null\);/);
  // The stall sweep closes running rows only: a failed or partial run being re-read is never one.
  const reap = runner.slice(runner.indexOf("export async function reapStalledTrackingRuns"));
  assert.match(reap, /\.eq\("status", "running"\)\s*\.lt\("started_at", cutoff\)/);
  const actions = readFileSync(new URL("../../app/admin/tracking/actions.ts", import.meta.url), "utf8");
  const runNow = actions.slice(actions.indexOf("export async function runNow"));
  assert.ok(runNow.indexOf("requestRerun(") > 0 && runNow.indexOf("requestRerun(") < runNow.indexOf("dispatchTrackingRun(run.id as string)"), "asked before it is dispatched");
  assert.match(runNow, /if \(!asked\.ok\) return \{ ok: false, message: asked\.message \};/);
  // The cap is read before anything is written.
  const request = runner.slice(runner.indexOf("export async function requestRerun"));
  assert.ok(request.indexOf("refuseRun(") < request.indexOf("askRerun("), "refused under the switch and the cap before the swap");
  // The admin page's button is the one the summary mail names (run-health.test.mts holds the mail to it).
  const page = readFileSync(new URL("../../app/admin/tracking/page.tsx", import.meta.url), "utf8");
  assert.match(page, /submit=\{rerunnable \? RERUN_BUTTON : "Run now"\}/);
  assert.equal(RERUN_BUTTON, "Re-run failed reads");
});

test("a staff change asks a complete run again as 'changed'; Run now still refuses it", async () => {
  const { changeVerdict } = await import("./rerun.ts");
  assert.deepEqual(changeVerdict(row({ status: "complete" }), DAY, at("08:00")), { ok: true, of: "changed" });
  assert.deepEqual(rerunVerdict(row({ status: "complete" }), DAY, at("08:00")), { ok: false, message: "Today's run is already complete." });
  assert.equal(changeVerdict(row({ status: "partial" }), DAY, at("08:00")).ok, true, "otherwise as rerunVerdict");
  assert.equal(changeVerdict(row({ status: "complete", run_date: "2026-10-01" }), DAY, at("08:00")).ok, false, "only today's");
  const m = nextMarker(row({ status: "complete" }), "changed", at("08:00"));
  assert.equal(m.landed, true, "a complete run already landed: first_reading is not sent twice");
  assert.equal(rerunMarker({ rerun: m })?.of, "changed");
  assert.equal(restored(m, "refused"), null, "a refused change leaves the run as it was");
});
