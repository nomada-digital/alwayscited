import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

/**
 * The copy conventions, swept rather than remembered.
 *
 * Three rules in AGENTS.md are absolute, apply to every file that ships text,
 * and have each been checked by hand on separate runs: the brand never takes a
 * capital, tier names are one lowercase word, and the scan's question count is
 * never typed. Those manual checks cost a grep and a paragraph of worklog every
 * time, and the paragraph is the only record that the check happened - so the
 * next run cannot tell a sweep that found nothing from a sweep that was not
 * done. This file is that check, executed.
 *
 * It exists because the fifth of those hand sweeps missed one. Every earlier
 * pass looked for `14`, and the confirm screen's cluster standfirst said
 * "fourteen variations of the same thing" - the same claim, spelled as a word,
 * 400 lines under a comment congratulating itself on having removed the last
 * typed copy from that file. Lower QUESTIONS and the sentence a visitor reads
 * while dropping clusters states a number the product has stopped doing.
 *
 * What this does NOT cover, said plainly rather than implied:
 *
 *  - comments. A comment that says "fourteen questions across four engines is
 *    56 reads" is worked arithmetic for a maintainer, not a claim to a reader,
 *    and there is nowhere to interpolate a constant into one. Several such
 *    comments are in the tree on purpose. The rule is about the strings that
 *    reach a person outside this repo.
 *  - colour. "Colour must never be the only way to tell tiers apart" is a
 *    property of the rendered page and is not decidable from source.
 *
 * The engine count used to be on that list, on the grounds that it "shares its
 * wording with the coverage checker's own three engines, five questions - a
 * different product with its own numbers". It is covered now, because that
 * premise stopped being true on 20 September 2026. Danny accepted proposal 4,
 * "the scan's own engine set", and `20260920010000_campaign_benchmark.sql` is
 * built on it: a benchmark reading is a scans row, so it inherits FREE_ENGINES
 * rather than having a set of its own. There is one engine set on this site,
 * and the exemption was the only thing keeping /coverage-check's "three
 * engines, five questions, fifteen answers" off this report while the product
 * behind it returned twenty.
 */

/**
 * Plain paths rather than URLs, for the reason reads.test.mts gives: there is
 * a real `src/app/scan/[token]` directory here and the WHATWG URL parser
 * percent-encodes the brackets, so a URL-based walk quietly skips it.
 */
const ROOT = join(fileURLToPath(import.meta.url), "..", "..", "..");
const SRC = join(ROOT, "src");

/**
 * Everything in `src` that ships text, which is wider than the other sweeps
 * need to be.
 *
 * `.css` and `.svg` are in deliberately. `icon.svg` carries the brand in a
 * `<title>` and an `aria-label`, which are two of the contexts AGENTS.md names
 * as stripping colour - exactly where a miscased brand would be invisible to a
 * reviewer looking at the page.
 */
function textFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const child = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...textFiles(child));
    else if (/\.(tsx?|mts|css|svg)$/.test(entry.name) && !entry.name.includes(".test.")) out.push(child);
  }
  return out;
}

function posix(file: string): string {
  return relative(ROOT, file).split(sep).join("/");
}

type Hit = { file: string; line: number; text: string };

function lineAt(source: string, index: number): number {
  return source.slice(0, index).split("\n").length;
}

/** A line of prose rather than a line of code. Same test the other sweeps use. */
function isComment(line: string): boolean {
  const t = line.trim();
  return t.startsWith("*") || t.startsWith("//") || t.startsWith("/*");
}

/**
 * Which lines of a file are comment rather than shipped text.
 *
 * `isComment` reads one line at a time and knows `//`, `/*` and the `*`
 * continuation of a JSDoc block. It does not know `{/​* ... *​/}`, the JSX
 * comment form - which is the form most comments in this repo's .tsx files
 * take, because it is the only one that works inside markup. Its second and
 * later lines start with ordinary prose and so read as shipped text.
 *
 * The header of this file promises comments are not covered. That promise was
 * false for .tsx, and not theoretically: on 20 Sep `typedEngines` failed on a
 * JSX comment in RequestScanForm.tsx that explained the line above it had
 * promised "three of the four engines". The sweep read the explanation of the
 * defect as the defect, which is the one way a rule can punish writing the
 * reason down.
 *
 * Block state is tracked over `{/*` only, never over a bare `/*`. A `/*` inside
 * a string, a regex or a URL therefore cannot swallow the rest of a file -
 * which is the failure that would make this sweep quietly stop reporting, and
 * is worse than the over-reporting it replaces.
 */
function commentLines(lines: string[]): Set<number> {
  const out = new Set<number>();
  let open = false;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (open) {
      out.add(i);
      if (t.includes("*/")) open = false;
      continue;
    }
    if (t.startsWith("{/*")) {
      out.add(i);
      if (!t.includes("*/")) open = true;
      continue;
    }
    if (isComment(lines[i])) out.add(i);
  }
  return out;
}

