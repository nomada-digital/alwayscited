import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { actCandidate } from "./act.ts";
import { type PagesFixture, botOf, checkOf, exampleOf, fixtureSerp, lastNightFailed, latestTop, topOf } from "./data.ts";
import { exampleState } from "./example.ts";
import { keyPageOf } from "./key-pages.ts";
import { pagesAction, pagePath, pagesPath, readBack } from "./paths.ts";
import { pagesToast } from "./toast.ts";
import { type PagesInput, basicsTab, fitTab, listRows, pageState, servedClusters, siteStrip } from "./view.ts";
import { raisesBlocking } from "./robots.ts";

/**
 * Your pages' fixture (13 Oct 2026, DIY P8; spec 10 section 7.9, the fixture
 * states) read through the package's own mappers and views: what each state
 * must show, held here so the e2e spec and the screens show what the spec
 * asks of them. Plus the route's words and addresses.
 */

const ROOT = join(fileURLToPath(import.meta.url), "..", "..", "..", "..", "..");
const file = JSON.parse(readFileSync(join(ROOT, "src/lib/diy/fixtures/pages.json"), "utf8")) as Record<string, PagesFixture>;
const fx = JSON.parse(readFileSync(join(ROOT, "src/lib/tracking/fixture.json"), "utf8"));
const NOW = Date.parse(`${fx.today}T12:00:00Z`);

function inputOf(f: PagesFixture): PagesInput {
  const keywords = fx.data.keywords.map((k: Record<string, string | number>) => ({ id: String(k.id), keyword: String(k.keyword), volume: Number(k.search_volume) }));
  return {
    domain: fx.client.domain,
    keyPages: f.keyPages.map(keyPageOf).filter((k) => k !== null),
    checks: f.checks.map(checkOf).filter((c) => c !== null),
    bots: f.bots.map(botOf).filter((b) => b !== null).sort((a, b) => (a.checkedAt < b.checkedAt ? 1 : -1)),
    examples: f.examples.map(exampleOf).filter((e) => e !== null),
    top: latestTop(f.top.map(topOf).filter((t) => t !== null)),
    serp: fixtureSerp(f, keywords.map((k: { id: string }) => k.id)),
    clusters: fx.data.clusters.map((c: Record<string, string | null>) => ({ id: String(c.id), name: String(c.name), keywordId: c.keyword_id, stoppedOn: c.stopped_on })),
    keywords,
    prompts: fx.data.questions.map((q: Record<string, string | null>) => ({ id: String(q.id), text: String(q.text), clusterId: q.cluster_id, stoppedOn: q.stopped_on })),
    cited: new Map(),
    items: [],
    today: fx.today,
  };
}

test("full: 10 key pages, mixed schema, one unreadable, one 404, one JS-only, one Fits at #14, Googlebot blocked from one page and GPTBot from all", () => {
  const input = inputOf(file.full!);
  const rows = listRows(input);
  assert.equal(rows.length, 10);
  const by = Object.fromEntries(rows.map((r) => [r.path, r]));
  assert.equal(by["/contractors"]!.access.label, "HTTP 403");
  assert.equal(by["/contractors"]!.schema.label, "Not checked", "unreadable is never 'no schema'");
  assert.equal(by["/expenses"]!.access.label, "HTTP 404");
  assert.equal(by["/small-business"]!.schema.label, "Missing Product");
  assert.equal(by["/"]!.schema.label, "1 error");
  assert.equal(by["/pricing"]!.access.label, "Blocked for Googlebot");
  assert.deepEqual([by["/cloud"]!.fit.label, by["/cloud"]!.position?.position], ["Fits", 14]);
  const js = basicsTab(pageState(input.keyPages.find((k) => k.id === "kp-10")!, input))!;
  assert.equal(js.words.jsOnly, true);
  const site = siteStrip(input, rows, raisesBlocking);
  assert.deepEqual(site.access, { line: "1 search crawler blocked", tone: "bad" });
  assert.deepEqual(site.checked, { n: 8, of: 10, last: "2026-09-23" });
  const crawlers = input.bots[0]!.crawlers;
  assert.equal(crawlers.find((c) => c.name === "GPTBot")!.state, "blocked");
  assert.equal(crawlers.find((c) => c.name === "Googlebot")!.state, "partial");
  const cloud = input.keyPages.find((k) => k.id === "kp-8")!;
  const fit = fitTab(pageState(cloud, input), input)[0]!;
  assert.deepEqual(fit.verdict, { kind: "fits", offPage1: 28, readings: 28 });
  assert.ok(fit.diagnostics && fit.top.length === 3, "the top 3's structure is read in full");
});

