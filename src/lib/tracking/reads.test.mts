import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { firstTask, keywordRankRequest, SERP_DEPTH } from "../scan/dataforseo-request.ts";
import { parseGoogleAio, parseOrganic, rankOf, rankOfRead, serpFault, unwrapByCrumb } from "../scan/engines.ts";

import { billedCost, failureSummary, keywordOutcome, readFailureReason, readRetryDelay, runOutcome } from "./decide.ts";

/**
 * The 30 Sep 2026 re-run: both pilots partial, every failed read google_aio,
 * each stored with no text, cost 0 and no reason. A failed read is a throw;
 * these hold what a throw now does (retried where worth it, billed cost kept,
 * reason recorded) and what is not a failure at all (a SERP with no Overview).
 */

const runner = readFileSync(new URL("./runner.ts", import.meta.url), "utf8");

test("a SERP with no AI Overview is a silence: answered=false, no throw, and a run of silences is complete", () => {
  const serp = { item_types: ["organic"], items: [{ type: "organic", rank_group: 3, domain: "example.com", url: "https://example.com/a" }] };
  const read = parseGoogleAio(serp);
  assert.equal(read.answered, false);
  assert.equal(read.organic?.length, 1, "the organic results still come back with it");
  assert.equal(runOutcome(21, 0), "complete", "silences are not failures, so no partial");
});

test("retry: 429, 5xx and DataForSEO 5xxxx retry twice with backoff; bad requests, auth and timeouts do not", () => {
  const plenty = 200_000;
  assert.equal(readRetryDelay({ status: 429 }, 0, plenty), 1_000);
  assert.equal(readRetryDelay({ status: 429 }, 1, plenty), 3_000);
  assert.equal(readRetryDelay({ status: 429 }, 2, plenty), null, "two retries, then stop");
  assert.equal(readRetryDelay({ status: 503 }, 0, plenty), 1_000);
  assert.equal(readRetryDelay({ taskStatus: 50000 }, 0, plenty), 1_000);
  assert.equal(readRetryDelay({ taskStatus: 40501 }, 0, plenty), null, "a bad parameter is not retried");
  assert.equal(readRetryDelay({ status: 401 }, 0, plenty), null);
  assert.equal(readRetryDelay({ name: "TimeoutError" }, 0, plenty), null, "a timeout already spent its budget");
  assert.equal(readRetryDelay({ status: 429 }, 0, 9_000), null, "no retry that would not fit inside the run");
});

test("R137: 40101 (the search engine's own server error) retries twice on the same delays", () => {
  const plenty = 200_000;
  let thrown: unknown;
  try {
    firstTask({ tasks: [{ status_code: 40101, status_message: "Internal SE Server Error.", cost: 0 }] });
  } catch (err) {
    thrown = err;
  }
  assert.equal((thrown as { taskStatus?: number }).taskStatus, 40101);
  assert.equal(readRetryDelay(thrown, 0, plenty), 1_000);
  assert.equal(readRetryDelay(thrown, 1, plenty), 3_000);
  assert.equal(readRetryDelay(thrown, 2, plenty), null, "two retries, then stop");
  assert.equal(readRetryDelay(thrown, 0, 9_000), null, "not past the run's budget");
  assert.equal(readRetryDelay({ taskStatus: 40102 }, 0, plenty), null, "no results is not a server error");
});

test("R137: 40106 with items is a partial read, used; with none it is still a failure", () => {
  const items = [{ type: "ai_overview", items: [{ text: "Brightbook is good." }] }, { type: "organic", rank_group: 4, domain: "ledgerline.com", url: "https://ledgerline.com/" }];
  const task = firstTask({ tasks: [{ status_code: 40106, status_message: "Task completed with partial results.", cost: 0.002, result: [{ items }] }] });
  assert.equal(task.partial, true);
  assert.equal(parseGoogleAio(task.result?.[0]).answered, true, "the Overview that came back is used");
  assert.equal(firstTask({ tasks: [{ status_code: 20000, result: [{ items }] }] }).partial, undefined, "a whole read is not marked");
  assert.throws(() => firstTask({ tasks: [{ status_code: 40106, status_message: "partial", result: [{ items: [] }] }] }), /task 40106/);
  assert.throws(() => firstTask({ tasks: [{ status_code: 40106, status_message: "partial", result: null }] }), /task 40106/);
});

