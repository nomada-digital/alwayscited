/**
 * DIY P7 (13 Oct 2026; spec 10 sections 4.5, 4.7 and 7.8): Opportunities, one
 * opportunity, and Cited pages' new facts, on the fixture - TRACKING_FIXTURE=1
 * with DIY_FIXTURE_STATE, the made-up world in
 * src/lib/diy/fixtures/opportunities.json derived as the night derives it -
 * served in-process on the build, as e2e/app/diy-plan.spec.mts serves it.
 *
 * Holds what section 7.0 item 7 asks of every DIY spec: axe finds no serious
 * or critical violation; no sideways page scroll at 390 and 320; every write
 * form works with JS off (a 303 and its toast); a viewer sees the controls
 * disabled with the reason; every evidence link resolves. And the package's
 * own: the lenses and the order line; the detail page; Pursue with a free
 * slot (toast and Undo) and with a full cluster (the swap picker, then Swap);
 * the duplicate message; Not for us; Log a site and Verify now on canned
 * reads; the Pursuing and Methods views; Cited ?leaves=1; the dark, day 0,
 * capped and zero states; and the phone's cards.
 *
 * Saves each page's screens to test-results/diy/opportunities/<page>-<state>-<width>.png
 * (1280x900 and 390x844) and its HTML to test-results/diy/opportunities/<page>-<state>.html
 * for the gating census (section 6.10 item 2), whose route is read from a
 * name starting `opportunit`. Not committed.
 *
 *   npm run build && E2E_PORT=3662 node --test e2e/app/diy-opportunities.spec.mts
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const OUT = path.join(ROOT, "test-results", "diy", "opportunities");
const require = createRequire(path.join(os.homedir(), "code/.parity/package.json"));
type Locator = {
  click(): Promise<void>;
  count(): Promise<number>;
  first(): Locator;
  innerText(): Promise<string>;
  fill(v: string): Promise<void>;
  isDisabled(): Promise<boolean>;
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

const PORT = Number(process.env.E2E_PORT ?? 3662);
const BASE = `http://localhost:${PORT}`;
const OPP = "/app/tallyroo/opportunities";
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
  delete (globalThis as Record<symbol, unknown>)[Symbol.for("alwayscited.diyFixture.opportunities")];
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

/** A form post with JS's help, for the route's own answers. */
async function post(route: string, fields: Record<string, string>) {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.set(k, v);
  return fetch(`${API}/${route}`, { method: "POST", body, redirect: "manual" });
}

test("list (full) at 1280: header counts, the lenses with counts, the order line, rows with route and facts", async () => {
  as("default");
  const { ctx, page, status } = await open(OPP);
  assert.equal(status, 200);
  assert.equal(await page.locator("h1").innerText(), "Opportunities");
  const header = await page.locator("[data-opp-header]").innerText();
  assert.match(header, /^\d+ pages the engines cite leave you out\. \d+ are best-of lists or comparisons\. 2 are threads\. Updated overnight from your checks to 29 Sep\.$/);
  const tabs = await page.evaluate(() => [...document.querySelectorAll('nav[aria-label="Lenses"] a')].map((a) => a.textContent));
  // Each tab's name carries a separator before its count for screen readers ("Threads, 2", not "Threads2").
  assert.deepEqual(tabs.map((t) => t!.replace(/, \d+$/, "")), ["Cited, leaves you out", "Best-of lists on Google", "Threads", "Review and listing profiles", "Pages to publish or refresh", "Sites you logged"]);
  // The order line sits in a closed disclosure: its words are in the page, shown on a click.
  assert.equal(await page.evaluate(() => document.querySelector("[data-opp-order]")!.textContent), "Most answers that cite it and leave you out first, then most of your prompts, then best-of lists and comparisons, then pages that rank on page 1 for one of your keywords, then still cited this week, then newest.");
  const row = await page.locator('[data-opp-row="opp-invoicing"]').innerText();
  assert.match(row, /The 9 best invoicing apps for freelancers \(2026\) - SmallBizDesk/);
  assert.match(row, /Ask to be added/);
  // The label sits on the half the model wrote; the page type here is the rules' ("best" in the address).
  assert.match(row, /Publisher \(classified automatically\) · Best-of list/);
  assert.match(row, /Cited by ChatGPT and Perplexity for 2 of your prompts in the last 28 days \(36 answers\)\./);
  assert.match(row, /Names Brightbook and Ledgerline, not you \(read 27 Sep\)\./);
  assert.match(row, /updated on the page: Sep 2026 · still cited this week/);
  // Nomada's placements for other clients, and competitors' own pages, are nowhere.
  const all = await text(page);
  for (const gone of ["softwarecritic.com", "smallbizdesk.example/top-accounting-tools", "ledgerline.com", "brightbook.example"]) assert.ok(!all.includes(gone), gone);
  assert.ok(!(await page.content()).includes("top-accounting-tools"), "not in the HTML either");
  // The order: most answers leaving you out first.
  const order = await page.evaluate(() => [...document.querySelectorAll("[data-opp-rows] > li")].map((li) => li.getAttribute("data-opp-row")));
  assert.ok(order.indexOf("opp-invoicing") < order.indexOf("opp-toolkit"));
  await ctx.close();
  await save(OPP, "opportunities-list", "full");
});