test("full: one example ready, one pending two minutes, one pending twenty minutes read as failed, one failed", () => {
  const ex = file.full!.examples.map(exampleOf).filter((e) => e !== null);
  assert.deepEqual(
    ex.map((e) => [e.urlKey, exampleState(e, NOW)]),
    [
      ["tallyroo.com/cloud", "ready"],
      ["tallyroo.com/bookkeeping", "pending"],
      ["tallyroo.com/invoicing", "failed"],
      ["tallyroo.com/small-business", "failed"],
    ],
  );
});

test("dark: our own reads only - no validator, no JavaScript read, no example, no top results' structure; day0: nothing read", () => {
  const dark = file.dark!;
  assert.ok(dark.checks.every((c) => c.via === "own"));
  assert.deepEqual([dark.examples.length, dark.top.length], [0, 0]);
  assert.equal(dark.keyPages.length, file.full!.keyPages.length);
  const day0 = file.day0!;
  assert.deepEqual([day0.keyPages.length, day0.checks.length, day0.bots.length], [0, 0, 0]);
  assert.equal(file.capped, undefined, "capped reads full: its examples are used up in core.json's counts");
  assert.equal(lastNightFailed(inputOf(file.full!).keyPages.length ? [{ kind: "key_pages_weekly", outcome: "ok", dueOn: "2026-09-23", doneAt: null }] : []), false);
});

test("the homepage serves the clusters no other key page holds, and is judged only where it is the page that ranks", () => {
  const input = inputOf(file.full!);
  const home = input.keyPages.find((k) => k.origin === "homepage")!;
  assert.deepEqual(servedClusters(home, input).map((c) => c.id), ["c9", "c10"]);
  // c10 ranks with /blog/payroll-guide, which a member removed: the homepage is not read against it (13 Oct 2026, DIY P8 review).
  const fits = fitTab(pageState(home, input), input);
  assert.deepEqual(fits.map((f) => [f.cluster.id, f.verdict.kind]), [["c9", "out"], ["c10", "elsewhere"]]);
  assert.equal(listRows(input).find((r) => r.page.id === "kp-1")!.fit.label, "Not in the top 20");
});

test("Add to Actions: the fix as add_schema or fix_schema by whether a block is there; the example as rework_page; anything else refused", () => {
  const input = inputOf(file.full!);
  const home = input.keyPages.find((k) => k.id === "kp-1")!;
  const s = pageState(home, input);
  const org = actCandidate({ page: home, state: s, item: "schema:Organization", served: servedClusters(home, input), keywords: input.keywords, domain: "tallyroo.com" })!;
  assert.deepEqual([org.kind, org.dedupeKey, org.title, org.grade, org.sourceId], ["fix_schema", "pages:schema:Organization:kp-1", "Fix the Organization schema on tallyroo.com", "documented", "G3"]);
  const site = actCandidate({ page: home, state: s, item: "schema:WebSite", served: [], keywords: input.keywords, domain: "tallyroo.com" })!;
  assert.equal(site.kind, "add_schema");
  const cloud = input.keyPages.find((k) => k.id === "kp-8")!;
  const rw = actCandidate({ page: cloud, state: pageState(cloud, input), item: "rework:c8", served: servedClusters(cloud, input), keywords: input.keywords, domain: "tallyroo.com" })!;
  assert.deepEqual([rw.kind, rw.title, rw.href], ["rework_page", "Rework tallyroo.com/cloud for 'cloud accounting software'", "/pages/kp-8?tab=fit&cluster=c8"]);
  assert.equal(actCandidate({ page: cloud, state: pageState(cloud, input), item: "rework:c1", served: servedClusters(cloud, input), keywords: input.keywords, domain: "tallyroo.com" }), null, "a cluster the page does not serve");
  assert.equal(actCandidate({ page: home, state: s, item: "drop table", served: [], keywords: [], domain: "tallyroo.com" }), null);
});

test("the site strip says 'search' only for a crawler with a verified source; any other blocked crawler is a crawler, nothing more", () => {
  const input = inputOf(file.full!);
  const rows = listRows(input);
  const gptOnly = { ...input, bots: [{ ...input.bots[0]!, crawlers: input.bots[0]!.crawlers.map((c) => (c.name === "Googlebot" ? { ...c, state: "allowed" as const, line: null, blocked: [] } : c)) }] };
  assert.deepEqual(siteStrip(gptOnly, rows, raisesBlocking).access, { line: "1 crawler blocked", tone: "warn" }, "GPTBot: no verified source says what it is for");
  const bingToo = { ...gptOnly, bots: [{ ...gptOnly.bots[0]!, crawlers: gptOnly.bots[0]!.crawlers.map((c) => (c.name === "Bingbot" ? { ...c, state: "blocked" as const } : c)) }] };
  assert.deepEqual(siteStrip(bingToo, rows, raisesBlocking).access, { line: "2 crawlers blocked", tone: "warn" }, "Bingbot is not called an AI crawler, or a search one, without its source");
});

