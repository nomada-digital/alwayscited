import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { code, sourceFiles } from "../source-read.mts";
import { RETRY_WAITS, countingFetch, isRetryable, withRetry } from "./retry-policy.ts";

/**
 * Every model call this product makes goes through two retry layers and one
 * counter, and until now none of the three had a check on it: `withRetry` lived
 * in `anthropic.ts`, which opens with `import "server-only"` and imports the
 * SDK, so `node --test` could not load the file.
 *
 * The defect that was in the tree, and what makes this a spend question rather
 * than a logging one: the counter was incremented once per `withRetry` ATTEMPT,
 * while `new Anthropic()` retries 408/409/429/5xx/connection twice of its own
 * inside each attempt (`maxRetries` defaults to 2). So a 529 storm sent up to
 * nine requests and recorded three. `anthropicCallsSince` sums that column into
 * the daily call ceiling, and `spend.ts` says in its own header that the
 * failure that puts a scan on that ceiling "is the repeating kind, which is
 * precisely when this ceiling is the only thing left" - so the ceiling
 * under-reported by 3x on the day it exists for.
 *
 * ## The reader walk is first on purpose
 *
 * A value rule over the helper this run wrote would have passed on the tree
 * that carried the defect, because that tree never called it. Rules 1 to 3 walk
 * the shipped source and ask what reaches a model, so they fail on the tree as
 * it was. The behavioural tests below them are the cheaper half.
 *
 * Source is read through `code`, so a `messages.parse` quoted in a doc comment
 * is not a call and the prose in `anthropic.ts` describing this defect does not
 * satisfy the check written for it.
 */

const ROOT = new URL("../../../", import.meta.url).pathname;
const src = (f: string) => code(readFileSync(ROOT + f, "utf8"));

/**
 * Every `X.messages.<method>(` in a file, as the expression to the left of it
 * paired with the method.
 *
 * **Not `messages.parse` alone.** The first draft of this walk matched that one
 * method, and it was the refill this file's own method predicts: rule 1 counts
 * five `parse` calls, so a sixth call site written `messages.create(` or
 * `messages.stream(` leaves that count at five and is read by rule 2 not at
 * all. The sweep written to stop an uncounted request on the wire would have
 * waved through the cheapest way to put one there, in the flattering direction.
 * The method is the thing that varies; `messages` is the thing that bills.
 *
 * The receiver is what the rules below are about - whether the call was made
 * through a client carrying the billing accumulator - so it is read per CALL
 * rather than per file. `contact.test.mts` records why: a rule satisfied by
 * "the right idiom appears somewhere in this module" is satisfied by the
 * correct call while the one beside it drops it, and this file has five.
 */
