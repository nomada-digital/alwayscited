import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { blankComments, sourceFiles } from "../lib/source-read.mts";
import { T } from "./tokens.ts";

/**
 * Every colour value written in shipped source, and whether the palette
 * contains it.
 *
 * ## The claim this was written for
 *
 * `config/tokens.ts` opens: "There is one palette now, and this is it. No file
 * defines the old values any more - the `C` object on the ops page is a set of
 * named aliases onto these." Three clauses, and the census in
 * `docs/prose-claims.mjs` found it by the second one. Measured on
 * 20 September 2026:
 *
 * - "No file defines the old values any more" - **true**. `#0B1220`, `#F8F7FF`,
 *   `#0D1B2A`, `#D85A30` and the Georgia stack appear nowhere in `src`.
 * - "the `C` object is a set of named aliases onto these" - **true**. All eight
 *   members of `C` in `admin/scans/page.tsx` are `T.` reads.
 * - "There is one palette now, and this is it" - **false**. Fifteen hex values
 *   and six `rgba()` values are written outside this file, at 47 sites. And the
 *   file offered as the evidence for the sentence, the ops page, carries eight
 *   of them one line away from the `C` object that makes the clause true.
 *
 * That is the shape `1ff1336` records: a true clause joined to a false one is
 * what makes a sentence read as settled.
 *
 * ## Why nothing could see it
 *
 * `contrast.test.mts` reads every colour on this site and asks whether it is
 * **readable on its ground**. This asks whether it is **in the palette**, and
 * the two come apart in the direction that matters: a hand-typed hex that
 * clears AA is invisible to the contrast sweep while looking straight at it.
 * That is not hypothetical. `verify-email.ts` records two of exactly these -
 * "#f6f6f8 where the ground is #f6f6f7, #eceef2 where the rule is #ececee" -
 * which went "straight through a sweep that moved all 21 pages onto the
 * tokens".
 *
 * **One place in this tree already solved that, and it is worth saying which,
 * because it narrows what is new here.** `email-render.test.mts` holds the
 * email: "no colour outside the palette reaches the inbox" walks the rendered
 * markup for a hex outside `E`, and "the email palette is the tokens, plus
 * only its documented departures" pins `body:#3d4451` as the only literal
 * allowed in it. Both are good and neither is replaced by anything here.
 *
 * What was missing is that **the denominator stopped at that one module.** It
 * is `contact.test.mts` again - correct about every colour it named, reading
 * one file - while 47 sites across twenty other files had nothing at all. The
 * email was the only surface on this product whose palette was closed.
 *
 * It also needs no build, where `contrast.test.mts` skips without one: a value
 * typed into a server module never reaches a rendered page at all.
 *
 * ## How an entry earns its place, and who decides
 *
 * Not by my taste. `docs/design/` holds the 23 artboards, and the question
 * "did somebody type this, or did the design draw it" is answered by grepping
 * them. Measured 20 September 2026, and it split the set cleanly:
 *
 * - ten of the fifteen hex values are drawn by between two and 23 boards. They
 *   are palette members that never got a name, not typos.
 * - `#3d4451` and `#92400e` are drawn by **no board at all**, and both sit in
 *   the two files no page sweep can reach - the transactional email, which is
 *   not a page, and the ops page, which answers 401 (blocked.md 19).
 *
 * The boards are untracked, so this file cannot read them; the count and the
 * date are recorded per entry instead, and what is re-earned in-tree is the
 * **occurrence**: the files a value may appear in and how many times in each.
 * Keyed that way rather than to a file for the reason the queue records - an
 * exemption keyed to a FILE excuses whatever lands in it next - and counted per
 * file because two of these files carry the same value twice.
 *
 * ## Two things it cannot see, asked while the denominator is fresh
 *
 * - **A colour built rather than written.** `T.accent + "22"`, a template
 *   literal, a value out of a `.json`. Nothing here parses expressions. The one
 *   live instance of the shape is `rgba(124,58,237,0.28)` in `globals.css`, and
 *   it is not on the list below: rule 2 derives it from `T.accent` instead,
 *   because a value that can be proved should not be excused.
 * - **A colour named rather than numbered.** `red`, `white`, `transparent` are
 *   CSS keywords and no rule here matches one. Checked rather than assumed:
 *   `color: white` and `background: red` appear nowhere in `src`, so there is
 *   no live instance and a rule for it would be decoration today.
 */

const ROOT = join(fileURLToPath(import.meta.url), "..", "..", "..");

