/**
 * DIY P2, prompts and placements (13 Oct 2026; spec 10 sections 4.10, 4.11,
 * 6.7 and 7.3): origin chips on Clusters and one cluster with their links,
 * the "From placements" sub-list on the placed fixture, no Nomada name on the
 * agency-mode account, the Placements page's prompt and first-cited lines,
 * JavaScript off, and the 7.0 item 7 checks (axe, no sideways scroll at 390
 * and 320, a write form with no script, the viewer, every link resolving).
 *
 * One `next start` in process on the build, with the fixture writable; each
 * test sets its TRACKING_FIXTURE_STATE and role and drops the fixture held on
 * globalThis, as scope.spec.mts does. Screens and each page's HTML go to
 * test-results/diy/prompts/ (not committed), for the builder to look at and
 * for the gating census.
 *
 *   npm run build && node --test e2e/app/diy-prompts.spec.mts
 *
 * Illustrative: Tallyroo and every brand and site shown are made up.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const require = createRequire(path.join(os.homedir(), "code/.parity/package.json"));
type Locator = { click(): Promise<void>; count(): Promise<number>; innerText(): Promise<string>; first(): Locator; nth(i: number): Locator; getAttribute(name: string): Promise<string | null>; fill(v: string): Promise<void> };
type Page = {
  goto(url: string, o?: object): Promise<{ status(): number } | null>;
  locator(sel: string): Locator;
  waitForURL(url: RegExp, o?: object): Promise<void>;
  evaluate<R>(fn: () => R | Promise<R>): Promise<R>;
  evaluate<R, A>(fn: (a: A) => R | Promise<R>, a: A): Promise<R>;
  addScriptTag(o: { content: string }): Promise<unknown>;
  screenshot(o: { path: string; fullPage?: boolean }): Promise<unknown>;
  content(): Promise<string>;
  url(): string;
};
type Context = { newPage(): Promise<Page>; close(): Promise<void>; request: { get(url: string, o?: object): Promise<{ status(): number }> } };
type Browser = { newContext(o: object): Promise<Context>; close(): Promise<void> };
const { chromium } = require("playwright") as { chromium: { launch(): Promise<Browser> } };
const AXE = readFileSync(path.join(ROOT, "node_modules", "axe-core", "axe.min.js"), "utf8");

const PORT = Number(process.env.E2E_PORT ?? 3610);
// localhost, as scope.spec.mts: a form's 303 comes back to the host the page is on, which CSP form-action 'self' needs.
const BASE = `http://localhost:${PORT}`;
const OUT = path.join(ROOT, "test-results", "diy", "prompts");
const SLUG = "/app/tallyroo";

let server: Server | null = null;
let browser: Browser;

before(async () => {
  process.env.TRACKING_FIXTURE = "1";
  process.env.TRACKING_FIXTURE_WRITE = "1";
  process.env.VERCEL_ENV = "development";
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

/** Serve this tracking fixture state and role from the next request on, the writes of any earlier test dropped. */
function as(state: string, role = "owner") {
  if (state === "default") delete process.env.TRACKING_FIXTURE_STATE;
  else process.env.TRACKING_FIXTURE_STATE = state;
  process.env.TRACKING_FIXTURE_ROLE = role;
  delete (globalThis as Record<symbol, unknown>)[Symbol.for("alwayscited.trackingFixture")];
}

async function open(route: string, o: { width?: number; height?: number; js?: boolean } = {}) {
  const ctx = await browser.newContext({ viewport: { width: o.width ?? 1280, height: o.height ?? 900 }, javaScriptEnabled: o.js ?? true });
  const page = await ctx.newPage();
  const r = await page.goto(BASE + route, { waitUntil: "load" });
  return { ctx, page, status: r?.status() };
}

const text = (page: Page) => page.evaluate(() => document.body.innerText);
const chips = (page: Page, scope = "body") =>
  page.evaluate((sel) => [...document.querySelectorAll(`${sel} [data-origin]`)].map((e) => ({ kind: e.getAttribute("data-origin"), text: (e.textContent ?? "").replace(/\s+/g, " ").trim(), href: e.getAttribute("href") })), scope);

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

const sideways = (page: Page) => page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth }));

