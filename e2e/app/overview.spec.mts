/**
 * `npm run e2e:app` - the T9 harness (R93, 29 Sep 2026; BRIEF-2 T9). Runs the
 * real /app pages under `next start` with `TRACKING_FIXTURE=1`, so no login
 * and no database: made-up Tallyroo from src/lib/tracking/fixture.json.
 *
 * Needs a build (`npm run build`). Serves it in-process on E2E_PORT (3107)
 * unless E2E_BASE points at a server already running in fixture mode.
 *
 * Playwright is resolved from ~/code/.parity, the copy docs/parity/shoot.mjs
 * uses, and axe from the repo's own node_modules/axe-core (a lint
 * dependency), injected into the page - the engine @axe-core/playwright
 * wraps. Neither is a dependency of the site build.
 *
 * Every check runs at 1440, 1024 and 390, each with and without reduced
 * motion. Screens not built yet (T5 picker, T6 questions, T7 one question,
 * T8 CSV, T13 placements) carry their task budgets as `todo`, so the gap is
 * reported rather than passing silently.
 */
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";

import { expandFixture } from "../../src/lib/tracking/fixture-mode.ts";
import { clusterCards, clusterSummary } from "../../src/lib/tracking/cluster-figures.ts";
import { addDays, overview, type Rate } from "../../src/lib/tracking/figures.ts";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const require = createRequire(path.join(os.homedir(), "code/.parity/package.json"));
// Playwright is not a repo dependency, so its types are not either: the
// little of its surface these specs touch, typed by hand.
type Page = {
  goto(url: string, o?: object): Promise<unknown>;
  url(): string;
  $$eval<R>(sel: string, fn: (els: Element[]) => R): Promise<R>;
  evaluate<R>(fn: () => R | Promise<R>): Promise<R>;
  addScriptTag(o: { content: string }): Promise<unknown>;
  locator(sel: string): { count(): Promise<number>; last(): { click(): Promise<void>; getAttribute(name: string): Promise<string | null> } };
  waitForURL(url: RegExp, o?: object): Promise<void>;
  waitForFunction(fn: () => unknown, a?: unknown, o?: object): Promise<unknown>;
  keyboard: { press(key: string): Promise<void> };
  on(ev: "response", fn: (r: { url(): string; request(): { resourceType(): string } }) => void): void;
  route(
    url: string,
    fn: (route: { request(): { headers(): Record<string, string> }; abort(): Promise<void>; continue(): Promise<void> }) => Promise<void> | void,
  ): Promise<void>;
};
type Context = { newPage(): Promise<Page>; close(): Promise<void> };
type Browser = { newContext(o: object): Promise<Context>; close(): Promise<void> };
const { chromium } = require("playwright") as { chromium: { launch(): Promise<Browser> } };
const AXE = readFileSync(path.join(ROOT, "node_modules", "axe-core", "axe.min.js"), "utf8");

const PORT = Number(process.env.E2E_PORT ?? 3107);
const BASE = process.env.E2E_BASE ?? `http://127.0.0.1:${PORT}`;
const WIDTHS = [1440, 1024, 390] as const;
const MOTION = ["no-preference", "reduce"] as const;
/** BRIEF-2 T9 budget 7: /app route JS under 180 kB gzipped. */
const JS_BUDGET_GZ = 180 * 1024;
/**
 * 13 Oct 2026 (dashboard speed work): the sidebar now prefetches its pages in
 * full (src/components/app/NavLink.tsx), and a full prefetch also fetches each
 * target route's own client chunks, in the background after the page is up.
 * Budget 7 measured every script loaded by network idle, so it began counting
 * other routes' code: 201.2 kB on 13 Oct, of which the page's own was 164.4 kB.
 * Budget 7 now measures the route with its flight requests blocked - every
 * flight request before the first click is a prefetch - which is what it was
 * written to hold. This second ceiling holds the whole download with the
 * prefetches, so background code cannot grow unwatched either: 201.2 kB
 * measured, set at 230 kB for headroom.
 */
const JS_WITH_PREFETCH_GZ = 230 * 1024;

