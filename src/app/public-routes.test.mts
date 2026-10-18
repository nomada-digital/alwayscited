import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { BUILD_DIR, sweptPages, type Page } from "./dynamic-render.mts";
import { disallowedPaths, noindexHeaderRules, pageRoutes, privateRoutes, probePath } from "./route-probes.mts";

/**
 * Every page that is meant to be found still can be.
 *
 * `route-closure.test.mts` proves a private route is shut three ways. That is
 * one direction, and it is the direction where the cost of being wrong is a
 * token page in an index. **Nothing proved the other one**: that a page meant
 * to be crawled has not been quietly shut. For a business that sells being
 * found, that is the more expensive failure of the two, and every mechanism
 * the closure test uses can cause it:
 *
 * - **A header rule matching more than it meant to.** The closure test asserts
 *   a private route IS matched by an `x-robots-tag: noindex` rule. It never
 *   asks what else the rule matches. A source of `/scan` instead of
 *   `/scan/:path+` deindexes nothing extra today, but the same slip on a
 *   shorter prefix would take public pages with it and every existing
 *   assertion would still pass.
 * - **A `Disallow` losing its trailing slash.** robots.txt disallows
 *   `/coverage-check/`, which blocks the token pages and leaves the public
 *   form at `/coverage-check` crawlable. Delete one character and the lead-gen
 *   page is gone from search with nothing failing - the closure test only
 *   cares that the token page IS covered, and a broader rule covers it harder.
 * - **A `robots: { index: false }` pasted onto the wrong page**, which is the
 *   cheapest mistake of the three to make.
 *
 * `page-head.test.mts` carries a floor of `indexable > 15`, which catches a
 * mass regression and not a single page. This names them.
 */

const NEEDS_BUILD = "no build to read - run `npm run build` then `npm run capture`";

/**
 * The routes that are allowed to be closed, and why.
 *
 * A written list rather than a count, for the reason `readiness-spec.ts` keeps
 * one: a count passes when the set changes by a swap. Adding a private route
 * means adding a line here, which is the point - it is a decision, not a
 * detail. Every entry is checked for staleness below, so the list cannot rot
 * into a blanket pass.
 */