// ------------------------------------------------------------ the brand word

/**
 * The four one-word names, and the company name among them.
 *
 * Matched with the separator optional and then compared against the one legal
 * spelling, rather than listing the wrong spellings: `AlwaysCited`,
 * `Alwayscited`, `ALWAYSCITED`, `Always Cited` and `always cited` are five
 * ways to be wrong and there is no reason to believe the sixth was thought of.
 * Anything that is not exactly the lowercase unbroken word is a hit.
 */
const NAMES = ["cited", "tracked", "mentioned", "everywhere"] as const;
const MISCASED = new RegExp(`always[ \\t\\-_]*(${NAMES.join("|")})`, "gi");

export function miscasings(source: string): { index: number; text: string }[] {
  const out: { index: number; text: string }[] = [];
  for (const m of source.matchAll(MISCASED)) {
    if (m[0] === "always" + m[1].toLowerCase()) continue;
    out.push({ index: m.index, text: m[0] });
  }
  return out;
}

// ------------------------------------------------------------------- dashes

/**
 * Hyphens, not em-dashes. The site's own punctuation, and the one place the
 * characters are legitimate is the entity decoder, whose whole job is to turn
 * `&mdash;` in a crawled page into the character it stands for.
 *
 * ## Why this stopped being a `Set` of filenames
 *
 * It was `new Set(["src/lib/scan/prose.ts"])` - a whole file switched off on
 * the strength of the sentence above, which is the exemption species this tree
 * has now paid for three times. `PRICE_EXEMPT` was file-keyed until `d8200bb`,
 * where one attested `$1,300` on a four-hundred-line case study switched the
 * price sweep off across the page most likely to grow a "from $2,495" in a
 * closing CTA. `ENGINE_EXEMPT` checked its filenames and not its reasons. This
 * was both at once, and worse in one respect than either: **it was absent from
 * both of the exemption audits at the bottom of this same file**, which
 * enumerate `PRICE_EXEMPT` and `ENGINE_EXEMPT` by hand. So the rule written
 * because "an exemption is a sweep switched off, and the sentence beside it is
 * the only argument for switching it off" did not know this exemption existed.
 *
 * `prose.ts` is 223 lines and only three of them carry a dash - all six
 * characters are values in the two decoding tables. The other 220 lines are
 * `toProse`, which builds **the only string the brand read is ever given**;
 * its own header says a character mangled on the way through "is not a
 * rendering blemish, it is the input to the one judgement this step makes". A
 * separator typed as an em-dash in that function was exempt by construction.
 *
 * So the exemption is narrowed the way `PRICE_EXEMPT`'s was: to the shape of
 * the line that earns it. A dash is allowed in `prose.ts` when it is the value
 * of a table entry - `ndash: "–",` or `0x96: "–",` - and nowhere else in the
 * file. `holds` re-earns the reason itself, because a file keeping its name
 * while its decoder moves out is the `e3bf2d9` shape one layer down.
 */
const DASHES = /[–—]/g;

/**
 * A line that is nothing but entity-table entries.
 *
 * One or more `ndash: "–",` / `0x96: "–",` pairs and no other text. It has to
 * take a run of them rather than a single entry: `NAMED` is one per line and
 * `CP1252` packs five, `0x93: "“", 0x94: "”", 0x95: "•", 0x96: "–", 0x97: "—",`
 * - which the single-entry form reported, correctly by its own lights and
 * wrongly about the file. Found by the narrowing failing, not by reading.
 *
 * The value is one character, deliberately. That is what a decode table holds,
 * and it is what stops a line of table entries carrying a sentence.
 */
const DASH_TABLE_ENTRY = /^\s*(?:(?:[A-Za-z][A-Za-z0-9]*|0x[0-9a-f]+)\s*:\s*"[^"]",\s*)+$/;

type DashExemption = {
  why: string;
  /** The lines the characters are allowed on. Every other line in the file is swept. */
  only: RegExp;
  /** What must still be true of the file for `why` to be an argument at all. */
  holds: { file: string; needs: RegExp }[];
};

const DASH_EXEMPT: Record<string, DashExemption> = {
  "src/lib/scan/prose.ts": {
    why: "the entity decoder maps &ndash; and &mdash; to the characters they stand for",
    only: DASH_TABLE_ENTRY,
    holds: [
      { file: "src/lib/scan/prose.ts", needs: /export function decodeEntities\b/ },
      { file: "src/lib/scan/prose.ts", needs: /\bmdash:\s*"—"/ },
      { file: "src/lib/scan/prose.ts", needs: /0x97:\s*"—"/ },
    ],
  },
};

// ----------------------------------------------------- the question counts

