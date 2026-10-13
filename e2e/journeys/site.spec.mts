/**
 * Site journeys as a first-time buyer (R148 and R154, 1 Oct 2026; danny.md
 * lines 138-154). Read-only against production by default, or JOURNEY_BASE:
 * pages are opened and links followed, and nothing else - no form is
 * submitted, no scan is started, no payment is begun, no mail is sent.
 * "Continue to payment" is found and left alone; /api/checkout is never hit.
 *
 *   node --test e2e/journeys/site.spec.mts
 *
 * The scan tokens are the two real scans Danny pasted into docs/inbox.md,
 * read from there at run time so no capability URL is written into this
 * public repo. Playwright is resolved from ~/code/.parity, as in e2e/app.
 *
 * Journeys (R148): (1) / -> free scan -> result -> its next step; (2)
 * /alwaystracked -> checkout; (3) /packages -> each tier's next page, US and
 * UK; (4) /white-label and the SEO and PR agency pages; (5) the phone width
 * on /, /scan and a result; (6) a returning visitor on an emailed scan link.
 *
 * 13 Oct 2026 (Danny): (10) the header's Log in, at five widths, and (11) the
 * walkthrough form's required name, category and market on a tier page. Both
 * read-only like the rest: (11) presses Send with the fields empty, which the
 * form refuses before any request, and asserts that none went out. Screens of
 * both land in test-results/site/ (not committed). (11) also presses Enter on
 * a personal address, which the form refuses before any request too.
 */
import { mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";

import { trackOffer } from "../../src/components/scan/track-offer.ts";
import { WORK_EMAIL_REFUSAL } from "../../src/lib/work-email.ts";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const require = createRequire(path.join(os.homedir(), "code/.parity/package.json"));
type Locator = {
  click(): Promise<void>;
  focus(): Promise<void>;
  inputValue(): Promise<string>;
  evaluate<R>(fn: (el: Element) => R): Promise<R>;
  count(): Promise<number>;
  first(): Locator;
  getAttribute(n: string): Promise<string | null>;
  isVisible(): Promise<boolean>;
  boundingBox(): Promise<{ height: number; width: number; x: number; y: number } | null>;
  textContent(): Promise<string | null>;
  fill(v: string): Promise<void>;
  press(key: string): Promise<void>;
  selectOption(v: string): Promise<unknown>;
  check(): Promise<void>;
  screenshot(o: { path: string }): Promise<unknown>;
  scrollIntoViewIfNeeded(): Promise<void>;
  locator(sel: string): Locator;
};
type Page = {
  on(event: "request", fn: (r: { url(): string; method(): string }) => void): void;
  screenshot(o: { path: string; fullPage?: boolean; clip?: { x: number; y: number; width: number; height: number } }): Promise<unknown>;
  addScriptTag(o: { content: string }): Promise<unknown>;
  goto(url: string, o?: object): Promise<{ status(): number } | null>;
  url(): string;
  title(): Promise<string>;
  evaluate<R>(fn: () => R | Promise<R>): Promise<R>;
  locator(sel: string, o?: { hasText?: string | RegExp }): Locator;
  getByRole(role: string, o: { name: string | RegExp }): Locator;
  waitForTimeout(ms: number): Promise<void>;
  keyboard: { press(key: string): Promise<void> };
};
type Context = { newPage(): Promise<Page>; close(): Promise<void> };
type Browser = { newContext(o: object): Promise<Context>; close(): Promise<void> };
const { chromium } = require("playwright") as { chromium: { launch(): Promise<Browser> } };

const BASE = process.env.JOURNEY_BASE ?? "https://alwayscited.com";
const AXE = readFileSync(path.join(ROOT, "node_modules", "axe-core", "axe.min.js"), "utf8");
const TOKENS = [...readFileSync(path.join(ROOT, "docs", "inbox.md"), "utf8").matchAll(/\/scan\/([0-9a-f]{32})\b/g)].map((m) => m[1]);

let browser: Browser;
before(async () => {
  browser = await chromium.launch();
});
after(async () => {
  await browser.close();
});

async function open(width: number, route: string): Promise<{ page: Page; ctx: Context; status: number }> {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } });
  const page = await ctx.newPage();
  const r = await page.goto(BASE + route, { waitUntil: "load" });
  // Client islands (the market toggle, the picks) settle after hydration.
  await page.waitForTimeout(600);
  return { page, ctx, status: r?.status() ?? 0 };
}

