/**
 * DIY P8 (13 Oct 2026; spec 10 sections 4.9 and 7.9): Your pages on the
 * fixture - TRACKING_FIXTURE=1 with DIY_FIXTURE_STATE, Your pages' own rows
 * from src/lib/diy/fixtures/pages.json - served in-process on the build, as
 * e2e/app/diy-plan.spec.mts serves it.
 *
 * Holds what section 7.0 item 7 asks of every DIY spec: axe finds no serious
 * or critical violation; no sideways page scroll at 390 and 320 (a code block
 * scrolls in its own box); every write form works with JS off (a 303 and its
 * toast); a viewer sees the controls disabled with the reason; every evidence
 * link resolves. And the package's own: the list and its filters, the detail
 * tabs, the JSON-LD block selectable with JS off and copied with JS on, add a
 * page (a foreign domain refused), Check this page now, request an example
 * (pending, then ready), Add to Actions, the crawlers and examples views, the
 * dark, day 0 and capped states, and 390 stacking.
 *
 * Saves each page's screens to test-results/diy/pages/<page>-<state>-<width>.png
 * (1280x900 and 390x844) and its HTML to test-results/diy/pages/<page>-<state>.html
 * for the gating census (section 6.10 item 2), every name starting `pages-` as
 * P1's census knows a saved Your pages page. Not committed.
 *
 *   npm run build && E2E_PORT=3670 node --test e2e/app/diy-pages.spec.mts
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const OUT = path.join(ROOT, "test-results", "diy", "pages");
const require = createRequire(path.join(os.homedir(), "code/.parity/package.json"));
type Locator = {
  click(): Promise<void>;
  count(): Promise<number>;
  first(): Locator;
  nth(i: number): Locator;
  innerText(): Promise<string>;
  fill(v: string): Promise<void>;
  isDisabled(): Promise<boolean>;
  isVisible(): Promise<boolean>;
  getAttribute(name: string): Promise<string | null>;
  locator(sel: string): Locator;
};
type Page = {
  goto(url: string, o?: object): Promise<{ status(): number } | null>;
  reload(o?: object): Promise<unknown>;
  locator(sel: string): Locator;
  waitForURL(url: RegExp, o?: object): Promise<void>;
  waitForTimeout(ms: number): Promise<void>;
  evaluate<R, A = void>(fn: (arg: A) => R | Promise<R>, arg?: A): Promise<R>;
  addScriptTag(o: { content: string }): Promise<unknown>;
  screenshot(o: { path: string; fullPage?: boolean }): Promise<unknown>;
  content(): Promise<string>;
  url(): string;
};
type Context = { newPage(): Promise<Page>; close(): Promise<void>; grantPermissions(p: string[], o?: object): Promise<void> };
type Browser = { newContext(o: object): Promise<Context>; close(): Promise<void> };
const { chromium } = require("playwright") as { chromium: { launch(): Promise<Browser> } };
const AXE = readFileSync(path.join(ROOT, "node_modules", "axe-core", "axe.min.js"), "utf8");

const PORT = Number(process.env.E2E_PORT ?? 3670);
const BASE = `http://localhost:${PORT}`;
const PAGES = "/app/tallyroo/pages";

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

/** Serve this tracking state, role and DIY state from the next request on, writable or not, with the fixtures read again. */
function as(state: string, o: { role?: string; diy?: string; write?: boolean } = {}) {
  if (state === "default") delete process.env.TRACKING_FIXTURE_STATE;
  else process.env.TRACKING_FIXTURE_STATE = state;
  process.env.TRACKING_FIXTURE_ROLE = o.role ?? "owner";
  if (o.diy) process.env.DIY_FIXTURE_STATE = o.diy;
  else delete process.env.DIY_FIXTURE_STATE;
  if (o.write) process.env.TRACKING_FIXTURE_WRITE = "1";
  else delete process.env.TRACKING_FIXTURE_WRITE;
  for (const k of ["alwayscited.trackingFixture", "alwayscited.diyFixture.pages", "alwayscited.diyFixture.plan"]) delete (globalThis as Record<symbol, unknown>)[Symbol.for(k)];
}

async function open(route: string, width = 1280, javaScriptEnabled = true) {
  const ctx = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 900 }, javaScriptEnabled });
  const page = await ctx.newPage();
  const r = await page.goto(BASE + route, { waitUntil: "load" });
  return { ctx, page, status: r?.status() };
}

/** The screen at both widths, and the page's HTML once, for the gating census. */
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