/**
 * The two question counts that are claims to a buyer, each with the file that
 * owns it.
 *
 * Read out of the source at test time rather than typed here, which is the
 * whole argument of this rule applied to the rule itself: a sweep that names
 * `14` is a third copy of the number and goes stale with the other two. What
 * is pinned is where each number is declared, not what it is.
 *
 *  - QUESTIONS is what a free scan asks. Typed copies of it have been found
 *    and removed five times.
 *  - TRACKED_QUESTIONS is what the $99 tracking price covers. It was typed on
 *    four surfaces and two of them disagreed about what it meant - "20
 *    questions, checked weekly" against "20 questions a week", which is a
 *    different offer at the same price.
 *  - TRACKED_PROMPTS replaced it on 29 Sep 2026 (R112, danny.md line 104):
 *    the price now covers 10 clusters, 50 prompts and 10 keywords, and
 *    TRACKED_QUESTIONS is gone. The prompt count is the one a question count
 *    beside "question" would now be a stale copy of.
 */
const OWNED = [
  { home: "src/config/scan-shape.ts", decl: /export const QUESTIONS = (\d+)/ },
  { home: "src/config/pricing.ts", decl: /export const TRACKED_PROMPTS = (\d+)/ },
] as const;

/**
 * Five, and ten to twenty, which is the range a count in this copy is written
 * out in. Five joined on 24 September 2026 when QUESTIONS dropped to it. Below
 * ten the word is an ordinary English word ("five pages", "five days") on
 * surfaces that have nothing to do with the scan, so for those the word is
 * only a hit beside "question" - the same qualifier the digit already carries.
 */
const NUMBER_WORDS: Record<number, string> = {
  5: "five",
  10: "ten",
  11: "eleven",
  12: "twelve",
  13: "thirteen",
  14: "fourteen",
  15: "fifteen",
  16: "sixteen",
  17: "seventeen",
  18: "eighteen",
  19: "nineteen",
  20: "twenty",
};

function owned(): { home: string; value: number }[] {
  return OWNED.map(({ home, decl }) => {
    const found = decl.exec(readFileSync(join(ROOT, home), "utf8"));
    assert.ok(found, `${home} no longer declares this count - the rule below has nothing to sweep for`);
    return { home, value: Number(found[1]) };
  });
}

const HOMES = new Set<string>(OWNED.map((o) => o.home));

/**
 * A question count typed into the shipped text.
 *
 * Two spellings, and the word form is the one that matters, because it is the
 * one that survived. Every earlier sweep looked for the digit.
 *
 * The digit is only a hit beside the word "question". `14px` is a font size on
 * nearly every line of this codebase, `> 200` is a length bound and `status:
 * 404` is a status - none of them are claims about the product, and a rule
 * that flagged them would be turned off within a week.
 *
 * The word carries no such qualifier, deliberately. "fourteen" is in this
 * product's copy for one reason, and requiring "question" on the same line
 * would have missed the second hit this rule was written for - a prompt in
 * anthropic.ts reading "well measured by fourteen versions of...", where the
 * subject of the sentence is the question set and the word is not on the line.
 *
 * ## Why a CSS length is cut out before the digit is looked for
 *
 * "`14px` is a font size on nearly every line" is what the qualifier above is
 * for, and it holds right up until a line is both - which the benchmark
 * reading page produced on its first run:
 *
 *     <span style={{ fontSize: "14.5px", color: T.ink }}>{q.question}</span>
 *
 * `\b14\b` matches inside "14.5px" because the decimal point ends the word, and
 * `{q.question}` satisfies the qualifier. So the sweep reported a typed
 * question count on a line that states one nowhere - a styled element that
 * renders a question, which is the most ordinary thing a page that lists
 * questions can contain.
 *
 * A false positive on this rule is not harmless. It is a push gate, the fix a
 * reader reaches for is to reword copy that was already right, and the second
 * time it fires on markup the rule gets an exemption entry that turns it off
 * for a whole file.
 *
 * So lengths go before the digit is looked for, rather than the qualifier being
 * loosened. Nothing real is lost: a claim about the product never writes its
 * number as `14px` or `14.5rem`, and the word form - the spelling this rule was
 * written for and the one that actually went stale - is untouched by it.
 */
const CSS_LENGTH = /\b\d+(?:\.\d+)?(?:px|rem|em|ch|vh|vw|%|ms|s)\b/g;

export function typedCounts(
  source: string,
  file: string,
  counts: { home: string; value: number }[],
): Hit[] {
  const out: Hit[] = [];
  const lines = source.split("\n");
  const comments = commentLines(lines);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (comments.has(i)) continue;
    const prose = line.replace(CSS_LENGTH, " ");
    const hit = counts.some(({ value }) => {
      const digit = new RegExp(`\\b${value}\\b`).test(prose) && /question/i.test(line) && !HOMES.has(file);
      const word = NUMBER_WORDS[value]
        ? new RegExp(`\\b${NUMBER_WORDS[value]}\\b`, "i").test(line) && (value >= 10 || /question/i.test(line))
        : false;
      return digit || word;
    });
    if (hit) out.push({ file, line: i + 1, text: line.trim() });
  }
  return out;
}