/**
 * The walk, and it is deliberately wider than `sourceFiles`.
 *
 * That helper covers `.tsx?`/`.mts` and cannot see a stylesheet, and three of
 * the values below are in `globals.css` - including the CTA gradient stop
 * blocked.md 31 is open on. The queue's own rule is that the stylesheet is a
 * fourth surface every page sweep here was blind to, so a palette census that
 * skipped it would be making the same mistake one file along.
 *
 * **The stylesheets are walked for, not typed.** The first draft of this file
 * wrote `["src/app/globals.css"]`, which is a hand-typed denominator *inside* a
 * rule - the species the queue records paying for three times in one sitting,
 * and it fails in the flattering direction: a second stylesheet would join the
 * tree carrying any colour it liked and this sweep would go on reporting one
 * palette. There is exactly one today, and that is a fact the walk re-derives
 * rather than a fact this file asserts.
 */
function stylesheets(dir = "src", out: string[] = []): string[] {
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) stylesheets(rel, out);
    else if (/\.(css|scss|sass|less)$/.test(entry.name)) out.push(rel);
  }
  return out;
}

const FILES = [...sourceFiles(ROOT), ...stylesheets()].filter((f) => !f.endsWith("config/tokens.ts"));

/**
 * A colour literal.
 *
 * The `(?<![&\w])` guard is not decoration and it was found by running this:
 * `email-render.ts` contains `&#8203;`, the zero-width space, and a bare
 * `#[0-9a-f]{3,8}` reads the `8203` out of an HTML entity as a four-digit hex.
 * A census reporting a defect in a file that has none is the noisy direction,
 * and the queue records why that is not harmless - the obvious fix is an
 * exemption, and the exemption then excuses the real value that lands there.
 *
 * Lengths are enumerated rather than given as `{3,8}` for the same reason: 3,
 * 4, 6 and 8 are the hex forms CSS has, and `{3,8}` matches five-digit and
 * seven-digit runs that are not colours at all.
 */
const LITERAL =
  /(?<![&\w])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})\b|\b(?:rgba?|hsla?)\([^)]*\)/g;

/** Every value the palette contains, as written. */
const PALETTE = new Set(Object.values(T).map((v) => v.toLowerCase()));

type Site = { value: string; file: string };

/**
 * Every colour literal in the tree that the palette does not contain.
 *
 * Comments blanked rather than stripped, which is load-bearing twice over
 * here: this file's own subject is hex values, and `tokens.ts`, `verify-email.ts`
 * and `what-is-aeo/page.tsx` all quote off-palette hexes **in prose** while
 * explaining them. A stripper that left the prose in would report the
 * explanation of a defect as the defect - the `0a3aa9e` failure, on a sweep
 * whose whole subject is the thing the prose names.
 */
function offPalette(): Site[] {
  const out: Site[] = [];
  for (const file of FILES) {
    const src = blankComments(readFileSync(join(ROOT, file), "utf8"));
    for (const m of src.matchAll(LITERAL)) {
      const value = m[0].toLowerCase().replace(/\s+/g, "");
      if (PALETTE.has(value)) continue;
      out.push({ value, file });
    }
  }
  return out;
}

/**
 * The colours written outside the palette, each with what makes it one and the
 * occurrences it is allowed at.
 *
 * `boards` is how many of the 23 artboards in `docs/design/` draw the value,
 * read on 20 September 2026. It is the evidence and it is not re-earnable from
 * here - the boards are untracked - so it is dated rather than asserted, and
 * `sites` is the part this file holds.
 */
type Entry = { why: string; boards: number; sites: Record<string, number> };