/** The status a GET of `href` comes back with, followed through redirects. */
async function statusOf(href: string): Promise<number> {
  const r = await fetch(new URL(href, BASE), { redirect: "follow" });
  return r.status;
}

const overflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test("the two real scan tokens are in docs/inbox.md", () => {
  assert.ok(TOKENS.length >= 2, `found ${TOKENS.length} - the inbox's scan list has moved`);
});

for (const width of [1280, 390]) {
  describe(`journeys at ${width}`, () => {
    test("(1) / offers the free scan and reaches a result's next step", async () => {
      const { page, ctx, status } = await open(width, "/");
      assert.equal(status, 200);
      assert.equal(await page.getByRole("button", { name: /Run a free scan/ }).first().isVisible(), true, "the hero's free scan button");
      assert.ok((await overflow(page)) <= 0, "no sideways scroll on /");
      await ctx.close();

      const res = await open(width, `/scan/${TOKENS[0]}`);
      assert.equal(res.status, 200);
      // A cluster scan sells the cluster it read; an older scan offers the walkthrough.
      const buy = res.page.locator('[data-figure="tracked-checkout"] a');
      if (await buy.count()) {
        const href = (await buy.first().getAttribute("href")) ?? "";
        assert.match(href, /^\/checkout\?tier=alwaystracked/);
        assert.equal(await statusOf(href), 200);
      } else {
        assert.equal(await res.page.getByRole("button", { name: /Send me the walkthrough/ }).first().isVisible(), true, "no checkout card, so the walkthrough form");
      }
      await res.ctx.close();
    });

    // The "Track this cluster" click itself needs a cluster scan, and both inbox
    // tokens predate them (pass 3). So the leg after the click: the exact href
    // trackOffer gives the card, opened on production for each market's token -
    // tokens in the inbox's order, the UK domain's scan then the US one.
    test("(1b) a result's Track this cluster link lands on the order form with its scan and market", async () => {
      for (const [market, token] of [["UK", TOKENS[0]], ["US", TOKENS[1]]] as const) {
        const { href } = trackOffer(market, { us: 0, uk: 0 }, "/checkout?tier=alwaystracked", token);
        const co = await open(width, href);
        assert.equal(co.status, 200, href);
        const price = (await co.page.locator('[data-figure="checkout-price"]').first().textContent()) ?? "";
        assert.match(price, market === "UK" ? /^£\d.*plus VAT$/ : /^\$\d/, `${market} price "${price}"`);
        // No market dropdown since R157 (danny.md line 157): the toggle shows the market.
        assert.equal(await co.page.locator('select[name="market"]').count(), 0, "no market dropdown");
        assert.equal(await co.page.getByRole("button", { name: market === "UK" ? "UK £" : "US $" }).first().getAttribute("aria-pressed"), "true");
        // The Session gets the scan for the webhook, and a market switch keeps it in the URL.
        assert.equal(await co.page.locator("#checkout-scan").first().getAttribute("value"), token, `${market}: #checkout-scan carries the scan`);
        await co.page.getByRole("button", { name: market === "UK" ? "US $" : "UK £" }).first().click();
        assert.match(co.page.url(), new RegExp(`scan=${token}`), `${market}: the switch keeps the scan`);
        assert.equal(await co.page.locator("#checkout-scan").first().getAttribute("value"), token);
        assert.equal(await co.page.getByRole("button", { name: /Continue to payment/ }).first().isVisible(), true);
        await co.ctx.close();
      }
    });

    test("(2) /alwaystracked -> the order form, price and terms before payment", async () => {
      const { page, ctx, status } = await open(width, "/alwaystracked");
      assert.equal(status, 200);
      const href = (await page.getByRole("link", { name: /^Start tracking$/ }).first().getAttribute("href")) ?? "";
      assert.match(href, /^\/checkout\?tier=alwaystracked/);
      await ctx.close();

      for (const market of ["us", "uk"]) {
        const co = await open(width, `/checkout?tier=alwaystracked&market=${market}`);
        assert.equal(co.status, 200);
        const price = (await co.page.locator('[data-figure="checkout-price"]').first().textContent()) ?? "";
        assert.match(price, market === "uk" ? /^£\d.*plus VAT$/ : /^\$\d/, `${market} price "${price}"`);
        const body = await co.page.evaluate(() => document.body.innerText);
        assert.match(body, /30 days.? notice to cancel/);
        // R156 (danny.md line 156): the one quiet promo line replaced the Stripe and seller lines.
        assert.match(body, /Got a promo code\? Add it on the next page\./);
        assert.doesNotMatch(body, /Sold by|You pay on Stripe/, "the seller line lives in the footer only");
        assert.equal(await co.page.locator('select[name="market"]').count(), 0, "no market dropdown");
        // The toggle re-prices with no reload (R157).
        const other = market === "uk" ? "US $" : "UK £";
        await co.page.getByRole("button", { name: other }).first().click();
        const switched = (await co.page.locator('[data-figure="checkout-price"]').first().textContent()) ?? "";
        assert.match(switched, market === "uk" ? /^\$\d/ : /^£\d.*plus VAT$/, `switched from ${market}: "${switched}"`);
        assert.equal(await co.page.locator("#checkout-market").first().inputValue(), market === "uk" ? "us" : "uk", "the posted market follows the toggle");
        assert.equal(await co.page.getByRole("button", { name: /Continue to payment/ }).first().isVisible(), true);
        assert.ok((await overflow(co.page)) <= 0, `no sideways scroll on ${market} checkout`);
        await co.ctx.close();
      }
    });

    // R151 (1 Oct 2026, 8a07c17): a refused order comes back to the form the
    // way /api/checkout sends it - the reason under its field, which has focus,
    // and the keyword still typed. Opened as the redirect's URL, so nothing is
    // posted.
    test("(2b) a refused order keeps the keyword and says why at the field", async () => {
      for (const [error, url] of [
        ["email", "/checkout?tier=alwaystracked&market=uk&error=email&keyword=kept%20words"],
        ["keyword", "/checkout?tier=alwayscited&market=us&sector=business&error=keyword&keyword=k"],
        // R158 (1 Oct 2026): without a scan the order asks for the website; a bad one comes back kept.
        ["website", "/checkout?tier=alwaystracked&market=us&error=website&website=not%20a%20site"],
      ] as const) {
        const co = await open(width, url);
        assert.equal(co.status, 200, url);
        const input = co.page.locator(`#checkout-${error}`);
        assert.equal(await input.getAttribute("aria-invalid"), "true", `${error} marked invalid`);
        assert.equal(await input.getAttribute("aria-describedby"), `checkout-${error}-error`);
        assert.ok(((await co.page.locator(`#checkout-${error}-error`).textContent()) ?? "").length > 0, `${error} reason shown`);
        if (error === "website") assert.equal(await input.inputValue(), "not a site", "website kept");
        else assert.equal(await co.page.locator("#checkout-keyword").first().evaluate((i) => (i as HTMLInputElement).value), error === "email" ? "kept words" : "k", "keyword kept");
        assert.equal(await co.page.locator("#checkout-email").first().evaluate((i) => (i as HTMLInputElement).value), "", "the email is never carried in the URL");
        await co.ctx.close();
      }
    });

    // R158 (1 Oct 2026): an order with no scan built no dashboard; it now asks
    // for the website, required, and an order from a scan does not ask.
    test("(2c) checkout asks for the website only when no scan rides on the order", async () => {
      const bare = await open(width, "/checkout?tier=alwaystracked&market=us");
      const site = bare.page.locator("#checkout-website");
      assert.equal(await site.count(), 1, "website field without a scan");
      assert.equal(await site.evaluate((i) => (i as HTMLInputElement).required), true, "website required");
      assert.ok(((await site.boundingBox())?.height ?? 0) >= 40, "website field is a full-height field");
      assert.ok((await overflow(bare.page)) <= 0, "no sideways scroll with the website field");
      await bare.ctx.close();
      const scanned = await open(width, `/checkout?tier=alwaystracked&market=us&scan=${"0".repeat(32)}`);
      assert.equal(await scanned.page.locator("#checkout-website").count(), 0, "no website field with a scan");
      await scanned.ctx.close();
    });

    test("(3) /packages -> every tier's CTA opens, alwaystracked's at the order form", async () => {
      const { page, ctx, status } = await open(width, "/packages");
      assert.equal(status, 200);
      const tracked = (await page.getByRole("link", { name: /^Start tracking$/ }).first().getAttribute("href")) ?? "";
      assert.match(tracked, /^\/checkout\?tier=alwaystracked/, "alwaystracked's CTA goes straight to the order form");
      for (const name of [/^Start tracking$/, /^Get recommended$/, /^Get cited$/, /^Be everywhere$/]) {
        const href = await page.getByRole("link", { name }).first().getAttribute("href");
        assert.ok(href, `a ${name} link`);
        assert.equal(await statusOf(href), 200, `${name} -> ${href}`);
      }
      // The UK toggle carries UK to the order form.
      const uk = page.getByRole("button", { name: /^UK/ });
      if (await uk.count()) {
        await (uk.first() as unknown as { click(): Promise<void> }).click();
        await page.waitForTimeout(300);
        const after = (await page.getByRole("link", { name: /^Start tracking$/ }).first().getAttribute("href")) ?? "";
        assert.match(after, /market=uk/, "the UK pick travels to checkout");
      }
      await ctx.close();
    });

    test("(4) /white-label, /seo-agencies and /pr-agencies each have a next step", async () => {
      for (const route of ["/white-label", "/seo-agencies", "/pr-agencies"]) {
        const { page, ctx, status } = await open(width, route);
        assert.equal(status, 200, route);
        assert.equal(await page.locator("h1").count(), 1, `${route}: one h1`);
        const hrefs = await page.evaluate(() => [...document.querySelectorAll("main a[href^='/']")].map((a) => a.getAttribute("href")!));
        assert.ok(hrefs.length >= 1, `${route}: no onward link in main`);
        for (const h of new Set(hrefs)) assert.equal(await statusOf(h), 200, `${route} -> ${h}`);
        assert.ok((await overflow(page)) <= 0, `${route}: no sideways scroll`);
        await ctx.close();
      }
    });

    test("(5) /, /scan and a result fit the width with tappable primary actions", async () => {
      for (const route of ["/", "/scan", `/scan/${TOKENS[0]}`]) {
        const { page, ctx, status } = await open(width, route);
        assert.equal(status, 200, route);
        assert.ok((await overflow(page)) <= 0, `${route}: no sideways scroll`);
        const small = await page.evaluate(() =>
          [...document.querySelectorAll("main button, main a.btn-primary, main input[type=submit]")]
            .filter((e) => (e as HTMLElement).offsetParent !== null)
            .map((e) => ({ t: (e.textContent ?? "").trim().slice(0, 40), h: e.getBoundingClientRect().height }))
            .filter((x) => x.t && x.h > 0 && x.h < 44),
        );
        if (width === 390) assert.deepEqual(small, [], `${route}: primary actions under 44px`);
        await ctx.close();
      }
    });

    test("(6) a returning visitor on an emailed scan link sees the report", async () => {
      for (const t of TOKENS) {
        const { page, ctx, status } = await open(width, `/scan/${t}`);
        assert.equal(status, 200);
        assert.equal(await page.title(), "Your AI visibility report | alwayscited");
        const body = await page.evaluate(() => document.body.innerText);
        assert.doesNotMatch(body, /something went wrong|not found/i);
        assert.ok((await overflow(page)) <= 0, "no sideways scroll on the result");
        await ctx.close();
      }
    });

    // Pass 5 (R148/R151, 1 Oct 2026): the order card by keyboard alone - WCAG
    // 2.4.1 skip link, 2.4.7 a visible focus at every stop, 4.1.2 the toggle's
    // pressed state - and the toggle re-prices on Space with focus kept.
    test("(7) /checkout by keyboard: skip link, every stop visible, toggle on Space", async () => {
      const { page, ctx, status } = await open(width, "/checkout?tier=alwaystracked");
      assert.equal(status, 200);
      await page.keyboard.press("Tab");
      await page.keyboard.press("Enter");
      const stops: { text: string; ring: boolean; inMain: boolean }[] = [];
      for (let i = 0; i < 12; i++) {
        await page.keyboard.press("Tab");
        const s = await page.evaluate(() => {
          const e = document.activeElement as HTMLElement;
          const cs = getComputedStyle(e);
          return {
            text: (e.getAttribute("name") || e.textContent || "").trim().slice(0, 30),
            ring: (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0) || cs.boxShadow !== "none",
            inMain: !!e.closest("main"),
          };
        });
        stops.push(s);
        if (s.text === "Continue to payment") break;
      }
      assert.deepEqual(
        stops.map((s) => s.text),
        // "website": asked when no scan rides on the order (R158, 1 Oct 2026).
        ["What the plan includes", "US $", "UK £", "email", "website", "keyword", "Continue to payment"],
        "after the skip link: plan link, toggle, email, keyword, button",
      );
      assert.deepEqual(stops.filter((s) => !s.ring || !s.inMain), [], "every stop is in main with a visible focus");
      assert.equal(await page.getByRole("button", { name: "US $" }).first().getAttribute("aria-pressed"), "true");
      // R151 (1 Oct 2026, 11:10Z): what a screen reader hears at each stop - every
      // field by its label, and the pills inside a named group, not "US $" alone.
      const unlabelled = await page.evaluate(() =>
        [...document.querySelectorAll("main input:not([type=hidden]), main select, main textarea")]
          .filter((e) => !(e.id && document.querySelector(`label[for="${e.id}"]`)) && !e.closest("label") && !e.getAttribute("aria-label"))
          .map((e) => e.getAttribute("name") ?? e.tagName),
      );
      assert.deepEqual(unlabelled, [], "every checkout field has a label");
      assert.equal(
        await page.getByRole("button", { name: "US $" }).first().evaluate((e) => e.closest('[role="group"]')?.getAttribute("aria-label") ?? null),
        "Prices in",
        "the market pills are a group with a name",
      );
      await page.getByRole("button", { name: "UK £" }).first().focus();
      await page.keyboard.press("Space");
      assert.match((await page.locator('[data-figure="checkout-price"]').first().textContent()) ?? "", /^£\d.*plus VAT$/);
      assert.equal(await page.evaluate(() => document.activeElement?.textContent), "UK £", "focus stays on the pill");
      await ctx.close();
    });

    // Pass 6 (R148/R153, 1 Oct 2026): the money path's sign-in leg, signed
    // out. /app sends you to the login form; each note and the link landing
    // has its one way on, 44px or more, and nothing is submitted.
    test("(8) /app -> login -> the link landing, every state with a tappable way on", async () => {
      const LEG: [string, RegExp, string][] = [
        ["/app", /^Log in to your dashboard$/, "Email me a link"],
        ["/app/login?link=expired", /^Log in to your dashboard$/, "Email me a link"],
        ["/app/login?access=none", /^Log in to your dashboard$/, "Email me a link"],
        ["/app/auth", /^That link is not valid$/, "Ask for a new link"],
        // R148 pass 11 (1 Oct 2026): since R163 (c6c1dbd) the GET reads the
        // token's row, and a well-shaped token with no row is "not valid", not
        // "Log in". The fresh face (auto-submit, "Open my dashboard") needs a
        // real token, so it is held by e2e/app/auth.spec.mts on the fixture.
        [`/app/auth?token=${"0".repeat(64)}`, /^That link is not valid$/, "Ask for a new link"],
      ];
      for (const [route, h1, action] of LEG) {
        const { page, ctx, status } = await open(width, route);
        assert.equal(status, 200, route);
        if (route === "/app") assert.match(page.url(), /\/app\/login$/);
        assert.match((await page.locator("h1").first().textContent()) ?? "", h1, route);
        assert.ok(await page.evaluate(() => (document.querySelector("main")?.textContent ?? "").startsWith("alwaystracked")), `${route}: opens with the lockup`);
        const box = await page.locator("a, button", { hasText: action }).first().boundingBox();
        assert.ok(box && box.height >= 44, `${route}: "${action}" is ${box?.height}px`);
        assert.ok((await overflow(page)) <= 0, `${route}: no sideways scroll`);
        await ctx.close();
      }
    });
  });
}

