import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { code } from "../../source-read.mts";

import { type AdviceLine, type Source, adviceProblem, sourceProblems } from "./evidence.ts";

/**
 * Every piece of DIY advice carries an evidence grade, and every grade that
 * leans on a document names a dated, verified, rendered source (13 Oct 2026,
 * DIY P1; spec 10 sections 2.6 and 6.10 item 1).
 *
 * **The contract for the packages that write advice (P3, P7, P8):** advice
 * lines live in files named `src/lib/diy/**\/*.advice.ts`, loadable by node
 * (relative imports), each exporting `ADVICE: readonly AdviceLine[]`
 * (evidence.ts). Sources live in `src/lib/diy/**\/*.sources.ts`, each
 * exporting `SOURCES: Source[]`. The register is all of them together.
 *
 * Five assertions, as the spec lists them:
 *
 * 1. every advice line has a grade;
 * 2. every `documented` or `tested` line names a source that exists, has both
 *    dates, is verified and is not internal;
 * 3. no advice line cites an internal source;
 * 4. no component or module states what Google says outside an advice or
 *    sources file - a sweep for "Google says" and "Google documents";
 * 5. floors: the advice lines (0 at P1: no package has written one yet; each
 *    shell raises it) and the rendered sources (5 at seed: G1-G4 and S41).
 */

const ROOT = join(fileURLToPath(import.meta.url), "..", "..", "..", "..", "..");

/**
 * Advice lines across every advice file. 13 Oct 2026, DIY P1: 0 - none written yet; P5 and P9 raise it as P3, P7 and P8 merge.
 * Raised 13 Oct 2026 (DIY P5, wave 1 merged): 5 - P3's "Why this is first" line per severity (plan/why-first.advice.ts).
 * Raised 13 Oct 2026 (DIY P9, wave 2 merged): 104 - P3's 5, P7's 43 playbook lines (opportunities/playbooks.advice.ts)
 * and P8's 56 schema lines (pages/schema.advice.ts).
 * Raised 13 Oct 2026 (DIY P10, wave 3): 119 - wave 2's 104 and P10's 15 link playbook lines (links/links.advice.ts:
 * Earn a link's 7, Ask for a link's 6, who to write to, and the Reclaim method line).
 */
const ADVICE_FLOOR = 119;
/**
 * Rendered (not internal) sources. 13 Oct 2026, DIY P1: 5 at seed - G1, G2, G3, G4 and S41 (core.sources.ts).
 * Raised 13 Oct 2026 (DIY P9, wave 2 merged): 11 - the seed's 5 and P8's 6 crawler sources (pages.sources.ts), which
 * are seeded unverified: a line citing one does not render until it is verified (evidence.ts adviceProblem).
 */
const RENDERED_SOURCE_FLOOR = 11;

function walk(dir: string): string[] {
  const abs = join(ROOT, dir);
  if (!existsSync(abs)) return [];
  if (!statSync(abs).isDirectory()) return [dir];
  return readdirSync(abs).flatMap((f) => walk(join(dir, f)));
}

const DIY = walk("src/lib/diy");
const ADVICE_FILES = DIY.filter((f) => f.endsWith(".advice.ts"));
const SOURCE_FILES = DIY.filter((f) => f.endsWith(".sources.ts"));

const load = async (f: string) => (await import(pathToFileURL(join(ROOT, f)).href)) as Record<string, unknown>;

async function register(): Promise<{ sources: Source[]; byFile: Record<string, Source[]> }> {
  const byFile: Record<string, Source[]> = {};
  for (const f of SOURCE_FILES) {
    const mod = await load(f);
    assert.ok(Array.isArray(mod.SOURCES), `${f} exports no SOURCES array`);
    byFile[f] = mod.SOURCES as Source[];
  }
  return { sources: Object.values(byFile).flat(), byFile };
}

