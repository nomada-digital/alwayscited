import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { SERP_DEPTH } from "../scan/dataforseo-request.ts";
import { compareText } from "./date-range.ts";
import { expandFixture, fixtureState } from "./fixture-mode.ts";

import {
  type AnswerRow,
  FIRST_WEEK_DAYS,
  UNRANKED_AS,
  addDays,
  basis,
  brandBoard,
  brandGaps,
  brandsRead,
  checkGrid,
  citedPages,
  comparisonLabel,
  comparisonRange,
  daysIn,
  firstCheckDay,
  firstReadComplete,
  firstWeek,
  formatDay,
  keywordRows,
  keywordsIn,
  keywordsOnPage1,
  liveThroughout,
  movers,
  namedRate,
  overview,
  pointsDelta,
  questionsNamed,
  resolveComparison,
  shareOfVoice,
  sparkPoints,
  ungroupedRead,
} from "./figures.ts";

/** T4's figures (docs/tracked-dashboard-2026-09-29/BRIEF.md, 29 Sep 2026). */

const a = (run_date: string, question_id: string, engine: string, named: boolean, brands: string[] = [], answered = true): AnswerRow => ({
  run_date,
  question_id,
  engine,
  answered,
  named,
  brands,
});

test("a rate carries its numerator and denominator, and has no percentage over nothing", () => {
  assert.deepEqual(namedRate([a("2026-09-02", "q1", "chatgpt", true), a("2026-09-02", "q2", "chatgpt", false)], { from: "2026-09-01", to: "2026-09-30" }), { num: 1, den: 2, pct: 50 });
  assert.deepEqual(namedRate([], { from: "2026-09-01", to: "2026-09-30" }), { num: 0, den: 0, pct: null });
});

test("DS18: a figure's basis line counts as the page prints counts, with thousands separated", () => {
  assert.equal(basis({ num: 2924, den: 8559 }, "mentions"), "2,924 of 8,559 mentions");
  assert.equal(basis({ num: 0, den: 0 }, "answers"), "0 of 0 answers");
  assert.equal(basis({ num: 12, den: 40 }, "answers"), "12 of 40 answers");
});

test("DS1: ungrouped prompts read in the range are counted - none when all are clustered, all when none are", () => {
  const r = { from: "2026-09-01", to: "2026-09-30" };
  const rows = [a("2026-09-02", "q1", "chatgpt", true), a("2026-09-02", "q2", "chatgpt", false), a("2026-09-03", "q3", "gemini", false, [], false), a("2026-08-30", "q4", "chatgpt", true)];
  const clustered = [{ id: "q1", cluster_id: "c1" }, { id: "q2", cluster_id: "c1" }, { id: "q3", cluster_id: "c1" }, { id: "q4", cluster_id: "c1" }];
  assert.equal(ungroupedRead(clustered, rows, r), 0, "clustered");
  const ungrouped = clustered.map((q) => ({ ...q, cluster_id: null }));
  assert.equal(ungroupedRead(ungrouped, rows, r), 2, "q3 unanswered and q4 outside the range are not read");
  const mixed = [clustered[0]!, { id: "q2", cluster_id: null }, { id: "q3", cluster_id: null }, { id: "q4", cluster_id: null }];
  assert.equal(ungroupedRead(mixed, rows, r), 1, "mixed");
  // In the mixed case the headline is overview()'s named rate, over every prompt's answers - Who is named's basis.
  const o = overview({ range: r, compare: "none", startedOn: null, engines: ["chatgpt", "gemini"], questions: [], answers: rows, serp: [], keywordCount: 0 });
  assert.deepEqual([o.named.num, o.named.den], [1, 2]);
});

test("an unanswered read is not in the denominator", () => {
  const r = namedRate([a("2026-09-02", "q1", "gemini", false, [], false), a("2026-09-02", "q1", "chatgpt", true)], { from: "2026-09-02", to: "2026-09-02" });
  assert.deepEqual([r.num, r.den], [1, 1]);
});

