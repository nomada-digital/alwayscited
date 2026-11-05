import assert from "node:assert/strict";
import { test } from "node:test";

import { checkOverride, monthBudget, weightOf, wouldBreach } from "./allocation.ts";

// Made-up figures throughout: the real cap and plan prices live in the database, never in this public repository.
const client = (clientId: string, planMonthly: number | null, extra: Partial<{ planCurrency: string; weightOverride: number | null; excluded: boolean }> = {}) => ({ clientId, planMonthly, planCurrency: "usd", weightOverride: null, excluded: false, ...extra });
const CAP = 1000;

test("the cap is split by plan price; excluded and unpriced clients get nothing", () => {
  const b = monthBudget({ cap: CAP, clients: [client("a", 300), client("b", 100), client("c", null), client("d", 500, { excluded: true })], overrides: new Map(), spent: new Map() });
  assert.deepEqual(b.clients.map((c) => [c.clientId, c.allocation]), [["a", 750], ["b", 250], ["c", 0], ["d", 0]]);
  assert.equal(b.allocated, CAP);
  assert.equal(weightOf(client("g", 100, { planCurrency: "GBP" })), 127, "GBP put on the USD scale, as a weight");
});

test("a front-loading override is fixed and the rest share what is left; it never fits past the cap", () => {
  const overrides = new Map([["a", 600]]);
  const b = monthBudget({ cap: CAP, clients: [client("a", 300), client("b", 100), client("c", 100)], overrides, spent: new Map([["b", 250]]) });
  assert.deepEqual(b.clients.map((c) => [c.clientId, c.allocation, c.breach]), [["a", 600, false], ["b", 200, true], ["c", 200, false]]);
  assert.match(b.warnings.join(" "), /b: \$250 spent against a \$200 allocation/);
  assert.deepEqual(checkOverride({ cap: CAP, clientId: "b", amount: 400, overrides }), { ok: true });
  assert.equal(checkOverride({ cap: CAP, clientId: "b", amount: 401, overrides }).ok, false);
  assert.equal(checkOverride({ cap: null, clientId: "b", amount: 1, overrides }).ok, false, "no cap set, no override");
});

test("spend against the cap in total, and a warning before an item that would breach", () => {
  const b = monthBudget({ cap: CAP, clients: [client("a", 100), client("b", 100)], overrides: new Map(), spent: new Map([["a", 400], ["b", 450]]) });
  assert.equal(b.spent, 850);
  assert.equal(b.remaining, 150);
  assert.deepEqual(wouldBreach(b, "a", 200), ["takes this client to $600 against a $500 allocation", "takes the month to $1050 against the $1000 cap"]);
  assert.deepEqual(wouldBreach(b, "a", 50), []);
  assert.equal(monthBudget({ cap: null, clients: [client("a", 100)], overrides: new Map(), spent: new Map() }).warnings[0], "The global placement cap is not set, so nothing is allocated.");
});
