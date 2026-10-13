/**
 * Prompt origins (13 Oct 2026, DIY P2; spec 10 sections 4.10, 6.7 and 7.3):
 * the chip mapping, legacy source included, its links, agency mode, and the
 * loader on Supabase (a fake), before its migration, and on the fixture.
 * Illustrative: Tallyroo and every brand and site shown are made up.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { promptsDb } from "./fake-prompts-db.mts";
import { CHOSEN_KINDS, ORIGIN_KINDS, fixtureOriginMap, isChosen, isPlacementPrompt, loadPromptOrigins, originAttr, originHref, originKinds, originLabel, originMap, originOf, readOriginsFiles, readPromptOrigins, type OriginRepo, type PromptOrigin } from "./origins.ts";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..", "..", "..", "..");

test("the kinds are the spec's six, and the chosen ones are setup, client and nomada", () => {
  assert.deepEqual([...ORIGIN_KINDS], ["setup", "client", "nomada", "placement", "opportunity", "momentum"]);
  assert.deepEqual([...CHOSEN_KINDS], ["setup", "client", "nomada"]);
});

test("originOf: the row's own kind, scan read as setup; a legacy row's from its source", () => {
  assert.equal(originOf({ id: "a", origin_kind: "setup" })?.kind, "setup");
  assert.equal(originOf({ id: "a", origin_kind: "scan" })?.kind, "setup", "the column's legacy value");
  assert.equal(originOf({ id: "a", source: "scan", origin_kind: null })?.kind, "setup");
  assert.equal(originOf({ id: "a", source: "client" })?.kind, "client");
  assert.equal(originOf({ id: "a", source: "nomada" })?.kind, "nomada");
  assert.equal(originOf({ id: "a", source: "nomada", origin_kind: "placement", origin_ref: "p1", allowance: "placement" })?.kind, "placement", "the kind wins over the source");
  assert.deepEqual(originOf({ id: "a", source: "client", origin_kind: "opportunity", origin_ref: "o1" }), { kind: "opportunity", ref: "o1", placement: false, domain: null });
  assert.equal(originOf({ id: "a", source: "client", origin_kind: "momentum" })?.kind, "momentum");
  assert.equal(originOf({ id: "a" }), null, "nothing says");
  assert.equal(originOf({ id: "a", source: "someone" }), null);
  assert.equal(originOf({ id: "a", origin_kind: "invented" }), null);
  assert.equal(originOf({ id: "a", source: "nomada", origin_kind: "placement", allowance: "placement" })?.placement, true);
});

test("the chip's words, in nomada mode and in agency mode, where Nomada is never named", () => {
  const o = (kind: PromptOrigin["kind"], domain: string | null = null) => ({ kind, domain });
  assert.equal(originLabel(o("setup"), "nomada"), "Setup");
  assert.equal(originLabel(o("client"), "nomada"), "You");
  assert.equal(originLabel(o("nomada"), "nomada"), "nomada digital");
  assert.equal(originLabel(o("nomada"), "off"), "Your account contact", "off is also what a failed mode read answers, so Nomada is named only when the mode says nomada");
  assert.equal(originLabel(o("nomada"), "agency"), "Your account contact");
  assert.equal(originLabel(o("placement", "thesmallbizstack.com"), "nomada"), "Placement · thesmallbizstack.com");
  assert.equal(originLabel(o("placement"), "nomada"), "Placement");
  assert.equal(originLabel(o("opportunity"), "nomada"), "Opportunity");
  assert.equal(originLabel(o("momentum"), "nomada"), "Momentum");
  // 13 Oct 2026 review: the markup follows the words, so an agency page carries no "nomada" in its attributes either.
  assert.equal(originAttr("nomada", "nomada"), "nomada");
  assert.equal(originAttr("nomada", "agency"), "contact");
  assert.equal(originAttr("nomada", "off"), "contact");
  for (const k of ORIGIN_KINDS.filter((k) => k !== "nomada")) assert.equal(originAttr(k, "agency"), k);
  for (const kind of ORIGIN_KINDS) assert.doesNotMatch(originLabel(o(kind, "freelancefieldnotes.com"), "agency"), /nomada/i, kind);
});

test("the chip's links: Placement to /placements, Opportunity to its page, Momentum to Google's gaining ground; the rest none", () => {
  assert.equal(originHref({ kind: "placement", ref: "p1" }, "tallyroo"), "/app/tallyroo/placements");
  assert.equal(originHref({ kind: "opportunity", ref: "o 1" }, "tallyroo"), "/app/tallyroo/opportunities/o%201");
  assert.equal(originHref({ kind: "opportunity", ref: null }, "tallyroo"), null);
  assert.equal(originHref({ kind: "momentum", ref: null }, "tallyroo"), "/app/tallyroo/google?gaining=1");
  for (const kind of ["setup", "client", "nomada"] as const) assert.equal(originHref({ kind, ref: null }, "tallyroo"), null, kind);
});

test("originMap: a placement origin carries its publication's domain; the helpers read the map", () => {
  const m = originMap(
    [
      { id: "q1", source: "scan" },
      { id: "q2", source: "nomada", origin_kind: "placement", origin_ref: "p1", allowance: "placement" },
      { id: "q3", source: "nomada", origin_kind: "placement", origin_ref: "gone", allowance: "placement" },
      { id: "q4" },
    ],
    [{ id: "p1", url_key: "thesmallbizstack.com/best-accounting-apps" }],
  );
  assert.equal(m.get("q2")?.domain, "thesmallbizstack.com");
  assert.equal(m.get("q3")?.domain, null, "a placement not read draws as Placement");
  assert.equal(m.has("q4"), false);
  assert.deepEqual([...originKinds(m)], [["q1", "setup"], ["q2", "placement"], ["q3", "placement"]]);
  assert.equal(isPlacementPrompt(m, "q2"), true);
  assert.equal(isPlacementPrompt(m, "q1"), false);
  assert.equal(isPlacementPrompt(null, "q2"), false);
  assert.equal(isChosen(m.get("q1")), true);
  assert.equal(isChosen(m.get("q2")), false);
  assert.equal(isChosen(undefined), true, "a legacy prompt with no origin read is one the client chose");
});

const ROWS = [
  { id: "q1", client_domain_id: "cl", source: "scan", origin_kind: null, origin_ref: null, allowance: null },
  { id: "q2", client_domain_id: "cl", source: "nomada", origin_kind: "placement", origin_ref: "p1", allowance: "placement" },
  { id: "other", client_domain_id: "someone-else", source: "client", origin_kind: null, origin_ref: null, allowance: null },
];

test("readPromptOrigins: one client's rows, with the placement domains read only when a placement origin exists", async () => {
  const { db, calls } = promptsDb({ tracked_questions: ROWS.map((r) => ({ ...r })), placements: [{ id: "p1", client_domain_id: "cl", url_key: "freelancefieldnotes.com/bookkeeping-tools" }] });
  const m = await readPromptOrigins(db, "cl");
  assert.deepEqual([...m.keys()].sort(), ["q1", "q2"]);
  assert.equal(m.get("q2")?.domain, "freelancefieldnotes.com");
  assert.ok(calls.every((c) => c.filters.includes("client_domain_id=cl")), "every read is held to the client");
  const { db: plain, calls: plainCalls } = promptsDb({ tracked_questions: [{ ...ROWS[0]! }], placements: [] });
  await readPromptOrigins(plain, "cl");
  assert.equal(plainCalls.some((c) => c.table === "placements"), false);
});

test("readPromptOrigins before the migration: the legacy columns only, every chip from source, and one log line", async () => {
  const legacy = ROWS.map(({ id, client_domain_id, source }) => ({ id, client_domain_id, source }));
  const { db } = promptsDb({ tracked_questions: legacy }, { columns: { tracked_questions: ["id", "client_domain_id", "source", "text", "stopped_on"] } });
  const warned: string[] = [];
  const warn = console.warn;
  console.warn = (m: string) => void warned.push(m);
  try {
    const m = await readPromptOrigins(db, "cl");
    assert.equal(m.get("q1")?.kind, "setup");
    assert.equal(m.get("q2")?.kind, "nomada", "before the columns, a placement prompt cannot exist; source is all there is");
  } finally {
    console.warn = warn;
  }
  assert.equal(warned.length, 1);
  assert.match(warned[0]!, /^\[diy\] origins: .*chips from source only/);
});

test("readPromptOrigins: a failed read is an empty map and a warning, never a throw", async () => {
  const fake = promptsDb({ tracked_questions: ROWS.map((r) => ({ ...r })) });
  fake.failNext("tracked_questions", "canceling statement due to statement timeout", "57014");
  const warn = console.warn;
  const warned: string[] = [];
  console.warn = (m: string) => void warned.push(m);
  try {
    assert.equal((await readPromptOrigins(fake.db, "cl")).size, 0);
  } finally {
    console.warn = warn;
  }
  assert.match(warned[0] ?? "", /^\[diy\] origins: canceling statement/);
});

test("the fixture: origins.json's rows and the fixture's own origin columns, for prompts the fixture has", async () => {
  const repo: OriginRepo = {
    async structure() {
      return { questions: [{ id: "q1-1" }, { id: "q1-3" }, { id: "q1-4" }, { id: "q1-pl1", source: "nomada", origin_kind: "placement", origin_ref: "p1", allowance: "placement" } as { id: string }] };
    },
    async placements() {
      return [{ id: "p1", url_key: "thesmallbizstack.com/best-accounting-apps" }];
    },
  };
  const m = await loadPromptOrigins("fixture", { env: { TRACKING_FIXTURE: "1" }, repo, root: ROOT });
  assert.deepEqual([...m].map(([id, o]) => [id, o.kind]), [["q1-1", "setup"], ["q1-3", "client"], ["q1-4", "nomada"], ["q1-pl1", "placement"]], "q1-2, q1-5 and q2-1 are in the file but not in this fixture");
  assert.equal(m.get("q1-pl1")?.domain, "thesmallbizstack.com");
  assert.equal(m.get("q1-pl1")?.placement, true);
});

test("origins.json: the six prompts with chips on the full fixture, and only setup, client and nomada (no opportunity or momentum prompt in P2's own file)", async () => {
  // 13 Oct 2026, DIY P7: wave 2 adds its own origins.<pkg>.json beside P2's file (spec 10 section 7.0 item 6) - P7's
  // opportunity rows, P6's momentum rows - so the fact this records is now P2's file alone, read alone. The merge of
  // the files is the next test's, and P7's opportunity row is its own package's fixture test's (opportunities/data.test.mts).
  const p2 = ((JSON.parse(readFileSync(join(ROOT, "src", "lib", "diy", "fixtures", "origins.json"), "utf8")) as { full: { id: string }[] }).full as Parameters<typeof originOf>[0][]).filter((r) => /^q\d+-\d+$/.test(r.id));
  assert.equal(p2.length, 6);
  const kinds = new Set(p2.map((r) => originOf(r)?.kind));
  assert.deepEqual([...kinds].sort(), ["client", "nomada", "setup"]);
});

test("origins.<pkg>.json beside origins.json is merged, after it, each by its state", async () => {
  const dir = mkdtempSync(join(tmpdir(), "origins-"));
  writeFileSync(join(dir, "origins.json"), JSON.stringify({ full: [{ id: "a", source: "scan" }] }));
  writeFileSync(join(dir, "origins.p7.json"), JSON.stringify({ full: [{ id: "b", source: "client", origin_kind: "opportunity", origin_ref: "o1" }], zero: [] }));
  writeFileSync(join(dir, "other.json"), JSON.stringify({ full: [{ id: "c", source: "scan" }] }));
  assert.deepEqual((await readOriginsFiles(dir, "full")).map((r) => r.id), ["a", "b"]);
  assert.deepEqual((await readOriginsFiles(dir, "zero")).map((r) => r.id), ["a"], "a state a file names replaces its full");
  const m = fixtureOriginMap(await readOriginsFiles(dir, "full"), [{ id: "a" }, { id: "b" }], []);
  assert.equal(m.get("b")?.kind, "opportunity");
});

test("off the fixture, the loader reads Supabase through the client it is handed", async () => {
  const warn = console.warn;
  console.warn = () => {};
  try {
    const { db } = promptsDb({ tracked_questions: ROWS.map((r) => ({ ...r })), placements: [] });
    assert.equal((await loadPromptOrigins("cl", { env: {}, db })).size, 2);
  } finally {
    console.warn = warn;
  }
});
