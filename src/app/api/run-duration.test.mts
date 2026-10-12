import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { code, sourceFiles } from "../../lib/source-read.mts";

/**
 * The four deadlines a scan runs against, and the order they have to be in.
 *
 * A pass is bounded four times over, by four numbers that live in four files
 * and are joined by nothing:
 *
 * | rung | where | what happens |
 * |---|---|---|
 * | `SLOW_MS` | `ScanFlow.tsx` | the screen says "this one is taking a while" |
 * | `RUN_TIMEOUT_MS` | `pipeline.ts` | the pass gives up and writes `failed` |
 * | `maxDuration` | five route files | the platform kills the invocation |
 * | `STALL_AFTER_MS` | `stall.ts` | the reaper declares the row dead |
 * | `STUCK_MS` | `ScanFlow.tsx` | the screen stops polling |
 *
 * Every one of those files states the ordering in prose, and **not one of them
 * could tell you if it stopped being true**. `pipeline.ts` opens with "Every
 * route that starts a pass declares maxDuration = 300, so the platform stops
 * the invocation at five minutes too". `stall.ts` says the same sentence
 * again. `ScanFlow.tsx` says it a third time. The word `maxDuration` appeared
 * in no test in this repo before this file.
 *
 * ## Why prose is not enough here
 *
 * The ordering is not decoration - each rung exists because the one below it
 * is not enough, and inverting any adjacent pair is silent.
 *
 * Put `maxDuration` below `RUN_TIMEOUT_MS` and the pipeline's own ceiling can
 * never fire: the platform kills the function mid-read first, the catch that
 * writes `status = 'failed'` never runs, and the scan sits at `running` with a
 * step it will never leave. `pipeline.ts` describes exactly that failure, in
 * the past tense, as the reason the number is what it is. Nothing stops it
 * coming back. Two routes in this tree declare `maxDuration = 60` today and
 * both are correct - neither starts a pass - but they are one `after(() =>
 * runScan(id))` away from being the bug, and that edit moves no test, passes
 * `tsc`, passes the build and deploys.
 *
 * Put `STALL_AFTER_MS` below `maxDuration` and the reaper marks a pass failed
 * while it is still running and still spending, then the pass writes its
 * result on top - so a scan reports as failed and billed, or as complete after
 * being reaped, depending on which write lands last.
 *
 * Put `STUCK_MS` below `STALL_AFTER_MS` and the progress screen gives up
 * before the reaper has written anything, so the visitor is told the scan is
 * stuck while the row still says `running` and the retry they are offered
 * races the pass that is still going.
 *
 * None of those produces an error anywhere. They produce a wrong report, a
 * double spend, or a spinner with no end - which is the silent-failure species
 * this repo keeps paying for.
 *
 * ## The denominator, and why it is a call graph rather than a list
 *
 * "Every route that starts a pass" cannot be a list of filenames here, and the
 * reason is the finding. **Two of the five reach the pipeline indirectly.**
 * `/api/scan/[token]/unlock` and `/api/verify/[vtoken]` never mention
 * `runScan` or `runGatedScan`; they call `completeUnlock`, which runs the
 * gated pass in an `after()` of its own. A sweep grepping routes for the
 * pipeline's entry points would have found three of five, reported the tree
 * clean, and been blind to the two doors that start **the most expensive pass
 * this system runs** - the one an email address was traded for.
 *
 * So the set is a fixpoint over calls, not a list, and it is seeded from the
 * mechanism rather than from a name: a **pass entry point** is an exported
 * function in `pipeline.ts` whose body opens a deadline from the run-timeout
 * constant. That is the definition that makes the rung matter - a function
 * that installs the 270s deadline is exactly a function that needs the
 * platform to allow more than 270s. A third pass added tomorrow joins this
 * sweep with no edit here.
 *
 * Imports are stripped before any call is looked for, because an import is not
 * a call - the mistake `spend-gates` made when its import-graph draft read
 * `/full` and `/opportunities` as spenders. Comments are stripped for the
 * reason `source-read.mts` records nine times over: `scan/[token]/page.tsx`
 * names `completeUnlock` in prose and calls nothing.
 *
 * ## What this cannot see, said rather than implied
 *
 * - **Whether Vercel honours `maxDuration = 300`.** That is a statement about
 *   a vendor on a plan this session cannot read, and no source in this repo
 *   settles it. What is checked is that the repo is internally consistent:
 *   the number the pipeline reasons against is the number the routes declare.
 * - **Whether a pass started from somewhere that is not a route is bounded at
 *   all.** This paragraph said, until the question was asked of this file the
 *   minute after it went green, that a `"use server"` action calling `runScan`
 *   "would fail the third rule rather than being silently skipped". That was
 *   false, and it is the species this whole file is about: a stated reason for
 *   a safety property is a claim about the tree. An action is not a route, so
 *   it lands outside `PASS_ROUTES` and **every rule below would have passed
 *   over it** - the same hole, one indirection further out, that put two mail
 *   doors in nobody's list until `mail-doors.test.mts`. A server action has no
 *   `maxDuration` of its own; it runs under the segment that invoked it, and
 *   no page in this tree declares one. So the closure's non-route members are
 *   a recorded set with a reason each, and a new one fails.
 * - **Whether 270s is long enough for a real pass.** That is a measurement
 *   against live vendors, not a property of the tree.
 *
 * Nothing here retypes a duration. Every number is read out of the file that
 * declares it, which is the whole point - a test carrying its own copy of
 * `300` would agree with itself for ever while the tree moved underneath it,
 * and that is the blind-tripwire species this queue keeps finding.
 */

