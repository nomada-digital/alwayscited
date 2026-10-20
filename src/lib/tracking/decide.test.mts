import assert from "node:assert/strict";
import { test } from "node:test";

import {
  EXTRACT_GRACE_MS,
  EXTRACT_RETRY_MIN_MS,
  type Extracted,
  dayAfter,
  extractWithRetry,
  extractionWindowMs,
  failureSummary,
  liveOn,
  missingColumn,
  slugFor,
  underLimit,
  readTrackingSettings,
  refuseRun,
  runOutcome,
  retryExtraction,
  shouldTrack,
  skipAlerts,
  skipReason,
  clusterLiveOn,
  signRun,
  stillUnread,
  trackingDay,
  upsellSetting,
  verifyRun,
} from "./decide.ts";

test("upgrade prompts: nomada or off need nothing; agency needs the agency's email (R94)", () => {
  assert.deepEqual(upsellSetting("nomada", "ignored@example.com"), { mode: "nomada", contact: null });
  assert.deepEqual(upsellSetting("off", ""), { mode: "off", contact: null });
  assert.deepEqual(upsellSetting("agency", " Hello@Example.com "), { mode: "agency", contact: "hello@example.com" });
  assert.ok("error" in upsellSetting("agency", ""), "agency without a contact is refused");
  assert.ok("error" in upsellSetting("agency", "not an email"));
  assert.ok("error" in upsellSetting("tracked", ""), "a tier is not a mode");
});

/**
 * T1's decisions, run (docs/tracked-dashboard-2026-09-29/BRIEF.md, 29 Sep 2026).
 */

test("a client with no active question is never tracked (danny.md 86)", () => {
  // The twelve rows client_domains already holds on 29 Sep: active by the
  // migration's default, no questions. None of them may be dispatched.
  assert.equal(shouldTrack({ id: "a", status: "active", started_on: null, activeQuestions: 0 }, "2026-09-30"), false);
  assert.equal(shouldTrack({ id: "a", status: "active", started_on: null, activeQuestions: 1 }, "2026-09-30"), true);
});

test("a paused, ended or not-yet-started client is not tracked", () => {
  assert.equal(shouldTrack({ id: "a", status: "paused", started_on: null, activeQuestions: 5 }, "2026-09-30"), false);
  assert.equal(shouldTrack({ id: "a", status: "ended", started_on: null, activeQuestions: 5 }, "2026-09-30"), false);
  assert.equal(shouldTrack({ id: "a", status: "active", started_on: "2026-10-01", activeQuestions: 5 }, "2026-09-30"), false);
  assert.equal(shouldTrack({ id: "a", status: "active", started_on: "2026-09-30", activeQuestions: 5 }, "2026-09-30"), true);
});

test("a stopped question is live up to the day before it stopped, and a new one from the day it was added", () => {
  assert.equal(liveOn({ added_on: "2026-09-10", stopped_on: null }, "2026-09-10"), true);
  assert.equal(liveOn({ added_on: "2026-09-11", stopped_on: null }, "2026-09-10"), false);
  assert.equal(liveOn({ added_on: "2026-09-01", stopped_on: "2026-09-10" }, "2026-09-09"), true);
  assert.equal(liveOn({ added_on: "2026-09-01", stopped_on: "2026-09-10" }, "2026-09-10"), false);
});

test("the tracking day is London's date, across both clock changes", () => {
  // 05:00 UTC in summer is 06:00 BST; in winter 05:00 GMT. Same date either way.
  assert.equal(trackingDay(new Date("2026-09-29T05:00:00Z")), "2026-09-29");
  assert.equal(trackingDay(new Date("2026-12-15T05:00:00Z")), "2026-12-15");
  // 23:30 UTC in summer is already tomorrow in London.
  assert.equal(trackingDay(new Date("2026-09-29T23:30:00Z")), "2026-09-30");
});

