/**
 * The three steps a running scan reports, named once.
 *
 * There were four copies of this vocabulary in three files and nothing
 * reconciled any of them:
 *
 * - `pipeline.ts` wrote `step: "questions"`, `"reading"` and `"sources"` into
 *   `scans.step` as bare literals at three separate call sites.
 * - `ScanFlow.tsx` held a `STEP_INDEX` map turning those three words back into
 *   0, 1, 2 - a second copy of the words, typed by hand.
 * - `HeroSequence.tsx` held `RUN_STEPS`, three captions indexed by that number.
 * - `HeroSequence.tsx` also held `STEP_PCT`, four percentages indexed by the
 *   same number.
 *
 * ## What that cost, and why it is silent
 *
 * Rename a step in the pipeline, or add a fourth, and `STEP_INDEX.get` returns
 * `undefined` for the word it now writes. The reader guards on that - correctly,
 * and for a good reason recorded below - so `setProgress` is simply never
 * called. The bar does not jump or flicker: it **freezes at the previous step,
 * with the previous caption under it, for the rest of the run**, and then the
 * report arrives as though nothing happened. The scan itself is unaffected, so
 * nothing fails, nothing logs, and the only witness is the waiting screen.
 *
 * That screen is `HeroSequence`, which is the one surface on this site nobody
 * has ever watched render - its classes exist only during a live scan. Four
 * defects have already been found on it by reading alone. A fifth that needs a
 * rename to appear is exactly the kind this arrangement was going to produce,
 * so the words and the numbers live here and the three files derive from them.
 *
 * This is the remedy `config/scan-shape.ts` already applies to the question
 * count, for the same reason it gives: a value retyped in a second place is a
 * claim about what the product does that nothing keeps true.
 *
 * ## Why a `.ts` and not a constant in the component
 *
 * `node --test` cannot load a `.tsx`, so anything left inside one is untestable.
 * `motion-script.ts` and `seq-stagger.ts` were both pulled out of components for
 * this reason and both say so. This is a third piece of the same board.
 *
 * No `server-only`: the pipeline writes these keys and two client components
 * read them, so it has to load on both sides. It imports nothing.
 */

/**
 * In the order the pipeline runs them. `key` is the word written to
 * `scans.step`; `caption` is what the visitor is told; `pct` is how far the bar
 * has travelled while that step is the current one.
 */
export const RUN_STEPS = [
  { key: "questions", caption: "Building the questions buyers ask", pct: 15 },
  { key: "reading", caption: "Reading what the engines answered", pct: 55 },
  { key: "sources", caption: "Finding the sources they cited", pct: 85 },
  { key: "brands", caption: "Reading which brands got named", pct: 91 },
  { key: "ranking", caption: "Sorting competitors from suppliers", pct: 96 },
] as const;

/**
 * ## Why there are five of these and not three, since 20 September 2026
 *
 * Danny, item 3: "that one caption covers the longest stretch of the scan with
 * the bar frozen at 85%. Split it so the screen moves while it works."
 *
 * `sources` used to cover everything from the last engine read to the finished
 * report - storing citations, one brand extraction per engine, one classify
 * call over the whole name set, and the source classification alongside them.
 * Four API phases under one caption, with the bar not moving for any of it. On
 * a scan where the reads finish fast and the model work does not, that is most
 * of the visible wait spent looking at a frozen 85%.
 *
 * The two new rungs are the two phases that were already separately measurable
 * and are now separately *visible*: `brands` is `extractBrands`, `ranking` is
 * `classifyBrands`. They are named for what is happening rather than for how
 * far along it is, because "almost done" is a promise this pipeline cannot
 * keep - the deadline is a ceiling, not an estimate.
 *
 * **The source classification is deliberately not a rung.** Since the same
 * commit it runs *alongside* `brands` and `ranking` rather than after them, so
 * there is no moment at which it is the thing being waited for. A caption for
 * it would be a lie about what the bar is measuring - the one thing this module
 * was built to prevent.
 *
 * Nothing needed changing to add them. Both readers derive - `HeroSequence`
 * calls `stepCaption`/`stepPct`, `ScanFlow` reads `STEP_INDEX` - which is the
 * whole argument this file's header makes, tested by having been true.
 */

/** The three words, as a type. A typo at a write site is a compile error. */
export type RunStep = (typeof RUN_STEPS)[number]["key"];

/**
 * Where the bar sits once there are no steps left.
 *
 * `HeroSequence` is replaced by the report at done, so nothing renders a
 * caption for it and none is defined. The percentage exists because the prop's
 * own contract admits the value - "0 questions, 1 reading, 2 sources, 3 done" -
 * and a ladder that is asked for a rung it does not have should answer, not
 * read off the end.
 */
export const DONE_PCT = 100;

/**
 * The write sites' vocabulary, derived rather than retyped.
 *
 * `STEP.questions` is the literal `"questions"` and `STEP.questinos` does not
 * compile, which is the whole job: the pipeline can no longer write a word the
 * reader has never heard of.
 */
export const STEP = Object.fromEntries(RUN_STEPS.map((s) => [s.key, s.key])) as {
  readonly [K in RunStep]: K;
};

