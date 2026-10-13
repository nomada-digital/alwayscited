/**
 * DIY P5, Shell 1 (13 Oct 2026; spec 10 sections 3.1, 3.2 and 7.6): wave 1
 * as one product, on the fixture - TRACKING_FIXTURE=1, the tracking state,
 * role and DIY state switched per request - served in-process on the build,
 * as e2e/app/diy-plan.spec.mts serves it.
 *
 * Holds what section 7.6 asks of the shell: the nav groups at 1280 with
 * "Actions" as the label; the phone tabs at 390 (Overview, AI, Actions,
 * Clusters, then More; since 13 Oct 2026, DIY P9, Overview, AI, Google,
 * Actions, then More); More's sheet marks the current page and closes on
 * Escape and on a choice; "+ Add" is disabled for a viewer and on an ended
 * client, with the reason; the Actions badge's count. And what it mounts: the
 * Overview's This week (its writes with JS off, 303 and toast) and work log,
 * the chart's work markers, the origin basis line, and /ai's origin chips.
 * With section 7.0 item 7's: axe finds no serious or critical violation, no
 * sideways scroll at 390 and 320, every link resolves.
 *
 * Saves screens to test-results/diy/shell/<page>-<state>-<width>.png (1280x900
 * and 390x844) and the HTML to test-results/diy/shell/<page>-<state>.html for
 * the gating census (section 6.10 item 2). Not committed.
 *
 *   npm run build && E2E_PORT=3640 node --test e2e/app/diy-shell.spec.mts
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const OUT = path.join(ROOT, "test-results", "diy", "shell");
const require = createRequire(path.join(os.homedir(), "code/.parity/package.json"));
type Locator = {
  click(): Promise<void>;
  count(): Promise<number>;
  first(): Locator;
  innerText(): Promise<string>;
  isVisible(): Promise<boolean>;
  getAttribute(name: string): Promise<string | null>;
};
type Page = {
  goto(url: string, o?: object): Promise<{ status(): number } | null>;
  locator(sel: string): Locator;
  waitForURL(url: RegExp, o?: object): Promise<void>;
  waitForFunction<A>(fn: (a: A) => unknown, a?: A, o?: object): Promise<unknown>;
  waitForTimeout(ms: number): Promise<void>;
  evaluate<R>(fn: () => R | Promise<R>): Promise<R>;
  evaluate<R, A>(fn: (a: A) => R | Promise<R>, a: A): Promise<R>;
  addScriptTag(o: { content: string }): Promise<unknown>;
  screenshot(o: { path: string; fullPage?: boolean }): Promise<unknown>;
  content(): Promise<string>;
  url(): string;
  keyboard: { press(key: string): Promise<void> };
};
type Context = { newPage(): Promise<Page>; close(): Promise<void> };
type Browser = { newContext(o: object): Promise<Context>; close(): Promise<void> };
const { chromium } = require("playwright") as { chromium: { launch(): Promise<Browser> } };
const AXE = readFileSync(path.join(ROOT, "node_modules", "axe-core", "axe.min.js"), "utf8");

const PORT = Number(process.env.E2E_PORT ?? 3640);
const BASE = `http://localhost:${PORT}`;
const HOME = "/app/tallyroo";

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
  const phone = width < 600;
  const ctx = await browser.newContext({ viewport: { width, height: phone ? 844 : 900 }, javaScriptEnabled, ...(phone ? { isMobile: true, hasTouch: true } : {}) });
  const page = await ctx.newPage();
  const r = await page.goto(BASE + route, { waitUntil: "networkidle", timeout: 120_000 });
  return { ctx, page, status: r?.status() };
}

/** Until React has hydrated every control, a click does nothing (phone-harness.mts open). */
async function hydrated(page: Page) {
  await page.waitForFunction(() => [...document.querySelectorAll("button, a[href], summary")].every((el) => Object.keys(el).some((k) => k.startsWith("__reactFiber$"))), undefined, { timeout: 30_000 });
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

/** Each link answers 200 on this server. */
async function resolves(hrefs: string[]) {
  assert.ok(hrefs.length, "no links to follow");
  for (const h of [...new Set(hrefs)]) {
    const r = await fetch(new URL(h, BASE + HOME), { redirect: "manual" });
    assert.equal(r.status, 200, `${h} answered ${r.status}`);
  }
}

// ------------------------------------------------------------ the nav

test("1280: the nav in its groups, Overview alone, Actions the word for the Plan, the current page marked", async () => {
  as("default");
  const { ctx, page, status } = await open(`${HOME}/plan`);
  assert.equal(status, 200);
  const nav = await page.evaluate(() =>
    [...document.querySelectorAll('aside.app-side nav[aria-label="Dashboard"] > div')].map((g) => ({
      label: g.querySelector(":scope > span")?.textContent ?? null,
      items: [...g.querySelectorAll("a")].map((a) => (a.firstChild?.nextSibling?.textContent ?? "").trim()),
      hrefs: [...g.querySelectorAll("a")].map((a) => a.getAttribute("href")),
    })),
  );
  assert.deepEqual(
    nav.map((g) => [g.label, g.items]),
    [
      [null, ["Overview"]],
      ["Results", ["AI visibility", "Google", "Who is named", "Cited pages"]],
      ["Do", ["Actions", "Opportunities", "Links", "Your pages"]],
      ["Manage", ["Clusters", "Reports", "Settings"]],
    ],
    // 13 Oct 2026, DIY P9 (spec 10 section 3.1, after W2): Google in Results, Opportunities and Your pages in Do.
    // 13 Oct 2026, DIY P10 (spec 10 section 3.1, after W3): Links in Do, between Opportunities and Your pages.
    "the default fixture is on alwaystracked, so Do has no Placements (placed tiers')",
  );
  assert.match(nav[1]!.hrefs[1]!, /\/tallyroo\/google$/, "Google opens /google");
  assert.match(nav[2]!.hrefs[1]!, /\/tallyroo\/opportunities$/, "Opportunities opens /opportunities");
  assert.match(nav[2]!.hrefs[2]!, /\/tallyroo\/links$/, "Links opens /links");
  assert.match(nav[2]!.hrefs[3]!, /\/tallyroo\/pages$/, "Your pages opens /pages");
  assert.match(nav[2]!.hrefs[0]!, /\/tallyroo\/plan$/, "Actions opens /plan");
  // Group labels are MICRO and sentence case, never upper case, and never links.
  const labels = await page.evaluate(() => [...document.querySelectorAll('aside.app-side nav[aria-label="Dashboard"] > div > span')].map((s) => ({ t: s.textContent, tt: getComputedStyle(s).textTransform, fs: getComputedStyle(s).fontSize, a: !!s.closest("a") })));
  assert.deepEqual(labels, ["Results", "Do", "Manage"].map((t) => ({ t, tt: "none", fs: "12px", a: false })));
  assert.equal(await page.locator('aside.app-side a[aria-current="page"]').count(), 1);
  assert.match(await page.locator('aside.app-side a[aria-current="page"]').innerText(), /^Actions/);
  await ctx.close();

  const ai = await open(`${HOME}/ai`);
  assert.match(await ai.page.locator('aside.app-side a[aria-current="page"]').innerText(), /^AI visibility$/);
  await ai.ctx.close();
});

// 13 Oct 2026, DIY P9 (spec 10 section 3.2, final): Google takes Clusters' tab; Clusters moves into More.
test("390: the tabs are Overview, AI, Google, Actions and More; AI is current on AI visibility", async () => {
  as("default");
  const { ctx, page } = await open(`${HOME}/ai`, 390);
  const tabs = await page.evaluate(() => [...document.querySelectorAll("nav.app-tabs > a .app-tab-label, nav.app-tabs > details > summary .app-tab-label")].map((s) => s.textContent));
  assert.deepEqual(tabs, ["Overview", "AI", "Google", "Actions", "More"]);
  const current = await page.evaluate(() => [...document.querySelectorAll('nav.app-tabs > a[aria-current="page"] .app-tab-label')].map((s) => s.textContent));
  assert.deepEqual(current, ["AI"]);
  // Every tab is a 44px target or more (spec 3.2).
  const short = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>("nav.app-tabs > a, nav.app-tabs > details > summary")].filter((e) => e.getBoundingClientRect().height < 44).length);
  assert.equal(short, 0);
  await ctx.close();
});

