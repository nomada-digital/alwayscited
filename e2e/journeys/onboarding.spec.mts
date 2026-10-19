/**
 * The onboarding journey before payment (R166 step 7, Danny, danny.md line
 * 175; R154). Read-only against production: every page is opened by GET, no
 * form is submitted, nothing is paid for and no mail is sent.
 *
 *   node --test e2e/journeys/onboarding.spec.mts
 *   JOURNEY_BASE=http://127.0.0.1:3000 node --test e2e/journeys/onboarding.spec.mts
 *
 * For every tier page and every tier /checkout takes, from the UK and the US
 * scan in docs/inbox.md: the page loads, names its tier, and shows the 3-step
 * strip with src/config/onboarding.ts's steps word for word and no placement
 * timeline (step 8). After payment, setup is the dashboards host's /<client>/setup (19 Oct 2026, brief 2d).
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";

import { NEXT_STEPS, NEXT_STEPS_HEADING } from "../../src/config/onboarding.ts";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const require = createRequire(path.join(os.homedir(), "code/.parity/package.json"));
type Page = {
  goto(url: string, o?: object): Promise<{ status(): number } | null>;
  evaluate<R>(fn: () => R | Promise<R>): Promise<R>;
};
type Context = { newPage(): Promise<Page>; close(): Promise<void> };
type Browser = { newContext(o: object): Promise<Context>; close(): Promise<void> };
const { chromium } = require("playwright") as { chromium: { launch(): Promise<Browser> } };

const BASE = process.env.JOURNEY_BASE ?? "https://alwayscited.com";
/** docs/inbox.md lists the UK domain's scan first, then the US one. */
const TOKENS = [...readFileSync(path.join(ROOT, "docs", "inbox.md"), "utf8").matchAll(/\/scan\/([0-9a-f]{32})\b/g)].map((m) => m[1]!);
const MARKETS = [
  ["UK", TOKENS[0]],
  ["US", TOKENS[1]],
] as const;

/** The tier pages, and the tiers /checkout sells (src/lib/checkout/session.ts CHECKOUT_TIERS). */
const TIER_PAGES = ["alwaystracked", "alwaysmentioned", "alwayscited", "alwayseverywhere"];
const CHECKOUT = ["alwaystracked", "alwaysmentioned", "alwayscited"];

/** A placement timeline: a count of days, weeks or months. */
const TIMELINE = /\b\d+\s*(?:-\s*\d+\s*)?(?:days?|weeks?|months?)\b/i;

let browser: Browser;
before(async () => {
  browser = await chromium.launch();
});
after(async () => {
  await browser.close();
});

type Seen = { status: number; h1: string; heading: string; steps: string[]; overflow: number };

async function read(width: number, route: string): Promise<Seen> {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } });
  try {
    const page = await ctx.newPage();
    const r = await page.goto(BASE + route, { waitUntil: "load" });
    const seen = await page.evaluate(() => {
      const s = document.querySelector('section[aria-labelledby="next-steps-h"]');
      return {
        h1: document.querySelector("h1")?.textContent ?? "",
        heading: s?.querySelector("h2")?.textContent?.trim() ?? "",
        steps: s ? [...s.querySelectorAll("li")].map((li) => li.textContent?.trim() ?? "") : [],
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    return { status: r?.status() ?? 0, ...seen };
  } finally {
    await ctx.close();
  }
}

function holdsStrip(s: Seen, where: string) {
  assert.equal(s.status, 200, where);
  assert.equal(s.heading, NEXT_STEPS_HEADING, `${where}: the strip's heading`);
  // Each item draws its number before its words.
  assert.deepEqual(s.steps, NEXT_STEPS.map((step, i) => `${i + 1}${step}`), `${where}: the three steps, word for word`);
  assert.doesNotMatch(s.steps.join(" "), TIMELINE, `${where}: a placement timeline in the strip`);
  assert.ok(s.overflow <= 0, `${where}: sideways scroll`);
}

test("the UK and US scan tokens are in docs/inbox.md", () => {
  assert.equal(TOKENS.length >= 2, true);
});

for (const width of [1280, 390]) {
  describe(`onboarding before payment at ${width}`, () => {
    for (const tier of TIER_PAGES) {
      test(`/${tier} shows the 3-step strip`, async () => {
        holdsStrip(await read(width, `/${tier}`), `/${tier}`);
      });
    }
    test("/packages shows the 3-step strip", async () => {
      holdsStrip(await read(width, "/packages"), "/packages");
    });
    for (const [market, token] of MARKETS) {
      for (const tier of CHECKOUT) {
        test(`/checkout for ${tier} from the ${market} scan names the tier and shows the strip`, async () => {
          const route = `/checkout?tier=${tier}&scan=${token}`;
          const s = await read(width, route);
          holdsStrip(s, route);
          assert.equal(s.h1.replace(/\s+/g, ""), `Start${tier}`, `${route}: the heading names the tier`);
        });
      }
    }
  });
}
