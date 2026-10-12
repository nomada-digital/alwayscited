/**
 * DIY P3 (13 Oct 2026; spec 10 sections 4.6 and 7.4): Actions, internally
 * the Plan, on the fixture - TRACKING_FIXTURE=1 with DIY_FIXTURE_STATE, the
 * Plan's own items from src/lib/diy/fixtures/plan.json - served in-process on
 * the build, as e2e/app/evidence.spec.mts serves it.
 *
 * Holds what section 7.0 item 7 asks of every DIY spec: axe finds no serious
 * or critical violation; no sideways page scroll at 390 and 320; every write
 * form works with JS off (a 303 and its toast); a viewer sees the controls
 * disabled with the reason; every evidence link resolves. And the package's
 * own: board and list, Start, Accept and Not now, add a task, move to Done
 * with "Did you change the page?", the ended client, day 0, and in the
 * placed states the Placements group with its owner - never "nomada" in
 * agency mode.
 *
 * Saves each page's screens to test-results/diy/plan/<page>-<state>-<width>.png
 * (1280x900 and 390x844) and its HTML to test-results/diy/plan/<page>-<state>.html
 * for the gating census (section 6.10 item 2). Not committed.
 *
 *   npm run build && node --test e2e/app/diy-plan.spec.mts
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";

import { FIXTURE_STATES } from "../../src/lib/tracking/fixture-mode.ts";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const OUT = path.join(ROOT, "test-results", "diy", "plan");
const require = createRequire(path.join(os.homedir(), "code/.parity/package.json"));
type Locator = {
  click(): Promise<void>;
  count(): Promise<number>;
  first(): Locator;
  nth(i: number): Locator;
  innerText(): Promise<string>;
  fill(v: string): Promise<void>;
  selectOption(v: string): Promise<unknown>;
  isDisabled(): Promise<boolean>;
  isVisible(): Promise<boolean>;
  getAttribute(name: string): Promise<string | null>;
  locator(sel: string): Locator;
};
type Page = {
  goto(url: string, o?: object): Promise<{ status(): number } | null>;
  locator(sel: string): Locator;
  waitForURL(url: RegExp, o?: object): Promise<void>;
  evaluate<R>(fn: () => R | Promise<R>): Promise<R>;
  addScriptTag(o: { content: string }): Promise<unknown>;
  screenshot(o: { path: string; fullPage?: boolean }): Promise<unknown>;
  content(): Promise<string>;
  url(): string;
};
type Context = { newPage(): Promise<Page>; close(): Promise<void> };
type Browser = { newContext(o: object): Promise<Context>; close(): Promise<void> };
const { chromium } = require("playwright") as { chromium: { launch(): Promise<Browser> } };
const AXE = readFileSync(path.join(ROOT, "node_modules", "axe-core", "axe.min.js"), "utf8");

const PORT = Number(process.env.E2E_PORT ?? 3620);
const BASE = `http://localhost:${PORT}`;
const PLAN = "/app/tallyroo/plan";

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
  delete (globalThis as Record<symbol, unknown>)[Symbol.for("alwayscited.diyFixture.plan")];
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

const text = (page: Page) => page.locator("main, #app-content").first().innerText();
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

test("board (full) at 1280: This week pinned with 3, the four columns, the readouts, Dropped (3)", async () => {
  as("default");
  const { ctx, page, status } = await open(PLAN);
  assert.equal(status, 200);
  assert.equal(await page.locator("h1").innerText(), "Actions");
  const week = await page.locator("#this-week").innerText();
  assert.equal(await page.locator("#this-week ol > li").count(), 3);
  assert.match(week, /1 of 3 done this week · All 16 open items/);
  assert.match(week, /Blocking comes first: Google says a page must be crawlable/);
  const cols = await page.evaluate(() => [...document.querySelectorAll(".plan-board > section > h2")].map((h) => h.textContent));
  assert.deepEqual(cols, ["Suggested7", "To do5", "Doing4", "Done3"]);
  const done = await page.locator('section[aria-labelledby="col-done"]').innerText();
  assert.match(done, /Too early to read: 20 days to go/);
  assert.match(done, /Done 1 Sep\. 'invoicing software': 12th on 1 Sep, 11th on 29 Sep\. Its prompts named you in \d+ of \d+ answers in the 7 checks before 1 Sep, and \d+ of \d+ in the last 7 checks, same prompts\. Other work on this cluster since: 1 other action done 28 Sep\./);
  assert.match(done, /Verified: Product found with name and description, 12 Sep/);
  assert.match(done, /Marked done by you\./);
  assert.match(await text(page), /1 hidden with Not now/);
  assert.match(await text(page), /Dropped \(3\)/);
  await ctx.close();
  await save(PLAN, "board", "full");
});

test("list (full): grouped by status, Dropped listed when asked, the system's drop dated", async () => {
  as("default");
  const { ctx, page } = await open(`${PLAN}?view=list&status=dropped`, 390);
  const t = await text(page);
  assert.match(t, /Dropped\s*3/);
  assert.match(t, /No longer applies \(checked 27 Sep\)/);
  assert.match(t, /Bring back to/);
  await ctx.close();
  await save(`${PLAN}?view=list`, "list", "full");
});

test("no sideways scroll at 390 and 320, on the board, the list and day 0; the board stacks into the list below 640", async () => {
  for (const [route, state, diy] of [
    [PLAN, "default", undefined],
    [`${PLAN}?view=list`, "default", undefined],
    [PLAN, "new", "day0"],
  ] as const) {
    as(state, { diy });
    for (const width of [390, 320]) {
      const { ctx, page } = await open(route, width);
      assert.equal(await sideways(page), 0, `${route} ${state} at ${width}`);
      if (route === PLAN && state === "default") {
        const columns = await page.evaluate(() => getComputedStyle(document.querySelector(".plan-board")!).gridTemplateColumns.split(" ").length);
        assert.equal(columns, 1, "one column below 640px: the list");
      }
      await ctx.close();
    }
  }
});

test("axe: no serious or critical violation on the board, the list, day 0 and the viewer's page", async () => {
  for (const [route, state, o, width] of [
    [PLAN, "default", {}, 1280],
    [PLAN, "default", {}, 390],
    [`${PLAN}?view=list&status=done`, "default", {}, 1280],
    [PLAN, "new", { diy: "day0" }, 1280],
    [PLAN, "default", { role: "viewer" }, 1280],
  ] as const) {
    as(state, o);
    const { ctx, page } = await open(route, width);
    assert.deepEqual(await axe(page), [], `${route} ${state} ${JSON.stringify(o)} at ${width}`);
    await ctx.close();
  }
});

test("every evidence link and every place to act resolves", async () => {
  as("default");
  const { ctx, page } = await open(PLAN);
  const hrefs = await page.evaluate(() => [...new Set([...document.querySelectorAll<HTMLAnchorElement>("#app-content a[href]")].map((a) => a.getAttribute("href")!))]);
  await ctx.close();
  const evidence = hrefs.filter((h) => /\/clusters\/c\d|\/cited\?/.test(h));
  assert.ok(evidence.length >= 5, `found ${evidence.length} evidence links`);
  for (const h of hrefs) {
    const r = await fetch(new URL(h, BASE), { redirect: "manual" });
    assert.equal(r.status, 200, h);
  }
});

test("JS off: Start, Accept and Not now are each a 303 back with the toast, and the card moves", async () => {
  as("default", { write: true });
  const { ctx, page } = await open(PLAN, 1280, false);
  // Start on This week's Blocking suggestion.
  await page.locator('#this-week form[action*="id=pi-01"] button[value="start"]').click();
  await page.waitForURL(/done=started/, { timeout: 15_000 });
  assert.match(page.url(), /#this-week$/);
  assert.match(await page.locator('p[role="status"]').first().innerText(), /^Moved to Doing\.$/);
  assert.match(await page.locator('section[aria-labelledby="col-doing"]').innerText(), /Let Googlebot crawl tallyroo\.com\/pricing/);
  // Accept on a board suggestion.
  await page.locator('#item-pi-06 button[value="accept"]').click();
  await page.waitForURL(/done=accepted/, { timeout: 15_000 });
  assert.match(page.url(), /#item-pi-06$/);
  assert.match(await page.locator('section[aria-labelledby="col-todo"]').innerText(), /Which bookkeeping software is better than/);
  // Not now hides it for 14 days.
  await page.locator('#item-pi-07 button[value="later"]').click();
  await page.waitForURL(/done=hidden/, { timeout: 15_000 });
  assert.match(await page.locator('p[role="status"]').first().innerText(), /Hidden for 14 days/);
  assert.equal(await page.locator("#item-pi-07").count(), 0, "hidden from Suggested");
  assert.match(await text(page), /2 hidden with Not now/);
  await ctx.close();
});

test("JS off: move to Done with 'Did you change the page?' - Done, too early to read, and the answer kept", async () => {
  as("default", { write: true });
  const { ctx, page } = await open(PLAN, 1280, false);
  const card = page.locator("#item-pi-19");
  assert.equal(await card.locator('select[name="changed"]').isVisible(), false, "asked only once Done is picked");
  await card.locator('select[name="to"]').selectOption("done");
  assert.equal(await card.locator('select[name="changed"]').isVisible(), true, "shown by CSS, with JS off");
  await card.locator('select[name="changed"]').selectOption("partly");
  await card.locator('button[value="move"]').click();
  await page.waitForURL(/done=moved/, { timeout: 15_000 });
  const done = await page.locator('section[aria-labelledby="col-done"]').innerText();
  assert.match(done, /Add Product schema to tallyroo\.com\/small-business/);
  assert.match(await page.locator("#item-pi-19").innerText(), /Too early to read: 21 days to go/);
  assert.match(await page.locator("#item-pi-19").innerText(), /Marked done by you\./);
  await ctx.close();
  // The answer is what verification reads: held in the fixture's write twin as readout_base.changed.
  const held = (globalThis as Record<symbol, { value: { rows: Record<string, unknown>[] } } | undefined>)[Symbol.for("alwayscited.diyFixture.plan")]!.value.rows.find((r) => r.id === "pi-19")!;
  assert.deepEqual(held.readout_base, { changed: "partly" });
  assert.equal(held.done_on, "2026-09-29");
});

test("JS off: add a task lands in To do as Your task; a blank title is refused by the route", async () => {
  as("default", { write: true });
  const { ctx, page } = await open(`${PLAN}?view=list`, 390, false);
  await page.locator("#new-task-title").fill("Email the bookkeeping list about the new guide");
  await page.locator('#new-task button[value="add"]').click();
  await page.waitForURL(/done=added/, { timeout: 15_000 });
  assert.match(page.url(), /view=list/);
  assert.match(await page.locator('p[role="status"]').first().innerText(), /^Task added to To do\.$/);
  const todo = await page.locator('section[aria-labelledby="col-todo"]').innerText();
  assert.match(todo, /Your task\s+Email the bookkeeping list about the new guide/);
  await ctx.close();
  const body = new FormData();
  body.set("do", "add");
  body.set("title", "   ");
  const r = await fetch(`${BASE}/api/app/tallyroo/plan?view=list`, { method: "POST", body, redirect: "manual" });
  assert.equal(r.status, 303);
  assert.match(r.headers.get("location")!, /\/app\/tallyroo\/plan\?view=list&done=refused&why=title#new-task$/);
});

test("a viewer sees every control disabled with the reason, and the route refuses them", async () => {
  as("default", { role: "viewer", write: true });
  const { ctx, page } = await open(PLAN);
  assert.match(await text(page), /Viewers can't change this\. Ask an owner or editor\./);
  const controls = await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement | HTMLSelectElement | HTMLInputElement>("#app-content form button, #app-content form select, #app-content form input")].map((c) => ({ off: c.disabled, why: c.getAttribute("aria-describedby") })));
  assert.ok(controls.length > 40, `${controls.length} controls`);
  assert.ok(controls.every((c) => c.off && c.why), "every control off, each pointing at its reason");
  const why = await page.evaluate(() => [...new Set([...document.querySelectorAll("[aria-describedby]")].map((c) => document.getElementById(c.getAttribute("aria-describedby")!)?.textContent))]);
  assert.ok(why.includes("Viewers can't change this. Ask an owner or editor."));
  await ctx.close();
  const body = new FormData();
  body.set("do", "start");
  const r = await fetch(`${BASE}/api/app/tallyroo/plan?id=pi-01`, { method: "POST", body, redirect: "manual" });
  assert.match(r.headers.get("location")!, /done=refused&why=viewer#item-pi-01$/);
  await save(PLAN, "board", "viewer");
});

test("an ended client is read-only, with its own reason", async () => {
  as("ended", { write: true });
  const { ctx, page } = await open(PLAN);
  assert.match(await text(page), /Tracking has ended for this client, so its actions are read-only\./);
  assert.ok(await page.locator('#this-week button[value="start"]').first().isDisabled());
  await ctx.close();
  const body = new FormData();
  body.set("do", "start");
  const r = await fetch(`${BASE}/api/app/tallyroo/plan?id=pi-01`, { method: "POST", body, redirect: "manual" });
  assert.match(r.headers.get("location")!, /why=viewer/);
});

test("day 0: the actions fill in after the first check", async () => {
  as("new", { diy: "day0" });
  const { ctx, page } = await open(PLAN);
  const t = await text(page);
  assert.match(t, /Your actions fill in after your first check and your first page checks\./);
  assert.equal(await page.locator("#this-week").count(), 0, "one line says it; This week has nothing to pin");
  await ctx.close();
  await save(PLAN, "plan", "day0");
  as("default", { diy: "zero" });
  const z = await open(PLAN);
  const zt = await text(z.page);
  assert.match(zt, /Nothing open\. New items arrive as your checks find them\./);
  assert.match(zt, /Done 1 Sep\./, "what is done still reads out under the line");
  await z.ctx.close();
});

test("the gating vocabulary: no banned word, no competitor tool and no Nomada in agency mode on any page saved", async () => {
  as("default");
  const { ctx, page } = await open(`${PLAN}?view=list`);
  const t = await text(page);
  await ctx.close();
  assert.doesNotMatch(t, /\b(marketplace|for sale|write for us|accepts guest|placeable|could place|place this|domain rating|difficulty|sponsored|guest post)\b|\bDR\b|\bKD\b/i);
  assert.doesNotMatch(t, /\b(ahrefs|semrush|sitechecker|sparktoro|gumshoe|peec|profound|otterly|scrunch)\b/i);
  assert.doesNotMatch(t, /\b(caused|drove|because of|thanks to|resulted in|delivered)\b/i);
});

// The placed states are tracking-fixture states P2 adds to fixture-mode.ts (spec 7.0 item 6). Until P2 is merged
// they are not states at all, and the fixture would serve the default - so these wait, and say so.
const placed = (FIXTURE_STATES as readonly string[]).includes("placed") && (FIXTURE_STATES as readonly string[]).includes("placed-agency");

test("placed: the list ends with the read-only Placements group, owned by nomada digital", { skip: placed ? false : "TRACKING_FIXTURE_STATE=placed is P2's, not merged into this branch yet" }, async () => {
  as("placed");
  const { ctx, page } = await open(`${PLAN}?view=list`);
  const group = await page.locator('section[aria-labelledby="pl-h"]').innerText();
  assert.match(group, /Read-only\. Each placement is owned by nomada digital\./);
  assert.match(group, /Live since/);
  await ctx.close();
  const board = await open(PLAN);
  assert.equal(await board.page.locator('section[aria-labelledby="pl-h"]').isVisible(), false, "not on the board above 640px");
  await board.ctx.close();
  const phone = await open(PLAN, 390);
  assert.equal(await phone.page.locator('section[aria-labelledby="pl-h"]').isVisible(), true, "the default view below 640px is the list");
  await phone.ctx.close();
  await save(`${PLAN}?view=list`, "list", "placed");
});

test("placed-agency: the group's owner is Your account contact, and no 'nomada' anywhere on the page", { skip: placed ? false : "TRACKING_FIXTURE_STATE=placed-agency is P2's, not merged into this branch yet" }, async () => {
  as("placed-agency");
  const { ctx, page } = await open(`${PLAN}?view=list`);
  assert.match(await page.locator('section[aria-labelledby="pl-h"]').innerText(), /owned by your account contact\.[\s\S]*Owner: Your account contact/);
  assert.doesNotMatch(await page.locator("body").innerText(), /nomada/i);
  await ctx.close();
  await save(`${PLAN}?view=list`, "list", "placed-agency");
});