test("R137: on a partial read, not found is not measured; found is still a rank", () => {
  const organic = parseOrganic({ items: [{ type: "organic", rank_group: 4, domain: "ledgerline.com", url: "https://ledgerline.com/" }, { type: "organic", rank_group: 6, domain: "tallyroo.com", url: "https://tallyroo.com/" }] });
  assert.equal(rankOfRead(organic, "tallyroo.com", true), 6);
  assert.equal(rankOfRead(organic, "ownerledger.co", true), undefined, "may sit on the page that did not come back");
  // 3 Nov 2026: a whole read is ten organic results or more (engines.ts SERP_MIN_ORGANIC); this
  // two-result page is thin, so not found on it is not measured either. A full page keeps the miss.
  assert.equal(rankOfRead(organic, "ownerledger.co", false), undefined, "a thin page cannot call a miss");
  const full = parseOrganic({ items: Array.from({ length: 12 }, (_, i) => ({ type: "organic", rank_group: i + 1, domain: `site${i}.example`, url: `https://site${i}.example/` })) });
  assert.equal(rankOfRead(full, "ownerledger.co", false), null, "a whole read keeps not-in-top-20");
});

test("3 Nov 2026: a page of google.com/goto links is not ranked on, found or not", () => {
  const items = Array.from({ length: 19 }, (_, i) =>
    i % 3 === 0
      ? { type: "organic", rank_group: i + 1, domain: `site${i}.example`, url: `https://site${i}.example/` }
      : { type: "organic", rank_group: i + 1, domain: "google.com", url: `https://google.com/goto?url=CAES${i}` },
  );
  const organic = parseOrganic({ items });
  assert.equal(rankOfRead(organic, "site3.example", false), undefined, "a rank on the wrong page is not a rank");
  assert.equal(rankOfRead(organic, "absent.example", false), undefined, "nor is a miss");
  assert.deepEqual(keywordOutcome(undefined, "wrapped"), { failed: true, reason: "degraded SERP: Google's links came back wrapped, so the page is not ranked on" });
  // One google.com result is a real result (a Google product page), not a degraded read.
  const one = parseOrganic({ items: items.map((it, i) => (i === 1 ? it : { ...it, domain: `site${i}.example`, url: `https://site${i}.example/` })) });
  assert.equal(rankOfRead(one, "site4.example", false), 5);
  assert.equal(rankOfRead(one, "absent.example", false), null);
});

test("7 Nov 2026: a wrapped result is ranked on the site its breadcrumb names", () => {
  // As Google served a customer's keyword (UK) on 7 Nov: every link wrapped, every breadcrumb a site.
  const items = Array.from({ length: 20 }, (_, i) => ({
    type: "organic", rank_group: i + 1, domain: "google.com", url: `https://google.com/goto?url=CAES${i}`,
    breadcrumb: i === 6 ? "https://www.talent-boutique.example › household-staff › ..." : i === 2 ? "https://site2.example › a › b" : `https://site${i}.example`,
  }));
  const organic = parseOrganic({ items });
  assert.equal(serpFault(organic), null, "a page whose wrapped links all carry a breadcrumb can be ranked on");
  assert.equal(rankOfRead(organic, "talent-boutique.example", false), 7);
  assert.equal(organic[6].url, "https://www.talent-boutique.example/", "a breadcrumb cut short gives the home page");
  assert.equal(organic[2].url, "https://site2.example/a/b", "a whole one gives the page");
  assert.equal(rankOfRead(organic, "absent.example", false), null, "and a miss is a miss");
  assert.equal(unwrapByCrumb("Tiger Recruitment"), null, "no address in the breadcrumb: nothing to read");
  // Wrapped results with no breadcrumb are still the degraded page of 3 Nov.
  const bare = parseOrganic({ items: items.map((it, i) => (i < 3 ? { ...it, breadcrumb: undefined } : it)) });
  assert.equal(serpFault(bare), "wrapped");
});

test("a task DataForSEO failed keeps its status, its billed cost and a short reason", () => {
  let thrown: unknown;
  try {
    firstTask({ tasks: [{ status_code: 40501, status_message: "Invalid Field: 'location_code'.", cost: 0.002 }] });
  } catch (err) {
    thrown = err;
  }
  assert.ok(thrown instanceof Error);
  assert.equal((thrown as { taskStatus?: number }).taskStatus, 40501);
  assert.equal(billedCost(thrown), 0.002);
  assert.equal(readFailureReason(thrown), "task 40501 Invalid Field: 'location_code'.");
  assert.equal(billedCost({ cost: -1 }), 0);
  assert.equal(billedCost(new Error("no cost")), 0);
  assert.equal(readFailureReason(Object.assign(new Error("DataForSEO 429: slow down"), { status: 429 })), "HTTP 429");
  assert.equal(readFailureReason(Object.assign(new Error("aborted"), { name: "TimeoutError" })), "timeout");
});