test("tracking settings fail closed", () => {
  assert.deepEqual(readTrackingSettings([]), { enabled: false, dailyCapUsd: 0 });
  assert.deepEqual(readTrackingSettings([{ key: "tracking_enabled", value: "true" }]), { enabled: false, dailyCapUsd: 0 });
  assert.deepEqual(
    readTrackingSettings([
      { key: "tracking_enabled", value: true },
      { key: "tracking_daily_cost_cap_usd", value: 25 },
    ]),
    { enabled: true, dailyCapUsd: 25 },
  );
  assert.ok(refuseRun({ enabled: false, dailyCapUsd: 25 }, 0));
  assert.ok(refuseRun({ enabled: true, dailyCapUsd: 25 }, 25));
  assert.ok(refuseRun({ enabled: true, dailyCapUsd: 0 }, 0), "no cap is no spend, not unlimited spend");
  assert.equal(refuseRun({ enabled: true, dailyCapUsd: 25 }, 24.99), null);
});

test("a run signature verifies only for the body and secret it was made with", () => {
  const body = JSON.stringify({ runId: "r1" });
  const sig = signRun(body, "s3cret");
  assert.ok(verifyRun(body, sig, "s3cret"));
  assert.ok(!verifyRun(JSON.stringify({ runId: "r2" }), sig, "s3cret"));
  assert.ok(!verifyRun(body, sig, "other"));
  assert.ok(!verifyRun(body, null, "s3cret"));
  assert.ok(!verifyRun(body, sig, ""), "an unset secret verifies nothing");
});

test("admin helpers: next day, slug, limit (T2)", () => {
  assert.equal(dayAfter("2026-09-29"), "2026-09-30");
  assert.equal(dayAfter("2026-09-30"), "2026-10-01");
  assert.equal(dayAfter("2026-12-31"), "2027-01-01");
  assert.equal(slugFor("www.tallyroo.com"), "tallyroo-com");
  assert.equal(slugFor("https://Example.com/path"), "example-com");
  assert.equal(underLimit(19, 20), true);
  assert.equal(underLimit(20, 20), false, "the 21st question is refused");
});

test("a run that read nothing successfully is failed, not a day of zeros", () => {
  assert.equal(runOutcome(80, 0), "complete");
  assert.equal(runOutcome(80, 3), "partial");
  assert.equal(runOutcome(80, 80), "failed");
  assert.equal(runOutcome(0, 0), "complete");
});

/**
 * 8 Oct 2026, audit reliability-1 / data-6 (critical): a brand extraction that
 * failed was stored as "no other brand named" on a run marked complete, which
 * raised the client's share of voice. These run the runner's decisions about it.
 */

/**
 * An extractor standing in for extractBrands: `fail` are the blocks whose batch fails, by text.
 * One request per pass, tallied on `billed` as extractBrands' countingFetch does (8 Oct 2026,
 * review: it returned `calls: 1`, and extractWithRetry summed what came back - which a pass
 * abandoned at the deadline never does).
 */
const extractor = (fail: (b: string) => boolean, calls: string[][] = []) => async (blocks: string[], billed: { calls: number }): Promise<Extracted> => {
  calls.push(blocks);
  billed.calls += 1;
  const failedBlocks = blocks.flatMap((b, i) => (fail(b) ? [i] : []));
  return {
    brands: blocks.filter((b) => !fail(b)).map((b) => ({ brand: `Rival of ${b}` })),
    failedBlocks,
    ...(failedBlocks.length ? { error: "language model error 529: Overloaded" } : {}),
  };
};