const ROOT = join(import.meta.dirname, "..", "..", "..");
const PIPELINE = "src/lib/scan/pipeline.ts";
const STALL = "src/lib/scan/stall.ts";
const SCANFLOW = "src/components/scan/ScanFlow.tsx";

/** A route module, which is the only kind of file that can declare `maxDuration`. */
const IS_ROUTE = /^src\/app\/api\/.*\/route\.ts$/;

function read(rel: string): string {
  return withoutImports(code(readFileSync(join(ROOT, rel), "utf8")));
}

/**
 * Import lines removed.
 *
 * An import is not a call. `spend-gates.test.mts` records the run this cost:
 * its import-graph draft read `/full` and `/opportunities` as routes that
 * spend money because `anthropic.ts` was somewhere in their graph. Here the
 * same slip would mark every module that merely imports the pipeline as a
 * thing that starts a pass, and the fixpoint below would then spread from it.
 */
function withoutImports(src: string): string {
  const out: string[] = [];
  let inImport = false;
  for (const line of src.split("\n")) {
    if (!inImport && /^import\b/.test(line.trim())) {
      inImport = !/;\s*$/.test(line);
      continue;
    }
    if (inImport) {
      if (/;\s*$/.test(line)) inImport = false;
      continue;
    }
    out.push(line);
  }
  return out.join("\n");
}

/**
 * Arithmetic only. `4.5 * 60 * 1000` and `330_000` are both how this tree
 * writes a duration, and a sweep that read only integer literals would have to
 * skip `RUN_TIMEOUT_MS` and `STUCK_MS` - which are two of the four rungs.
 */
function msValue(expr: string): number {
  const cleaned = expr.replace(/_/g, "").trim();
  assert.match(cleaned, /^[\d.*+ ()]+$/, `not a plain duration expression: ${expr}`);
  const value = Function(`"use strict"; return (${cleaned});`)() as number;
  assert.ok(Number.isFinite(value) && value > 0, `not a duration: ${expr}`);
  return value;
}

/** `const NAME = <arithmetic>;` in one file, by name. */
function constMs(src: string, name: string): number {
  const m = new RegExp(`\\b(?:const|let)\\s+${name}\\s*=\\s*([^;]+);`).exec(src);
  assert.ok(m, `${name} is not declared where this sweep looks for it`);
  return msValue(m[1]!);
}

/**
 * Exported functions and their bodies, by nearest preceding `export function`.
 *
 * A private helper sitting between two exports is folded into the one above
 * it, which over-attributes rather than under-attributes. That is the noisy
 * direction on purpose: a module wrongly marked as starting a pass shows up as
 * a route that must declare `maxDuration` and fails loudly, where the quiet
 * direction would drop a real pass-starter out of the set and pass.
 */
