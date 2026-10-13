import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { APP_PREFIX, SITE_ORIGIN, appHost, appHref, appOrigin, appPath, appUrl, internalPath, isAppHost, passesThrough, siteHref, siteHrefAt, siteOrigin, stripPrefix } from "./app-host.ts";

/**
 * M1 of docs/tracked-dashboard-2026-10-05-app/04-migration-brief.md
 * (Danny, 5 Oct 2026): the dashboard moves to app.alwayscited.com, behind an
 * env var, so the code can ship before the domain exists.
 *
 * The census at the foot is the part that keeps working after today. Every
 * path into the dashboard used to be written out as a literal in 34 files;
 * one left behind is a page that 404s on the new host, and nothing but a
 * sweep finds it.
 */

const OFF = {};
const ON = { APP_HOST: "app.alwayscited.com" };

test("unset is today's behaviour, exactly", () => {
  assert.equal(appHost(OFF), null);
  assert.equal(appPath("/login", false), "/app/login");
  assert.equal(appPath("", false), APP_PREFIX);
  assert.equal(appPath("/tallyroo/clusters", false), "/app/tallyroo/clusters");
  assert.equal(isAppHost("alwayscited.com", OFF), false);
  // With no host configured nothing is the app host, not even a blank one.
  assert.equal(isAppHost(null, OFF), false);
  assert.equal(isAppHost("", OFF), false);
});

test("set, the prefix comes off", () => {
  assert.equal(appHost(ON), "app.alwayscited.com");
  assert.equal(appPath("/login", true), "/login");
  assert.equal(appPath("", true), "/");
  assert.equal(appPath("/", true), "/");
  assert.equal(appPath("/tallyroo/clusters", true), "/tallyroo/clusters");
});

test("the host comparison is whole, lower-cased, and keeps the port", () => {
  assert.equal(isAppHost("app.alwayscited.com", ON), true);
  assert.equal(isAppHost("APP.ALWAYSCITED.COM", ON), true);
  assert.equal(isAppHost("  app.alwayscited.com ", ON), true);
  assert.equal(isAppHost("alwayscited.com", ON), false);
  // Not a suffix match: a host that merely ends with the configured one is a
  // different host, and treating it as the dashboard would hand it the cookie.
  assert.equal(isAppHost("evil-app.alwayscited.com", ON), false);
  assert.equal(isAppHost("app.alwayscited.com.example.net", ON), false);
  // Development uses a port, which is part of the header and part of the value.
  assert.equal(isAppHost("app.localhost:3100", { APP_HOST: "app.localhost:3100" }), true);
  assert.equal(isAppHost("app.localhost", { APP_HOST: "app.localhost:3100" }), false);
});

test("a path arriving on the app host renders the route it always did", () => {
  assert.equal(internalPath("/tallyroo"), "/app/tallyroo");
  assert.equal(internalPath("/tallyroo/clusters"), "/app/tallyroo/clusters");
  assert.equal(internalPath("/"), "/app");
  assert.equal(internalPath("/login"), "/app/login");
});

test("assets, the API and the crawl files are never rewritten", () => {
  for (const p of ["/_next/static/chunk.js", "/api/app/login", "/robots.txt", "/sitemap.xml", "/favicon.ico", "/icon.png"]) {
    assert.equal(passesThrough(p), true, p);
    assert.equal(internalPath(p), p, p);
  }
  for (const p of ["/tallyroo", "/login", "/"]) assert.equal(passesThrough(p), false, p);
});

test("an address carrying the old prefix is recognised, so it can be sent on", () => {
  assert.equal(stripPrefix("/app"), "/");
  assert.equal(stripPrefix("/app/tallyroo"), "/tallyroo");
  assert.equal(stripPrefix("/app/tallyroo/clusters"), "/tallyroo/clusters");
  assert.equal(stripPrefix("/tallyroo"), null);
  // Not a prefix match on the string: /application is not the dashboard.
  assert.equal(stripPrefix("/application"), null);
});

