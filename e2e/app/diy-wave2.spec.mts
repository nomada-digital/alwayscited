/**
 * DIY P9, Shell 2 (13 Oct 2026; spec 10 section 7.10): wave 2 as one product,
 * on the fixture - TRACKING_FIXTURE=1 with DIY_FIXTURE_STATE, served in-process
 * on the build as every e2e/app spec is.
 *
 * The journey section 7.10 asks for, on the fixture's own rows, with JS off
 * for every write: the Overview (This week, a keyword opening its Google row,
 * a cited page that leaves you out opening its opportunity); Your pages' fix
 * for the homepage's Organization schema, selectable as text; the matching
 * Actions item started and marked done; the next weekly read verifying it
 * (P8's own verifier over a made-up read of the homepage, written to the item
 * as the night job writes it); Opportunities' Pursue with the prompt added;
 * Clusters showing the Opportunity chip that links back to it; Google's Track
 * on a gaining keyword landing on Clusters prefilled, and the added cluster's
 * prompts carrying the Momentum chip. Then the shell's own: the day-0 "Where
 * you stand today", Settings' research block, the nav's wave 2 items, the
 * phone layout, axe and no sideways scroll at 390 and 320.
 *
 * Screens to test-results/diy/wave2/<page>-<state>-<width>.png at 1280 and 390
 * and each page's HTML to <page>-<state>.html for the gating census (named
 * by route, as P1's DIY_ROUTES reads them). Not committed.
 *
 *   npm run build && E2E_PORT=3685 node --test e2e/app/diy-wave2.spec.mts
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";

import { verifySchema } from "../../src/lib/diy/pages/verify.ts";
import type { KeyPage, PageCheck } from "../../src/lib/diy/pages/types.ts";
import { itemOf } from "../../src/lib/diy/plan/data.ts";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const OUT = path.join(ROOT, "test-results", "diy", "wave2");
const require = createRequire(path.join(os.homedir(), "code/.parity/package.json"));
type Locator = {
  click(): Promise<void>;
  count(): Promise<number>;
  first(): Locator;
  innerText(): Promise<string>;
  inputValue(): Promise<string>;
  selectOption(v: string): Promise<unknown>;
  getAttribute(name: string): Promise<string | null>;
  locator(sel: string): Locator;
};
type Page = {
  goto(url: string, o?: object): Promise<{ status(): number } | null>;
  locator(sel: string): Locator;
  waitForURL(url: RegExp, o?: object): Promise<void>;
  waitForTimeout(ms: number): Promise<void>;
  evaluate<R, A = void>(fn: (arg: A) => R | Promise<R>, arg?: A): Promise<R>;
  addScriptTag(o: { content: string }): Promise<unknown>;
  screenshot(o: { path: string; fullPage?: boolean }): Promise<unknown>;
  content(): Promise<string>;
  url(): string;
};
type Context = { newPage(): Promise<Page>; close(): Promise<void> };
type Browser = { newContext(o: object): Promise<Context>; close(): Promise<void> };
const { chromium } = require("playwright") as { chromium: { launch(): Promise<Browser> } };
const AXE = readFileSync(path.join(ROOT, "node_modules", "axe-core", "axe.min.js"), "utf8");

const PORT = Number(process.env.E2E_PORT ?? 3685);
const BASE = `http://localhost:${PORT}`;
const APP = "/app/tallyroo";
const API = `${BASE}/api/app/tallyroo`;

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

/** Serve this tracking state, role and DIY state from the next request on, writable or not, with every fixture read again. */
function as(state: string, o: { role?: string; diy?: string; write?: boolean } = {}) {
  if (state === "default") delete process.env.TRACKING_FIXTURE_STATE;
  else process.env.TRACKING_FIXTURE_STATE = state;
  process.env.TRACKING_FIXTURE_ROLE = o.role ?? "owner";
  if (o.diy) process.env.DIY_FIXTURE_STATE = o.diy;
  else delete process.env.DIY_FIXTURE_STATE;
  if (o.write) process.env.TRACKING_FIXTURE_WRITE = "1";
  else delete process.env.TRACKING_FIXTURE_WRITE;
  const g = globalThis as Record<symbol, unknown>;
  for (const s of Object.getOwnPropertySymbols(g)) if (s.description?.startsWith("alwayscited.")) delete g[s];
}

async function open(route: string, width = 1280, javaScriptEnabled = true) {
  const ctx = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 900 }, javaScriptEnabled, ...(width < 600 ? { isMobile: true, hasTouch: true } : {}) });
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
const toast = (page: Page) => page.locator('p[role="status"]').first().innerText();
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

/** A form post as a script-free browser makes it, for the route's own answer. */
async function post(route: string, fields: Record<string, string>) {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.set(k, v);
  return fetch(`${API}/${route}`, { method: "POST", body, redirect: "manual" });
}

