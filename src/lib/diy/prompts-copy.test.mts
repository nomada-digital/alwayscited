import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

/**
 * R107(a) census (Danny, 29 Sep 2026, danny.md lines 98-99; census added
 * 30 Sep): inside /app the word is "prompts", never "questions" - copy,
 * labels, empty states, aria-labels. Public site copy is not in scope.
 *
 * Comments are stripped, then any whole word "question(s)" left is copy,
 * except where it is code: a property (`data.questions`, `questions:`), a
 * camelCase or snake_case name (`liveQuestions`, `tracked_questions`), or
 * the one recorded identifier below.
 */

/**
 * 13 Oct 2026, DIY P4 (review of P4): the Overview's and AI page's copy is
 * written in src/lib/diy/changes and src/lib/diy/ai, which this walk did not
 * see. Both added; each root must walk at least one file, and the floor rises
 * from 9 to 55 (62 files walked that day). The rest of src/lib/diy is other
 * packages' (spec 10 section 7.0); the shell widens the roots when they merge.
 */
/**
 * 18 Oct 2026, brief 2d: moved here from src/components/app, which retired with /app (every /app address 308s to the
 * dashboards host). src/components/app and src/app/app went with it; src/lib/diy/changes and src/lib/diy/ai remain,
 * and the rule holds over them as before - 5 files walked that day, so the floor moves from 55 to 5, and each root
 * must still walk at least one file. The dashboards host's tree was never under this census and is not added to it
 * here: walked on 18 Oct 2026 it reads differently, which is a copy decision for its own change, not this one.
 */
/**
 * 19 Oct 2026: src/lib/diy/ai is gone - the AI page's rows were the old /app dashboard's and were deleted with it
 * (commit 78b1023), as were changes/story.ts and the rest of changes/ but diff.ts. The rule holds over what is left:
 * 1 file walked that day, so the floor moves from 5 to 1 and the one root must still walk it.
 */
const ROOTS = ["src/lib/diy/changes"];
// data-figure="questions" is the figure's id, read by e2e/app specs, never shown.
const IDENTIFIERS = [/figure: "questions"/];
const FLOOR = 1;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(n) && !n.includes(".test.") ? [p] : [];
  });
}

export function copyHits(src: string): string[] {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
  const hits: string[] = [];
  for (const line of code.split("\n")) {
    if (IDENTIFIERS.some((r) => r.test(line))) continue;
    const re = /(?<![.\w])questions?(?![\w:(])/gi;
    if (re.test(line)) hits.push(line.trim());
  }
  return hits;
}

test("census: the DIY lines say prompts, never questions", () => {
  for (const r of ROOTS) assert.ok(walk(join(process.cwd(), r)).length > 0, `${r} walked no file`);
  const files = ROOTS.flatMap((r) => walk(join(process.cwd(), r)));
  assert.ok(files.length >= FLOOR, `walked ${files.length} files, floor ${FLOOR}`);
  const found = files.flatMap((f) => copyHits(readFileSync(f, "utf8")).map((l) => `${f}: ${l}`));
  assert.deepEqual(found, []);
});

test("census probe: copy fires, code and comments do not", () => {
  assert.equal(copyHits(`<th>Question</th>`).length, 1);
  assert.equal(copyHits("`${n} questions added`").length, 1);
  assert.equal(copyHits(`aria-label="Each question"`).length, 1);
  assert.equal(copyHits(`const n = data.questions.length; const liveQuestions = 1; q.tracked_questions;`).length, 0);
  assert.equal(copyHits(`// questions here\n/* and questions */`).length, 0);
  assert.equal(copyHits(`{ questions: 3 }`).length, 0);
});