test("another client's placement is taken out of the top 3 before it is drawn, counted or handed to the example", () => {
  const input = inputOf(file.full!);
  const cloud = input.keyPages.find((k) => k.id === "kp-8")!;
  const before = fitTab(pageState(cloud, input), input)[0]!;
  const placedKey = before.top[0]!.urlKey;
  const placed = { ...input, placed: new Set([placedKey]) };
  const after = fitTab(pageState(cloud, placed), placed)[0]!;
  assert.ok(!after.top.some((t) => t.urlKey === placedKey));
  assert.equal(after.top.length, 2, "nothing stands in for it: the next result was not read as one of the 3");
  assert.ok(after.diagnostics!.every((d) => d.top.length === 2), "nor is it a column of the diagnostics");
});

test("a key page we could not read: the crawlers view says Not read for its noindex and canonical", () => {
  const input = inputOf(file.full!);
  const pages = input.bots[0]!.pages;
  assert.deepEqual(pages.find((p) => p.urlKey === "tallyroo.com/expenses"), { urlKey: "tallyroo.com/expenses", status: 404, noindex: null, canonicalElsewhere: null });
  assert.deepEqual(pages.find((p) => p.urlKey === "tallyroo.com/contractors"), { urlKey: "tallyroo.com/contractors", status: 403, noindex: null, canonicalElsewhere: null });
  assert.equal(pages.find((p) => p.urlKey === "tallyroo.com/cloud")!.noindex, false);
});

test("the route's words: fixed per code, a refusal's words from caps.ts, and nothing for an unknown code", () => {
  const p = { resets: "1 Oct", examplesLine: "You've used this month's 10 examples. They reset on 1 Oct.", checksLine: null };
  assert.equal(pagesToast("added", null, p), "Added. We read it now and again with your other key pages each week.");
  assert.equal(pagesToast("refused", "not_own", p), "That address isn't on your own domain, so it can't be a key page.");
  assert.equal(pagesToast("refused", "examples_out", p), "You've used this month's 10 examples. They reset on 1 Oct.");
  assert.equal(pagesToast("refused", "checks_out", p), "This month's research is used. It resets on 1 Oct.", "an uncounted allowance still says when it resets, never a number");
  assert.equal(pagesToast("refused", "tracking_running", p), "Your daily check is running. Try again in a few minutes.");
  assert.equal(pagesToast("checked_own", null, p), "We read your page; the JavaScript read didn't finish. It didn't use a check.", "a failed JavaScript read is never 'up to date'");
  assert.equal(pagesToast("refused", "elsewhere", p), "Another of your pages is the one that ranks for this keyword. Ask for the example on that page.");
  assert.equal(pagesToast("refused", "<script>", p), null);
  assert.equal(pagesToast("hacked", null, p), null);
});

test("the addresses: the list and a page keep only their own keys, and the route's way back is whitelisted", () => {
  assert.equal(pagesPath("tallyroo", { view: "bots" }), "/app/tallyroo/pages?view=bots");
  assert.equal(pagesPath("tallyroo", { view: "pages", issue: "fit" }, "#add"), "/app/tallyroo/pages?issue=fit#add");
  assert.equal(pagePath("tallyroo", "kp-8", { tab: "fit", cluster: "c8" }), "/app/tallyroo/pages/kp-8?tab=fit&cluster=c8");
  assert.equal(pagePath("tallyroo", "kp-8", { tab: "schema" }), "/app/tallyroo/pages/kp-8");
  assert.equal(pagesAction("tallyroo", { page: "kp-8", tab: "fit", cluster: "c8" }), "/api/app/tallyroo/pages?back=page&page=kp-8&tab=fit&cluster=c8");
  assert.deepEqual(readBack(new URLSearchParams("back=page&page=kp-8&tab=fit&cluster=c8")), { page: "kp-8", tab: "fit", cluster: "c8" });
  assert.deepEqual(readBack(new URLSearchParams("back=page&page=../x&tab=evil")), {});
  assert.deepEqual(readBack(new URLSearchParams("view=bots&issue=nope")), { view: "bots" });
});
