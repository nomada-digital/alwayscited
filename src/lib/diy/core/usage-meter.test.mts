import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { allowanceMonth } from "./allowances.ts";
import { fakeDiyDb, settingsRows, testClient } from "./fake-diy.mts";
import type { DiyFixtureFile } from "./fixture.ts";
import { type CoreFixture, USAGE_KEYS, coreFixtureFor, countLedger, loadDiyUsage, usageRow } from "./usage-meter.ts";

/**
 * This month's research, counted (13 Oct 2026, DIY P1; spec 10 sections 2.5
 * and 4.13): counts only, each from where the spec says it lives, the month
 * the client's own, and a count that cannot be read shown as unread - never
 * as zero. The fixture's `full`, `capped` and `dark` states are the ones
 * Settings draws.
 */

const NOW = Date.parse("2026-10-20T14:00:00Z");
type Row = Record<string, unknown>;
const read = (action: string, status: string, created_at = "2026-10-05T10:00:00.000Z", client = "c-tallyroo"): Row => ({ id: Math.random().toString(36), client_domain_id: client, action, status, created_at });

test("the Settings rows, in order, with the spec's words", () => {
  assert.deepEqual([...USAGE_KEYS], ["page_checks", "examples", "link_checks", "link_targets", "pursuits"]);
  const client = testClient();
  assert.equal(usageRow("page_checks", 3, client).line, "Page checks: 3 of 30 used");
  assert.equal(usageRow("examples", 2, client).line, "Drafted examples: 2 of 10");
  assert.equal(usageRow("link_checks", 0, client).line, "Link checks: 0 of 30");
  assert.equal(usageRow("link_targets", 5, client).line, "Link targets: 5 of 5");
  assert.equal(usageRow("pursuits", 4, client).line, "Pursuing: 4 of 10");
  assert.equal(usageRow("pursuits", 1, testClient({ trial: true })).line, "Pursuing: 1 of 3");
  assert.equal(usageRow("examples", null, client).line, null, "unread is not a number");
  assert.doesNotMatch(JSON.stringify(USAGE_KEYS.map((k) => usageRow(k, 1, client))), /\$|£|€/, "counts, never dollars");
});

test("page checks and link checks count ok and partial ledger rows of their actions only", () => {
  const rows = [
    { action: "page_check", status: "ok" },
    { action: "page_check", status: "partial" },
    { action: "page_check", status: "failed" },
    { action: "page_check", status: "refused" },
    { action: "page_check", status: "reserved" },
    { action: "verify", status: "ok" },
    { action: "link_check", status: "partial" },
    { action: "log", status: "ok" },
    { action: null, status: "ok" },
  ];
  assert.equal(countLedger(rows, "page_checks"), 2);
  assert.equal(countLedger(rows, "link_checks"), 2);
});

test("counted from the database, this client, this month in its own zone", async () => {
  const month = allowanceMonth("UK", NOW);
  const fake = fakeDiyDb({
    app_settings: settingsRows(),
    diy_reads: [read("page_check", "ok"), read("page_check", "partial"), read("page_check", "ok", "2026-09-29T10:00:00.000Z"), read("page_check", "ok", "2026-10-05T10:00:00.000Z", "c-other"), read("verify", "ok")],
    reopt_examples: [{ id: "e1", client_domain_id: "c-tallyroo", status: "ready", requested_at: "2026-10-04T10:00:00.000Z" }, { id: "e2", client_domain_id: "c-tallyroo", status: "failed", requested_at: "2026-10-04T10:00:00.000Z" }],
    opportunities: [
      { id: "o1", client_domain_id: "c-tallyroo", lens: "link_page", status: "new", revealed_at: "2026-10-03T10:00:00.000Z" },
      { id: "o2", client_domain_id: "c-tallyroo", lens: "cited", status: "pursuing", revealed_at: null },
      { id: "o3", client_domain_id: "c-tallyroo", lens: "lists", status: "pitched", revealed_at: null },
      { id: "o4", client_domain_id: "c-tallyroo", lens: "lists", status: "won", revealed_at: null },
    ],
  });
  const usage = await loadDiyUsage(fake.db, testClient(), NOW);
  assert.equal(usage.enabled, true);
  assert.equal(usage.resetsLabel, month.resetsLabel);
  assert.equal(usage.resetsLabel, "1 Nov");
  assert.deepEqual(
    Object.fromEntries(usage.rows.map((r) => [r.key, r.used])),
    { page_checks: 2, examples: 1, link_checks: 1, link_targets: 1, pursuits: 2 },
  );
});

test("a count that cannot be read is unread, logged, and the rest still show", async () => {
  const fake = fakeDiyDb({ app_settings: settingsRows(), diy_reads: [read("page_check", "ok")] }, { failSelect: (t) => t === "reopt_examples" || t === "opportunities" });
  const usage = await loadDiyUsage(fake.db, testClient(), NOW);
  const by = Object.fromEntries(usage.rows.map((r) => [r.key, r]));
  assert.equal(by.page_checks!.used, 1);
  assert.equal(by.examples!.used, null);
  assert.equal(by.examples!.line, null);
  assert.equal(by.pursuits!.used, null);
});

test("the fixture's states: full has some used, capped has every allowance used, dark has none and is off", async () => {
  const file = JSON.parse(readFileSync(new URL("../fixtures/core.json", import.meta.url), "utf8")) as DiyFixtureFile<CoreFixture>;
  const count = (state: "full" | "capped" | "dark") => {
    const fx = coreFixtureFor(file, state);
    return { page_checks: countLedger(fx.reads, "page_checks"), link_checks: countLedger(fx.reads, "link_checks"), ...fx.counts };
  };
  assert.deepEqual(count("full"), { page_checks: 3, link_checks: 1, examples: 2, link_targets: 0, pursuits: 4 });
  assert.deepEqual(count("capped"), { page_checks: 30, link_checks: 30, examples: 10, link_targets: 5, pursuits: 10 });
  assert.deepEqual(count("dark"), { page_checks: 0, link_checks: 0, examples: 0, link_targets: 0, pursuits: 0 });

  const saved = { ...process.env };
  try {
    process.env.TRACKING_FIXTURE = "1";
    process.env.VERCEL_ENV = "development";
    process.env.DIY_FIXTURE_STATE = "capped";
    const capped = await loadDiyUsage(null, testClient(), NOW);
    assert.deepEqual(capped.rows.map((r) => r.line), ["Page checks: 30 of 30 used", "Drafted examples: 10 of 10", "Link checks: 30 of 30", "Link targets: 5 of 5", "Pursuing: 10 of 10"]);
    process.env.DIY_FIXTURE_STATE = "dark";
    const dark = await loadDiyUsage(null, testClient(), NOW);
    assert.equal(dark.enabled, false);
    assert.ok(dark.rows.every((r) => r.used === 0));
  } finally {
    for (const k of ["TRACKING_FIXTURE", "VERCEL_ENV", "DIY_FIXTURE_STATE"]) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
});
