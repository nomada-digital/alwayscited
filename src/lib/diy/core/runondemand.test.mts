import assert from "node:assert/strict";
import { test } from "node:test";

import { isFixtureCtx } from "./ctx.ts";
import { fakeDiyDb, settingsRows, testClient } from "./fake-diy.mts";
import type { ReadCtx } from "./jobs.ts";
import { paidRead } from "./ledger.ts";
import { ACTION_ALLOWANCE, runOnDemand } from "./runondemand.ts";

/**
 * A member's paid button (13 Oct 2026, DIY P1; spec 10 sections 3.6 and
 * 5.7): refused without reserving while a tracking run is running, at a used
 * allowance, or at a cap; otherwise run inline or after the response, with a
 * ctx the doors accept. On the fixture, the state decides and nothing is read.
 */

const NOW = Date.parse("2026-10-20T14:00:00Z");
type Row = Record<string, unknown>;

function world(over: { settings?: Record<string, unknown>; runs?: Row[]; reads?: Row[]; failRuns?: boolean } = {}) {
  const fake = fakeDiyDb(
    { app_settings: settingsRows(over.settings), tracking_runs: [...(over.runs ?? [])], diy_reads: [...(over.reads ?? [])] },
    { failSelect: over.failRuns ? (t) => t === "tracking_runs" : undefined },
  );
  fake.clock.now = NOW;
  return fake;
}

