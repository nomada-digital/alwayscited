import assert from "node:assert/strict";
import { test } from "node:test";

import { bestTarget, pathScore, sitemapLocs } from "./target-suggest.ts";

// Made-up sites: the shapes MOR's and Volunteero's had on 11 Nov 2026, not their pages.
const site = (paths: string[]) => paths.map((p) => ({ url: `https://www.example.com${p}`, source: "sitemap" as const }));

test("the page whose address carries the keyword's words wins, shallowest first", () => {
  const s = bestTarget("household staff agency", [...site(["/about", "/household-staff/butler", "/household-staff", "/blog/hiring-a-chef"]), { url: "https://example.com/", source: "homepage" }]);
  assert.equal(s?.url, "https://www.example.com/household-staff");
  assert.match(s!.why, /67% of the keyword's words/);
  assert.equal(pathScore("https://example.com/staff-agencies", "staff agency"), 1, "plural and singular match");
});

test("a page Google ranks wins a tie; nothing matching falls back to the ranking page, then the homepage, said so", () => {
  const r = bestTarget("volunteer software", [...site(["/volunteer-software-guide"]), { url: "https://www.example.com/volunteer-software", source: "ranking", position: 7 }]);
  assert.equal(r?.url, "https://www.example.com/volunteer-software");
  assert.match(r!.why, /#7/);
  assert.equal(bestTarget("craft cms agency", [{ url: "https://example.com/work", source: "ranking", position: 12 }])?.url, "https://example.com/work");
  const home = bestTarget("craft cms agency", [...site(["/about", "/contact"]), { url: "https://example.com/", source: "homepage" }]);
  assert.equal(home?.url, "https://example.com/");
  assert.match(home!.why, /nothing on the site matches/);
  assert.equal(bestTarget("x", []), null);
});

test("sitemap addresses are read from <loc>, entities decoded, capped", () => {
  assert.deepEqual(sitemapLocs("<urlset><url><loc> https://a.com/x?a=1&amp;b=2 </loc></url><url><loc>https://a.com/y</loc></url></urlset>"), ["https://a.com/x?a=1&b=2", "https://a.com/y"]);
  assert.equal(sitemapLocs("<loc>a</loc><loc>b</loc><loc>c</loc>", 2).length, 2);
});