async function resolves(href: string) {
  const r = await fetch(new URL(href, BASE), { redirect: "manual" });
  assert.equal(r.status, 200, `${href} answered ${r.status}`);
}

/** The fixture's plan rows as the write twin holds them. */
const planRows = () => (globalThis as Record<symbol, { value: { rows: Record<string, unknown>[] } } | undefined>)[Symbol.for("alwayscited.diyFixture.plan")]!.value.rows;

// ------------------------------------------------------------ the journey

test("the journey at 1280, JS off for the writes: Overview, the fix, Actions done and verified, pursue, Clusters' chip, Google's Track", async () => {
  as("default", { write: true });

  // 1. The Overview: This week's cards; a keyword in What it means opens its row on Google; a cited page that leaves
  //    the client out opens its opportunity.
  const ov = await open(APP, 1280, false);
  assert.equal(ov.status, 200);
  assert.match(await ov.page.locator("#this-week").innerText(), /^This week/);
  assert.ok((await ov.page.locator("#this-week li[data-plan-kind]").count()) >= 1, "This week has its cards");
  const row = await ov.page.locator('a[href*="/google?"][href*="row="]').first().getAttribute("href");
  assert.ok(row, "a keyword links to its Google row");
  await resolves(row!);
  const g = await open(row!, 1280, false);
  assert.equal(await g.page.locator('[data-keyword] a[aria-expanded="true"]').count(), 1, "the row opens on Google's who holds page 1");
  await g.ctx.close();
  const leaves = await ov.page.locator("a[data-leaves-out]").first().getAttribute("href");
  assert.ok(leaves, "a cited page that leaves you out is tagged");
  assert.match(leaves!, /\/app\/tallyroo\/opportunities\/[\w-]+$/);
  await resolves(leaves!);
  await ov.ctx.close();
  const ovOn = await open(APP);
  assert.deepEqual(await axe(ovOn.page), [], "axe on the Overview with its wave 2 parts (script on: axe is a script)");
  await ovOn.ctx.close();

  // 2. Your pages: the homepage's Organization fix is there to copy, as text, with no script.
  const kp = await open(`${APP}/pages/kp-1`, 1280, false);
  const block = await kp.page.locator("#fix-json-Organization").innerText();
  assert.match(block, /<script type="application\/ld\+json">/);
  assert.match(block, /"@type": "Organization"/);
  await kp.ctx.close();

  // 3. Actions: the matching item, started, then moved to Done with "Did you change the page?" answered.
  const pl = await open(`${APP}/plan`, 1280, false);
  await pl.page.locator('#item-pi-11 button[value="start"]').click();
  await pl.page.waitForURL(/done=started/, { timeout: 15_000 });
  const card = pl.page.locator("#item-pi-11");
  await card.locator('select[name="to"]').selectOption("done");
  await card.locator('select[name="changed"]').selectOption("yes");
  await card.locator('button[value="move"]').click();
  await pl.page.waitForURL(/done=moved/, { timeout: 15_000 });
  assert.match(await pl.page.locator('section[aria-labelledby="col-done"]').innerText(), /Fix the Organization schema on your homepage/);
  assert.match(await pl.page.locator("#item-pi-11").innerText(), /Marked done by you\./);
  await pl.ctx.close();

  // 4. The next weekly read of the homepage finds Organization with its required properties: P8's verifier says so,
  //    and the night job writes it to the item (P3's markVerified), as here on the fixture's write twin.
  const held = planRows().find((r) => r.id === "pi-11")!;
  const item = itemOf(held)!;
  assert.equal(item.status, "done");
  const page = { id: "kp-1", url: "https://tallyroo.com/", urlKey: "tallyroo.com", origin: "homepage", clusterIds: [], addedBy: "system", addedOn: "2026-09-01", removedOn: null, removedBy: null } as unknown as KeyPage;
  const read = {
    id: "pc-next", keyPageId: "kp-1", url: "https://tallyroo.com/", urlKey: "tallyroo.com", checkedAt: "2026-09-30T03:40:00Z", via: "own", trigger: "scheduled", status: "ok", httpStatus: 200, finalUrl: null, basics: null, fix: null,
    schemaFound: { blocks: [{ types: ["Organization"], props: ["name", "url", "logo", "sameAs"], via: "static" }], errors: 0, conflicts: [] }, schemaResults: null, contentHash: "next", wordCount: 640, renderedWordCount: null,
  } as unknown as PageCheck;
  const verdict = verifySchema(item, page, [read]);
  assert.deepEqual(verdict, { text: "Verified: Organization found with name, url, logo and sameAs, 30 Sep", at: "2026-09-30" });
  held.verified = { by: "key_pages_weekly", at: verdict!.at, text: verdict!.text };
  const pl2 = await open(`${APP}/plan?view=list&status=done`, 1280, false);
  assert.match(await pl2.page.locator("#item-pi-11").innerText(), /Verified: Organization found with name, url, logo and sameAs, 30 Sep/);
  await pl2.ctx.close();

  // 5. Opportunities: Pursue with a slot free in its cluster - the toast, and the prompt added.
  const freed = await post("stop?kind=prompt&id=q3-5", { kind: "prompt", id: "q3-5" });
  assert.equal(freed.status, 303);
  const op = await open(`${APP}/opportunities`, 1280, false);
  await op.page.locator('[data-opp-row="opp-invoicing"] button[value="pursue"]').click();
  await op.page.waitForURL(/\/opportunities\/opp-invoicing\?done=pursued/, { timeout: 15_000 });
  assert.equal(await toast(op.page), "Pursuing. It is checked weekly from now on.");
  assert.match(await op.page.locator('[data-opp-prompt="added"]').innerText(), /^Added 'best invoicing apps for freelancers' to 'invoicing software'/);
  await op.ctx.close();

  // 6. Clusters: the added prompt carries the Opportunity chip, and the chip opens the opportunity.
  const cl = await open(`${APP}/clusters?open=c3`, 1280, false);
  const chips = await cl.page.evaluate(() => [...document.querySelectorAll('[data-origin="opportunity"]')].map((e) => e.getAttribute("href")));
  assert.ok(chips.includes("/app/tallyroo/opportunities/opp-invoicing"), `the Opportunity chip links to the opportunity: ${JSON.stringify(chips)}`);
  await resolves("/app/tallyroo/opportunities/opp-invoicing");
  await cl.ctx.close();

  // 7. Google: Track a gaining keyword - Clusters opens prefilled with src=gaining; after Check keyword and the add, the
  //    new cluster's prompts carry the Momentum chip. Every cluster is in use on the fixture: stop the pending one first.
  const stop = await fetch(`${API}/stop?kind=cluster&id=c10`, { method: "POST", redirect: "manual" });
  assert.equal(stop.status, 303);
  const go = await open(`${APP}/google?gaining=1`, 1280, false);
  await go.page.locator('[data-gaining="receipt scanner app for small business"] [data-track]').click();
  await go.page.waitForURL(/\/clusters\?add=1&kw=receipt\+scanner\+app\+for\+small\+business&src=gaining/, { timeout: 15_000 });
  assert.equal(await go.page.locator("#kw-draft").inputValue(), "receipt scanner app for small business");
  await go.page.locator('section[aria-label="Add a cluster"] form[action*="/check"] button[type=submit]').click();
  await go.page.waitForURL(/ck=ok/, { timeout: 15_000 });
  assert.match(go.page.url(), /&src=gaining/);
  await go.page.locator('section[aria-label="Add a cluster"] form[action*="/cluster"] button[type=submit]').click();
  await go.page.waitForURL(/done=added/, { timeout: 15_000 });
  const momentum = await go.page.evaluate(() => [...document.querySelectorAll('[data-origin="momentum"]')].length);
  assert.equal(momentum, 5, "the added cluster's five prompts carry the Momentum chip");
  await go.ctx.close();
});

