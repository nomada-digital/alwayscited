import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { cleanCandidate } from "../plan/refresh.ts";
import { type GatherInput, pageCandidates } from "./candidates.ts";
import { found, keyPage, ownCheck, readings, serp } from "./fake-pages.mts";
import { type PagesFixture, botOf, checkOf, fixtureSerp, latestTop, topOf } from "./data.ts";
import { keyPageOf } from "./key-pages.ts";
import type { BotCheck } from "./types.ts";

/**
 * Your pages' Actions candidates (13 Oct 2026, DIY P8; spec 10 section 6.1):
 * Blocking only for a crawler with a verified source that serves search or
 * answers, and for a page not fit to index on two weekly reads running;
 * Closest win routed by the page's fit; Tidy-up for a schema error or a
 * homepage with no Organization. Every candidate passes P3's own cleaning.
 */

const ROOT = join(fileURLToPath(import.meta.url), "..", "..", "..", "..", "..");
const PAGE = "https://tallyroo.com/cloud";
const days = (n: number, pos: number | null, url: string | null) => Array.from({ length: n }, () => [pos, url] as [number | null, string | null]);
const bot = (crawlers: BotCheck["crawlers"]): BotCheck => ({ id: "b", checkedAt: "2026-09-23T03:41:00Z", robotsStatus: 200, crawlers, hosts: [], llmsTxtStatus: 404, pages: [] });
const cloud = keyPage({ id: "kp-8", url: PAGE, clusterIds: ["c8"] });
const base = (over: Partial<GatherInput> = {}): GatherInput => ({
  domain: "tallyroo.com",
  keyPages: [cloud],
  checks: [ownCheck(cloud, "2026-09-16"), ownCheck(cloud, "2026-09-23")],
  bots: [],
  top: [],
  serp: [serp("k8", readings("2026-09-29", days(28, 14, PAGE)), ["https://ledgerline.com/cloud", "https://brightbook.example/features/cloud"])],
  clusters: [{ id: "c8", name: "cloud accounting software", keywordId: "k8", stoppedOn: null }],
  keywords: [{ id: "k8", keyword: "cloud accounting software", volume: 5400 }],
  today: "2026-09-29",
  ...over,
});

test("Blocking: Googlebot blocked from a key page raises one, sourced S41; GPTBot and Google-Extended blocked raise none", () => {
  const c = pageCandidates(
    base({
      bots: [
        bot([
          { name: "Googlebot", state: "partial", inherited: false, line: "Disallow: /cloud", blocked: ["/cloud"] },
          { name: "GPTBot", state: "blocked", inherited: false, line: "Disallow: /", blocked: ["/cloud"] },
          { name: "Google-Extended", state: "blocked", inherited: false, line: "Disallow: /", blocked: ["/cloud"] },
        ]),
      ],
    }),
    "2026-09-29",
  );
  const blocking = c.filter((x) => x.severity === "blocking");
  assert.deepEqual(blocking.map((x) => [x.kind, x.dedupeKey, x.grade, x.sourceId, x.title]), [["unblock_crawler", "pages:crawler:googlebot", "documented", "S41", "Let Googlebot crawl tallyroo.com/cloud"]]);
  assert.match(blocking[0]!.why[0]!.text, /robots.txt line 'Disallow: \/cloud' blocks Googlebot from 1 key page of 1 \(checked 23 Sep\)\./);
});

test("Blocking: a page not fit to index on its last two weekly reads, not on one", () => {
  const twice = base({ checks: [ownCheck(cloud, "2026-09-16", { status: "unreadable", httpStatus: 404, basics: null }), ownCheck(cloud, "2026-09-23", { status: "unreadable", httpStatus: 404, basics: null })] });
  assert.deepEqual(pageCandidates(twice, "2026-09-29").filter((x) => x.severity === "blocking").map((x) => [x.kind, x.title]), [["fix_page_status", "Fix tallyroo.com/cloud: it answers HTTP 404"]]);
  const once = base({ checks: [ownCheck(cloud, "2026-09-16"), ownCheck(cloud, "2026-09-23", { status: "unreadable", httpStatus: 404, basics: null })] });
  assert.equal(pageCandidates(once, "2026-09-29").filter((x) => x.severity === "blocking").length, 0, "glimpsed, not held");
});