const OFF_PALETTE: Record<string, Entry> = {
  // ---- board values the tokens file never got a name for -------------------
  // 18 Oct 2026, brief 2d: the Clusters page's stop toast values, rgba(15,17,21,.6) (its drop shadow) and
  // rgba(255,255,255,.12) (its Undo ground), were written once each in src/components/app/Clusters.tsx; /app retired,
  // every address 308s to the dashboards host, so the file and both entries went.
  "#fbfbfc": {
    why: "the raised panel ground, and the most-typed value in this list. blocked.md 9 already treats it as a real ground - its table measures `soft` at 4.53 on it - so it is a palette member in everything but a name.",
    boards: 10,
    sites: {
      "src/app/compare/page.tsx": 1,
      // pr-agencies/page.tsx left on 25 Sep 2026 (Q12): the dead coverage
      // card is D.card on the dark fan-out now.
      // what-is-aeo/page.tsx left on 26 Sep 2026 (R18): the table header row
      // is white on WhatIsAeo.dc.html.
      // white-label/page.tsx left on 25 Sep 2026 (Q14): the table header row
      // went when the rows became WhiteLabel.dc.html's six cards.
      "src/components/scan/ConfirmScreen.tsx": 1,
      // ResultView.tsx left this list on 25 Sep 2026: 3 -> 2 in Q09 (the
      // question table's header row went) and 2 -> 0 in Q10 (the placement
      // table's header and the answer cards' head band are white on
      // ScanResult.dc.html).
      // ResultView.tsx back on 30 Sep 2026 (R114 S1): the alwaystracked band
      // at the foot of "Your first cluster", ScanCluster.dc.html.
      "src/components/scan/ResultView.tsx": 1,
    },
  },
  "#fcfbff": {
    why: "the chosen keyword node's ground on the scan result's first cluster, ScanCluster.dc.html (30 Sep 2026, R114 S1) - a hair off white with a purple cast, under #c4b5fd. `T.wash` is too strong a tint for a 300px card holding a 44px figure. The count is from docs/site-boards-2026-09-29 and docs/boards-2026-09-25, not docs/design.",
    boards: 2,
    // Second ResultView site on 30 Sep 2026 (R114 S1, cta=checkout): the
    // "Your first cluster, set up from this scan" box in the checkout card,
    // the same ground under the same keyword.
    sites: { "src/components/scan/ResultView.tsx": 2 },
  },
  "#3f4451": {
    why: "body prose on the two long-form templates, drawn by BlogPost.dc.html and CaseStudy.dc.html - the two boards whose pages these are. Darker than `T.soft` because long-form body text is, at 9.74 on white against soft's 4.68.",
    boards: 2,
    // what-is-aeo/page.tsx joined on 26 Sep 2026 (R18): WhatIsAeo.dc.html
    // draws its long-read card in #3f434c, the same role; this value is used
    // rather than a third near-identical grey.
    sites: { "src/app/case-studies/vibe-retail/page.tsx": 2, "src/app/what-is-aeo/page.tsx": 1, "src/components/PostShell.tsx": 1 },
  },
  // "#d6d8dd" left this list on 25 Sep 2026 (Q12): the grey stub of the dead
  // piece on /pr-agencies, its only site, is D.quiet on the dark fan-out now,
  // as PRAgencies.dc.html (25 Sep read) draws it.
  "#c8cad0": {
    why: "the 'not you' bar on a share-of-voice chart, from Flow2Free.dc.html and HeroSequence.dc.html.",
    boards: 2,
    sites: { "src/components/scan/ResultView.tsx": 1 },
  },
  "rgba(15,17,21,.28)": {
    why:
      "the soft shadow under a floating product panel in ProcessSequence, from the 25 Sep 2026 site brief - " +
      "which allows a shadow there and states that everything else keeps hairlines. It is `T.ink` at 28%, not a " +
      "fourth grey: the shadow under a white panel on a near-white ground has to be the ink or it reads brown. " +
      "**Do not tokenise it.** A shadow colour is not a surface colour, nothing else on the site may use it, and " +
      "a token would invite exactly that.",
    boards: 1,
    sites: { "src/components/ProcessSequence.tsx": 1 },
  },
  "#c9ccd3": {
    why:
      "the 'not you' dot, from HeroSequence.dc.html and Journey.dc.html. **Do not tidy this into `#c8cad0`.** " +
      "They are one character apart and they mean the same thing - which is what a drift looks like. It is not " +
      "one: the boards draw both, and two of them draw this value specifically. Checking the boards is what " +
      "stopped this being 'fixed' on 20 September 2026. They no longer sit in the same file: SerpPanel moved " +
      "to ProcessSequence.tsx when HeroSequence was replaced, and the share-of-voice bar stayed in ResultView.",
    boards: 2,
    sites: { "src/components/ProcessSequence.tsx": 1 },
  },
  "#a78bfa": {
    why: "the lockup accent lifted for a dark ground, in `.on-dark .tier-name__accent`. `T.accent` is unreadable on near-black, and this still goes through `TierName` rather than a hand-coloured span.",
    boards: 2,
    // dark.ts since 25 Sep 2026: the header mark and the h1 accent on the
    // homepage's dark hero, which are not lockups and so cannot reach it
    // through `.on-dark`.
    // ResultView.tsx since 30 Sep 2026 (R114 S1): the solid link from a
    // prompt an engine named you on to the keyword node, ScanCluster.dc.html.
    // A non-text mark on white; the row's pill carries the fact.
    sites: { "src/app/globals.css": 1, "src/components/home/dark.ts": 1, "src/components/scan/ResultView.tsx": 1 },
  },

  // The homepage's dark hero, from Main.dc.html (25 Sep 2026, Q02). All of
  // them are written once, in components/home/dark.ts, and the board counts
  // are docs/boards-2026-09-25/, which is the later read - docs/design draws
  // none of them bar #c4b5fd. Several are drawn by the other dark boards
  // (PRAgencies, ScanResult, HeroSequence) too, so whether they become a dark
  // token set is the same design-system call as blocked.md 33.
  "#111218": {
    why: "the dark hero ground on `/`, under the header as well. Drawn by every dark Final-site board, which is the strongest case on this list for a token.",
    boards: 7,
    sites: { "src/components/home/dark.ts": 1 },
  },
  "#1b1c23": {
    why: "the scan field and the typed-question pill on the dark hero, one step above the ground.",
    boards: 1,
    sites: { "src/components/home/dark.ts": 1 },
  },
  "#2a2b33": {
    why: "the hairline round the dark field and the typed-question pill - the dark ground's `T.line`.",
    boards: 1,
    sites: { "src/components/home/dark.ts": 1 },
  },
  "#17181f": {
    why: "the engine card ground in the homepage demo, between the hero ground and the field.",
    boards: 3,
    sites: { "src/components/home/dark.ts": 1 },
  },
  "#262730": {
    why: "the engine card's hairline in the homepage demo.",
    boards: 3,
    sites: { "src/components/home/dark.ts": 1 },
  },
  "#24252d": {
    why: "the two placeholder text bars on each engine card - a non-text mark, never measured for contrast.",
    boards: 3,
    sites: { "src/components/home/dark.ts": 1 },
  },
  "#a1a1aa": {
    why: "nav links and the standfirst on the dark hero; 7.29 on #111218. The dark boards' `soft`, drawn by eight of them.",
    boards: 8,
    sites: { "src/components/home/dark.ts": 1 },
  },
  "#8b8b95": {
    why: "the line under the scan field on the dark hero; 5.54 on #111218. Its board sibling #6f7480 measures 3.99 there and is not used - `T.faint` takes those roles.",
    boards: 1,
    sites: { "src/components/home/dark.ts": 1 },
  },
  "#d4d4d8": {
    why: "the engine name on a dark demo card; 11.97 on #17181f.",
    boards: 3,
    // ResultView.tsx since 30 Sep 2026 (R114 S1): the dashed link from a
    // prompt no engine named you on, ScanCluster.dc.html. A non-text mark.
    sites: { "src/components/home/dark.ts": 1, "src/components/scan/ResultView.tsx": 1 },
  },
  "#c4b5fd": {
    why: "the typing caret in the demo question - a non-text mark.",
    boards: 4,
    // ResultView.tsx since 30 Sep 2026 (R114 S1): the keyword node's border,
    // solid when a keyword was picked and dashed when none was,
    // ScanCluster.dc.html. A non-text mark.
    sites: { "src/components/home/dark.ts": 1, "src/components/scan/ResultView.tsx": 2 },
  },
  "#fca5a5": {
    why: "the 'not named' pill text on a dark card, and the field's error line on the dark hero; 9.32 on #17181f. `T.badFg` is for light grounds.",
    boards: 1,
    sites: { "src/components/home/dark.ts": 1 },
  },
  "rgba(239,68,68,.14)": {
    why: "the 'not named' pill ground on a dark card - the dark board's `T.badBg`.",
    boards: 1,
    sites: { "src/components/home/dark.ts": 1 },
  },
  "rgba(124,58,237,.22)": {
    why: "the upper-left purple wash on the dark hero, and on the /pr-agencies hero (WASH_PR, Q12, 25 Sep 2026). `T.accent` at 22%, written as the board writes it.",
    boards: 3,
    // 1 -> 2 on 25 Sep 2026 (Q12): WASH_PR.
    sites: { "src/components/home/dark.ts": 2 },
  },
  "rgba(124,58,237,.16)": {
    why: "the lower-right purple wash on the dark hero. `T.accent` at 16%.",
    boards: 1,
    sites: { "src/components/home/dark.ts": 1 },
  },
  "rgba(124,58,237,.2)": {
    why: "the upper-right purple wash on the dark packages band, from Packages.dc.html (Q04, 25 Sep 2026). `T.accent` at 20%, written as the board writes it.",
    boards: 1,
    sites: { "src/components/home/dark.ts": 1 },
  },
  "rgba(124,58,237,.25)": {
    why: "the upper-right purple wash on the result's dark alwaystracked card, from ScanResult.dc.html (Q10, 25 Sep 2026). `T.accent` at 25%, written as the board writes it.",
    boards: 1,
    sites: { "src/components/home/dark.ts": 1 },
  },
  "rgba(17,18,24,0)": {
    why: "the fade-out stop of the hero's two washes, the packages band's one and the result's alwaystracked card's one (Q04 and Q10, 25 Sep): the dark ground at zero alpha, so the wash fades into the ground rather than through grey.",
    boards: 6,
    // 3 -> 4 on 25 Sep 2026 (Q10): TRACKED_WASH. 4 -> 5 the same day (Q12): WASH_PR.
    // 5 -> 6 on 26 Sep 2026 (R18): CLOSE_WASH.
    sites: { "src/components/home/dark.ts": 6 },
  },
  "rgba(124,58,237,.28)": {
    why: "the upper-left wash on the dark closing card of /how-it-works and /what-is-aeo (CLOSE_WASH, R18, 26 Sep 2026), from HowItWorks.dc.html and WhatIsAeo.dc.html. `T.accent` at 28%, written as the boards write it.",
    boards: 2,
    sites: { "src/components/home/dark.ts": 1 },
  },
  "rgba(15,17,21,.45)": {
    why: "the lift under the launch video and the dark answer card on /how-it-works (LIFT, R18, 26 Sep 2026), from HowItWorks.dc.html. `T.ink` at 45%. A shadow colour, not a surface one - **do not tokenise it**, for the same reason as the ProcessSequence panel shadow.",
    boards: 1,
    sites: { "src/components/home/dark.ts": 1 },
  },
  "rgba(15,17,21,.30)": {
    why: "the softer lift under the results card on /what-is-aeo (LIFT_SOFT, R18, 26 Sep 2026), from WhatIsAeo.dc.html. `T.ink` at 30%. A shadow colour - **do not tokenise it**.",
    boards: 1,
    sites: { "src/components/home/dark.ts": 1 },
  },
  "rgba(0,0,0,.08)": {
    why: "the 1px lift under the chosen half of the walkthrough switch, from ScanResult.dc.html (Q10, 25 Sep 2026). A shadow colour, not a surface one - **do not tokenise it**, for the same reason as the ProcessSequence panel shadow.",
    boards: 1,
    sites: { "src/app/globals.css": 1 },
  },
  "#a855f7": {
    why: "the far stop of the primary CTA gradient, and the subject of blocked.md 31 - white measures 3.96 on it, under AA. `contrast.test.mts` pins both stops by measurement and fails if either moves, so this entry is the palette half of a value that already has a contrast half.",
    boards: 23,
    sites: { "src/app/globals.css": 1 },
  },

  // ---- somebody else's brand, which must never become a token --------------
  //
  // These five are one row each in `ENGINE_SPECS`, and they are the one group
  // here that must stay off the palette rather than joining it: a token is a
  // value this design system owns, and none of these is ours to move.
  "#ea4335": {
    why: "Google's own brand red, on the engine chip for AI Overviews. Not ours to change or to tokenise.",
    boards: 0,
    sites: { "src/lib/scan/engines.ts": 1 },
  },
  "#10a37f": {
    why: "OpenAI's own brand green, on the ChatGPT chip. Not ours to change or to tokenise.",
    boards: 0,
    sites: { "src/lib/scan/engines.ts": 1 },
  },
  "#4285f4": {
    why: "Google's own brand blue, on the Gemini chip. Not ours to change or to tokenise.",
    boards: 0,
    sites: { "src/lib/scan/engines.ts": 1 },
  },
  "#20808d": {
    why: "Perplexity's own brand teal, on its engine chip. Not ours to change or to tokenise.",
    boards: 0,
    sites: { "src/lib/scan/engines.ts": 1 },
  },
  "#d97757": {
    why: "Anthropic's own brand clay, on the Claude chip. Not ours to change or to tokenise.",
    boards: 0,
    sites: { "src/lib/scan/engines.ts": 1 },
  },
  // Added 25 Sep 2026 (Q14). A made-up agency's brand, the other half of the
  // white-label reskin: the point of the beat is that it is not our purple.
  "#0f766e": {
    why: "Northlight Digital's brand teal on /white-label's reskin demo (WhiteLabel.dc.html) - the made-up agency the report is reskinned for. Must stay not-ours: a token would make it part of our system.",
    boards: 1,
    sites: { "src/app/white-label/page.tsx": 1 },
  },
  "#e6f4f1": {
    why: "Northlight Digital's pill tint on the same reskin demo, drawn by WhiteLabel.dc.html beside #0f766e. Same reason: the agency's colour, not ours.",
    boards: 1,
    sites: { "src/app/white-label/page.tsx": 1 },
  },

  // ---- the two no board draws ----------------------------------------------
  "#3d4451": {
    why:
      "the transactional email's body prose, and it is deliberate rather than a hand-copy - `verify-email.ts` " +
      "states the departure and measures it. Rule 5 below re-earns that measurement. Worth knowing: the " +
      "comparison it makes is against `T.soft` at 4.68, and the value the design system actually draws for body " +
      "prose is `#3f4451` at 9.74, so the departure over the board is 0.05 rather than the 5.11 the reason " +
      "reads as. No board draws this value. Second site (R159, 1 Oct 2026): `src/lib/email/lifecycle.ts`, the " +
      "lifecycle templates, which use the same mail palette but cannot import verify-email.ts's (it is " +
      "server-only with `@/` imports, and the templates must render under node --test and the preview page). " +
      "That site went on 18 Oct 2026 (brief 2e): the rebuilt templates draw the approved designs, whose body prose " +
      "is `T.ink` and whose quiet text is `T.soft`, all from the tokens (email/design.ts), so this is one site again.",
    boards: 0,
    sites: { "src/lib/scan/verify-email.ts": 1 },
  },
  "rgba(220,38,38,0.1)": {
    why: "the ops page's error panel ground. The last of the hand-rolled status set - its amber joined `T.warnFg` when blocked.md 9 was answered - in the one file no page sweep reaches.",
    boards: 0,
    sites: { "src/app/admin/scans/page.tsx": 1 },
  },
  "rgba(220,38,38,0.35)": {
    why: "the border of that same error panel, and the same hand-rolled status set. No board draws it either.",
    boards: 0,
    sites: { "src/app/admin/scans/page.tsx": 1 },
  },
  "rgba(245,158,11,0.10)": {
    why: "the ops page's warning panel ground, at the readiness list.",
    boards: 0,
    sites: { "src/app/admin/scans/page.tsx": 1 },
  },
  "rgba(245,158,11,0.12)": {
    why: "the same warning ground at the kill-switch banner, two hundredths lighter than the one above and on no board either. The clearest single illustration of what this file is for.",
    boards: 0,
    sites: { "src/app/admin/scans/page.tsx": 1 },
  },
  "rgba(245,158,11,0.35)": {
    why: "the border of both warning panels, written twice so the two panels can disagree the way their grounds already do.",
    boards: 0,
    sites: { "src/app/admin/scans/page.tsx": 2 },
  },
};