/**
 * The word from `scans.step` back to its position, or `undefined`.
 *
 * A Map, because the key is a string off a JSON response. As an object literal
 * the membership test beside it was `data.step in STEP_INDEX`, and `in` answers
 * for the whole prototype chain: `"constructor" in {}` is true, so the guard
 * passed and the lookup handed `setProgress` the Object constructor rather than
 * a number. `scans.step` is written only by the pipeline, so nothing outside
 * could put that word there today - but the guard was doing none of the work it
 * looked like it was doing, and this is the same shape as the `/scan?verify=`
 * fix: a plain object indexed by a string from somewhere else. A Map has no
 * inherited keys, so `get` returns undefined for everything that is not one of
 * these three.
 */
export const STEP_INDEX: ReadonlyMap<string, number> = new Map(RUN_STEPS.map((s, i) => [s.key, i]));

/**
 * The first step at which every engine answer is stored, so the result can be
 * drawn while the rest of the run finishes (Danny, 2 Oct 2026: "load the
 * results page as results become available").
 *
 * `readAndStore` upserts `scan_answers`, the Google ranks and the citations,
 * then raises `brands`. So from `brands` on, the prompts, every answer and
 * every cited page are final; what is still to come is who got named
 * (`scan_brands`), what kind each source is (`scan_sources`), the placement
 * list and the cluster keyword's rank. `run-steps.test.mts` holds the order in
 * pipeline.ts, because a move of that upsert below the step write would show a
 * visitor a result with answers missing.
 *
 * Derived, with a fallback past the last rung, so a renamed step means the
 * result waits for the finished scan rather than drawing early.
 */
export const ANSWERS_STEP = STEP_INDEX.get(STEP.brands) ?? RUN_STEPS.length;

/**
 * What the waiting screen says while it fetches the result it is about to draw.
 *
 * From `ANSWERS_STEP` the answers are stored but the page still has two
 * requests to make (the teaser and `/full`, about 130 KB on a finished scan)
 * before there is anything to draw. Until they return the caption used to keep
 * saying "Reading which brands got named" over a screen where nothing moved,
 * which read as a freeze (Danny, 2 Oct 2026). This is true of that moment and
 * is not a rung: the bar's width is still the pipeline's step.
 */
export const DRAWING_CAPTION = "Drawing your results";

/** Whether a running scan at this `scans.step` word has its answers stored. */
export function answersStored(step: unknown): boolean {
  if (typeof step !== "string") return false;
  const i = STEP_INDEX.get(step);
  return i !== undefined && i >= ANSWERS_STEP;
}

/**
 * A step number to a position in the ladder, clamped to one that exists.
 *
 * `NaN` is nonsense and answers with the first step; the infinities are not.
 * `+Infinity` is past the last step and `-Infinity` is before the first, so
 * both clamp like any other out-of-range number. Treating all three as
 * nonsense - which is what `!Number.isFinite(i)` did - sent `+Infinity` back
 * to the *start* of the bar, and the test below caught it.
 */
function rung(n: number): number {
  const i = Math.trunc(n);
  if (Number.isNaN(i) || i < 0) return 0;
  return Math.min(i, RUN_STEPS.length - 1);
}

/**
 * What the visitor is told at step `n`.
 *
 * The ceiling is `RUN_STEPS.length - 1` rather than a typed `2`, which is the
 * difference this module exists to remove: the line above this one in
 * `HeroSequence` derived its ceiling from its own array and this one did not,
 * so a fourth step would have moved the bar and left the words behind.
 */
export function stepCaption(n: number): string {
  return RUN_STEPS[rung(n)].caption;
}

/** How far through the bar is at step `n`. Past the last step, done. */
export function stepPct(n: number): number {
  const i = Math.trunc(n);
  if (Number.isNaN(i) || i < 0) return RUN_STEPS[0].pct;
  if (i >= RUN_STEPS.length) return DONE_PCT;
  return RUN_STEPS[i].pct;
}

/**
 * Roughly how long each step takes, in ms (a scan is about two minutes end to end; scans.step_ms has the measured
 * figures). Only used to pace the bar between the pipeline's own steps - never shown as a time.
 */
export const STEP_EXPECTED_MS: Record<RunStep, number> = { questions: 8_000, reading: 85_000, sources: 15_000, brands: 8_000, ranking: 6_000 };

/**
 * The bar, moving with time inside a step (UX audit, 4 Nov 2026: it sat at 55% for most of the wait, because it
 * only moved when the pipeline wrote a new step and "reading" is most of the two minutes). During step `n` it eases
 * from where the previous step ended towards this step's own figure, reaching about 86% of the way at the step's
 * expected time and creeping on after, so it is never frozen - and never reaches the next figure before the
 * pipeline does, so it never jumps backwards or shows done early. Past the last step, done.
 */
export function pacedPct(n: number, stepElapsedMs: number): number {
  const i = Math.trunc(n);
  if (Number.isNaN(i) || i < 0) return pacedPct(0, stepElapsedMs);
  if (i >= RUN_STEPS.length) return DONE_PCT;
  const start = i === 0 ? 3 : RUN_STEPS[i - 1].pct;
  const end = RUN_STEPS[i].pct;
  const tau = STEP_EXPECTED_MS[RUN_STEPS[i].key] / 2;
  const t = Math.max(0, stepElapsedMs);
  return start + (end - start) * (1 - Math.exp(-t / tau)) * 0.98;
}