test("brand extraction: one engine's extraction throwing gives a partial run with every one of its answers unread", async () => {
  const plenty = () => 200_000;
  const chatgpt = await extractWithRetry(["a1", "a2", "a3"], async () => {
    throw new Error("ANTHROPIC_API_KEY must be set.");
  }, plenty);
  assert.deepEqual(chatgpt, { names: [], calls: 0, unread: [0, 1, 2], reason: "ANTHROPIC_API_KEY must be set." });
  const gemini = await extractWithRetry(["g1", "g2"], extractor(() => false), plenty);
  assert.deepEqual(gemini.unread, [], "the other engine is whole");

  const gaps = [{ engine: "chatgpt", unread: chatgpt.unread.length, answered: 3, reason: chatgpt.reason }];
  assert.equal(runOutcome(5, 0, gaps.length), "partial", "every read landed, so not failed - but not complete either");
  assert.equal(runOutcome(5, 0, 0), "complete", "no gap, no change");
  assert.equal(runOutcome(1, 0, 1), "partial", "one read that landed and an extraction that did not is partial, not failed");
  const error = failureSummary(5, [], gaps)!;
  assert.match(error, /brand extraction/);
  assert.equal(error, "brand extraction failed - chatgpt: other brands not read in 3 of 3 answers (ANTHROPIC_API_KEY must be set.)");
});

test("brand extraction: a failed batch is retried once, and only the answers it still misses are unread", async () => {
  const plenty = () => 200_000;
  // Retry lands: nothing unread, both passes billed, names from both.
  let first = true;
  const calls: string[][] = [];
  const healed = await extractWithRetry(["a", "b", "c"], async (blocks, billed) => {
    const out = await extractor((b) => first && b !== "a", calls)(blocks, billed);
    first = false;
    return out;
  }, plenty);
  assert.deepEqual(calls, [["a", "b", "c"], ["b", "c"]], "the retry is handed only the failed answers");
  assert.deepEqual(healed, { names: ["Rival of a", "Rival of b", "Rival of c"], calls: 2, unread: [], reason: "" });

  // Retry misses one: its index is mapped back to the engine's answers.
  const still = await extractWithRetry(["a", "b", "c", "d"], extractor((b) => b === "b" || b === "d"), plenty);
  assert.deepEqual(still.unread, [1, 3]);
  const half = await extractWithRetry(["a", "b", "c", "d"], (() => {
    let n = 0;
    return async (blocks: string[], billed: { calls: number }) => extractor((b) => (n === 0 ? b !== "a" : b === "d"))(blocks, billed).finally(() => n++);
  })(), plenty);
  assert.deepEqual(half.unread, [3], "b and c landed on the retry, d did not");
  assert.equal(half.reason, "language model error 529: Overloaded");

  // No time: no retry, and the first pass's misses stand.
  const tight: string[][] = [];
  const late = await extractWithRetry(["a", "b"], extractor((b) => b === "b", tight), () => EXTRACT_RETRY_MIN_MS - 1);
  assert.equal(tight.length, 1, "no second call");
  assert.deepEqual(late.unread, [1]);
});