// -------------------------------------------------------- the engine count

/**
 * A count of engines typed into shipped text.
 *
 * Deliberately blind to what the right answer is. The other rules here sweep
 * for a specific stale number read out of the file that owns it; this one
 * flags *any* literal count standing in front of "engines", because the count
 * has moved twice - Claude out and Perplexity in at 3586cbf - and the failure
 * both times was a sentence that was true when it was written. There is
 * nothing to compare against that a wrong page would not also match: "three
 * engines" was wrong for a fortnight while FREE_ENGINES held four, and a rule
 * pinned to four would have passed it on the day it was fixed and failed it
 * on the day it broke again.
 *
 * `FREE_ENGINE_COUNT` interpolated into the string is what a clean line looks
 * like, and there is no literal left for this to see.
 *
 * The bound is one to ten spelled out, plus any run of digits. Nothing on this
 * site offers more than ten engines, and a number that large in front of the
 * word is a claim whoever wrote it should have to justify anyway.
 */
const ENGINE_COUNT =
  /\b(?:one|two|three|four|five|six|seven|eight|nine|ten|\d+)[ \t]+engines\b/i;

/**
 * Where the engine set is declared and may be counted in prose. Same shape as
 * PRICE_EXEMPT, and checked below that it still points at a real file.
 */
const ENGINE_EXEMPT: Record<string, string> = {
  "src/lib/scan/engines.ts": "FREE_ENGINES and GATED_ENGINES are declared here",
  "src/config/scan-shape.ts": "FREE_ENGINE_COUNT is derived here",
};

export function typedEngines(source: string, file: string): Hit[] {
  if (Object.hasOwn(ENGINE_EXEMPT, file)) return [];
  const out: Hit[] = [];
  const lines = source.split("\n");
  const prose = commentLines(lines);
  for (let i = 0; i < lines.length; i++) {
    if (prose.has(i)) continue;
    if (ENGINE_COUNT.test(lines[i])) out.push({ file, line: i + 1, text: lines[i].trim() });
  }
  return out;
}

// -------------------------------------------------------------- the prices

/**
 * A price typed into shipped text, anywhere but the two files entitled to one.
 *
 * Two digits at least, so a regex backreference - `.replace(..., "$1")` - is
 * not read as ninety-nine pence. No price this business charges is under ten
 * dollars, so nothing real is lost by the bound.
 */
const PRICE = /\$\d[\d,]*\d/;

/**
 * The files allowed to carry a `$` figure, and - where it matters - which one.
 *
 * ## `only` is the narrowing, and the case study is why
 *
 * This was a file-keyed list, so an exemption earned by one figure excused the
 * whole file. `vibe-retail/page.tsx` is on it for `$1,300` of traffic value, a
 * measurement carried on Danny's attestation, and that single line switched the
 * price sweep off across a four-hundred-line page - a case study, which is the
 * kind of page that gains a "from $2,495" in a closing CTA. The sweep exists
 * because "a price in a meta description is the claim a buyer reads in a search
 * result before they ever reach the page", and it could not have seen one here.
 *
 * `pricing.ts` has no `only` and that is deliberate rather than an omission: it
 * is where the prices are declared, so every figure in it is entitled to be
 * there and listing them would be a second copy of the table the sweep exists
 * to keep singular.
 */
type PriceExemption = { why: string; only?: string[] };

const PRICE_EXEMPT: Record<string, PriceExemption> = {
  "src/config/pricing.ts": { why: "the prices themselves live here - every figure in it is the source" },
  "src/app/case-studies/vibe-retail/page.tsx": {
    // $1,300 of traffic value on a client's account is a measurement, not a
    // price, and it is carried on Danny's attestation with its own window. It
    // is not derivable from anything and must not be rebuilt from a constant.
    why: "a measured client result, not a price",
    only: ["$1,300"],
  },
  "src/config/video.ts": {
    // Added 26 Sep 2026 (Q23). The launch video is a rendered file and these
    // are the figures painted into it, read off its frames - a fact about the
    // video, not a second price table. They are typed because they cannot be
    // derived: re-deriving them from pricing.ts would make the record agree
    // with the site while the video said something else. video.test.mts holds
    // them equal to pricing.ts, which is what makes a price change fail loudly.
    // Since 28 Sep 2026 they no longer match, so video.test.mts holds the video
    // off every page instead, until a re-cut.
    why: "what the rendered launch video paints, held against pricing.ts by video.test.mts",
    only: ["$99", "$995", "$2,495"],
  },
};

