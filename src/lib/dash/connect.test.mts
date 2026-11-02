import assert from "node:assert/strict";
import { test } from "node:test";

import { ACCESS_EMAIL, CONNECTOR, STALE_MS, bareDomain, candidates, gaPropertyId, queryRows, staleLine, windsorVisible, windsorWhy } from "./connect.ts";

/** Connect your data (2 Nov 2026, sg-37): what Check connection looks for and what it makes of Windsor's answer. */

test("the bare domain, from whatever the client row or Windsor holds", () => {
  assert.equal(bareDomain("https://www.Example.com/shop?x=1"), "example.com");
  assert.equal(bareDomain("sc-domain:example.com"), "example.com");
  assert.equal(bareDomain("example.com."), "example.com");
});

test("candidates: a domain property first for Search Console, then the four prefixes; Bing has no domain property", () => {
  assert.deepEqual(candidates("gsc", "www.example.com"), ["sc-domain:example.com", "https://example.com/", "https://www.example.com/", "http://example.com/", "http://www.example.com/"]);
  assert.deepEqual(candidates("bing", "example.com"), ["https://example.com/", "https://www.example.com/", "http://example.com/", "http://www.example.com/"]);
  assert.deepEqual(candidates("ga4", "example.com", "312345678"), ["312345678"]);
  assert.deepEqual(candidates("ga4", "example.com", null), []);
});

test("a GA4 property id is digits; a measurement id is refused", () => {
  assert.equal(gaPropertyId(" 312345678 "), "312345678");
  assert.equal(gaPropertyId("properties/312345678"), "312345678");
  assert.equal(gaPropertyId("G-ABC123XYZ"), null);
  assert.equal(gaPropertyId(""), null);
});

test("Windsor's answer: data (even empty) is visible, an error is not", () => {
  assert.equal(windsorVisible({ data: [{ account_id: "x" }] }), true);
  assert.equal(windsorVisible({ data: [] }), true);
  assert.equal(windsorVisible({ error: "Account sc-domain:x.com is not available. The configured accounts are: ..." }), false);
  assert.equal(windsorVisible(null), false);
  assert.equal(windsorWhy({ error: "bad key k3y" }, "k3y"), "bad key ***");
});

test("query rows: summed per query and page, CTR from the sums, position weighted by impressions, biggest first", () => {
  const rows = queryRows({
    clientId: "c1", provider: "gsc", from: "2026-10-04", to: "2026-10-31", cap: 2,
    rows: [
      { query: "llm visibility", page: "/a", clicks: 1, impressions: 10, position: 4 },
      { query: "llm visibility", page: "/a", clicks: 1, impressions: 30, position: 8 },
      { query: "ai seo", page: "/b", clicks: 0, impressions: 5, position: 20 },
      { query: "", page: "/c", clicks: 9, impressions: 99 },
      { query: "tiny", page: "/d", clicks: 0, impressions: 1, position: 50 },
    ],
  });
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { client_domain_id: "c1", provider: "gsc", period_start: "2026-10-04", period_end: "2026-10-31", query: "llm visibility", page: "/a", clicks: 2, impressions: 40, ctr: 0.05, position: 7 });
  assert.equal(rows[1].query, "ai seo");
  const bing = queryRows({ clientId: "c1", provider: "bing", from: "a", to: "b", rows: [{ query: "q", clicks: 1, impressions: 2 }] });
  assert.equal(bing[0].page, "");
  assert.equal(bing[0].position, null);
});

test("the 24 hour line: only customers past a day and not connected, naming the property", () => {
  const now = Date.parse("2026-11-03T05:00:00Z");
  const at = (h: number) => new Date(now - h * 3600000).toISOString();
  const line = staleLine([
    { domain: "a.com", provider: "gsc", property: null, requested_at: at(25), status: "pending" },
    { domain: "b.com", provider: "ga4", property: "312345678", requested_at: at(50), status: "pending" },
    { domain: "c.com", provider: "bing", property: null, requested_at: at(3), status: "pending" },
    { domain: "d.com", provider: "gsc", property: "sc-domain:d.com", requested_at: at(80), status: "connected" },
  ], now);
  assert.ok(line);
  assert.match(line!, /after a day \(2\)/);
  assert.match(line!, /- a\.com: Search Console, waiting 1 day$/m);
  assert.match(line!, /- b\.com: GA4 \(312345678\), waiting 2 days/);
  assert.doesNotMatch(line!, /c\.com|d\.com/);
  assert.ok(line!.includes(ACCESS_EMAIL));
  assert.equal(staleLine([], now), null);
  assert.equal(STALE_MS, 86400000);
});

test("the three connectors are the ones Windsor names", () => {
  assert.deepEqual(CONNECTOR, { gsc: "searchconsole", ga4: "googleanalytics4", bing: "bing_webmaster" });
});