const CLOSED_ON_PURPOSE: Record<string, string> = {
  "/admin/scans": "the ops page; 401s to everyone and has no public reader at all",
  "/admin/funnel": "funnel counts by day and market (R152, 1 Oct 2026); behind the same /admin Basic auth, no public reader",
  "/admin/emails": "lifecycle email previews on fixture data for Danny to approve (R159, 1 Oct 2026); behind the same /admin Basic auth, no public reader",
  "/admin/tracking": "tracked-client operations (T2, 29 Sep 2026); behind the same /admin Basic auth, no public reader",
  // 30 Sep 2026, R96 part 3 (BRIEF-2 T12).
  "/admin/tracking/[client]/placements": "logging one client's placements; behind the same /admin Basic auth, no public reader",
  "/admin/tracking/usage": "weekly dashboard usage counts (R98 T10, 30 Sep 2026); behind the same /admin Basic auth, no public reader",
  // The alwaystracked client dashboard (T3, 29 Sep 2026): a client's own
  // figures behind a login. The login and link pages are reachable by anyone
  // but are doors to a private area, not pages to be found.
  "/app": "the dashboard's entry; redirects to the member's client or to /app/login",
  "/app/[client]": "one client's private dashboard; 404s to anyone who is not a member",
  // 30 Sep 2026, T6 part 1.
  "/app/[client]/clusters": "one client's tracked clusters and prompts; private, same membership 404 as the overview",
  // 30 Sep 2026, T7 part 2b.
  "/app/[client]/clusters/[cluster]": "one tracked cluster's figures and prompts; private, same membership 404, and a 404 for a cluster not the client's",
  // 30 Sep 2026, R97 part 3 (T13).
  "/app/[client]/settings": "one client's plan, matched names and team; private, same membership 404",
  // 1 Oct 2026, R166 part 3b.
  "/app/[client]/setup": "a new client's clusters to review and confirm; private, same membership 404",
  // 1 Oct 2026, R143 (BRIEF-4 P3).
  "/app/[client]/named": "every brand named in one client's tracked answers; private, same membership 404",
  // 1 Oct 2026, R144 (BRIEF-4 P4).
  "/app/[client]/cited": "every page cited in one client's tracked answers; private, same membership 404",
  // 13 Oct 2026, DIY P4: AI visibility (spec 10 section 4.2), a new private page with the overview's rules.
  "/app/[client]/ai": "one client's AI visibility by engine and by prompt; private, same membership 404",
  // 1 Oct 2026, R145 (BRIEF-4 P5).
  "/app/[client]/reports": "one client's monthly figures and CSV downloads; private, same membership 404",
  "/app/[client]/placements": "one client's placements and where the cluster stood; private, same membership 404, and a 404 for a client with no placed tier and no placement",
  // 13 Oct 2026, DIY P6: Google (spec 10 section 4.3), a new private page with the overview's rules.
  "/app/[client]/google": "one client's Google positions, gaining ground and who holds page 1; private, same membership 404",
  // 13 Oct 2026, DIY P3: Actions (internally the Plan).
  "/app/[client]/plan": "one client's actions, what was done and what was read after; private, same membership 404",
  // 13 Oct 2026, DIY P7: Opportunities and one opportunity (spec 10 section 4.7).
  "/app/[client]/opportunities": "the pages the engines cite that leave one client out, and how to approach them; private, same membership 404",
  "/app/[client]/opportunities/[id]": "one opportunity's brief and status; private, same membership 404, and a 404 for an opportunity not the client's",
  // 13 Oct 2026, DIY P10 (spec 10 section 4.8).
  "/app/[client]/links": "one client's link profile, its link gap, link targets and mentions, and Check a link; private, same membership 404",
  // 13 Oct 2026, DIY P8: Your pages and one key page.
  "/app/[client]/pages": "one client's key pages, their crawler access and the schema examples; private, same membership 404",
  "/app/[client]/pages/[page]": "one key page's schema, fit, basics and history; private, same membership 404, and a 404 for a page not the client's live key page",
  // 2 Oct 2026, R173 pass 3, DS36.
  "/app/[client]/[...rest]": "any /app/[client] address no page matches; private, same membership 404, then the dashboard's own 404",
  "/app/auth": "where a single-use login link lands; the token in its URL is private",
  "/app/login": "the dashboard login form; nothing on it is meant to be found by search",
  // 17 Oct 2026: dashboards.alwayscited.com's tree, served only on that host (src/lib/dash/host.ts).
  "/dashboards": "the dashboards host's root, which only redirects - to the member's first site, or to sign in",
  "/dashboards/[client]": "one client's overview on the dashboards host; private, behind its sign-in, a 404 for a client outside the member's list",
  "/dashboards/[client]/ai": "one client's AI answers; private, same membership 404",
  "/dashboards/[client]/ai/[prompt]": "one prompt's every answer, its words and sources (17 Oct 2026); private, same membership 404",
  "/dashboards/[client]/google/[keyword]": "one tracked keyword's every Google reading and top 20; private, same membership 404",
  "/dashboards/[client]/sources/[domain]": "the answers that cited one site; private, same membership 404",
  "/dashboards/[client]/clusters": "one client's clusters and their editor; private, same membership 404",
  "/dashboards/[client]/clusters/[cluster]": "one cluster's keyword groups, keywords and prompts; private, same membership 404",
  "/dashboards/[client]/google": "one client's Google positions; private, same membership 404",
  "/dashboards/[client]/integrations": "one client's connections; private, same membership 404",
  "/dashboards/[client]/managed": "one client's managed clusters and this month's delivery on them (paid plans, 17 Oct 2026); private, same membership 404",
  "/dashboards/[client]/opportunities": "one client's opportunities; private, same membership 404",
  "/dashboards/[client]/plan": "one client's plan and allowances; private, same membership 404",
  // 18 Oct 2026 (brief 2d / 2g).
  "/dashboards/[client]/setup": "one client's setup (keywords, target pages, prompts); private, same membership 404",
  "/dashboards/[client]/settings": "one client's team and settings; private, same membership 404",
  "/dashboards/[client]/alwaystracked": "one paid client's alwaystracked view of its own figures; private, same membership 404",
  "/dashboards/[client]/sources": "the sites the engines cite for one client; private, same membership 404",
  "/dashboards/auth": "the dashboards host's sign-in link button; nothing on it is meant to be found",
  "/dashboards/login": "the dashboards host's sign-in form; nothing on it is meant to be found by search",

  // T4, 29 Sep 2026: renders only in a local checkout that has generated the
  // uncommitted fixture file, and 404s on Vercel whatever else is true.
  "/app/parity": "the T4 parity fixture; a 404 in production, local builds only, reads a file under docs/ and no database",
  // R91, 29 Sep 2026: reached from a tier's checkout button with the picks in its query.
  "/checkout": "an order in progress - the form before Stripe's payment page; nothing on it is meant to be found by search",
  "/checkout/done": "where Stripe returns a buyer after payment; reached only from Stripe, nothing on it is meant to be found",
  "/scan": "the GET form target, noindex and deliberately headerless - see HEADERLESS_ON_PURPOSE",
  "/scan/[token]": "somebody's own scan result, reachable only by holding the token",
  "/coverage-check/[token]": "somebody's own campaign reading, reachable only by holding the token",
  // 16 Oct 2026: a hub blog post before it is live (lib/hub-posts.ts), reached from the agency hub's preview link.
  "/blog-preview/[slug]/[key]": "an unpublished blog post, reachable only by holding the preview key the agency hub issues",
};