// (9) Stripe's return page, R148 pass 8 (1 Oct 2026). An order carrying a
// scan has a dashboard built by the webhook and a sign-in link mailed, so the
// page names the link and gives one way on to /app/login. Without a scan it
// still points at the onboarding call. Opened by GET only, as Stripe would.
for (const width of [1280, 390]) {
  describe(`(9) after checkout at ${width}`, () => {
    test("from a scan: the dashboard, the sign-in link, and a 44px way to /app/login", async () => {
      const { page, ctx, status } = await open(width, "/checkout/done?session=cs_placeholder&plan=tracked&from=scan");
      try {
        assert.equal(status, 200);
        assert.match((await page.locator("h1").first().textContent()) ?? "", /dashboard is being set up/);
        const go = page.getByRole("link", { name: "Go to sign in" });
        assert.equal(await go.getAttribute("href"), "/app/login");
        assert.ok(((await go.boundingBox())?.height ?? 0) >= 44, "sign-in button under 44px");
        assert.equal(await page.locator("text=onboarding call").count(), 0, "alwaystracked from a scan has no onboarding call line");
        assert.ok((await overflow(page)) <= 0, "sideways scroll");
        assert.equal(await statusOf("/app/login"), 200);
      } finally {
        await ctx.close();
      }
    });

    // R158 (1 Oct 2026): an order with no scan carries its website, from=site, and gets a dashboard too.
    test("from the website: the dashboard and the sign-in link, no first-check promise", async () => {
      const { page, ctx, status } = await open(width, "/checkout/done?session=cs_placeholder&plan=tracked&from=site");
      try {
        assert.equal(status, 200);
        assert.match((await page.locator("h1").first().textContent()) ?? "", /dashboard is being set up/);
        const body = (await page.locator("main").first().textContent()) ?? "";
        assert.match(body, /for your website/);
        assert.doesNotMatch(body, /first check runs tomorrow/, "no keyword or prompts yet, so no check tomorrow");
        assert.ok(((await page.getByRole("link", { name: "Go to sign in" }).first().boundingBox())?.height ?? 0) >= 44);
      } finally {
        await ctx.close();
      }
    });

    test("an older link with no from: the onboarding call, no sign-in button", async () => {
      const { page, ctx, status } = await open(width, "/checkout/done?session=cs_placeholder&plan=cited");
      try {
        assert.equal(status, 200);
        assert.match((await page.locator("h1").first().textContent()) ?? "", /onboarding call/);
        assert.equal(await page.getByRole("link", { name: "Go to sign in" }).count(), 0);
      } finally {
        await ctx.close();
      }
    });
  });
}

