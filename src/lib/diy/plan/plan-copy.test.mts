import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";

/**
 * The Plan's copy rules, held where the /app censuses do not reach (13 Oct
 * 2026, DIY P3). causal-copy, prompts-copy and check-time walk
 * src/components/app and src/app/app, and see the Actions components and
 * page; the sentences the rules write - readouts, Slipping facts, the "Why
 * this is first" lines, the toasts - live in src/lib/diy/plan, which they do
 * not walk. This holds those files to the same words, and to the gating
 * vocabulary spec 10 section 6.10 item 2 bans from the page (P1's census
 * sweeps the rendered HTML once it lands).
 *
 * Comments are stripped first, as the censuses strip them.
 */

const ROOT = join(import.meta.dirname, "..", "..", "..", "..");
const DIRS = ["src/lib/diy/plan", "src/components/app/plan", "src/app/app/[client]/plan", "src/app/api/app/[client]/plan"];
/** 13 Oct 2026: 13 + 10 + 1 + 1 files. A walk that stops matching reports a clean tree. */
const FLOOR = 24;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(n) && !n.includes(".test.") ? [p] : [];
  });
}
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const files = DIRS.flatMap((d) => walk(join(ROOT, d))).map((f) => ({ file: relative(ROOT, f), lines: code(readFileSync(f, "utf8")).split("\n") }));
const hits = (re: RegExp, skip: (l: string) => boolean = () => false) => files.flatMap(({ file, lines }) => lines.filter((l) => re.test(l) && !skip(l)).map((l) => `${file}: ${l.trim()}`));

test("the walk found the Plan's files", () => {
  assert.ok(files.length >= FLOOR, `walked ${files.length} files, floor ${FLOOR}`);
});

test("no causal word (causal-copy's list)", () => {
  assert.deepEqual(hits(/\b(caused|drove|because of|thanks to|resulted in|delivered)\b/i), []);
});

test("prompts, never questions (prompts-copy's rule; code names like tracked_questions and .questions are code)", () => {
  assert.deepEqual(hits(/(?<![.\w])questions?(?![\w:(])/i), []);
});

test("no clock time typed into copy (check-time's rule): the jobs run overnight", () => {
  assert.deepEqual(hits(/(?<![\w:.])(?:[01]?\d|2[0-3]):[0-5]\d(?![\w:])|\b(?:1[0-2]|0?[1-9])(?::[0-5]\d)? ?[ap]\.?m\.?(?![a-z])/i, (l) => /T\d\d:\d\d/.test(l)), []);
});

test("none of the gating vocabulary: no difficulty, DR, KD, marketplace, sponsored or guest post, no Fatgrid, no competitor tool named", () => {
  assert.deepEqual(hits(/fatgrid/i), []);
  assert.deepEqual(hits(/\b(marketplace|for sale|write for us|accepts guest|placeable|could place|place this|domain rating|difficulty|sponsored|guest post)\b|\bDR\b|\bKD\b/i), []);
  assert.deepEqual(hits(/\b(ahrefs|semrush|sitechecker|sparktoro|gumshoe|peec|profound|otterly|scrunch)\b/i), []);
  assert.deepEqual(hits(/from ["'][^"']*(difficulty|difficulty-read|placement-difficulty)["']/), []);
});

test("no score, no index, no causal ranking word in the rule-written lines", () => {
  assert.deepEqual(hits(/\b(score|AI rank)\b/i, (l) => /import|type /.test(l)), []);
});

test("the brand never takes a capital, and Nomada is named only as the owner label agency mode replaces", () => {
  assert.deepEqual(hits(/AlwaysCited|Alwayscited|always cited/), []);
  const nomada = hits(/["'`][^"'`]*nomada digital/i);
  assert.deepEqual(
    nomada.map((h) => h.split(": ")[0]),
    ["src/lib/diy/plan/placements.ts"],
    "only placements.ts's NOMADA_OWNER, which ownerLabel swaps for 'Your account contact' in agency mode",
  );
});