test("390: More's sheet has the groups as headed lists, marks the current page, and closes on Escape and on a choice", async () => {
  as("default");
  const { ctx, page } = await open(`${HOME}/named`, 390);
  await hydrated(page);
  const isOpen = () => page.evaluate(() => document.querySelector<HTMLDetailsElement>("details.app-more")!.open);
  assert.match((await page.locator("details.app-more > summary").innerText()) + (await page.evaluate(() => document.querySelector("details.app-more > summary")?.textContent ?? "")), /current page: Who is named/);
  await page.locator("details.app-more > summary").click();
  assert.equal(await isOpen(), true);
  const sheet = await page.evaluate(() =>
    [...document.querySelectorAll('nav[aria-label="More of the dashboard"] > div')].map((g) => ({
      label: g.querySelector(":scope > span")?.textContent ?? null,
      links: [...g.querySelectorAll("a")].map((a) => ({ t: (a.textContent ?? "").trim(), on: a.getAttribute("aria-current") })),
    })),
  );
  assert.deepEqual(
    sheet.map((g) => [g.label, g.links.map((l) => l.t)]),
    [
      ["Add", ["Add a keyword", "Add a prompt", "Add a task", "Add a page to check", "Log a site I found"]],
      ["Results", ["Who is named", "Cited pages"]],
      ["Do", ["Opportunities", "Links", "Your pages"]],
      ["Manage", ["Clusters", "Reports", "Settings"]],
    ],
  );
  assert.deepEqual(
    sheet.flatMap((g) => g.links).filter((l) => l.on === "page").map((l) => l.t),
    ["Who is named"],
  );
  await page.screenshot({ path: path.join(OUT, "more-open-390.png") });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(100);
  assert.equal(await isOpen(), false, "Escape left More open");
  // A choice that leaves the page closes it.
  await page.locator("details.app-more > summary").click();
  await page.locator('nav[aria-label="More of the dashboard"] a:has-text("Reports")').click();
  await page.waitForURL(/\/tallyroo\/reports/, { timeout: 15_000 });
  await page.waitForTimeout(150);
  assert.equal(await isOpen(), false, "a choice left More open");
  // So does one that stays on the page: Add a keyword from Clusters opens Clusters' add panel.
  await page.goto(`${BASE}${HOME}/clusters`, { waitUntil: "networkidle" });
  await hydrated(page);
  await page.locator("details.app-more > summary").click();
  await page.locator('nav[aria-label="More of the dashboard"] a:has-text("Add a keyword")').click();
  await page.waitForURL(/\/tallyroo\/clusters\?add=1/, { timeout: 15_000 });
  await page.waitForTimeout(150);
  assert.equal(await isOpen(), false, "a choice on the same page left More open");
  await page.screenshot({ path: path.join(OUT, "more-default-390.png") });
  await ctx.close();
});