export function typedPrices(source: string, file: string): Hit[] {
  const exemption = Object.hasOwn(PRICE_EXEMPT, file) ? PRICE_EXEMPT[file] : undefined;
  if (exemption && !exemption.only) return [];
  const out: Hit[] = [];
  const lines = source.split("\n");
  const prose = commentLines(lines);
  for (let i = 0; i < lines.length; i++) {
    if (prose.has(i)) continue;
    const m = PRICE.exec(lines[i]);
    if (!m) continue;
    // The matched figure, not the line: an allowed figure must not excuse a
    // second one that happens to share a line with it.
    if (exemption?.only?.includes(m[0]) && !PRICE.test(lines[i].replace(m[0], ""))) continue;
    out.push({ file, line: i + 1, text: lines[i].trim() });
  }
  return out;
}

const FILES = textFiles(SRC);

/**
 * The brand sweep reads wider than the dash and price sweeps (Danny, 4 Nov 2026: alwayscited, alwaystracked and
 * alwaysmentioned are lowercase and one word everywhere - site copy, emails, metadata, alt text). On top of FILES:
 * every other text file under src (JSON fixtures the dashboards render, Markdown, HTML), the text files under public
 * (the BIMI logo, the IndexNow key, anything served as it is), and next.config.ts, which writes response headers.
 * Kept apart from FILES because crawled fixture text legitimately carries the dashes those sweeps forbid; the brand
 * has no such excuse anywhere.
 */
function brandFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const child = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...brandFiles(child));
    else if (/\.(json|md|txt|html|svg|xml|webmanifest)$/.test(entry.name) && !entry.name.includes(".test.")) out.push(child);
  }
  return out;
}
const PUBLIC = join(ROOT, "public");
const BRAND_FILES = [...new Set([...FILES, ...brandFiles(SRC), ...brandFiles(PUBLIC), join(ROOT, "next.config.ts")])];

const MISCASED_HITS: Hit[] = BRAND_FILES.flatMap((file) => {
  const source = readFileSync(file, "utf8");
  return miscasings(source).map((m) => ({ file: posix(file), line: lineAt(source, m.index), text: m.text }));
});

const DASH_HITS: Hit[] = FILES.flatMap((file) => {
  const name = posix(file);
  const exemption = Object.hasOwn(DASH_EXEMPT, name) ? DASH_EXEMPT[name] : undefined;
  const source = readFileSync(file, "utf8");
  const lines = source.split("\n");
  return [...source.matchAll(DASHES)]
    .map((m) => ({ file: name, line: lineAt(source, m.index), text: lines[lineAt(source, m.index) - 1].trim() }))
    // The LINE, not the file. `typedPrices` makes the same move one narrowing
    // finer, on the matched figure; a dash has no distinguishing text of its
    // own, so the line it sits on is what carries the argument for it.
    .filter((hit) => !exemption?.only.test(lines[hit.line - 1]));
});

const COUNTS = owned();
const COUNT_HITS: Hit[] = FILES.flatMap((file) => typedCounts(readFileSync(file, "utf8"), posix(file), COUNTS));

const PRICE_HITS: Hit[] = FILES.flatMap((file) => typedPrices(readFileSync(file, "utf8"), posix(file)));

const ENGINE_HITS: Hit[] = FILES.flatMap((file) => typedEngines(readFileSync(file, "utf8"), posix(file)));

function say(hits: Hit[]): string[] {
  return hits.map((h) => `${h.file}:${h.line} ${h.text}`);
}

/**
 * The guard the other sweeps in this tree learned the hard way.
 *
 * A clean tree makes every list below empty, and so does a rule that matches
 * nothing at all - which is the state the digit-only sweeps were in with
 * respect to the word "fourteen". So each detector is shown finding what it is
 * for, on text written here, before it is trusted to report an empty tree.
 */