test("brand extraction: the deadline is hard - a pass the SDK keeps asleep past it is abandoned, its answers unread and its requests billed (review, 8 Oct 2026)", async () => {
  // The SDK sleeps out a retry-after between its own retries with no signal, so an aborted
  // extraction could keep the run past 300s with the day's reads unstored. Stand-in: a pass
  // that sends two requests, then never comes back (the sleep), and ignores the signal.
  const asleep = async (_blocks: string[], billed: { calls: number }): Promise<Extracted> => {
    billed.calls += 2;
    return new Promise<Extracted>(() => {});
  };
  const plenty = () => 200_000;
  const t0 = Date.now();
  const first = await extractWithRetry(["a", "b", "c"], asleep, plenty, AbortSignal.timeout(20));
  assert.ok(Date.now() - t0 < 1_000, "returned at the deadline, not when the pass did");
  assert.deepEqual(first, { names: [], calls: 2, unread: [0, 1, 2], reason: "out of time" });

  // The retry asleep: the first pass's names stand, only the retried answers are unread.
  let n = 0;
  const retryAsleep = async (blocks: string[], billed: { calls: number }) => (n++ === 0 ? extractor((b) => b !== "a")(blocks, billed) : asleep(blocks, billed));
  const second = await extractWithRetry(["a", "b", "c"], retryAsleep, plenty, AbortSignal.timeout(20));
  assert.deepEqual(second, { names: ["Rival of a"], calls: 3, unread: [1, 2], reason: "out of time" });

  // Already past it: no pass starts, nothing is billed.
  const passes: string[][] = [];
  const none = await extractWithRetry(["a"], extractor(() => false, passes), plenty, AbortSignal.abort());
  assert.equal(passes.length, 0);
  assert.deepEqual(none, { names: [], calls: 0, unread: [0], reason: "out of time" });

  // Inside it, the signal changes nothing.
  assert.deepEqual(await extractWithRetry(["a", "b"], extractor((b) => b === "b"), plenty, AbortSignal.timeout(60_000)), { names: ["Rival of a"], calls: 2, unread: [1], reason: "language model error 529: Overloaded" });

  // An abandoned pass that throws later is handled, not an unhandled rejection that ends the process.
  const late = await extractWithRetry(["a"], async (_b, billed) => {
    billed.calls += 1;
    await new Promise((r) => setTimeout(r, 40));
    throw new Error("APIUserAbortError");
  }, plenty, AbortSignal.timeout(5));
  assert.deepEqual(late, { names: [], calls: 1, unread: [0], reason: "out of time" });
  await new Promise((r) => setTimeout(r, 60));
});

test("brand extraction: the retry rule, the index map and the deadline", () => {
  assert.equal(retryExtraction(0, 200_000), false, "nothing to retry");
  assert.equal(retryExtraction(3, EXTRACT_RETRY_MIN_MS), true);
  assert.equal(retryExtraction(3, EXTRACT_RETRY_MIN_MS - 1), false);
  assert.deepEqual(stillUnread([2, 5, 9], [0, 2]), [2, 9]);
  assert.deepEqual(stillUnread([2, 5], [4]), [], "an index past the retried list maps to nothing");
  assert.equal(extractionWindowMs(100_000), 100_000 + EXTRACT_GRACE_MS);
  assert.equal(extractionWindowMs(-5_000), EXTRACT_GRACE_MS - 5_000, "reads that overran the budget still get what is left of the grace");
  assert.equal(extractionWindowMs(-60_000), 1, "never zero or negative, which AbortSignal.timeout reads as abort now");
  assert.equal(extractionWindowMs(Number.NaN), EXTRACT_GRACE_MS);
  // 270s budget, 300s ceiling: the window never reaches past 290s of the run.
  assert.ok(270_000 + EXTRACT_GRACE_MS <= 290_000);
});

test("brand extraction: the error line puts the read failures first and the gap after", () => {
  const gaps = [
    { engine: "chatgpt", unread: 12, answered: 20, reason: "language model error 529: Overloaded" },
    { engine: "gemini", unread: 1, answered: 20, reason: "" },
  ];
  assert.equal(
    failureSummary(57, [{ engine: "google_aio", reason: "HTTP 429" }], gaps),
    "1 of 57 reads failed - google_aio: 1 x HTTP 429. brand extraction failed - chatgpt: other brands not read in 12 of 20 answers (language model error 529: Overloaded); gemini: other brands not read in 1 of 20 answers",
  );
  assert.equal(failureSummary(57, [], []), null);
  assert.equal(failureSummary(21, [{ engine: "google_aio", reason: "HTTP 429" }]), "1 of 21 reads failed - google_aio: 1 x HTTP 429", "without gaps, the line is as it was");
});

