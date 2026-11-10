import assert from "node:assert/strict";
import { test } from "node:test";

import { checkRange, eligible, monthBudget, overrideFor, wouldBreach } from "./allocation.ts";

// Made-up figures throughout: the real amount and plan prices live in the database, never in this public repository.
const client = (clientId: string, planMonthly: number | null, extra: Partial<{ planCurrency: string; weightOverride: number | null; excluded: boolean }> = {}) => ({ clientId, planMonthly, planCurrency: "usd", weightOverride: null, excluded: false, ...extra });
const CAP = 1000;

test("10 Nov 2026: every paying client on a placement plan gets the per-customer amount, nothing is split", () => {
  const b = monthBudget({ cap: CAP, clients: [client("a", 300), client("b", 100), client("c", null), client("d", 500, { excluded: true }), client("g", 100, { planCurrency: "gbp" })], overrides: new Map(), spent: new Map() });
  assert.deepEqual(b.clients.map((c) => [c.clientId, c.allocation]), [["a", 1000], ["b", 1000], ["c", 0], ["d", 0], ["g", 1000]]);
  assert.equal(b.total, 3000, "the month's total is the amount times each eligible client");
  assert.equal(b.cap, CAP);
});

test("a weight row says otherwise: 0 leaves a client out, more than 0 puts in one with no plan price", () => {
  assert.equal(eligible(client("a", 300, { weightOverride: 0 })), false);
  assert.equal(eligible(client("a", null, { weightOverride: 1 })), true);
  assert.equal(eligible(client("a", null, { weightOverride: 1, excluded: true })), false, "excluded wins");
  assert.equal(eligible(client("a", null)), false, "no plan price: not paying");
});

test("a front-loading override fixes its client's budget and moves nobody else's", () => {
  const overrides = new Map([["a", { amount: 1600, approvedBy: "kev" }]]);
  const b = monthBudget({ cap: CAP, clients: [client("a", 300), client("b", 100), client("c", 100)], overrides, spent: new Map([["b", 1250]]) });
  assert.deepEqual(b.clients.map((c) => [c.clientId, c.allocation, c.overShareBy, c.breach]), [["a", 1600, 600, false], ["b", 1000, 0, true], ["c", 1000, 0, false]]);
  assert.equal(b.overCapBy, 600);
  assert.deepEqual(b.approvals, ["kev"]);
  assert.match(b.warnings.join(" "), /a: over the per-customer budget by \$600, approved by kev/);
  assert.match(b.warnings.join(" "), /b: \$1250 spent against a \$1000 budget/);
});

test("an override below the amount is the client's budget too, and is not over anything", () => {
  const b = monthBudget({ cap: CAP, clients: [client("a", 300)], overrides: new Map([["a", { amount: 400, approvedBy: "danny" }]]), spent: new Map() });
  assert.deepEqual([b.clients[0]!.allocation, b.overCapBy], [400, 0]);
});

test("an override covers its run of months; two may not overlap", () => {
  const ranges = [{ id: "1", startMonth: "2026-12-01", endMonth: "2027-02-01", monthlyUsd: 600, approvedBy: "kev" }];
  assert.equal(overrideFor("2026-11-01", ranges), null);
  assert.equal(overrideFor("2027-01-01", ranges)?.id, "1");
  assert.equal(overrideFor("2027-03-01", ranges), null);
  assert.equal(overrideFor("2030-01-01", [{ ...ranges[0]!, endMonth: null }])?.id, "1", "no end month runs on");
  assert.equal(checkRange({ startMonth: "2027-02-01", endMonth: null }, ranges).ok, false);
  assert.equal(checkRange({ startMonth: "2027-03-01", endMonth: null }, ranges).ok, true);
  assert.equal(checkRange({ id: "1", startMonth: "2026-11-01", endMonth: "2027-02-01" }, ranges).ok, true, "editing itself");
  assert.equal(checkRange({ startMonth: "2027-03-01", endMonth: "2027-01-01" }, []).ok, false);
});

test("spend against each client's budget, and a warning before an item that would take it past", () => {
  const b = monthBudget({ cap: CAP, clients: [client("a", 100), client("b", 100)], overrides: new Map(), spent: new Map([["a", 400], ["b", 450]]) });
  assert.equal(b.spent, 850);
  assert.equal(b.remaining, 1150);
  assert.deepEqual(wouldBreach(b, "a", 700), ["takes this client to $1100 against its $1000 budget this month"]);
  assert.deepEqual(wouldBreach(b, "a", 600), []);
  assert.equal(monthBudget({ cap: null, clients: [client("a", 100)], overrides: new Map(), spent: new Map() }).warnings[0], "The per-customer placement budget is not set, so only approved overrides are allocated.");
});
