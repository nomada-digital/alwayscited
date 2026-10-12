import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { DIY_FIXTURE_MEANS, DIY_FIXTURE_STATES, FIXTURE_DIR, diyFixtureState, diyFixtureStore, diyFixtureWrites, fixtureDiyEnabled, pickState, readDiyFixture } from "./fixture.ts";

/**
 * The DIY fixture state (13 Oct 2026, DIY P1 milestone M1; spec 10 section
 * 7.0 item 6): read only on the tracking fixture, refused in production, a
 * mistyped state is an error, and each package's file falls back to `full`.
 */

const ON = { TRACKING_FIXTURE: "1" };

test("the states are the spec's eight, each with what it stands for", () => {
  assert.deepEqual([...DIY_FIXTURE_STATES], ["full", "dark", "day0", "zero", "capped", "nofootprint", "nolinks", "fewcompetitors"]);
  assert.deepEqual(Object.keys(DIY_FIXTURE_MEANS), [...DIY_FIXTURE_STATES]);
});

test("off without the tracking fixture, full by default, and every state by name", () => {
  assert.equal(diyFixtureState({}), null);
  assert.equal(diyFixtureState({ DIY_FIXTURE_STATE: "dark" }), null, "the DIY state alone does not turn the fixture on");
  assert.equal(diyFixtureState(ON), "full");
  assert.equal(diyFixtureState({ ...ON, DIY_FIXTURE_STATE: "" }), "full");
  for (const s of DIY_FIXTURE_STATES) assert.equal(diyFixtureState({ ...ON, DIY_FIXTURE_STATE: s }), s);
});

test("a state that is not one throws rather than serving full", () => {
  assert.throws(() => diyFixtureState({ ...ON, DIY_FIXTURE_STATE: "Dark" }), /not a DIY fixture state/);
  assert.throws(() => diyFixtureState({ ...ON, DIY_FIXTURE_STATE: "placed" }), /not a DIY fixture state/, "placed is a tracking state (fixture-mode.ts), not a DIY one");
});

test("production refuses the DIY fixture as it refuses the tracking one", () => {
  assert.throws(() => diyFixtureState({ ...ON, VERCEL_ENV: "production" }), /refuses/);
  assert.throws(() => fixtureDiyEnabled({ ...ON, VERCEL_ENV: "production", DIY_FIXTURE_STATE: "dark" }), /refuses/);
});

test("the switch on the fixture: off in dark only; null off the fixture, so app_settings decides", () => {
  assert.equal(fixtureDiyEnabled({}), null);
  for (const s of DIY_FIXTURE_STATES) assert.equal(fixtureDiyEnabled({ ...ON, DIY_FIXTURE_STATE: s }), s !== "dark", s);
});

test("a package's file gives its own entry for a state, else full", () => {
  const file = { full: { n: 23 }, day0: { n: 0 } };
  assert.deepEqual(pickState(file, "day0"), { n: 0 });
  assert.deepEqual(pickState(file, "dark"), { n: 23 }, "dark is the same as full unless the file says otherwise");
  assert.throws(() => pickState({} as never, "full"), /needs a full entry/);
});

test("readDiyFixture reads src/lib/diy/fixtures/<name>.json for the state, and nothing off the fixture", () => {
  const root = mkdtempSync(join(tmpdir(), "diy-fixture-"));
  try {
    mkdirSync(join(root, FIXTURE_DIR), { recursive: true });
    writeFileSync(join(root, FIXTURE_DIR, "plan.json"), JSON.stringify({ full: ["a", "b"], day0: [] }));
    writeFileSync(join(root, FIXTURE_DIR, "origins.p7.json"), JSON.stringify({ full: ["o"] }));
    assert.deepEqual(readDiyFixture<string[]>("plan", ON, root), ["a", "b"]);
    assert.deepEqual(readDiyFixture<string[]>("plan", { ...ON, DIY_FIXTURE_STATE: "day0" }, root), []);
    assert.deepEqual(readDiyFixture<string[]>("origins.p7", ON, root), ["o"], "a dotted name, as P7's origin rows sit beside P2's");
    assert.throws(() => readDiyFixture("plan", {}, root), /only with TRACKING_FIXTURE=1/);
    assert.throws(() => readDiyFixture("../tracking/fixture", ON, root), /not a DIY fixture name/);
    assert.throws(() => readDiyFixture("Plan", ON, root), /not a DIY fixture name/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("write twins: on only with TRACKING_FIXTURE_WRITE=1 on the fixture, never in production", () => {
  assert.equal(diyFixtureWrites({ TRACKING_FIXTURE_WRITE: "1" }), false, "not without the fixture");
  assert.equal(diyFixtureWrites({ ...ON }), false);
  assert.equal(diyFixtureWrites({ ...ON, TRACKING_FIXTURE_WRITE: "1" }), true);
  assert.throws(() => diyFixtureWrites({ ...ON, TRACKING_FIXTURE_WRITE: "1", VERCEL_ENV: "production" }), /refuses/);
});

test("each package's store is its own, built once, and survives a second module asking for it", () => {
  let built = 0;
  const a = diyFixtureStore("test-a", () => (built++, { items: [1] }));
  const b = diyFixtureStore("test-b", () => ({ items: [9] }));
  assert.deepEqual(a.get(), { items: [1] });
  a.set({ items: [1, 2] });
  assert.deepEqual(diyFixtureStore("test-a", () => (built++, { items: [] })).get(), { items: [1, 2] }, "held on globalThis, as the routes and pages are bundled apart");
  assert.deepEqual(b.get(), { items: [9] });
  assert.equal(built, 1);
  assert.throws(() => diyFixtureStore("Bad Name", () => 0), /not a DIY fixture name/);
});