/**
 * The floor. A census that stops finding things reads exactly like a tree with
 * one palette, which is the state this file exists to disprove.
 */
test("the scanner still finds the colour literals it found when this was written", () => {
  const found = offPalette();
  assert.ok(
    found.length >= 47,
    `only ${found.length} off-palette colour literals were found and there were 47 - a falling count means the scanner broke, not that the tree was tidied`,
  );
  const files = new Set(found.map((s) => s.file));
  assert.ok(files.size >= 13, `only ${files.size} files carry one, and 13 did`);
  // And that both forms are still seen. A count of 47 is also what you get from
  // 47 hex values and a scanner that has quietly lost `rgba(`, which is the
  // shape `input-bounds` was in when it lost `<textarea>`.
  assert.ok(found.some((s) => s.value.startsWith("#")), "no hex value found at all - the scanner is broken");
  assert.ok(found.some((s) => s.value.startsWith("rgba(")), "no rgba() value found - the scanner has lost a form");

  // And that the stylesheet half of the walk still finds one. A `.css` walk
  // that returns nothing reads exactly like a tree whose stylesheet is clean,
  // and three of the values on the list below are only in that file.
  assert.ok(
    stylesheets().length >= 1,
    "the stylesheet walk found no stylesheet at all, so every colour set in CSS is outside this census",
  );
  assert.ok(
    found.some((s) => s.file.endsWith(".css")),
    "no off-palette value was found in any stylesheet, and three are recorded there - the stylesheet half of the walk has gone blind",
  );
});

