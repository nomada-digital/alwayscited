import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { blankComments, code, sourceFiles } from "../source-read.mts";

/**
 * A campaign reading can never be claimed, so the nightly purge takes its
 * prose - and `/coverage-check` used to promise the opposite.
 *
 * `reading.ts` states this in its own header, as the reason the reading page
 * deliberately renders no answer text: "a reading is never unlocked - it takes
 * no email, so nothing ever sets `unlocked_at`. Every reading's prose is
 * therefore gone a week after it was taken." That sentence is a claim about
 * three files none of which it can see, and nothing held any of it.
 *
 * ## What it cost
 *
 * `/coverage-check` told a visitor: "We ask the same engines a free scan reads
 * - ... - **keep the answers word for word**, and check every source they cite
 * against the coverage you upload."
 *
 * We do not keep them. A benchmark reading is a `scans` row with a
 * `campaign_id`; there is no email field, no unlock route and no verify link
 * on that path, so `completeUnlock` - the only writer of `unlocked_at` in the
 * tree - is unreachable from it. The purge then selects precisely
 * `unlocked_at is null` past `response_retention_days` and clears
 * `response_text`, with no campaign exclusion anywhere in the query. Seven
 * days after a reading, its prose is gone; and `reading.ts` never rendered a
 * word of it to begin with. The page promised something the visitor could
 * never read, on the one surface that then deletes it.
 *
 * That clause is gone (20 Sep 2026). **This file is not the fix - it is what
 * stops the sentence coming back while the facts under it still hold**, and
 * what makes the facts fail loudly if somebody changes them on purpose.
 * Whether a benchmark reading *should* be exempt from the purge is a retention
 * decision with a privacy-policy line attached, so it is blocked.md 30 rather
 * than mine.
 *
 * ## Why this is distinct from blocked.md 29
 *
 * 29 is the wording call over thirteen surfaces that say "verbatim" or "word
 * for word" about text that is assembled and stripped. There the claim is
 * generous and the words a reader saw do survive, which is why it is Danny's.
 * Here the claim was flatly false for this product, which is the case
 * `67bc96d` and `486d63a` both settled as takeable unattended: stop saying the
 * untrue thing, do not invent a new promise.
 *
 * ## Read from source, and why
 *
 * `purge-responses/route.ts` and `unlock.ts` both import `server-only` and
 * neither can be loaded under `node --test`. The properties here are about
 * which query is written and which module writes a column, not about a return
 * value, so a structural check is the honest instrument rather than a
 * second-best one - `constant-time.test.mts` records the same reasoning.
 * Comments are stripped first: every file involved discusses `unlocked_at` in
 * prose, and this file's own header quotes the query it is checking for.
 */

const ROOT = join(import.meta.dirname, "..", "..", "..");
const PURGE = "src/app/api/cron/purge-responses/route.ts";
const UNLOCK = "src/lib/scan/unlock.ts";
const READING = "src/lib/coverage/reading.ts";
const CAMPAIGN = "src/lib/coverage/campaign.ts";

function read(rel: string): string {
  return code(readFileSync(join(ROOT, rel), "utf8"));
}

test("exactly one module in the tree writes unlocked_at", () => {
  // The premise everything below rests on. If a second writer appears, "a
  // reading is never unlocked" stops being a fact about one unreachable
  // function and becomes a claim about however many there now are.
  const writers = sourceFiles(ROOT).filter((f) =>
    /unlocked_at\s*:\s*new Date\(\)\.toISOString\(\)/.test(read(f)),
  );
  assert.deepEqual(writers, [UNLOCK], `unlocked_at is written in: ${writers.join(", ")}`);
});

test("nothing on the campaign path can reach the one writer", () => {
  // `completeUnlock` is the export that stamps it. A benchmark that called it
  // would give readings a claim path, which would make the removed copy true
  // again - so this failing is the signal to re-read blocked.md 30, not a bug.
  assert.ok(
    !read(CAMPAIGN).includes("completeUnlock"),
    `${CAMPAIGN} reaches completeUnlock, so a reading can now be claimed`,
  );
  assert.ok(
    !read(READING).includes("completeUnlock"),
    `${READING} reaches completeUnlock, so a reading can now be claimed`,
  );
});