/** The screens (7.0 item 7): 1280x900 and 390x844, full page, and the page's HTML once. */
async function shoot(route: string, name: string, state: string) {
  for (const [w, h] of [
    [1280, 900],
    [390, 844],
  ] as const) {
    const { ctx, page } = await open(route, { width: w, height: h });
    await page.screenshot({ path: path.join(OUT, `${name}-${state}-${w}.png`), fullPage: true });
    if (w === 1280) writeFileSync(path.join(OUT, `${name}-${state}.html`), await page.content());
    await ctx.close();
  }
}

// ---- Chips (spec 4.10 and 6.7) ----

test("full: chips on Clusters - c1's five prompts and c2's first, in the fixture's origins", async () => {
  as("default");
  const { ctx, page, status } = await open(`${SLUG}/clusters?open=c1`);
  assert.equal(status, 200);
  const c1 = await chips(page);
  assert.deepEqual(
    c1.map((c) => [c.kind, c.text]),
    [
      ["setup", "Origin: Setup"],
      ["setup", "Origin: Setup"],
      ["client", "Origin: You"],
      ["nomada", "Origin: nomada digital"],
      // 13 Oct 2026, DIY P7: q1-5 was added from a pursued page (src/lib/diy/fixtures/origins.opportunity.json, wave 2),
      // so its chip is Opportunity, and it links to that opportunity.
      ["opportunity", "Origin: Opportunity"],
    ],
  );
  assert.ok(c1.filter((c) => c.kind !== "opportunity").every((c) => c.href === null), "Setup, You and nomada digital are not links");
  assert.match(c1.find((c) => c.kind === "opportunity")!.href ?? "", /\/opportunities\/opp-solo$/);
  assert.doesNotMatch(await text(page), /From placements/, "no placement prompt on the full fixture");
  await ctx.close();
  const two = await open(`${SLUG}/clusters?open=c2`);
  assert.deepEqual((await chips(two.page)).map((c) => c.kind), ["nomada"], "6 prompts carry chips in all");
  await two.ctx.close();
});

test("full: chips on one cluster, drawn as text inside each row's own link", async () => {
  as("default");
  const { ctx, page } = await open(`${SLUG}/clusters/c1`);
  const c = await chips(page, "[aria-labelledby=lk-h]");
  assert.equal(c.length, 5);
  assert.ok(c.every((x) => x.href === null));
  const nested = await page.evaluate(() => [...document.querySelectorAll("a a")].length);
  assert.equal(nested, 0, "no anchor inside an anchor");
  await ctx.close();
});

// ---- The placed fixture (spec 7.0 item 6) ----