/**
 * Rule 2: the one off-palette value that can be derived is derived, not
 * excused.
 *
 * `globals.css` writes the CTA's focus ring as `rgba(124,58,237,0.28)`, and
 * 124/58/237 is `T.accent` in decimal. An exemption for it would be a reason
 * nobody checks; this is the assertion that fails if the accent ever moves and
 * the ring does not follow it. An exemption a derivation removes was never one.
 */
test("the translucent accent in the stylesheet is the accent, not a fourth copy of it", () => {
  const css = readFileSync(join(ROOT, "src/app/globals.css"), "utf8");
  const ring = /rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*[\d.]+\s*\)/.exec(css);
  assert.ok(ring, "globals.css no longer writes an rgba() - if the focus ring moved, this rule has gone blind");
  const n = parseInt(T.accent.slice(1), 16);
  assert.deepEqual(
    [Number(ring[1]), Number(ring[2]), Number(ring[3])],
    [(n >> 16) & 255, (n >> 8) & 255, n & 255],
    `globals.css writes rgba(${ring[1]},${ring[2]},${ring[3]},...) where T.accent is ${T.accent}. Either the accent moved and the ring did not follow it, or a second translucent colour was added - in which case this rule needs to find the right one rather than the first.`,
  );
});

/**
 * Values rule 2 proves rather than excuses, so rule 3 does not ask for a reason
 * for them. Kept as its own set rather than as an `OFF_PALETTE` entry because
 * the two are different claims: an entry says "this is a palette member nobody
 * named", and this says "this is not a second value at all".
 */
