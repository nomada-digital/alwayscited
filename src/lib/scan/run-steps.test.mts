import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { code, sourceFiles } from "../source-read.mts";

import { ANSWERS_STEP, DONE_PCT, DRAWING_CAPTION, RUN_STEPS, STEP, STEP_INDEX, answersStored, pacedPct, stepCaption, stepPct } from "./run-steps.ts";

/**
 * The step vocabulary, under test for the first time.
 *
 * Four structures keyed to the same three words lived in three files and
 * nothing reconciled them: the pipeline's three write sites, ScanFlow's
 * `STEP_INDEX`, HeroSequence's `RUN_STEPS` captions and its `STEP_PCT` bar. The
 * failure mode is silent - a renamed step makes `STEP_INDEX.get` return
 * undefined, `setProgress` is never called, and the bar freezes with the wrong
 * caption under it for the rest of the run while the scan completes normally.
 *
 * These tests are the reconciliation. They are cheap and they are the only
 * witness this board has: `HeroSequence`'s classes exist only during a live
 * scan, so nobody has ever watched it render.
 */

test("every step's word maps back to its own position", () => {
  RUN_STEPS.forEach((s, i) => {
    assert.equal(STEP_INDEX.get(s.key), i, `${s.key} must resolve to ${i}`);
  });
  assert.equal(STEP_INDEX.size, RUN_STEPS.length, "no word is left out and none is invented");
});

test("the writer's vocabulary is exactly the reader's", () => {
  // STEP is what pipeline.ts writes; STEP_INDEX is what ScanFlow.tsx reads.
  // These were two hand-typed lists in two files. They are now one.
  assert.deepEqual(Object.keys(STEP).sort(), [...STEP_INDEX.keys()].sort());
  for (const key of Object.keys(STEP)) {
    assert.equal(STEP[key as keyof typeof STEP], key, "each key must be its own literal");
  }
});

/**
 * The defect this module was extracted to remove.
 *
 * `HeroSequence` read `RUN_STEPS[Math.min(p.step, 2)]` - a typed ceiling -
 * directly under `STEP_PCT[Math.min(Math.max(p.step, 0), STEP_PCT.length - 1)]`,
 * which derived its own. A fourth step would have moved the bar and left the
 * words behind. Neither function may carry a number that the list does not.
 */
test("a step past the end takes the last caption rather than reading off the end", () => {
  assert.equal(stepCaption(RUN_STEPS.length), RUN_STEPS[RUN_STEPS.length - 1].caption);
  assert.equal(stepCaption(99), RUN_STEPS[RUN_STEPS.length - 1].caption);
});

test("a caption exists for every step the pipeline can report", () => {
  for (const [, i] of STEP_INDEX) {
    assert.equal(stepCaption(i), RUN_STEPS[i].caption);
    assert.ok(stepCaption(i).length > 0, "no step may render an empty caption");
  }
});

test("the bar reaches done past the last step, and never exceeds it", () => {
  assert.equal(stepPct(RUN_STEPS.length), DONE_PCT, "'3 done' is a value the prop's contract admits");
  assert.equal(stepPct(99), DONE_PCT);
  for (const s of RUN_STEPS) assert.ok(s.pct < DONE_PCT, `${s.key} must leave somewhere to go`);
});

test("the bar only ever moves forwards", () => {
  const pcts = RUN_STEPS.map((s) => s.pct);
  const climbing = pcts.every((v, i) => i === 0 || v > pcts[i - 1]);
  assert.ok(climbing, "a step that lowers the bar reads as the scan going backwards");
});

/**
 * `p.step` arrives from a JSON response by way of `STEP_INDEX.get`, so it is a
 * number today. Neither function may throw if that ever stops being true -
 * this renders on the screen a visitor watches for the whole minute a scan
 * takes, and a throw here unmounts it.
 */
test("nonsense input is clamped rather than thrown on", () => {
  for (const bad of [-1, -99, NaN, Infinity, -Infinity, 1.7]) {
    assert.doesNotThrow(() => stepCaption(bad), `stepCaption(${bad})`);
    assert.doesNotThrow(() => stepPct(bad), `stepPct(${bad})`);
    assert.ok(stepCaption(bad).length > 0, `stepCaption(${bad}) must still say something`);
  }
  assert.equal(stepCaption(-1), RUN_STEPS[0].caption, "before the first step is the first step");
  assert.equal(stepPct(-1), RUN_STEPS[0].pct);
  assert.equal(stepCaption(1.7), RUN_STEPS[1].caption, "a fractional step truncates rather than rounding up");
  assert.equal(stepCaption(NaN), RUN_STEPS[0].caption, "nonsense is the start, not the end");
  assert.equal(stepPct(NaN), RUN_STEPS[0].pct);
  // The infinities are out of range, not nonsense, and clamp to the ends. A
  // first cut treated all three as nonsense with `!Number.isFinite`, which sent
  // a step past the last one back to the start of the bar.
  assert.equal(stepPct(Infinity), DONE_PCT);
  assert.equal(stepCaption(Infinity), RUN_STEPS[RUN_STEPS.length - 1].caption);
  assert.equal(stepPct(-Infinity), RUN_STEPS[0].pct);
  assert.equal(stepCaption(-Infinity), RUN_STEPS[0].caption);
});