test("the nightly job clears nothing, so a reading keeps its prose too", () => {
  /**
   * This asserted the opposite until 24 September 2026.
   *
   * It held that the purge selected exactly `unlocked_at is null` with no
   * campaign exclusion, because that was the fact underneath blocked.md 30: a
   * reading can never be claimed, so its prose went at the retention window
   * whatever `/coverage-check` said about it.
   *
   * Danny answered it - transcripts are kept indefinitely - and the job clears
   * nothing at all now. That resolves blocked.md 30 in the direction that
   * needs no campaign exemption, because there is nothing to be exempt from.
   *
   * The rule is turned round rather than deleted. A purge is a thing somebody
   * adds back, and the moment one returns this file's whole subject is live
   * again: readings would be the first thing it took, because they are the
   * rows that can never be claimed.
   */
  const purge = read(PURGE);
  assert.ok(
    !/\.update\(/.test(purge),
    "the nightly job writes again. If a purge is back, a reading is the first thing it clears - it can never be " +
      "claimed - so re-read blocked.md 30 and this file's header before trusting any copy about kept answers.",
  );
  assert.ok(
    !/response_text/.test(purge),
    "the nightly job names response_text again, which is the column every keeping-claim on this site is about",
  );
});

test("the reading page still renders no answer prose", () => {
  // The other half of why the claim was false: even inside the retention
  // window a visitor could not read one. `reading.ts` selects the measured
  // columns off scan_answers and never response_text.
  assert.ok(
    !read(READING).includes("response_text"),
    `${READING} now reads response_text - if a reading shows its answers, the /coverage-check copy can be revisited`,
  );
});

test("a campaign surface may say the answers are kept, because they are", () => {
  /**
   * This was a prohibition until 24 September 2026: on the two campaign-facing
   * pages the claim could not appear AT ALL, because a reading can never be
   * claimed and the purge therefore took its prose at the retention window.
   * The sentence had already been removed from `/coverage-check` once.
   *
   * Transcripts are kept indefinitely now, so the claim is simply true and a
   * prohibition on saying it would be this file holding a page to a fact that
   * has changed underneath it.
   *
   * What is left is the wording rule, which did not change: blocked.md 29
   * retires "verbatim" and "word for word" for stored answers in favour of
   * "what each engine said". A claim about the QUESTIONS being asked again
   * unchanged is a different claim and is still true - `prompts.test.mts` pins
   * the strings - so it is the answers these pages must not describe that way.
   */
  const pages = [
    "src/app/coverage-check/page.tsx",
    "src/app/coverage-check/[token]/page.tsx",
  ];
  const offenders: string[] = [];
  for (const page of pages) {
    for (const m of read(page).matchAll(/[^.]*\b(?:word for word|verbatim)\b[^.]*/gi)) {
      const sentence = m[0].replace(/\s+/g, " ").trim();
      if (/\bquestions?\b/i.test(sentence)) continue;
      offenders.push(`${page}: ${sentence}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    "a campaign surface describes the stored answers as verbatim or word for word, which blocked.md 29 retires:\n" +
      offenders.join("\n"),
  );
});

/**
 * Every surface in the tree that promises the answer TEXT is kept, and whether
 * it names the condition the purge actually applies.
 *
 * ## Why this is not `verbatim-claims.test.mts`
 *
 * That file walks the same pages and asks a different question of them: is the
 * stored text *untouched* (blocked.md 29's wording call). It reads the word
 * `verbatim` and never reads the verb in front of it. **Whether the text is
 * KEPT is a second claim living inside the same sentence, and nothing walked
 * for it** - which is how /about's rule 2 sat beside /legal's "deleted after
 * seven days if nobody claims the scan" for as long as both were published.
 * Two files disagreeing about one fact, one of them a marketing page.
 *
 * ## The pattern, and why it is a pair rather than a word
 *
 * A keeping verb alone matches `could not store the answers` in a throw and
 * `the clusters you keep` on the homepage FAQ; an answer-text noun alone is
 * every line of `engines.ts`. The claim is the two together inside one
 * sentence, in either order - `[^.!?]` is the sentence bound, so a keeping
 * verb in one sentence and the noun in the next is not a promise.
 *
 * ## Read flattened, not line by line
 *
 * A per-line walk was written first and then asked what it could not see,
 * which is the refill this repo runs on its own sweeps. The answer was copy
 * concatenated across lines - `ResultView.tsx` writes its copy as one
 * concatenated string and `verbatim-claims` records that a single line there
 * can carry two claims. **Measured on 20 Sep 2026 the two walks agree at five,
 * so nothing is caught by the change today**; it is here because the direction
 * the per-line walk fails in is the flattering one, and a claim broken over
 * two lines to fit the formatter would have read as a clean tree.
 *
 * Comments are blanked first for the reason `verbatim-claims` needs the same
 * cut: this very header pairs "kept" with "the answers" several times.
 */
const KEEPING =
  /\b(?:stores?|stored|storing|keeps?|kept|keeping|saved?|retain(?:s|ed)?)\b[^.!?]{0,80}?\b(?:verbatim|word for word|response text|full text|transcript|the answers?|whole answer|what each engine said)\b|\b(?:verbatim|word for word|response text|full text|transcript|the answers?|whole answer|what each engine said)\b[^.!?]{0,80}?\b(?:stores?|stored|storing|keeps?|kept|keeping|saved?|retain(?:s|ed)?)\b/i;

/**
 * Where the claim is published and what earns it, `spend-gates`' shape.
 *
 * `holds` is the point: each entry re-earns its own measurement off source, so
 * the day the thing excusing a site changes, this fails rather than going on
 * quietly excusing it. An entry keyed to a FILE would excuse whatever lands in
 * that file next, so each is keyed to the string that makes the claim.
 */
const RETENTION_CLAIMS: {
  file: string;
  needle: string;
  why: string;
  holds: (src: string) => boolean;
}[] = [
  {
    file: "src/app/about/page.tsx",
    needle: "Store the whole answer",
    why:
      "a rule card's three-word title; the bound is in the body of the same RULES entry, immediately below it. " +
      "It named the purge condition until 24 September 2026 and now names what replaced it",
    holds: (src) => {
      const at = src.indexOf('title: "Store the whole answer"');
      return at >= 0 && /^[^}]*\bkept for as long as the reading is\b/.test(src.slice(at));
    },
  },
  {
    file: "src/app/about/page.tsx",
    needle: "are kept per question",
    why:
      "measurement rule 2. It named the purge condition until 24 September 2026; there is no purge now, so " +
      "what it has to name instead is the fact that replaced it - the text is kept as long as the reading is",
    holds: (src) => /kept per question[^"]*\bkept for as long as the reading is\b/.test(src),
  },
  {
    file: "src/app/compare/page.tsx",
    needle: "Stores what each engine said behind every reading",
    why:
      "a feature row under a column that is the alwayscited TIER, not a scan this tree runs - " +
      "nothing here creates a paid-tier scan (blocked.md 32). Its retention was not this purge, and there " +
      "is no purge now either way",
    holds: (src) => /COLUMNS[^=]*=\s*\[\{\s*key:\s*"us",\s*label:\s*<TierName tier="cited"/.test(src),
  },
  {
    file: "src/app/legal/page.tsx",
    needle: "and so is what each engine said",
    why:
      "the privacy policy, and since 24 September 2026 it is the surface that states the retention decision " +
      "rather than one that has to be bounded by it. Its own bound is the sentence after it, which says the " +
      "seven-day deletion no longer happens - so the claim and the reason it is true travel together",
    holds: (src) => /so is what each engine said[^<]*\.[^<]*we do not/i.test(src.replace(/\s+/g, " ")),
  },
  {
    file: "src/lib/scan/pipeline.ts",
    needle: "could not store the answers",
    why: "not a published surface - the message of a thrown Error on the insert path",
    holds: (src) => /throw new Error\(`could not store the answers/.test(src),
  },
  {
    file: "src/lib/tracking/runner.ts",
    needle: "could not store the answers",
    why:
      "not a published surface - the daily tracking runner's thrown Error on its answer upsert (T1, 29 Sep " +
      "2026). Tracked answers are kept while the plan runs and for 90 days after it ends (Danny, 18 Oct 2026; " +
      "was 'the life of the account', per the dashboard brief)",
    holds: (src) => /throw new Error\(`could not store the answers/.test(src),
  },
  {
    file: "src/config/help.ts",
    needle: "What we keep of each answer is what each engine said",
    why:
      "the help centre's daily-check article (MK-2, 9 Oct 2026), about tracked answers, not a scan. Its bound " +
      "is the next sentence - kept while the plan runs and 90 days after (Danny's 18 Oct 2026 decision, also in " +
      "the plan-ended email), the bound the runner.ts entry cites and /legal " +
      "states - and what earns the bound is that nothing in the tree deletes or clears a tracking_answers row",
    holds: (src) =>
      /What we keep of each answer is what each engine said[^`]*\.\s*Both are kept while your plan runs, and for \$\{KEPT_DAYS\} days after it ends\./.test(src) &&
      !trackedAnswerRemovers().length,
  },
  {
    file: "src/config/help.ts",
    needle: "on a tracked account, what each engine said every day is kept in your account for ${KEPT_DAYS} days after the plan ends",
    why:
      "the help centre's data section (MK-2, 9 Oct 2026): stopping a prompt and a plan ending delete nothing. " +
      "The bound is inside the sentence, and what earns it is the same as the entry above: nothing in the " +
      "tree deletes or clears a tracking_answers row",
    holds: () => !trackedAnswerRemovers().length,
  },
];

/**
 * What could take a tracked answer away: a database delete whose table is
 * tracking_answers or not a literal at all, or an update on tracking_answers,
 * which is how response_text would be cleared. Empty on 9 Oct 2026, when the
 * help centre's two keeping-claims were recorded on it - the tree's one
 * database delete is stripe_events, the webhook's replay guard. A delete with
 * its table in a variable counts, because the walk cannot tell which table it
 * reaches. Throws when the walk sees no delete at all, so a probe that stopped
 * matching cannot read as a tree that deletes nothing.
 *
 * One update is not a remover, and is pinned by its exact payload in
 * BRANDS_ONLY: the re-run's (03510f7, merged 9 Oct 2026) writes the brands it
 * read again from the stored text, and brands_ok, onto the row the first pass
 * stored. response_text and what the engine said are not in it. Any other
 * update, or this one writing another column, still counts; and a pinned
 * payload the walk no longer finds is reported, so the entry cannot outlive it.
 */
const BRANDS_ONLY = new Set([".update(hasBrandsOk(kept!) ? { brands, brands_ok: true } : { brands })"]);

function trackedAnswerRemovers(): string[] {
  const out: string[] = [];
  const pinned = new Set<string>();
  let deletes = 0;
  for (const rel of sourceFiles(ROOT)) {
    const src = code(readFileSync(join(ROOT, rel), "utf8"));
    for (const m of src.matchAll(/\.from\(([^)]*)\)/g)) {
      const end = src.indexOf(";", m.index);
      const chain = src.slice(m.index, end < 0 ? undefined : end);
      const table = /^\s*["'`](\w+)["'`]\s*$/.exec(m[1]!)?.[1] ?? null;
      const isDelete = /\.delete\(/.test(chain);
      if (isDelete) deletes++;
      const flat = chain.replace(/\s+/g, " ");
      const brandsOnly = !isDelete && [...BRANDS_ONLY].find((p) => flat.includes(p) && flat.split(".update(").length === 2);
      if (brandsOnly) pinned.add(brandsOnly);
      const reaches = isDelete ? table === null || table === "tracking_answers" : table === "tracking_answers" && /\.update\(/.test(chain) && !brandsOnly;
      if (reaches) out.push(`${rel}: ${flat.slice(0, 120)}`);
    }
  }
  for (const p of BRANDS_ONLY) if (!pinned.has(p)) out.push(`BRANDS_ONLY pins ${p}, which the walk no longer finds - take it out`);
  if (deletes < 1) throw new Error("the walk for database deletes found none - the webhook's stripe_events delete is gone, or the probe has drifted");
  return out;
}

/** Every claim in one file, flattened so a sentence broken over lines is one match. */
function keepingClaims(rel: string): string[] {
  const flat = blankComments(readFileSync(join(ROOT, rel), "utf8")).replace(/\s*\n\s*/g, " ");
  return [...flat.matchAll(new RegExp(KEEPING.source, "gi"))].map((m) => m[0].replace(/\s+/g, " "));
}

test("every surface promising the answer text is kept is on the list", () => {
  const found = new Map<string, string[]>();
  let total = 0;
  for (const rel of sourceFiles(ROOT)) {
    const claims = keepingClaims(rel);
    if (!claims.length) continue;
    found.set(rel, claims);
    total += claims.length;
  }

  // A floor, because the walk narrowing to nothing reads exactly like a clean
  // tree. Five sites on 20 Sep 2026, four of them published copy; four when
  // ProcessSequence replaced HeroSequence on 24 Sep 2026 and took the waiting
  // sequence's "stored word for word" act with it; five again later the same
  // day, when /legal stopped promising a deletion and started promising the
  // opposite - which is a keeping-claim where it used to be the bound on
  // everybody else's. Seven on 9 Oct 2026, with the help centre's two (MK-2),
  // and the floor moved with them: at five, a walk that stopped seeing those
  // two would still have passed.
  assert.ok(total >= 7, `the walk found ${total} keeping-claims, was 7 - it has narrowed`);

  /**
   * By COUNT per file as well as by membership.
   *
   * Membership alone is a file-keyed exemption, which excuses whatever lands
   * in that file next - /about already carries two of these, so "about is on
   * the list" would wave through a third. The count is what makes a new claim
   * inside an already-listed file fail.
   */
  const unlisted: string[] = [];
  for (const [file, claims] of found) {
    const recorded = RETENTION_CLAIMS.filter((c) => c.file === file).length;
    if (!recorded) unlisted.push(`${file} is not on the list: ${claims.join(" | ")}`);
    else if (claims.length !== recorded) {
      unlisted.push(`${file} makes ${claims.length} keeping-claims, ${recorded} recorded: ${claims.join(" | ")}`);
    }
  }

  assert.deepEqual(
    unlisted,
    [],
    "a surface promises the answer text is kept and nothing on the list bounds it - the purge clears\n" +
      "response_text on every scan with unlocked_at null, campaign readings included:\n" +
      unlisted.map((f) => `  ${f}`).join("\n"),
  );
});

test("every listed surface still earns the reason it is listed under", () => {
  const broken: string[] = [];
  for (const c of RETENTION_CLAIMS) {
    const src = blankComments(readFileSync(join(ROOT, c.file), "utf8"));
    if (!src.includes(c.needle)) broken.push(`${c.file}: "${c.needle}" is gone - drop the entry`);
    else if (!c.holds(src)) broken.push(`${c.file}: "${c.needle}" no longer holds: ${c.why}`);
  }
  assert.deepEqual(broken, [], broken.join("\n"));
});

test("the retention setting is a row nothing reads", () => {
  /**
   * This asserted the opposite until 24 September 2026: that there was one
   * knob, that the purge read it, and that a migration seeded it - so "a week
   * after it was taken" could not quietly become something else.
   *
   * Retention is indefinite now and the job reads nothing. The row stays in
   * `app_settings` because it is data and deleting live rows is not ours, and
   * the migration that seeds it is untouched for the same reason - so what is
   * worth holding is the other direction: **nothing in the code reads that
   * setting any more.** A reader coming back would otherwise find a knob in
   * the settings table, turn it, and watch nothing happen.
   */
  assert.ok(
    !/response_retention_days/.test(read(PURGE)),
    "the nightly job reads the retention setting again, so a purge is back - see the rule above",
  );
  const readers = sourceFiles(ROOT).filter((f) =>
    code(readFileSync(join(ROOT, f), "utf8")).includes("response_retention_days"),
  );
  assert.deepEqual(
    readers,
    [],
    "something reads response_retention_days again. The row is data nothing acts on; a reader means the " +
      "retention decision of 24 September 2026 has been reopened somewhere:\n" + readers.join("\n"),
  );
});