const DERIVED = new Set(["rgba(124,58,237,0.28)"]);

/**
 * Files that reproduce somebody else's mark, excused whole.
 *
 * EngineLogo.tsx carries the five engines' own logos, from the SVGs Danny
 * supplied on 24 September 2026. Their colours are the engines', not ours, and
 * the one rule for them is the opposite of this file's: they must never be
 * pulled onto the palette. Listing each gradient stop here would be twenty
 * entries whose reason is the same sentence.
 */
const MARKS = new Set(["src/components/EngineLogo.tsx"]);

test("an excused mark file still carries marks", () => {
  for (const file of MARKS) {
    assert.ok(
      offPalette().some((s) => s.file === file),
      `${file} is excused as a file of third-party marks and holds no off-palette colour - drop it from MARKS`,
    );
  }
});

/** Rule 3: nothing is off-palette without a recorded reason. */
test("every colour written outside the palette is on the list, with its reason", () => {
  const strays = offPalette()
    .filter((s) => !(s.value in OFF_PALETTE) && !DERIVED.has(s.value) && !MARKS.has(s.file))
    .map((s) => `${s.value} in ${s.file}`);
  assert.deepEqual(
    [...new Set(strays)],
    [],
    "a colour is written in source that config/tokens.ts does not contain. Grep docs/design for it: if a board draws it, add it to OFF_PALETTE with the count and the reason; if no board draws it, somebody typed a colour and it wants a token or a correction",
  );
});

