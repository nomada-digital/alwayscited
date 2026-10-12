import assert from "node:assert/strict";
import { test } from "node:test";

import { SOURCES } from "./core.sources.ts";
import { CLASSIFIED_LABEL, GRADES, type Source, adviceProblem, checkedLabel, exampleLabel, gradeChip, sourceById, sourceProblems, vendorLabel, vendorRankLabel } from "./evidence.ts";

/**
 * Evidence grades and the register's seed (13 Oct 2026, DIY P1 milestone
 * M1; spec 10 sections 2.6 and 6.10). An advice line that fails a rule does
 * not render; the seed is the spec's table, with the five rendered Google
 * sources verified and the three competitor-derived ones internal.
 */

const RENDERED = ["G1", "G2", "G3", "G4", "S41"];
const INTERNAL = ["S43", "S8", "S40"];

test("four grades, strongest first, as plan_items.grade stores them", () => {
  assert.deepEqual([...GRADES], ["documented", "tested", "your_data", "practice"]);
});

test("the seed is the spec's table: five rendered Google sources and three internal ones, ids unique", () => {
  assert.deepEqual(SOURCES.map((s) => s.id), [...RENDERED, ...INTERNAL]);
  assert.equal(new Set(SOURCES.map((s) => s.id)).size, SOURCES.length);
  for (const s of SOURCES) assert.deepEqual(sourceProblems(s), [], s.id);
  // The floor advice-grades.test.mts will hold: 5 rendered sources at seed.
  assert.equal(SOURCES.filter((s) => !s.internal).length, 5);
});

test("the rendered sources are Google's own pages, verified, with the updated dates the spec records", () => {
  const updated = Object.fromEntries(SOURCES.filter((s) => !s.internal).map((s) => [s.id, s.updated]));
  assert.deepEqual(updated, { G1: "2026-08-28", G2: "2026-07-10", G3: "2026-06-15", G4: "2026-05-07", S41: "2025-12-10" });
  for (const id of RENDERED) {
    const s = sourceById(id, SOURCES)!;
    assert.equal(s.publisher, "Google");
    assert.equal(s.verified, true);
    assert.equal(s.read, "2026-10-12");
    assert.match(s.url, /^https:\/\/developers\.google\.com\/search\/docs\//);
  }
});

test("internal sources name no competitor tool and point only at the research note that holds the citation", () => {
  const banned = /\b(ahrefs|semrush|sitechecker|sparktoro|gumshoe|peec|profound|otterly|scrunch)\b/i;
  for (const id of INTERNAL) {
    const s = sourceById(id, SOURCES)!;
    assert.equal(s.internal, true);
    assert.equal(s.verified, false, "nothing may cite it, so nothing needs it verified");
    assert.doesNotMatch(JSON.stringify(s), banned, id);
    assert.match(s.url, /^docs\/diy-platform-2026-10-12\/06-competitors-ai-visibility\.md$/, id);
  }
});

const register: Source[] = [
  ...SOURCES,
  { id: "UNREAD", title: "a vendor page not read yet", publisher: "A vendor", url: "https://vendor.example/docs", updated: null, read: null, verified: false, internal: false, note: "seeded unverified" },
  { id: "UNDATED", title: "read, no updated date", publisher: "A vendor", url: "https://vendor.example/docs", updated: null, read: "2026-10-12", verified: true, internal: false, note: "no updated date on the page" },
];

test("an advice line renders only with a grade, and a sourced grade only with a verified, dated, rendered source", () => {
  assert.equal(adviceProblem({ grade: "documented", sourceId: "S41" }, register), null);
  assert.equal(adviceProblem({ grade: "your_data" }, register), null, "our own data needs no register entry");
  assert.equal(adviceProblem({ grade: "practice" }, register), null);
  assert.match(adviceProblem({ grade: "" as never }, register)!, /no evidence grade/);
  assert.match(adviceProblem({ grade: "proven" as never }, register)!, /no evidence grade/);
  assert.match(adviceProblem({ grade: "documented" }, register)!, /needs a source/);
  assert.match(adviceProblem({ grade: "tested" }, register)!, /needs a source/, "Tested has no rendered source at launch");
  assert.match(adviceProblem({ grade: "documented", sourceId: "G9" }, register)!, /not in the register/);
  assert.match(adviceProblem({ grade: "documented", sourceId: "UNREAD" }, register)!, /not verified/);
  assert.match(adviceProblem({ grade: "documented", sourceId: "UNDATED" }, register)!, /updated and read dates/);
  assert.match(adviceProblem({ id: "why-first.blocking", grade: "documented", sourceId: "S43" }, register)!, /^why-first\.blocking: cites S43, an internal source/);
  assert.match(adviceProblem({ grade: "your_data", sourceId: "S40" }, register)!, /internal source/, "no grade may cite an internal source");
});

test("the chip: the publisher documents it, with its title and updated date; our data and practice carry no note", () => {
  assert.deepEqual(gradeChip({ grade: "documented", sourceId: "S41" }, SOURCES), {
    grade: "documented",
    label: "Google documents this",
    note: "Google, Search Central, AI features and your website, updated 10 Dec 2025",
  });
  assert.deepEqual(gradeChip({ grade: "your_data" }, SOURCES), { grade: "your_data", label: "Seen in your data", note: null });
  assert.deepEqual(gradeChip({ grade: "practice" }, SOURCES), { grade: "practice", label: "Common practice", note: null });
  assert.equal(gradeChip({ grade: "documented", sourceId: "S43" }, SOURCES), null, "a line that must not render has no chip");
  assert.equal(gradeChip({ grade: "documented" }, SOURCES), null);
});

test("the origin labels: read by us, a vendor estimate with its read date, written by a model", () => {
  assert.equal(checkedLabel("2026-10-12"), "Checked 12 Oct 2026");
  assert.equal(vendorLabel("2026-10-12"), "DataForSEO estimate, read 12 Oct 2026");
  assert.equal(vendorRankLabel("2026-10-12"), "DataForSEO estimate, 0-1000, read 12 Oct 2026");
  assert.equal(CLASSIFIED_LABEL, "classified automatically");
  assert.equal(exampleLabel("2026-11-03"), "Example written from your page on 3 Nov 2026. Check every fact before you publish. Nothing is published for you.");
});