function exportedFunctions(src: string): { name: string; body: string }[] {
  const marks: { name: string; at: number }[] = [];
  for (const m of src.matchAll(/^export\s+(?:async\s+)?function\s+(\w+)/gm)) {
    marks.push({ name: m[1]!, at: m.index! });
  }
  return marks.map((mark, i) => ({
    name: mark.name,
    body: src.slice(mark.at, i + 1 < marks.length ? marks[i + 1]!.at : src.length),
  }));
}

/**
 * A call to `name`, not a mention of it and not its own declaration.
 *
 * The declaration cut is the sibling of the import cut above, and it was found
 * by this file failing on itself: `pipeline.ts` matched `runScan(` because
 * `export async function runScan(` contains it, so the module that *defines*
 * the passes was reported as an unrecorded module that *starts* one. Noisy
 * rather than silent, and caught within a minute - but the same slip on a
 * helper would have put a real indirection in the recorded list with a reason
 * invented to explain it, which is how an exemption stops meaning anything.
 */
function calls(body: string, name: string): boolean {
  const withoutDeclaration = body.replace(
    new RegExp(`\\b(?:function|class)\\s+${name}\\s*\\(`, "g"),
    "",
  );
  return new RegExp(`\\b${name}\\s*\\(`).test(withoutDeclaration);
}

// ---------------------------------------------------------------------------
// The measurement
// ---------------------------------------------------------------------------

const pipelineSrc = read(PIPELINE);

/**
 * The run-timeout constant, named by the mechanism that uses it rather than by
 * this file. Every pass opens `const deadline = Date.now() + X`, so `X` is
 * whatever the pipeline calls its own ceiling.
 */
const DEADLINE_CONSTANTS = [
  ...new Set(
    [...pipelineSrc.matchAll(/const\s+deadline\s*=\s*Date\.now\(\)\s*\+\s*(\w+)\s*;/g)].map(
      (m) => m[1]!,
    ),
  ),
];

const RUN_TIMEOUT_MS = DEADLINE_CONSTANTS.length ? constMs(pipelineSrc, DEADLINE_CONSTANTS[0]!) : 0;

/** Exported pipeline functions that install that deadline: the passes. */
const PASS_ENTRIES = exportedFunctions(pipelineSrc)
  .filter((fn) => DEADLINE_CONSTANTS.some((c) => fn.body.includes(`Date.now() + ${c}`)))
  .map((fn) => fn.name);

/**
 * Every module that reaches a pass, as a fixpoint over calls.
 *
 * Seeded with the pass entry points; each round adds any exported function
 * that calls something already in the set, and any route whose body does. Runs
 * to a fixed point rather than a fixed number of rounds, so a third hop added
 * later needs no edit.
 *
 * Takes its file set as an argument so the transitive hop can be proved on a
 * fixture - see "the closure follows a pass through a helper", below.
 */
function passReachingRoutes(
  files: { file: string; src: string }[] = sourceFiles(ROOT).map((file) => ({ file, src: read(file) })),
): { routes: string[]; indirect: string[]; reached: string[] } {
  const targets = new Set(PASS_ENTRIES);
  const routes = new Set<string>();
  const direct = new Set<string>();
  const reached = new Set<string>();

  for (let round = 0; round < 20; round++) {
    const before = targets.size + routes.size;

    for (const { file, src } of files) {
      const hits = [...targets].filter((t) => calls(src, t));
      if (!hits.length) continue;

      if (IS_ROUTE.test(file)) {
        routes.add(file);
        // Recorded before the set grows, so "reached only through another
        // module" stays answerable afterwards.
        if (hits.some((h) => PASS_ENTRIES.includes(h))) direct.add(file);
        continue;
      }
      reached.add(file);
      for (const fn of exportedFunctions(src)) {
        if ([...targets].some((t) => calls(fn.body, t))) targets.add(fn.name);
      }
    }

    if (targets.size + routes.size === before) break;
  }

  return {
    routes: [...routes].sort(),
    indirect: [...routes].filter((r) => !direct.has(r)).sort(),
    reached: [...reached].sort(),
  };
}