test("each rule can still see what it is looking for", () => {
  assert.ok(FILES.length >= 40, `expected 40+ files carrying text, walked ${FILES.length}`);

  assert.deepEqual(
    miscasings("AlwaysCited, Alwayscited, ALWAYSCITED, Always Cited, always cited, always-tracked").map((m) => m.text),
    ["AlwaysCited", "Alwayscited", "ALWAYSCITED", "Always Cited", "always cited", "always-tracked"],
  );
  assert.deepEqual(miscasings("alwayscited alwaystracked alwaysmentioned alwayseverywhere"), []);
  // The company's own domain and a slug are the correct spelling and must not
  // be reported. This is the guard tier-text.test.mts keeps for the renderer.
  assert.deepEqual(miscasings("hello@alwayscited.com /alwaystracked"), []);

  // Both counts were found, and both still have a home to be found in.
  assert.equal(COUNTS.length, OWNED.length);
  for (const c of COUNTS) assert.ok(c.value > 0, `${c.home} declares a count of ${c.value}`);

  // Exercised against the two real counts rather than against a number written
  // here, so these assertions move with the config the way the rule does.
  const scan = COUNTS[0];
  const word = NUMBER_WORDS[scan.value];
  assert.ok(word, `${scan.value} has no written form in the table - widen it or say why`);
  assert.deepEqual(
    say(typedCounts(`const s = "${word} buying questions";`, "x.tsx", COUNTS)),
    [`x.tsx:1 const s = "${word} buying questions";`],
  );
  assert.deepEqual(
    say(typedCounts(`const s = "${scan.value} questions";`, "x.tsx", COUNTS)),
    [`x.tsx:1 const s = "${scan.value} questions";`],
  );
  // A comment is prose for a maintainer, and a font size is not a claim.
  assert.deepEqual(typedCounts(` * ${word} questions across four engines`, "x.tsx", COUNTS), []);
  assert.deepEqual(typedCounts(`fontSize: "${scan.value}px", // the question table`, "x.tsx", COUNTS), []);
  /**
   * A decimal length on a line that renders a question, which is the shape the
   * benchmark reading page hit. `\b14\b` matches inside "14.5px" - the decimal
   * point ends the word where the "p" of "14px" does not - so this one got past
   * the qualifier the line above tests, on markup that claims nothing.
   */
  assert.deepEqual(
    typedCounts(`<span style={{ fontSize: "${scan.value}.5px" }}>{q.question}</span>`, "x.tsx", COUNTS),
    [],
  );
  // Cutting the length out must not cut the claim out with it: a real count
  // beside a styled element is still a real count.
  assert.deepEqual(
    say(typedCounts(`<p style={{ fontSize: "13.5px" }}>${scan.value} questions</p>`, "x.tsx", COUNTS)),
    [`x.tsx:1 <p style={{ fontSize: "13.5px" }}>${scan.value} questions</p>`],
  );
  // The file that owns a count may state it.
  assert.deepEqual(typedCounts(`export const QUESTIONS = ${scan.value};`, scan.home, COUNTS), []);

  assert.equal([..."a — b".matchAll(DASHES)].length, 1);

  // The literal this rule exists for is the one that shipped. Both spellings,
  // and a derived line beside them that must not be reported.
  assert.deepEqual(
    say(typedEngines('<span>Three engines, five questions, fifteen answers.</span>', "x.tsx")),
    ["x.tsx:1 <span>Three engines, five questions, fifteen answers.</span>"],
  );
  assert.deepEqual(
    say(typedEngines("const s = `asked on 4 engines`;", "x.tsx")),
    ["x.tsx:1 const s = `asked on 4 engines`;"],
  );
  assert.deepEqual(typedEngines("<span>{FREE_ENGINE_COUNT} engines, {ANSWERS} answers.</span>", "x.tsx"), []);
  // Worked arithmetic for a maintainer is prose, as it is for the counts.
  assert.deepEqual(typedEngines(" * fourteen questions across four engines is 56 reads", "x.tsx"), []);

  /**
   * A JSX comment is a comment, including its second and later lines.
   *
   * This is the case the sweep got wrong until 20 Sep. `{/​*` opens a block and
   * the continuation lines carry no marker of their own, so every line below
   * the first read as shipped text - and the rule fired on a comment whose
   * whole subject was the engine count it was explaining.
   *
   * Asserted in both directions, because a fix that simply swallowed
   * everything after a `{` would pass the first of these and hide the tree.
   */
  assert.deepEqual(
    typedEngines(
      ["      {/* The line below promised three engines and the set holds four.", "          Derived now. */}"].join("\n"),
      "x.tsx",
    ),
    [],
    "a JSX comment's continuation lines are still comment",
  );
  assert.deepEqual(
    say(typedEngines(["      {/* opened and closed here. */}", "      <span>Three engines.</span>"].join("\n"), "x.tsx")),
    ["x.tsx:2 <span>Three engines.</span>"],
    "a closed JSX comment must not blind the rule to the code after it",
  );
  assert.deepEqual(
    say(typedEngines(['const u = "https://x.test/*"; // not a block', "<span>Three engines.</span>"].join("\n"), "x.tsx")),
    ["x.tsx:2 <span>Three engines.</span>"],
    "a bare /* in a string must not open a comment block",
  );

  for (const home of Object.keys(ENGINE_EXEMPT)) {
    assert.deepEqual(typedEngines('export const FREE_ENGINES = ["a"]; // four engines', home), [], `${home} is exempt and stayed exempt`);
  }

  assert.deepEqual(
    say(typedPrices('description: "$2,495 a month, priced per topic."', "x.tsx")),
    ['x.tsx:1 description: "$2,495 a month, priced per topic."'],
  );
  // A backreference is not a price, and neither is a comment.
  assert.deepEqual(typedPrices('text.replace(/(a)(b)/, "$2$1")', "x.tsx"), []);
  assert.deepEqual(typedPrices(" * the card said a flat $99/mo", "x.tsx"), []);
  // A whole-file exemption still excuses anything; a narrowed one excuses only
  // the figure it names, which is the half that had to be proved in both
  // directions or the narrowing is a rename.
  assert.deepEqual(typedPrices('priceLabel: "$995/mo"', "src/config/pricing.ts"), []);
  const CASE_STUDY = "src/app/case-studies/vibe-retail/page.tsx";
  assert.deepEqual(
    typedPrices("traffic value up to $1,300 a month from zero", CASE_STUDY),
    [],
    "the figure the exemption names is still excused",
  );
  assert.deepEqual(
    say(typedPrices('<p>Plans start at $2,495 a month.</p>', CASE_STUDY)),
    [`${CASE_STUDY}:1 <p>Plans start at $2,495 a month.</p>`],
    "a real price on the exempt page must be reported - the whole reason `only` exists",
  );
  assert.deepEqual(
    say(typedPrices("from $1,300 of value, now $2,495 a month", CASE_STUDY)),
    [`${CASE_STUDY}:1 from $1,300 of value, now $2,495 a month`],
    "an allowed figure must not excuse a second one sharing its line",
  );
});

