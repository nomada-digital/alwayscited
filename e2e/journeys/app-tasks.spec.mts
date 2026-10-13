/**
 * The dashboard soak's tasks as specs (R172, Danny, 2 Oct 2026, danny.md lines
 * 181-185), from docs/journeys/2026-10-02-dashboard-pass-1.md. Fixture only:
 * `next start` in-process with TRACKING_FIXTURE=1 and TRACKING_FIXTURE_WRITE=1,
 * so writes are held in memory and nothing is sent. repo.ts holds the fixture
 * on globalThis once read; each test sets its state and role and drops it.
 *
 *   npm run build && node --test e2e/journeys/app-tasks.spec.mts
 *
 * Not here yet: tasks 1-5 and 11 (the r168/r170 write scripts in docs/parity),
 * 8, 9 and 14 (judged from the page; the fixture refuses every ask), 16 (needs
 * /app/parity?others=N, docs/parity/ds5-switch.mjs).
 */
import { createServer, type Server } from "node:http";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const require = createRequire(path.join(os.homedir(), "code/.parity/package.json"));
type Locator = { click(): Promise<void>; count(): Promise<number>; first(): Locator; boundingBox(): Promise<{ height: number; width: number } | null> };
type Page = {
  goto(url: string, o?: object): Promise<{ status(): number } | null>;
  evaluate<R, A>(fn: (a: A) => R | Promise<R>, a: A): Promise<R>;
  getByRole(role: string, o?: object): Locator;
  waitForURL(url: RegExp, o?: object): Promise<void>;
  keyboard: { press(key: string): Promise<void> };
  url(): string;
};
type Context = { newPage(): Promise<Page>; close(): Promise<void> };
type Browser = { newContext(o: object): Promise<Context>; close(): Promise<void> };
const { chromium } = require("playwright") as { chromium: { launch(): Promise<Browser> } };

const PORT = Number(process.env.E2E_PORT ?? 3109);
// localhost, as docs/parity/ds10-setup.mjs: on 127.0.0.1 a form's 303 came back to localhost, and the page's
// CSP form-action 'self' blocked the POST (seen 2 Oct 04:25Z on task 15's Confirm).
const BASE = `http://localhost:${PORT}`;
const HOME = "/app/tallyroo";

let server: Server | null = null;
let browser: Browser;

before(async () => {
  process.env.TRACKING_FIXTURE = "1";
  process.env.TRACKING_FIXTURE_WRITE = "1";
  process.env.VERCEL_ENV = "development";
  const { default: next } = await import("next");
  // Host and port given, so a route's 303 (built from req.url) comes back here.
  const app = next({ dev: false, dir: ROOT, hostname: "localhost", port: PORT });
  await app.prepare();
  const handle = app.getRequestHandler();
  server = createServer((req, res) => handle(req, res));
  await new Promise<void>((resolve) => server!.listen(PORT, () => resolve()));
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  server?.close();
  server?.closeAllConnections();
});

/** Serve this fixture state and role from the next request on. */
function as(state: string, role = "owner") {
  if (state === "default") delete process.env.TRACKING_FIXTURE_STATE;
  else process.env.TRACKING_FIXTURE_STATE = state;
  process.env.TRACKING_FIXTURE_ROLE = role;
  delete (globalThis as Record<symbol, unknown>)[Symbol.for("alwayscited.trackingFixture")];
}

const text = (page: Page) => page.evaluate(() => (document.querySelector("#app-content") as HTMLElement | null)?.innerText ?? document.body.innerText, null);