test("the journey's pages at 390: no sideways scroll, the phone's tabs, every screen saved", async () => {
  as("default");
  for (const [route, name] of [
    [APP, "overview"],
    [`${APP}/google?gaining=1`, "google"],
    [`${APP}/opportunities`, "opportunities"],
    [`${APP}/pages/kp-1`, "pages-detail"],
    [`${APP}/plan?view=list`, "plan"],
    [`${APP}/settings`, "settings"],
  ] as const) {
    for (const width of [390, 320]) {
      const { ctx, page, status } = await open(route, width);
      assert.equal(status, 200, route);
      assert.equal(await sideways(page), 0, `${route} at ${width}`);
      if (width === 390) {
        const tabs = await page.evaluate(() => [...document.querySelectorAll("nav.app-tabs > a .app-tab-label, nav.app-tabs > details > summary .app-tab-label")].map((s) => s.textContent));
        assert.deepEqual(tabs, ["Overview", "AI", "Google", "Actions", "More"], route);
      }
      await ctx.close();
    }
    await save(route, `${name}-wave2`, "full");
  }
});

// ------------------------------------------------------------ the shell's own

test("day 0: 'Where you stand today' from the reads before the first check, and the things to do before it", async () => {
  as("new");
  const { ctx, page, status } = await open(APP);
  assert.equal(status, 200);
  const stand = await page.locator("[data-where-you-stand]").innerText();
  assert.match(stand, /^Where you stand today/);
  assert.match(stand, /keywords rank for tallyroo\.com on Google/);
  assert.match(stand, /DataForSEO estimate, read \d{1,2} \w{3}/);
  assert.match(stand, /Your robots\.txt keeps [^.]*GPTBot[^.]* from some or all of your key pages\./);
  assert.match(stand, /Schema on your homepage: |No schema found on your homepage\./);
  assert.doesNotMatch(stand, /\d{1,2}:\d{2}/, "no clock time");
  const ids = await page.evaluate(() => [...document.querySelectorAll("[data-stand]")].map((e) => e.getAttribute("data-stand")));
  assert.deepEqual(ids, ["google", "pages", "crawlers", "schema"]);
  for (const href of await page.evaluate(() => [...document.querySelectorAll("[data-where-you-stand] a")].map((a) => a.getAttribute("href")!))) await resolves(href);
  const week = await page.locator("#this-week").innerText();
  assert.match(week, /^\d things? you can do before your first check/);
  assert.doesNotMatch(week, /done this week/, "these are not this week's pins");
  assert.deepEqual(await axe(page), []);
  await ctx.close();
  await save(APP, "overview-wave2", "day0");
  for (const width of [390, 320]) {
    const sm = await open(APP, width);
    assert.equal(await sideways(sm.page), 0, `day 0 at ${width}`);
    await sm.ctx.close();
  }

  // Dark: the footprint is a paid read, so its lines are left out; our own key-page and robots.txt reads still show.
  as("new", { diy: "dark" });
  const dark = await open(APP);
  const ids2 = await dark.page.evaluate(() => [...document.querySelectorAll("[data-stand]")].map((e) => e.getAttribute("data-stand")));
  assert.ok(!ids2.includes("google") && !ids2.includes("pages"), `no footprint line while dark: ${ids2.join(", ")}`);
  await dark.ctx.close();

  // After the first check the block is gone: the daily figures have taken over.
  as("default");
  const later = await open(APP);
  assert.equal(await later.page.locator("[data-where-you-stand]").count(), 0);
  await later.ctx.close();
});

