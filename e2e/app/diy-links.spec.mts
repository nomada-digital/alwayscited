/**
 * DIY P10 (13 Oct 2026; spec 10 sections 4.8, 6.3 and 7.11): Links on the
 * fixture - TRACKING_FIXTURE=1 with DIY_FIXTURE_STATE, the made-up reads in
 * src/lib/diy/fixtures/links.json - served in-process on the build, as
 * e2e/app/diy-opportunities.spec.mts serves Opportunities.
 *
 * Holds what section 7.0 item 7 asks of every DIY spec: axe finds no serious
 * or critical violation; no sideways page scroll at 390 and 320; every write
 * form works with JS off (a 303 and its toast); a viewer sees the controls
 * disabled with the reason; every link resolves. And the package's own
 * (section 7.11): every view; a reveal with JS off increments, and the cap
 * message and U5 show; Check a link; Pursue from the gap, then the row is in
 * Opportunities under Pursuing; the inactive state; the dark, day 0 and
 * fewer-than-3 states; and 390. Nomada's placements for another client
 * (softwarecritic.com, accountsweekly.example in the fixture) appear nowhere.
 *
 * Saves each view's screens to test-results/diy/links/<page>-<state>-<width>.png
 * (1280x900 and 390x844) and its HTML to test-results/diy/links/<page>-<state>.html
 * for the gating census (section 6.10 item 2), whose route is read from a name
 * starting `links-`. Not committed.
 *
 *   npm run build && E2E_PORT=3690 node --test e2e/app/diy-links.spec.mts
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const OUT = path.join(ROOT, "test-results", "diy", "links");
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

const PORT = Number(process.env.E2E_PORT ?? 3690);
const BASE = `http://localhost:${PORT}`;
const LINKS = "/app/tallyroo/links";
const API = `${BASE}/api/app/tallyroo`;
const PLACED = /softwarecritic\.com|accountsweekly\.example/;

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
  for (const k of ["alwayscited.trackingFixture", "alwayscited.diyFixture.links", "alwayscited.diyFixture.opportunities"]) delete (globalThis as Record<symbol, unknown>)[Symbol.for(k)];
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
async function post(fields: Record<string, string>, view = "") {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.set(k, v);
  return fetch(`${API}/links${view ? `?view=${view}` : ""}`, { method: "POST", body, redirect: "manual" });
}

/** Nomada's placements for another client are in neither the page's words nor its HTML. */
async function noPlacements(page: Page, where: string) {
  assert.doesNotMatch(await text(page), PLACED, `${where}: a placement in the words`);
  assert.doesNotMatch(await page.content(), PLACED, `${where}: a placement in the HTML`);
}

