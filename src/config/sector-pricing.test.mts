// Section 2 of docs/pricing-spec-2026-09-27.md (R50, 27 Sep 2026): the file's
// shape, and the rules the front end prices by.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { fromLabel, fromPrice, MARKETS, MAX_CLUSTERS, quoteFor, SECTORS } from "./sector-pricing.ts";

const raw = JSON.parse(readFileSync(new URL("./sector-prices.json", import.meta.url), "utf8"));

// 21 sectors, not 19: "Business, marketing and legal" split into business,
// marketing and legal when Danny regenerated the file (28 Sep 2026, R80).
// 22 from 15 Nov 2026: "Funeral and end-of-life" added for the Dignity proposal
// (sector-pricing-source.ts says how it was priced). Pending Danny's yes.
test("the file carries 21 priced sectors and other, which is a call", () => {
  assert.equal(SECTORS.length, 22);
  assert.equal(SECTORS.filter((s) => s.prices).length, 21);
  const other = SECTORS.find((s) => s.id === "other");
  assert.ok(other && other.prices === null && other.label === "Other");
});

test("every priced figure is whole, positive and ends in 95; currencies match markets", () => {
  let n = 0;
  for (const s of SECTORS) {
    if (!s.prices) continue;
    assert.equal(s.prices.us.currency, "USD");
    assert.equal(s.prices.uk.currency, "GBP");
    for (const m of MARKETS) for (const t of ["mentioned", "cited"] as const) {
      const v = s.prices[m][t];
      assert.ok(Number.isInteger(v) && v > 0 && v % 100 === 95, `${s.id}.${m}.${t} = ${v}`);
      n++;
    }
  }
  assert.equal(n, 84);
});

test("US leads: the first market is us, in the module and in every entry of the file", () => {
  assert.deepEqual(MARKETS, ["us", "uk"]);
  for (const [id, e] of Object.entries(raw)) assert.deepEqual(Object.keys(e as object).slice(1, 3), ["us", "uk"], id);
});

test("price times quantity, no discount, 1 to 10; 0, 11 and fractions are a call", () => {
  const s = SECTORS.find((x) => x.prices)!;
  for (let q = 1; q <= MAX_CLUSTERS; q++) {
    assert.deepEqual(quoteFor(s.id, "us", "cited", q), { kind: "price", amount: s.prices!.us.cited * q, market: "us" });
  }
  for (const q of [0, 11, 1.5, -1]) assert.deepEqual(quoteFor(s.id, "uk", "mentioned", q), { kind: "call" });
  assert.deepEqual(quoteFor("other", "us", "cited", 1), { kind: "call" });
  assert.deepEqual(quoteFor("no-such-sector", "us", "cited", 1), { kind: "call" });
});

test("the from is the true minimum across priced sectors, and is buyable", () => {
  for (const m of MARKETS) for (const t of ["mentioned", "cited"] as const) {
    const all = SECTORS.flatMap((s) => (s.prices ? [s.prices[m][t]] : []));
    const from = fromPrice(t, m);
    assert.equal(from, Math.min(...all));
    assert.ok(SECTORS.some((s) => s.prices && quoteFor(s.id, m, t, 1).kind === "price" && s.prices[m][t] === from));
  }
  assert.match(fromLabel("mentioned"), /^from \$[\d,]+\/mo$/);
  assert.match(fromLabel("cited", "uk"), /^from £[\d,]+\/mo$/);
});