const pageCheck = (n: number, status = "ok"): Row[] =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i}`, client_domain_id: "c-tallyroo", door: "onpage", endpoint: "instant_pages", trigger: "on_demand", action: "page_check", status, estimate: 0.0015, cost: 0.0015, created_at: "2026-10-05T10:00:00.000Z" }));

const base = (db: unknown) => ({ db: db as never, client: testClient(), member: "owner@tallyroo.com", action: "page_check" as const, now: () => NOW });

test("a running tracking run refuses before anything is reserved, with the spec's words", async () => {
  const fake = world({ runs: [{ id: "r1", status: "running", started_at: new Date(NOW - 60_000).toISOString() }] });
  let ran = 0;
  const out = await runOnDemand(base(fake.db), async () => ran++);
  assert.deepEqual(out, { ok: false, code: "tracking_running", words: "Your daily check is running. Try again in a few minutes." });
  assert.equal(ran, 0);
  assert.equal(fake.tables.diy_reads!.length, 0, "nothing reserved");
  assert.equal(fake.rpcCalls.length, 0, "the ledger was not even read");
});

test("a run left running past the stall line was killed, and does not block", async () => {
  const fake = world({ runs: [{ id: "r1", status: "running", started_at: new Date(NOW - 20 * 60_000).toISOString() }] });
  const out = await runOnDemand(base(fake.db), async () => "checked");
  assert.deepEqual(out, { ok: true, deferred: false, value: "checked" });
});

test("tracking runs that cannot be read refuse: never read as 'none running'", async () => {
  const fake = world({ failRuns: true });
  const out = await runOnDemand(base(fake.db), async () => "x");
  assert.equal(!out.ok && out.code, "ledger_unreadable");
});

test("a used allowance refuses with the used-up line, counted from the ledger's ok and partial rows only", async () => {
  const fake = world({ reads: [...pageCheck(29), ...pageCheck(5, "failed")] });
  assert.equal((await runOnDemand(base(fake.db), async () => "ok")).ok, true, "29 counted; failed checks do not count");
  const full = world({ reads: pageCheck(30) });
  const out = await runOnDemand(base(full.db), async () => "never");
  assert.deepEqual(out, { ok: false, code: "allowance", words: "You've used this month's 30 page checks. They reset on 1 Nov." });
  const trial = world({ reads: pageCheck(10) });
  const t = await runOnDemand({ ...base(trial.db), client: testClient({ trial: true }) }, async () => "never");
  assert.equal(!t.ok && t.words, "You've used this month's 10 page checks. They reset on 1 Nov.");
});

test("the caps are checked before the action starts: off, and a used month budget", async () => {
  const off = world({ settings: { diy_enabled: false } });
  assert.equal((await runOnDemand(base(off.db), async () => 1)).ok, false);
  const spent = world({ reads: [{ id: "m", client_domain_id: "c-tallyroo", door: "onpage", trigger: "on_demand", action: "log", status: "ok", estimate: 3, cost: 3, created_at: "2026-10-02T09:00:00.000Z" }] });
  const out = await runOnDemand(base(spent.db), async () => 1);
  assert.deepEqual(out, { ok: false, code: "month_budget", words: "This month's research is used. It resets on 1 Nov." });
});

test("allowed: fn gets an on-demand ctx for its action, and its paid read is reserved and counted as on-demand", async () => {
  const fake = world();
  let ctx: ReadCtx | null = null;
  const out = await runOnDemand(base(fake.db), async (c) => {
    ctx = c;
    return paidRead(c, { door: "onpage", endpoint: "instant_pages", estimate: 0.0015, params: { url: "https://tallyroo.com/" } }, async () => ({ value: "page", cost: 0.0015, rows: 1, partial: false }));
  });
  assert.equal(out.ok, true);
  const c = ctx as unknown as ReadCtx;
  assert.equal(c.trigger, "on_demand");
  assert.equal(c.action, "page_check");
  assert.ok(c.deadlineMs <= NOW + 25_000);
  const row = fake.tables.diy_reads![0]!;
  assert.deepEqual([row.trigger, row.action, row.status], ["on_demand", "page_check", "ok"]);
});

test("deferred: answered at once, run in after(), and a failure inside is logged, not thrown", async () => {
  const fake = world();
  const tasks: (() => Promise<void>)[] = [];
  const out = await runOnDemand({ ...base(fake.db), action: "example", defer: true, after: (t) => tasks.push(t) }, async () => {
    throw new Error("the model call failed");
  });
  assert.deepEqual(out, { ok: true, deferred: true });
  assert.equal(tasks.length, 1);
  await tasks[0]!();
  await assert.rejects(() => runOnDemand({ ...base(fake.db), defer: true }, async () => 1), /after\(\)/);
});

test("each action draws on its own allowance; a logged site has none of its own", () => {
  assert.deepEqual(ACTION_ALLOWANCE, { page_check: "page_checks", example: "examples", verify: "link_checks", link_check: "link_checks", log: null });
});

test("on the fixture the state decides, and fn gets a ctx whose doors refuse", async () => {
  const saved = { ...process.env };
  try {
    process.env.TRACKING_FIXTURE = "1";
    process.env.VERCEL_ENV = "development";
    process.env.DIY_FIXTURE_STATE = "dark";
    const dark = await runOnDemand({ ...base(null), db: null }, async () => 1);
    assert.equal(!dark.ok && dark.code, "disabled");
    process.env.DIY_FIXTURE_STATE = "capped";
    const capped = await runOnDemand({ ...base(null), db: null }, async () => 1);
    assert.equal(!capped.ok && capped.code, "allowance");
    process.env.DIY_FIXTURE_STATE = "full";
    let fixtureCtx = false;
    const full = await runOnDemand({ ...base(null), db: null }, async (c) => {
      fixtureCtx = isFixtureCtx(c);
      return paidRead(c, { door: "onpage", endpoint: "instant_pages", estimate: 0.0015, params: {} }, async () => ({ value: 1, cost: 0, rows: 1, partial: false }));
    });
    assert.equal(fixtureCtx, true);
    assert.equal(full.ok && !full.deferred && full.value.kind, "refused", "the fixture never reaches a vendor");
  } finally {
    for (const k of ["TRACKING_FIXTURE", "VERCEL_ENV", "DIY_FIXTURE_STATE"]) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
});
