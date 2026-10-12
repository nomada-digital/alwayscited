import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { fakeDb } from "../../tracking/fake-db.mts";
import { addDays } from "../../tracking/figures.ts";
import { expandFixture } from "../../tracking/fixture-mode.ts";
import { DIY_FIXTURE_STATES } from "../core/fixture.ts";
import { arrange } from "./board.ts";
import { fixtureRows, itemOf, loadPlanItems, planFixture, readPlan, section } from "./data.ts";
import { readout } from "./readout.ts";
import { PLAN_STATUSES, type PlanItem } from "./types.ts";
import { thisWeek, weekCounts } from "./week.ts";
import { whyFirst, itemChip } from "./why-first.ts";

const ROOT = join(import.meta.dirname, "..", "..", "..", "..");
const ENV = { TRACKING_FIXTURE: "1", VERCEL_ENV: "development" };
const env = (o: Record<string, string> = {}) => ({ ...ENV, ...o });
const TODAY = expandFixture(JSON.parse(readFileSync(join(ROOT, "src/lib/tracking/fixture.json"), "utf8"))).today;
const items = (state?: string) => fixtureRows(env(state ? { DIY_FIXTURE_STATE: state } : {}), ROOT).map(itemOf).filter((i): i is PlanItem => i !== null);
const reset = () => delete (globalThis as Record<symbol, unknown>)[Symbol.for("alwayscited.diyFixture.plan")];

test("full: 23 items across every status, 3 this week with 1 done, 2 done 21+ days ago and 1 too early", () => {
  const all = items();
  assert.equal(all.length, 23, "every row reads as an item");
  for (const s of PLAN_STATUSES) assert.ok(all.some((i) => i.status === s), s);
  const week = thisWeek(all, TODAY);
  assert.equal(week.length, 3);
  assert.deepEqual(weekCounts(all, TODAY), { done: 1, of: 3, open: 16 });
  assert.equal(new Set(week.map((i) => i.severity)).size, 3, "one per severity");
  assert.equal(new Set(week.map((i) => i.clusterId)).size, 3, "never two in one cluster");
  const done = all.filter((i) => i.status === "done");
  const kinds = done.map((i) => readout(i, { today: TODAY, clusters: [], keywords: [], prompts: [], answers: [], serp: [], placements: [], items: [] })?.kind).sort();
  assert.deepEqual(kinds, ["early", "read", "read"]);
  assert.equal(arrange(all, { kind: null, cluster: null, status: null }, TODAY).hidden, 1, "one hidden with Not now");
});

test("every fixture item's grade can render, and every severity's 'Why this is first' line does", () => {
  for (const i of items()) if (i.grade) assert.ok(itemChip(i), `${i.id}: ${i.grade} ${i.sourceId ?? ""}`);
  for (const s of ["blocking", "slipping", "closest", "gap", "tidy"] as const) assert.ok(whyFirst(s), s);
});

test("every fixture link is a dashboard path, and the hosts are the tracking fixture's made-up ones", () => {
  const raw = readFileSync(join(ROOT, "src/lib/diy/fixtures/plan.json"), "utf8");
  for (const i of items()) {
    for (const h of [i.href, ...i.why.map((f) => f.href)]) if (h) assert.match(h, /^\/(clusters|cited)\b/, `${i.id}: ${h}`);
  }
  const hosts = new Set([...raw.matchAll(/\b([a-z0-9-]+\.(?:com|co|example))\b/g)].map((m) => m[1]));
  assert.deepEqual([...hosts].sort(), ["example.com", "softwarecritic.com", "tallyroo.com"]);
});