test("an emailed link points at whichever host the dashboard is on", () => {
  assert.equal(appUrl("/auth", "https://alwayscited.com", OFF), "https://alwayscited.com/app/auth");
  assert.equal(appUrl("/auth", "https://alwayscited.com", ON), "https://app.alwayscited.com/auth");
  assert.equal(appUrl("", "https://alwayscited.com/", ON), "https://app.alwayscited.com/");
  assert.equal(appOrigin("https://alwayscited.com", OFF), "https://alwayscited.com");
  assert.equal(appOrigin("https://alwayscited.com", ON), "https://app.alwayscited.com");
  // A development host is http, or the link cannot be opened at all.
  assert.equal(appUrl("/auth", "http://localhost:3100", { APP_HOST: "app.localhost:3100" }), "http://app.localhost:3100/auth");
});

/**
 * The site header's "Log in" (Danny, 13 Oct 2026): relative on the shared
 * host, the app host's own /login once APP_HOST is set, with no code change
 * between the two. Never the bare "/login" on the marketing host, which is no
 * route there.
 */
test("a link from the site into the dashboard is relative until the dashboard has its own host", () => {
  assert.equal(appHref("/login", OFF), "/app/login");
  assert.equal(appHref("/login", ON), "https://app.alwayscited.com/login");
  assert.equal(appHref("/login", { APP_HOST: "app.localhost:3700" }), "http://app.localhost:3700/login");
  assert.equal(appHref("", OFF), APP_PREFIX);
  assert.equal(appHref("", ON), "https://app.alwayscited.com/");
});

test("the header is handed its Log in link by the server, never decides it in the browser", () => {
  const layout = readFileSync(join(process.cwd(), "src", "app", "layout.tsx"), "utf8");
  assert.match(layout, /<Header loginHref=\{appHref\("\/login"\)\} \/>/, "the root layout passes appHref(\"/login\")");
  const header = readFileSync(join(process.cwd(), "src", "components", "Header.tsx"), "utf8");
  // The header is a client component: APP_HOST is empty there, so any helper
  // that reads it would give the server's render one href and hydration another.
  assert.match(header, /^"use client";/);
  const headerCode = header.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
  assert.doesNotMatch(headerCode, /from "@\/lib\/app-host"|APP_HOST/, "the header reads no host itself");
  // `=>` allowed inside the tag: the menu's link closes the menu on click.
  const logins = [...header.matchAll(/<a href=\{loginHref\}(?:=>|[^>])*>\s*\{LOG_IN\}\s*<\/a>/g)];
  assert.equal(logins.length, 2, "Log in on the bar and in the phone menu");
  assert.match(header, /const LOG_IN = "Log in";/);
});

/* ------------------------------------------------------------------ */

const SRC = join(process.cwd(), "src");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !name.endsWith(".test.mts")) out.push(full);
  }
  return out;
}

/**
 * Where a literal dashboard path may still be written.
 *
 * Each of these is a reason, not an exemption to be grown. app-host.ts owns
 * the prefix; SiteChrome asks whether a path on the marketing host is the
 * dashboard, which is the one place the literal is the question; next-path
 * accepts both spellings on purpose, because a `next` value may have been
 * minted under either.
 */
const MAY_WRITE_THE_PREFIX = new Set([
  "src/lib/app-host.ts",
  "src/components/SiteChrome.tsx",
  "src/lib/tracking/next-path.ts",
  // robots.ts closes `/app` on the marketing host, which is a crawl rule about
  // that host's own paths and stays true whether or not the dashboard has moved.
  "src/app/robots.ts",
]);

/**
 * A quoted path that starts with the prefix, and - 8 Oct 2026 - the same
 * prefix after a template expression: `${siteUrl()}/app/auth` in signup.ts and
 * `${ORIGIN}/app/login` in lifecycle.ts were missed by the first pattern, which
 * only looked for the prefix straight after a quote.
 */