const SHOTS = path.join(ROOT, "test-results", "site");
mkdirSync(SHOTS, { recursive: true });

/**
 * Where the dashboard's sign-in is: /app/login while it shares the site's host,
 * the app host's /login once APP_HOST is set (app-host.ts appHref). Either is
 * right; anything else is not.
 */
const LOGIN = /^(\/app\/login|https:\/\/app\.alwayscited\.com\/login|http:\/\/app\.localhost:\d+\/login)$/;

// (10) Danny, 13 Oct 2026: "a login option in the nav for companies with a
// profile that takes them to the app subdomain sign in screen". On the bar at
// 768 and up, last before Free scan and plainer than it; in the phone menu
// below 768, a 44px row. The bar keeps its height and the page never scrolls
// sideways.
for (const width of [1280, 1024, 768, 390, 320]) {
  describe(`(10) the header's Log in at ${width}`, () => {
    test("one plain link to the dashboard's sign-in, in the bar or the phone menu", async () => {
      for (const route of ["/", "/alwaystracked"]) {
        const { page, ctx, status } = await open(width, route);
        try {
          assert.equal(status, 200, route);
          const name = route === "/" ? "home" : route.slice(1);
          const bar = page.locator(".site-header").first();
          const h = (await bar.boundingBox())?.height ?? 0;
          // The bars measured 61-68.4px before (Header.tsx); a wrapped nav would be twice that.
          assert.ok(h >= 60 && h <= 70, `${route}: the bar is ${h}px tall`);
          assert.ok((await overflow(page)) <= 0, `${route}: no sideways scroll`);
          if (width >= 768) {
            const login = page.locator('nav[aria-label="Main navigation"] a', { hasText: /^Log in$/ }).first();
            assert.equal(await login.isVisible(), true, `${route}: Log in on the bar`);
            const href = (await login.getAttribute("href")) ?? "";
            assert.match(href, LOGIN, `${route}: Log in goes to the dashboard's sign-in`);
            const scan = page.locator('nav[aria-label="Main navigation"] a', { hasText: /^Free scan$/ }).first();
            const [l, f] = [await login.boundingBox(), await scan.boundingBox()];
            assert.ok(l && f && l.x + l.width <= f.x, `${route}: Log in sits before Free scan`);
            const ground = await login.evaluate((e) => getComputedStyle(e).backgroundColor);
            assert.match(ground, /^rgba\(0, 0, 0, 0\)$|^transparent$/, `${route}: Log in is a plain link, not a second filled button (${ground})`);
            if (route === "/") assert.equal(await statusOf(href), 200, "the sign-in answers");
            await page.screenshot({ path: path.join(SHOTS, `header-${name}-${width}.png`), clip: { x: 0, y: 0, width, height: Math.ceil(h) + 4 } });
          } else {
            assert.equal(await page.locator('nav[aria-label="Main navigation"]').first().isVisible(), false, `${route}: no desktop nav at ${width}`);
            await page.getByRole("button", { name: "Open menu" }).first().click();
            const login = page.locator('nav[aria-label="Mobile navigation"] a', { hasText: /^Log in$/ }).first();
            assert.equal(await login.isVisible(), true, `${route}: Log in in the phone menu`);
            assert.match((await login.getAttribute("href")) ?? "", LOGIN);
            assert.ok(((await login.boundingBox())?.height ?? 0) >= 44, `${route}: Log in is a 44px row`);
            assert.ok((await overflow(page)) <= 0, `${route}: no sideways scroll with the menu open`);
            await page.screenshot({ path: path.join(SHOTS, `header-${name}-${width}-menu.png`) });
          }
        } finally {
          await ctx.close();
        }
      }
    });
  });
}

