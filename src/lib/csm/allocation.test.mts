import assert from "node:assert/strict";
import { test } from "node:test";

import { checkRange, monthBudget, overrideFor, weightOf, wouldBreach } from "./allocation.ts";

// Made-up figures throughout: the real cap and plan prices live in the database, never in this public repository.
const client = (clientId: string, planMonthly: number | null, extra: Partial<{ planCurrency: string; weightOverride: number | null; excluded: boolean }> = {}) => ({ clientId, planMonthly, planCurrency: "usd", weightOverride: null, excluded: false, ...extra });
const CAP = 1000;

test("the cap is split by plan price; excluded and unpriced clients get nothing", () => {
  const b = monthBudget({ cap: CAP, clients: [client("a", 300), client("b", 100), client("c", null), client("d", 500, { excluded: true })], overrides: new Map(), spent: new Map() });
  assert.deepEqual(b.clients.map((c) => [c.clientId, c.allocation]), [["a", 750], ["b", 250], ["c", 0], ["d", 0]]);
  assert.equal(b.allocated, CAP);
  assert.equal(weightOf(client("g", 100, { planCurrency: "GBP" })), 127, "GBP put on the USD scale, as a weight");
});

test("a front-loading override is fixed and the rest share what is left of the cap", () => {
  const overrides = new Map([["a", { amount: 600, approvedBy: "kev" }]]);
  const b = monthBudget({ cap: CAP, clients: [client("a", 300), client("b", 100), client("c", 100)], overrides, spent: new Map([["b", 250]]) });
  assert.deepEqual(b.clients.map((c) => [c.clientId, c.allocation, c.breach]), [["a", 600, false], ["b", 200, true], ["c", 200, false]]);
  assert.equal(b.overCapBy, 0);
  assert.match(b.warnings.join(" "), /b: \$250 spent against a \$200 allocation/);
});

test("an override past the cap is never refused, only shown: over cap by $X, approved by <name>", () => {
  const overrides = new Map([["a", { amount: 1300, approvedBy: "danny" }]]);
  const b = monthBudget({ cap: CAP, clients: [client("a", 300), client("b", 100)], overrides, spent: new Map([["a", 1100]]) });
  assert.deepEqual(b.clients.map((c) => [c.clientId, c.allocation, c.share, c.overShareBy]), [["a", 1300, 750, 550], ["b", 0, 250, 0]]);
  assert.equal(b.overCapBy, 300);
  assert.deepEqual(b.approvals, ["danny"]);
  assert.match(b.warnings.join(" "), /over the \$1000 cap by \$300, approved by danny/);
  assert.equal(b.breach, false, "spend within the approved override is not a breach");
  assert.match(b.warnings.join(" "), /within approved overrides/);
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

test("shares that do not divide evenly never add up past the cap, and are not shown as over it", () => {
  const b = monthBudget({ cap: 750, clients: [client("a", 100), client("b", 100), client("c", 100)], overrides: new Map(), spent: new Map() });
  assert.ok(b.allocated <= 750, String(b.allocated));
  assert.equal(b.overCapBy, 0);
  assert.equal(b.warnings.some((w) => /over the/.test(w)), false);
});

test("spend against the cap in total, and a warning before an item that would breach", () => {
  const b = monthBudget({ cap: CAP, clients: [client("a", 100), client("b", 100)], overrides: new Map(), spent: new Map([["a", 400], ["b", 450]]) });
  assert.equal(b.spent, 850);
  assert.equal(b.remaining, 150);
  assert.deepEqual(wouldBreach(b, "a", 200), ["takes this client to $600 against a $500 allocation", "takes the month to $1050 against the $1000 cap"]);
  assert.deepEqual(wouldBreach(b, "a", 50), []);
  assert.equal(monthBudget({ cap: null, clients: [client("a", 100)], overrides: new Map(), spent: new Map() }).warnings[0], "The global placement cap is not set, so only approved overrides are allocated.");
});
