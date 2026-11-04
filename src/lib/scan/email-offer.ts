/**
 * "Do not have time to wait? We will email it to you."
 *
 * Danny, 20 September 2026, item 5, and his own idea. Not a speed fix: **it
 * converts a bounce into a captured address.** Everybody who gives up at ninety
 * seconds is lost silently today.
 *
 * Two decisions live here rather than in `ScanFlow.tsx`, because that file is
 * JSX and nothing can execute it: **when the offer may appear**, and **what it
 * is allowed to promise**. Both are things a visitor reads and acts on, and the
 * second is a claim about our own product that the gate can make false.
 *
 * No `server-only` and no imports beyond the step vocabulary, so `node --test`
 * loads it. Relative and extensionful for the same reason as `run-steps.ts`.
 */

import { STEP, STEP_INDEX } from "./run-steps.ts";

/**
 * The step the offer waits for: the reads.
 *
 * Derived through `STEP_INDEX`, never typed. A literal here is this repo's own
 * named defect species - a fixed rung picked by index against a list that can
 * grow - and it shipped once already in this exact file's caller, where
 * `setProgress(3)` meant "done" until the ladder gained two rungs.
 *
 * The fallback cannot fire: `STEP.reading` is derived from `RUN_STEPS` and
 * `STEP_INDEX` is built from the same array, so the key is always present.
 * `email-offer.test.mts` asserts that rather than trusting it, because a `?? 0`
 * that silently became live would offer to email a report during question
 * generation.
 */
export const OFFER_STEP = STEP_INDEX.get(STEP.reading) ?? 0;

/**
 * How long the reads must have been running before the offer appears.
 *
 * **Danny said "maybe 10 seconds" and the instinct is right while the number is
 * a guess at a distribution nobody has measured.** So it is tied to the run
 * rather than to page load: the clock starts when the engine reads start, which
 * is the phase that actually takes the time, and it cannot fire while the
 * questions are being generated - a scan that is four seconds old has nothing
 * to email and offering reads as an apology for a wait that has not happened.
 *
 * Nine seconds is deliberately under his ten. The offer is only useful before
 * somebody has decided to leave, and by the time a visitor is bored enough to
 * reach for the tab close they are past reading a new panel.
 *
 * **This number is provisional and the way to settle it is now in the tree.**
 * `scans.step_ms` records per-phase elapsed since `71f3b62`, so the reading
 * phase's real distribution is one query away as soon as scans have run -
 * blocked.md 34. Pick it off that rather than arguing about it.
 */
export const OFFER_AFTER_MS = 9_000;

/**
 * Whether the offer may be shown yet.
 *
 * Both conditions, and the step one is not decoration: without it a scan whose
 * question generation takes twelve seconds offers to email a report before a
 * single engine has been asked anything.
 */
export function offerReady(step: number, readingForMs: number): boolean {
  return step >= OFFER_STEP && readingForMs >= OFFER_AFTER_MS;
}

/**
 * What the offer says, and the constraint on every word of it.
 *
 * **It cannot promise what the gate withholds.** The message links to
 * `/scan/<token>`, which serves the free result and the gate exactly as the
 * screen does - so what arrives is what the visitor is already looking at, and
 * the copy says that and no more. The placement list, the verbatim answers and
 * the gated engines are what an address *unlocks*, and this address is not
 * being traded for them: it buys a copy of a free thing.
 *
 * That distinction is the whole reason these strings are here where a test can
 * read them. The gate's own copy two hundred lines away in `ScanFlow` sells the
 * placement list, correctly, and the two panels can be on screen within a
 * minute of each other. `email-offer.test.mts` asserts this one names none of
 * it, one assertion per word, for the reason recorded at the foot of this file.
 */
export const OFFER_COPY = {
  // `wait` is shown from the moment the reads start, above the sequence - Danny, 24 Sep
  // 2026: say up front how long it takes and offer the way out, rather than
  // letting somebody discover the wait. Not a measured figure; the per-step
  // timings on `scans.step_ms` are the place to check it against.
  wait: "This usually takes around two minutes.",
  // HeroSequence.dc.html (25 Sep): the wait is said under the scan's own
  // heading, and the offer is a card beside it that asks the question. The
  // close-this-tab sentence is not on the board and stays - see the test.
  // "Rather not wait?" - Danny, 2 Oct 2026, over the board's wording.
  heading: "Rather not wait?",
  body: "We will email the result the moment it is ready. You can close this tab and the scan keeps running.",
  // "Work email", as at the report gate (UX audit, 4 Nov 2026); a personal address is still accepted.
  label: "Work email",
  placeholder: "you@company.com",
  submit: "Email me",
  sending: "Saving",
  /** Shown once the address is recorded. Says the tab is safe to close, because that is the point. */
  queued: "We'll email your report the moment it's ready. You can close this tab.",
  /**
   * The third point at which this site collects an address, so it says so and
   * points at the page that explains it. /legal was updated in the same commit
   * - the privacy line is not a follow-up, it ships with the collection.
   */
  // 3 Nov 2026: the gate's own wording. "Nothing else" stopped being true when follow-ups about the report began.
  privacy: "We'll email your report and may follow up about it. Unsubscribe any time.",
} as const;

/** `queued`, naming the address the report gate took, or the masked one on a reload (3 Nov 2026). */
export function queuedTo(email: string): string {
  return `We'll email your report to ${email} the moment it's ready. You can close this tab.`;
}

/**
 * The list of things this copy may not promise is in `email-offer.test.mts`
 * and not here, and that is a finding rather than a preference.
 *
 * It was an exported `GATED_PROMISES` in this file for about an hour.
 * `verbatim-claims.test.mts` failed on it immediately: the list contained the
 * literal "word for word", so **the prohibition read as one more surface
 * publishing the claim it exists to forbid.** That sweep walks the source tree
 * because the claim lives on thirteen surfaces a page walk cannot see, and it
 * strips comments - but this was a string, in shipping source, and a string is
 * what a published claim looks like.
 *
 * The file-keyed exemption was the obvious fix and is the wrong one: an
 * exemption keyed to a file excuses whatever lands in it next. A test's own set
 * with an assertion per member is the shape this repo already endorses, and it
 * is also the truer description - those words are a reviewer's checklist, not a
 * thing the product says.
 */