const {
  routes: PASS_ROUTES,
  indirect: INDIRECT_ROUTES,
  reached: PASS_HELPERS,
} = passReachingRoutes();

/**
 * The non-route modules that start a pass, and why each is bounded.
 *
 * Derived set, typed reasons - the shape `spend-gates.test.mts` settled on.
 * The point of the list is that a module joining it is a **new door into the
 * pipeline from outside a route segment**, and nothing in this file can bound
 * such a thing: a `"use server"` action runs under the maxDuration of the page
 * that invoked it, and no page here declares one.
 */
const KNOWN_HELPERS: Record<string, string> = {
  // `src/lib/scan/unlock.ts` was the only entry, for `completeUnlock` running
  // the gated pass in an after() of its own. It went on 24 September 2026 with
  // the email gate and the three routes that called it, and the reason went
  // with it rather than being left pointing at a function that no longer
  // exists - a recorded reason that outlives its subject is the exact thing
  // "the recorded helpers are still the ones doing it" charges for.
  //
  // Empty is the honest state. The transitive closure below stays: it is what
  // would catch the next module that reaches a pass from outside a route
  // segment, and that is the shape two `"use server"` mail doors hid in.
};

/** `export const maxDuration = N;`, in seconds, or null if the route declares none. */
function maxDurationOf(file: string): number | null {
  const m = /export\s+const\s+maxDuration\s*=\s*(\d+)/.exec(read(file));
  return m ? Number(m[1]) : null;
}

/**
 * Routes that ask the platform for more time than the pipeline's own ceiling.
 *
 * The reverse direction, and the reason rule 3 cannot pass vacuously. If the
 * call graph above ever goes blind - a spelling change, a new indirection, a
 * "simplification" to direct calls only - `PASS_ROUTES` empties and every
 * assertion over it passes on nothing. This set is built without the graph, so
 * the two have to agree.
 */
const LONG_ROUTES = sourceFiles(ROOT)
  .filter((f) => IS_ROUTE.test(f))
  .filter((f) => {
    const declared = maxDurationOf(f);
    return declared !== null && declared * 1000 > RUN_TIMEOUT_MS;
  })
  .sort();

/**
 * A long-running route that starts no pass.
 *
 * Empty today, and it has to stay a list with a reason each rather than a
 * count: `readiness.ts` was right about every key it named while
 * `SCAN_FROM_EMAIL` was on no list at all, and a `>= 3` floor over four
 * senders could not notice one dropping off.
 *
 * One since 29 September 2026: the daily tracking run (T1). It is not a scan
 * pass, so the call graph rightly does not find one, but it is the same shape
 * - one client's questions on its engines - and budgets itself the way the
 * pipeline does: RUN_BUDGET_MS = 270_000 against this route's 300, writing
 * its own status on the way out, the stall reaper closing one that was killed.
 *
 * Two since 13 Oct 2026 (DIY P1): the DIY night worker, `/api/diy/run`. The
 * same shape again - a 270 s budget in after() against its maxDuration 300 -
 * and it closes its own diy_jobs rows; a worker the platform kills leaves a
 * claim that goes stale after 15 minutes and is taken again.
 */
const LONG_WITHOUT_PASS: Record<string, string> = {
  "src/app/api/track/run/route.ts":
    "One client's daily tracking run in after(); runner.ts budgets 270s against this 300 and closes its own row.",
  // 13 Oct 2026, DIY P1 (spec 10 sections 3.6 and 5.7): the DIY night worker.
  // Not a scan pass, and posted only by the DIY dispatcher with an HMAC.
  "src/app/api/diy/run/route.ts": "worker budgets 270 s in after(); closes its own diy_jobs rows",
};

// ---------------------------------------------------------------------------
// One property, one test. Two assertions under one name destroy the only
// column that matters - the harness reports which subtest fired.
// ---------------------------------------------------------------------------