test("the previous period is the same length, just before; the month before is one calendar month back", () => {
  assert.deepEqual(comparisonRange({ from: "2026-09-02", to: "2026-09-29" }, "prev"), { from: "2026-08-05", to: "2026-09-01" });
  assert.deepEqual(comparisonRange({ from: "2026-03-31", to: "2026-03-31" }, "month"), { from: "2026-02-28", to: "2026-02-28" });
  assert.equal(comparisonRange({ from: "2026-09-02", to: "2026-09-29" }, "none"), null);
  assert.equal(daysIn({ from: "2026-09-02", to: "2026-09-29" }).length, 28);
});

test("like-for-like counts only questions live all of both periods", () => {
  const range = { from: "2026-09-15", to: "2026-09-28" };
  const qs = [
    { id: "old", added_on: "2026-08-01", stopped_on: null },
    { id: "new", added_on: "2026-09-20", stopped_on: null },
    { id: "gone", added_on: "2026-08-01", stopped_on: "2026-09-22" },
  ];
  const answers = [
    a("2026-09-05", "old", "chatgpt", false),
    a("2026-09-05", "gone", "chatgpt", true),
    a("2026-09-16", "old", "chatgpt", true),
    a("2026-09-21", "new", "chatgpt", true),
    a("2026-09-21", "gone", "chatgpt", false),
  ];
  assert.equal(liveThroughout(qs[0]!, { from: "2026-09-01", to: "2026-09-28" }), true);
  const o = overview({ range, compare: "prev", startedOn: "2026-08-01", engines: ["chatgpt"], questions: qs, answers, serp: [], keywordCount: 0 });
  assert.equal(o.lfl?.questions, 1);
  assert.deepEqual([o.lfl!.now.num, o.lfl!.now.den], [1, 1]);
  assert.deepEqual([o.lfl!.before.num, o.lfl!.before.den], [0, 1]);
  // Overall includes the added and the stopped question, so it differs.
  assert.deepEqual([o.named.num, o.named.den], [2, 3]);
  assert.equal(pointsDelta(o.lfl!.now, o.lfl!.before), 100);
});

test("a comparison reaching before tracking began is the first week; one inside the first week is hidden, with the line that says so", () => {
  // 8 Oct 2026 (audit data-10): this used to hide the comparison outright, so a client saw no change for its
  // first 55 days. Now the first week stands in, and only a range ending inside it has nothing to compare.
  const o = overview({ range: { from: "2026-09-02", to: "2026-09-29" }, compare: "prev", startedOn: "2026-09-10", engines: [], questions: [], answers: [], serp: [], keywordCount: 10 });
  assert.deepEqual(o.compare, { from: "2026-09-10", to: "2026-09-16" });
  assert.equal(o.compareKind, "start");
  assert.equal(o.compareHidden, null);
  // ON-3 (9 Oct 2026): a range ending inside the first week that holds a complete first reading and a day after
  // it is compared with that first reading, where it used to show nothing for half the trial.
  const complete = [{ run_date: "2026-09-10", status: "complete" }];
  const at = (range: { from: string; to: string }, runs: { run_date: string; status: string }[] = complete) =>
    overview({ range, compare: "prev", startedOn: "2026-09-10", engines: [], questions: [], answers: [], serp: [], keywordCount: 10, runs });
  const early = at({ from: "2026-09-02", to: "2026-09-15" });
  assert.deepEqual(early.compare, { from: "2026-09-10", to: "2026-09-10" });
  assert.equal(early.compareKind, "first");
  assert.equal(early.compareHidden, null);
  // A range ending on the first reading has nothing to compare yet, and says from when it will.
  const day1 = at({ from: "2026-09-02", to: "2026-09-10" });
  assert.equal(day1.compare, null);
  assert.equal(day1.lfl, null);
  assert.match(day1.compareHidden ?? "", /^Tracking began 10 Sep, so there is no earlier reading to compare with yet\. From 11 Sep the changes are against your first reading, 10 Sep\.$/);
  // One that starts after the first reading and ends inside the first week waits for the first week, as before.
  const inside = at({ from: "2026-09-12", to: "2026-09-15" });
  assert.equal(inside.compare, null);
  assert.match(inside.compareHidden ?? "", /^Tracking began 10 Sep, so there is no earlier period to compare with yet\. From 17 Sep the changes are against your first week\.$/);
  // Review of ON-3 (9 Oct 2026): a first check that was not complete - partial, failed, unread - is never the
  // comparison. The range waits for the first week, as before ON-3, and no caption names a first reading.
  for (const runs of [[{ run_date: "2026-09-10", status: "partial" }], [{ run_date: "2026-09-10", status: "failed" }], [{ run_date: "2026-09-10", status: "running" }], []]) {
    const o = at({ from: "2026-09-02", to: "2026-09-15" }, runs);
    assert.equal(o.compare, null, runs[0]?.status ?? "no run");
    assert.equal(o.compareKind, null);
    assert.match(o.compareHidden ?? "", /^Tracking began 10 Sep, so there is no earlier period to compare with yet\. From 17 Sep the changes are against your first week\.$/);
    assert.doesNotMatch(o.compareHidden ?? "", /first reading/);
  }
});