/**
 * Rule 4: and no entry is stale, counted per file.
 *
 * Per file rather than per value because two of these files carry the same
 * value twice - `vibe-retail` writes `#3f4451` for a paragraph and again for a
 * row label - and a membership check waves a third through.
 */
test("no entry on the list is stale, and none has quietly grown a site", () => {
  const found = offPalette();
  for (const [value, { why, sites }] of Object.entries(OFF_PALETTE)) {
    assert.ok(why.length > 40, `OFF_PALETTE["${value}"] needs a reason, not a placeholder`);
    const actual: Record<string, number> = {};
    // A mark file reproduces someone else's colours; see MARKS. Its use of a
    // value that happens to be on this list is theirs, not a spread of ours.
    for (const s of found.filter((s) => s.value === value && !MARKS.has(s.file))) actual[s.file] = (actual[s.file] ?? 0) + 1;
    assert.deepEqual(
      actual,
      sites,
      `OFF_PALETTE["${value}"] records where it is written and that is no longer where it is written. A new site means the value spread - decide whether it should be a token before adding it here. A missing site means it went, and the entry should go with it.`,
    );
  }
});

/** sRGB relative luminance, for the two rules that re-earn a stated measurement. */
function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

/**
 * Written here rather than imported from `contrast.test.mts` for the reason
 * that file's own header gives about its neighbours: importing a reader out of
 * a `.test.mts` registers that file's tests a second time, and the subtest
 * count is the only column that tells a real pass from a duplicated one.
 */
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * Rule 5: the one entry that justifies itself with a number re-earns it.
 *
 * `verify-email.ts` departs from the palette on purpose and says why: "#3d4451
 * measures 9.79 on white where `T.soft` is 4.68". Both halves are exact - and a
 * reason stated as a measurement is the kind that rots silently, because
 * changing the value leaves the sentence behind. This is the `holds` shape
 * `input-bounds` records: the reason costs an assertion.
 *
 * **Both sides are read out of that file, and the first draft of this rule read
 * neither.** It compared a typed `"#3d4451"` against a typed `9.79` - two
 * constants inside this test, agreeing with each other for ever, on a tree that
 * could have said anything. The injection harness is what said so: changing the
 * value was caught by rules 3 and 4 and never by this one, which is the
 * blind-tripwire recipe the queue names - when a test duplicates a value to
 * compare against, ask what reads the original.
 *
 * **Why this is not `email-render.test.mts`'s AA rule under another name.**
 * That rule opens "Measured, not asserted from the doc comment. verify-email.ts
 * claims '#3d4451 measures 9.79 on white where T.soft is 4.68' and both check
 * out below" - and what it actually asserts is `r >= 4.5` on every pair. It is
 * a floor, so it is true of `#5d6471` too, and the stated 9.79 would go on
 * sitting in the comment beside a value that no longer produces it. The heading
 * claims the join and the body asserts a bound, which is the same gap
 * `input-bounds` records about its own "the bounds are the numbers the servers
 * actually enforce". This is the join.
 */
