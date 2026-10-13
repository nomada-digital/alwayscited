import assert from "node:assert/strict";
import { test } from "node:test";

import { isOwn, pageOne, parseTop, serpCompetitors } from "./serp-competitors.ts";

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

test("page 1 is ranks 1-10, less any page where Nomada has placed another client; ranks are not renumbered", () => {
  const top = [hit(1, "ledgerline.com"), hit(2, "softwarecritic.com", "/best-bookkeeping-software"), hit(3, "tallyroo.com"), hit(11, "late.example")];
  const one = pageOne(top, new Set(["softwarecritic.com/best-bookkeeping-software"]));
  assert.deepEqual(one.map((h) => h.rank), [1, 3]);
});

test("sites by keywords held on page 1 at each keyword's latest reading, once per keyword at its best rank; the client and its subdomains left out", () => {
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
    { domain: "softwarecritic.com", keywords: 2, avg: 8 },
    { domain: "thesmallbizstack.com", keywords: 1, avg: 6 },
  ]);
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