for (const width of [1280, 390]) {
  describe(`dashboard tasks at ${width}`, () => {
    async function open(route: string, js = true) {
      const ctx = await browser.newContext({ viewport: { width, height: 900 }, javaScriptEnabled: js, acceptDownloads: true });
      const page = await ctx.newPage();
      const r = await page.goto(BASE + route, { waitUntil: "load" });
      return { ctx, page, status: r?.status() };
    }

    test("task 6: at 10 of 10, Add a cluster says how to make room", async () => {
      as("default");
      const { ctx, page } = await open(`${HOME}/clusters`);
      assert.match(await text(page), /10 of 10 clusters in use/);
      // Add a cluster is a link that opens the panel by URL (Clusters.tsx AddPanel).
      await page.getByRole("link", { name: "Add a cluster" }).first().click();
      await page.waitForURL(/add/, { timeout: 10_000 }).catch(() => assert.fail(`Add a cluster went to ${page.url()}`));
      assert.match(await text(page), /All 10 clusters are in use\s*Stop tracking one below to make room\./);
      await ctx.close();
    });

    // 13 Oct 2026, DIY P4 (spec 10 section 4.1 rows 1 and 3): the desktop sub-line "N of M answers across ..." is the
    // headline paragraph now ("Named in N of M AI answers to your K prompts ..."), and "Download report" is "Download
    // CSV" (RP-1). The facts these two tasks hold have moved, not gone: where I am named, in N of M answers at 1280
    // (the phone keeps its short line), and the CSV's rows equal to the headline's M, read from [data-headline].
    test("task 7: the Overview says where I am named and where I rank", async () => {
      as("default");
      const { ctx, page } = await open(HOME);
      const t = await text(page);
      assert.match(t, /named in \d+% of AI answers/i);
      assert.match(t, width < 600 ? /[\d,]+ of [\d,]+ answers across/ : /Named in [\d,]+ of [\d,]+ AI answers to your \d+ prompts/);
      await ctx.close();
    });

    test("task 10: the downloaded report matches the Overview headline", async () => {
      as("default");
      const { ctx, page } = await open(HOME);
      // The headline paragraph is in the page at both widths (the phone hides it behind its short line).
      const said = await page.evaluate(() => document.querySelector("[data-headline]")?.textContent ?? "", null);
      const head = /^(?:First reading on [^:]+: named|Named) in ([\d,]+) of ([\d,]+) AI answers/.exec(said.trim());
      assert.ok(head, `headline read: "${said}"`);
      // The phone header folds the button away, so fetch what its link points at, as a click would.
      const csv = await page.evaluate(async () => {
        const a = [...document.querySelectorAll("a")].find((x) => (x.textContent ?? "").trim() === "Download CSV");
        return a ? (await fetch(a.href)).text() : "";
      }, null);
      const rows = csv.trim().split("\n").slice(1);
      const named = rows.filter((r) => /,(yes|true|named),/i.test(r)).length;
      assert.equal(rows.length, Number(head[2].replace(/,/g, "")), "answered rows = the headline's answers");
      assert.ok(named <= rows.length);
      await ctx.close();
    });

    test("task 12: signing out of every device says so on the login page", async () => {
      const { ctx, page } = await open("/app/login?out=all", false);
      assert.match(await text(page), /You are signed out on every device\./);
      await page.goto(`${BASE}/app/login`, { waitUntil: "load" });
      assert.doesNotMatch(await text(page), /You are signed out/);
      await ctx.close();
    });

    test("task 13: a partial check says what it means for the figures", async () => {
      as("partial");
      const { ctx, page } = await open(HOME, false);
      assert.match(await text(page), /Some reads did not come back; they are left out of the figures, not counted as misses\./);
      await ctx.close();
    });

    test("task 15: an unconfirmed signup finds its way back to setup and confirms", async () => {
      as("signup");
      const { ctx, page } = await open("/app");
      assert.match(await text(page), /Your setup is not confirmed yet\./);
      const finish = page.getByRole("link", { name: "Finish setup" });
      assert.ok(((await finish.boundingBox())?.height ?? 0) >= 44, "44px target");
      await finish.click();
      await page.waitForURL(/\/setup$/, { timeout: 10_000 }).catch(() => assert.fail(`Finish setup went to ${page.url()}`));
      await page.getByRole("button", { name: /Confirm/ }).first().click();
      await page.waitForURL(/setup=confirmed/, { timeout: 10_000 }).catch(() => assert.fail(`Confirm went to ${page.url()}`));
      assert.doesNotMatch(await text(page), /Your setup is not confirmed yet\./);
      assert.match(await text(page), /Setup confirmed\./);
      await ctx.close();
    });

    // Keyboard only, once (R172): Tab to each control, Enter to press it, a ring on every stop on the way.
    async function tabTo(page: Page, name: RegExp, cap = 80) {
      for (let n = 1; n <= cap; n++) {
        await page.keyboard.press("Tab");
        const at = await page.evaluate(() => {
          const el = document.activeElement as HTMLElement | null;
          if (!el || el === document.body) return null;
          const ringed = (x: Element) => {
            const s = getComputedStyle(x);
            return (s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0) || s.boxShadow !== "none";
          };
          // A field may ring its wrapper instead (.app-search:focus-within), so look two levels up.
          const ring = ringed(el) || [el.parentElement, el.parentElement?.parentElement].some((x) => x && x.matches(":focus-within") && ringed(x));
          const label = el.getAttribute("aria-label") ?? ((el as HTMLInputElement).labels?.[0]?.innerText || el.innerText || "");
          return { label: label.trim(), ring };
        }, null);
        if (!at) continue;
        assert.ok(at.ring, `no focus ring on "${at.label}" (stop ${n})`);
        if (name.test(at.label)) return n;
      }
      return assert.fail(`${name} not reached in ${cap} Tabs`);
    }

    test("keyboard only: task 15 from the Overview to a confirmed setup", async () => {
      as("signup");
      const { ctx, page } = await open("/app");
      await tabTo(page, /^Finish setup$/);
      await page.keyboard.press("Enter");
      await page.waitForURL(/\/setup$/, { timeout: 10_000 }).catch(() => assert.fail(`Finish setup went to ${page.url()}`));
      await tabTo(page, /^Confirm/);
      await page.keyboard.press("Enter");
      await page.waitForURL(/setup=confirmed/, { timeout: 10_000 }).catch(() => assert.fail(`Confirm went to ${page.url()}`));
      await ctx.close();
    });

    test("keyboard only: task 6 Add a cluster at 10 of 10", async () => {
      as("default");
      const { ctx, page } = await open(`${HOME}/clusters`);
      await tabTo(page, /^Add a cluster$/);
      await page.keyboard.press("Enter");
      await page.waitForURL(/add/, { timeout: 10_000 }).catch(() => assert.fail(`Add a cluster went to ${page.url()}`));
      assert.match(await text(page), /All 10 clusters are in use/);
      await ctx.close();
    });

    test("roles: a viewer is told who confirms setup, a removed member gets a 404", async () => {
      as("signup", "viewer");
      const v = await open(HOME, false);
      assert.match(await text(v.page), /An owner or editor confirms it\./);
      await v.ctx.close();
      as("default", "removed");
      const r = await open(HOME, false);
      assert.equal(r.status, 404);
      await r.ctx.close();
    });
  });
}
