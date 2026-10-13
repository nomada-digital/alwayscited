/**
 * DIY P4 (13 Oct 2026; spec 10 section 7.5): the rebuilt Overview and the AI
 * visibility page, on the tracking fixture, signed in.
 *
 *   npm run build && node --test e2e/app/diy-results.spec.mts
 *
 * One `next start` per fixture state, each on its own port (3631-3634), so
 * the states run side by side; VERCEL_ENV=development is set, never left to a
 * pulled .env.local. Playwright from ~/code/.parity, axe from the repo's own
 * axe-core, as the other e2e/app specs.
 *
 * It holds: the headline's variant text, the What it means bullets and the
 * Since last check lines with every link resolving; the "Download CSV" label;
 * /ai in its default view, the missing lens, ChatGPT like-for-like, and before
 * the first check; every evidence link opening an answer within three
 * clicks; axe with no serious or critical finding; no sideways scroll at 390
 * and 320; JS off; and the one write the pages carry (the upgrade prompt's
 * hide) with JS off. It saves each page's screen at 1280x900 and 390x844 and
 * its HTML to test-results/diy/p4/, for the builder to look at and the gating
 * census to sweep (section 6.10 item 2).
 */
import { type ChildProcess, spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const require = createRequire(path.join(os.homedir(), "code/.parity/package.json"));
const AXE = readFileSync(path.join(ROOT, "node_modules", "axe-core", "axe.min.js"), "utf8");
const OUT = path.join(ROOT, "test-results", "diy", "p4");
const HOME = "/app/tallyroo";

type Locator = { count(): Promise<number>; first(): Locator; nth(i: number): Locator; click(): Promise<void>; getAttribute(n: string): Promise<string | null>; innerText(): Promise<string> };
type Page = {
  goto(url: string, o?: object): Promise<{ status(): number } | null>;
  url(): string;
  content(): Promise<string>;
  evaluate<R>(fn: () => R | Promise<R>): Promise<R>;
  evaluate<R, A>(fn: (a: A) => R | Promise<R>, a: A): Promise<R>;
  addScriptTag(o: { content: string }): Promise<unknown>;
  locator(sel: string): Locator;
  screenshot(o: { path: string; fullPage?: boolean }): Promise<unknown>;
  waitForURL(url: RegExp, o?: object): Promise<void>;
  waitForFunction(fn: () => unknown, a?: unknown, o?: object): Promise<unknown>;
};
type Context = { newPage(): Promise<Page>; close(): Promise<void> };
type Browser = { newContext(o: object): Promise<Context>; close(): Promise<void> };
const { chromium } = require("playwright") as { chromium: { launch(): Promise<Browser> } };

const STATES = { default: 3631, new: 3632, partial: 3633 } as const;
type State = keyof typeof STATES;
const servers: ChildProcess[] = [];
// localhost, not 127.0.0.1: the routes' 303s are built for the request's host (app-redirect.ts dashUrl), which says localhost.
const base = (s: State) => `http://localhost:${STATES[s]}`;
let browser: Browser;

async function up(state: State): Promise<void> {
  const child = spawn(process.execPath, [path.join(ROOT, "node_modules", "next", "dist", "bin", "next"), "start", "-p", String(STATES[state])], {
    cwd: ROOT,
    env: { ...process.env, TRACKING_FIXTURE: "1", TRACKING_FIXTURE_STATE: state, VERCEL_ENV: "development", NODE_ENV: "production" },
    stdio: "ignore",
  });
  servers.push(child);
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(`${base(state)}/app/login`)).status === 200) return;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`the ${state} fixture server did not start on ${STATES[state]}`);
}

before(async () => {
  mkdirSync(OUT, { recursive: true });
  await Promise.all((Object.keys(STATES) as State[]).map(up));
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  for (const s of servers) s.kill();
});

async function open(state: State, url: string, o: { width?: number; height?: number; js?: boolean } = {}) {
  const ctx = await browser.newContext({ viewport: { width: o.width ?? 1280, height: o.height ?? 900 }, javaScriptEnabled: o.js ?? true, ...(o.width && o.width < 600 ? { isMobile: true, hasTouch: true } : {}) });
  const page = await ctx.newPage();
  const res = await page.goto(`${base(state)}${url}`, { waitUntil: "networkidle", timeout: 120_000 });
  return { ctx, page, status: res?.status() ?? 0 };
}

