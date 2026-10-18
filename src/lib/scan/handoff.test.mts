import assert from "node:assert/strict";
import { test } from "node:test";

import { handoffMarket, scanRef } from "./handoff.ts";

test("a hand-off ref is a short lowercase code or nothing (18 Oct 2026)", () => {
  assert.equal(scanRef("nomada"), "nomada");
  assert.equal(scanRef(" Nomada "), "nomada", "trimmed and lowercased");
  assert.equal(scanRef("partner_2-uk"), "partner_2-uk");
  assert.equal(scanRef("a".repeat(32)), "a".repeat(32));
  assert.equal(scanRef("a".repeat(33)), null, "capped at 32");
  assert.equal(scanRef("-nomada"), null, "starts with a letter or digit");
  assert.equal(scanRef("nomada<script>"), null);
  assert.equal(scanRef("no mada"), null);
  assert.equal(scanRef(""), null);
  assert.equal(scanRef(undefined), null);
  assert.equal(scanRef(["nomada"]), null);
});

test("a hand-off market is UK or US in any case, else no choice", () => {
  assert.equal(handoffMarket("uk"), "UK");
  assert.equal(handoffMarket("US"), "US");
  assert.equal(handoffMarket(" Us "), "US");
  assert.equal(handoffMarket("gb"), null);
  assert.equal(handoffMarket("UK; drop"), null);
  assert.equal(handoffMarket(undefined), null);
});
