import assert from "node:assert/strict";
import { test } from "node:test";

import { fakeDiyDb, settingsRows } from "./fake-diy.mts";
import { diyAttention, diyHealthLine, diyHealthLineFor, readDiyHealth } from "./health.ts";
import { DIY_SETTING_KEYS, parseDiySettings } from "./settings.ts";

/**
 * The DIY line in the daily run-health email (13 Oct 2026, DIY P1; spec 10
 * section 5.6): last night's spend against the caps, whether a cap paused it,
 * what is still due, and "off" while the switch is.
 */

const NOW = Date.parse("2026-10-14T05:20:00Z");
const today = "2026-10-14T03:31:00.000Z";

test("the line, on and off", () => {
  const h = { day: "2026-10-14", enabled: true, dfs: 0.4231, dfsCap: 10, model: 0.18, modelCap: 5, pausedAtCap: false, carried: 0 };
  assert.equal(diyHealthLine(h), "DIY reads overnight (14 Oct, UTC): DataForSEO $0.42 of $10.00, model $0.18 of $5.00; paused at cap: no; jobs carried to tonight: 0");
  assert.match(diyHealthLine({ ...h, enabled: false, pausedAtCap: true, carried: 3 }), /paused at cap: yes; jobs carried to tonight: 3; off$/);
});

test("read from the ledger and the jobs: a cap refusal tonight is a pause, open due rows are carried", async () => {
  const fake = fakeDiyDb({
    app_settings: settingsRows(),
    diy_reads: [
      { id: "a", client_domain_id: "c1", door: "labs", trigger: "scheduled", status: "ok", estimate: 0.132, cost: 0.1, created_at: today },
      { id: "b", client_domain_id: "c2", door: "model", trigger: "scheduled", status: "ok", estimate: 0.35, cost: 0.09, created_at: today },
      { id: "c", client_domain_id: "c2", door: "labs", trigger: "scheduled", status: "refused", code: "global_daily", estimate: 0.132, cost: null, created_at: today },
      { id: "d", client_domain_id: "c2", door: "labs", trigger: "scheduled", status: "ok", estimate: 0.132, cost: 5, created_at: "2026-10-13T03:31:00.000Z" },
    ],
    diy_jobs: [
      { id: "j1", done_at: null, due_on: "2026-10-14", attempts: 0 },
      { id: "j2", done_at: null, due_on: "2026-10-13", attempts: 2 },
      { id: "j3", done_at: "2026-10-14T03:32:00Z", due_on: "2026-10-14", attempts: 1 },
      { id: "j4", done_at: null, due_on: "2026-10-15", attempts: 0 },
      // Three attempts and never closed: no worker can take it, so it is not carried.
      { id: "j5", done_at: null, due_on: "2026-10-12", attempts: 3 },
    ],
  });
  fake.clock.now = NOW;
  const h = await readDiyHealth(fake.db, NOW);
  assert.deepEqual(h, { day: "2026-10-14", enabled: true, dfs: 0.1, dfsCap: 10, model: 0.09, modelCap: 5, pausedAtCap: true, carried: 2 });
});

test("the line asks for the mail only when a cap paused the night, jobs are carried, or it cannot be read", async () => {
  const quiet = fakeDiyDb({ app_settings: settingsRows(), diy_reads: [], diy_jobs: [{ id: "j1", done_at: "2026-10-14T03:32:00Z", due_on: "2026-10-14", attempts: 1 }] });
  assert.equal(await diyAttention(quiet.db, NOW), null, "a clean night needs no mail of its own");
  const carried = fakeDiyDb({ app_settings: settingsRows(), diy_reads: [], diy_jobs: [{ id: "j1", done_at: null, due_on: "2026-10-14", attempts: 1 }] });
  assert.match((await diyAttention(carried.db, NOW)) ?? "", /jobs carried to tonight: 1$/);
  const paused = fakeDiyDb({
    app_settings: settingsRows(),
    diy_reads: [{ id: "c", client_domain_id: "c2", door: "labs", trigger: "scheduled", status: "refused", code: "global_daily", estimate: 0.132, cost: null, created_at: today }],
    diy_jobs: [],
  });
  assert.match((await diyAttention(paused.db, NOW)) ?? "", /paused at cap: yes/);
  const broken = fakeDiyDb({ app_settings: settingsRows() }, { failRpc: true });
  assert.match((await diyAttention(broken.db, NOW)) ?? "", /^DIY reads: could not be read/);
});

test("a line that cannot be read says so, and never stops the mail", async () => {
  const fake = fakeDiyDb({ app_settings: settingsRows() }, { failRpc: true });
  assert.match(await diyHealthLineFor(fake.db, NOW), /^DIY reads: could not be read \(could not read the DIY ledger/);
});

test("the settings keys are the migration's nine", () => {
  assert.equal(DIY_SETTING_KEYS.length, 9);
  const parsed = parseDiySettings(settingsRows() as { key: string; value: unknown }[]);
  assert.deepEqual(parsed, {
    enabled: true,
    dailyDfsCapUsd: 10,
    dailyModelCapUsd: 5,
    month: { scheduled: 2.5, on_demand: 3, model: 2 },
    trialMonth: { scheduled: 1, on_demand: 1, model: 1 },
    problems: [],
  });
});
