import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";

import { accessFrom, codeOf, filterNames } from "./access.ts";
import { type SerpRow, basisLine, deriveSet, needsFallback, pageOnePlaces } from "./comparison-set.ts";
import { gapCount, gapRead, gapRows, listCount, pairRows, pairsOf, roughly, shownGap, unionRows } from "./gap.ts";
import { NONE_PLACED, type Placed, excludePlacedDomains, isPlacedUrl, onPlacedDomain } from "./nomada-placements.ts";
import { pageKeyOf, planReveal, targetCount, targetRead, targetRows, unrevealed } from "./targets.ts";
import type { GapDomain, GapPage } from "./types.ts";

/**
 * Links' rules (13 Oct 2026, DIY P10; spec 10 sections 2.5, 4.8 and 6.3):
 * the comparison set, the gap, the targets and their reveal, access, and
 * Nomada's placements subtracted from all of them. Pure, so each runs here.
 */

const TODAY = "2026-10-13";
const THREE = ["ledgerline.com", "brightbook.example", "countwise.example"];
const PLACED: Placed = { domains: new Set(["softwarecritic.com", "accountsweekly.example"]), keys: new Set(["thesmallbizstack.com/placed-page"]) };

// ---- the comparison set ----

const serp = (keyword: string, day: string, hosts: string[]): SerpRow => ({ keyword_id: keyword, run_date: day, top: hosts.map((h, i) => ({ rank: i + 1, domain: h, url: `https://${h}/p` })) });
const kinds = (m: Record<string, string | null>) => new Map(Object.entries(m).map(([d, t]) => [`d:${d}`, t]));

test("page-1 places: one a keyword held on page 1 in the 28 days, however many days, rank 10 or better, live cluster keywords only", () => {
  const rows = [
    serp("k1", "2026-10-12", ["ledgerline.com", "ledgerline.com", "brightbook.example"]),
    serp("k1", "2026-10-11", ["brightbook.example", "ledgerline.com"]),
    serp("k2", "2026-10-12", ["ledgerline.com"]),
    serp("k9", "2026-10-12", ["countwise.example"]),
    serp("k1", "2026-09-01", ["countwise.example"]),
    { keyword_id: "k2", run_date: "2026-10-10", top: [{ rank: 11, domain: "countwise.example" }] },
  ];
  const p = pageOnePlaces(rows, new Set(["k1", "k2"]), TODAY);
  // 13 Oct 2026, review of DIY P10: places are keywords, not keyword-days, so "page-1 places for your keywords: N" counts keywords.
  assert.deepEqual(p.get("ledgerline.com"), { places: 2, avg: 1.3 }, "k1 on two days and k2 on one are two places; two of its pages on one page of results are one");
  assert.deepEqual(p.get("brightbook.example"), { places: 1, avg: 2 }, "k1 on two days is one place");
  assert.equal(p.get("countwise.example"), undefined, "a stopped keyword, an old day and #11 are not counted");
});

test("the set: vendor-typed only, an unclassified domain held back, ties to the better average, the client and placements left out", () => {
  const places = new Map([
    ["ledgerline.com", { places: 14, avg: 4.2 }],
    ["thesmallbizstack.com", { places: 20, avg: 2 }],
    ["shopify-like.example", { places: 18, avg: 3 }],
    ["brightbook.example", { places: 11, avg: 5.6 }],
    ["countwise.example", { places: 11, avg: 4.9 }],
    ["sumly.example", { places: 9, avg: 6 }],
    ["tallyroo.com", { places: 30, avg: 1 }],
    ["softwarecritic.com", { places: 25, avg: 1 }],
  ]);
  const k = kinds({ "ledgerline.com": "vendor", "thesmallbizstack.com": "publisher", "shopify-like.example": null, "brightbook.example": "vendor", "countwise.example": "vendor", "sumly.example": "vendor", "softwarecritic.com": "vendor" });
  const set = deriveSet({ client: "www.tallyroo.com", month: "2026-10-01", today: TODAY, places, kinds: k, placed: PLACED });
  assert.deepEqual(set.domains, ["ledgerline.com", "countwise.example", "brightbook.example"], "countwise beats brightbook on the tie by its better average");
  assert.deepEqual(set.waiting, ["shopify-like.example"], "the unclassified page-1 holder waits, never used (fail closed)");
  assert.deepEqual(set.basis["ledgerline.com"], { from: "page1", places: 14, avg: 4.2 });
  assert.ok(!set.domains.includes("tallyroo.com") && !set.domains.includes("softwarecritic.com"), "never the client, never a placed domain");
  assert.equal(needsFallback(set), false);
  assert.equal(basisLine(set), "Compared with ledgerline.com, countwise.example and brightbook.example: the vendor sites holding the most page-1 places for your keywords this month (derived 13 Oct).");
});