test("placed: the 'From placements' sub-list under c1's five angle slots, each chip linking to Placements", async () => {
  as("placed");
  const { ctx, page } = await open(`${SLUG}/clusters?open=c1`);
  const body = await text(page);
  assert.match(body, /From placements\s*These don't use your 5 prompt slots\./);
  const placed = (await chips(page)).filter((c) => c.kind === "placement");
  assert.deepEqual(
    placed.map((c) => c.text),
    ["Origin: Placement · thesmallbizstack.com", "Origin: Placement · freelancefieldnotes.com", "Origin: Placement · ownerledger.co"],
  );
  const angle = await page.evaluate(() => [...document.querySelectorAll(".app-cl-prompt")].filter((li) => !li.hasAttribute("data-placement-prompt")).length);
  assert.equal(angle, 5, "the five angle slots stay five");
  assert.equal(await page.evaluate(() => document.querySelectorAll("[data-placement-prompt]").length), 3);
  assert.match(body, /best accounting software to switch to\s*First check tomorrow at/, "the retried one is first asked tomorrow");
  // 13 Oct 2026 review: the card counts the two placement prompts already read, says so, and gives the figure without them.
  assert.match(body, /Since \d+ [A-Z][a-z]{2}\. Includes 2 prompts added from placements/);
  assert.match(await page.locator("[data-basis=placements]").first().innerText(), /^Includes 2 prompts added from placements\. Without them, [\d,]+ of [\d,]+ answers named you \(\d+%\)\.$/);
  for (const href of new Set(placed.map((c) => c.href))) {
    assert.equal(href, `${SLUG}/placements`);
    const r = await ctx.request.get(BASE + href!, { maxRedirects: 0 });
    assert.equal(r.status(), 200, `${href} resolves`);
  }
  await ctx.close();
});

test("placed: one cluster keeps 'The 5 prompts' beside the keyword, lists the placement prompts under them, and each opens its checks", async () => {
  as("placed");
  const { ctx, page } = await open(`${SLUG}/clusters/c1`);
  const body = await text(page);
  assert.match(body, /The 5 prompts behind this keyword/);
  assert.match(body, /From placements\s*These don't use your 5 prompt slots\./);
  assert.match(await page.locator("[data-basis=placements]").innerText(), /^Includes 2 prompts added from placements\. Without them, [\d,]+ of [\d,]+ answers named you \(\d+%\)\.$/, "the summary says what it counts");
  const see = await page.locator("a:has-text('See placements')").getAttribute("href");
  assert.equal(see, `${SLUG}/placements`);
  assert.equal((await ctx.request.get(BASE + see!, { maxRedirects: 0 })).status(), 200);
  await page.locator("[role=group][aria-labelledby=fp-h] a.app-cl-prow").first().click();
  await page.waitForURL(/prompt=5/, { timeout: 15_000 });
  await page.evaluate(() => new Promise((r) => setTimeout(r, 300)));
  assert.match(await page.locator("section[aria-labelledby=strip-h]").innerText(), /best accounting apps for small businesses/);
  assert.match(await page.locator("[role=group][aria-labelledby=fp-h] a[aria-current=true]").innerText(), /best accounting apps for small businesses/);
  await ctx.close();
});

test("placed: Placements draws the prompt line and the first-cited line on live rows, and nothing on rows not live", async () => {
  as("placed");
  const { ctx, page } = await open(`${SLUG}/placements`);
  const lines = await page.evaluate(() =>
    Object.fromEntries(
      [...document.querySelectorAll("[data-placement]")].map((row) => [
        row.getAttribute("data-placement"),
        { cited: row.querySelector("[data-line=first-cited]")?.textContent ?? null, prompt: row.querySelector("[data-line=prompt]")?.textContent ?? null },
      ]),
    ),
  );
  assert.equal(lines.p1?.prompt, "Prompt added 13 Aug: “best accounting apps for small businesses”");
  assert.match(lines.p1?.cited ?? "", /^First cited: (Google AI Overviews|ChatGPT|Gemini|Perplexity|Claude) \d+ [A-Z][a-z]{2}/);
  assert.equal(lines.p2?.prompt, "No prompt: on-site work adds none");
  assert.equal(lines.p3?.prompt, "Prompt added: “best accounting software to switch to”, first asked tomorrow");
  assert.equal(lines.p4?.prompt, "Prompt added 3 Sep: “best bookkeeping tools for freelancers”");
  for (const id of ["p5", "p6"]) assert.deepEqual(lines[id], { cited: null, prompt: null }, `${id} is not live`);
  // 13 Oct 2026 review: the named figures leave the three placement prompts out, and say so; the citations read all eight.
  assert.equal(await page.locator("[data-basis=placements]").innerText(), "“Answers naming you” and the named spans leave out the 3 prompts added from placements. The citation counts read answers to all 8 prompts.");
  assert.match(await page.locator("section[aria-label='Cluster summary']").innerText(), /5 prompts, five engines, since/);
  await ctx.close();
});

test("the switch off (every state but the placed ones): no prompt line, and the first-cited line still there", async () => {
  as("default");
  const { ctx, page } = await open(`${SLUG}/placements`);
  const n = await page.evaluate(() => ({ prompt: document.querySelectorAll("[data-line=prompt]").length, cited: document.querySelectorAll("[data-line=first-cited]").length }));
  assert.equal(n.prompt, 0);
  assert.equal(n.cited, 4, "four live placements");
  assert.equal(await page.locator("[data-basis=placements]").count(), 0, "no placement prompt, no basis line");
  await ctx.close();
});

test("placed-agency: no 'nomada' in the page text of Clusters, one cluster, Placements or the Overview", async () => {
  as("placed-agency");
  for (const route of [`${SLUG}/clusters?open=c1`, `${SLUG}/clusters/c1`, `${SLUG}/placements`, SLUG]) {
    const { ctx, page, status } = await open(route);
    assert.equal(status, 200, route);
    assert.doesNotMatch(await text(page), /nomada/i, route);
    if (route.includes("clusters?open=c1")) assert.ok((await chips(page)).some((c) => c.text === "Origin: Your account contact" && c.kind === "contact"), "the nomada chip reads Your account contact");
    // 13 Oct 2026 review: P2's own markup too - its attributes, in the HTML and in the RSC payload - names no Nomada.
    const mine = await page.evaluate(() => [...document.querySelectorAll("[data-origin], [data-placement-prompt], [data-line], [data-basis]")].map((e) => e.outerHTML).join("\n"));
    assert.doesNotMatch(mine, /nomada/i, `${route}: P2's markup`);
    assert.doesNotMatch(await page.content(), /data-origin[^a-z]{1,6}nomada/i, `${route}: the HTML and the RSC payload`);
    await ctx.close();
  }
});

// ---- 7.0 item 7 ----

test("JavaScript off: the chips, the sub-list and the Placements lines are all in the server's HTML", async () => {
  as("placed");
  const a = await open(`${SLUG}/clusters?open=c1`, { js: false });
  assert.equal((await chips(a.page)).length, 8);
  assert.match(await text(a.page), /From placements/);
  await a.ctx.close();
  const b = await open(`${SLUG}/placements`, { js: false });
  assert.equal(await b.page.evaluate(() => document.querySelectorAll("[data-line=prompt]").length), 4);
  await b.ctx.close();
});

test("JavaScript off, placed: Stop frees an angle slot beside the three placement prompts, and the slot fills (303 and toast)", async () => {
  as("placed");
  const { ctx, page } = await open(`${SLUG}/clusters?open=c1`, { js: false });
  await page.locator("form[action*='/stop'] button[aria-label^='Stop and add a new one: What']").first().click();
  await page.waitForURL(/done=stopped/, { timeout: 15_000 });
  assert.match(await page.locator(".app-toast").innerText(), /^Stopped “What's the best accounting app/);
  const slot = page.locator("input[name=text][id^=slot-]").first();
  await slot.fill("Which accounting app do freelance writers use?");
  await page.locator("form[action*='/prompt'] button[type=submit]").first().click();
  await page.waitForURL(/done=added/, { timeout: 15_000 });
  assert.match(await page.locator(".app-toast").innerText(), /^Now tracking “Which accounting app do freelance writers use\?”/);
  await ctx.close();
});

test("a viewer sees the chips and the sub-list, and no control: the page says who can change what", async () => {
  as("placed", "viewer");
  const { ctx, page } = await open(`${SLUG}/clusters?open=c1`);
  assert.equal((await chips(page)).length, 8);
  assert.equal(await page.evaluate(() => document.querySelectorAll("[data-placement-prompt] form, [data-placement-prompt] button").length), 0);
  assert.match(await text(page), /Only owners and editors can/);
  await ctx.close();
});

test("axe finds nothing serious or critical, and nothing scrolls sideways at 390 or 320", async () => {
  for (const [state, route] of [
    ["default", `${SLUG}/clusters?open=c1`],
    ["placed", `${SLUG}/clusters?open=c1`],
    ["placed", `${SLUG}/clusters/c1`],
    ["placed", `${SLUG}/placements`],
    ["placed-agency", `${SLUG}/clusters?open=c1`],
  ] as const) {
    as(state);
    const desk = await open(route);
    assert.deepEqual(await axe(desk.page), [], `${state} ${route} at 1280`);
    await desk.ctx.close();
    for (const width of [390, 320]) {
      const { ctx, page } = await open(route, { width, height: 844 });
      const s = await sideways(page);
      assert.ok(s.scrollWidth <= s.innerWidth, `${state} ${route} at ${width}: ${s.scrollWidth}px wide`);
      if (width === 390) assert.deepEqual(await axe(page), [], `${state} ${route} at 390`);
      await ctx.close();
    }
  }
});

test("screens: Clusters (full, placed), one cluster (placed), Placements (placed), at 1280 and 390", async () => {
  as("default");
  await shoot(`${SLUG}/clusters?open=c1`, "clusters", "full");
  as("placed");
  await shoot(`${SLUG}/clusters?open=c1`, "clusters", "placed");
  await shoot(`${SLUG}/clusters/c1`, "cluster", "placed");
  await shoot(`${SLUG}/placements`, "placements", "placed");
  as("placed-agency");
  await shoot(`${SLUG}/clusters?open=c1`, "clusters", "placed-agency");
});
