import assert from "node:assert/strict";
import { test } from "node:test";

import { chosenTarget, targetLabel } from "./target.ts";

const row = (url: string, o: Partial<{ origin: string; cluster_ids: string[]; added_on: string; removed_on: string | null }> = {}) => ({ url, origin: "member", cluster_ids: ["c1"], added_on: "2026-10-18", removed_on: null, ...o });

test("a cluster's target page is the newest live member key page that lists it", () => {
  const pages = [row("https://a.com/old", { added_on: "2026-10-01" }), row("https://a.com/new"), row("https://a.com/ranked", { origin: "ranking" }), row("https://a.com/gone", { added_on: "2026-10-30", removed_on: "2026-10-31" }), row("https://a.com/other", { cluster_ids: ["c2"] })];
  assert.equal(chosenTarget(pages, "c1"), "https://a.com/new");
  assert.equal(chosenTarget(pages, "c2"), "https://a.com/other");
  assert.equal(chosenTarget(pages, "c3"), null);
  assert.equal(chosenTarget([row("https://a.com/x", { origin: "homepage" })], "c1"), null, "an automatic page is never a chosen target");
});

test("a target page is shown without scheme, www or trailing slash", () => {
  assert.equal(targetLabel("https://www.nomadadigital.co.uk/blog/best-seo-agency-for-b2b"), "nomadadigital.co.uk/blog/best-seo-agency-for-b2b");
  assert.equal(targetLabel("https://alwayscited.com/"), "alwayscited.com");
});