test("Closest win, routed by fit: Fits sends to the best-of lists; a different page type reworks the page; two pages take turns resolves the split; 1-3 is not a closest win", () => {
  const fits = pageCandidates(base(), "2026-09-29").find((x) => x.severity === "closest")!;
  assert.deepEqual([fits.kind, fits.title, fits.href, fits.volume], ["get_onto_page", "Get onto the best-of lists ranking for 'cloud accounting software'", "/opportunities?lens=lists&cluster=c8", 5400]);
  const lists = Array.from({ length: 8 }, (_, i) => `https://list-${i}.example/best-cloud-accounting-software`);
  const different = pageCandidates(base({ serp: [serp("k8", readings("2026-09-29", days(28, 14, PAGE)), lists)] }), "2026-09-29").find((x) => x.severity === "closest")!;
  assert.deepEqual([different.kind, different.href], ["rework_page", "/pages/kp-8?tab=fit&cluster=c8"]);
  const split = pageCandidates(base({ serp: [serp("k8", readings("2026-09-29", days(28, 14, PAGE).map((d, i) => (i % 2 ? [14, "https://tallyroo.com/features/cloud"] : d))))] }), "2026-09-29").find((x) => x.severity === "closest")!;
  assert.equal(split.kind, "resolve_split");
  assert.equal(pageCandidates(base({ serp: [serp("k8", readings("2026-09-29", days(28, 2, PAGE)))] }), "2026-09-29").filter((x) => x.severity === "closest").length, 0);
});

test("Closest win: a page that is not the one ranking raises none - the homepage is never sent to the best-of lists for another URL's keyword", () => {
  // The review's case (13 Oct 2026): the cluster's ranking URL is not a key page, so the homepage serves it.
  const home = keyPage({ id: "kp-1", url: "https://tallyroo.com/", origin: "homepage" });
  const elsewhere = base({ keyPages: [home], checks: [ownCheck(home, "2026-09-16", { schemaFound: found([["Organization"], ["name", "url", "logo", "sameAs"]], [["WebSite"], ["name", "url"]]) }), ownCheck(home, "2026-09-23", { schemaFound: found([["Organization"], ["name", "url", "logo", "sameAs"]], [["WebSite"], ["name", "url"]]) })], serp: [serp("k8", readings("2026-09-29", days(28, 14, "https://tallyroo.com/blog/payroll-guide")), ["https://ledgerline.com/cloud"])] });
  assert.deepEqual(pageCandidates(elsewhere, "2026-09-29"), []);
});

// 19 Oct 2026: "one Closest win per cluster: 'Add to Actions' on a drafted example..." is retired: its subject,
// pages/act.ts (the old /app Pages screen's Add to Actions), was deleted with that dashboard (commit 78b1023).

