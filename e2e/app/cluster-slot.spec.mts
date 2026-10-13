/**
 * A cluster keyword's Google slot (13 Oct 2026, Danny): on the Overview's
 * "Your clusters" cards and phone rows, the Clusters page and the one-cluster
 * page, a keyword read and outside Google's top 20 says so with its market -
 * "Not in top 20 (US)" on the fixture, whose client is in the US - with the
 * full sentence for a screen reader; a cluster before its first check says
 * "Not checked yet", a day with no reading "Not measured that day"; never a
 * bare "-". (The Overview's Google keywords table, drawn only for a client
 * with no clusters, takes the same words; the fixture has clusters.) Where the Google page has the keyword's page 1 stored, the slot
 * links "See who ranks" to that row, and the row opens on it.
 *
 * On the tracking fixture (TRACKING_FIXTURE=1, DIY fixture `full`), served
 * in-process on the build as diy-plan.spec.mts serves it. The fixture's c9
 * ('accounting software for nonprofits', k9) is read every day and never in
 * the top 20; c10 starts the day after the fixture's today.
 *
 * Saves the screens to test-results/actions/<page>-<width>.png (1280x900 and
 * 390x844). Not committed.
 *
 *   npm run build && E2E_PORT=3732 node --test e2e/app/cluster-slot.spec.mts
 */
import { mkdirSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const OUT = path.join(ROOT, "test-results", "actions");
const require = createRequire(path.join(os.homedir(), "code/.parity/package.json"));
type Locator = { count(): Promise<number>; first(): Locator; innerText(): Promise<string>; getAttribute(name: string): Promise<string | null>; isVisible(): Promise<boolean> };
type Page = {
  goto(url: string, o?: object): Promise<{ status(): number } | null>;
  locator(sel: string): Locator;
  evaluate<R>(fn: () => R | Promise<R>): Promise<R>;
  evaluate<R, A>(fn: (a: A) => R | Promise<R>, a: A): Promise<R>;
  addScriptTag(o: { content: string }): Promise<unknown>;
  screenshot(o: { path: string; fullPage?: boolean }): Promise<unknown>;
};
type Context = { newPage(): Promise<Page>; close(): Promise<void> };
type Browser = { newContext(o: object): Promise<Context>; close(): Promise<void> };
const { chromium } = require("playwright") as { chromium: { launch(): Promise<Browser> } };
const AXE = readFileSync(path.join(ROOT, "node_modules", "axe-core", "axe.min.js"), "utf8");

const PORT = Number(process.env.E2E_PORT ?? 3732);
const BASE = `http://localhost:${PORT}`;
const APP = "/app/tallyroo";
const OUT_SENTENCE = "'accounting software for nonprofits' is not in Google's top 20 in the US at its latest reading, 29 Sep.";

let server: Server | null = null;
let browser: Browser;

before(async () => {
  process.env.TRACKING_FIXTURE = "1";
  process.env.VERCEL_ENV = "development";
  delete process.env.TRACKING_FIXTURE_STATE;
  delete process.env.DIY_FIXTURE_STATE;
  process.env.TRACKING_FIXTURE_ROLE = "owner";
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

async function open(route: string, width = 1280, javaScriptEnabled = true) {
  const ctx = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 900 }, javaScriptEnabled });
  const page = await ctx.newPage();
  const r = await page.goto(BASE + route, { waitUntil: "load" });
  return { ctx, page, status: r?.status() };
}

/** Each Google slot on the page: its kind, the words a sighted reader sees, and the sentence a screen reader hears. */
const slots = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("[data-position]")].map((e) => ({
      kind: e.getAttribute("data-position"),
      shown: (e.querySelector('[aria-hidden="true"]')?.textContent ?? "").trim(),
      said: (e.querySelector(".sr-only")?.textContent ?? "").trim(),
      visible: e.offsetParent !== null,
    })),
  );

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

