import assert from "node:assert/strict";
import { test } from "node:test";

import { isServiceCategory, judgedTopic, notACompetitor } from "./competitor-filter.ts";

test("5 Nov 2026: the keyword's own product and, for a service, the platforms are never competitors", () => {
  const common = ["craft cms agency"];
  for (const n of ["Craft CMS", "Craft", "WordPress", "Shopify", "HubSpot", "Sanity"]) assert.equal(notACompetitor(n, common), true, n);
  for (const n of ["Engage", "Mud", "Abstrakt", "webdna", "Honcho"]) assert.equal(notACompetitor(n, common), false, n);
  // A product category keeps its platforms: an ecommerce platform's rival is Shopify.
  assert.equal(notACompetitor("Shopify", ["ecommerce platform"]), false);
  assert.equal(notACompetitor("Shopify", [null, "", "seo agency"]), true);
  assert.ok(isServiceCategory("b2b seo agencies") && isServiceCategory("fractional cpo services") && !isServiceCategory("home espresso machines"));
});

test("5 Nov 2026: a client selling a tool as well keeps the tools as competitors (alwayscited)", () => {
  const ac = ["ai seo agency", "ai visibility tracker", "best ai rank tracker"];
  for (const n of ["Semrush", "Ahrefs", "Profound"]) assert.equal(notACompetitor(n, ac), false, n);
  assert.equal(judgedTopic(["AI SEO agency", "ai seo agency", null, " ai rank tracker "]), "ai seo agency; ai rank tracker");
});