/**
 * Routes that are noindex and must still carry no `x-robots-tag`, with why.
 *
 * `/scan` is the one. It is a GET form target, so it must stay fetchable, and
 * `robots.ts` says the meta tag it already carries is enough - "a directive
 * about indexing, addressed to search engines". `next.config.ts` records that
 * this was wrong once: `/scan/:path*` matched bare `/scan` where `:path+` was
 * meant, and the page picked up a header it is not supposed to have.
 *
 * **That fix was held by nothing.** `route-closure.test.mts` proves the rule
 * matches `/scan/<token>`, and it `continue`s past `/scan` rather than
 * asserting anything about it; its one check that the rule does *not* match
 * bare `/scan` runs against an injected fixture, not against the manifest that
 * ships. So reverting `:path+` to `:path*` in the shipped config failed no
 * test. Found by injecting exactly that.
 */
const HEADERLESS_ON_PURPOSE: Record<string, string> = {
  "/scan": "a GET form target that must stay fetchable; its meta tag is the whole of what it needs",
};

const ROUTES = pageRoutes();
const PRIVATE = new Set(privateRoutes());
const PUBLIC = ROUTES.filter((r) => !PRIVATE.has(r));

/** A page is closed to a crawler if anything in its head says noindex. */
const headOf = (html: string) => /<head>[\s\S]*?<\/head>/.exec(html)?.[0] ?? "";

function routeOf(page: string): string {
  if (page.startsWith("/")) return page.split("?")[0];
  const path = page.replace(/\.html$/, "");
  return path === "index" ? "/" : "/" + path;
}

test("the route walk and the private set are both real, so nothing below is vacuous", () => {
  assert.ok(ROUTES.length > 15, "only " + ROUTES.length + " page routes found - the walk, not the app, is what changed");
  assert.ok(PRIVATE.size > 0, "no private route found - route-closure's probe has drifted and this file would pass over everything");
  assert.ok(PUBLIC.length > 15, "only " + PUBLIC.length + " public routes - the private set has swallowed the site");
});

test("only the routes named as closed on purpose are closed", () => {
  const unexpected = [...PRIVATE].filter((r) => !Object.hasOwn(CLOSED_ON_PURPOSE, r));
  assert.deepEqual(
    unexpected,
    [],
    "a page declares itself noindex and is not on the list in this file. If that is deliberate, add it with a reason; " +
      "if it is a paste, this is the page that has just left the index.",
  );
});

test("every route named as closed on purpose still exists and is still closed", () => {
  // An exemption outliving its route is a hole nobody can see, which is the
  // rule copy.test.mts and reads.test.mts already keep over their own lists.
  const stale = Object.keys(CLOSED_ON_PURPOSE).filter((r) => !ROUTES.includes(r));
  assert.deepEqual(stale, [], "this file exempts a route that no longer exists");

  const opened = Object.keys(CLOSED_ON_PURPOSE).filter((r) => !PRIVATE.has(r));
  assert.deepEqual(opened, [], "a route listed here as closed on purpose is no longer noindex");
});

test("no noindex header rule reaches a public route", (t) => {
  let manifest: string;
  try {
    manifest = readFileSync(join(BUILD_DIR, "routes-manifest.json"), "utf8");
  } catch {
    return t.skip(NEEDS_BUILD);
  }
  const rules = noindexHeaderRules(manifest);
  assert.ok(rules.length > 0, "no x-robots-tag rule in the build - the probe has drifted, not the config");

  const hit: string[] = [];
  for (const route of PUBLIC) {
    const path = probePath(route);
    for (const rule of rules) {
      if (rule.regex.test(path)) hit.push(route + " is deindexed by the header rule for " + rule.source);
    }
  }
  assert.deepEqual(
    hit,
    [],
    "a header rule written for a private route matches a public one. The page still renders and still says it is " +
      "indexable; the header a crawler reads first says it is not.",
  );
  t.diagnostic(rules.length + " noindex header rules, " + PUBLIC.length + " public routes, 0 collisions");
});