test("Overview cards: out of the top 20 with its market, the first check still to come, every other a position; never a bare '-'", async () => {
  const { ctx, page, status } = await open(APP);
  assert.equal(status, 200);
  const cards = (await slots(page)).filter((s) => s.visible);
  assert.ok(cards.length >= 10, `${cards.length} slots`);
  assert.ok(cards.every((s) => s.shown !== "-" && s.shown !== ""), "no bare dash");
  const out = cards.filter((s) => s.kind === "out");
  assert.deepEqual([...new Set(out.map((s) => s.shown))], ["Not in top 20 (US)"]);
  assert.deepEqual([...new Set(out.map((s) => s.said))], [OUT_SENTENCE]);
  assert.deepEqual([...new Set(cards.filter((s) => s.kind === "pending").map((s) => s.shown))], ["Not checked yet"]);
  assert.ok(cards.filter((s) => s.kind === "ranked").every((s) => /^#\d+$/.test(s.shown)));
  assert.deepEqual(await axe(page), []);
  await ctx.close();
});

test("See who ranks: on a read keyword whose page 1 is stored, to its Google row, which opens on who holds page 1; none before the first check", async () => {
  const { ctx, page } = await open(APP);
  const links = await page.evaluate(() => [...document.querySelectorAll<HTMLAnchorElement>('section[aria-labelledby="cl-h"] a')].filter((a) => a.textContent?.startsWith("See who ranks")).map((a) => ({ href: a.getAttribute("href")!, said: a.textContent })));
  await ctx.close();
  assert.equal(links.length, 9, "the nine read keywords; payroll and accounting software is not read yet");
  const k9 = links.find((l) => /row=k9/.test(l.href))!;
  assert.match(k9.href, /^\/app\/tallyroo\/google\?.*row=k9#kw-h$/);
  assert.equal(k9.said, "See who ranks: Google's page 1 for 'accounting software for nonprofits'");
  assert.ok(!links.some((l) => /row=k10/.test(l.href)));
  const g = await open(k9.href);
  assert.equal(g.status, 200);
  const row = await g.page.locator('[data-keyword="k9"]').first().innerText();
  assert.match(row, /Not in the top 20/);
  assert.match(await g.page.locator("#app-content").first().innerText(), /Google's organic results for this keyword, top to bottom, checked 29 Sep 2026\./);
  await g.ctx.close();
});

test("a range with no reading says 'Not measured that day', never 'Not in top 20'", async () => {
  // 1 Aug is inside tracking (from 10 Jun) and before the fixture's first reading (5 Aug): nothing was read that day.
  const { ctx, page, status } = await open(`${APP}/clusters?from=2026-08-01&to=2026-08-01`);
  assert.equal(status, 200);
  const live = (await slots(page)).filter((s) => s.visible && s.kind !== "pending" && s.kind !== "none");
  assert.ok(live.length >= 8, `${live.length}`);
  assert.ok(live.every((s) => s.kind === "unread" && s.shown === "Not measured that day" && /was not read on Google on 1 Aug\.$/.test(s.said)), JSON.stringify(live.slice(0, 2)));
  assert.equal(await page.locator('a:has-text("See who ranks")').count(), 0, "no page 1 to show for a day not read");
  await ctx.close();
});

test("Clusters and the one-cluster page: the same words in the row, the keyword card and the figure, with See who ranks", async () => {
  const cl = await open(`${APP}/clusters?open=c9`);
  assert.equal(cl.status, 200);
  const s = (await slots(cl.page)).filter((x) => x.visible);
  assert.ok(s.some((x) => x.kind === "out" && x.shown === "Not in top 20 (US)"));
  assert.ok(!s.some((x) => x.shown === "-"));
  const box = await cl.page.locator(".app-cl-kw").first().innerText();
  assert.match(box, /Not in top 20 \(US\)[\s\S]*See who ranks[\s\S]*Your ranking page\s+None in the top 20/);
  assert.deepEqual(await axe(cl.page), []);
  await cl.ctx.close();
  const one = await open(`${APP}/clusters/c9`);
  assert.equal(one.status, 200);
  const fig = await one.page.locator('[data-figure="cl-google"]').first().innerText();
  assert.match(fig, /Not in top 20 \(US\)/);
  assert.match(await one.page.locator('section[aria-label="Summary"]').innerText(), /Google position[\s\S]*Not in top 20 \(US\)[\s\S]*Checked 29 Sep/);
  assert.equal(await one.page.locator('a:has-text("See who ranks")').count(), 1);
  await one.ctx.close();
  const pending = await open(`${APP}/clusters/c10`);
  const ps = (await slots(pending.page)).filter((x) => x.visible);
  assert.ok(ps.length >= 2 && ps.every((x) => x.kind === "pending" && x.shown === "Not checked yet"));
  assert.equal(await pending.page.locator('a:has-text("See who ranks")').count(), 0);
  await pending.ctx.close();
});

test("at 390 and 320: the phone rows say the words in their box, and nothing scrolls sideways; screens saved", async () => {
  for (const width of [390, 320]) {
    const { ctx, page } = await open(APP, width);
    const rows = (await slots(page)).filter((s) => s.visible);
    assert.ok(rows.some((s) => s.kind === "out" && s.shown === "Not in top 20 (US)"), `${width}`);
    assert.ok(rows.some((s) => s.kind === "pending" && s.shown === "Not checked yet"), `${width}`);
    assert.equal(await sideways(page), 0, `${APP} at ${width}`);
    await ctx.close();
    for (const route of [`${APP}/clusters?open=c9`, `${APP}/clusters/c9`]) {
      const o = await open(route, width);
      assert.equal(await sideways(o.page), 0, `${route} at ${width}`);
      await o.ctx.close();
    }
  }
  for (const [route, name] of [
    [APP, "overview-clusters"],
    [`${APP}/clusters?open=c9`, "clusters-c9"],
    [`${APP}/clusters/c9`, "one-cluster-c9"],
    [`${APP}/clusters/c10`, "one-cluster-c10-pending"],
  ] as const) {
    for (const width of [1280, 390]) {
      const { ctx, page } = await open(route, width);
      await page.screenshot({ path: path.join(OUT, `${name}-${width}.png`), fullPage: true });
      await ctx.close();
    }
  }
});
