/**
 * DIY P6 (13 Oct 2026; spec 10 sections 4.3, 4.10, 4.12, 6.6 and 7.7): the
 * Google page, gaining ground and its Track and Dismiss, the All view, the
 * "who holds page 1" expander, Clusters' Suggested clusters and Setup's
 * suggested keywords, on the tracking fixture with DIY_FIXTURE_STATE and the
 * package's own src/lib/diy/fixtures/keywords.json - served in-process on the
 * build, as diy-plan.spec.mts serves it, on one port of P6's (3650 unless
 * E2E_PORT says otherwise).
 *
 * Holds what section 7.0 item 7 asks of every DIY spec: axe finds no serious
 * or critical violation; no sideways page scroll at 390 and 320; every write
 * form works with JS off (a 303 and its toast); a viewer sees the controls
 * disabled with the reason; every evidence link resolves. And the package's
 * own, from section 7.7: the Tracked view, gaining ground expanded, the All
 * view's search, intent and band filters and paging, the expander, Track
 * landing on Clusters with the panel open and prefilled and the added
 * cluster's prompts carrying the Momentum chip, dismiss with JS off, the
 * dark state, setup suggestions and the 390 cards.
 *
 * Saves each page's screens to test-results/diy/p6/<page>-<state>-<width>.png
 * (1280x900 and 390x844) and its HTML to test-results/diy/p6/<page>-<state>.html,
 * the Google pages' for the gating census (section 6.10 item 2: a saved file
 * named `google-...`). Not committed.
 *
 *   npm run build && E2E_PORT=3650 node --test e2e/app/diy-google.spec.mts
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const OUT = path.join(ROOT, "test-results", "diy", "p6");
const require = createRequire(path.join(os.homedir(), "code/.parity/package.json"));
type Locator = {
  click(): Promise<void>;
  count(): Promise<number>;
  first(): Locator;
  nth(i: number): Locator;
  innerText(): Promise<string>;
  inputValue(): Promise<string>;
  isDisabled(): Promise<boolean>;
  getAttribute(name: string): Promise<string | null>;
  locator(sel: string): Locator;
};
type Page = {
  goto(url: string, o?: object): Promise<{ status(): number } | null>;
  locator(sel: string): Locator;
  waitForURL(url: RegExp, o?: object): Promise<void>;
  evaluate<R>(fn: () => R | Promise<R>): Promise<R>;
  evaluate<R, A>(fn: (a: A) => R | Promise<R>, a: A): Promise<R>;
  addScriptTag(o: { content: string }): Promise<unknown>;
  screenshot(o: { path: string; fullPage?: boolean }): Promise<unknown>;
  setViewportSize(s: { width: number; height: number }): Promise<void>;
  content(): Promise<string>;
  url(): string;
};
type Context = { newPage(): Promise<Page>; close(): Promise<void> };
type Browser = { newContext(o: object): Promise<Context>; close(): Promise<void> };
const { chromium } = require("playwright") as { chromium: { launch(): Promise<Browser> } };
const AXE = readFileSync(path.join(ROOT, "node_modules", "axe-core", "axe.min.js"), "utf8");

const PORT = Number(process.env.E2E_PORT ?? 3650);
const BASE = `http://localhost:${PORT}`;
const APP = "/app/tallyroo";
const GOOGLE = `${APP}/google`;

let server: Server | null = null;
let browser: Browser;

before(async () => {
  process.env.TRACKING_FIXTURE = "1";
  process.env.VERCEL_ENV = "development";
  as("default");
  const { default: next } = await import("next");
  const app = next({ dev: false, dir: ROOT, hostname: "localhost", port: PORT });
  await app.prepare();
  const handle = app.getRequestHandler();
  server = createServer((req, res) => handle(req, res));
  await new Promise<void>((resolve) => server!.listen(PORT, () => resolve()));
  browser = await chromium.launch();
  mkdirSync(OUT, { recursive: true });
});

after(async () => {
  await browser?.close();
  server?.close();
  server?.closeAllConnections();
});

/** Serve this tracking state, role and DIY state from the next request on, writable or not, with both fixtures read again. */
function as(state: string, o: { role?: string; diy?: string; write?: boolean } = {}) {
  if (state === "default") delete process.env.TRACKING_FIXTURE_STATE;
  else process.env.TRACKING_FIXTURE_STATE = state;
  process.env.TRACKING_FIXTURE_ROLE = o.role ?? "owner";
  if (o.diy) process.env.DIY_FIXTURE_STATE = o.diy;
  else delete process.env.DIY_FIXTURE_STATE;
  if (o.write) process.env.TRACKING_FIXTURE_WRITE = "1";
  else delete process.env.TRACKING_FIXTURE_WRITE;
  delete (globalThis as Record<symbol, unknown>)[Symbol.for("alwayscited.trackingFixture")];
  delete (globalThis as Record<symbol, unknown>)[Symbol.for("alwayscited.diyFixture.keywords")];
}