test("the pipeline names its own run ceiling, and this sweep found it", () => {
  assert.equal(
    DEADLINE_CONSTANTS.length,
    1,
    `expected one run-deadline constant in ${PIPELINE}, found ${DEADLINE_CONSTANTS.join(", ") || "none"}`,
  );
  assert.ok(RUN_TIMEOUT_MS > 0, "the run timeout did not read as a duration");
});

test("every pass is an exported pipeline function that installs that deadline", () => {
  // A floor, not a count. If this walk ever returns nothing, every rule below
  // it is asserting over an empty set and passing - which is the shape of
  // every blind tripwire this queue has found.
  assert.ok(
    PASS_ENTRIES.length >= 2,
    `expected the free pass and the gated pass, found: ${PASS_ENTRIES.join(", ") || "none"}`,
  );
});

test("every route that starts a pass declares maxDuration", () => {
  const missing = PASS_ROUTES.filter((f) => maxDurationOf(f) === null);
  assert.deepEqual(
    missing,
    [],
    `these routes start a pass and declare no maxDuration, so they take the platform default:\n${missing.join("\n")}`,
  );
});

test("every route that starts a pass outlives the pipeline's own ceiling", () => {
  // The load-bearing rung. Below this the platform kills the function before
  // the pass can write `failed`, and the row sits at `running` for ever.
  const tooShort = PASS_ROUTES.map((f) => ({ f, s: maxDurationOf(f) }))
    .filter((r) => r.s !== null && r.s * 1000 <= RUN_TIMEOUT_MS)
    .map((r) => `${r.f} declares ${r.s}s against a ${RUN_TIMEOUT_MS / 1000}s pass`);
  assert.deepEqual(tooShort, [], tooShort.join("\n"));
});

test("no route reaches a pass through a helper without being recorded", () => {
  /**
   * This asserted `>= 2` until 24 September 2026, and the two were `unlock`
   * and `verify`: both called `completeUnlock`, never the pipeline, so a sweep
   * narrowed to direct calls missed both doors to the gated pass - the
   * expensive one, the one an address was traded for. That is why the closure
   * is transitive rather than a grep of route files.
   *
   * Both routes are gone, so today the closure finds none and a floor of two
   * would be a floor nothing can meet. The assertion is turned round instead
   * of deleted: every route the closure reaches indirectly must be one
   * `KNOWN_HELPERS` explains. That still fails the day a new module starts a
   * pass from outside a route segment, which is the direction that costs
   * money.
   *
   * **It said here that this "cannot be satisfied by the closure going
   * blind", and that was wrong** (audit of the 24 Sep removals, 25 Sep 2026).
   * A closure narrowed to direct calls returns no indirect routes, and an
   * empty list passes this. The floor it replaced was the only thing proving
   * the hop worked, so the proof is back as a fixture in the next test.
   */
  const unexplained = INDIRECT_ROUTES.filter(
    (r) => !Object.keys(KNOWN_HELPERS).some((h) => r.includes(h)),
  );
  assert.deepEqual(
    unexplained,
    [],
    `these routes reach a pass through a module no reason covers:\n${unexplained.join("\n")}`,
  );
});

test("the closure follows a pass through a helper", () => {
  /**
   * What the `>= 2` floor proved until 24 September 2026, when the tree's only
   * two indirect routes went with the email gate: that a route calling a helper
   * which calls the pipeline is found, and is found as indirect. The tree has
   * none to count now, so the hop is proved on a fixture instead. If the
   * closure is ever narrowed to direct calls, this fails where the rule above
   * would pass on an empty list.
   */
  const pass = PASS_ENTRIES[0]!;
  const found = passReachingRoutes([
    { file: "src/app/api/fixture/direct/route.ts", src: `export async function POST() {\n  await ${pass}(x);\n}` },
    { file: "src/app/api/fixture/indirect/route.ts", src: "export async function POST() {\n  await startIt(x);\n}" },
    { file: "src/lib/fixture/helper.ts", src: `export async function startIt(x) {\n  return ${pass}(x);\n}` },
    { file: "src/app/api/fixture/bystander/route.ts", src: "export async function GET() {\n  return read(x);\n}" },
  ]);
  assert.deepEqual(found.routes, ["src/app/api/fixture/direct/route.ts", "src/app/api/fixture/indirect/route.ts"]);
  assert.deepEqual(found.indirect, ["src/app/api/fixture/indirect/route.ts"], "the one-hop route was not found as indirect");
  assert.deepEqual(found.reached, ["src/lib/fixture/helper.ts"], "the helper that starts a pass was not found");
});