test("Blocking, judged by each page's own host: a key page on a subdomain is read against that subdomain's robots.txt, never the domain's", () => {
  // A made-up client on a .example domain, so its subdomain is one too (privacy.test.mts).
  const domain = "tallyroo.example";
  const apexPage = keyPage({ id: "kp-8", url: "https://tallyroo.example/cloud" });
  const guide = keyPage({ id: "kp-12", url: "https://blog.tallyroo.example/guide" });
  const g = base({
    domain,
    keyPages: [apexPage, guide],
    checks: [ownCheck(apexPage, "2026-09-23"), ownCheck(guide, "2026-09-23")],
    serp: [],
    bots: [{ ...bot([{ name: "Googlebot", state: "allowed", inherited: false, line: null, blocked: [] }]), hosts: [{ host: "blog.tallyroo.example", robotsStatus: 200, crawlers: [{ name: "Googlebot", state: "blocked", inherited: true, line: "Disallow: /guide", blocked: ["/guide"] }] }] }],
  });
  const blocking = pageCandidates(g, "2026-09-29").filter((x) => x.severity === "blocking");
  assert.deepEqual(blocking.map((x) => [x.title, x.ref?.id]), [["Let Googlebot crawl blog.tallyroo.example/guide", "kp-12"]]);
  // The domain's file blocking /guide says nothing about blog.tallyroo.example/guide.
  const apex = base({ domain, serp: [], keyPages: [apexPage, guide], checks: [ownCheck(apexPage, "2026-09-23"), ownCheck(guide, "2026-09-23")], bots: [bot([{ name: "Googlebot", state: "partial", inherited: false, line: "Disallow: /guide", blocked: ["/guide"] }])] });
  assert.equal(pageCandidates(apex, "2026-09-29").filter((x) => x.severity === "blocking").length, 0);
});

test("Tidy-up: a homepage with no Organization, and a page the validator found errors on", () => {
  const home = keyPage({ id: "kp-1", url: "https://tallyroo.com/", origin: "homepage" });
  const deep = { ...ownCheck(home, "2026-09-10"), via: "instant_pages" as const, schemaResults: { summary: { fatal: 0, error: 1, warning: 0, info: 0 }, items: [{ types: ["WebSite"], props: [], results: [{ level: "error" as const, message: "x" }] }] } };
  const c = pageCandidates(base({ keyPages: [home], checks: [ownCheck(home, "2026-09-23", { schemaFound: found([["WebSite"], ["name", "url"]]) }), deep], serp: [] }), "2026-09-29");
  assert.deepEqual(c.filter((x) => x.severity === "tidy").map((x) => [x.kind, x.dedupeKey, x.grade]), [
    ["add_schema", "pages:schema:Organization:kp-1", "documented"],
    ["fix_schema", "pages:schema:errors:kp-1", "your_data"],
  ]);
});

test("on the fixture's full state, every candidate is one P3 stores, each dedupe key once", () => {
  const f = (JSON.parse(readFileSync(join(ROOT, "src/lib/diy/fixtures/pages.json"), "utf8")) as { full: PagesFixture }).full;
  const fx = JSON.parse(readFileSync(join(ROOT, "src/lib/tracking/fixture.json"), "utf8"));
  const clusters = fx.data.clusters.map((c: Record<string, string | null>) => ({ id: c.id, name: c.name, keywordId: c.keyword_id, stoppedOn: c.stopped_on }));
  const keywords = fx.data.keywords.map((k: Record<string, string | number>) => ({ id: k.id, keyword: k.keyword, volume: k.search_volume }));
  const input: GatherInput = {
    domain: "tallyroo.com",
    keyPages: f.keyPages.map(keyPageOf).filter((k) => k !== null),
    checks: f.checks.map(checkOf).filter((c) => c !== null),
    bots: f.bots.map(botOf).filter((b) => b !== null).sort((a, b) => (a.checkedAt < b.checkedAt ? 1 : -1)),
    top: latestTop(f.top.map(topOf).filter((t) => t !== null)),
    serp: fixtureSerp(f, keywords.map((k: { id: string }) => k.id)),
    clusters,
    keywords,
    today: "2026-09-29",
  };
  const c = pageCandidates(input, "2026-09-29");
  assert.ok(c.length >= 8, `${c.length} candidates`);
  assert.equal(new Set(c.map((x) => x.dedupeKey)).size, c.length);
  for (const x of c) assert.ok(cleanCandidate(x), `${x.dedupeKey} is one P3 stores`);
  assert.ok(c.some((x) => x.dedupeKey === "pages:crawler:googlebot"));
  assert.ok(c.some((x) => x.kind === "fix_page_status" && x.ref?.id === "kp-5"), "the 404 on /expenses, held over two reads");
});