const text = (page: Page, sel: string) => page.evaluate((s) => [...document.querySelectorAll(s)].map((e) => (e.textContent ?? "").replace(/\s+/g, " ").trim()), sel);
const hrefs = (page: Page, sel: string) => page.evaluate((s) => [...document.querySelectorAll<HTMLAnchorElement>(s)].map((a) => a.getAttribute("href") ?? ""), sel);

/** Every link resolves: a 200 on the same server, with the answer panel it names when it names one. */
async function resolves(state: State, links: string[]) {
  assert.ok(links.length, "no links to follow");
  for (const href of links) {
    const url = new URL(href, `${base(state)}${HOME}`);
    const res = await fetch(url, { redirect: "manual" });
    assert.equal(res.status, 200, `${href} answered ${res.status}`);
    if (url.hash.startsWith("#answer-")) assert.ok((await res.text()).includes(`id="${url.hash.slice(1)}"`), `${href}: no answer panel with that anchor`);
  }
}

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

/** The page's screen at 1280 and 390, and its HTML once, for the census and for a person to look at. */
async function shoot(state: State, url: string, name: string) {
  for (const [w, h] of [
    [1280, 900],
    [390, 844],
  ] as const) {
    const { ctx, page } = await open(state, url, { width: w, height: h });
    await page.screenshot({ path: path.join(OUT, `${name}-${w}.png`), fullPage: true });
    if (w === 1280) writeFileSync(path.join(OUT, `${name}.html`), await page.content(), "utf8");
    await ctx.close();
  }
}

describe("the Overview", () => {
  test("default: the compared headline, three bullets, Since last check with links that resolve, Download CSV", async () => {
    const { ctx, page, status } = await open("default", HOME);
    assert.equal(status, 200);
    const [head] = await text(page, '[data-headline="compared"]');
    assert.match(head ?? "", /^Named in [\d,]+ of [\d,]+ AI answers to your \d+ prompts in the last 28 days \(\d+%\)[.,] .*(up from|down from|the same as) \d+% in the 28 days before\. \d+ of \d+ cluster keywords (is|are) on Google's page 1/);
    const bullets = await page.evaluate(() => [...document.querySelectorAll("[data-meaning] li")].map((li) => li.getAttribute("data-kind")));
    assert.deepEqual(bullets, ["engines", "google", "change"]);
    assert.match((await text(page, '[data-meaning] li[data-kind="engines"]'))[0]!, /names you in the (most answers|largest share of its answers) \([\d,]+ of [\d,]+\); .+ in the (fewest|smallest) \([\d,]+ of [\d,]+\)\.$/);
    assert.match((await text(page, '[data-meaning] li[data-kind="google"]'))[0]!, /^Closest to page 1: '.+' at \d+(st|nd|rd|th)\.$/);
    assert.match((await text(page, '[data-meaning] li[data-kind="change"]'))[0]!, /^'.+': named in \d+ answers?, was \d+, same prompts\.$/);
    const since = await text(page, "[data-since] li");
    assert.ok(since.length >= 1 && since.length <= 8, `${since.length} lines`);
    for (const l of since) assert.doesNotMatch(l, /\b(caused|drove|because of|thanks to|resulted in|delivered|in your place)\b/i);
    await resolves("default", [...(await hrefs(page, "[data-since] a")), ...(await hrefs(page, "[data-meaning] a"))]);
    const body = await page.evaluate(() => document.body.innerText);
    assert.match(body, /Download CSV/);
    assert.doesNotMatch(body, /Download report/);
    assert.deepEqual(await axe(page), []);
    await ctx.close();
    await shoot("default", HOME, "overview-default");
  });

  test("new: before the first check - the pending headline, no change list, no CSV", async () => {
    const { ctx, page, status } = await open("new", HOME);
    assert.equal(status, 200);
    const body = await page.evaluate(() => document.body.innerText);
    assert.match(body, /Your first check runs tomorrow at /);
    assert.doesNotMatch(body, /Since last check|Download CSV/);
    assert.deepEqual(await axe(page), []);
    await ctx.close();
    await shoot("new", HOME, "overview-new");
  });

  test("partial: the change list opens on the partial check, and a missing read is never a change", async () => {
    const { ctx, page } = await open("partial", HOME);
    const since = await page.evaluate(() => [...document.querySelectorAll("[data-since] li")].map((li) => ({ kind: li.getAttribute("data-kind"), text: (li.textContent ?? "").trim() })));
    assert.equal(since[0]?.kind, "check");
    assert.match(since[0]!.text, /^Your check on 29 Sep was partial: Google AI Overviews did not answer \d+ prompts\.$/);
    // Today's Google AI Overviews reads failed: none of them is read as a change, so no line's evidence is one of them.
    const links = await hrefs(page, "[data-since] a");
    assert.ok(!links.some((h) => h.includes("day=2026-09-29") && h.includes("engine=google_aio")), "a failed read was read as a change");
    assert.ok(await page.evaluate(() => !!document.querySelector('[data-headline="compared"]')), "the headline still reads");
    await resolves("partial", await hrefs(page, "[data-since] a"));
    assert.deepEqual(await axe(page), []);
    await ctx.close();
    await shoot("partial", HOME, "overview-partial");
  });

  test("JS off: the headline, bullets and change list are the server's", async () => {
    const { ctx, page } = await open("default", HOME, { js: false });
    assert.ok((await text(page, '[data-headline="compared"]'))[0]);
    // Drawn, not only in the document: a streamed page sits in a hidden div until script swaps it in.
    assert.ok(await page.evaluate(() => (document.querySelector("[data-since]")?.getBoundingClientRect().height ?? 0) > 0), "the change list is not drawn with JS off");
    assert.equal((await text(page, "[data-meaning] li")).length, 3);
    assert.ok((await text(page, "[data-since] li")).length >= 1);
    await ctx.close();
  });

  test("no sideways scroll at 390 and 320", async () => {
    for (const state of ["default", "partial", "new"] as const) {
      for (const width of [390, 320]) {
        const { ctx, page } = await open(state, HOME, { width, height: 844 });
        const w = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: innerWidth }));
        assert.ok(w.scroll <= w.inner, `${state} at ${width}: ${w.scroll} wide`);
        await ctx.close();
      }
    }
  });
});