test("fewer than 3: Labs first, then backlinks competitors, vendor-typed only, each with its own basis; a fallback is never called a page-1 holder", () => {
  const places = new Map([["ledgerline.com", { places: 14, avg: 4.2 }]]);
  const k = kinds({ "ledgerline.com": "vendor", "sumly.example": "vendor", "newsdesk.example": "publisher", "countwise.example": "vendor", "unknown.example": null });
  const set = deriveSet({
    client: "tallyroo.com",
    month: "2026-10-01",
    today: TODAY,
    places,
    kinds: k,
    placed: NONE_PLACED,
    labs: [{ domain: "newsdesk.example", shares: 900 }, { domain: "sumly.example", shares: 212 }, { domain: "unknown.example", shares: 400 }],
    backlinks: [{ domain: "countwise.example", shares: 41 }, { domain: "sumly.example", shares: 10 }],
  });
  assert.deepEqual(set.domains, ["ledgerline.com", "sumly.example", "countwise.example"], "Labs before backlinks; the publisher and the unclassified one skipped");
  assert.deepEqual(set.basis["sumly.example"], { from: "labs", shares: 212 });
  assert.deepEqual(set.basis["countwise.example"], { from: "backlinks", shares: 41 });
  assert.deepEqual(set.waitingFallback, ["unknown.example"]);
  assert.equal(needsFallback(set), true);
  const line = basisLine(set);
  assert.equal(line, "Compared with ledgerline.com (page-1 places for your keywords: 14), sumly.example (shares 212 keywords with you, DataForSEO estimate) and countwise.example (shares 41 backlink intersections with you, DataForSEO estimate). Derived 13 Oct.");
  assert.doesNotMatch(line.replace(/ledgerline\.com \([^)]*\)/, ""), /page-1/, "only the page-1 domain is said to hold page-1 places");
  const two = deriveSet({ client: "tallyroo.com", month: "2026-10-01", today: TODAY, places, kinds: k, placed: NONE_PLACED, labs: [{ domain: "sumly.example", shares: 212 }] });
  assert.equal(two.domains.length, 2, "fewer than 3 stays fewer: nothing is made up to fill it");
});

// ---- Nomada's placements ----

test("placements: a domain, its subdomains and a placed page are subtracted; nothing else is", () => {
  assert.ok(onPlacedDomain("www.softwarecritic.com", PLACED));
  assert.ok(onPlacedDomain("blog.accountsweekly.example", PLACED));
  assert.ok(!onPlacedDomain("notaccountsweekly.example", PLACED), "a suffix is not a subdomain");
  assert.ok(isPlacedUrl("https://thesmallbizstack.com/placed-page/", PLACED));
  assert.ok(!isPlacedUrl("https://thesmallbizstack.com/other", PLACED));
  const rows = [{ domain: "softwarecritic.com" }, { domain: "ledgerline.com" }, { domain: "thesmallbizstack.com", url: "https://thesmallbizstack.com/placed-page" }];
  assert.deepEqual(excludePlacedDomains(rows, PLACED), [{ domain: "ledgerline.com" }]);
  const named = [{ host: "www.softwarecritic.com", page: null }, { host: "ok.example", page: "https://thesmallbizstack.com/placed-page" }, { host: "ok.example", page: "https://ok.example/x" }];
  assert.deepEqual(excludePlacedDomains(named, PLACED, (r) => ({ domain: r.host, url: r.page })), [named[2]], "a row naming its domain and page otherwise");
});