/**
 * Review of ON-3 (9 Oct 2026): a partial first check - only one engine answered on day 1, all four on days 2
 * and 3, each naming the client the same way every day - read "+67 pts vs your first reading": the engine
 * mix, not the client, moved. Partial or failed, the first check is not compared with; complete, it is.
 */
test("a partial or failed first check is never the first reading the chips compare with", () => {
  const start = "2026-10-01";
  const engines = ["chatgpt", "gemini", "perplexity", "claude"];
  // Claude names the client and the other three do not, every day; on day 1 only Claude answered.
  const answers: AnswerRow[] = [];
  const days: [string, string[]][] = [[start, ["claude"]], [addDays(start, 1), engines], [addDays(start, 2), engines]];
  for (const [day, read] of days) {
    for (const e of engines) answers.push(a(day, "q1", e, e === "claude", [], read.includes(e)));
  }
  const questions = [{ id: "q1", added_on: start, stopped_on: null }];
  const range = { from: start, to: addDays(start, 2) };
  const run = (status: string) => [{ run_date: start, status }, { run_date: addDays(start, 1), status: "complete" }, { run_date: addDays(start, 2), status: "complete" }];
  const read = (status: string) => overview({ range, compare: "prev", startedOn: start, engines, questions, answers, serp: [], keywordCount: 0, runs: run(status) });
  const partial = read("partial");
  assert.equal(partial.compare, null, "not compared with a first check that read one engine");
  assert.equal(partial.change, null, "so no +67 pts");
  const failed = read("failed");
  assert.equal(failed.compare, null);
  assert.doesNotMatch(failed.compareHidden ?? "", /first reading/, "no caption naming a reading that does not exist");
  // Had day 1 been complete - every engine read - the like-for-like change is the engine mix's own: none.
  const whole = answers.map((x) => (x.run_date === start ? { ...x, answered: true } : x));
  const complete = overview({ range, compare: "prev", startedOn: start, engines, questions, answers: whole, serp: [], keywordCount: 0, runs: run("complete") });
  assert.equal(complete.compareKind, "first");
  assert.equal(complete.change?.named, 0);
});

test("questions named, share of voice with rank, keywords on page 1", () => {
  const r = { from: "2026-09-01", to: "2026-09-30" };
  const rows = [a("2026-09-02", "q1", "chatgpt", true, ["Acme"]), a("2026-09-02", "q2", "chatgpt", false, ["Acme", "Bolt"]), a("2026-09-03", "q2", "gemini", false, ["acme"])];
  assert.deepEqual(questionsNamed(rows, r), { num: 1, den: 2, pct: 50 });
  const sov = shareOfVoice(rows, r);
  assert.deepEqual([sov.num, sov.den, sov.rank, sov.brands], [1, 5, 2, 3]);
  const kw = keywordsOnPage1(
    [
      { run_date: "2026-09-01", keyword_id: "k1", position: 14 },
      { run_date: "2026-09-02", keyword_id: "k1", position: 8 },
      { run_date: "2026-09-02", keyword_id: "k2", position: 3 },
      { run_date: "2026-09-02", keyword_id: "k3", position: null },
    ],
    r,
    10,
  );
  // 8 Oct 2026 (audit data-7): k3, read and outside the top 20, counts as #21 - it was left out, averaging 5.5.
  assert.deepEqual([kw.num, kw.den, kw.avg, kw.ranked, kw.unranked], [2, 10, 10.7, 2, 1]);
  assert.equal(UNRANKED_AS, SERP_DEPTH + 1, "one place below the deepest read");
});

