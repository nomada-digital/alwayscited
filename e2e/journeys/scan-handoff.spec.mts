/**
 * The Nomada hand-off (18-19 Oct 2026): a domain typed into nomadadigital.co.uk's
 * scan field starts the alwayscited scan on arrival - one entry, one click.
 *
 *   NOMADA_BASE=http://localhost:3100 JOURNEY_BASE=http://localhost:3200 \
 *     node --test e2e/journeys/scan-handoff.spec.mts
 *
 * The browser only ever sees the real hostnames. Every request to
 * nomadadigital.co.uk and alwayscited.com is answered from NOMADA_BASE and
 * JOURNEY_BASE (production when unset), so the Referer each site sends is the
 * real one and the hand-off gate is judged exactly as it is live. Nothing is
 * spent: /api/scan/start is answered inside the browser, as scan-in-place does,
 * and Turnstile is a stub that hands out a token. SHOT_DIR collects a
 * screenshot of each landing state.
 */
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";

const require = createRequire(path.join(os.homedir(), "code/.parity/package.json"));
type Req = { url(): string; method(): string; postData(): string | null; headers(): Record<string, string> };
type Route = {
  request(): Req;
  fulfill(o: object): Promise<void>;
  fetch(o?: object): Promise<{ status(): number; headers(): Record<string, string>; body(): Promise<Buffer> }>;
  abort(): Promise<void>;
};
type Locator = { fill(v: string): Promise<void>; click(): Promise<void>; inputValue(): Promise<string>; textContent(): Promise<string | null>; waitFor(o?: object): Promise<void> };
type Page = {
  goto(url: string, o?: object): Promise<unknown>;
  goBack(): Promise<unknown>;
  url(): string;
  evaluate<R>(fn: () => R | Promise<R>): Promise<R>;
  locator(sel: string, o?: { hasText?: string | RegExp }): Locator;
  waitForURL(u: string | RegExp | ((u: URL) => boolean), o?: object): Promise<void>;
  waitForTimeout(ms: number): Promise<void>;
  screenshot(o: object): Promise<void>;
};
type Context = {
  newPage(): Promise<Page>;
  route(url: string | RegExp, handler: (r: Route) => void): Promise<void>;
  addInitScript(script: string): Promise<void>;
  close(): Promise<void>;
};
type Browser = { newContext(o: object): Promise<Context>; close(): Promise<void> };
const { chromium } = require("playwright") as { chromium: { launch(): Promise<Browser> } };

const NOMADA = process.env.NOMADA_BASE ?? "https://nomadadigital.co.uk";
const AC = process.env.JOURNEY_BASE ?? "https://alwayscited.com";
const SHOTS = process.env.SHOT_DIR ?? path.join(os.tmpdir(), "scan-handoff");
mkdirSync(SHOTS, { recursive: true });

const TURNSTILE_STUB =
  "window.turnstile={render:function(el,o){setTimeout(function(){o.callback('stub-token')},50);return 'w'},remove:function(){}};";

let browser: Browser;
before(async () => {
  browser = await chromium.launch();
});
after(async () => {
  await browser.close();
});

/** A context wired to the two local servers, recording every scan start. */
async function journey() {
  const starts: Record<string, unknown>[] = [];
  let release: () => void = () => {};
  const held = new Promise<void>((r) => (release = r));
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  // GA consent already given, so track() reaches the data layer.
  await ctx.addInitScript("try{localStorage.setItem('ac-consent','accepted')}catch(e){}");
  const proxy = (base: string) => async (r: Route) => {
    const u = new URL(r.request().url());
    const res = await r.fetch({ url: base + u.pathname + u.search, maxRedirects: 0 });
    const headers = { ...res.headers() };
    // A redirect stays on the public hostname rather than the local port.
    if (headers.location) headers.location = headers.location.replace(base, u.origin);
    await r.fulfill({ status: res.status(), headers, body: await res.body() });
  };
  await ctx.route(/^https:\/\/(www\.)?nomadadigital\.co\.uk\//, proxy(NOMADA));
  await ctx.route(/^https:\/\/alwayscited\.com\//, async (r) => {
    if (new URL(r.request().url()).pathname === "/api/scan/start") {
      starts.push(JSON.parse(r.request().postData() ?? "{}"));
      await held;
      return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ token: "handoff-test", market: "UK" }) });
    }
    return proxy(AC)(r);
  });
  await ctx.route(/challenges\.cloudflare\.com/, (r) => r.fulfill({ contentType: "text/javascript", body: TURNSTILE_STUB }));
  await ctx.route(/googletagmanager\.com|google-analytics\.com|clarity\.ms/, (r) => r.abort());
  return { ctx, page: await ctx.newPage(), starts, release };
}

/** Until the checker has posted its start - it waits for Turnstile first. */
async function startsAfter(page: Page, starts: unknown[], n = 1) {
  for (let t = 0; t < 75 && starts.length < n; t++) await page.waitForTimeout(200);
}