test("Your links (full): the profile, every DataForSEO number labelled with its read date, the weeks, the moves, the comparison and the wins", async () => {
  as("default");
  const { ctx, page, status } = await open(LINKS);
  assert.equal(status, 200);
  assert.equal(await page.locator("h1").innerText(), "Links");
  const t = await text(page);
  assert.match(t, /Referring domains\s+312/);
  assert.match(t, /Backlinks\s+1,840/);
  assert.match(t, /DataForSEO rank\s+212\s+DataForSEO estimate, 0-1000/);
  assert.match(t, /Followed\s+84%\s+Not followed 14%, other 2%/);
  assert.match(t, /DataForSEO estimate, read 24 Sep\. Counted from DataForSEO's index, not from Google\./);
  assert.equal(await page.locator('section[aria-labelledby="lk-weeks"] tbody tr').count(), 13);
  assert.match(t, /New and lost since 17 Sep/);
  assert.match(t, /smallbizdesk\.example links to your homepage/);
  assert.match(t, /ledgerjournal\.example linked to \/invoicing/);
  assert.match(t, /Compared with ledgerline\.com, brightbook\.example and countwise\.example: the vendor sites holding the most page-1 places for your keywords this month \(derived 10 Sep\)\./);
  assert.match(t, /tallyroo\.com \(you\)/);
  assert.match(await page.locator("[data-links-wins]").innerText(), /Our 2026 reviews\s+Won since 2 Sep/);
  assert.match(t, /Verified: link to tallyroo\.com found on the page, followed, 23 Sep|Link to tallyroo\.com: yes, followed\./);
  assert.doesNotMatch(t, /\bDR\b|domain rating|sponsored|difficulty/i);
  await noPlacements(page, "profile");
  await ctx.close();
  await save(LINKS, "links-profile", "full");
});

test("Link gap (full): the top 25, links to 3 first, a count for the rest, Pursue, and the Earn a link method with Google's dated line", async () => {
  as("default");
  const { ctx, page } = await open(`${LINKS}?view=gap`);
  assert.equal(await page.locator("[data-links-gap] > li").count(), 25);
  const first = await page.locator("[data-links-gap] > li").first().innerText();
  assert.match(first, /Links to 3 of 3: ledgerline\.com, brightbook\.example, countwise\.example/);
  assert.match(first, /Earn a link/);
  assert.equal(await page.locator("[data-links-more]").innerText(), "47 more sites link to two or more of these and not to you.");
  const t = await text(page);
  assert.match(t, /Sites linking to at least 2 of the 3 sites you compete with, and not to you, with followed links\. Top 25, most of the 3 first\. DataForSEO estimate, read 10 Sep\./);
  assert.match(t, /Open the site and find the pages that link to the sites you compete with\./);
  assert.match(t, /Never pay for a followed link\.\s*Google documents this/);
  assert.match(t, /Google's spam policies \(updated 28 Aug 2026\) treat buying links that pass ranking credit, excessive link exchanges, and keyword-rich anchor text in articles you supply as link spam\./);
  assert.match(t, /We never supply names or addresses\./);
  assert.equal(await page.locator("[data-links-gap] > li:not(:has(button[value=pursue]))").count(), 1, "the seeded pursuit shows its status instead of offering Pursue");
  await noPlacements(page, "gap");
  await ctx.close();
  await save(`${LINKS}?view=gap`, "links-gap", "full");
});

test("Link targets (full), then a reveal with JS off: the next 5 shown, the month's count up, the cap line and U5; the same form again reveals nothing", async () => {
  as("default", { write: true });
  const { ctx, page } = await open(`${LINKS}?view=targets`, 1280, false);
  let t = await text(page);
  assert.match(t, /This month's revealed pages: 0 of 5/);
  assert.match(t, /None revealed yet this month\./);
  assert.equal(await page.locator("[data-links-more]").innerText(), "23 more pages link to the sites you compete with from inside an article, and not to you. Next reveals from 1 Oct, or 5 left this month.");
  assert.match(t, /Revealed in earlier months \(5\)/);
  assert.equal(await page.locator('[role="note"][aria-label="Upgrade"]').count(), 0, "no U5 while reveals remain");
  await noPlacements(page, "targets");
  await save(`${LINKS}?view=targets`, "links-targets", "full");
  await page.locator('button[value="reveal"]').click();
  await page.waitForURL(/view=targets&done=revealed/, { timeout: 15_000 });
  assert.equal(await toast(page), "Revealed. These pages stay on your list.");
  t = await text(page);
  assert.match(t, /This month's revealed pages: 5 of 5/);
  assert.equal(await page.locator("[data-links-revealed] > li").count(), 5);
  assert.equal(await page.locator("[data-links-cap]").innerText(), "You've used this month's 5 link targets. They reset on 1 Oct.");
  assert.equal(await page.locator('button[value="reveal"]').count(), 0);
  assert.match(t, /This month's link targets are used/);
  assert.match(t, /Link insertions on pages that already rank, plus on-site work on your own pages, is what/);
  assert.match(t, /Shown because you revealed this month's 5 link targets\. They reset on 1 Oct\./);
  assert.match(await page.locator("[data-links-revealed] > li").first().innerText(), /Links to ledgerline\.com with 'Ledgerline'/);
  await noPlacements(page, "targets after the reveal");
  await ctx.close();
  await save(`${LINKS}?view=targets`, "links-targets", "revealed");
  const again = await post({ do: "reveal", seen: "0" }, "targets");
  assert.equal(again.status, 303);
  assert.match(again.headers.get("location")!, /\/links\?view=targets&done=already#targets$/, "the form drawn before the reveal reveals nothing more");
  const over = await post({ do: "reveal", seen: "5" }, "targets");
  assert.match(over.headers.get("location")!, /done=refused&why=reveal_cap#targets$/);
});

test("capped: this month's reveals are used, so the cap line and U5 show at once; Check a link is used up too", async () => {
  as("default", { diy: "capped" });
  const { ctx, page } = await open(`${LINKS}?view=targets`);
  assert.equal(await page.locator("[data-links-cap]").innerText(), "You've used this month's 5 link targets. They reset on 1 Oct.");
  assert.equal(await page.locator('[role="note"][aria-label="Upgrade"]').count(), 1);
  assert.match(await text(page), /18 more pages link to the sites you compete with/);
  await ctx.close();
  await save(`${LINKS}?view=targets`, "links-targets", "capped");
  const { ctx: c2, page: p2 } = await open(`${LINKS}?view=check`);
  assert.equal(await p2.locator("[data-links-cap]").innerText(), "You've used this month's 30 link checks. They reset on 1 Oct.");
  assert.equal(await p2.locator("#lk-url").count(), 0);
  await c2.close();
});

test("Mentions: pages we read ourselves that name Tallyroo with no link, each with its snippet, and the Ask for a link method", async () => {
  as("default");
  const { ctx, page } = await open(`${LINKS}?view=mentions`);
  assert.equal(await page.locator("[data-links-mentions] > li").count(), 6);
  const t = await text(page);
  assert.match(t, /Pages that name Tallyroo and don't link to you\. DataForSEO's index found the pages; we read each one ourselves \(10 Sep\)/);
  assert.match(t, /"We moved invoicing to Tallyroo in March and have not looked back\."/);
  assert.match(t, /Published 4 Sep · read by us 10 Sep/);
  assert.match(t, /Ask for a link/);
  assert.match(t, /Thank them for the mention\./);
  assert.match(t, /No payment, and no request for a keyword-rich anchor\.\s*Google documents this/);
  await noPlacements(page, "mentions");
  await ctx.close();
  await save(`${LINKS}?view=mentions`, "links-mentions", "full");
});

test("JS off: Check a link - a link found, followed; a page with none; your own site and a bad address refused", async () => {
  as("default", { write: true });
  const { ctx, page } = await open(`${LINKS}?view=check`, 1280, false);
  assert.match(await text(page), /Link checks this month: 3 of 30, shared with Verify now and Log a site on Opportunities\. They reset on 1 Oct\./);
  await page.locator("#lk-url").fill("https://startupnotes.example/2026/09/software-we-pay-for");
  await page.locator('button[value="check"]').click();
  await page.waitForURL(/view=check&done=checked#check$/, { timeout: 15_000 });
  assert.equal(await toast(page), "Checked. The result is below.");
  const first = await page.locator("[data-links-checks] > li").first().innerText();
  assert.match(first, /startupnotes\.example\/2026\/09\/software-we-pay-for/);
  assert.match(first, /Links to tallyroo\.com\/invoicing: anchor 'Tallyroo', followed\. Read 29 Sep\./);
  assert.match(await text(page), /Link checks this month: 4 of 30/);
  await page.locator("#lk-url").fill("https://plainbooksdigest.example/nolink-here");
  await page.locator('button[value="check"]').click();
  await page.waitForURL(/done=checked/, { timeout: 15_000 });
  assert.match(await page.locator("[data-links-checks] > li").first().innerText(), /No link to tallyroo\.com on this page\. Read 29 Sep\./);
  await ctx.close();
  await save(`${LINKS}?view=check`, "links-check", "full");
  const own = await post({ do: "check", url: "https://tallyroo.com/pricing" }, "check");
  assert.match(own.headers.get("location")!, /done=refused&why=own#check$/);
  const bad = await post({ do: "check", url: "javascript:alert(1)" }, "check");
  assert.match(bad.headers.get("location")!, /done=refused&why=url#check$/);
  const { ctx: c2, page: p2 } = await open(`${LINKS}?view=check&done=refused&why=own`);
  assert.equal(await toast(p2), "That's a page on your own site. Check a page on another site for a link to yours.");
  await c2.close();
});

test("JS off: Pursue from the gap - the toast, the row marked Pursuing here, and the row in Opportunities under Pursuing", async () => {
  as("default", { write: true });
  const { ctx, page } = await open(`${LINKS}?view=gap`, 1280, false);
  const row = page.locator("[data-links-gap] > li:has(button[value=pursue])").first();
  const domain = (await row.getAttribute("data-links-row"))!;
  await row.locator('button[value="pursue"]').click();
  await page.waitForURL(/view=gap&done=pursued#gap$/, { timeout: 15_000 });
  assert.equal(await toast(page), "Pursuing. It's in Opportunities, under Pursuing, and in Actions.");
  assert.match(await page.locator(`[data-links-row="${domain}"]`).innerText(), /Pursuing/);
  assert.equal(await page.locator(`[data-links-row="${domain}"] button[value=pursue]`).count(), 0);
  await ctx.close();
  const { ctx: c2, page: p2 } = await open("/app/tallyroo/opportunities?view=pursuing");
  const pursuing = await p2.locator("[data-opp-pursuing]").innerText();
  assert.ok(pursuing.includes(domain), `${domain} is in Opportunities under Pursuing`);
  assert.match(pursuing, /Earn a link/);
  await c2.close();
  const { ctx: c3, page: p3 } = await open(LINKS);
  assert.ok((await p3.locator("[data-links-wins]").innerText()).includes(domain), "and in the wins on Links");
  await c3.close();
  const gone = await post({ do: "pursue", lens: "link_domain", key: "softwarecritic.com" }, "gap");
  assert.match(gone.headers.get("location")!, /done=refused&why=gone#gap$/, "a placed domain is no row to pursue, and the words say nothing about why");
});

test("nolinks: the latest Backlinks call failed with an access code - 'not available yet', no paid section, Check a link and the wins still work", async () => {
  as("default", { diy: "nolinks" });
  const { ctx, page } = await open(LINKS);
  const t = await text(page);
  assert.match(t, /Your link profile isn't available yet\./);
  assert.match(t, /Check a link still works/);
  assert.doesNotMatch(t, /Referring domains|Link gap|Compared with/);
  const views = await page.evaluate(() => [...document.querySelectorAll('nav[aria-label="Links views"] a')].map((a) => a.textContent));
  assert.deepEqual(views, ["Your links", "Check a link"]);
  assert.equal(await page.locator("[data-links-wins] > li").count(), 2);
  await ctx.close();
  await save(LINKS, "links-profile", "nolinks");
  await save(`${LINKS}?view=check`, "links-check", "nolinks");
  const r = await post({ do: "reveal", seen: "0" }, "targets");
  assert.match(r.headers.get("location")!, /done=refused&why=gone/);
});

test("dark: nothing paid shows or is promised; the wins, both methods and Check a link do; reveal is refused", async () => {
  as("default", { diy: "dark" });
  const { ctx, page } = await open(`${LINKS}?view=gap`);
  const t = await text(page);
  assert.doesNotMatch(t, /Referring domains|First read|read weekly|DataForSEO estimate/);
  assert.match(t, /Links you are pursuing/);
  assert.match(t, /Earn a link/);
  assert.match(t, /Ask for a link/);
  await ctx.close();
  await save(LINKS, "links-profile", "dark");
  const r = await post({ do: "reveal", seen: "0" }, "targets");
  assert.match(r.headers.get("location")!, /done=refused&why=dark#targets$/);
});

test("day 0: the profile is read weekly, first read on the day a queued job runs; zero: not in the index", async () => {
  as("default", { diy: "day0" });
  const { ctx, page } = await open(LINKS);
  assert.match(await page.locator('[data-links-state="not_read"]').innerText(), /Your link profile is read weekly\. First read 30 Sep\./);
  await ctx.close();
  as("default", { diy: "zero" });
  const { ctx: c2, page: p2 } = await open(LINKS);
  assert.equal(await p2.locator('[data-links-state="not-indexed"]').innerText(), "No links found in DataForSEO's index for tallyroo.com (read 24 Sep). Check a link still works.");
  await c2.close();
});

test("fewer than 3 compared sites: each domain's basis, a fallback never called a page-1 holder, and no gap or targets", async () => {
  as("default", { diy: "fewcompetitors" });
  const { ctx, page } = await open(LINKS);
  assert.equal(await page.locator("[data-links-basis]").innerText(), "Compared with ledgerline.com (page-1 places for your keywords: 14) and sumly.example (shares 212 keywords with you, DataForSEO estimate). Derived 10 Sep.");
  await ctx.close();
  for (const v of ["gap", "targets"]) {
    const { ctx: c, page: p } = await open(`${LINKS}?view=${v}`);
    assert.equal(await p.locator('[data-links-state="few"]').innerText(), "We compare you with the 3 vendor sites holding the most page-1 places for your keywords, and there aren't 3 yet. This fills in as your keywords rank.");
    await c.close();
  }
  await save(`${LINKS}?view=gap`, "links-gap", "fewcompetitors");
});

test("a viewer sees every write control disabled with the reason, and the route refuses them", async () => {
  as("default", { role: "viewer", write: true });
  for (const route of [`${LINKS}?view=gap`, `${LINKS}?view=targets`, `${LINKS}?view=mentions`, `${LINKS}?view=check`]) {
    const { ctx, page } = await open(route);
    assert.match(await text(page), /Viewers can't change this\. Ask an owner or editor\./);
    const controls = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLButtonElement | HTMLInputElement>('#app-content form[method="post"] button, #app-content form[method="post"] input:not([type="hidden"])')]
        .filter((c) => !/\/(ask|hide)(\?|$)/.test(c.closest("form")!.getAttribute("action") ?? ""))
        .map((c) => ({ off: c.disabled, why: (c.getAttribute("aria-describedby") ?? "").split(" ").some((id) => document.getElementById(id)?.textContent === "Viewers can't change this. Ask an owner or editor.") })),
    );
    assert.ok(controls.length >= 1, `${route}: ${controls.length} controls`);
    assert.ok(controls.every((c) => c.off && c.why), `${route}: every write control off, pointing at its reason`);
    await ctx.close();
  }
  const posts: Record<string, string>[] = [{ do: "reveal", seen: "0" }, { do: "check", url: "https://a.example/" }, { do: "pursue", lens: "mention", key: "booksandbills.example/blog/our-stack" }];
  for (const fields of posts) {
    const r = await post(fields);
    assert.match(r.headers.get("location")!, /done=refused&why=viewer/, fields.do);
  }
  const bad = await fetch(`${API}/links`, { method: "POST", body: new URLSearchParams({ do: "export" }), redirect: "manual" });
  assert.equal(bad.status, 400, "no other change is taken");
});

test("no sideways scroll at 390 and 320 on any view; the rows are cards below 860", async () => {
  as("default");
  for (const route of [LINKS, `${LINKS}?view=gap`, `${LINKS}?view=targets`, `${LINKS}?view=mentions`, `${LINKS}?view=check`]) {
    for (const width of [390, 320]) {
      const { ctx, page } = await open(route, width);
      assert.equal(await sideways(page), 0, `${route} at ${width}`);
      if (route.endsWith("gap")) {
        const cols = await page.evaluate(() => getComputedStyle(document.querySelector(".lk-row")!).gridTemplateColumns.split(" ").length);
        assert.equal(cols, 1, "one column: a card");
      }
      await ctx.close();
    }
  }
});

test("axe: no serious or critical violation on every view, the inactive and dark states, U5 and a viewer's page", async () => {
  for (const [route, o, width] of [
    [LINKS, {}, 1280],
    [LINKS, {}, 390],
    [`${LINKS}?view=gap`, {}, 1280],
    [`${LINKS}?view=targets`, { diy: "capped" }, 1280],
    [`${LINKS}?view=mentions`, {}, 390],
    [`${LINKS}?view=check`, {}, 1280],
    [LINKS, { diy: "nolinks" }, 1280],
    [LINKS, { diy: "dark" }, 390],
    [`${LINKS}?view=gap`, { role: "viewer" }, 1280],
  ] as const) {
    as("default", o);
    const { ctx, page } = await open(route, width);
    assert.deepEqual(await axe(page), [], `${route} ${JSON.stringify(o)} at ${width}`);
    await ctx.close();
  }
});

test("every link on every view resolves", async () => {
  as("default");
  const hrefs = new Set<string>();
  for (const route of [LINKS, `${LINKS}?view=gap`, `${LINKS}?view=targets`, `${LINKS}?view=mentions`, `${LINKS}?view=check`]) {
    const { ctx, page } = await open(route);
    for (const h of await page.evaluate(() => [...document.querySelectorAll<HTMLAnchorElement>("#app-content a[href]")].map((a) => a.getAttribute("href")!))) hrefs.add(h);
    await ctx.close();
  }
  const own = [...hrefs].filter((h) => h.startsWith("/"));
  assert.ok(own.length >= 6, `${own.length} links`);
  for (const h of own) {
    const r = await fetch(new URL(h, BASE), { redirect: "manual" });
    assert.equal(r.status, 200, h);
  }
  const outside = [...hrefs].filter((h) => /^https?:/.test(h));
  assert.ok(outside.every((h) => !PLACED.test(h)), "no link to a placement");
});