test("movers sort by the size of the change; the brand board counts the client as one brand among them", () => {
  const now = { from: "2026-09-15", to: "2026-09-28" };
  const was = { from: "2026-09-01", to: "2026-09-14" };
  const rows = [
    a("2026-09-02", "up", "chatgpt", false, ["Acme"]),
    a("2026-09-16", "up", "chatgpt", true),
    a("2026-09-02", "flat", "gemini", true),
    a("2026-09-16", "flat", "gemini", true, ["Acme", "Bolt"]),
  ];
  const m = movers(rows, now, was);
  assert.deepEqual(m.map((x) => [x.id, x.delta]), [["up", 100], ["flat", 0]]);
  assert.deepEqual(m[0]!.engines, ["chatgpt"]);
  const board = brandBoard(rows, now, was, "Tally");
  assert.deepEqual(board.map((b) => [b.name, b.you, b.share.num, b.share.den]), [["Tally", true, 2, 4], ["Acme", false, 1, 4], ["Bolt", false, 1, 4]]);
  assert.equal(board[0]!.delta, 0);
});

test("keyword rows: latest position, places gained over the range, one point per day", () => {
  const k = keywordRows(
    [
      { run_date: "2026-09-01", keyword_id: "k", position: 11 },
      { run_date: "2026-09-03", keyword_id: "k", position: 7 },
    ],
    { from: "2026-09-01", to: "2026-09-03" },
  ).get("k")!;
  // ON-3 (9 Oct 2026): the row also names the first reading its change is against, so the chip can say so.
  assert.deepEqual(k, { position: 7, change: 4, series: [11, null, 7], since: "2026-09-01" });
});

test("cited pages: counted per page, engines listed, the client's own site marked", () => {
  const pages = citedPages(
    [
      { run_date: "2026-09-02", engine: "chatgpt", citations: [{ source_domain: "www.tallyroo.com", url: "https://www.tallyroo.com/pricing/" }, { source_domain: "ledgerline.com", url: null }] },
      { run_date: "2026-09-02", engine: "gemini", citations: [{ source_domain: "tallyroo.com", url: "https://tallyroo.com/pricing" }] },
    ],
    { from: "2026-09-01", to: "2026-09-30" },
    "tallyroo.com",
  );
  assert.deepEqual(pages, [
    { page: "tallyroo.com/pricing", count: 2, engines: ["chatgpt", "gemini"], yours: true },
    { page: "ledgerline.com", count: 1, engines: ["chatgpt"], yours: false },
  ]);
});

test("the check grid has one cell per engine per day, null where nothing ran", () => {
  const g = checkGrid([a("2026-09-02", "q1", "chatgpt", true), a("2026-09-02", "q2", "chatgpt", false)], { from: "2026-09-01", to: "2026-09-02" }, ["chatgpt", "gemini"]);
  assert.deepEqual(g.chatgpt, [null, { num: 1, den: 2, pct: 50 }]);
  assert.deepEqual(g.gemini, [null, null]);
});

test("sparkPoints: one point a week on the keyword's own scale, better positions higher (R104)", () => {
  const days = (ps: (number | null)[]) => ps.flatMap((p) => Array<number | null>(7).fill(p));
  const climb = sparkPoints(days([11, 10, 8, 7]));
  assert.equal(climb.length, 4);
  assert.deepEqual(climb.map((p) => p.x), [2, 22, 42, 62]);
  assert.equal(climb[0]!.y, 18);
  assert.equal(climb[3]!.y, 2);
  assert.ok(climb[1]!.y! > climb[2]!.y!, "a climb slopes up across the cell, not flat");
  assert.ok(sparkPoints(days([3, 3, 3, 3])).every((p) => p.y === 10), "unchanged draws level through the middle");
  assert.equal(sparkPoints(days([5, null, 6, 4]))[1]!.y, null, "a week outside the top 20 is a gap");
});