test("the run's error line groups failures by engine and reason", () => {
  const four = Array.from({ length: 4 }, () => ({ engine: "google_aio", reason: "HTTP 429" }));
  assert.equal(failureSummary(21, four), "4 of 21 reads failed - google_aio: 4 x HTTP 429");
  assert.equal(
    failureSummary(57, [...four, { engine: "google_aio", reason: "timeout" }, { engine: "keyword", reason: "empty SERP: no organic results came back" }]),
    "6 of 57 reads failed - google_aio: 4 x HTTP 429; google_aio: 1 x timeout; keyword: 1 x empty SERP: no organic results came back",
  );
  assert.equal(failureSummary(21, []), null);
});

test("keyword reads: null is outside the top 20, an empty SERP is a failed read with a reason", () => {
  assert.deepEqual(keywordOutcome(null), { failed: false, rank: null });
  assert.deepEqual(keywordOutcome(7), { failed: false, rank: 7 });
  assert.deepEqual(keywordOutcome(undefined), { failed: true, reason: "empty SERP: no organic results came back" });
  // The real parser's contract feeding it: no organic results is undefined, results without the domain are null.
  assert.equal(rankOf(parseOrganic({ items: [] }), "example.com"), undefined);
  assert.equal(rankOf(parseOrganic({ items: [{ type: "organic", rank_group: 1, domain: "example.com" }] }), "tallyroo.com"), null);
});

test("keyword reads ask for a full SERP at depth 20 in the client's market", () => {
  const uk = (keywordRankRequest("bookkeeping services small business", "UK").body as Record<string, unknown>[])[0]!;
  const us = (keywordRankRequest("bookkeeping services small business", "US").body as Record<string, unknown>[])[0]!;
  assert.equal(SERP_DEPTH, 20);
  assert.deepEqual([uk.location_code, uk.language_code, uk.depth], [2826, "en", 20]);
  assert.deepEqual([us.location_code, us.language_code, us.depth], [2840, "en", 20]);
});

/** Where runner.ts marks a read failed, and whether it still collapses an empty SERP to null. */
export function runnerFaults(source: string): { failedMarks: number; silentNull: boolean; zeroCostFailure: boolean } {
  return {
    failedMarks: [...source.matchAll(/failed: true/g)].length,
    silentNull: /rank:\s*read\.rank\s*\?\?\s*null/.test(source),
    zeroCostFailure: /failed: true[^}]*cost: 0\b|cost: 0,[^}]*failed: true/.test(source),
  };
}

test("census: runner marks a read failed only after its retry loop, keeps billed cost, and never nulls an empty SERP", () => {
  assert.deepEqual(runnerFaults(runner), { failedMarks: 2, silentNull: false, zeroCostFailure: false });
  // 8 Oct 2026 (audit reliability-1 / data-6): the call was failureSummary(reads, failures). The
  // error line now also carries the brand extraction gaps, and they make the run partial.
  assert.match(runner, /failureSummary\(reads, failures, gaps\)/, "the run's error line is the grouped summary, brand gaps included");
  assert.match(runner, /runOutcome\(reads, failures\.length, gaps\.length\)/, "a brand gap makes the run partial");
  assert.match(runner, /readRetryDelay\(err, attempt, remainingMs\(\)\)/);
});

test("census: runner reads which answers brand extraction missed and stores them brands_ok=false (8 Oct 2026, audit reliability-1)", () => {
  // It read only the brands, so a failed batch was stored as naming no other brand on a complete run.
  // extractWithRetry (decide.ts, tested in decide.test.mts) reads failedBlocks and retries them.
  // 8 Oct 2026 (review): was `extractBrands(blocks, context, { signal })` with no signal for
  // extractWithRetry. The signal alone is no deadline - the SDK sleeps out a retry-after
  // without it - so extractWithRetry races each pass against it, and the requests are
  // tallied on `billed` as they leave, so a pass it stops waiting on is still billed.
  assert.match(runner, /await extractWithRetry\(.*\(blocks, billed\) => extractBrands\(blocks, context, \{ signal, billed \}\), remainingMs, signal\)/, "every extraction goes through the retry and the hard deadline, billed live");
  assert.match(runner, /spend\.calls \+= out\.calls;/, "and what it sent is on the run's model calls");
  assert.equal([...runner.matchAll(/extractBrands\(/g)].length, 1, "no extraction around it");
  assert.match(runner, /for \(const i of out\.unread\) unread\.add\(read\[i\]!\);/, "its unread answers are the engine's");
  assert.match(runner, /brands_ok: !unread\.has\(answers\[i\]!\)/, "an unread answer is stored brands_ok=false");
});

test("census probe: an extra failure mark, the old silent null and a zero-cost failure each fire", () => {
  assert.equal(runnerFaults(runner + "\nreturn { failed: true };").failedMarks, 3);
  assert.equal(runnerFaults("return { k, failed: false, rank: read.rank ?? null, url: read.url };").silentNull, true);
  assert.equal(runnerFaults("return { ...base, answered: false, response_text: null, cost: 0, failed: true };").zeroCostFailure, true);
});
