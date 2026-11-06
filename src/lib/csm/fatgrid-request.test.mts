import assert from "node:assert/strict";
import { test } from "node:test";

import { capFrom, FATGRID_DEFAULTS } from "../../config/csm.ts";
import { PAGE_MAX, UnitBudget, errorSnippet, inventoryQuery, priceFor, readListing, readPage, searchBatch } from "./fatgrid-request.ts";

test("a read never asks for more domains than the budget has left, and stops at zero", () => {
  const b = new UnitBudget(50);
  assert.equal(inventoryQuery({ offerType: "guest_post", minDr: 61.4 }, 1, b.left)!.get("limit"), "50");
  assert.equal(inventoryQuery({ offerType: "guest_post" }, 1, 9999)!.get("limit"), String(PAGE_MAX));
  b.spend(50);
  assert.equal(b.left, 0);
  assert.equal(inventoryQuery({ offerType: "guest_post" }, 2, b.left), null, "no budget, no request");
  const q = inventoryQuery({ offerType: "link_insertion", minDr: 61.4, minTraffic: 5000, maxPrice: 500, databases: ["uk"] }, 3, 10)!;
  assert.deepEqual(Object.fromEntries(q), { type: "domains_list", page: "3", limit: "10", offerType: "link_insertion", linkFollow: "dofollow", sponsored: "false", minDr: "61", minTotalOrganicTraffic: "5000", maxPrice: "500", databases: "uk" });
});

test("a domain batch is normalised, deduplicated and cut to the budget", () => {
  assert.deepEqual(searchBatch(["https://www.Example.com/x", "example.com", "b.co.uk", "c.io"], 2), ["example.com", "b.co.uk"]);
});

test("a response item keeps only what the shortlist uses; prices and DRs are numbers or null", () => {
  const l = readListing({ url: "https://www.host.example/", dr: "64", totalOrganicTraffic: 12000, bestPrice: "180", resources: [{ type: "guest_post", price: 220 }, { type: "link_insertion", price: "150" }, { type: "other", price: 1 }], categories: ["Business"], secretField: "x" })!;
  assert.equal(l.domain, "host.example");
  assert.equal(l.dr, 64);
  assert.equal(priceFor(l, "link_insertion"), 150);
  assert.equal(priceFor(l, "guest_post"), 220);
  assert.equal("secretField" in l, false);
  assert.equal(readListing({ dr: 50 }), null, "no url, no listing");
  assert.deepEqual(readPage({ items: [{ url: "a.example" }, null], hasMore: true }).listings.map((x) => x.domain), ["a.example"]);
});

test("a cap from the environment is a positive integer or the default, never no cap", () => {
  for (const raw of [undefined, "", "0", "-5", "abc", "2.5"]) assert.equal(capFrom(raw, FATGRID_DEFAULTS.unitCapPerRun), FATGRID_DEFAULTS.unitCapPerRun, String(raw));
  assert.equal(capFrom("400", 50), 400);
});

test("a refusal's body is logged as one short line with the key cut out", () => {
  assert.equal(errorSnippet('{"error":"Insufficient units"}\n', "k-123"), '{"error":"Insufficient units"}');
  assert.equal(errorSnippet("bad key k-123 in ?key=k-123", "k-123"), "bad key [key] in ?key=[key]");
  assert.equal(errorSnippet("x".repeat(300), "k-123"), `${"x".repeat(200)}...`);
  assert.equal(errorSnippet("  a \n\t b  ", ""), "a b");
});