// 13 Oct 2026, DIY P9: five forms - wave 2's "Add a page to check" (Your pages' add form) and "Log a site I found"
// (Opportunities' Log a site form), each landing on its form's anchor.
test("+ Add: an owner's opens its five forms, each resolving; a viewer and an ended client see it disabled with the reason", async () => {
  as("default");
  const owner = await open(HOME);
  await hydrated(owner.page);
  await owner.page.locator("details.app-add > summary").click();
  const links = await owner.page.evaluate(() => [...document.querySelectorAll<HTMLAnchorElement>('details.app-add [role="group"][aria-label="Add"] a')].map((a) => [a.textContent, a.getAttribute("href")!]));
  assert.deepEqual(links.map(([t]) => t), ["Add a keyword", "Add a prompt", "Add a task", "Add a page to check", "Log a site I found"]);
  assert.match(links[0]![1], /\/tallyroo\/clusters\?add=1$/);
  assert.match(links[2]![1], /\/tallyroo\/plan\?view=list#new-task$/);
  assert.match(links[3]![1], /\/tallyroo\/pages#add$/);
  assert.match(links[4]![1], /\/tallyroo\/opportunities#log$/);
  await resolves(links.map(([, h]) => h));
  // The task form is where Add a task lands; the page and log forms are where theirs land.
  const task = await fetch(new URL(links[2]![1], BASE));
  assert.ok((await task.text()).includes('id="new-task"'), "Add a task's anchor is on Actions");
  assert.ok((await (await fetch(new URL(links[3]![1], BASE))).text()).includes('id="add"'), "Add a page to check's anchor is on Your pages");
  assert.ok((await (await fetch(new URL(links[4]![1], BASE))).text()).includes('id="log"'), "Log a site I found's anchor is on Opportunities");
  await owner.page.screenshot({ path: path.join(OUT, "add-default-1280.png") });
  await owner.ctx.close();

  for (const [state, role, why] of [
    ["default", "viewer", "Viewers can't change this. Ask an owner or editor."],
    ["ended", "owner", "This client's tracking has ended, so nothing can be added."],
  ] as const) {
    as(state, { role });
    const { ctx, page } = await open(HOME);
    assert.equal(await page.locator("details.app-add").count(), 0, `${state} ${role}: + Add opens`);
    const off = page.locator('aside.app-side [data-add="off"]');
    assert.equal(await off.getAttribute("aria-disabled"), "true");
    assert.equal(await page.evaluate(() => document.getElementById(document.querySelector('aside.app-side [data-add="off"]')!.getAttribute("aria-describedby")!)?.textContent), why);
    await ctx.close();
    const sm = await open(HOME, 390);
    assert.equal(await sm.page.evaluate(() => document.querySelector("#add-why-sm")?.textContent), why, `${state} ${role}: the phone's sheet`);
    assert.equal(await sm.page.evaluate(() => document.querySelectorAll('nav[aria-label="More of the dashboard"] a[href*="add=1"]').length), 0);
    await sm.ctx.close();
  }
});

test("the Actions badge: done of this week's pinned items, on the sidebar and the phone tab; none with nothing pinned", async () => {
  as("default");
  const { ctx, page } = await open(`${HOME}/named`);
  assert.equal(await page.evaluate(() => document.querySelector("aside.app-side [data-actions-badge]")?.textContent), ", 1 of 3 this week");
  await ctx.close();
  const sm = await open(`${HOME}/named`, 390);
  assert.equal(await sm.page.evaluate(() => document.querySelector('nav.app-tabs [data-actions-badge="compact"]')?.textContent), "1/3");
  // The tab's "1/3" is drawn for the eye and hidden from a screen reader, which is read the words instead.
  assert.equal(await sm.page.evaluate(() => document.querySelector('nav.app-tabs [data-actions-badge="compact"]')?.getAttribute("aria-hidden")), "true");
  assert.match(await sm.page.evaluate(() => document.querySelector('nav.app-tabs a[href$="/plan"] .sr-only')?.textContent ?? ""), /^, 1 of 3 this week$/);
  await sm.ctx.close();
  // It counts as Actions' This week does: a pinned item moved to Done is one more done.
  as("default", { write: true });
  const body = new FormData();
  body.set("do", "move");
  body.set("to", "done");
  const r = await fetch(`${BASE}/api/app/tallyroo/plan?id=pi-02`, { method: "POST", body, redirect: "manual" });
  assert.equal(r.status, 303);
  const after = await (await fetch(`${BASE}${HOME}/named`)).text();
  assert.ok(after.includes(">2 of 3 this week<"), "the badge did not follow the move");
  // Nothing pinned, no badge - never "0 of 0".
  as("default", { diy: "day0" });
  const day0 = await (await fetch(`${BASE}${HOME}/named`)).text();
  assert.ok(!day0.includes("data-actions-badge"), "a badge with nothing pinned");
});

// ------------------------------------------------------------ what the shell mounts

test("the Overview: This week with its three, the work log, and the work markers on the cluster's chart", async () => {
  as("default");
  const { ctx, page } = await open(`${HOME}?cluster=c4`);
  const week = await page.locator("#this-week").innerText();
  assert.equal(await page.locator("#this-week ol > li").count(), 3);
  assert.match(week, /1 of 3 done this week · All 16 open items/);
  const log = await page.evaluate(() => document.querySelector('section[aria-labelledby="log-h"]')?.textContent ?? "");
  assert.match(log, /Work log, last 30 days/);
  assert.match(log, /Done: /);
  assert.match(log, /Too early to read/);
  // Cluster c4's chart: pi-05 done 5 Sep, pi-02 started 28 Sep, each linking to Actions on c4.
  const marks = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>("[data-mark]")].map((m) => ({ kind: m.getAttribute("data-mark"), href: m.getAttribute("href"), label: m.getAttribute("aria-label") })));
  assert.ok(marks.some((m) => /done/.test(m.kind ?? "") && /Done: /.test(m.label ?? "")), `no done marker: ${JSON.stringify(marks)}`);
  assert.ok(marks.some((m) => /started/.test(m.kind ?? "")), `no started marker: ${JSON.stringify(marks)}`);
  assert.ok(marks.every((m) => !m.href || /\/tallyroo\/plan\?view=list&cluster=c4$/.test(m.href)), "a marker opens Actions on its cluster");
  // Every link This week and the log draw resolves.
  await resolves(await page.evaluate(() => [...document.querySelectorAll<HTMLAnchorElement>('#this-week a[href], section[aria-labelledby="log-h"] a[href]')].map((a) => a.getAttribute("href")!)));
  // Another cluster's chart draws none of c4's work.
  await page.goto(`${BASE}${HOME}?cluster=c1`, { waitUntil: "networkidle" });
  const c1 = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>("[data-mark]")].map((m) => m.getAttribute("href") ?? ""));
  assert.ok(c1.every((h) => !/cluster=c4/.test(h)), "c4's work on c1's chart");
  await ctx.close();
  await save(HOME, "overview", "full");
});