test("the brand and the tier names are never capitalised or split", () => {
  // The floor: the walk reaches public/ and the JSON under src, so a walk that stops matching cannot read as clean.
  assert.ok(BRAND_FILES.some((f) => posix(f).startsWith("public/")), "the brand sweep no longer reads public/");
  assert.ok(BRAND_FILES.filter((f) => f.endsWith(".json")).length >= 20, "the brand sweep no longer reads the JSON under src");
  assert.deepEqual(
    say(MISCASED_HITS),
    [],
    "the brand is lowercase and unbroken everywhere - body copy, meta, alt text, aria-label and comments alike",
  );
});

test("copy uses hyphens, not em-dashes", () => {
  assert.deepEqual(say(DASH_HITS), [], "replace this with a hyphen - see the copy conventions in AGENTS.md");
});

test("a price is read from pricing.ts, never typed", () => {
  assert.deepEqual(
    say(PRICE_HITS),
    [],
    "read this from TIERS in src/config/pricing.ts - a price in a meta description is the claim a buyer reads in a search result before they ever reach the page",
  );
});

/**
 * Every exemption list in this file, named once and audited by both rules
 * below.
 *
 * It was a pair typed into each rule separately, and `DASH_EXEMPT` - added
 * later, as a bare `Set` of filenames - was in neither. Both rules passed,
 * over two thirds of the exemptions in the file, and a typed list cannot
 * report the member that is absent from it. That is the same sentence
 * `contact.test.mts` carries about its own census, and the structural rule
 * under `AUDITED` below is what makes this one a denominator rather than
 * another pair of names somebody has to remember to extend.
 */
const AUDITED = { PRICE_EXEMPT, ENGINE_EXEMPT, DASH_EXEMPT } as const;

test("every exemption still points at a file that exists", () => {
  // An exemption outliving its file is a hole nobody can see, which is the
  // rule reads.test.mts keeps over its own list.
  for (const [name, list] of Object.entries(AUDITED)) {
    for (const home of Object.keys(list)) {
      assert.ok(
        FILES.some((f) => posix(f) === home),
        `${name} lists ${home}, but the walk does not find it any more - delete the entry`,
      );
    }
  }
});

/**
 * And that `AUDITED` is every exemption list in this file, not the ones
 * somebody remembered.
 *
 * The behavioural half cannot cover this: a fourth list declared tomorrow and
 * left out of `AUDITED` makes every assertion above pass over a sweep that is
 * switched off, which is exactly the state `DASH_EXEMPT` was found in. So the
 * denominator is read out of this file's own source - the move
 * `price-schema.test.mts` makes to refuse a second floor judgement, and the
 * move `client-results.test.mts` makes to walk the tree rather than name it.
 *
 * **No comment strip here, deliberately, and that is not the usual mistake.**
 * Five rules in this tree read source and all five strip prose first, because
 * a doc comment quoting a defect satisfies a check that the defect is present.
 * The strip would be decoration in this one: the pattern is anchored at column
 * zero with `^const`, and every comment form this repo writes indents its
 * continuation lines (` *` in a JSDoc, `//` on each line) - so the paragraph
 * above, which names `DASH_EXEMPT` twice while explaining it, cannot match.
 * A guard that cannot fire is deleted here rather than tested, the way
 * `price-label.ts`'s empty-figure guard was.
 *
 * **What this cannot see: an exemption list in a different test file.** Asked
 * of this rule the moment it went green, because every blind tripwire in this
 * tree read as a reasonable check with a reason beside it a run later. Six
 * exemption lists exist across four files - the three here, `route-closure`'s
 * `/scan`, `spend-gates`' `{ why, evidence, where }` and `input-bounds`'
 * `{ why, holds }` - and all four files audit their own, checked by hand on
 * 20 Sep 2026.
 *
 * The tree-wide version was drafted and **deliberately not written, because it
 * would not have caught the defect it was for.** The only structurally
 * checkable form is "every `*EXEMPT*` declared in a test is referenced inside
 * a `test()` body in the same file", and `DASH_EXEMPT` satisfied that
 * throughout: it fed `DASH_HITS`, which a test asserted on. What it was not
 * inside was the two rules that audit exemptions, and "audited" is not a
 * property source can be read for. A rule that passes on the instance it was
 * written for is decoration, and this repo deletes those rather than shipping
 * them.
 */