test("a failed google_aio read (stored answered=false) never counts as not named, and leaves like-for-like unchanged (30 Sep 2026)", () => {
  const questions = [{ id: "q1", added_on: "2026-09-01", stopped_on: null }];
  const base = {
    range: { from: "2026-09-29", to: "2026-09-30" },
    compare: "prev" as const,
    startedOn: "2026-09-01",
    engines: ["google_aio", "chatgpt"],
    questions,
    serp: [],
    keywordCount: 0,
  };
  const good = [
    a("2026-09-27", "q1", "chatgpt", true),
    a("2026-09-28", "q1", "chatgpt", false),
    a("2026-09-29", "q1", "chatgpt", true),
    a("2026-09-30", "q1", "chatgpt", true),
  ];
  // The runner stores a failed read as answered=false, named=false.
  const failed = a("2026-09-30", "q1", "google_aio", false, [], false);
  const clean = overview({ ...base, answers: good });
  const withFail = overview({ ...base, answers: [...good, failed] });
  assert.deepEqual(withFail.named, clean.named, "the failed read is not in the denominator");
  assert.deepEqual(withFail.named, { num: 2, den: 2, pct: 100 });
  assert.deepEqual(withFail.lfl, clean.lfl, "like-for-like reads the same with or without the failed read");
  assert.deepEqual(withFail.grid.google_aio, [null, null], "a day with only a failed read shows no check, not a 0%");
  // Positive control: the same row counted as an answer would have moved the rate.
  const asAnswer = overview({ ...base, answers: [...good, { ...failed, answered: true }] });
  assert.notDeepEqual(asAnswer.named, clean.named);
});

test("8 Oct 2026 (audit reliability-1 / data-6): an answer whose other brands were not read leaves share of voice and the board as they were, not inflated", () => {
  const r = { from: "2026-10-01", to: "2026-10-07" };
  const read = [a("2026-10-01", "q1", "gemini", true, ["Acme", "Bolt"]), a("2026-10-02", "q1", "gemini", false, ["Acme"])];
  // ChatGPT's extraction failed on 2 Oct: whether it named the client is known, the other brands are not.
  const unread: AnswerRow = { ...a("2026-10-02", "q1", "chatgpt", true), brands_ok: false };
  const clean = shareOfVoice(read, r);
  assert.deepEqual([clean.num, clean.den, clean.pct], [1, 4, 25]);
  assert.deepEqual(shareOfVoice([...read, unread], r), clean, "out of numerator and denominator alike");
  assert.deepEqual(brandBoard([...read, unread], r, null, "Tally"), brandBoard(read, r, null, "Tally"));
  // Positive control: stored as it was before 8 Oct - brands [] read as "no other brand" - the share rises.
  const asBefore = shareOfVoice([...read, { ...unread, brands_ok: true }], r);
  assert.deepEqual([asBefore.num, asBefore.den, asBefore.pct], [2, 5, 40]);
  // The named rate still counts it: whether the client was named does not hang on the extraction.
  assert.deepEqual(namedRate([...read, unread], r), { num: 2, den: 3, pct: 67 });
  const out = [{ ...unread, run_date: "2026-09-30" }, { ...unread, engine: "gemini", answered: false }];
  assert.deepEqual(brandGaps([...read, unread, ...out], r), [{ day: "2026-10-02", engine: "chatgpt", answers: 1 }], "answered and in range only");
  assert.equal(brandsRead({}), true, "a row from before the column, or the fixture's, is read");
  assert.equal(brandsRead({ brands_ok: true }), true);
  assert.equal(brandsRead({ brands_ok: false }), false);
});

const fx = expandFixture(JSON.parse(readFileSync(new URL("./fixture.json", import.meta.url), "utf8")));
const fxRange = { from: addDays(fx.today, -27), to: fx.today };
const fxOverview = (data: typeof fx.data, startedOn = fx.client.started_on, range = fxRange) =>
  overview({ range, compare: "prev", startedOn, engines: [], questions: data.questions, answers: data.answers, serp: data.serp, keywordCount: keywordsIn(data.keywords, range), keywords: data.keywords });