/** Submit the form a button is in, JS off, and land on the 303's page. */
async function press(page: Page, selector: string) {
  await page.locator(selector).first().click();
  await page.waitForURL(/\/app\/tallyroo\//, { timeout: 15_000 });
}

test("the list (full) at 1280: 10 key pages with their chips, the site strip, and nothing axe calls serious", async () => {
  as("default");
  const { ctx, page, status } = await open(PAGES);
  assert.equal(status, 200);
  assert.equal(await page.locator("h1").innerText(), "Your pages");
  const t = await text(page);
  assert.match(t, /1 search crawler blocked/);
  assert.match(t, /8 of 10, last check 23 Sep/);
  assert.equal(await page.locator("table.yp-table tbody tr").count(), 10);
  const row = (id: string) => page.locator(`#row-${id}`).innerText();
  assert.match(await row("kp-8"), /#14[\s\S]*Fits/);
  assert.match(await row("kp-9"), /Not checked[\s\S]*No page[\s\S]*HTTP 403/);
  assert.match(await row("kp-5"), /HTTP 404/);
  assert.match(await row("kp-2"), /Blocked for Googlebot/);
  assert.match(await row("kp-3"), /Missing Product/);
  assert.match(await row("kp-6"), /\d+ answers/, "the engines' citations of /freelancers in 28 days");
  assert.match(t, /1 page you removed stays out/);
  assert.equal(await sideways(page), 0, "no sideways scroll at 1280");
  assert.deepEqual(await axe(page), []);
  await ctx.close();
  await save(PAGES, "pages-list", "full");
});

test("the filters: issue and cluster, each a link held in the URL", async () => {
  as("default");
  let { ctx, page } = await open(`${PAGES}?issue=access`);
  assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll("table.yp-table tbody tr")].map((r) => r.id).sort()), ["row-kp-2", "row-kp-5", "row-kp-9"]);
  assert.match(await text(page), /Key pages \(3 shown\)/);
  await ctx.close();
  ({ ctx, page } = await open(`${PAGES}?cluster=c8`));
  assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll("table.yp-table tbody tr")].map((r) => r.id)), ["row-kp-8"]);
  await ctx.close();
  ({ ctx, page } = await open(`${PAGES}?cluster=not-mine&issue=nope`));
  assert.equal(await page.locator("table.yp-table tbody tr").count(), 10, "an unknown key is ignored, never echoed");
  await ctx.close();
});

test("the Schema tab: what we found, our checks with their grades, the fix with where each value came from, and the evidence box", async () => {
  as("default");
  const { ctx, page, status } = await open(`${PAGES}/kp-1`);
  assert.equal(status, 200);
  const t = await text(page);
  assert.match(t, /Organization: in the page's HTML/);
  assert.match(t, /The validator found 1 error and 1 warning in the structured data we found\./);
  assert.match(t, /Your Organization markup is missing logo and sameAs\./);
  assert.match(t, /Google documents this/);
  assert.match(t, /logo - from the header image/);
  assert.match(t, /Structured data makes a page eligible for Google's rich results; correct markup doesn't guarantee one/);
  assert.match(t, /Google says no special schema is needed to appear in AI Overviews or AI Mode/);
  assert.match(t, /FAQ rich results are no longer shown, from 7 May 2026/);
  assert.doesNotMatch(t, /the schema Google sees/i);
  const test_ = await page.locator('a:has-text("Rich Results Test")').first().getAttribute("href");
  assert.equal(test_, `https://search.google.com/test/rich-results?url=${encodeURIComponent("https://tallyroo.com/")}`, "carries only the public page address");
  assert.deepEqual(await axe(page), []);
  await ctx.close();
  await save(`${PAGES}/kp-1`, "pages-schema", "full");
  const { ctx: c2, page: p2, status: s2 } = await open(`${PAGES}/kp-999`);
  assert.equal(s2, 404, "a page that is not this client's live key page is the 404");
  await c2.close();
});

test("the JSON-LD block is selectable with JS off, and Copy writes it to the clipboard with JS on", async () => {
  as("default");
  const off = await open(`${PAGES}/kp-1`, 1280, false);
  const block = await off.page.locator("#fix-json-Organization").innerText();
  assert.match(block, /<script type="application\/ld\+json">/);
  assert.match(block, /"@type": "Organization"/);
  assert.equal(await off.page.locator('button:has-text("Copy the block")').count(), 0, "no dead button without script");
  await off.ctx.close();
  const on = await open(`${PAGES}/kp-1`);
  await on.ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });
  await on.page.locator('button:has-text("Copy the block")').first().click();
  await on.page.waitForTimeout(200);
  assert.match(await on.page.evaluate(() => navigator.clipboard.readText()), /"@type": "Organization"/);
  assert.match(await on.page.locator("#fix-Organization").innerText(), /Copied\./);
  await on.ctx.close();
});