const fx = expandFixture(JSON.parse(readFileSync(path.join(ROOT, "src", "lib", "tracking", "fixture.json"), "utf8")));
const range = { from: addDays(fx.today, -27), to: fx.today };
const o = overview({
  range,
  compare: "prev",
  startedOn: fx.client.started_on,
  engines: [],
  questions: fx.data.questions,
  answers: fx.data.answers,
  serp: fx.data.serp,
  keywordCount: fx.data.keywords.filter((k) => k.stopped_on === null).length,
});
const pct = (r: Rate) => (r.pct === null ? "-" : `${r.pct}%`);
// T4b part 3 (30 Sep 2026): the headline and three of the figures read by cluster; share of voice stays figures.ts.
const cs = clusterSummary(
  clusterCards({ clusters: fx.data.clusters, questions: fx.data.questions, keywords: fx.data.keywords, answers: fx.data.answers, serp: fx.data.serp, range, before: o.compare, today: fx.today, engines: [] }),
);
/** What figures.ts and cluster-figures.ts say each `data-figure` must read on the default range. */
const EXPECTED: Record<string, string> = {
  "headline-named": pct(cs.now),
  named: pct(cs.now),
  questions: `${cs.promptsNamed.num} of ${cs.promptsNamed.den}`,
  sov: pct(o.sov),
  keywords: `${cs.page1.num} of ${cs.page1.den}`,
};

let server: Server | null = null;
let browser: Browser;

before(async () => {
  if (!process.env.E2E_BASE) {
    // In-process, as src/app/dynamic-render.mts serves the build: `next start`
    // on the built output, with the fixture switch on and production off.
    // Set, not deleted: .env.local is a pulled Vercel file carrying
    // VERCEL_ENV=production, and Next loads it into any variable left unset.
    process.env.TRACKING_FIXTURE = "1";
    process.env.VERCEL_ENV = "development";
    const { default: next } = await import("next");
    const app = next({ dev: false, dir: ROOT });
    await app.prepare();
    const handle = app.getRequestHandler();
    server = createServer((req, res) => handle(req, res));
    await new Promise<void>((resolve) => server!.listen(PORT, "127.0.0.1", () => resolve()));
  }
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  server?.close();
  server?.closeAllConnections();
});

async function figures(page: Page): Promise<Record<string, string>> {
  return page.$$eval("[data-figure]", (els) => Object.fromEntries(els.map((e) => [e.getAttribute("data-figure")!, (e.textContent ?? "").trim()])));
}

for (const width of WIDTHS) {
  for (const motion of MOTION) {
    describe(`overview at ${width}, motion ${motion}`, () => {
      const open = async (javaScriptEnabled = true) => {
        const ctx = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: motion, javaScriptEnabled });
        const page = await ctx.newPage();
        await page.goto(`${BASE}/app`, { waitUntil: "networkidle" });
        return { ctx, page };
      };

      test("/app lands on the fixture client", async () => {
        const { ctx, page } = await open();
        assert.equal(new URL(page.url()).pathname, `/app/${fx.client.slug}`);
        await ctx.close();
      });

      test("1. every data-figure equals figures.ts", async () => {
        const { ctx, page } = await open();
        const seen = await figures(page);
        for (const [k, v] of Object.entries(EXPECTED)) assert.equal(seen[k], v, `data-figure="${k}"`);
        await ctx.close();
      });

      test("3. Tab never loses focus to body, and focus is visible", async () => {
        const { ctx, page } = await open();
        // 30 Sep 2026 (T4b mobile): below 560px the chart's 28 day buttons are
        // display:none, so the phone overview has fewer than 25 stops and the
        // Tab after the last one leaves the document - that is the end of the
        // page, not lost focus. Walk every stop there is, up to 25; a floor of
        // 10 keeps a walk that finds nothing from passing.
        const stops = await page.evaluate(
          () => [...document.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex='-1'])")].filter((el) => el.offsetParent !== null || getComputedStyle(el).position === "fixed").length,
        );
        assert.ok(stops >= 10, `only ${stops} tab stops found`);
        for (let i = 0; i < Math.min(25, stops); i++) {
          await page.keyboard.press("Tab");
          const f = await page.evaluate(() => {
            const el = document.activeElement as HTMLElement | null;
            if (!el || el === document.body) return { body: true, visible: false, what: "body" };
            const cs = getComputedStyle(el);
            const visible = (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0) || cs.boxShadow !== "none";
            return { body: false, visible, what: `${el.tagName.toLowerCase()} ${el.getAttribute("href") ?? el.textContent?.trim().slice(0, 40) ?? ""}` };
          });
          assert.equal(f.body, false, `tab ${i + 1} landed on body`);
          assert.ok(f.visible, `tab ${i + 1}: no visible focus on ${f.what}`);
        }
        await ctx.close();
      });

      test("4. axe: 0 serious or critical", async () => {
        const { ctx, page } = await open();
        await page.addScriptTag({ content: AXE });
        const found = await page.evaluate(async () => {
          // @ts-expect-error injected
          const r = await window.axe.run(document, { resultTypes: ["violations"] });
          return (r.violations as { id: string; impact: string; nodes: { target: string[] }[] }[])
            .filter((v) => v.impact === "serious" || v.impact === "critical")
            .map((v) => `${v.impact} ${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(", ")}`);
        });
        assert.deepEqual(found, []);
        await ctx.close();
      });

      test("5. JS off: settled figures and chart from the server", async () => {
        const { ctx, page } = await open(false);
        const seen = await figures(page);
        for (const [k, v] of Object.entries(EXPECTED)) assert.equal(seen[k], v, `data-figure="${k}" with JS off`);
        assert.ok((await page.locator("main svg, svg").count()) > 0, "no chart drawn with JS off");
        await ctx.close();
      });
    });
  }
}