// (11) Danny, 13 Oct 2026: name, category and market are required on the
// "Loom with Luke" / "Demo with Danny" form. On a tier page (the version with
// no scan): each field labelled and required, the category list the site's
// sectors with Other, the markets US and UK, and Send with nothing filled
// refused at each field - focus on the first - with no request made.
for (const width of [1280, 390]) {
  describe(`(11) the walkthrough form at ${width}`, () => {
    test("name, work email, category and market are required, and refused at the field", async () => {
      const { page, ctx, status } = await open(width, "/alwaystracked");
      try {
        assert.equal(status, 200);
        const posted: string[] = [];
        page.on("request", (r) => {
          if (r.method() === "POST" && /\/api\/(scan\/[^/]+\/)?walkthrough/.test(r.url())) posted.push(r.url());
        });
        const form = page.locator("form#walkthrough").first();
        await form.scrollIntoViewIfNeeded();
        await page.waitForTimeout(700); // the rows' reveal settles before the screen
        for (const [id, label] of [["wt-name", "Your name"], ["wt-email", "Work email"], ["wt-category", "Category"]] as const) {
          assert.equal((await page.locator(`label[for="${id}"]`).first().textContent())?.trim(), label, `${id} label`);
          assert.equal(await page.locator(`#${id}`).first().evaluate((e) => (e as HTMLInputElement).required), true, `${id} required`);
        }
        assert.equal((await page.locator("#wt-market-label").first().textContent())?.trim(), "Market");
        const markets = await page.evaluate(() => [...document.querySelectorAll<HTMLInputElement>('#walkthrough input[name="market"]')].map((i) => `${i.value}:${i.required}:${i.checked}`));
        assert.deepEqual(markets, ["US:true:false", "UK:true:false"], "two required radios, nothing preselected on a tier page");
        const options = await page.evaluate(() => [...document.querySelectorAll<HTMLOptionElement>("#wt-category option")].map((o) => o.value));
        assert.equal(options[0], "", "a placeholder first");
        assert.ok(options.length >= 21, `the sector list, ${options.length - 1} of them`);
        assert.equal(options.at(-1), "other", "Other last");
        assert.ok((await overflow(page)) <= 0, "no sideways scroll");
        await form.screenshot({ path: path.join(SHOTS, `walkthrough-tier-${width}.png`) });

        await form.locator('button[type="submit"]').first().click();
        await page.waitForTimeout(300);
        assert.deepEqual(posted, [], "nothing is sent while a field is missing");
        for (const [id, message] of [
          ["wt-name", "Tell us your name."],
          ["wt-email", "Enter your work email."],
          ["wt-category", "Pick your business category."],
        ] as const) {
          const field = page.locator(`#${id}`).first();
          assert.equal(await field.getAttribute("aria-invalid"), "true", `${id} invalid`);
          assert.equal(await field.getAttribute("aria-describedby"), `${id}-error`, `${id} described by its error`);
          assert.equal((await page.locator(`#${id}-error`).first().textContent())?.trim(), message, `${id} says why`);
        }
        const group = page.locator('#walkthrough [role="radiogroup"][aria-labelledby="wt-market-label"]').first();
        assert.equal(await group.getAttribute("aria-invalid"), "true", "the market group invalid");
        assert.equal(await group.getAttribute("aria-describedby"), "wt-market-error");
        assert.equal((await page.locator("#wt-market-error").first().textContent())?.trim(), "Pick your market.");
        for (const m of ["US", "UK"]) {
          const radio = page.locator(`#wt-market-${m}`).first();
          assert.equal(await radio.getAttribute("aria-describedby"), "wt-market-error", `the ${m} radio described by the error, where focus lands`);
        }
        // 13 Oct 2026 (review): every field error is an alert, so it is heard
        // whether or not focus moves.
        for (const f of ["name", "email", "category", "market"]) {
          assert.equal(await page.locator(`#wt-${f}-error`).first().getAttribute("role"), "alert", `${f}'s error is announced`);
        }
        assert.equal(await page.evaluate(() => document.activeElement?.id), "wt-name", "focus on the first wrong field");
        assert.ok((await overflow(page)) <= 0, "no sideways scroll with the errors");
        await form.screenshot({ path: path.join(SHOTS, `walkthrough-tier-${width}-refused.png`) });

        // Each error goes as its field is filled; nothing is sent.
        await page.locator("#wt-name").first().fill("Jane Smith");
        await page.locator("#wt-category").first().selectOption("technology");
        await page.locator("#wt-market-UK").first().check();
        assert.equal(await page.locator("#wt-name-error").count(), 0, "the name error clears");
        assert.equal(await page.locator("#wt-category-error").count(), 0, "the category error clears");
        assert.equal(await page.locator("#wt-market-error").count(), 0, "the market error clears");
        assert.equal((await page.locator("#wt-email-error").first().textContent())?.trim(), "Enter your work email.", "the email error stays");
        assert.deepEqual(posted, [], "still nothing sent");
        await form.screenshot({ path: path.join(SHOTS, `walkthrough-tier-${width}-filled.png`) });

        // The review's case (13 Oct 2026): a personal address and Enter in the
        // email box. Focus does not move, so only the alert can say why; a
        // second Enter remounts it, so it is said again.
        const email = page.locator("#wt-email").first();
        await email.fill("jane@gmail.com");
        assert.equal(await page.locator("#wt-email-error").count(), 0, "the email error clears as it is typed");
        await email.press("Enter");
        await page.waitForTimeout(200);
        const refused = page.locator("#wt-email-error").first();
        assert.equal((await refused.textContent())?.trim(), WORK_EMAIL_REFUSAL, "a personal address is refused at the field");
        assert.equal(await refused.getAttribute("role"), "alert", "and the refusal is announced");
        assert.equal(await page.evaluate(() => document.activeElement?.id), "wt-email", "focus stays in the email box");
        await refused.evaluate((e) => e.setAttribute("data-heard", "1"));
        await email.press("Enter");
        await page.waitForTimeout(200);
        assert.equal(await page.locator("#wt-email-error").first().getAttribute("data-heard"), null, "a second refusal is a new alert, announced again");
        assert.deepEqual(posted, [], "a personal address is never sent");
        await form.screenshot({ path: path.join(SHOTS, `walkthrough-tier-${width}-personal.png`) });

        // axe on the form: labels, names, ARIA and contrast, in its refused state.
        await page.addScriptTag({ content: AXE });
        const violations = await page.evaluate(async () => {
          const axe = (window as unknown as { axe: { run(ctx: string, o: object): Promise<{ violations: { id: string; impact: string; nodes: unknown[] }[] }> } }).axe;
          const r = await axe.run("#walkthrough", { resultTypes: ["violations"] });
          return r.violations.map((v) => `${v.id} (${v.impact}, ${v.nodes.length})`);
        });
        assert.deepEqual(violations, [], "axe on the walkthrough form");
      } finally {
        await ctx.close();
      }
    });
  });
}