test("the lenses: each tab lists its own rows, and its count is its rows", async () => {
  as("default");
  for (const [lens, route] of [
    ["lists", /Ask to be added|Get listed or reviewed/],
    ["threads", /Answer in the thread/],
    ["profiles", /Get listed or reviewed/],
    ["own", /Publish your own|Refresh your own/],
    ["logged", /Ask to be added|Offer a resource/],
  ] as const) {
    const { ctx, page } = await open(`${OPP}?lens=${lens}`);
    const n = await page.locator("[data-opp-rows] > li").count();
    const tab = await page.locator(`nav[aria-label="Lenses"] a[aria-current="page"]`).innerText();
    assert.equal(Number(tab.match(/(\d+)$/)![1]), n, `${lens}: ${tab}`);
    assert.ok(n >= 2, `${lens}: ${n} rows`);
    assert.match(await page.locator("[data-opp-rows]").innerText(), route);
    await ctx.close();
  }
  const { ctx, page } = await open(`${OPP}?lens=own`);
  assert.match(await text(page), /Publish your own best-of list/);
  assert.match(await text(page), /The answers and Google's top 10 for 'accounting app for freelancers' show 5 best-of lists; none of yours ranks or is cited for it\./);
  assert.match(await text(page), /Your best-of list for 'invoicing software' isn't cited for its prompts and isn't in Google's top 5\./);
  assert.match(await text(page), /Your site · Best-of list/);
  await ctx.close();
});

test("one opportunity (Ask to be added, with U3): why, what it is, what to point it at, the method, the pitch, who to write to", async () => {
  as("default");
  const { ctx, page, status } = await open(`${OPP}/opp-invoicing`);
  assert.equal(status, 200);
  const t = await text(page);
  assert.match(t, /Cited by ChatGPT and Perplexity for 2 of your prompts in 36 answers over the 28 days to 29 Sep, on 9 of the last 14 days\./);
  assert.match(t, /Seen in your data/);
  assert.match(t, /Names Brightbook and Ledgerline, not you \(read 27 Sep\)\./);
  assert.match(t, /Ranks #4 on Google for 'invoicing software'\./);
  assert.match(t, /Page type: Best-of list/);
  assert.match(await page.locator("[data-opp-criteria]").innerText(), /Ease of use/);
  assert.match(t, /Your page that ranks for this cluster's keyword:\s*https:\/\/tallyroo\.com\/invoicing/);
  // Two lines, each graded: the anchor to ask for is common practice; Google documents only the second (G1).
  assert.match(t, /Anchor: your brand name or the page's title\.\s*Common practice/);
  assert.match(t, /Never a keyword-rich anchor on an article you supply\.\s*Google documents this/);
  assert.doesNotMatch(t, /Anchor: your brand name or the page's title\.\s*Google documents this/);
  assert.match(t, /Google's spam policies \(updated 28 Aug 2026\) treat buying links that pass ranking credit, excessive link exchanges, and keyword-rich anchor text in articles you supply as link spam\./);
  assert.match(t, /about an hour \(our estimate\)/);
  const pitch = await page.locator("[data-opp-pitch]").innerText();
  assert.match(pitch, /^Subject: An addition for 'The 9 best invoicing apps for freelancers \(2026\) - SmallBizDesk'/);
  assert.match(pitch, /\[first name\]/);
  assert.match(pitch, /Tallyroo \[the one fact that meets it\], shown here: https:\/\/tallyroo\.com\/invoicing\./);
  // The copy button says its result in a status region, so a screen reader hears it.
  assert.equal(await page.locator('section:has(#pitch-h) span[role="status"]').count(), 1);
  assert.match(t, /Start with the byline's author page, then the site's contact page or its team page\. We never supply names or addresses\./);
  assert.match(t, /Pursuing it adds the prompt 'best invoicing apps for freelancers' to 'invoicing software'/);
  // U3, the one upgrade slot: the mentioned service line, and why it shows.
  assert.match(t, /Pages like this one leave you out/);
  assert.match(t, /Shown because this page names Brightbook and Ledgerline, not you, and was cited in 36 answers to your prompts in the last 28 days\./);
  assert.equal(await page.locator('[role="note"][aria-label="Upgrade"]').count(), 1);
  await ctx.close();
  await save(`${OPP}/opp-invoicing`, "opportunities-detail-ask", "full");
});

test("one opportunity (Answer in the thread): its playbook with the last day cited, and no pitch", async () => {
  as("default");
  const { ctx, page } = await open(`${OPP}/opp-reddit`);
  const t = await text(page);
  assert.match(t, /Answer in the thread/);
  assert.match(t, /Check the thread is live: recent replies, and still cited this week\. We show the last day it was cited\./);
  assert.match(t, /Still cited this week \(last on 29 Sep\)\./);
  assert.match(t, /No dropped links, and no second accounts\./);
  assert.equal(await page.locator("[data-opp-pitch]").count(), 0);
  await ctx.close();
  await save(`${OPP}/opp-reddit`, "opportunities-detail-thread", "full");
});

test("a page we couldn't read says so, never 'doesn't name you'; a page out of this client's reach is a 404", async () => {
  as("default");
  const { ctx, page } = await open(`${OPP}/opp-unreadable`);
  assert.match(await page.locator("[data-opp-unreadable]").innerText(), /^We couldn't read this page on 27 Sep \(HTTP 403\)\.$/);
  assert.doesNotMatch(await text(page), /doesn't name/i);
  await ctx.close();
  for (const id of ["opp-nope", "not-an-id", "opp-12345"]) {
    const r = await fetch(`${BASE}${OPP}/${id}`);
    assert.equal(r.status, 404, id);
  }
});

test("JS off: Pursue with a free slot - the toast, the prompt added with its slot, and Undo", async () => {
  as("default", { write: true });
  // Free a slot in 'invoicing software' first, through Clusters' own stop.
  const freed = await post("stop?kind=prompt&id=q3-5", { kind: "prompt", id: "q3-5" });
  assert.equal(freed.status, 303);
  const { ctx, page } = await open(OPP, 1280, false);
  await page.locator('[data-opp-row="opp-invoicing"] button[value="pursue"]').click();
  await page.waitForURL(/\/opportunities\/opp-invoicing\?done=pursued/, { timeout: 15_000 });
  assert.equal(await toast(page), "Pursuing. It is checked weekly from now on.");
  assert.match(await page.locator('[data-opp-prompt="added"]').innerText(), /^Added 'best invoicing apps for freelancers' to 'invoicing software' \(slot 5 of 5\)\. It is first asked tomorrow\.$/);
  assert.match(await text(page), /Pursuing since 29 Sep/);
  await page.locator('#prompt button[value="undo"]').click();
  await page.waitForURL(/done=prompt_undone/, { timeout: 15_000 });
  assert.equal(await toast(page), "Prompt taken back. The page is still pursued and watched.");
  assert.match(await text(page), /'invoicing software' has a free slot for 'best invoicing apps for freelancers'\./);
  await ctx.close();
});

test("JS off: Pursue with a full cluster - the swap picker, the weakest suggested, then Swap", async () => {
  as("default", { write: true });
  const { ctx, page } = await open(`${OPP}/opp-bookkeeping`, 1280, false);
  await page.locator('button[value="pursue"]').click();
  await page.waitForURL(/\/opportunities\/opp-bookkeeping\?swap=1&done=pursued/, { timeout: 15_000 });
  const picker = await page.locator("[data-opp-swap]").innerText();
  assert.match(picker, /'bookkeeping software' has no free prompt slot\. Swap one for 'best bookkeeping tools for small businesses', or just watch the page\./);
  assert.match(picker, /What bookkeeping software do US restaurants use\?\s*named in 0 of \d+ answers \(28 days\) · suggested/);
  assert.match(picker, /Just watch the page/);
  await page.locator('[data-opp-swap] button[value="swap:q4-3"]').click();
  await page.waitForURL(/done=prompt_swapped/, { timeout: 15_000 });
  assert.equal(await toast(page), "Swapped. The new prompt is first asked tomorrow; the old one stops after today's check.");
  assert.match(await page.locator('[data-opp-prompt="added"]').innerText(), /^Added 'best bookkeeping tools for small businesses' to 'bookkeeping software'/);
  assert.match(await page.locator("[data-opp-history]").innerText(), /Swapped in the prompt 'best bookkeeping tools for small businesses' by owner@example\.com\./);
  await ctx.close();
});

test("the duplicate message: a page whose prompt is already tracked links it and adds nothing", async () => {
  as("default", { write: true });
  const r = await post("opportunity?id=opp-toolkit&at=detail", { do: "pursue" });
  assert.equal(r.status, 303);
  assert.match(r.headers.get("location")!, /\/app\/tallyroo\/opportunities\/opp-toolkit\?done=pursued$/);
  const { ctx, page } = await open(`${OPP}/opp-toolkit`);
  assert.equal(await page.locator('[data-opp-prompt="duplicate"]').innerText(), "Already measured by 'What's the best accounting app for freelancers?'.");
  await ctx.close();
});

test("JS off: Not for us with a reason - the toast, and the row leaves the list", async () => {
  as("default", { write: true });
  const { ctx, page } = await open(OPP, 1280, false);
  await page.locator('[data-opp-row="opp-expense"] summary').click();
  await page.locator('[data-opp-row="opp-expense"] button[value="dismiss:not_relevant"]').click();
  await page.waitForURL(/done=dismissed/, { timeout: 15_000 });
  assert.equal(await toast(page), "Marked not for us. It won't be suggested again.");
  assert.equal(await page.locator('[data-opp-row="opp-expense"]').count(), 0);
  await ctx.close();
  const { ctx: c2, page: p2 } = await open(`${OPP}/opp-expense`);
  assert.match(await text(p2), /Not for us: not relevant, since 29 Sep/);
  await c2.close();
  const bad = await post("opportunity?id=opp-toolkit", { do: "dismiss:spam" });
  assert.match(bad.headers.get("location")!, /done=refused&why=reason/);
});

test("JS off: Log a site (a canned read) opens the logged page; Verify now (a canned read) records the check", async () => {
  as("default", { write: true });
  const { ctx, page } = await open(`${OPP}?lens=logged`, 1280, false);
  await page.locator("#op-log-url").fill("https://consultantcorner.example/best-accounting-tools");
  await page.locator('#log button[value="log"]').click();
  await page.waitForURL(/\/opportunities\/opp-log-[a-z0-9]+\?done=logged/, { timeout: 15_000 });
  assert.equal(await toast(page), "Logged. Its facts are below once it has been read.");
  const t = await text(page);
  assert.match(t, /Ask to be added/);
  assert.match(t, /You logged it on 29 Sep\./);
  await ctx.close();
  const own = await post("opportunity", { do: "log", url: "https://tallyroo.com/pricing" });
  assert.match(own.headers.get("location")!, /done=refused&why=cannot_log#log$/);
  const placed = await post("opportunity", { do: "log", url: "https://smallbizdesk.example/top-accounting-tools" });
  assert.match(placed.headers.get("location")!, /done=refused&why=cannot_log#log$/, "the same words as any other refusal");
  const { ctx: c2, page: p2 } = await open(`${OPP}/opp-solo`, 1280, false);
  await p2.locator('button[value="verify"]').click();
  await p2.waitForURL(/done=verified/, { timeout: 15_000 });
  assert.equal(await toast(p2), "Checked just now. The result is under Verification.");
  assert.equal(await p2.locator("[data-opp-verified]").innerText(), "Verified: link to tallyroo.com found on the page, followed, 29 Sep");
  await c2.close();
});

test("JS off: a note saves with its toast; one too long is refused", async () => {
  as("default", { write: true });
  const { ctx, page } = await open(`${OPP}/opp-payroll`, 1280, false);
  await page.locator("#opp-note").fill("Followed up on 29 Sep.");
  await page.locator('button[value="note"]').click();
  await page.waitForURL(/done=noted/, { timeout: 15_000 });
  assert.equal(await toast(page), "Note saved.");
  await ctx.close();
  const long = await post("opportunity?id=opp-payroll&at=detail", { do: "note", note: "x".repeat(201) });
  assert.match(long.headers.get("location")!, /done=refused&why=note$/);
});

test("the Pursuing view: status and date, the prompt added or the one that measures it, verification, first cited", async () => {
  as("default");
  const { ctx, page } = await open(`${OPP}?view=pursuing`);
  const t = await page.locator("[data-opp-pursuing]").innerText();
  assert.match(t, /Pursuing since 20 Sep/);
  // On `full` P2's q1-5 keeps the origin P2 recorded, so it measures the page; the `capped` state has it added from the page.
  assert.match(t, /Measured by:\s*'What's a good alternative to Ledgerline for freelancers\?'/);
  assert.match(t, /Measured by:\s*'What's the best payroll and accounting software\?'/);
  assert.match(t, /Your brand appears on the page: yes, since 27 Sep\. Link to tallyroo\.com: no\. Checked 27 Sep\./);
  assert.match(t, /Link to tallyroo\.com: yes, followed\./);
  assert.match(t, /Link to tallyroo\.com: found; follow status not read\./);
  assert.match(t, /First cited by Perplexity for 'Which accounting app helps freelancers get paid faster\?' on 24 Sep\./);
  assert.match(t, /Note: Wrote to the editor on 18 Sep\./);
  await ctx.close();
  await save(`${OPP}?view=pursuing`, "opportunities-pursuing", "full");
  as("default", { diy: "capped" });
  const { ctx: c2, page: p2 } = await open(`${OPP}?view=pursuing`);
  assert.match(await p2.locator("[data-opp-pursuing]").innerText(), /Prompt added:\s*'What's a good alternative to Ledgerline for freelancers\?'/);
  await c2.close();
});

test("U3 never on a page we have not read, nor on one that names you; History shows first cited by engine", async () => {
  as("default");
  for (const id of ["opp-rjs5lw", "opp-dmeqse", "opp-correction"]) {
    const { ctx, page } = await open(`${OPP}/${id}`);
    const t = await text(page);
    assert.doesNotMatch(t, /Shown because this page names/, id);
    assert.equal(await page.locator('[role="note"][aria-label="Upgrade"]').count(), 0, id);
    if (id !== "opp-correction") assert.match(t, /What it is\s+Not read yet\. It is read overnight\./, id);
    await ctx.close();
  }
  const { ctx, page } = await open(`${OPP}/opp-solo`);
  assert.match(await page.locator("[data-opp-first-cited]").innerText(), /^First cited by \w+/);
  await ctx.close();
});

test("JS off: every new cited, thread and profile page set aside - the cited tab never says every page names you", async () => {
  as("default", { write: true });
  const { ctx, page } = await open(OPP, 1280, false);
  const ids = new Set<string>();
  for (const lens of ["", "?lens=threads", "?lens=profiles"]) {
    const { ctx: c, page: p } = await open(`${OPP}${lens}`, 1280, false);
    for (const id of await p.evaluate(() => [...document.querySelectorAll("[data-opp-rows] > li")].map((li) => li.getAttribute("data-opp-row")!))) ids.add(id);
    await c.close();
  }
  assert.ok(ids.size >= 15, `${ids.size} rows`);
  for (const id of ids) {
    const r = await post(`opportunity?id=${id}`, { do: "dismiss:not_relevant" });
    assert.match(r.headers.get("location")!, /done=dismissed/, id);
  }
  await page.goto(BASE + OPP, { waitUntil: "load" });
  const empty = await page.locator("[data-opp-empty]").innerText();
  assert.doesNotMatch(empty, /names you/);
  assert.match(empty, /^Nothing new to list right now\..*under Pursuing/);
  await ctx.close();
});

test("JS off: logging a page you already have opens that row, and adds nothing", async () => {
  as("default", { write: true });
  const r = await post("opportunity", { do: "log", url: "https://consultingtools.example/best-accounting-software-for-consultants" });
  assert.match(r.headers.get("location")!, /\/opportunities\/opp-log-1\?done=already$/);
  const { ctx, page } = await open(`${OPP}/opp-log-1?done=already`);
  assert.equal(await toast(page), "This page is already in your opportunities. Here it is.");
  await ctx.close();
  const cited = await post("opportunity", { do: "log", url: "https://smallbizdesk.example/best-invoicing-apps-for-freelancers" });
  assert.match(cited.headers.get("location")!, /\/opportunities\/opp-invoicing\?done=already$/, "a page cited and listed already is that row");
});

test("the Methods view: every route's playbook, graded line by line, with Google's dated line", async () => {
  as("default");
  const { ctx, page } = await open(`${OPP}?view=methods`);
  assert.equal(await page.locator("[data-opp-method]").count(), 7);
  const t = await text(page);
  for (const r of ["Ask to be added", "Send a correction", "Offer a resource", "Answer in the thread", "Get listed or reviewed", "Publish your own", "Refresh your own"]) assert.match(t, new RegExp(r));
  assert.match(t, /Put key facts in text: keep important content in text form\.\s*Google documents this/);
  assert.ok((t.match(/Common practice/g) ?? []).length >= 20);
  await ctx.close();
  await save(`${OPP}?view=methods`, "opportunities-methods", "full");
});

test("Cited pages ?leaves=1: the pages that leave you out, other clients' placements subtracted, each opening its opportunity", async () => {
  as("default");
  const { ctx, page, status } = await open("/app/tallyroo/cited?leaves=1");
  assert.equal(status, 200);
  const t = await text(page);
  assert.match(t, /1 page cited 90 times, leaving you out\./);
  assert.match(t, /ownerledger\.co/);
  assert.ok(!t.includes("softwarecritic.com"), "another client's placement is subtracted");
  const href = await page.locator('a:has-text("Open in Opportunities")').first().getAttribute("href");
  assert.ok(href && /\/opportunities\/opp-[a-z0-9]+$/.test(href));
  assert.equal((await fetch(new URL(href!, BASE))).status, 200);
  await ctx.close();
  const { ctx: c2, page: p2 } = await open("/app/tallyroo/cited");
  const all = await text(p2);
  assert.match(all, /softwarecritic\.com/, "the unfiltered list is unchanged: every page the engines cite");
  assert.match(all, /Kind\s+Page type/);
  assert.match(all, /Publisher, classified automatically\s+How-to/, "a type the model wrote says so; the rules' does not");
  await c2.close();
  const { ctx: c3, page: p3 } = await open("/app/tallyroo/cited?type=vendor");
  assert.match(await text(p3), /ledgerline\.com/);
  assert.doesNotMatch(await text(p3), /ownerledger\.co/);
  await c3.close();
  await save("/app/tallyroo/cited?leaves=1", "cited-leaves", "full");
});

test("dark: rows from citations, page facts not read, the answers' verdict, no Log or Verify, no rival's comparison page", async () => {
  as("default", { diy: "dark" });
  const { ctx, page } = await open(OPP);
  const t = await text(page);
  assert.doesNotMatch(t, /Log a site you found/);
  assert.match(await page.locator('[data-opp-row="opp-invoicing"]').innerText(), /Cited in answers that name Brightbook and Ledgerline, not you\./);
  assert.match(await page.locator('[data-opp-row="opp-invoicing"]').innerText(), /^smallbizdesk\.example\/best-invoicing-apps-for-freelancers/);
  assert.ok(!t.includes("brightbook.example"));
  assert.ok(!t.includes("shopify.example"), "an unclassified Shopify fails closed");
  await ctx.close();
  const { ctx: c2, page: p2 } = await open(`${OPP}/opp-solo`);
  const d = await text(p2);
  assert.match(d, /What it is\s+Not read yet\./);
  assert.doesNotMatch(d, /Verify now/);
  await c2.close();
  const r = await post("opportunity?id=opp-solo&at=detail", { do: "verify" });
  assert.match(r.headers.get("location")!, /done=refused&why=dark$/);
  await save(OPP, "opportunities-list", "dark");
});

test("day 0: no citations, so only best-of lists on Google and your own pages", async () => {
  as("uncited", { diy: "day0" });
  const { ctx, page } = await open(OPP);
  assert.match(await page.locator("[data-opp-empty]").innerText(), /^Opportunities come from the pages the engines cite for your prompts\./);
  const tabs = await page.evaluate(() => [...document.querySelectorAll('nav[aria-label="Lenses"] a')].map((a) => a.textContent));
  assert.ok(tabs.some((x) => /^Best-of lists on Google, [1-9]/.test(x!)));
  assert.ok(tabs.some((x) => /^Threads, 0$/.test(x!)));
  await ctx.close();
  await save(OPP, "opportunities-list", "day0");
});

test("capped: Pursue is disabled with the line, and U8 shows", async () => {
  as("default", { diy: "capped" });
  const { ctx, page } = await open(OPP);
  const t = await text(page);
  assert.match(t, /You're working 10 pages at once/);
  assert.match(t, /Shown because 10 pages are in Pursuing or Pitched, the most at once\./);
  const btn = page.locator("[data-opp-rows] button[value=pursue]").first();
  assert.equal(await btn.isDisabled(), true);
  assert.match(t, /You're working 10 pages at once\. Mark one won, declined or not for us to pursue another\./);
  await ctx.close();
  as("default", { diy: "capped", write: true });
  const r = await post("opportunity?id=opp-unreadable", { do: "pursue" });
  assert.match(r.headers.get("location")!, /done=refused&why=cap/);
  await save(OPP, "opportunities-list", "capped");
});

test("zero: every cited page names you, and the list says where the next gains are", async () => {
  as("default", { diy: "zero" });
  const { ctx, page } = await open(OPP);
  assert.equal(await page.locator("[data-opp-empty]").innerText(), "Every page the engines cite for these prompts names you. The next gains are on Google: see Your pages.");
  await ctx.close();
});

test("a viewer sees every write control disabled with the reason, and the routes refuse them", async () => {
  as("default", { role: "viewer", write: true });
  for (const route of [OPP, `${OPP}/opp-solo`]) {
    const { ctx, page } = await open(route);
    assert.match(await text(page), /Viewers can't change this\. Ask an owner or editor\./);
    const controls = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLTextAreaElement>('#app-content form[method="post"] button, #app-content form[method="post"] input, #app-content form[method="post"] textarea')]
        .filter((c) => !/\/(ask|hide)(\?|$)/.test(c.closest("form")!.getAttribute("action") ?? ""))
        .map((c) => ({ off: c.disabled, why: (c.getAttribute("aria-describedby") ?? "").split(" ").some((id) => document.getElementById(id)?.textContent === "Viewers can't change this. Ask an owner or editor.") })),
    );
    assert.ok(controls.length >= 5, `${route}: ${controls.length} controls`);
    assert.ok(controls.every((c) => c.off && c.why), `${route}: every write control off, pointing at its reason`);
    await ctx.close();
  }
  for (const [route, fields] of [["opportunity?id=opp-invoicing", { do: "pursue" }], ["prompt-offer?id=opp-solo", { do: "watch" }]] as const) {
    const r = await post(route, fields);
    assert.match(r.headers.get("location")!, /done=refused&why=viewer/);
  }
});

test("no sideways scroll at 390 and 320; the rows are cards below 860", async () => {
  as("default");
  for (const route of [OPP, `${OPP}?lens=own`, `${OPP}/opp-invoicing`, `${OPP}/opp-bookkeeping?swap=1`, `${OPP}?view=pursuing`, `${OPP}?view=methods`, "/app/tallyroo/cited?leaves=1"]) {
    for (const width of [390, 320]) {
      const { ctx, page } = await open(route, width);
      assert.equal(await sideways(page), 0, `${route} at ${width}`);
      if (route === OPP) {
        const cols = await page.evaluate(() => getComputedStyle(document.querySelector(".opp-row")!).gridTemplateColumns.split(" ").length);
        assert.equal(cols, 1, "one column: a card");
      }
      await ctx.close();
    }
  }
});

test("axe: no serious or critical violation on the list, one opportunity, Pursuing, Methods, Cited's leaves, dark and a viewer's page", async () => {
  for (const [route, state, o, width] of [
    [OPP, "default", {}, 1280],
    [OPP, "default", {}, 390],
    [`${OPP}/opp-invoicing`, "default", {}, 1280],
    [`${OPP}/opp-bookkeeping?swap=1`, "default", {}, 390],
    [`${OPP}?view=pursuing`, "default", {}, 1280],
    [`${OPP}?view=methods`, "default", {}, 1280],
    ["/app/tallyroo/cited?leaves=1", "default", {}, 1280],
    [OPP, "default", { diy: "dark" }, 1280],
    [`${OPP}/opp-solo`, "default", { role: "viewer" }, 1280],
  ] as const) {
    as(state, o);
    const { ctx, page } = await open(route, width);
    assert.deepEqual(await axe(page), [], `${route} ${JSON.stringify(o)} at ${width}`);
    await ctx.close();
  }
});

test("every evidence link and every link on the list and the detail page resolves", async () => {
  as("default");
  const hrefs = new Set<string>();
  for (const route of [OPP, `${OPP}/opp-invoicing`, `${OPP}?view=pursuing`]) {
    const { ctx, page } = await open(route);
    for (const h of await page.evaluate(() => [...document.querySelectorAll<HTMLAnchorElement>("#app-content a[href]")].map((a) => a.getAttribute("href")!))) hrefs.add(h);
    await ctx.close();
  }
  const own = [...hrefs].filter((h) => h.startsWith("/"));
  const evidence = own.filter((h) => /\/clusters\/c\d+\?.*day=.*engine=/.test(h));
  assert.ok(evidence.length >= 10, `found ${evidence.length} evidence links`);
  for (const h of own.filter((x) => !x.includes("/tallyroo/pages"))) {
    const r = await fetch(new URL(h, BASE), { redirect: "manual" });
    assert.equal(r.status, 200, h);
  }
  // An evidence link opens the answer it counted: its day and engine, on the one-cluster page.
  const { ctx, page } = await open(evidence[0]!);
  assert.match(page.url(), /#answer-/);
  await ctx.close();
});
