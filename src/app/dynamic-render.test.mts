import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { test } from "node:test";

import {
  CAPTURE_MANIFEST,
  PRERENDER_DIR as PRERENDER,
  STATES,
  capturedPages,
  prerenderedPages,
  sweptPages,
  unsweptRoutes,
} from "./dynamic-render.mts";

/**
 * The sweeps' own blind spot, made into a thing that fails.
 *
 * Until this file existed, every sweep in the tree walked `.next/server/app`
 * for `*.html` and called the result "the site". It is not: a route marked `ƒ`
 * in the build output writes no HTML there. `/blog`, `/scan`, `/scan/[token]`,
 * `/coverage-check/[token]` and `/admin/scans` were all outside every check
 * recorded as cleared - and `/scan` is the funnel's entry point.
 *
 * The danger in the fix is that it fails open. `capture()` writes files; if it
 * is not run, `sweptPages()` quietly returns the prerender alone and every
 * sweep goes back to being blind while still reporting itself clear. That is
 * the *same* defect, so the check for it lives here, in one place, and says
 * what to run.
 */

const NEEDS_BUILD = "no build to read - run `npm run build` then `npm run capture`";

test("the unswept set is derived from the build, not typed", (t) => {
  if (!existsSync(PRERENDER)) {
    t.skip(NEEDS_BUILD);
    return;
  }

  const unswept = unsweptRoutes();
  t.diagnostic(`dynamic page routes: ${unswept.join(", ")}`);

  // If this ever empties, either every page became static - in which case this
  // file has no job - or the derivation stopped working, which is the failure
  // that looks exactly like success.
  assert.ok(
    unswept.length > 0,
    "no dynamic page routes found at all. Either the manifest moved or `prerenderPath` no longer " +
      "matches how Next names a prerender - check before believing this.",
  );

  // Every route the build says is dynamic must have an entry. This is the
  // whole point: a new `searchParams` page cannot join the site without either
  // being swept or being declared unrenderable with a reason.
  const undeclared = unswept.filter((route) => !(route in STATES));
  assert.deepEqual(
    undeclared,
    [],
    `dynamic routes with no entry in STATES: ${undeclared.join(", ")}. Each is invisible to every ` +
      `sweep in this tree until it has one.`,
  );

  // And the reverse: an entry for a route that is no longer dynamic is dead
  // weight that reads as coverage.
  const stale = Object.keys(STATES).filter((route) => !unswept.includes(route));
  assert.deepEqual(stale, [], `STATES has entries for routes that are not dynamic any more: ${stale.join(", ")}`);
});

test("the capture actually ran, and covers every dynamic route", (t) => {
  if (!existsSync(PRERENDER)) {
    t.skip(NEEDS_BUILD);
    return;
  }

  assert.ok(
    existsSync(CAPTURE_MANIFEST),
    "no capture manifest. Every sweep that calls sweptPages() is reading the prerender alone " +
      "right now, which is the blindness this file exists to close. Run `npm run capture`.",
  );

  const captured = capturedPages();
  const routes = new Set(unsweptRoutes());

  // A route is covered if it rendered at least one state, or is declared
  // unrenderable. `capture()` proves the second by requesting it and asserting
  // it did not answer 200, so an entry here is a measurement, not a memory.
  for (const route of routes) {
    const { urls, blocked } = STATES[route]!;
    if (!urls.length) {
      assert.ok(blocked, `${route} has no URLs and no reason - say why it cannot be rendered`);
      continue;
    }
    assert.ok(
      captured.some((p) => p.page === urls[0]),
      `${route} is renderable but ${urls[0]} is not in the capture. Re-run \`npm run capture\`.`,
    );
  }

  t.diagnostic(
    `${captured.length} dynamic states captured: ${captured.map((p) => p.page).join(", ")}`,
  );
});

test("sweptPages is strictly more than the prerender", (t) => {
  if (!existsSync(PRERENDER) || !existsSync(CAPTURE_MANIFEST)) {
    t.skip(NEEDS_BUILD);
    return;
  }

  const pre = prerenderedPages();
  const all = sweptPages();

  assert.ok(pre.length >= 20, `expected the site prerendered, walked ${pre.length}`);
  assert.ok(
    all.length > pre.length,
    `sweptPages() returned ${all.length} against ${pre.length} prerendered - the capture added ` +
      `nothing, so the sweeps are no wider than they were.`,
  );

  // The two named in the design review, by name. `/scan` is the funnel's entry
  // point and `/blog` is the page whose missing beat started this.
  const labels = all.map((p) => p.page);
  assert.ok(labels.includes("/blog"), "/blog is still not in the swept set");
  assert.ok(labels.includes("/scan"), "/scan is still not in the swept set");

  t.diagnostic(`${pre.length} prerendered + ${all.length - pre.length} captured = ${all.length} pages swept`);
});