describe("AI visibility", () => {
  test("a slug the member is not on is a 404, before anything streams", async () => {
    const res = await fetch(`${base("default")}/app/nope/ai`, { redirect: "manual" });
    assert.equal(res.status, 404);
  });

  test("default: four figures, the chart, the table, the heat map and how it was measured; rows open their answers", async () => {
    const { ctx, page, status } = await open("default", `${HOME}/ai`);
    assert.equal(status, 200);
    const figs = await page.evaluate(() => [...document.querySelectorAll("[data-figure^='ai-']")].map((e) => e.getAttribute("data-figure")));
    assert.deepEqual(figs, ["ai-named", "ai-prompts", "ai-engine", "ai-cited"]);
    assert.match((await text(page, "#ai-prompts-h"))[0]!, /^\d+ prompts$/);
    const rows = await page.evaluate(() => document.querySelectorAll("[data-prompt]").length);
    assert.ok(rows >= 40 && rows <= 100, `${rows} rows`);
    assert.ok(await page.evaluate(() => !!document.querySelector("#ai-chart svg")), "no chart");
    assert.ok(await page.evaluate(() => !!document.querySelector('[aria-label="Daily checks by cluster"]')), "no heat map");
    assert.match((await text(page, "#ai-measured-h + p"))[0]!, /^\d+ prompts on four engines, checked daily\. Google AI Overviews, ChatGPT and Gemini are read through their consumer interface; Perplexity is asked through its API\./);
    // Every row link resolves; the never-named upgrade prompt shows with its reason.
    await resolves("default", await hrefs(page, "[data-prompt] a"));
    assert.match(await page.evaluate(() => document.querySelector('[aria-label="Upgrade"]')?.textContent ?? ""), /Shown because \d+ of your \d+ prompts named you in none of their [\d,]+ answers this period\./);
    assert.deepEqual(await axe(page), []);
    await ctx.close();
    await shoot("default", `${HOME}/ai`, "ai-default");
  });

  test("an evidence link opens an answer in three clicks or fewer", async () => {
    const { ctx, page } = await open("default", `${HOME}/ai`);
    let clicks = 0;
    await page.locator("[data-prompt] a").first().click();
    clicks++;
    await page.waitForURL(/\/clusters\/c\d+\?/, { timeout: 15_000 });
    await page.waitForFunction(() => /^(Latest answers|Answers on )/.test(document.querySelector("#ans-h")?.textContent ?? ""), undefined, { timeout: 15_000 });
    assert.ok(clicks <= 3);
    await ctx.close();
    // And from the Overview's change list, one click to the answer it names.
    const o = await open("default", HOME);
    const first = (await hrefs(o.page, '[data-since] li a[href*="#answer-"]'))[0] ?? (await hrefs(o.page, "[data-since] a"))[0];
    assert.ok(first, "no linked change line");
    await o.page.locator(`[data-since] a[href="${first}"]`).first().click();
    await o.page.waitForFunction(() => location.pathname.includes("/clusters/") || location.pathname.endsWith("/ai") || location.pathname.endsWith("/named") || location.pathname.endsWith("/cited"), undefined, { timeout: 15_000 });
    await o.ctx.close();
  });

  test("?missing=1: only prompts that name others and never you", async () => {
    const { ctx, page } = await open("default", `${HOME}/ai?missing=1`);
    const head = (await text(page, "#ai-prompts-h"))[0]!;
    const m = /^(\d+) prompts? names? others and never you$/.exec(head);
    assert.ok(m, head);
    const rows = await page.evaluate(() => [...document.querySelectorAll("[data-prompt]")].map((r) => r.getAttribute("data-missing")));
    assert.equal(rows.length, Number(m[1]));
    assert.ok(rows.every((x) => x === "1"));
    assert.deepEqual(await axe(page), []);
    await ctx.close();
    await shoot("default", `${HOME}/ai?missing=1`, "ai-missing");
  });

  test("?eng=chatgpt&lfl=1: the chart's chips and switch are links in the URL's state; the table counts ChatGPT only", async () => {
    const { ctx, page } = await open("default", `${HOME}/ai?eng=chatgpt&lfl=1`);
    const on = await page.evaluate(() => [...document.querySelectorAll("#ai-chart a[aria-current='true']")].map((a) => (a.textContent ?? "").trim()).sort());
    assert.deepEqual(on, ["ChatGPT", "Like-for-like only"]);
    const counts = await text(page, "[data-prompt] [role=cell]:nth-child(3) > span:first-child");
    assert.ok(counts.length >= 40);
    for (const c of counts) assert.match(c, /^(0 of 1|1 of 1|0 of 0|-)$/, c);
    await ctx.close();
    // JS off, the same.
    const off = await open("default", `${HOME}/ai?eng=chatgpt&lfl=1`, { js: false });
    assert.deepEqual(await off.page.evaluate(() => [...document.querySelectorAll("#ai-chart a[aria-current='true']")].map((a) => (a.textContent ?? "").trim()).sort()), ["ChatGPT", "Like-for-like only"]);
    assert.ok(await off.page.evaluate(() => (document.querySelector("#ai-chart")?.getBoundingClientRect().height ?? 0) > 0), "the chart is not drawn with JS off");
    await off.ctx.close();
  });

  test("new: before the first check, the prompts start tomorrow", async () => {
    const { ctx, page, status } = await open("new", `${HOME}/ai`);
    assert.equal(status, 200);
    assert.match(await page.evaluate(() => document.body.innerText), /Your prompts start tomorrow/);
    assert.deepEqual(await axe(page), []);
    await ctx.close();
    await shoot("new", `${HOME}/ai`, "ai-new");
  });

  test("JS off: the figures, the table and the filters are the server's", async () => {
    const { ctx, page } = await open("default", `${HOME}/ai?cluster=c1&sort=named&dir=desc`, { js: false });
    const rows = await page.evaluate(() => [...document.querySelectorAll("[data-prompt]")].filter((r) => r.getBoundingClientRect().height > 0).length);
    assert.equal(rows, 5, "the c1 cluster's five prompts, drawn");
    assert.equal(await page.evaluate(() => document.querySelectorAll("[data-figure^='ai-']").length), 4);
    await ctx.close();
  });

  test("JS off: the upgrade prompt's hide posts and comes back with its toast (303)", async () => {
    const { ctx, page } = await open("default", `${HOME}/ai`, { js: false });
    await page.locator('[aria-label="Upgrade"] button[aria-label="Hide for 30 days"]').click();
    await page.waitForURL(/\/clusters\?.*hid=1/, { timeout: 15_000 });
    await ctx.close();
  });

  test("no sideways scroll at 390 and 320", async () => {
    for (const url of [`${HOME}/ai`, `${HOME}/ai?missing=1`, `${HOME}/ai?eng=chatgpt&lfl=1`]) {
      for (const width of [390, 320]) {
        const { ctx, page } = await open("default", url, { width, height: 844 });
        const w = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: innerWidth }));
        assert.ok(w.scroll <= w.inner, `${url} at ${width}: ${w.scroll} wide`);
        await ctx.close();
      }
    }
  });
});