test("day0 is empty; zero has nothing open; the states the Plan does not draw differently serve full", () => {
  assert.deepEqual(items("day0"), []);
  const zero = items("zero");
  assert.ok(zero.length > 0);
  assert.ok(zero.every((i) => i.status === "done" || i.status === "dropped"));
  assert.equal(arrange(zero, { kind: null, cluster: null, status: null }, TODAY).nothingOpen, true);
  for (const s of DIY_FIXTURE_STATES) if (!["day0", "zero"].includes(s)) assert.equal(items(s).length, 23, s);
  assert.throws(() => items("nope"), /not a DIY fixture state/);
});

test("the fixture's items belong to the tracking fixture's client only", async () => {
  reset();
  assert.equal((await readPlan(() => assert.fail("no database on the fixture"), "fixture", env())).length, 23);
  assert.deepEqual(await readPlan(() => assert.fail("no database on the fixture"), "fixture-2", env()), [], "the two-clients state's second client");
});

test("the write twin holds a write in memory only with TRACKING_FIXTURE_WRITE=1, per state", () => {
  reset();
  const ro = planFixture(env(), ROOT);
  assert.equal(ro.write([]), false, "read-only without the write switch");
  assert.equal(ro.rows().length, 23);
  const rw = planFixture(env({ TRACKING_FIXTURE_WRITE: "1" }), ROOT);
  assert.equal(rw.write(rw.rows().slice(0, 2)), true);
  assert.equal(planFixture(env({ TRACKING_FIXTURE_WRITE: "1" }), ROOT).rows().length, 2, "held across reads");
  assert.equal(planFixture(env({ TRACKING_FIXTURE_WRITE: "1", DIY_FIXTURE_STATE: "day0" }), ROOT).rows().length, 0, "another state is served its own file");
  reset();
  assert.throws(() => planFixture({ TRACKING_FIXTURE: "1", VERCEL_ENV: "production" }, ROOT).rows(), /production/);
});

test("a row is read through named fields: unknown kinds drop, hrefs that leave the dashboard drop, verifications need text and a day", () => {
  const row = { id: 7, kind: "add_schema", severity: "tidy", status: "done", title: "T", dedupe_key: "k", why: [{ text: "a", href: "https://x.example" }, { text: "" }, { text: "b", href: "/clusters/c1" }, "junk"], href: "//evil.example", verified: { at: "2026-10-01", text: "" }, readout_base: { changed: "maybe" }, extra: "never read" };
  const i = itemOf(row)!;
  assert.equal(i.id, "7");
  assert.deepEqual(i.why, [{ text: "a" }, { text: "b", href: "/clusters/c1" }]);
  assert.equal(i.href, null);
  assert.equal(i.verified, null);
  assert.deepEqual(i.readoutBase, {});
  assert.equal("extra" in i, false);
  assert.equal(itemOf({ ...row, kind: "pay_for_links" }), null);
  assert.equal(itemOf({ ...row, status: "archived" }), null);
});

test("Supabase: one client's rows, every page of them, named columns", async () => {
  const rows = Array.from({ length: 1205 }, (_, i) => ({ id: `r${String(i).padStart(4, "0")}`, client_domain_id: i % 2 ? "me" : "other", kind: "own_task", severity: "own", status: "todo", title: "t", dedupe_key: `task:${i}`, created_at: addDays("2026-01-01", i % 300) }));
  const { db, calls } = fakeDb({ plan_items: rows }, { maxRows: 1000 });
  const got = await loadPlanItems(db, "me");
  assert.equal(got.length, 602);
  assert.ok(calls.every((c) => c.range !== null));
});

test("a section that throws is logged and says so; it never reads as empty", async () => {
  const warn = console.warn;
  const said: string[] = [];
  console.warn = (m: string) => void said.push(m);
  try {
    assert.deepEqual(await section("plan items", async () => [1]), { ok: true, value: [1] });
    assert.deepEqual(await section("plan items", async () => Promise.reject(new Error("relation \"plan_items\" does not exist"))), { ok: false });
  } finally {
    console.warn = warn;
  }
  assert.deepEqual(said, ['[diy] plan items: relation "plan_items" does not exist']);
});