test("a missing brands_ok column is recognised in both of PostgREST's wordings, and nothing else is", () => {
  assert.equal(missingColumn({ message: "column tracking_answers.brands_ok does not exist" }, "brands_ok"), true, "a select");
  assert.equal(missingColumn({ message: "Could not find the 'brands_ok' column of 'tracking_answers' in the schema cache" }, "brands_ok"), true, "a write");
  // Review of the integration of audit packages A, B and C (8 Oct 2026): the overview's fallback is now in
  // read-shape.ts readAnswers, which catches the Error selectAllCounted throws, unwrapped. The answers panel's
  // read sees its own wrapped line: loadLatestAnswers' "could not read the latest answers: ...", and since DB-2
  // (9 Oct 2026) read-shape.ts readAnswerDay's "could not read the check's answers: ...".
  assert.equal(missingColumn(new Error("column tracking_answers.brands_ok does not exist"), "brands_ok"), true, "as selectAllCounted throws it, which readAnswers catches");
  assert.equal(missingColumn(new Error("could not read the latest answers: column tracking_answers.brands_ok does not exist"), "brands_ok"), true, "wrapped, as loadLatestAnswers' read threw it");
  assert.equal(missingColumn(new Error("could not read the check's answers: column tracking_answers.brands_ok does not exist"), "brands_ok"), true, "wrapped, as readAnswerDay's read throws it");
  assert.equal(missingColumn(new Error("could not read the answers: column tracking_answers.brands_ok does not exist"), "brands_ok"), true, "wrapped by paged()");
  assert.equal(missingColumn({ message: "column tracking_answers.brands does not exist" }, "brands_ok"), false, "another column");
  assert.equal(missingColumn({ message: "duplicate key value violates unique constraint" }, "brands_ok"), false);
  assert.equal(missingColumn(null, "brands_ok"), false);
});

test("20 Oct 2026: every skip has a reason, and shouldTrack is exactly 'no reason'", () => {
  const c = (o: Partial<{ status: string | null; started_on: string | null; activeQuestions: number }>) => ({ id: "a", status: "active", started_on: null, activeQuestions: 5, ...o });
  const day = "2026-10-20";
  assert.equal(skipReason(c({ status: "paused" }), day), "status is paused");
  assert.equal(skipReason(c({ status: "ended" }), day), "status is ended");
  assert.equal(skipReason(c({ status: null }), day), "status is not set");
  assert.equal(skipReason(c({ activeQuestions: 0 }), day), "no live prompts");
  assert.equal(skipReason(c({ started_on: "2026-10-21" }), day), "starts on 2026-10-21");
  assert.equal(skipReason(c({ started_on: "2026-10-19" }), day), null);
  for (const o of [{ status: "paused" }, { activeQuestions: 0 }, { started_on: "2026-10-21" }, {}]) {
    assert.equal(shouldTrack(c(o), day), skipReason(c(o), day) === null);
  }
});

test("20 Oct 2026: a skip is an alert when the client has live clusters, unless it ended or has not started", () => {
  const s = (o: object) => ({ id: "a", domain: "a.example", status: "paused", started_on: "2026-10-19", reason: "status is paused", liveClusters: 2, activeQuestions: 10, ...o });
  const day = "2026-10-20";
  assert.equal(skipAlerts([s({})], day).length, 1, "paused with live clusters: the 19-20 Oct case");
  assert.equal(skipAlerts([s({ status: "active", reason: "no live prompts", activeQuestions: 0 })], day).length, 1, "active, clusters but no live prompt");
  assert.equal(skipAlerts([s({ liveClusters: 0 })], day).length, 0, "nothing set up yet");
  assert.equal(skipAlerts([s({ status: "ended", reason: "status is ended" })], day).length, 0, "ended on purpose");
  assert.equal(skipAlerts([s({ status: "active", started_on: "2026-10-21", reason: "starts on 2026-10-21" })], day).length, 0, "starts tomorrow");
});

test("a cluster is live from its start, if it has one, until it is stopped", () => {
  assert.equal(clusterLiveOn({ started_on: null, stopped_on: null }, "2026-10-20"), true);
  assert.equal(clusterLiveOn({ started_on: "2026-10-21", stopped_on: null }, "2026-10-20"), false);
  assert.equal(clusterLiveOn({ started_on: "2026-10-19", stopped_on: "2026-10-20" }, "2026-10-20"), false);
});