test("one subtraction: every Links module subtracts Nomada's placements through excludePlacedDomains, never the predicates on their own", () => {
  // 13 Oct 2026, review of DIY P10: the spec's entry point was exported and never called, while each list called the predicates itself.
  const dir = new URL(".", import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith(".ts") && f !== "nomada-placements.ts");
  assert.ok(files.length >= 15, `only ${files.length} modules read - the sweep has gone blind`);
  const strays = files.filter((f) => /\b(onPlacedDomain|isPlacedUrl)\(/.test(readFileSync(new URL(f, dir), "utf8")));
  assert.deepEqual(strays, []);
  const users = files.filter((f) => /\bexcludePlacedDomains\(/.test(readFileSync(new URL(f, dir), "utf8")));
  assert.deepEqual(users.sort(), ["candidates.ts", "comparison-set.ts", "gap.ts", "mentions.ts", "targets.ts", "view.ts", "weekly.job.ts"]);
});

// ---- the gap ----

const g = (domain: string, linksTo: string[], rank: number | null): GapDomain => ({ domain, linksTo, rank, firstSeen: "2025-01-01" });

test("the gap from the filter: n >= 2 only, never the client, a compared site or a placed domain, sorted 3 then 2 then rank", () => {
  const rows = gapRows(
    [
      [
        g("a.example", THREE.slice(0, 2), 100),
        g("b.example", THREE, 50),
        g("c.example", [THREE[0]!], 900),
        g("softwarecritic.com", THREE, 999),
        g("ledgerline.com", THREE.slice(1), 400),
        g(["blog", "tallyroo.com"].join("."), THREE, 400),
        g("d.example", THREE.slice(0, 2), 300),
        g("e.example", THREE.slice(1), null),
      ],
    ],
    { client: "tallyroo.com", targets: THREE, placed: PLACED },
  );
  assert.deepEqual(rows.map((r) => [r.domain, r.linksTo.length]), [
    ["b.example", 3],
    ["d.example", 2],
    ["a.example", 2],
    ["e.example", 2],
  ]);
});

test("the pairwise fallback: three pairs of three, and their union is the n >= 2 set with each domain's sites", () => {
  assert.deepEqual(pairsOf(THREE), [
    [THREE[0], THREE[1]],
    [THREE[0], THREE[2]],
    [THREE[1], THREE[2]],
  ]);
  const union = unionRows([[g("x.example", [THREE[0]!, THREE[1]!], 10)], [g("x.example", [THREE[0]!, THREE[2]!], 30), g("y.example", [THREE[0]!, THREE[2]!], 5)], [g("y.example", [THREE[1]!, THREE[2]!], 7)]]);
  assert.deepEqual(
    union.map((r) => [r.domain, [...r.linksTo].sort(), r.rank]),
    [
      ["x.example", [...THREE].sort(), 30],
      ["y.example", [...THREE].sort(), 7],
    ],
  );
});

test("a pairwise read keeps only rows linking to both of its pair, so a partial answer never adds up to n >= 2", () => {
  const pair = [THREE[0]!, THREE[1]!] as const;
  assert.deepEqual(pairRows([g("both.example", [THREE[0]!, THREE[1]!], 1), g("one.example", [THREE[0]!], 2)], pair).map((r) => r.domain), ["both.example"]);
});

test("the gap shows its top 25 (10 in the trial), and the rest are a count after the subtraction - exact only when every row was read", () => {
  const rows = Array.from({ length: 74 }, (_, i) => g(`s${i}.example`, THREE.slice(0, 2), 500 - i));
  rows.push(g("softwarecritic.com", THREE, 900), g("accountsweekly.example", THREE, 800));
  const got = gapRead([rows], { client: "tallyroo.com", targets: THREE, placed: PLACED });
  assert.deepEqual([got.rows.length, got.seen], [74, 76], "76 met n >= 2; 74 after the subtraction");
  const whole = listCount([{ rows: 76, total: 76 }], got.seen, 100);
  assert.deepEqual(whole, { read: 76, total: 76, capped: false });
  const { shown, limit } = shownGap(got.rows, { trial: false });
  assert.deepEqual([shown.length, limit], [25, 25]);
  assert.deepEqual(gapCount({ kept: got.rows.length, shown: shown.length, count: whole, via: "filter" }), { more: 49, hedge: "exact" });
  assert.deepEqual(gapCount({ kept: got.rows.length, shown: 10, count: whole, via: "filter" }), { more: 64, hedge: "exact" }, "the trial's 10");
});

test("a capped read: DataForSEO's total, less what the read showed was taken out, worded as its estimate - never the rows read as if they were all", () => {
  // 13 Oct 2026, review of DIY P10: "75 more sites" came from a read capped at 100 when the set ran to thousands.
  const capped = listCount([{ rows: 100, total: 1937 }], 100, 100);
  assert.deepEqual(capped, { read: 100, total: 1937, capped: true });
  // 2 of the 100 read were placements: 1937 - 2 = 1935 in the set; 25 shown; about 1,910 more, to the nearest 100 past 1,000.
  assert.deepEqual(gapCount({ kept: 98, shown: 25, count: capped, via: "filter" }), { more: 1900, hedge: "about" });
  // The pairwise reads' total is one pair's: the union is at least that, so the words are "at least", rounded down.
  const pairs = listCount([{ rows: 100, total: 640 }, { rows: 100, total: 410 }, { rows: 37, total: 37 }], 205, 100);
  assert.deepEqual(pairs, { read: 205, total: 640, capped: true });
  assert.deepEqual(gapCount({ kept: 203, shown: 25, count: pairs, via: "pairwise" }), { more: 610, hedge: "at_least" });
  // No total sent, but a full 100: a floor of what is left of the rows read.
  assert.deepEqual(gapCount({ kept: 98, shown: 25, count: listCount([{ rows: 100, total: null }], 100, 100), via: "filter" }), { more: 73, hedge: "at_least" });
  assert.deepEqual(listCount([{ rows: 40, total: null }], 40, 100).capped, false, "fewer than the limit with no total: all read");
  assert.equal(roughly(1873, "about"), 1900);
  assert.equal(roughly(1873, "at_least"), 1800, "a floor stays a floor");
  assert.equal(roughly(87, "about"), 87);
});

// ---- the targets and the reveal ----

const page = (url: string, links: string[], pageRank: number): GapPage => ({ urlFrom: url, title: url, domain: new URL(url).hostname, links: links.map((t) => ({ target: t, urlTo: `https://${t}/`, anchor: t })), pageRank, firstSeen: "2026-01-01" });

test("the targets: followed in-article links to the compared sites, nothing on the client, a compared site or a placement; sorted", () => {
  const rows = targetRows(
    [
      page("https://one.example/a", [THREE[0]!], 300),
      page("https://two.example/b", THREE, 100),
      page("https://softwarecritic.com/accounting", THREE, 999),
      page("https://thesmallbizstack.com/placed-page", THREE, 999),
      page("https://ledgerline.com/blog/x", [THREE[1]!], 999),
      page("https://three.example/c", [THREE[0]!], 500),
      page("https://four.example/d", ["elsewhere.example"], 999),
    ],
    { client: "tallyroo.com", targets: THREE, placed: PLACED },
  );
  assert.deepEqual(rows.map((r) => r.urlFrom), ["https://two.example/b", "https://three.example/c", "https://one.example/a"]);
});

test("the reveal: the next 5 in order (2 in the trial), idempotent on the month's count, kept across months, refused at the cap", () => {
  const rows = Array.from({ length: 12 }, (_, i) => page(`https://p${String(i).padStart(2, "0")}.example/x`, [THREE[0]!], 900 - i));
  const earlier = new Set(rows.slice(0, 5).map(pageKeyOf));
  const first = planReveal({ rows, revealed: earlier, usedThisMonth: 0, seen: 0, client: { trial: false } });
  assert.ok(first.ok);
  assert.deepEqual(first.ok && first.pages.map((p) => p.urlFrom), rows.slice(5, 10).map((r) => r.urlFrom), "last month's reveals are kept and skipped; the next 5 in order");
  assert.deepEqual(planReveal({ rows, revealed: earlier, usedThisMonth: 5, seen: 0, client: { trial: false } }), { ok: false, why: "stale" }, "the same form sent twice reveals nothing more");
  assert.deepEqual(planReveal({ rows, revealed: earlier, usedThisMonth: 0, seen: null, client: { trial: false } }), { ok: false, why: "stale" });
  assert.deepEqual(planReveal({ rows, revealed: earlier, usedThisMonth: 5, seen: 5, client: { trial: false } }), { ok: false, why: "cap" });
  const trial = planReveal({ rows, revealed: new Set(), usedThisMonth: 0, seen: 0, client: { trial: true } });
  assert.equal(trial.ok && trial.pages.length, 2, "2 a month in the trial");
  const late = planReveal({ rows, revealed: new Set(), usedThisMonth: 1, seen: 1, client: { trial: true } });
  assert.equal(late.ok && late.pages.length, 1, "only what the month has left");
  assert.deepEqual(planReveal({ rows: rows.slice(0, 5), revealed: earlier, usedThisMonth: 0, seen: 0, client: { trial: false } }), { ok: false, why: "none" });
  assert.equal(unrevealed(rows, earlier), 7);
});

test("the targets' count: exact when every page was read; capped, DataForSEO's total less what was taken out and revealed, 'about' - and the reveal and U5 count only pages read", () => {
  const read = targetRead(
    [page("https://one.example/a", [THREE[0]!], 300), page("https://softwarecritic.com/x", [THREE[0]!], 900), page("https://two.example/b", [THREE[0]!], 200)],
    { client: "tallyroo.com", targets: THREE, placed: PLACED },
  );
  assert.deepEqual([read.rows.length, read.seen], [2, 3]);
  assert.deepEqual(targetCount({ kept: 2, unrevealedRead: 1, count: { read: 3, total: 3, capped: false } }), { more: 1, hedge: "exact" });
  // 412 in DataForSEO's count, 1 of the 3 read a placement, 1 revealed: about 410.
  assert.deepEqual(targetCount({ kept: 2, unrevealedRead: 1, count: { read: 3, total: 412, capped: true } }), { more: 410, hedge: "about" });
  assert.deepEqual(targetCount({ kept: 2, unrevealedRead: 1, count: { read: 3, total: null, capped: true } }), { more: 1, hedge: "at_least" });
});

// ---- access ----

test("access is read from the latest paid Backlinks call: not read before the first, inactive only from an access code", () => {
  assert.deepEqual(accessFrom(null), { state: "not_read", at: null, code: null });
  assert.equal(accessFrom({ status: "ok", code: null, created_at: "x" }).state, "active");
  assert.equal(accessFrom({ status: "partial", code: null, created_at: "x" }).state, "active");
  assert.deepEqual(accessFrom({ status: "failed", code: "task 40204 access denied. visit plans and subscriptions to activate your subscripti", created_at: "x" }), { state: "inactive", at: "x", code: 40204 });
  assert.equal(accessFrom({ status: "failed", code: "DataForSEO returned no task (40204 access denied. visit plans and subscriptions", created_at: "x" }).state, "inactive", "the top-level refusal reads the same");
  assert.equal(accessFrom({ status: "failed", code: "HTTP 401", created_at: "x" }).state, "inactive");
  assert.equal(accessFrom({ status: "failed", code: "task 40210 insufficient funds.", created_at: "x" }).state, "inactive");
  assert.equal(accessFrom({ status: "failed", code: "timeout", created_at: "x" }).state, "failed", "a timeout is not an access refusal");
  assert.equal(accessFrom({ status: "failed", code: "task 50000 Internal Error.", created_at: "x" }).state, "failed");
  assert.deepEqual(codeOf("HTTP 403"), { task: null, http: 403 });
});

test("the free probe only names filters; it never says whether access is active", () => {
  assert.deepEqual(filterNames({ groups: { domain_intersection: ["$key.target", "intersections_count"], backlinks: ["dofollow"] } }), { read: true, intersectionsCount: true });
  assert.deepEqual(filterNames({ groups: { backlinks: ["dofollow"] } }), { read: true, intersectionsCount: false });
  assert.deepEqual(filterNames(null), { read: false, intersectionsCount: false });
  assert.ok(!("state" in filterNames({ groups: {} })), "the probe's answer carries no access state");
});
