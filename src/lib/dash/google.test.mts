import assert from "node:assert/strict";
import { test } from "node:test";

import { GOOGLE_ACCESS_EMAIL, backfillStart, canSubmit, ga4Day, ga4Rows, gscDailyRows, gscQueryPageRows, gscUsersLink, lastFinalDay, monthWindows, pickable, sitemapFor } from "./google.ts";

test("the address is the hub's service account", () => {
  assert.match(GOOGLE_ACCESS_EMAIL, /^nomada-hub-mail@[a-z0-9-]+\.iam\.gserviceaccount\.com$/);
});

test("the Search Console link opens the property's users page when we know it, else the picker", () => {
  assert.equal(gscUsersLink("sc-domain:volunteero.org"), "https://search.google.com/search-console/users?resource_id=sc-domain%3Avolunteero.org");
  assert.equal(gscUsersLink(null), "https://search.google.com/search-console/users");
});

test("a sitemap submit needs Full or Owner; Restricted reads only", () => {
  assert.equal(canSubmit("siteFullUser"), true);
  assert.equal(canSubmit("siteOwner"), true);
  assert.equal(canSubmit("siteRestrictedUser"), false);
  assert.equal(canSubmit(null), false);
  assert.equal(sitemapFor("sc-domain:example.com"), "https://example.com/sitemap.xml");
  assert.equal(sitemapFor("https://www.example.com/"), "https://www.example.com/sitemap.xml");
});

test("16 calendar months on the first pull, two after; the last window stops at the last final day", () => {
  const end = lastFinalDay(Date.parse("2026-11-15T09:00:00Z"));
  assert.equal(end, "2026-11-13");
  const w = monthWindows(end, 16);
  assert.equal(w.length, 16);
  assert.deepEqual(w[0], { start: "2025-08-01", end: "2025-08-31" });
  assert.deepEqual(w.at(-1), { start: "2026-11-01", end: "2026-11-13" });
  assert.equal(backfillStart(end), "2025-08-01");
  assert.deepEqual(monthWindows("2026-03-02", 2), [{ start: "2026-02-01", end: "2026-02-28" }, { start: "2026-03-01", end: "2026-03-02" }]);
});

test("Google's rows become ours", () => {
  assert.deepEqual(gscDailyRows("c", [{ keys: ["2026-11-01"], clicks: 3, impressions: 120, ctr: 0.025, position: 14.37 }, { keys: ["bad"] }]), [{ client_domain_id: "c", day: "2026-11-01", clicks: 3, impressions: 120, ctr: 0.025, position: 14.37 }]);
  assert.deepEqual(gscQueryPageRows([{ keys: ["funeral plans", "https://x/"], clicks: 1, impressions: 9, position: 7 }]), [{ query: "funeral plans", page: "https://x/", clicks: 1, impressions: 9, position: 7 }]);
  assert.deepEqual(ga4Rows({ dimensionHeaders: [{ name: "date" }], metricHeaders: [{ name: "sessions" }], rows: [{ dimensionValues: [{ value: "20261101" }], metricValues: [{ value: "42" }] }] }), [{ date: "20261101", sessions: 42 }]);
  assert.equal(ga4Day("20261101"), "2026-11-01");
  assert.equal(ga4Day("x"), null);
});

test("only a property the service account listed for this domain can be picked", () => {
  const listed = [{ id: "sc-domain:volunteero.org" }, { id: "properties/123456" }];
  assert.equal(pickable("gsc", "sc-domain:volunteero.org", listed), true);
  assert.equal(pickable("gsc", "sc-domain:someone-else.com", listed), false);
  assert.equal(pickable("ga4", "properties/123456", listed), true);
  assert.equal(pickable("ga4", "sc-domain:volunteero.org", listed), false);
});