test("a route may not ask for more time than the pipeline needs without starting a pass", () => {
  // The two-way street. Built without the call graph, so a graph that has gone
  // blind shows up here as a long route nothing explains.
  const unexplained = LONG_ROUTES.filter(
    (f) => !PASS_ROUTES.includes(f) && !(f in LONG_WITHOUT_PASS),
  );
  assert.deepEqual(
    unexplained,
    [],
    `these routes outlive the pipeline ceiling and start no pass this sweep can see:\n${unexplained.join("\n")}`,
  );
});

test("nothing outside a route segment starts a pass without a recorded reason", () => {
  // The refill, asked of this file the minute it went green and answered in
  // the same push. A route is the only thing that can declare `maxDuration`,
  // so a pass reached from anything else is bounded by nothing here - and
  // every rule above this one would pass over it in silence. That is exactly
  // how two `"use server"` mail doors stayed in nobody's list.
  const unrecorded = PASS_HELPERS.filter((f) => !(f in KNOWN_HELPERS));
  assert.deepEqual(
    unrecorded,
    [],
    `these modules reach a pass and are not routes, so no maxDuration covers them:\n${unrecorded.join("\n")}`,
  );
});

test("the recorded helpers are still the ones doing it", () => {
  // The other way down the street. A reason left behind for a module that has
  // stopped reaching the pipeline is a sentence nothing holds, which is the
  // thing this repo charges a `holds` for.
  const stale = Object.keys(KNOWN_HELPERS).filter((f) => !PASS_HELPERS.includes(f));
  assert.deepEqual(stale, [], `recorded as reaching a pass and no longer doing so:\n${stale.join("\n")}`);
});

test("the reaper waits for the platform to have given up", () => {
  const stallAfter = constMs(read(STALL), "STALL_AFTER_MS");
  const platform = Math.min(...PASS_ROUTES.map((f) => maxDurationOf(f)! * 1000));
  assert.ok(
    stallAfter > platform,
    `the reaper declares a row dead at ${stallAfter / 1000}s while a pass may still be running to ${platform / 1000}s - it would mark a scan failed mid-spend and the pass would write over it`,
  );
});

test("the progress screen waits for the reaper", () => {
  const flow = read(SCANFLOW);
  const stuck = constMs(flow, "STUCK_MS");
  const stallAfter = constMs(read(STALL), "STALL_AFTER_MS");
  assert.ok(
    stuck > stallAfter,
    `the screen gives up at ${stuck / 1000}s and the reaper writes at ${stallAfter / 1000}s - the visitor would be offered a retry that races a row nothing has failed yet`,
  );
});

test("the screen says it is slow before anything has actually given up", () => {
  const slow = constMs(read(SCANFLOW), "SLOW_MS");
  assert.ok(
    slow < RUN_TIMEOUT_MS,
    `the screen warns at ${slow / 1000}s and the pass gives up at ${RUN_TIMEOUT_MS / 1000}s - the warning would never be seen`,
  );
});

test("the four rungs are in order, read from the four files that declare them", () => {
  const flow = read(SCANFLOW);
  const rungs = [
    ["SLOW_MS", constMs(flow, "SLOW_MS")],
    ["RUN_TIMEOUT_MS", RUN_TIMEOUT_MS],
    ["maxDuration", Math.min(...PASS_ROUTES.map((f) => maxDurationOf(f)! * 1000))],
    ["STALL_AFTER_MS", constMs(read(STALL), "STALL_AFTER_MS")],
    ["STUCK_MS", constMs(flow, "STUCK_MS")],
  ] as const;
  assert.deepEqual(
    [...rungs].sort((a, b) => a[1] - b[1]).map(([n]) => n),
    rungs.map(([n]) => n),
    `the deadlines are out of order: ${rungs.map(([n, v]) => `${n}=${v / 1000}s`).join(" ")}`,
  );
});