test("the email's deliberate departure still measures what it says it does", () => {
  const src = readFileSync(join(ROOT, "src/lib/scan/verify-email.ts"), "utf8");

  const value = /\n\s*body:\s*"(#[0-9a-fA-F]{6})"/.exec(blankComments(src));
  assert.ok(value, "verify-email.ts no longer sets `body` to a hex literal - if the departure ended, this rule and its OFF_PALETTE entry both go");

  // The reason is a doc comment, so it wraps: "9.79 on white where\n *
  // `T.soft` is 4.68". Read it with the comment markers and the wrapping taken
  // out, or a rule keyed on the sentence is really keyed on where the line
  // happened to break.
  const prose = src.replace(/^\s*\*\s?/gm, " ").replace(/\s+/g, " ");

  const stated = /measures (\d+\.\d+) on white/.exec(prose);
  assert.ok(stated, "verify-email.ts no longer states what its body colour measures - the departure is unexplained");

  assert.equal(
    round(contrast(value[1]!, "#ffffff")),
    Number(stated[1]),
    `verify-email.ts sets body to ${value[1]} and says it measures ${stated[1]} on white. It measures ${round(contrast(value[1]!, "#ffffff"))}. Change the value and the sentence together.`,
  );

  // The baseline the same sentence compares against, which is a token and so
  // can move underneath it.
  const baseline = /where `T\.soft` is (\d+\.\d+)/.exec(prose);
  assert.ok(baseline, "verify-email.ts no longer names the baseline it departs from");
  assert.equal(
    round(contrast(T.soft, "#ffffff")),
    Number(baseline[1]),
    `verify-email.ts compares its body colour against T.soft at ${baseline[1]} on white, and T.soft now measures ${round(contrast(T.soft, "#ffffff"))} - blocked.md 9 is the entry that moves it`,
  );
});

/**
 * Rule 6 was here: "the ops page's amber is darker than the token, so tidying
 * it onto T.warnFg is a regression".
 *
 * It proved a prohibition rather than asserting one - `#92400e` measured 7.09
 * on white and `T.warnFg` measured 3.78, so pointing the ops page at the token
 * would have been a one-line contrast regression onto a value blocked.md 9 was
 * already open about. The rule's own failure message said what to do if that
 * changed: "If T.warnFg has been answered and now clears it - blocked.md 9 -
 * then the two should be merged and this rule should go."
 *
 * Danny answered it on 24 September 2026. `T.warnFg` is #a95912 and clears AA
 * at 5.09, the ops page's two hand-written ambers are `C.amber` on the token,
 * and the `#92400e` entry above went with them. The rule is gone rather than
 * rewritten, because there is no longer a prohibition for it to hold.
 */