test("the Overview before the first check: This week says when it fills in", async () => {
  // A client with no check yet has no plan items either: the DIY day0 state beside the tracking new state.
  as("new", { diy: "day0" });
  const { ctx, page } = await open(HOME);
  assert.match(await page.locator("#this-week").innerText(), /Your actions fill in after your first check\./);
  await ctx.close();
});

test("JS off: This week's Start and Not now on the Overview are a 303 back to the Overview with the toast", async () => {
  as("default", { write: true });
  const { ctx, page } = await open(HOME, 1280, false);
  await page.locator('#this-week form[action*="id=pi-01"] button[value="start"]').click();
  await page.waitForURL(/\/tallyroo\?plan=started#this-week$/, { timeout: 15_000 });
  assert.match(await page.locator('#this-week p[role="status"]').innerText(), /^Moved to Doing\.$/);
  await ctx.close();
  // A refusal keeps its reason in the one key.
  const body = new FormData();
  body.set("do", "later");
  const r = await fetch(`${BASE}/api/app/tallyroo/plan?back=overview&id=pi-99`, { method: "POST", body, redirect: "manual" });
  const back = r.headers.get("location")!;
  assert.match(back, /\?plan=refused-gone#this-week$/);
  const { ctx: c2, page: p2 } = await open(back.replace(/^https?:\/\/[^/]+/, ""), 1280, false);
  assert.ok((await p2.locator('#this-week p[role="status"]').innerText()).length > 0, "the refusal drew no toast");
  await c2.close();
});

test("a viewer's This week on the Overview: every control disabled, with the reason", async () => {
  as("default", { role: "viewer" });
  const { ctx, page } = await open(HOME);
  const controls = await page.evaluate(() => [...document.querySelectorAll<HTMLButtonElement>("#this-week form button")].map((b) => ({ off: b.disabled, why: b.getAttribute("aria-describedby") })));
  assert.ok(controls.length >= 2 && controls.every((c) => c.off && c.why), JSON.stringify(controls));
  assert.match(await page.locator("#this-week").innerText(), /Viewers can't change this\. Ask an owner or editor\./);
  await ctx.close();
});

test("placed: the origin basis line names the prompts added from placements and opens the figures on the chosen ones", async () => {
  as("placed");
  const { ctx, page } = await open(HOME);
  const line = await page.evaluate(() => document.querySelector('[data-basis="origins"]')?.textContent ?? "");
  // Two of the three are live: the third, a link insertion retried after the switch went on, is first asked tomorrow.
  assert.match(line, /^Includes 2 prompts added from placements\. /);
  const href = await page.evaluate(() => document.querySelector<HTMLAnchorElement>('[data-basis="origins"] a')!.getAttribute("href")!);
  assert.match(href, /\/tallyroo\/ai\?.*origin=chosen/);
  await resolves([href]);
  await ctx.close();
  await save(HOME, "overview", "placed");
});

test("/ai: a row draws its recorded origin's chip, and the chart its work markers", async () => {
  as("placed");
  const { ctx, page } = await open(`${HOME}/ai`);
  const chips = await page.evaluate(() => [...document.querySelectorAll("[data-prompt] [data-origin]")].map((c) => c.getAttribute("data-origin")));
  assert.ok(chips.includes("placement"), `no placement chip: ${chips.join(", ")}`);
  assert.ok(chips.includes("setup") && chips.includes("client") && chips.includes("nomada"), chips.join(", "));
  await resolves(await page.evaluate(() => [...document.querySelectorAll<HTMLAnchorElement>("[data-prompt] a[data-origin]")].map((a) => a.getAttribute("href")!)));
  await ctx.close();
  as("placed-agency");
  const agency = await open(`${HOME}/ai`);
  assert.doesNotMatch(await agency.page.evaluate(() => document.querySelector("main, #app-content")!.textContent ?? ""), /nomada/i, "agency mode names Nomada on /ai");
  await agency.ctx.close();
  as("default");
  const d = await open(`${HOME}/ai`);
  const marks = await d.page.evaluate(() => [...document.querySelectorAll<HTMLElement>("#ai-chart [data-mark]")].map((m) => m.getAttribute("data-mark")));
  assert.ok(marks.some((k) => /done/.test(k ?? "")), `no done marker on /ai's chart: ${marks.join(", ")}`);
  assert.ok(!marks.some((k) => /started/.test(k ?? "")), "AI visibility draws done items, not started ones");
  await d.ctx.close();
  as("default");
  await save(`${HOME}/ai`, "ai", "shell");
  await save(`${HOME}/plan`, "plan", "shell");
});

// ------------------------------------------------------------ section 7.0 item 7

test("axe: no serious or critical violation on the Overview, /ai and /plan, at 1280 and 390, with More and + Add open", async () => {
  as("default");
  for (const [route, width] of [
    [HOME, 1280],
    [HOME, 390],
    [`${HOME}/ai`, 1280],
    [`${HOME}/plan`, 390],
  ] as const) {
    const { ctx, page } = await open(route, width);
    await hydrated(page);
    await page.locator(width < 600 ? "details.app-more > summary" : "details.app-add > summary").click();
    assert.deepEqual(await axe(page), [], `${route} at ${width}`);
    await ctx.close();
  }
  as("default", { role: "viewer" });
  const v = await open(HOME);
  assert.deepEqual(await axe(v.page), [], "the viewer's Overview");
  await v.ctx.close();
});

test("no sideways scroll at 390 and 320, with More open, on the Overview, /ai and /plan", async () => {
  as("default");
  for (const route of [HOME, `${HOME}/ai`, `${HOME}/plan`]) {
    for (const width of [390, 320]) {
      const { ctx, page } = await open(route, width);
      assert.equal(await sideways(page), 0, `${route} at ${width}`);
      await hydrated(page);
      await page.locator("details.app-more > summary").click();
      assert.equal(await sideways(page), 0, `${route} at ${width} with More open`);
      const sheet = await page.evaluate(() => {
        const r = document.querySelector('nav[aria-label="More of the dashboard"]')!.getBoundingClientRect();
        return { top: r.top, left: r.left, right: r.right, w: innerWidth };
      });
      assert.ok(sheet.top >= 0 && sheet.left >= 0 && sheet.right <= sheet.w, `More's sheet off screen at ${width}: ${JSON.stringify(sheet)}`);
      await ctx.close();
    }
  }
});
