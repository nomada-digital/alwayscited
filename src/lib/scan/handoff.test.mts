import assert from "node:assert/strict";
import { test } from "node:test";

import { cleanUtm, handoffMarket, handoffMayStart, scanRef } from "./handoff.ts";

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

/**
 * The gate on the one GET that can start a paid scan (19 Oct 2026): a known partner AND that partner's own Referer.
 * Each refusal below is the only thing between a crawler, or a link pasted elsewhere, and a scan.
 */
test("only a known partner's own Referer may start a scan on arrival", () => {
  assert.equal(handoffMayStart("nomada", "https://nomadadigital.co.uk/"), true);
  assert.equal(handoffMayStart("nomada", "https://www.nomadadigital.co.uk/international-seo"), true);
  for (const referer of [null, undefined, "", "not a url", "https://alwayscited.com/", "https://nomadadigital.co.uk.evil.com/", "https://evil.com/?nomadadigital.co.uk"]) {
    assert.equal(handoffMayStart("nomada", referer), false, String(referer));
  }
  assert.equal(handoffMayStart(null, "https://nomadadigital.co.uk/"), false);
  assert.equal(handoffMayStart("someone-else", "https://nomadadigital.co.uk/"), false);
  assert.equal(handoffMayStart("constructor", "https://nomadadigital.co.uk/"), false);
});

test("UTMs are kept by name, trimmed and capped; nothing else rides along", () => {
  assert.deepEqual(cleanUtm({ utm_source: " linkedin ", utm_campaign: ["q4", "x"], utm_medium: "", gclid: "abc", domain: "x.com" }), {
    utm_source: "linkedin",
    utm_campaign: "q4",
  });
  assert.equal(cleanUtm({ utm_term: "x".repeat(500) })?.utm_term?.length, 200);
  assert.equal(cleanUtm({ utm_source: 5, other: "y" }), null);
  assert.equal(cleanUtm(null), null);
  assert.equal(cleanUtm("utm_source=x"), null);
});