describe("budgets", () => {
  /** Every script /app loads by network idle, gzipped; with `prefetch: false`, flight requests are refused. */
  async function appJs(prefetch: boolean): Promise<{ n: number; gz: number; refused: number }> {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    const scripts = new Set<string>();
    let refused = 0;
    if (!prefetch) {
      await page.route("**/*", (route) => {
        if (route.request().headers()["rsc"]) {
          refused++;
          return route.abort();
        }
        return route.continue();
      });
    }
    page.on("response", (r) => {
      if (r.request().resourceType() === "script") scripts.add(r.url());
    });
    await page.goto(`${BASE}/app`, { waitUntil: "networkidle" });
    let gz = 0;
    for (const url of scripts) gz += gzipSync(Buffer.from(await (await fetch(url)).arrayBuffer())).length;
    await ctx.close();
    return { n: scripts.size, gz, refused };
  }

  test("7. /app route JS under 180 kB gzipped", async () => {
    const { n, gz, refused } = await appJs(false);
    console.log(`# /app JS: ${n} scripts, ${(gz / 1024).toFixed(1)} kB gzipped (budget 180 kB; ${refused} prefetch requests refused)`);
    assert.ok(refused > 0, "no prefetch was refused, so this is not measuring what the comment on JS_WITH_PREFETCH_GZ says");
    assert.ok(gz < JS_BUDGET_GZ, `${(gz / 1024).toFixed(1)} kB gzipped`);
  });

  test("7. /app JS with the sidebar's background prefetches under 230 kB gzipped", async () => {
    const { n, gz } = await appJs(true);
    console.log(`# /app JS with prefetches: ${n} scripts, ${(gz / 1024).toFixed(1)} kB gzipped (ceiling 230 kB)`);
    assert.ok(gz < JS_WITH_PREFETCH_GZ, `${(gz / 1024).toFixed(1)} kB gzipped`);
  });

  test.todo("7. overview in 3 or fewer database round trips (the Supabase repo does not log round trips yet)");
});

describe("2. task budgets", () => {
  test.todo("range to August vs the month before: 5 or fewer (T5 picker not built)");
  test.todo("engine that names you least: 0 at 1440, 1 scroll at 390");
  test.todo("stop a prompt, then undo: 3 or fewer (T6 not built)");
  test.todo("add when full, refusal visible: 2 or fewer (T6 not built)");
  // DB-2 (9 Oct 2026): built - each check-grid cell is a link to one of the answers it counts, so it is one click.
  test("open one day's answer from the check strip: 2 or fewer", async () => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/app`, { waitUntil: "networkidle" });
    let clicks = 0;
    const cell = page.locator("#ov-heat-scroll a.app-heat-a").last();
    const day = (await cell.getAttribute("href"))!.match(/day=(\d{4}-\d{2}-\d{2})/)![1]!;
    await cell.click();
    clicks++;
    await page.waitForURL(new RegExp(`/clusters/[^?]+\\?.*day=${day}&engine=[a-z_]+#answer-[a-z_]+$`), { timeout: 15_000 });
    await page.waitForFunction(() => /^Answers on /.test(document.querySelector("#ans-h")?.textContent ?? "") && !!document.querySelector("section.app-answer nav [aria-current='true']"), undefined, { timeout: 10_000 });
    await ctx.close();
    assert.ok(clicks <= 2, `${clicks} clicks`);
  });
  test.todo("select a placement and see it on the chart: 1 (T13 not built)");
  test.todo("download the CSV for the range: 1 (T8 not built)");
});

describe("6. empty and edge states", () => {
  for (const s of ["no runs yet", "a range before tracking began", "a comparison reaching before tracking", "a prompt added mid-range", "a partial run", "a client at the limit"]) {
    test.todo(`${s} (needs fixture variants)`);
  }
});
