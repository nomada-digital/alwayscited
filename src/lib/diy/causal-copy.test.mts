import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

/**
 * BRIEF-2 T13 census (Danny, 29 Sep 2026, danny.md line 88; added 30 Sep with
 * R97 part 1): the dashboard never says a placement made a figure move. A
 * placement line and a named rate sit on one time axis; the copy around them
 * must not read that as cause. Comments are stripped; any of the words left
 * is copy. The brief allows them only in the placements footnote's own
 * negation, and the board's footnote (PLACEMENTS_FOOTNOTE) uses none, so there
 * is no exemption to record.
 */

/**
 * 13 Oct 2026, DIY P4 (review of P4): the Overview's headline, What it means
 * and Since last check lines, and the AI page's rows, are written in
 * src/lib/diy/changes and src/lib/diy/ai, which this walk did not see. Both
 * added; each root must walk at least one file, and the floor rises from 9 to
 * 55 (62 files walked that day), so a root that stops matching fails rather
 * than reading clean. The rest of src/lib/diy is other packages' (spec 10
 * section 7.0); the shell widens the roots when they merge.
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
const WORDS = /\b(caused|drove|because of|thanks to|resulted in|delivered)\b/i;
const FLOOR = 1;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(n) && !n.includes(".test.") ? [p] : [];
  });
}

export function causalHits(src: string): string[] {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
  return code.split("\n").filter((l) => WORDS.test(l)).map((l) => l.trim());
}

test("census: the DIY lines claim no cause", () => {
  for (const r of ROOTS) assert.ok(walk(join(process.cwd(), r)).length > 0, `${r} walked no file`);
  const files = ROOTS.flatMap((r) => walk(join(process.cwd(), r)));
  assert.ok(files.length >= FLOOR, `walked ${files.length} files, floor ${FLOOR}`);
  const found = files.flatMap((f) => causalHits(readFileSync(f, "utf8")).map((l) => `${f}: ${l}`));
  assert.deepEqual(found, []);
});

test("census probe: copy fires, comments do not", () => {
  assert.equal(causalHits(`<p>This placement drove a 30 point rise.</p>`).length, 1);
  assert.equal(causalHits("`Up ${n} thanks to your placements`").length, 1);
  assert.equal(causalHits(`aria-label="Results delivered"`).length, 1);
  assert.equal(causalHits(`// what caused this\n/* because of that */`).length, 0);
});

test("the footnote itself passes", async () => {
  const { PLACEMENTS_FOOTNOTE } = await import("../tracking/placement-figures.ts");
  assert.equal(WORDS.test(PLACEMENTS_FOOTNOTE), false);
});