test("no noindex header rule reaches a route that must stay headerless", (t) => {
  let manifest: string;
  try {
    manifest = readFileSync(join(BUILD_DIR, "routes-manifest.json"), "utf8");
  } catch {
    return t.skip(NEEDS_BUILD);
  }
  const rules = noindexHeaderRules(manifest);
  assert.ok(rules.length > 0, "no x-robots-tag rule in the build - the probe has drifted, not the config");

  const stale = Object.keys(HEADERLESS_ON_PURPOSE).filter((r) => !ROUTES.includes(r));
  assert.deepEqual(stale, [], "this file names a headerless route that no longer exists");

  const hit: string[] = [];
  for (const [route, why] of Object.entries(HEADERLESS_ON_PURPOSE)) {
    for (const rule of rules) {
      if (rule.regex.test(probePath(route))) hit.push(route + " picks up the rule for " + rule.source + " - " + why);
    }
  }
  assert.deepEqual(
    hit,
    [],
    "This is the `:path*` where `:path+` was meant, which next.config.ts records having been made once. " +
      "The route is noindex either way; what it loses is being fetchable by an agent that reads the header " +
      "and never the page.",
  );
  t.diagnostic(Object.keys(HEADERLESS_ON_PURPOSE).length + " headerless routes against " + rules.length + " rules, 0 collisions");
});

test("no robots.txt Disallow reaches a public route", (t) => {
  let body: string;
  try {
    body = readFileSync(join(BUILD_DIR, "server", "app", "robots.txt.body"), "utf8");
  } catch {
    return t.skip(NEEDS_BUILD);
  }
  const disallowed = [...new Set(disallowedPaths(body))];
  assert.ok(disallowed.length > 0, "robots.txt disallows nothing - the parse, not the file, is what changed");

  /**
   * A Disallow is a prefix match, which is the whole hazard. `/coverage-check/`
   * blocks the token pages and leaves the public form at `/coverage-check`
   * crawlable; `/coverage-check` without the slash blocks both, and the page
   * that goes is the one the business is trying to get found.
   */
  const hit: string[] = [];
  for (const route of PUBLIC) {
    for (const rule of disallowed) {
      if (probePath(route).startsWith(rule)) hit.push(route + " is blocked by Disallow: " + rule);
    }
  }
  assert.deepEqual(
    hit,
    [],
    "robots.txt blocks a page that is meant to be found. Check the trailing slash: a rule for a private subtree " +
      "needs one, or it takes the public page above it as well.",
  );
  t.diagnostic(disallowed.length + " Disallow rules, " + PUBLIC.length + " public routes, 0 collisions");
});

test("the Disallow probe fires on the shape that is wrong", () => {
  // Proving the prefix match is really a prefix match, on this file's own
  // worked example rather than on the shipped values.
  assert.ok("/coverage-check".startsWith("/coverage-check"), "a rule without its slash must take the public page");
  assert.ok(!"/coverage-check".startsWith("/coverage-check/"), "a rule with its slash must leave the public page alone");
  assert.ok(probePath("/coverage-check/[token]").startsWith("/coverage-check/"), "the token page must still be covered");
});

test("no page that is meant to be found renders a noindex", (t) => {
  const pages: Page[] = sweptPages();
  if (pages.length < 15) return t.skip(NEEDS_BUILD);

  /**
   * The rendered half, which catches what source cannot: a noindex arriving
   * from a layout, from `robots.ts`, or from anywhere other than the page's
   * own `metadata`. `privateRoutes()` reads source by design, because three of
   * the four cannot be rendered on this machine at all.
   */
  const publicRoutes = new Set(PUBLIC);
  const closed: string[] = [];
  let checked = 0;
  for (const p of pages) {
    const route = routeOf(p.page);
    if (!publicRoutes.has(route)) continue;
    checked++;
    if (/noindex/.test(headOf(p.html))) closed.push(route);
  }
  assert.ok(checked > 15, "only " + checked + " public pages matched a swept page - the route mapping has drifted");
  assert.deepEqual(closed, [], "this page is meant to be found and its own head tells a crawler not to index it");
  t.diagnostic(checked + " public pages rendered, 0 carrying noindex");
});