async function adviceLines(): Promise<{ file: string; line: AdviceLine }[]> {
  const out: { file: string; line: AdviceLine }[] = [];
  for (const f of ADVICE_FILES) {
    const mod = await load(f);
    assert.ok(Array.isArray(mod.ADVICE), `${f} exports no ADVICE array`);
    for (const line of mod.ADVICE as AdviceLine[]) out.push({ file: f, line });
  }
  return out;
}

test("the register: every source well formed, ids unique across files, the rendered floor held", async () => {
  assert.ok(SOURCE_FILES.includes("src/lib/diy/core/core.sources.ts"), "the seed register is where this expects it");
  const { sources } = await register();
  const ids = sources.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length, `a source id is used twice: ${ids.join(", ")}`);
  assert.deepEqual(sources.flatMap(sourceProblems), []);
  const rendered = sources.filter((s) => !s.internal);
  assert.ok(rendered.length >= RENDERED_SOURCE_FLOOR, `${rendered.length} rendered sources, floor ${RENDERED_SOURCE_FLOOR}`);
  for (const id of ["G1", "G2", "G3", "G4", "S41"]) assert.ok(rendered.some((s) => s.id === id && s.verified), `${id} is a verified rendered source`);
});

test("every advice line has a grade, a sourced grade a verified dated source, and none cites an internal one", async () => {
  const { sources } = await register();
  const lines = await adviceLines();
  assert.ok(lines.length >= ADVICE_FLOOR, `${lines.length} advice lines, floor ${ADVICE_FLOOR}`);
  const ids = lines.map((l) => l.line.id);
  assert.equal(new Set(ids).size, ids.length, "an advice id is used twice");
  const bad = lines.map(({ file, line }) => {
    const why = adviceProblem(line, sources);
    return why ? `${file}: ${why}` : null;
  });
  assert.deepEqual(bad.filter(Boolean), []);
  for (const { file, line } of lines) assert.ok(typeof line.text === "string" && line.text.trim(), `${file}: ${line.id} has no text`);
});

test("the rules this census enforces still refuse what they are for", () => {
  const reg: Source[] = [
    { id: "G9", title: "t", publisher: "Google", url: "https://developers.google.com/x", updated: "2026-01-01", read: "2026-10-12", verified: true, internal: false, note: "n" },
    { id: "IN", title: "t", publisher: "p", url: "docs/x.md", updated: null, read: null, verified: false, internal: true, note: "n" },
    { id: "UN", title: "t", publisher: "p", url: "https://vendor.example/", updated: null, read: null, verified: false, internal: false, note: "n" },
  ];
  assert.equal(adviceProblem({ id: "a", grade: "documented", sourceId: "G9" }, reg), null);
  assert.match(adviceProblem({ id: "b", grade: undefined as never }, reg)!, /no evidence grade/);
  assert.match(adviceProblem({ id: "c", grade: "documented" }, reg)!, /needs a source/);
  assert.match(adviceProblem({ id: "d", grade: "documented", sourceId: "UN" }, reg)!, /not verified/);
  assert.match(adviceProblem({ id: "e", grade: "practice", sourceId: "IN" }, reg)!, /internal/);
});

/** Where a claim about what Google says may be written: advice and sources files only. */
const CLAIM_ROOTS = ["src/components/app", "src/app/app", "src/lib/diy"];
const GOOGLE_SAYS = /Google (says|documents)/;

test("nothing outside an advice or sources file states what Google says", () => {
  const files = CLAIM_ROOTS.flatMap(walk).filter((f) => /\.(tsx?|mts)$/.test(f) && !f.includes(".test.") && !/\.(advice|sources)\.ts$/.test(f));
  assert.ok(files.length > 50, `only ${files.length} files walked - the sweep has gone blind`);
  const bad = files.filter((f) => GOOGLE_SAYS.test(code(readFileSync(join(ROOT, f), "utf8"))));
  assert.deepEqual(bad, [], "a claim about what Google says belongs in an advice file, graded and sourced");
  assert.ok(GOOGLE_SAYS.test('const why = "Google says a page must be crawlable";'), "the sweep fires on the shape it is for");
});
