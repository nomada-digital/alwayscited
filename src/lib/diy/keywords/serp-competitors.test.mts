import assert from "node:assert/strict";
import { test } from "node:test";

import { isOwn, isPlacedDomain, pageOne, parseTop, placedHosts, serpCompetitors } from "./serp-competitors.ts";

/**
 * Who holds Google's page 1 for the client's keywords (13 Oct 2026, DIY P6;
 * spec 10 section 4.3 rows 5 and 7), from `tracking_serp.top`. Facts only;
 * other clients' placed pages are left out with no label (spec 2.3).
 */

const hit = (rank: number, domain: string, path = `/p${rank}`) => ({ rank, domain, url: `https://${domain}${path}` });

test("a stored top is read strictly: rank, domain and URL only, rank order, www dropped, junk left out", () => {
  assert.equal(parseTop(null), null, "a row from before MS-1");
  assert.deepEqual(parseTop([{ rank: 2, domain: "WWW.Ledgerline.com", url: "https://ledgerline.com/a", sponsored: true }, { rank: 1, domain: "softwarecritic.com", url: "javascript:alert(1)" }, { rank: "3", domain: "x.example" }, { rank: 4 }]), [
    { rank: 1, domain: "softwarecritic.com", url: null },
    { rank: 2, domain: "ledgerline.com", url: "https://ledgerline.com/a" },
  ]);
});

test("page 1 is ranks 1-10, less any page where Nomada has placed another client - a list of pages, subtracted by page", () => {
  const top = [hit(1, "ledgerline.com"), hit(2, "softwarecritic.com", "/best-bookkeeping-software"), hit(3, "tallyroo.com"), hit(4, "softwarecritic.com", "/another-review"), hit(11, "late.example")];
  const one = pageOne(top, new Set(["softwarecritic.com/best-bookkeeping-software"]));
  // Drawn in this order without rank numbers (TrackedTable), so the page left out leaves no numbered gap.
  assert.deepEqual(one.map((h) => h.domain), ["ledgerline.com", "tallyroo.com", "softwarecritic.com"]);
});

// 13 Oct 2026 (review of the P6 handoff): a list of domains is subtracted by domain. Leaving softwarecritic.com listed
// with its count less the placed page still named it, with a count Google does not show; it is now left out whole.
test("sites by keywords held on page 1 at each keyword's latest reading, once per keyword at its best rank; the client, its subdomains and every domain holding another client's placed page left out", () => {
  const got = serpCompetitors(
    [
      { keywordId: "k1", day: "2026-10-13", top: [hit(1, "ledgerline.com"), hit(2, "tallyroo.com"), hit(5, "ledgerline.com", "/two"), hit(7, "softwarecritic.com")] },
      { keywordId: "k2", day: "2026-10-13", top: [hit(3, "ledgerline.com"), hit(4, "www.tallyroo.com"), hit(9, "softwarecritic.com"), hit(12, "thesmallbizstack.com")] },
      { keywordId: "k3", day: "2026-10-12", top: [hit(2, "softwarecritic.com", "/best-bookkeeping-software"), hit(6, "thesmallbizstack.com")] },
    ],
    "tallyroo.com",
    new Set(["softwarecritic.com/best-bookkeeping-software"]),
  );
  assert.deepEqual(got.rows, [
    { domain: "ledgerline.com", keywords: 2, avg: 2 },
    { domain: "thesmallbizstack.com", keywords: 1, avg: 6 },
  ]);
  assert.deepEqual([...placedHosts(new Set(["www.softwarecritic.com/best", "ownerledger.co/guides/x", "nohost"]))].sort(), ["ownerledger.co", "softwarecritic.com"]);
  assert.ok(isPlacedDomain("reviews.placed.example", new Set(["placed.example"])) && !isPlacedDomain("notplaced.example", new Set(["placed.example"])));
  assert.equal(got.read, 3);
  assert.equal(got.latest, "2026-10-13");
  assert.equal(got.mixed, true);
  assert.ok(isOwn("blog.tallyroo.example", "tallyroo.example") && !isOwn("nottallyroo.example", "tallyroo.example"));
});

test("the top 10 sites only, ties to the better average, then the name", () => {
  const top = Array.from({ length: 12 }, (_, i) => hit(1 + (i % 10), `site${String(i).padStart(2, "0")}.example`));
  const got = serpCompetitors([{ keywordId: "k1", day: "2026-10-13", top }], "tallyroo.com", new Set());
  assert.equal(got.rows.length, 10);
  assert.deepEqual(got.rows.slice(0, 2).map((r) => r.domain), ["site00.example", "site10.example"]);
});