function modelCalls(body: string): { receiver: string; method: string }[] {
  const re = /([A-Za-z_$][\w$]*\([^()]*\)|[A-Za-z_$][\w$]*)\.(?:beta\.)?messages\.(\w+)\s*\(/g;
  return [...body.matchAll(re)].map((m) => ({ receiver: m[1]!, method: m[2]! }));
}

/** Every shipped file that puts a request on the wire to Anthropic. */
function modelCallFiles(): string[] {
  return sourceFiles(ROOT).filter((f) => modelCalls(src(f)).length > 0);
}

// ------------------------------------------------------------- the reader walk

test("rule 1: the walk finds the model calls it is written about", () => {
  // A floor, not a count. A rename that hides every call reads as a clean tree
  // in all three rules below, which is the flattering direction.
  const files = modelCallFiles();
  assert.deepEqual(files, ["src/lib/scan/anthropic.ts"], "the set of files that call a model has changed");
  const calls = modelCalls(src(files[0]!));
  // Six since 27 Sep 2026: `keywordCandidates`, the decision being Danny's
  // search-volume reversal (R38/R39, docs/rules.md) - one batched call a scan
  // for candidate Google head keywords. Seven since 30 Sep 2026:
  // `clusterKeywordCandidates`, the decision being BRIEF-3 C1 step 1 (Danny,
  // 29 Sep 2026, danny.md lines 96-97 and 109) - one call a scan for the
  // cluster keyword's candidates. Eight since 1 Oct 2026: `readCoverage`, the
  // decision being R140 (Danny, 30 Sep 2026, danny.md lines 128-133) - one
  // call per /coverage-check draft, behind Turnstile, checkCeilings and a
  // per-IP draft cap, debited to model_call_debits. Ten since 13 Oct 2026, DIY
  // P1: classifyPages and writeReoptExample, Danny's 12 Oct brief (spec 10
  // section 5.3) - each reached only through src/lib/diy/core/model.ts, which
  // reserves it on the DIY ledger's model door and debits model_call_debits
  // with billed.calls. Both are `beta.messages.parse` on `anthropic(billed)`, so
  // the method set and rules 2-4 stand unchanged. An eleventh needs its own.
  assert.equal(calls.length, 10, "anthropic.ts makes ten model calls; an eleventh needs a decision, not a default");
  assert.deepEqual(
    [...new Set(calls.map((c) => c.method))],
    ["parse"],
    "a model call by another method bills the same and must be counted the same",
  );
});

test("rule 2: every model call is made through a client carrying the billing accumulator", () => {
  // The defect this refuses is the cheap one: a new call site written as
  // `anthropic().messages.parse(...)`, which works, returns the right answer,
  // and bills nothing. `readBrand` was exactly that before it took a counter.
  for (const file of modelCallFiles()) {
    for (const { receiver, method } of modelCalls(src(file))) {
      assert.equal(
        receiver,
        "anthropic(billed)",
        `${file}: \`${receiver}.messages.${method}(\` puts a request on the wire that no ceiling counts`,
      );
    }
  }
});

test("rule 3: the counting client wraps fetch rather than counting attempts", () => {
  // The property no behavioural test in this file can see, because it is about
  // WHERE the counter sits. Counting above the SDK counts attempts; only a
  // counter handed to the SDK as its `fetch` counts requests. Tidying this back
  // to a `billed.calls += 1` in `withRetry` typechecks, passes every
  // behavioural test below, and silently restores the 3x undercount.
  const body = src("src/lib/scan/anthropic.ts");
  assert.match(
    body,
    /withOptions\(\{\s*fetch:\s*countingFetch\(billed,/,
    "the client handed a model call must wrap fetch with countingFetch",
  );
  assert.doesNotMatch(
    body,
    /billed\.calls\s*(\+\+|\+=)/,
    "anthropic.ts must not increment the accumulator itself - countingFetch is the one place a request is counted",
  );
  assert.doesNotMatch(
    src("src/lib/scan/retry-policy.ts").replace(/countingFetch[\s\S]*$/, ""),
    /billed\.calls\s*(\+\+|\+=)/,
    "withRetry must not count: it sees attempts, and the SDK retries inside each one",
  );
});

test("rule 4: nothing constructs an Anthropic client outside the one gate", () => {
  // `baseClient` is where the key check lives and where the retry defaults are
  // decided. A second `new Anthropic()` anywhere is a second set of defaults
  // and a client no accumulator can be attached to.
  const found = sourceFiles(ROOT).filter((f) => /new\s+Anthropic\s*\(/.test(src(f)));
  assert.deepEqual(found, ["src/lib/scan/anthropic.ts"]);
  const constructions = src(found[0]!).match(/new\s+Anthropic\s*\(([^)]*)\)/g) ?? [];
  assert.equal(
    constructions.length,
    1,
    "one construction, so one place the SDK's maxRetries default is in force",
  );
  // And it takes no options. `countingFetch` wraps the GLOBAL fetch, on the
  // grounds that the SDK's `options.fetch ?? getDefaultFetch()` makes the two
  // the same function while nothing is passed. The client's own `fetch` is
  // private and cannot be read back to check, so the premise is held here: give
  // the constructor a `fetch` and the wrapper is wrapping the wrong one, and
  // every request goes out through a function this counter never sees.
  assert.equal(constructions[0], "new Anthropic()");
});

// --------------------------------------------------------------- the behaviour

test("countingFetch counts one per request, not one per outcome", async () => {
  const billed = { calls: 0 };
  const f = countingFetch(billed, () => Promise.resolve("ok" as unknown as Response));
  await f("https://example.invalid/1");
  await f("https://example.invalid/2");
  assert.equal(billed.calls, 2);
});

test("countingFetch counts a request that never came back", async () => {
  // The direction that matters: a request billed by the vendor and lost by us.
  const billed = { calls: 0 };
  const f = countingFetch(billed, () => Promise.reject(new Error("socket hang up")));
  await assert.rejects(() => f("https://example.invalid/"), /socket hang up/);
  assert.equal(billed.calls, 1, "a request that failed still went out");
});

test("countingFetch passes its arguments and its answer straight through", async () => {
  const seen: unknown[] = [];
  const answer = { ok: true } as unknown as Response;
  const f = countingFetch({ calls: 0 }, (input, init) => {
    seen.push(input, init);
    return Promise.resolve(answer);
  });
  const got = await f("https://example.invalid/x", { method: "POST" });
  assert.equal(got, answer);
  assert.deepEqual(seen, ["https://example.invalid/x", { method: "POST" }]);
});

test("a 529 is retried and the third attempt's answer is returned", async () => {
  let attempts = 0;
  const out = await withRetry(() => {
    attempts += 1;
    if (attempts < 3) return Promise.reject(Object.assign(new Error("overloaded"), { status: 529 }));
    return Promise.resolve("questions");
  }, [0, 0]);
  assert.equal(out, "questions");
  assert.equal(attempts, 3);
});

test("a 429 is retried", async () => {
  let attempts = 0;
  await assert.rejects(
    () =>
      withRetry(() => {
        attempts += 1;
        return Promise.reject(Object.assign(new Error("slow down"), { status: 429 }));
      }, [0, 0]),
    /slow down/,
  );
  assert.equal(attempts, 3, "the original attempt plus one per wait");
});

test("a bad key is thrown at once rather than paid for three times", async () => {
  let attempts = 0;
  await assert.rejects(
    () =>
      withRetry(() => {
        attempts += 1;
        return Promise.reject(Object.assign(new Error("invalid x-api-key"), { status: 401 }));
      }, [0, 0]),
    /invalid x-api-key/,
  );
  assert.equal(attempts, 1);
});

test("a schema failure out of messages.parse is not retried", async () => {
  // A ZodError carries no status, and neither does the SDK's APIConnectionError.
  // They are not distinguishable from out here, and retrying the first buys
  // three identical failures at three times the price - the SDK's own inner
  // layer has already retried the second before we see it.
  let attempts = 0;
  await assert.rejects(
    () =>
      withRetry(() => {
        attempts += 1;
        return Promise.reject(Object.assign(new Error("invalid_type"), { name: "ZodError" }));
      }, [0, 0]),
    /invalid_type/,
  );
  assert.equal(attempts, 1);
});

test("isRetryable splits capacity from a bad request", () => {
  for (const status of [429, 500, 503, 529]) {
    assert.equal(isRetryable(Object.assign(new Error("x"), { status })), true, String(status));
  }
  for (const status of [400, 401, 403, 404, 422]) {
    assert.equal(isRetryable(Object.assign(new Error("x"), { status })), false, String(status));
  }
  assert.equal(isRetryable(new Error("no status")), false);
  assert.equal(isRetryable(null), false);
  assert.equal(isRetryable(undefined), false);
});

test("the waits are longer than the SDK's own, which is the reason they exist", () => {
  // The SDK backs off 0.5s then 1s. `retry-policy.ts` argues a retry fired
  // inside a capacity wobble meets the same wobble, and that argument is only
  // true while these stay clear of the inner layer's.
  assert.deepEqual([...RETRY_WAITS], [1500, 4000]);
  for (const w of RETRY_WAITS) assert.ok(w > 1000, `${w}ms is inside the SDK's own backoff`);
});