test("Settings: this month's research - counts, never dollars - and only Pursuing while DIY is dark", async () => {
  as("default");
  const { ctx, page } = await open(`${APP}/settings`);
  const block = await page.locator('section[aria-labelledby="set-research"]').innerText();
  assert.match(block, /^This month's research/);
  assert.match(block, /Page checks\s+\d+ of 30 used/);
  assert.match(block, /Drafted examples\s+\d+ of 10/);
  assert.match(block, /Link checks\s+\d+ of 30/);
  assert.match(block, /Pursuing\s+\d+ of 10/);
  assert.match(block, /Resets \d{1,2} \w{3}\./);
  assert.doesNotMatch(block, /[$£€]|Link targets/, "no money, and no link targets until Links is built (wave 3)");
  assert.deepEqual(await axe(page), []);
  await ctx.close();
  as("default", { diy: "dark" });
  const dark = await open(`${APP}/settings`);
  const d = await dark.page.locator('section[aria-labelledby="set-research"]').innerText();
  assert.doesNotMatch(d, /Page checks|Drafted examples|Link checks/);
  assert.match(d, /Pursuing\s+\d+ of 10/);
  await dark.ctx.close();
  // A viewer reads it too.
  as("default", { role: "viewer" });
  const viewer = await open(`${APP}/settings`);
  assert.equal(await viewer.page.locator('section[aria-labelledby="set-research"]').count(), 1);
  await viewer.ctx.close();
});

test("the nav at 1280: Google, Opportunities and Your pages, each opening its page, and current on its own pages", async () => {
  as("default");
  const { ctx, page } = await open(`${APP}/google`);
  const current = await page.locator('aside.app-side a[aria-current="page"]').innerText();
  assert.match(current, /^Google/);
  const hrefs = await page.evaluate(() => [...document.querySelectorAll('aside.app-side nav[aria-label="Dashboard"] a')].map((a) => a.getAttribute("href")!));
  for (const h of hrefs) await resolves(h);
  for (const want of ["/app/tallyroo/google", "/app/tallyroo/opportunities", "/app/tallyroo/pages"]) assert.ok(hrefs.some((h) => h.startsWith(want)), want);
  await ctx.close();
  for (const [route, label] of [
    [`${APP}/opportunities`, "Opportunities"],
    [`${APP}/pages`, "Your pages"],
    [`${APP}/opportunities/opp-invoicing`, "Opportunities"],
    [`${APP}/pages/kp-1`, "Your pages"],
  ] as const) {
    const o = await open(route);
    assert.match(await o.page.locator('aside.app-side a[aria-current="page"]').innerText(), new RegExp(`^${label}`), route);
    await o.ctx.close();
  }
});

test("Actions: no U4 on the fixture, whose opportunity items are not three in Doing for three weeks", async () => {
  as("default");
  const { ctx, page } = await open(`${APP}/plan`);
  assert.equal(await page.locator('[data-upgrade-slot="plan"]').count(), 0);
  await ctx.close();
});