async function open(route: string, width = 1280, javaScriptEnabled = true) {
  const ctx = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 900 }, javaScriptEnabled, ...(width < 600 ? { isMobile: true, hasTouch: true } : {}) });
  const page = await ctx.newPage();
  const r = await page.goto(BASE + route, { waitUntil: "load" });
  return { ctx, page, status: r?.status() };
}

/** The screen at both widths, and the page's HTML once. */
async function save(route: string, name: string, state: string) {
  for (const width of [1280, 390]) {
    const { ctx, page } = await open(route, width);
    await page.screenshot({ path: path.join(OUT, `${name}-${state}-${width}.png`), fullPage: true });
    if (width === 1280) writeFileSync(path.join(OUT, `${name}-${state}.html`), await page.content());
    await ctx.close();
  }
}

const text = (page: Page) => page.locator("#app-content").first().innerText();
const sideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
const all = (page: Page, sel: string) => page.evaluate((s) => [...document.querySelectorAll(s)].map((e) => (e.textContent ?? "").replace(/\s+/g, " ").trim()), sel);

async function axe(page: Page): Promise<string[]> {
  await page.addScriptTag({ content: AXE });
  return page.evaluate(async () => {
    // @ts-expect-error injected
    const r = await window.axe.run(document, { resultTypes: ["violations"] });
    return (r.violations as { id: string; impact: string; nodes: { target: string[] }[] }[])
      .filter((v) => v.impact === "serious" || v.impact === "critical")
      .map((v) => `${v.impact} ${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(", ")}`);
  });
}

/** Every same-site link on the page's content answers 200 (evidence and filters alike), following none of the external ones. */
async function linksResolve(page: Page) {
  const hrefs = await page.evaluate(() => [...new Set([...document.querySelectorAll<HTMLAnchorElement>("#app-content a[href]")].map((a) => a.getAttribute("href") ?? "").filter((h) => h && !/^https?:/.test(h) && !h.startsWith("mailto:")))]);
  assert.ok(hrefs.length > 5, "no links found");
  for (const h of hrefs) {
    const url = new URL(h, `${BASE}${GOOGLE}`);
    const res = await fetch(url, { redirect: "manual" });
    assert.equal(res.status, 200, `${h} answered ${res.status}`);
  }
  return hrefs;
}

async function noSideways(route: string) {
  for (const width of [390, 320]) {
    const { ctx, page } = await open(route, width);
    assert.ok((await sideways(page)) <= 0, `${route} scrolls sideways at ${width}`);
    await ctx.close();
  }
}

// ---- the Tracked view ----