test("8 Oct 2026 (audit data-4): every key figure's change is like-for-like - the 40 prompts tracked all of both periods", () => {
  const o = fxOverview(fx.data);
  assert.equal(o.lfl?.questions, 40);
  // Answers naming you: 27% overall, 28% vs 25% like-for-like - the chip is +3, as the headline's.
  assert.deepEqual([o.named.pct, o.lfl!.now.pct, o.lfl!.before.pct], [27, 28, 25]);
  assert.equal(o.change?.named, 3);
  assert.equal(pointsDelta(o.named, o.namedBefore), 2, "the overall difference the flat strip used to print beside the headline's +3");
  // Prompts named in: 37 of 40 in both periods - no change, where the strip read "40 of 45, was 37 of 40".
  assert.deepEqual([o.change!.questions!.now.num, o.change!.questions!.now.den, o.change!.questions!.before.num, o.change!.questions!.before.den], [37, 40, 37, 40]);
  // Share of voice: 16% vs 14% on the same prompts (+2); all prompts read +1.
  assert.equal(o.change?.sov, 2);
  assert.equal(pointsDelta(o.sov, o.sovBefore), 1);
  // Keywords on page 1: the 8 keywords tracked all of both periods, 5 now and 3 then.
  assert.deepEqual(o.change?.keywords, { now: 5, before: 3, of: 8 });
  // No comparison, no change.
  assert.equal(overview({ range: fxRange, compare: "none", startedOn: fx.client.started_on, engines: [], questions: fx.data.questions, answers: fx.data.answers, serp: fx.data.serp, keywordCount: 9 }).change, null);
});

test("8 Oct 2026 (audit data-10): a young client compares with its first week - its first seven days of checks", () => {
  const y = fixtureState(fx, { TRACKING_FIXTURE_STATE: "young" });
  const start = y.client.started_on;
  assert.equal(firstCheckDay(start, y.data.questions), start, "its prompts were asked from its start day");
  const c = resolveComparison(fxRange, "prev", start, firstCheckDay(start, y.data.questions));
  const read = [...new Set(y.data.answers.filter((a) => a.answered).map((a) => a.run_date))].sort();
  assert.equal(c.kind, "start");
  assert.deepEqual(c.range, firstWeek(start));
  assert.deepEqual(daysIn(c.range!), read.slice(0, FIRST_WEEK_DAYS), "the first 7 read days");
  assert.equal(comparisonLabel(c.range!, c.kind), "vs your first week, 20 Sep - 26 Sep");
  const o = fxOverview(y.data, start);
  assert.equal(o.compareKind, "start");
  assert.equal(o.compareHidden, null);
  assert.ok(o.lfl && o.lfl.questions >= 40, "every prompt it began with is like-for-like");
  assert.notEqual(o.change?.named, null, "a change to show in the trial, where before there was none until day 56");
  // The previous period, where it exists, is untouched: an older client still compares with the 28 days before.
  assert.deepEqual(resolveComparison(fxRange, "prev", fx.client.started_on), { range: { from: "2026-08-05", to: "2026-09-01" }, kind: "prev", hidden: null });
  assert.deepEqual(resolveComparison(fxRange, "none", start), { range: null, kind: null, hidden: null });
  // ON-3 (9 Oct 2026): before its first week is over it is compared with its first reading - its run complete,
  // as the fixture's are (firstReadComplete) - and says which.
  assert.equal(firstReadComplete(y.data.runs, start), true);
  const day3 = resolveComparison({ from: addDays(start, -25), to: addDays(start, 2) }, "prev", start, start, firstReadComplete(y.data.runs, start));
  assert.deepEqual(day3, { range: { from: start, to: start }, kind: "first", hidden: null });
  assert.equal(comparisonLabel(day3.range!, day3.kind), "vs your first reading, 20 Sep");
  // Its first check not complete (review, same day): nothing to compare until the first week is over, as before ON-3.
  const unread = resolveComparison({ from: addDays(start, -25), to: addDays(start, 2) }, "prev", start, start, false);
  assert.equal(unread.range, null);
  assert.match(unread.hidden ?? "", /From 27 Sep the changes are against your first week\.$/);
  // On its first day there is nothing to compare yet, and it says when there will be.
  const day1 = resolveComparison({ from: addDays(start, -27), to: start }, "prev", start, start, true);
  assert.equal(day1.range, null);
  assert.match(day1.hidden ?? "", /From 21 Sep the changes are against your first reading, 20 Sep\.$/);
});