const HAND_WRITTEN = [/["'`]\/app(\/|["'`])/, /\}\/app(\/|[`?#])/];

test("the sweep sees a hand-written prefix in either spelling", () => {
  const probes = ['const a = "/app/x";', "const b = `${siteUrl()}/app/auth?token=${token}`;", "link: `${ORIGIN}/app`", "link: `${ORIGIN}/app/login`"];
  for (const p of probes) assert.ok(HAND_WRITTEN.some((re) => re.test(p)), p);
  for (const p of ['appUrl("/auth", ORIGIN)', "`${base}/application`", 'const c = "/api/app/login";']) assert.ok(!HAND_WRITTEN.some((re) => re.test(p)), p);
});

/** A line of code, not a sentence about one: comments and doc blocks are not paths. */
function codeLines(text: string): string[] {
  return text
    .split("\n")
    .filter((l) => {
      const t = l.trim();
      return t && !t.startsWith("*") && !t.startsWith("//") && !t.startsWith("/*");
    });
}

test("no file writes a dashboard path by hand", () => {
  const offenders: string[] = [];
  for (const file of walk(SRC)) {
    const rel = file.slice(process.cwd().length + 1);
    if (MAY_WRITE_THE_PREFIX.has(rel)) continue;
    for (const line of codeLines(readFileSync(file, "utf8"))) {
      if (HAND_WRITTEN.some((re) => re.test(line))) offenders.push(`${rel}: ${line.trim().slice(0, 120)}`);
    }
  }
  assert.deepEqual(offenders, [], `use appPath() from src/lib/app-host.ts:\n${offenders.join("\n")}`);
});

/**
 * The floor, so that a sweep which stops matching cannot report a clean tree.
 * 26 files were converted off their literals on 6 Oct 2026; the number only
 * goes up as pages are added, and down only when one is deleted on purpose.
 */
test("the dashboard's paths go through the helper, and there are plenty of them", () => {
  let callers = 0;
  for (const file of walk(SRC)) {
    const rel = file.slice(process.cwd().length + 1);
    if (rel === "src/lib/app-host.ts") continue;
    if (/\bappPath\s*\(/.test(readFileSync(file, "utf8"))) callers += 1;
  }
  assert.ok(callers >= 24, `only ${callers} files call appPath(); 24 is the recorded floor`);
});

/* ------------------------------------------------------------------ */

/**
 * Audit ia-2 (8 Oct 2026): on app.localhost every upgrade, pack and contact
 * link in the dashboard - the plan card's "Add 5 clusters", Clusters' "Get
 * cited", the Add panel's pack, setup's "Book a call", the error page's "Tell
 * us here" - was a relative marketing path. The proxy rewrites every path on
 * the app host into /app, so each one answered the dashboard's 404.
 */
test("a marketing link stays relative on the shared host and leaves the app host for the site", () => {
  assert.equal(siteHref("/contact?tier=alwaystracked", OFF), "/contact?tier=alwaystracked");
  assert.equal(siteHref("/alwayscited?from=app", ON), `${SITE_ORIGIN}/alwayscited?from=app`);
  // Development: the same server under the app. label, so the e2e run can follow it.
  assert.equal(siteHref("/contact", { APP_HOST: "app.localhost:3108" }), "http://localhost:3108/contact");
  assert.equal(siteOrigin("app.localhost:3108"), "http://localhost:3108");
  assert.equal(siteOrigin("app.alwayscited.com"), SITE_ORIGIN);
});

test("a client component decides from the address it was served at", () => {
  // Under /app is the main host, where the site is the same origin.
  assert.equal(siteHrefAt("/contact", { pathname: "/app/tallyroo", host: "alwayscited.com" }), "/contact");
  assert.equal(siteHrefAt("/contact", { pathname: "/app", host: "localhost:3108" }), "/contact");
  assert.equal(siteHrefAt("/contact", { pathname: "/tallyroo", host: "app.alwayscited.com" }), `${SITE_ORIGIN}/contact`);
  assert.equal(siteHrefAt("/contact", { pathname: "/tallyroo/clusters", host: "app.localhost:3108" }), "http://localhost:3108/contact");
  // Not a prefix match on the string: /application is not the dashboard on the main host.
  assert.equal(siteHrefAt("/contact", { pathname: "/application", host: "app.localhost:3108" }), "http://localhost:3108/contact");
});

/** Where a dashboard page's links are written. */
const DASHBOARD = [join(SRC, "components", "app"), join(SRC, "app", "app")];

/**
 * A marketing page reached from the dashboard. contactUrlFor and CONTACT_URL
 * are /contact, a tier's href is its tier page, orderUrlFor is /checkout: none
 * of them is a dashboard route, so each has to go through siteHref.
 */
const MARKETING_SOURCE = /\bcontactUrlFor\(|\bCONTACT_URL\b|\btier\.href\b|\bTIERS\b[^;]*\.href\b|\borderUrlFor\(/;
/** A root-relative path written straight into an href: the dashboard's own go through appPath. */
const LITERAL_HREF = /\bhref=(?:"|\{\s*["'`])\/(?!\/|api\/)/;
const WRAPPED = /\bsiteHref(?:At)?\(/;

function marketingOffenders(line: string): boolean {
  if (/^\s*import\b/.test(line)) return false;
  return (MARKETING_SOURCE.test(line) && !WRAPPED.test(line)) || LITERAL_HREF.test(line);
}

test("the sweep sees an unwrapped marketing link in each spelling", () => {
  for (const p of [
    "<a href={contactUrlFor(tier)} style={x}>",
    "packHref={upgrade ? contactUrlFor(upgrade.tier) : CONTACT_URL}",
    "<Link href={`${tier.href}?from=app`}>",
    '<Link href="/contact" style={{ color: T.accent }}>Tell us here</Link>',
    "<a href={'/pricing'}>",
  ]) assert.ok(marketingOffenders(p), p);
  for (const p of [
    "<a href={siteHref(contactUrlFor(tier))} style={x}>",
    "<Link href={siteHref(`${tier.href}?from=app`)}>",
    'useEffect(() => setContact(siteHrefAt("/contact", window.location)), []);',
    'import { CONTACT_URL, contactUrlFor } from "@/config/pricing";',
    '<form method="post" action="/api/app/logout">',
    "<a href={appPath(`/${c.slug}`)}>",
    '<a href="#app-content">',
    "<a href={`mailto:${CONTACT_EMAIL}`}>",
  ]) assert.ok(!marketingOffenders(p), p);
});

/**
 * The floor: 6 call sites on 8 Oct 2026 - the plan card (Sidebar), the Add
 * panel's pack (Clusters), the tier button (UpgradePrompt), setup's Book a
 * call, login's See the plan and the error page's Tell us here - and 4 lines
 * that build a marketing href from pricing.ts. A walk that stops matching finds
 * neither, and would otherwise report a clean dashboard.
 */
test("every dashboard link to the marketing site goes through siteHref", () => {
  const offenders: string[] = [];
  let sources = 0;
  let wrapped = 0;
  for (const file of DASHBOARD.flatMap((d) => walk(d))) {
    const rel = file.slice(process.cwd().length + 1);
    for (const line of codeLines(readFileSync(file, "utf8"))) {
      if (marketingOffenders(line)) offenders.push(`${rel}: ${line.trim().slice(0, 140)}`);
      if (MARKETING_SOURCE.test(line) && !/^\s*import\b/.test(line)) sources += 1;
      if (WRAPPED.test(line) && !/^\s*import\b/.test(line)) wrapped += 1;
    }
  }
  assert.deepEqual(offenders, [], `a marketing link that 404s on the app host - wrap it in siteHref() from src/lib/app-host.ts:\n${offenders.join("\n")}`);
  assert.ok(sources >= 4, `only ${sources} marketing hrefs found in the dashboard; 4 is the recorded floor`);
  assert.ok(wrapped >= 6, `only ${wrapped} siteHref() call sites in the dashboard; 6 is the recorded floor`);
});