const shot = (page: Page, name: string) => page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: false });
const scanEvents = (page: Page) =>
  page.evaluate(() =>
    ((window as unknown as { dataLayer?: IArguments[] }).dataLayer ?? [])
      .map((a) => Array.from(a))
      .filter((a) => a[0] === "event" && a[1] === "scan_started")
      .map((a) => a[2] as Record<string, unknown>),
  );

async function fromNomada(typed: string, query = "") {
  const j = await journey();
  await j.page.goto(`https://nomadadigital.co.uk/${query}`);
  await j.page.locator("form[data-scan] input[name=domain]").fill(typed);
  await j.page.locator("form[data-scan] button[type=submit]").click();
  return j;
}

describe("Nomada -> alwayscited scan hand-off", () => {
  test("a valid domain is entered once and the scan starts on arrival, with UTMs and source attached", async () => {
    const { ctx, page, starts, release } = await fromNomada("example.com", "?utm_source=linkedin&utm_campaign=q4-test");
    await page.waitForURL((u) => u.hostname === "alwayscited.com" && u.pathname === "/scan");
    await page.locator("text=Checking example.com").waitFor({ timeout: 15_000 });
    await startsAfter(page, starts);
    await shot(page, "1-valid-domain-scan-starting");
    assert.equal(starts.length, 1, "exactly one scan start");
    assert.deepEqual(starts[0], {
      domain: "example.com",
      turnstileToken: "stub-token",
      market: "UK",
      ref: "nomada",
      utm: { utm_source: "linkedin", utm_campaign: "q4-test" },
    });
    assert.ok(!new URL(page.url()).searchParams.has("ref"), "ref comes off the address, so Back cannot start a second scan");
    release();
    await page.waitForURL((u) => u.pathname === "/scan/handoff-test");
    assert.deepEqual(await scanEvents(page), [{ source: "nomada", page_type: "scan" }]);
    // Back lands on the prefilled form and starts nothing more.
    await page.goBack();
    await page.waitForTimeout(1500);
    assert.equal(starts.length, 1, "Back started a second scan");
    await ctx.close();
  });

  test("https://www. and a path are tidied on Nomada before the hand-off", async () => {
    const { ctx, page, starts } = await fromNomada("  https://www.Example.com/about/team/  ");
    await page.waitForURL((u) => u.hostname === "alwayscited.com");
    assert.equal(new URL(page.url()).searchParams.get("domain"), "example.com");
    await page.locator("text=Checking example.com").waitFor({ timeout: 15_000 });
    await startsAfter(page, starts);
    await shot(page, "2-www-and-path-scan-starting");
    assert.equal(starts.length, 1);
    assert.equal(starts[0]!.domain, "example.com");
    await ctx.close();
  });

  for (const [name, typed] of [
    ["3-empty", ""],
    ["4-garbage", "not a domain!!"],
  ] as const) {
    test(`${name.slice(2)} input stays on Nomada with an inline error and starts nothing`, async () => {
      const { ctx, page, starts } = await fromNomada(typed);
      await page.waitForTimeout(800);
      assert.equal(new URL(page.url()).hostname, "nomadadigital.co.uk");
      assert.match((await page.locator("form[data-scan] .scan-msg").textContent()) ?? "", /Enter a domain/);
      await shot(page, `${name}-input-error-on-nomada`);
      assert.equal(starts.length, 0);
      await ctx.close();
    });
  }

  test("a malformed domain that does reach /scan with ref=nomada is prefilled, never submitted", async () => {
    const { ctx, page, starts } = await journey();
    await page.goto("https://alwayscited.com/scan?domain=not%20a%20domain&ref=nomada", { referer: "https://nomadadigital.co.uk/" });
    await page.waitForTimeout(1500);
    assert.equal(await page.locator("form input").inputValue(), "not a domain");
    await shot(page, "4b-garbage-reaching-alwayscited-step-1");
    assert.equal(starts.length, 0);
    await ctx.close();
  });

  test("the hand-off URL without Nomada's Referer (a crawler, a pasted link) waits for a press", async () => {
    const { ctx, page, starts } = await journey();
    await page.goto("https://alwayscited.com/scan?domain=example.com&ref=nomada");
    await page.waitForTimeout(1500);
    assert.equal(await page.locator("form input").inputValue(), "example.com");
    await shot(page, "6-handoff-url-without-referer-step-1");
    assert.equal(starts.length, 0);
    await ctx.close();
  });

  test("a direct visit to /scan with no domain is step 1, empty", async () => {
    const { ctx, page, starts } = await journey();
    await page.goto("https://alwayscited.com/scan");
    await page.waitForTimeout(1500);
    assert.equal(await page.locator("form input").inputValue(), "");
    await shot(page, "5-direct-visit-step-1");
    assert.equal(starts.length, 0);
    await ctx.close();
  });
});