test("8 Oct 2026 (review of data-10): the date picker names the first week every page reads, whatever the first check read", () => {
  // The first week began on the first day an answer came back, which a page held only when its comparison
  // reached back; the picker read started_on. A client whose first check read nothing then saw "your first
  // week, 20 Sep - 26 Sep" in the picker and "vs your first week, 21 Sep - 27 Sep" on the page. Both now read
  // firstCheckDay - started_on and the prompts - which every page holds whatever the range.
  const y = fixtureState(fx, { TRACKING_FIXTURE_STATE: "young" });
  const start = y.client.started_on;
  const nothingRead = { ...y.data, answers: y.data.answers.map((a) => (a.run_date === start ? { ...a, answered: false, named: false } : a)) };
  const lateSetup = { ...y.data, questions: y.data.questions.map((q) => ({ ...q, added_on: q.added_on < addDays(start, 2) ? addDays(start, 2) : q.added_on })) };
  const cases = [
    { name: "the first check read nothing", data: nothingRead, startedOn: start, range: fxRange, week: "20 Sep - 26 Sep" },
    { name: "the default fixture's last 90 days", data: fx.data, startedOn: fx.client.started_on, range: { from: addDays(fx.today, -89), to: fx.today }, week: "10 Jun - 16 Jun" },
    { name: "a signup whose prompts came two days after its start", data: lateSetup, startedOn: start, range: fxRange, week: "22 Sep - 28 Sep" },
  ];
  for (const c of cases) {
    const o = fxOverview(c.data, c.startedOn, c.range);
    assert.equal(o.compareKind, "start", c.name);
    assert.equal(comparisonLabel(o.compare!, o.compareKind), `vs your first week, ${c.week}`, `${c.name}: the page`);
    assert.equal(compareText(c.range, "prev", c.startedOn, firstCheckDay(c.startedOn, c.data.questions)), `Tracking began ${formatDay(c.startedOn)}, so this compares with your first week, ${c.week}.`, `${c.name}: the picker`);
  }
  // The late signup's prompts are all like-for-like against a week that began when they were first asked.
  assert.ok((fxOverview(lateSetup, start).lfl?.questions ?? 0) >= 40);
  // Its previous period is not used while it reaches back before the first check, even once it is after started_on.
  const later = { from: addDays(start, 30), to: addDays(start, 30 + 27) }; // its previous period begins on start + 2
  assert.equal(resolveComparison(later, "prev", start, addDays(start, 2)).kind, "prev");
  assert.equal(resolveComparison(later, "prev", start, addDays(start, 4)).kind, "start");
  // 18 Oct 2026, brief 2d: "every date picker that compares is handed the page's first check day" walked
  // src/components/app's <DatePicker>s (floor 5); they retired with /app, every /app address 308s to the dashboards
  // host, whose DateControl picks a day and compares nothing. compareText and resolveComparison above still hold.
});

test("8 Oct 2026 (merge of audit packages A and B): the like-for-like share of voice change leaves unread brands out, as the figure does", () => {
  // B's chips count only the like-for-like prompts; A's rule leaves an answer whose other brands were not read
  // out of every brand figure. The change is both: like-for-like prompts, brand-read answers.
  const u = fixtureState(fx, { TRACKING_FIXTURE_STATE: "brands-unread" }).data;
  const o = fxOverview(u);
  assert.ok(o.compare && o.lfl, "the default range compares");
  const lfl = new Set(u.questions.filter((q) => liveThroughout(q, { from: o.compare!.from, to: fxRange.to })).map((q) => q.id));
  const read = u.answers.filter(brandsRead);
  assert.ok(read.length < u.answers.length, "today's ChatGPT answers are unread");
  assert.equal(o.change?.sov, pointsDelta(shareOfVoice(read, fxRange, lfl), shareOfVoice(read, o.compare!, lfl)));
  assert.deepEqual(o.sov, shareOfVoice(read, fxRange), "the figure itself, as before");
  // Positive control: the same answers counted as read, naming no one else, move the change.
  const asBefore = fxOverview({ ...u, answers: u.answers.map((a) => ({ ...a, brands_ok: true })) });
  assert.notEqual(asBefore.change?.sov, o.change?.sov);
  // The named and prompts changes do not hang on brands: an unread answer still says whether the client was named.
  assert.equal(o.change?.named, fxOverview(fx.data).change?.named);
  assert.deepEqual(o.change?.questions, fxOverview(fx.data).change?.questions);
});