/**
 * The renders this refactor had to preserve exactly.
 *
 * `HeroSequence` is the one board on this site with no visual witness, so a
 * refactor of its progress bar has to be checkable as frame-for-frame identical
 * to what it replaced rather than merely reasonable. These are the values the
 * two arrays it replaced produced for every step the pipeline can report.
 */
test("the shipped values are unchanged for every step a scan actually reaches", () => {
  assert.deepEqual([0, 1, 2].map(stepPct), [15, 55, 85]);
  assert.deepEqual([0, 1, 2].map(stepCaption), [
    "Building the questions buyers ask",
    "Reading what the engines answered",
    "Finding the sources they cited",
  ]);
});

/**
 * Two rungs were added on 20 September 2026 and the clause about step 3 that
 * used to live above them was retired rather than quietly edited.
 *
 * It read: "STEP_PCT's fourth entry was 100 and RUN_STEPS had no third index,
 * so step 3 took the last caption. Both preserved." That was a pin on a
 * refactor being frame-for-frame identical, and it was the right pin for the
 * change it was written for. It is not a promise about the product: step 3 was
 * off the end of the ladder, and the whole of Danny's item 3 is that the ladder
 * should be longer, because `sources` covered four API phases with the bar
 * frozen at 85% for all of them.
 *
 * So step 3 is a real rung now and answers 91, not 100. Said out loud because
 * the alternative - deleting two assertions in a test named "unchanged" - is
 * how a deliberate change comes to look like a regression somebody papered
 * over. The first three rungs above are genuinely unchanged, which is the part
 * that still matters: a scan in flight across this deploy sees the same bar for
 * every step it has already reported.
 */
test("the two new rungs extend the ladder rather than moving the old ones", () => {
  assert.equal(RUN_STEPS.length, 5, "a rung was added or removed without this test being read");
  assert.deepEqual([3, 4].map(stepPct), [91, 96]);
  assert.deepEqual([3, 4].map(stepCaption), [
    "Reading which brands got named",
    "Sorting competitors from suppliers",
  ]);
  // And past the end is still done, which is what step 3 used to be answering.
  assert.equal(stepPct(RUN_STEPS.length), DONE_PCT);
});

/**
 * The bar only ever moves forwards.
 *
 * With three rungs this was self-evident by inspection. With five it is worth
 * executing, because the pipeline now writes `brands` and `ranking` from inside
 * `readAndStore` while `sources` is written by the caller - three writers
 * across two functions - and a rung inserted in the wrong place sends the bar
 * backwards mid-scan on the one screen nobody has ever watched render.
 */
test("every rung is further along than the one before it", () => {
  for (let i = 1; i < RUN_STEPS.length; i++) {
    assert.ok(
      RUN_STEPS[i].pct > RUN_STEPS[i - 1].pct,
      `${RUN_STEPS[i].key} sits at ${RUN_STEPS[i].pct}% and ${RUN_STEPS[i - 1].key} before it is at ` +
        `${RUN_STEPS[i - 1].pct}% - the bar would run backwards`,
    );
  }
});

/* ── Nobody may pick a rung by typing its number ── */

/**
 * The defect this rule is named after shipped in the push that added two rungs,
 * in the one file that change did not otherwise touch.
 *
 * `ScanFlow.tsx` had `setProgress(3)` on `status === "complete"`. It meant "one
 * past the last rung", which `stepPct` answers with `DONE_PCT`, and it was
 * correct for as long as the ladder had three rungs. Adding `brands` and
 * `ranking` turned 3 into a real rung at 91%, so a finished scan would have
 * ended its run by moving the bar *backwards* to 91% and then swapping the
 * panel out. Nothing failed, nothing logged, and the only witness is the one
 * screen on this site nobody has ever watched render.
 *
 * **This is the repo's own named defect species** - "a ladder with a ceiling",
 * a fixed rung picked by index against a list that can grow - and the
 * fixed-index census over `src` was run and declared exhausted earlier the same
 * day. It was: this line was inside it and was correct when it was measured.
 * That is the lesson worth keeping. A census is true on the day it is taken,
 * and the thing that invalidates it is the change you are making right now.
 *
 * ## Why a positive literal and not any literal
 *
 * `setProgress(0)` is fine and stays. A ladder always has a first rung, so zero
 * cannot drift; every other index is a position in a list whose length is the
 * thing that moves. `RUN_STEPS.length` is how you say "done" and
 * `STEP_INDEX.get(word)` is how you say anything else.
 *
 * The denominator is derived - every `.tsx` and `.ts` under `src` that imports
 * from `run-steps` - rather than named, because the next file to render this
 * bar is the one this rule needs to cover and it does not exist yet.
 */