test("AUDITED is every exemption list declared in this file", () => {
  const self = readFileSync(fileURLToPath(import.meta.url), "utf8");
  const declared = [...self.matchAll(/^const (\w*EXEMPT\w*)\b/gm)].map((m) => m[1]!).sort();
  assert.ok(declared.length >= 3, `only ${declared.length} exemption lists found - the parse, not the file, is what changed`);
  assert.deepEqual(
    declared,
    Object.keys(AUDITED).sort(),
    "an exemption list in this file is audited by neither rule below. Add it to AUDITED - that is how DASH_EXEMPT went two commits without one",
  );
});

/**
 * And that the reason is still true, not just that the file is still there.
 *
 * An exemption is a sweep switched off, and the sentence beside it is the only
 * argument for switching it off. Checking the file exists checks the weaker
 * half: `engines.ts` could keep its name while `FREE_ENGINES` moved, leaving a
 * file exempt from the engine-count rule on the strength of a declaration it no
 * longer holds. `input-bounds.test.mts` records the same thing about its own
 * list, measured, on 20 September 2026.
 */
test("every exemption's reason is still true, not just its filename", () => {
  // The keys are posix paths from the repo root, the way `posix()` writes them.
  const sourceOf = (home: string) => readFileSync(join(ROOT, ...home.split("/")), "utf8");

  // ENGINE_EXEMPT: each file is excused because it declares the engine set.
  assert.ok(/export const FREE_ENGINES\b/.test(sourceOf("src/lib/scan/engines.ts")));
  assert.ok(/export const GATED_ENGINES\b/.test(sourceOf("src/lib/scan/engines.ts")));
  assert.ok(/export const FREE_ENGINE_COUNT\b/.test(sourceOf("src/config/scan-shape.ts")));
  assert.deepEqual(
    Object.keys(ENGINE_EXEMPT).sort(),
    ["src/config/scan-shape.ts", "src/lib/scan/engines.ts"],
    "ENGINE_EXEMPT gained or lost an entry - the declarations asserted above are the argument for each one, so add or remove the matching assertion rather than only the key",
  );

  // PRICE_EXEMPT: pricing.ts is excused wholesale, so it had better hold prices.
  assert.ok(PRICE.test(sourceOf("src/config/pricing.ts")), "pricing.ts is exempt as the home of the prices and has none");

  // And every narrowed figure is still on the page it was allowed for. A stale
  // one is an allowance for a number nobody can see, which is how the next
  // price slips in beside it.
  for (const [home, { only }] of Object.entries(PRICE_EXEMPT)) {
    if (!only) continue;
    const source = sourceOf(home);
    for (const figure of only) {
      assert.ok(
        source.includes(figure),
        `PRICE_EXEMPT allows ${figure} in ${home} and it is not there any more - drop it, or the next price typed on that page inherits its allowance`,
      );
    }
  }

  // DASH_EXEMPT carries its own argument, the `holds` shape `input-bounds`
  // uses: a file may keep its name while the decoder that earns it moves out.
  for (const [home, { holds, why }] of Object.entries(DASH_EXEMPT)) {
    assert.ok(holds.length > 0, `DASH_EXEMPT["${home}"] has no holds - "${why}" is then prose, which is what this rule replaced`);
    for (const { file, needs } of holds) {
      assert.match(
        sourceOf(file),
        needs,
        `DASH_EXEMPT["${home}"] says ${file} holds ${needs}, and it does not any more. Either the decoder moved - update holds - or it went, and this file is exempt for nothing.`,
      );
    }
  }
});

test("an engine count is derived, never typed", () => {
  assert.deepEqual(
    say(ENGINE_HITS),
    [],
    "read this from FREE_ENGINE_COUNT or FREE_ENGINE_LABELS in src/config/scan-shape.ts - the free engine set has already changed once, and every typed count of it was true when it was written",
  );
});

test("a question count is derived, never typed", () => {
  assert.deepEqual(
    say(COUNT_HITS),
    [],
    `read this from ${OWNED.map((o) => o.home).join(" or ")} - a typed count is a second copy of a number nothing keeps in step, and this one has gone stale five times`,
  );
});