/**
 * The guard this repo's sweeps have learned to write: prove the detector can
 * see the thing before believing an empty result from it, and prove it does
 * not see what it should ignore.
 */
test("the blog kind discovery finds pills and nothing else", async () => {
  const { STATES: states } = await import("./dynamic-render.mts");
  const discover = states["/blog"]!.discover!;

  assert.deepEqual(
    discover('<a href="/blog?kind=Method">Method</a><a href="/blog?kind=Findings">Findings</a>'),
    ["/blog?kind=Method", "/blog?kind=Findings"],
    "the pill discovery no longer sees a filter link",
  );
  assert.deepEqual(discover('<a href="/blog">All</a>'), [], "the unfiltered pill is not a kind");
  assert.deepEqual(
    discover('<a href="/blog/why-most-aeo-audits-are-a-waste-of-money">post</a>'),
    [],
    "a post link is not a filter state",
  );
  assert.deepEqual(
    discover('<a href="/blog?kind=Method">a</a><a href="/blog?kind=Method">b</a>'),
    ["/blog?kind=Method"],
    "the same kind twice is one state",
  );
});

/**
 * What is still not swept, said out loud.
 *
 * Three routes need something this machine does not have. Recording them here
 * rather than leaving them absent is the difference between a known gap and
 * the gap that started all of this - and if one of them ever becomes
 * renderable, `capture()` throws rather than letting it sit on the list.
 */
test("the routes that cannot be rendered here are exactly the seven known ones", () => {
  const blocked = Object.entries(STATES)
    .filter(([, s]) => !s.urls.length)
    .map(([route]) => route)
    .sort();

  // Four since 29 Sep 2026: /admin/tracking (T2) sits behind the same Basic
  // auth as /admin/scans, and a credential is not ours to hold. The /app
  // routes (T3) all render here: without a session they land on /app/login.
  // Five since 30 Sep 2026: /admin/tracking/[client]/placements (R96 part 3), same auth.
  // Six since 30 Sep 2026: /admin/tracking/usage (R98 T10), same auth.
  // Seven since 1 Oct 2026: /admin/funnel (R152), same auth.
  // Eight since 1 Oct 2026: /admin/emails (R159 part 2), same auth.
  // Nine since 4 Oct 2026: /case-studies/[id], studies published from the
  // Nomada agency hub. Not auth: it has no URL until one is published, and
  // then it is prerendered and swept like any page.
  // Eleven since 16 Oct 2026: /blog/[slug], posts published from the agency
  // hub's CMS - same reason as the case studies, no URL until one is live -
  // and its draft preview /blog-preview/[slug]/[key], which needs a preview
  // key only the hub holds.
  assert.deepEqual(blocked, [
    "/admin/emails",
    "/admin/funnel",
    "/admin/scans",
    "/admin/tracking",
    "/admin/tracking/[client]/placements",
    "/admin/tracking/usage",
    "/blog-preview/[slug]/[key]",
    "/blog/[slug]",
    "/case-studies/[id]",
    "/coverage-check/[token]",
    // Twenty-two since 17 Oct 2026, with /dashboards/[client]/managed (the paid plans' clusters). Twenty-one before: the dashboards host's signed-in pages, which need a member session and the
    // database (its /login and /auth are swept, asked for under that host's name).
    "/dashboards",
    "/dashboards/[client]",
    "/dashboards/[client]/ai",
    // 17 Oct 2026: the click-through views, same reason.
    "/dashboards/[client]/ai/[prompt]",
    "/dashboards/[client]/alwaystracked",
    "/dashboards/[client]/clusters",
    "/dashboards/[client]/clusters/[cluster]",
    "/dashboards/[client]/google",
    "/dashboards/[client]/google/[keyword]",
    "/dashboards/[client]/integrations",
    "/dashboards/[client]/managed",
    "/dashboards/[client]/opportunities",
    "/dashboards/[client]/plan",
    // 18 Oct 2026 (brief 2d / 2g): setup, Settings and the alwaystracked view, same reason.
    "/dashboards/[client]/settings",
    "/dashboards/[client]/setup",
    "/dashboards/[client]/sources",
    "/dashboards/[client]/sources/[domain]",
    "/scan/[token]",
  ]);

  for (const route of blocked) {
    assert.ok(
      (STATES[route]!.blocked ?? "").length > 20,
      `${route} needs a reason somebody can act on, not a shrug`,
    );
  }
});