test("no file picks a step by typing its index", () => {
  const SRC = new URL("../../../", import.meta.url).pathname;
  const readers = sourceFiles(SRC).filter((f) =>
    /from\s+"[^"]*run-steps"/.test(readFileSync(join(SRC, f), "utf8")),
  );
  assert.ok(readers.length >= 2, `only ${readers.length} files import run-steps - this rule has gone blind`);

  const typed: string[] = [];
  for (const file of readers) {
    const src = code(readFileSync(join(SRC, file), "utf8"));
    for (const m of src.matchAll(/\bsetProgress\(\s*([^)]*)\)/g)) {
      const arg = m[1]!.trim();
      if (/^[1-9]\d*$/.test(arg)) typed.push(`${file}: setProgress(${arg})`);
    }
  }
  assert.deepEqual(
    typed,
    [],
    "these pick a rung of the progress bar by typing its number. The ladder's length is the thing that " +
      "moves - say RUN_STEPS.length for done, or STEP_INDEX.get(word) for a named step. setProgress(0) " +
      "is exempt because a ladder always has a first rung",
  );
});

/**
 * And that the exemption above is real rather than a hole: `setProgress(0)` has
 * to still exist somewhere, or the rule is written around a caller that is gone
 * and the next person deletes the reasoning with it.
 */
test("the zero exemption is still earned by a live caller", () => {
  const SRC = new URL("../../../", import.meta.url).pathname;
  const found = sourceFiles(SRC).some((f) => /\bsetProgress\(\s*0\s*\)/.test(code(readFileSync(join(SRC, f), "utf8"))));
  assert.ok(found, "nothing calls setProgress(0) any more - drop the exemption from the rule above");
});

/**
 * The partial result (2 Oct 2026): /full serves a running scan from
 * `ANSWERS_STEP` on, so the answers must be stored before that step is
 * written. Read off pipeline.ts in source order, because a refactor that moved
 * the upsert below the step write would draw a result with answers missing and
 * nothing would fail.
 */
test("the result draws early only once the answers are stored", () => {
  assert.equal(ANSWERS_STEP, STEP_INDEX.get(STEP.brands));
  assert.equal(answersStored(STEP.brands), true);
  assert.equal(answersStored(STEP.ranking), true);
  for (const early of [STEP.questions, STEP.reading, STEP.sources, null, undefined, "", "constructor", 3]) {
    assert.equal(answersStored(early), false, String(early) + " is before the answers are on the row");
  }
  const pipeline = code(readFileSync(join(process.cwd(), "src/lib/scan/pipeline.ts"), "utf8"));
  const upsert = pipeline.indexOf('from("scan_answers").upsert(');
  const citations = pipeline.indexOf('from("scan_citations").insert(');
  const step = pipeline.indexOf("onStep?.(STEP.brands)");
  assert.ok(upsert > 0 && citations > 0 && step > 0, "the walk found the three sites it orders");
  assert.ok(upsert < step && citations < step, "answers and citations are stored before the brands step is written");
});

/**
 * The waiting screen's two stalls (Danny, 2 Oct 2026): the tier sequence stopped
 * on one tier, and the screen sat still before the result. Neither fails
 * anything, so each is held by the source that fixes it.
 */
test("the drawing caption is its own words, not a rung", () => {
  assert.ok(DRAWING_CAPTION.length > 0);
  assert.ok(!RUN_STEPS.some((s) => (s.caption as string) === DRAWING_CAPTION), "the bar's rungs stay the pipeline's steps");
});

test("the waiting screen is not pinned by the pointer, and the handover is a transition", () => {
  const flow = code(readFileSync(join(process.cwd(), "src/components/scan/ScanFlow.tsx"), "utf8"));
  assert.match(flow, /<ProcessSequence\s+tempo=\{WAITING_TEMPO\}\s+pinOnHover=\{false\}/, "hover on the waiting screen must not lock the loop");
  assert.match(flow, /startTransition\(\(\) => \{[\s\S]*?setPhase\("result"\)/, "the early result swaps in as a transition");
  const seq = code(readFileSync(join(process.cwd(), "src/components/ProcessSequence.tsx"), "utf8"));
  assert.match(seq, /onMouseEnter=\{p\.pinOnHover === false \? undefined : hold\}/, "hover still pins on the homepage");
});

test("4 Nov 2026: the bar moves with time inside a step, never freezes, never reaches the next step early", () => {
  const reading = 1;
  const at = (ms: number) => pacedPct(reading, ms);
  assert.equal(Math.round(at(0)), RUN_STEPS[0].pct, "it starts where the previous step ended");
  assert.ok(at(30_000) > at(10_000) && at(60_000) > at(30_000) && at(300_000) > at(120_000), "always moving");
  assert.ok(at(85_000) > 45, "most of the way by the step's expected time");
  assert.ok(at(3_600_000) < RUN_STEPS[reading].pct, "never at the next figure before the pipeline is");
  for (let i = 0; i < RUN_STEPS.length - 1; i++) assert.ok(pacedPct(i, 1e9) <= pacedPct(i + 1, 0) + 1e-9, `step ${i} never passes step ${i + 1}'s start`);
  assert.equal(pacedPct(RUN_STEPS.length, 0), 100);
});