test("the Fit tab with an example: Fits at #14 with U6, the diagnostics, what the engines say, and the example side by side", async () => {
  as("default");
  const { ctx, page } = await open(`${PAGES}/kp-8?tab=fit`);
  const t = await text(page);
  assert.match(t, /The page matches what ranks\. The page is probably not the problem\./);
  assert.match(t, /'cloud accounting software' read #11-#20 on 28 of its last 28 readings/);
  assert.match(t, /Shown because 'cloud accounting software' read #11 to #20/);
  assert.match(t, /You against the top 3/);
  assert.match(t, /An example to edit, not finished copy\. Example written from your page on 25 Sep/);
  assert.match(t, /Check every fact before you publish\. Nothing is published for you\./);
  assert.match(t, /Cloud accounting software for small teams \| Tallyroo/);
  assert.match(t, /Now\s+Tallyroo keeps your books tidy every month with invoices, expenses and reports in one place for the cloud\./, "the Now opening is the page's own latest read");
  assert.equal(await page.locator('[role="note"][aria-label="Upgrade"]').count(), 1, "one upgrade slot");
  assert.deepEqual(await axe(page), []);
  // Every evidence link on the tab resolves.
  const hrefs = await page.evaluate(() => [...document.querySelectorAll<HTMLAnchorElement>("#fit-result a[href^='/app/']")].map((a) => a.getAttribute("href")!));
  assert.ok(hrefs.some((h) => /\/clusters\/c8\?prompt=\d&day=\d{4}-\d{2}-\d{2}&engine=\w+#answer-/.test(h)), "the stored answer opens");
  for (const h of [...new Set(hrefs)]) {
    const r = await page.goto(BASE + h);
    assert.equal(r?.status(), 200, h);
  }
  await ctx.close();
  await save(`${PAGES}/kp-8?tab=fit`, "pages-fit", "full");
});

test("the homepage's Fit tab: a cluster another page ranks for is not judged against it - no Fits, no U6, no example", async () => {
  as("default");
  const { ctx, page } = await open(`${PAGES}/kp-1?tab=fit`);
  const c10 = await page.locator("#fit-c10").innerText();
  assert.match(c10, /Another page ranks/);
  assert.match(c10, /Another of your pages is the one that ranks for 'payroll and accounting software', so this page's fit isn't read for it\./);
  assert.match(c10, /tallyroo\.com\/blog\/payroll-guide held 'payroll and accounting software' at #14 at the latest reading\./);
  assert.doesNotMatch(c10, /probably not the problem|Shown because|You against the top 3|top 3's structure/, "no verdict, no U6, and no diagnostics of this page against another page's keyword");
  assert.equal(await page.locator('#fit-c10 button[value="example"]').count(), 0, "no example of the homepage for another page's keyword");
  assert.equal(await page.locator('#fit-c9 button[value="example"]').count(), 1, "the cluster it is judged on still offers one");
  assert.deepEqual(await axe(page), []);
  await ctx.close();
  await save(`${PAGES}/kp-1?tab=fit`, "pages-fithome", "full");
});

test("the other examples: pending two minutes, a stale pending read as failed, and a failed one, none of them counted", async () => {
  as("default");
  let { ctx, page } = await open(`${PAGES}/kp-4?tab=fit`);
  assert.match(await text(page), /Writing your example\. It's usually ready in a minute; refresh to see it\./);
  assert.match(await text(page), /Google answers 'bookkeeping software' with best-of lists: 7 of the 9 we could type\./);
  await ctx.close();
  for (const id of ["kp-7", "kp-3"]) {
    ({ ctx, page } = await open(`${PAGES}/${id}?tab=fit`));
    assert.match(await text(page), /We couldn't write a usable example for this page today\. It didn't use an example from your allowance\./, id);
    await ctx.close();
  }
});

test("Basics and History: the JS-only page says so with Google's dated line; the history lists reads and changes", async () => {
  as("default");
  let { ctx, page } = await open(`${PAGES}/kp-10?tab=basics`);
  let t = await text(page);
  assert.match(t, /This page shows little without JavaScript: \d+ words in its HTML, 1420 once JavaScript runs\./);
  assert.match(t, /Keep important content in text form \(Google Search Central, updated 10 Dec 2025\)\./);
  await ctx.close();
  ({ ctx, page } = await open(`${PAGES}/kp-9`));
  assert.match(await text(page), /We couldn't read this page on 23 Sep \(HTTP 403\)\./);
  assert.doesNotMatch(await text(page), /no schema/i);
  await ctx.close();
  ({ ctx, page } = await open(`${PAGES}/kp-4?tab=history`));
  t = await text(page);
  assert.match(t, /Its text changed between our reads on 16 Sep/);
  assert.match(t, /Add Product schema to tallyroo\.com\/bookkeeping/, "the Actions item on this page");
  await ctx.close();
});

test("the crawlers view: GPTBot blocked, Googlebot blocked from /pricing with the lines to change, Google-Extended a choice, llms.txt optional", async () => {
  as("default");
  const { ctx, page } = await open(`${PAGES}?view=bots`);
  const t = await text(page);
  assert.match(t, /GPTBot[\s\S]*Blocked/);
  assert.match(t, /Googlebot[\s\S]*Some key pages blocked/);
  assert.match(t, /Google says crawling must be allowed for a page to appear in its AI features/);
  assert.match(t, /Blocked, by your choice/);
  assert.match(t, /Blocking Google-Extended is a choice, not an error\./);
  assert.match(await page.locator("#robots-googlebot").innerText(), /Disallow: \/pricing[\s\S]*Allow: \/pricing/);
  assert.match(t, /Optional\. Google says no AI text files are needed/);
  // A key page we could not read says nothing of its noindex or canonical.
  const row = async (key: string) => page.evaluate((k) => [...document.querySelectorAll("section[aria-labelledby='bots-pages'] tbody tr")].find((tr) => tr.textContent!.includes(k))?.textContent ?? "", key);
  assert.match(await row("tallyroo.com/expenses"), /404\s*Not read\s*Not read/);
  assert.match(await row("tallyroo.com/contractors"), /403\s*Not read\s*Not read/);
  assert.match(await row("tallyroo.com/cloud"), /200\s*No\s*Its own/);
  assert.deepEqual(await axe(page), []);
  await ctx.close();
  await save(`${PAGES}?view=bots`, "pages-bots", "full");
});

test("the examples view: the library's types, each with its dated requirement and made-up brands", async () => {
  as("default");
  const { ctx, page } = await open(`${PAGES}?view=examples`);
  const t = await text(page);
  assert.match(t, /Illustrative\. Tallyroo and every brand shown are made up\./);
  for (const type of ["Organization", "WebSite", "LocalBusiness", "Product", "BreadcrumbList", "Article", "ProfilePage", "FAQPage", "HowTo"]) assert.match(t, new RegExp(type), type);
  assert.doesNotMatch(t, /SoftwareApplication/, "not until Google's requirements are read");
  assert.deepEqual(await axe(page), []);
  await ctx.close();
  await save(`${PAGES}?view=examples`, "pages-examples", "full");
});

test("add a page with JS off: a foreign domain is refused, an own page added in place of the oldest automatic one", async () => {
  as("default", { write: true });
  const { ctx, page } = await open(`${PAGES}#add`, 1280, false);
  await page.locator("#yp-add-url").fill("https://ledgerline.com/pricing");
  await press(page, '#add button[type="submit"]');
  assert.match(page.url(), /done=refused&why=not_own#add$/);
  assert.match(await text(page), /That address isn't on your own domain, so it can't be a key page\./);
  await page.locator("#yp-add-url").fill("https://tallyroo.com/features/invoicing");
  await press(page, '#add button[type="submit"]');
  assert.match(await text(page), /Added, in place of your oldest automatic key page\./);
  assert.equal(await page.locator("table.yp-table tbody tr").count(), 10, "still 10");
  assert.match(await text(page), /\/features\/invoicing · Added by you/);
  await ctx.close();
});

test("Check this page now with JS off: a 303 and its toast, and the check in the page's history", async () => {
  as("default", { write: true });
  const { ctx, page } = await open(`${PAGES}/kp-8`, 1280, false);
  await press(page, 'button:has-text("Check this page now")');
  assert.match(await text(page), /Checked\. This page's reads are up to date\./);
  await page.goto(`${BASE}${PAGES}/kp-8?tab=history`);
  assert.match(await text(page), /29 Sep · you asked/);
  await ctx.close();
});

test("request an example with JS off: pending first, then ready on the fixture", async () => {
  as("default", { write: true });
  const { ctx, page } = await open(`${PAGES}/kp-6?tab=fit`, 1280, false);
  await press(page, 'button:has-text("Show me an example")');
  assert.match(await text(page), /Writing your example\. It's usually ready in a minute; refresh to see it\./);
  await page.waitForTimeout(2500);
  await page.reload({ waitUntil: "load" });
  const t = await text(page);
  assert.match(t, /An example to edit, not finished copy\./);
  assert.match(t, /accounting app for freelancers for small businesses \| Tallyroo/);
  await ctx.close();
});

test("Add to Actions with JS off: the fix lands in To do on Actions", async () => {
  as("default", { write: true });
  const { ctx, page } = await open(`${PAGES}/kp-1`, 1280, false);
  await press(page, '#fix-WebSite button:has-text("Add to Actions")');
  assert.match(await text(page), /Added to Actions\./);
  await page.goto(`${BASE}/app/tallyroo/plan?view=list&status=todo`);
  assert.match(await text(page), /Add WebSite schema to tallyroo\.com/);
  await ctx.close();
});

test("a viewer sees every control disabled with the reason", async () => {
  as("default", { role: "viewer" });
  let { ctx, page } = await open(PAGES);
  assert.equal(await page.locator('button:has-text("Remove")').first().isDisabled(), true);
  assert.equal(await page.locator("#yp-add-url").isDisabled(), true);
  assert.match(await text(page), /Viewers can't change this\. Ask an owner or editor\./);
  await ctx.close();
  ({ ctx, page } = await open(`${PAGES}/kp-6?tab=fit`));
  assert.equal(await page.locator('button:has-text("Check this page now")').isDisabled(), true);
  assert.equal(await page.locator('button:has-text("Show me an example")').isDisabled(), true);
  assert.equal(await page.locator("#detail-reason").innerText(), "Viewers can't change this. Ask an owner or editor.");
  await ctx.close();
  await save(PAGES, "pages-list", "viewer");
});

test("dark: our own reads show; no validator, no JavaScript read, no example and no check buttons", async () => {
  as("default", { diy: "dark" });
  let { ctx, page } = await open(PAGES);
  assert.equal(await page.locator("table.yp-table tbody tr").count(), 10);
  await ctx.close();
  ({ ctx, page } = await open(`${PAGES}/kp-1`));
  let t = await text(page);
  assert.doesNotMatch(t, /The validator found/);
  assert.equal(await page.locator('button:has-text("Check this page now")').count(), 0);
  assert.equal(await page.locator('button:has-text("Check this page again")').count(), 0);
  await ctx.close();
  ({ ctx, page } = await open(`${PAGES}/kp-8?tab=fit`));
  t = await text(page);
  assert.match(t, /The page matches what ranks/, "fit is read from free data");
  assert.doesNotMatch(t, /An example to edit|You against the top 3/);
  assert.equal(await page.locator('button:has-text("Show me an example")').count(), 0);
  await ctx.close();
  await save(PAGES, "pages-list", "dark");
  await save(`${PAGES}/kp-8?tab=fit`, "pages-fit", "dark");
});

test("day 0: the first check is overnight; capped: the month's examples and checks are used, with their reset", async () => {
  as("new", { diy: "day0" });
  let { ctx, page } = await open(PAGES);
  assert.match(await text(page), /Checking your homepage and the pages that rank for your keywords\. This happens overnight\./);
  await ctx.close();
  await save(PAGES, "pages-list", "day0");
  as("default", { diy: "capped" });
  ({ ctx, page } = await open(`${PAGES}/kp-6?tab=fit`));
  const t = await text(page);
  assert.match(t, /You've used this month's 10 examples\. They reset on 1 Oct\./);
  assert.match(t, /You've used this month's 30 page checks\. They reset on 1 Oct\./);
  assert.equal(await page.locator('button:has-text("Show me an example")').count(), 0);
  assert.equal(await page.locator('button:has-text("Check this page now")').isDisabled(), true);
  await ctx.close();
  await save(`${PAGES}/kp-6?tab=fit`, "pages-fit", "capped");
});

test("no sideways scroll at 390 and 320; the key pages stack into cards at 390", async () => {
  as("default");
  for (const route of [PAGES, `${PAGES}?view=bots`, `${PAGES}?view=examples`, `${PAGES}/kp-1`, `${PAGES}/kp-8?tab=fit`, `${PAGES}/kp-1?tab=fit`, `${PAGES}/kp-10?tab=basics`, `${PAGES}/kp-4?tab=history`]) {
    for (const width of [390, 320]) {
      const { ctx, page } = await open(route, width);
      assert.equal(await sideways(page), 0, `${route} at ${width}`);
      if (route === PAGES && width === 390) {
        assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector(".yp-table tr")!).display), "block", "a row is a card");
        assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector(".yp-table thead")!).display), "none");
      }
      await ctx.close();
    }
  }
});