test("Tracked (full) at 1280: the figures, the bands, gaining ground's line, the table with its flags, losing ground, the sites on page 1 and U2", async () => {
  as("default");
  const { ctx, page, status } = await open(GOOGLE);
  assert.equal(status, 200);
  const body = await text(page);
  assert.match(body, /^Google\n/);
  const figs = await all(page, "[data-figure]");
  assert.equal(figs.length, 4);
  assert.match(figs[0]!, /^In the top 3\s*\d+ of 9/);
  assert.match(figs[1]!, /^On page 1\s*\d+ of 9/);
  assert.ok(await page.evaluate(() => !!document.querySelector('[aria-labelledby="g-bands-h"] svg')), "no position bands");
  assert.equal((await all(page, "[data-gaining-summary]"))[0], "15 untracked keywords gaining ground: 12 climbing, 3 new, 18,060 searches a month between them. From DataForSEO's index, read 29 Sep 2026.");
  assert.equal(await page.locator("[data-keyword]").count(), 9);
  assert.match((await all(page, '[data-keyword="k2"] [data-flag]'))[0] ?? "", /^URL changed 21 Sep 2026$/);
  assert.match((await all(page, '[data-keyword="k3"] [data-flag]'))[0] ?? "", /^Two of your pages take turns: \/features\/invoices \d+ days, \/invoicing \d+ days$/);
  assert.match((await all(page, '[data-keyword="k9"]'))[0] ?? "", /Not in the top 20/);
  assert.match(body, /No tracked keyword has fallen out of the top 20/);
  const sites = await all(page, "[data-site]");
  assert.ok(sites.length >= 5 && sites.length <= 10, `${sites.length}`);
  assert.ok(!sites.some((s) => s.startsWith("tallyroo.com")), "the client is left out");
  // 13 Oct 2026 (review of the P6 handoff): a domain holding another client's placed page is left out whole, not listed with a smaller count.
  assert.ok(!sites.some((s) => /^(softwarecritic\.com|ownerledger\.co)/.test(s)), sites.join(" | "));
  assert.match(body, /Derived from Google's top 10 for your keywords on 29 Sep 2026\./);
  assert.match((await all(page, '[aria-label="Upgrade"]'))[0] ?? "", /keywords sit just off page 1.*Shown because 3 of your 9 cluster keywords rank #11 to #20 today\./);
  assert.doesNotMatch(await page.content(), /best-bookkeeping-software/, "another client's placed page is in no list");
  assert.deepEqual(await axe(page), []);
  await linksResolve(page);
  await ctx.close();
  await save(GOOGLE, "google", "full");
  await noSideways(GOOGLE);
});

test("gaining ground expanded: 15 watch rows with Track and Dismiss, every intent, the lapsed dismissal back and the live one listed with Restore", async () => {
  as("default");
  const { ctx, page } = await open(`${GOOGLE}?gaining=1`);
  const rows = page.locator("[data-gaining]");
  assert.equal(await rows.count(), 15);
  assert.equal(await page.locator("[data-gaining] [data-track]").count(), 15);
  const track = await page.locator('[data-gaining="payroll software for sole traders"] [data-track]').getAttribute("href");
  assert.equal(track, `${APP}/clusters?add=1&kw=payroll+software+for+sole+traders&src=gaining`);
  assert.match((await all(page, '[data-gaining="payroll software for sole traders"]'))[0]!, /Up from 18th to 7th.*880 searches a month · Commercial · ranking with \/payroll \(DataForSEO estimate\).*Its 5 drafted prompts/);
  assert.ok(await page.locator('[data-gaining="estimate template for contractors"]').count(), "a lapsed dismissal is back");
  assert.equal(await page.locator('[data-gaining="expense app for consultants"]').count(), 0, "the live dismissal is left out");
  assert.match((await all(page, "[data-dismissed]"))[0]!, /Dismissed \(1\)\s*expense app for consultants\s*out of this list until 20 Dec 2026\s*Restore/);
  assert.match(await text(page), /These are watch rows: weekly positions from DataForSEO's index, never counted in the daily figures above\. Positions are among Google's organic results\. Each is compared with our previous pull, read 22 Sep 2026\. That pull read the top 298 keywords by estimated traffic, so 3 keywords below it are compared with DataForSEO's own previous reading instead, as their rows say\./);
  // A keyword missing from our previous pull (cut at its row limit) is new by DataForSEO's own reading, and says so with its date.
  assert.match((await all(page, '[data-gaining="receipt scanner app for small business"]'))[0]!, /New at 12th since DataForSEO's reading of \d{1,2} \w{3} 2026/);
  assert.deepEqual(await axe(page), []);
  await ctx.close();
  const every = await open(`${GOOGLE}?gaining=1&intent=all`);
  assert.equal(await every.page.locator("[data-gaining]").count(), 15, "the top 15 of more");
  assert.ok(await every.page.locator('[data-gaining="how to send an invoice"]').count(), "an informational keyword with every intent");
  assert.match((await all(every.page, "[data-gaining-summary]"))[0]!, /^2\d untracked keywords gaining ground/);
  await every.ctx.close();
  await save(`${GOOGLE}?gaining=1`, "google", "gaining");
  await noSideways(`${GOOGLE}?gaining=1`);
});

test("day0 and nofootprint: DataForSEO's previous reading is named as the comparison; an empty pull is said as one", async () => {
  as("default", { diy: "day0" });
  const day0 = await open(`${GOOGLE}?gaining=1`);
  const labels = await all(day0.page, "[data-gaining]");
  assert.ok(labels.every((l) => /since DataForSEO's reading of \d{1,2} \w{3} 2026/.test(l)), labels[0]);
  // A climb against DataForSEO's reading is counted on the whole results page, as that reading is, and the position shown is the organic one.
  assert.ok(labels.some((l) => /Up \d+ places on the results page since DataForSEO's reading of \d{1,2} \w{3} 2026; now \d+(st|nd|rd|th)/.test(l)), labels.join(" | "));
  assert.match(await text(day0.page), /With one pull so far, each is compared with DataForSEO's own previous reading of that keyword, counted in places on the results page and dated on its row/);
  assert.deepEqual(await axe(day0.page), []);
  await day0.ctx.close();
  const day0all = await open(`${GOOGLE}?view=all`);
  assert.match(await text(day0all.page), /With one pull so far, change is against DataForSEO's own previous reading of each keyword, in places on the results page\./);
  await day0all.ctx.close();
  as("default", { diy: "nofootprint" });
  const none = await open(GOOGLE);
  assert.equal((await all(none.page, "[data-gaining-summary]"))[0], "DataForSEO's index has no Google rankings for tallyroo.com yet (read 29 Sep 2026).");
  await none.ctx.close();
});

test("dark: gaining ground and the All view are hidden, and the view switch shows Tracked only; the tracked keywords still show", async () => {
  as("default", { diy: "dark" });
  const { ctx, page, status } = await open(GOOGLE);
  assert.equal(status, 200);
  assert.equal(await page.locator("#gaining").count(), 0);
  assert.deepEqual(await all(page, 'nav[aria-label="Which keywords"] a'), ["Tracked keywords"]);
  assert.equal(await page.locator("[data-keyword]").count(), 9);
  assert.doesNotMatch(await text(page), /DataForSEO|footprint/, "no promise of a read that is not going to happen");
  assert.deepEqual(await axe(page), []);
  await ctx.close();
  const forced = await open(`${GOOGLE}?view=all`);
  assert.equal(await forced.page.locator("[data-ranking]").count(), 0, "?view=all is the Tracked view while dark");
  assert.equal(await forced.page.locator("[data-keyword]").count(), 9);
  await forced.ctx.close();
  await save(GOOGLE, "google", "dark");
});

test("zero: nothing gaining with a buying intent, and every intent and the dismissed keyword stay one link away, with Restore (JS off)", async () => {
  as("default", { diy: "zero", write: true });
  const look = await open(GOOGLE);
  assert.equal((await all(look.page, "[data-gaining-summary]"))[0], "No untracked keyword with a buying intent is gaining ground in this pull. From DataForSEO's index, read 29 Sep 2026.");
  assert.match((await look.page.locator("[data-gaining-intent]").getAttribute("href")) ?? "", /gaining=1&intent=all|intent=all.*gaining=1/);
  assert.deepEqual(await axe(look.page), []);
  await look.ctx.close();
  const every = await open(`${GOOGLE}?gaining=1&intent=all`);
  assert.equal((await all(every.page, "[data-gaining-summary]"))[0], "No untracked keyword is gaining ground in this pull. From DataForSEO's index, read 29 Sep 2026.");
  assert.equal(await every.page.locator('nav[aria-label="Which intents"] a[aria-current="true"]').innerText(), "Every intent");
  assert.deepEqual(await axe(every.page), []);
  await every.ctx.close();
  const { ctx, page } = await open(GOOGLE, 1280, false);
  await page.locator('#gaining a:has-text("Dismissed (1)")').click();
  await page.waitForURL(/gaining=1/, { timeout: 15_000 });
  assert.match((await all(page, "[data-dismissed]"))[0]!, /Dismissed \(1\)\s*expense app for consultants\s*out of this list until 20 Dec 2026\s*Restore/);
  assert.equal(await page.locator('nav[aria-label="Which intents"] a').count(), 2, "the intent switch shows with nothing gaining");
  await page.locator("[data-dismissed] button[type=submit]").click();
  await page.waitForURL(/done=restored/, { timeout: 15_000 });
  assert.match((await all(page, "[data-gaining-notice]"))[0]!, /^Restored\./);
  assert.equal(await page.locator("[data-dismissed]").count(), 0);
  await ctx.close();
  as("default", { diy: "zero" });
  await save(`${GOOGLE}?gaining=1`, "google", "zero");
});

// ---- the All view ----

test("All ranking keywords: the estimates labelled, 100 rows a page, search, intent and band filters, and paging", async () => {
  as("default");
  const { ctx, page } = await open(`${GOOGLE}?view=all`);
  assert.equal(await page.locator("[data-ranking]").count(), 100);
  const figs = await all(page, "[data-figure]");
  assert.equal(figs.length, 4);
  for (const f of figs) assert.match(f, /DataForSEO estimate, read 29 Sep 2026/);
  assert.match(figs[0]!, /^Ranking keywords\s*1,342\s*The top 300 read, by estimated traffic\./);
  // 13 Oct 2026 (review of the P6 handoff): the table says it holds the top rows by estimated traffic, not every keyword.
  assert.equal((await all(page, "#all-h"))[0], "300 of 1,342 ranking keywords, by estimated traffic");
  assert.match(await text(page), /The top 300 of the 1,342 keywords DataForSEO's index has your site ranking for in Google's top 100, by estimated traffic, read weekly at most\. Positions are among Google's organic results\./);
  assert.match(await text(page), /Change is against our previous pull, read 22 Sep 2026, which held the top 298 by estimated traffic: a keyword below that has no change shown\./);
  // Only a keyword gaining ground carries the Momentum origin from Track.
  const gainingTrack = await page.locator('[data-ranking="payroll software for sole traders"] a').getAttribute("href");
  assert.match(gainingTrack ?? "", /src=gaining/);
  const tracks = await page.evaluate(() => [...document.querySelectorAll("[data-ranking] a")].map((a) => ({ src: /[?&]src=gaining\b/.test(a.getAttribute("href") ?? ""), usage: a.getAttribute("data-usage") })));
  assert.ok(tracks.some((t) => t.src) && tracks.some((t) => !t.src), "both kinds of row on the page");
  assert.ok(tracks.every((t) => t.src === (t.usage === "gaining_track")), "src=gaining and gaining_track go together, on gaining keywords only");
  assert.ok(tracks.filter((t) => t.src).length <= 15);
  assert.match(await text(page), /Page 1 of 3/);
  assert.doesNotMatch(await page.content(), /difficulty|\bKD\b/i);
  assert.deepEqual(await axe(page), []);
  await ctx.close();
  const two = await open(`${GOOGLE}?view=all&page=3`);
  assert.equal(await two.page.locator("[data-ranking]").count(), 100);
  assert.match(await text(two.page), /Page 3 of 3/);
  await two.ctx.close();
  const q = await open(`${GOOGLE}?view=all&q=invoice`);
  const kws = (await all(q.page, "[data-ranking]")).map((t) => t.toLowerCase());
  assert.ok(kws.length > 0 && kws.every((t) => t.includes("invoice")), "search narrows to the term");
  assert.match((await all(q.page, "#all-h"))[0]!, /^\d+ ranking keywords? match(es)?, of the top 300 by estimated traffic$/);
  await q.ctx.close();
  const intent = await open(`${GOOGLE}?view=all&intent=informational`);
  const n = await intent.page.locator("[data-ranking]").count();
  assert.ok(n > 0 && n < 100);
  assert.equal(await intent.page.locator('[data-ranking]:not(:has-text("Informational"))').count(), 0);
  await intent.ctx.close();
  const band = await open(`${GOOGLE}?view=all&band=top3`);
  const positions = await band.page.evaluate(() => [...document.querySelectorAll("[data-ranking] > [role=cell]:nth-child(2)")].map((e) => e.textContent ?? ""));
  assert.ok(positions.length > 0 && positions.every((p) => /^(1st|2nd|3rd)$/.test(p.trim())), positions.join(","));
  await band.ctx.close();
  await save(`${GOOGLE}?view=all`, "google", "all");
  await noSideways(`${GOOGLE}?view=all`);
});

test("who holds page 1: a keyword's row opens Google's top 10 at its latest reading, less another client's placed page, in Google's order with no rank numbers; axe passes with it open", async () => {
  as("default");
  const { ctx, page } = await open(`${GOOGLE}?row=k4`);
  const hits = await page.evaluate(() => [...document.querySelectorAll("[data-page-one=k4] [data-hit]")].map((e) => e.getAttribute("data-hit")));
  assert.equal(hits.length, 9, "the top 10 less the placed page");
  assert.equal(hits[0], "quickledger.example");
  const panel = (await all(page, "[data-page-one=k4]"))[0]!;
  assert.match(panel, /Google's organic results for this keyword, top to bottom, checked 29 Sep 2026\./);
  // 13 Oct 2026 (review of the P6 handoff): no numbered gap pointing at the page left out, in the text or the markup.
  assert.doesNotMatch(panel, /\b(1st|2nd|3rd|10th)\b/);
  assert.doesNotMatch(await page.content(), /best-bookkeeping-software|data-rank=/);
  const out = await page.evaluate(() => [...document.querySelectorAll<HTMLAnchorElement>("[data-page-one] a")].map((a) => a.rel));
  assert.ok(out.length && out.every((r) => r.includes("noopener")));
  assert.equal(await page.locator('[data-keyword="k4"] a[aria-expanded="true"]').count(), 1);
  assert.deepEqual(await axe(page), []);
  await ctx.close();
  await save(`${GOOGLE}?row=k4`, "google", "row");
});

// Not yet exercisable here (13 Oct 2026, review of the P6 handoff): no tracking fixture state has a keyword losing
// ground, positions come from fixture.json (never edited) through fixture-mode.ts (not this package's file), and the
// card's link goes to P8's /pages, which 404s until P8 merges. Handed to the wave 2 shell (P9).
test.todo("losing ground, listed: a keyword that held 16th or better and is outside the top 20 on 2 of its last 3 readings, its copy, and its link to Your pages (/pages?url=) resolving");

// ---- writes, with JS off ----

test("Dismiss and its Undo with JS off: a 303, the toast in fixed words, the row gone and back", async () => {
  as("default", { write: true });
  const { ctx, page } = await open(`${GOOGLE}?gaining=1`, 1280, false);
  await page.locator('[data-gaining="invoice app for contractors"] button[type=submit]').click();
  await page.waitForURL(/done=dismissed/, { timeout: 15_000 });
  assert.match(page.url(), /gaining=1/);
  assert.match((await all(page, "[data-gaining-notice]"))[0]!, /^'invoice app for contractors' is dismissed\. It stays out of gaining ground until 28 Dec 2026\.\s*Undo$/);
  assert.equal(await page.locator('[data-gaining="invoice app for contractors"]').count(), 0);
  await page.locator("[data-gaining-notice] button[type=submit]").click();
  await page.waitForURL(/done=restored/, { timeout: 15_000 });
  assert.match((await all(page, "[data-gaining-notice]"))[0]!, /^Restored\./);
  assert.equal(await page.locator('[data-gaining="invoice app for contractors"]').count(), 1);
  await ctx.close();
  // A preview that does not save says so; a keyword not in the pull is refused, and nothing typed comes back in the URL.
  as("default");
  const ro = await fetch(`${BASE}/api/app/tallyroo/keywords?gaining=1`, { method: "POST", body: new URLSearchParams({ do: "dismiss", keyword: "invoice app for contractors" }), redirect: "manual" });
  assert.equal(ro.status, 303);
  assert.match(ro.headers.get("location") ?? "", /done=refused&why=readonly#gaining$/);
  const odd = await fetch(`${BASE}/api/app/tallyroo/keywords`, { method: "POST", body: new URLSearchParams({ do: "dismiss", keyword: "<script>anything</script>" }), redirect: "manual" });
  assert.match(odd.headers.get("location") ?? "", /why=unknown/);
  assert.doesNotMatch(odd.headers.get("location") ?? "", /script/);
});

test("a viewer sees Track and Dismiss disabled with the reason, and a post is refused", async () => {
  as("default", { role: "viewer", write: true });
  const { ctx, page } = await open(`${GOOGLE}?gaining=1`);
  assert.equal(await page.locator("[data-gaining] [data-track]").count(), 0);
  const disabled = page.locator("[data-gaining] button[disabled]");
  assert.equal(await disabled.count(), 30);
  assert.equal(await disabled.first().getAttribute("aria-describedby"), "gg-viewer");
  assert.equal((await all(page, "#gg-viewer"))[0], "Viewers can't change this. Ask an owner or editor.");
  assert.equal(await page.locator("[data-dismissed] form").count(), 0, "no Restore for a viewer");
  assert.deepEqual(await axe(page), []);
  await ctx.close();
  const res = await fetch(`${BASE}/api/app/tallyroo/keywords`, { method: "POST", body: new URLSearchParams({ do: "dismiss", keyword: "invoice app for contractors" }), redirect: "manual" });
  assert.match(res.headers.get("location") ?? "", /done=refused&why=viewer/);
});

test("an ended client: an owner sees the controls disabled with the ended reason, and a post is refused with it", async () => {
  as("ended", { write: true });
  const { ctx, page } = await open(`${GOOGLE}?gaining=1`);
  assert.equal(await page.locator("[data-gaining] [data-track]").count(), 0);
  assert.equal((await all(page, "#gg-viewer"))[0], "Tracking has ended for this client, so its actions are read-only.");
  assert.deepEqual(await axe(page), []);
  await ctx.close();
  const res = await fetch(`${BASE}/api/app/tallyroo/keywords`, { method: "POST", body: new URLSearchParams({ do: "dismiss", keyword: "invoice app for contractors" }), redirect: "manual" });
  assert.match(res.headers.get("location") ?? "", /done=refused&why=ended/);
  const toast = await open(new URL(res.headers.get("location")!).pathname + new URL(res.headers.get("location")!).search);
  assert.match((await all(toast.page, "[data-gaining-notice]"))[0]!, /^Tracking has ended for this client, so its actions are read-only\.$/);
  await toast.ctx.close();
});

test("Track lands on Clusters with the panel open and prefilled; after Check keyword and add, the cluster's prompts carry the Momentum chip (JS off)", async () => {
  as("default", { write: true });
  // Every cluster is in use on the fixture: stop the pending one to free a slot, as a member would.
  const stop = await fetch(`${BASE}/api/app/tallyroo/stop?kind=cluster&id=c10`, { method: "POST", redirect: "manual" });
  assert.equal(stop.status, 303);
  // With a slot free, Clusters suggests what to track: gaining ground first.
  const cl = await open(`${APP}/clusters`);
  const sugg = await all(cl.page, "[data-suggestion]");
  assert.equal(sugg.length, 5);
  assert.match(sugg[0]!, /^receipt scanner app for small business\s*New at 12th since DataForSEO's reading of \d{1,2} \w{3} 2026, \/receipts; 2,400 searches a month \(DataForSEO estimate, read 29 Sep 2026\)\./);
  assert.match((await cl.page.locator("[data-suggestion] a").first().getAttribute("href")) ?? "", /add=1&kw=receipt\+scanner\+app\+for\+small\+business&src=gaining/);
  assert.deepEqual(await axe(cl.page), []);
  await cl.ctx.close();
  await save(`${APP}/clusters`, "clusters", "suggested");

  const { ctx, page } = await open(`${GOOGLE}?gaining=1`, 1280, false);
  await page.locator('[data-gaining="receipt scanner app for small business"] [data-track]').click();
  await page.waitForURL(/\/clusters\?add=1&kw=receipt\+scanner\+app\+for\+small\+business&src=gaining/, { timeout: 15_000 });
  assert.equal(await page.locator("#kw-draft").inputValue(), "receipt scanner app for small business");
  assert.equal(await page.locator("#kw-src").inputValue(), "gaining");
  await page.locator('section[aria-label="Add a cluster"] form[action*="/check"] button[type=submit]').click();
  await page.waitForURL(/ck=ok/, { timeout: 15_000 });
  assert.match(page.url(), /&src=gaining/, "src survives Check keyword's round trip");
  assert.equal(await page.locator("#nc-src").inputValue(), "gaining");
  await page.locator('section[aria-label="Add a cluster"] form[action*="/cluster"] button[type=submit]').click();
  await page.waitForURL(/done=added/, { timeout: 15_000 });
  const open1 = new URL(page.url()).searchParams.get("open");
  assert.ok(open1);
  const chips = await page.evaluate(() => [...document.querySelectorAll("[data-origin]")].map((e) => ({ kind: e.getAttribute("data-origin"), href: e.getAttribute("href"), text: (e.textContent ?? "").trim() })));
  const momentum = chips.filter((c) => c.kind === "momentum");
  assert.equal(momentum.length, 5, JSON.stringify(chips));
  assert.ok(momentum.every((c) => /Momentum/.test(c.text)));
  const href = momentum.find((c) => c.href)?.href;
  assert.ok(href, "the Momentum chip links to gaining ground");
  const res = await fetch(new URL(href!, BASE), { redirect: "manual" });
  assert.equal(res.status, 200, `${href} answered ${res.status}`);
  await ctx.close();
});

test("setup suggestions: up to 10 keywords the site ranks for, with the checkout keyword; Use this keyword runs Check keyword on the card that needs one (JS off)", async () => {
  as("signup", { write: true });
  const { ctx, page, status } = await open(`${APP}/setup`, 1280, false);
  assert.equal(status, 200);
  const items = await all(page, "[data-suggestion]");
  assert.ok(items.length >= 5 && items.length <= 10, `${items.length}`);
  assert.match(items[0]!, /on Google, \/.*searches a month \(DataForSEO estimate, read 29 Sep 2026\)\./);
  await page.locator("[data-suggestion] form button[type=submit]").first().click();
  await page.waitForURL(/\/setup\?card=/, { timeout: 15_000 });
  assert.match(page.url(), /ck=ok/);
  assert.match(await page.locator("body").innerText(), /Use .* for this cluster/);
  await ctx.close();
  as("signup");
  const look = await open(`${APP}/setup`);
  assert.deepEqual(await axe(look.page), []);
  await look.ctx.close();
  // 13 Oct 2026 (review of the P6 handoff): the keyword typed at checkout keeps a slot, and gaining ground comes before the footprint's tail.
  as("signup-typed");
  const typed = await open(`${APP}/setup`);
  const listed = await all(typed.page, "[data-suggestion]");
  assert.ok(listed.length <= 10);
  assert.match(listed[listed.length - 1]!, /^invoicing app for freelancers\s*The keyword you gave at checkout\./);
  assert.ok(listed.some((l) => /since DataForSEO's reading of|Up from \d+(st|nd|rd|th) to/.test(l)), "gaining ground is listed");
  await typed.ctx.close();
  await save(`${APP}/setup`, "setup", "suggested");
  as("signup", { role: "viewer" });
  const viewer = await open(`${APP}/setup`);
  assert.ok((await viewer.page.locator("[data-suggestion] button[disabled]").count()) > 0);
  assert.match(await viewer.page.locator("body").innerText(), /Viewers can't change this\. Ask an owner or editor\./);
  await viewer.ctx.close();
});

test("390 cards: the tracked table and the All view keep the keyword and its one figure, the rest as a line under it", async () => {
  as("default");
  const { ctx, page } = await open(GOOGLE, 390);
  const head = await page.evaluate(() => [...document.querySelectorAll(".gk-head > *")].filter((e) => getComputedStyle(e).display !== "none").map((e) => (e.textContent ?? "").trim()));
  assert.deepEqual(head, ["Keyword", "Position ↑"]);
  const sub = await page.evaluate(() => getComputedStyle(document.querySelector("[data-keyword] .gk-sub-sm")!).display);
  assert.equal(sub, "block");
  await ctx.close();
  const a = await open(`${GOOGLE}?view=all`, 390);
  const cols = await a.page.evaluate(() => [...document.querySelectorAll("[data-ranking]")].slice(0, 3).map((r) => [...r.children].filter((c) => getComputedStyle(c).display !== "none").length));
  assert.deepEqual(cols, [2, 2, 2]);
  await a.ctx.close();
});
