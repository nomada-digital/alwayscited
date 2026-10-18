import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { NEXT_STEPS, nextSteps } from "./onboarding.ts";
import { welcome } from "../lib/email/lifecycle.ts";
import { checkTime } from "../lib/tracking/check-time.ts";

/**
 * The 3-step strip (R166, Danny, danny.md line 175, 1 Oct 2026): drawn on
 * every tier page, /packages and /checkout, and the welcome email repeats it.
 * One copy in onboarding.ts; this holds each place to it.
 */

const SRC = join(fileURLToPath(import.meta.url), "..", "..");
const read = (p: string) => readFileSync(join(SRC, p), "utf8");

// PackagePage draws all four tier pages.
const SURFACES = ["components/PackagePage.tsx", "app/packages/page.tsx", "app/checkout/page.tsx"];

test("the strip is drawn on the tier pages, /packages and /checkout", () => {
  for (const file of SURFACES) {
    assert.match(read(file), /<NextSteps\b/, `${file} does not draw the 3-step strip`);
  }
  for (const tier of ["alwaystracked", "alwaysmentioned", "alwayscited", "alwayseverywhere"]) {
    assert.match(read(`app/${tier}/page.tsx`), /PackagePage/, `/${tier} is not drawn by PackagePage`);
  }
});

// 8 Oct 2026 (audit activation-16): welcome takes the plan's clusterLimit, and its
// trial version (trial_started) carries the same strip. 18 Oct 2026 (brief 2e): the
// welcome is the approved design, whose steps say the same three things in its own
// words - check a Google keyword, pick the target page, edit the prompts drafted -
// so it no longer repeats the strip's sentences. What is held now is that it says
// those steps, and the check's time only where the market is known.
test("the welcome email's steps: a keyword, the target page, the drafted prompts, paid and on the trial", () => {
  const paid = welcome({ tier: "tracked", clusters: 1, clusterLimit: 10, domain: "example.com", link: "https://example.com/x" });
  const trial = welcome({ tier: "tracked", clusters: 1, clusterLimit: 10, domain: "example.com", link: "https://example.com/x", trial: { ends: "22 Oct 2026, 3:30pm ET", charge: "$1 a month", billing: "https://example.com/b" } });
  assert.equal(NEXT_STEPS.length, 3);
  for (const mail of [paid, trial]) {
    assert.match(mail.text, /Check a Google keyword/);
    assert.match(mail.text, /Pick the target page/);
  }
  assert.match(trial.text, /Edit 5 prompts/);
  assert.doesNotMatch(paid.text, /\d:\d\d|UK time| ET\b/, "no market, no time");
});

test("no placement timeline in the strip", () => {
  // 9 Oct 2026 (ON-3): the timed strip the setup page and the welcome email draw is held too.
  for (const step of [...NEXT_STEPS, ...nextSteps(checkTime("2026-10-10", "UK")), ...nextSteps(checkTime("2026-11-02", "US"))]) {
    assert.doesNotMatch(step, /placement|placed|publish|\bweeks?\b|\bmonths?\b|\bdays?\b/i, step);
  }
});

/**
 * ON-1 and ON-3 (9 Oct 2026, launch blocker LB8): setup is self-serve and the
 * first check waits on a cluster's prompts, so the strip promises neither a
 * person nor "the next morning". Where the market is known it says the daily
 * check's time in that zone (check-time.ts); the public pages know none and
 * say no time. The welcome email is sent with the market and start.
 */
test("the strip describes the self-serve drafts, and says a time only where the market is known", () => {
  assert.equal(NEXT_STEPS.length, 3);
  assert.match(NEXT_STEPS[0], /edit the five prompts drafted from it/);
  assert.doesNotMatch(NEXT_STEPS.join(" "), /\bwe (?:write|add|set|pick|choose)\b|next morning|by hand/i, "nothing a person does for them");
  assert.equal(NEXT_STEPS[1], "Your first readings come from the daily check after your prompts are in.");
  assert.equal(nextSteps(checkTime("2026-10-10", "UK"))[1], "Your first readings come from the daily check at 06:00 UK time after your prompts are in.");
  assert.equal(nextSteps(checkTime("2026-11-02", "US"))[1], "Your first readings come from the daily check at 12:00am ET after your prompts are in.");
  // 18 Oct 2026 (brief 2e): the designed welcome says the daily check's time in the client's zone, from check-time.ts.
  const mail = welcome({ tier: "tracked", clusters: 1, clusterLimit: 10, domain: "example.com", link: "https://example.com/x", market: "US", startedOn: "2026-10-10" });
  assert.ok(mail.text.includes(`Daily at ${checkTime("2026-10-10", "US")}`), "the welcome says the check's time in the client's zone");
  const signup = readFileSync(join(SRC, "lib/checkout/signup.ts"), "utf8");
  assert.match(signup, /welcome\(\{ tier: tier as TierKey, clusters, clusterLimit, domain, link, trial, market, startedOn, engines, prompts, settings \}\)/, "signup sends the welcome with the market and start");
});
