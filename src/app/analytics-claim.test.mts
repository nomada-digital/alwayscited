import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

/**
 * The privacy policy makes a claim about this code, and this is the code.
 *
 * `/legal` tells anyone who reads it: "This site sets no cookies of its own and
 * runs no analytics - there is no Google Analytics, no tag manager, and no
 * advertising pixel." AGENTS.md is explicit that a statement about what we do
 * is not covered by "ship it rough", and the page's own header lists that
 * sentence among the facts "I checked in the code rather than one the board
 * asserted". It was checked once, by reading, in the way this queue keeps
 * recording as the thing that rots: true when typed, unfalsifiable afterwards.
 *
 * ## What is actually load-bearing, which is not the absence of code
 *
 * Two components call `track()`, which pushes to `window.dataLayer` - the
 * Google Tag Manager data layer. The claim survives that because the push is
 * guarded on a container that already exists: with no GTM snippet on the page,
 * `window.dataLayer` is undefined, the guard is false, and nothing is recorded
 * or queued. So the sentence is true by one `Array.isArray` and a missing
 * script tag, and neither was held by anything.
 *
 * Three ways it could quietly stop being true, and this file is each of them:
 *
 *   1. somebody loads an analytics or tag-manager script. `route-closure`
 *      would make them add the origin to the CSP and then pass - it asks
 *      whether an origin is *allowed*, never whether it should be there;
 *   2. somebody "tidies" the guard to `(w.dataLayer ||= []).push(...)`, the
 *      ordinary idiom, which buffers events for a container that has not
 *      arrived. That turns a no-op into a recording;
 *   3. somebody writes a third `track` somewhere else without the guard - and
 *      there were two byte-identical copies of it until 20 September 2026.
 *
 * ## What this does NOT decide
 *
 * Whether shipping dormant tag-manager instrumentation at all is compatible
 * with the sentence is a judgement about published copy, which is Danny's.
 * This file only holds the state as it is: if the answer is "take it out", the
 * `DATALAYER_WRITERS` list goes empty and these tests still pass.
 *
 * ## 15 Oct 2026, Danny approved GA4 with a consent banner in chat
 *
 * He made that call: full GA4, behind a cookie banner, on the marketing site.
 * The sentence above is gone from /legal and the promise is now narrower and
 * just as checkable - Google Analytics only after a yes, never on the
 * dashboard, never a scanned domain or anything typed into a form. Every rule
 * below was rewritten against that promise rather than deleted, and the three
 * ways it can quietly stop being true have the same shape as before:
 *
 *   1. an analytics script loaded from anywhere but the consent banner, or a
 *      vendor other than Google loaded at all;
 *   2. something pushed onto the data layer before the visitor said yes - the
 *      denied consent default must be the first entry, and track() a no-op
 *      until consent is granted;
 *   3. a second data-layer owner, or an event that carries a domain, an email
 *      address or a topic out of the page.
 */

const HERE = fileURLToPath(import.meta.url);
const ROOT = join(HERE, "..", "..", "..");
const SRC = join(ROOT, "src");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const child = join(dir, entry.name);
    if (entry.isDirectory()) walk(child, out);
    else if (/\.tsx?$/.test(entry.name) && !entry.name.includes(".test.")) out.push(child);
  }
  return out;
}

const posix = (f: string) => relative(ROOT, f).split(sep).join("/");

/** Comments stripped, the way every sweep in this tree does it. */
const code = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

/**
 * Comments *and* string contents stripped, for the rules that ask whether the
 * code does something rather than whether a URL appears in it.
 *
 * Load-bearing and measured: the first draft matched `\bdataLayer\b` over
 * stripped comments only and reported `TierJourney.tsx` as a data layer writer.
 * It is a services list - "Tracking and analytics: GA4 and dataLayer, set up
 * properly" - which is the agency selling the thing this site does not do to
 * itself. A rule that cannot tell a sales line from a write would have been
 * "fixed" by exempting the file, and the exemption would have covered any real
 * write added to it later.
 */
const bare = (src: string) => code(src).replace(/(["'`])(?:\\.|(?!\1).)*\1/g, '""');

const FILES = walk(SRC).map((f) => ({ file: posix(f), source: readFileSync(f, "utf8") }));

const LEGAL = join(SRC, "app/legal/page.tsx");

/**
 * The sentence, as a set of phrases rather than one string, so reflowing the
 * JSX does not fail this and rewording it does.
 *
 * 30 Sep 2026 (R98, BRIEF-2 T10): "runs no analytics" became "runs no
 * third-party analytics", because the /app dashboard now counts its own
 * feature use (src/lib/tracking/usage.ts, first-party rows in
 * dashboard_events, ids and counts only), and /legal says so. The rules below
 * guard third-party scripts and the data layer; none of that moved.
 */
const CLAIM_BEFORE_15_OCT = ["runs no third-party analytics", "no tag manager", "no advertising pixel", "feature counts"];

/**
 * 15 Oct 2026, Danny approved GA4 with a consent banner in chat. The claim is
 * now what GA does and does not get, and each phrase is one a rule below holds:
 * "not loaded at all until you accept" (the consent rules and the loader),
 * "never sees ... the domains you scan" (the event-parameter rule), "never
 * loaded on the client dashboard" (the dashboard rules and the served CSP).
 * The old phrases are kept above so that one coming back reads as a reversal.
 */
const CLAIM = [
  "not loaded at all until you accept the cookie banner",
  "never sees what you type into a form or the domains you scan",
  "never loaded on the client dashboard",
  "no advertising pixel",
  "feature counts",
];

test("the claim this file exists to hold is still on the page", () => {
  const legal = readFileSync(LEGAL, "utf8").replace(/\s+/g, " ");
  for (const phrase of CLAIM) {
    assert.ok(
      legal.includes(phrase),
      `/legal no longer says "${phrase}". If the claim was deliberately changed, change the rules below to match it - do not delete them, because the code they guard has not moved.`,
    );
  }
  // The old promise is false now, so it must not be on the page either.
  for (const phrase of CLAIM_BEFORE_15_OCT.slice(0, 2)) {
    assert.ok(!legal.includes(phrase), `/legal still says "${phrase}", and the site now loads Google Analytics after a yes`);
  }
});

test("the file walk read the tree, so a zero below cannot pass as a clean sweep", () => {
  assert.ok(FILES.length >= 100, `the walk found only ${FILES.length} source files`);
  assert.ok(
    FILES.some((f) => f.file === "src/lib/analytics.ts"),
    "the walk cannot see lib/analytics.ts, which is the file every rule below is about",
  );
});

/**
 * Vendors whose script on the page would make the sentence false. Matched as
 * hostnames against off-origin URLs, not as bare words, so a page that
 * *mentions* Google Analytics in copy - `/legal` does, and TierJourney sells
 * GA4 setup as a service - is not a hit. That distinction is the whole reason
 * this is a URL check and not a grep.
 */
const ANALYTICS_HOSTS = [
  "googletagmanager.com",
  "google-analytics.com",
  "analytics.google.com",
  "connect.facebook.net",
  "static.ads-twitter.com",
  "snap.licdn.com",
  "plausible.io",
  "cdn.segment.com",
  "cdn.amplitude.com",
  "static.hotjar.com",
  "posthog.com",
  "matomo.cloud",
  "cdn.mxpnl.com",
];

/**
 * The Google hosts GA4 uses, and the only files allowed to name them, with the
 * argument for each (15 Oct 2026, Danny approved GA4 with a consent banner in
 * chat). Every other vendor in ANALYTICS_HOSTS stays banned from every file.
 * `analytics.google.com` is not on the allowed list: it is GA's own console,
 * which nothing on a page needs.
 */
const GA_HOSTS = ["googletagmanager.com", "google-analytics.com"];
const GA_HOST_FILES: Record<string, string> = {
  "src/components/ConsentBanner.tsx":
    "loads gtag.js from www.googletagmanager.com, only after a yes and only with a real measurement id, and names the two hosts gtag.js sends to so route-closure can match the CSP",
  "src/lib/checkout/ga4.ts":
    "the server-side purchase: one Measurement Protocol POST from the Stripe webhook, with no email, domain or keyword in it",
};

const isGa = (host: string) => GA_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));

test("no file loads an analytics, tag manager or pixel script, but the consent banner's GA4 and the webhook's purchase", () => {
  const hits: string[] = [];
  const gaSeen = new Set<string>();
  for (const { file, source } of FILES) {
    for (const m of code(source).matchAll(/https?:\/\/([a-z0-9.-]+)/gi)) {
      const host = m[1].toLowerCase();
      if (!ANALYTICS_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) continue;
      if (isGa(host) && file in GA_HOST_FILES) {
        gaSeen.add(file);
        continue;
      }
      hits.push(`${file}  ${host}`);
    }
  }
  assert.deepEqual(
    hits,
    [],
    "these load an analytics script from somewhere other than the consent banner, or a vendor /legal does not name. /legal promises Google Analytics only after a yes, through one door. Adding the origin to the CSP satisfies route-closure and does not satisfy the privacy policy.",
  );
  // Each allowance is still used: a stale entry is a hole waiting for a file.
  assert.deepEqual([...gaSeen].sort(), Object.keys(GA_HOST_FILES).sort(), "an allowed GA file no longer names a GA host - take it off GA_HOST_FILES");
  for (const [file, why] of Object.entries(GA_HOST_FILES)) assert.ok(why.length > 40, `${file} is allowed to reach GA with no argument for it`);
});

/**
 * The one module allowed to touch the data layer. A list rather than a single
 * name because the honest shape of this rule is "these, and argue for a
 * fourth" - and because it has to be able to go empty if the instrumentation
 * comes out.
 */
const DATALAYER_WRITERS = ["src/lib/analytics.ts"];

test("only one module touches the data layer", () => {
  const writers = FILES.filter(({ source }) => /\bdataLayer\b/.test(bare(source))).map((f) => f.file);
  assert.deepEqual(
    writers.sort(),
    [...DATALAYER_WRITERS].sort(),
    "a dataLayer write outside lib/analytics.ts. That module's consent gate is what makes the privacy policy true; a second copy without it is a site that collects before anyone said yes. There were two identical copies of it before 20 September 2026.",
  );
});

/**
 * The consent gate, read out of the source.
 *
 * Structural rather than behavioural on purpose, and the reason is the one
 * `constant-time.test.mts` records: the property is "nothing is buffered
 * before a yes", and a module that buffers returns exactly what one that does
 * not returns - `undefined`, both times. What differs is what is on the data
 * layer, and the order it got there, and that is visible in the source.
 *
 * Until 15 Oct 2026 this test held the opposite rule - that track() never
 * created the data layer, only pushed into one a container had made - because
 * /legal promised no analytics at all. Danny approved GA4 with a consent
 * banner in chat that day. The data layer is now created, once, by the consent
 * module, and the rule is about what may be on it and when.
 */
const ANALYTICS = code(readFileSync(join(SRC, "lib/analytics.ts"), "utf8"));
const BANNER = code(readFileSync(join(SRC, "components/ConsentBanner.tsx"), "utf8"));

/** The body of a top-level function in a stripped source, by name. */
function body(src: string, name: string): string {
  const at = src.search(new RegExp(`function\\s+${name}\\s*\\(`));
  assert.ok(at >= 0, `${name} is not where this rule expected to find it`);
  const open = src.indexOf("{", src.indexOf(")", at));
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(open, i + 1);
  }
  return src.slice(open);
}

test("the data layer is created once, by initConsent, and its first entry is the denied default", () => {
  const creates = [...ANALYTICS.matchAll(/\bdataLayer\s*=/g)];
  assert.equal(creates.length, 1, "the data layer is assigned in more than one place, or in none");
  const init = body(ANALYTICS, "initConsent");
  assert.match(init, /w\.dataLayer\s*=\s*w\.dataLayer\s*\|\|\s*\[\];\s*gtag\(\s*"consent"\s*,\s*"default"\s*,\s*DENIED\s*\)/, "initConsent no longer puts the denied consent default on the data layer straight after creating it");
  assert.match(init, /onDashboard\(\)\)\s*return false/, "initConsent no longer refuses the dashboard");
  // One push site, gtag's own: nothing else reaches the array.
  assert.equal([...ANALYTICS.matchAll(/dataLayer!?\.push\(/g)].length, 1, "a second push onto the data layer");
  const denied = ANALYTICS.match(/const DENIED = \{([^}]*)\}/)?.[1] ?? "";
  for (const signal of ["analytics_storage", "ad_storage", "ad_user_data", "ad_personalization"]) {
    assert.match(denied, new RegExp(`${signal}: "denied"`), `the consent default does not deny ${signal}`);
  }
  // /legal: "Its advertising signals are switched off". A yes grants analytics only.
  assert.match(ANALYTICS, /const GRANTED = \{ \.\.\.DENIED, analytics_storage: "granted" \}/, "a yes grants more than analytics storage");
});

test("track() sends nothing before a yes and nothing on the dashboard", () => {
  const t = body(ANALYTICS, "track");
  assert.match(t, /if \(!granted \|\| onDashboard\(\)\) return;/, "track() no longer returns before a yes, or on the dashboard");
  assert.ok(t.indexOf("return;") < t.indexOf("gtag("), "track() reaches the data layer before its consent check");
  // `granted` is set in one place, grantConsent, after initConsent has run.
  assert.equal([...ANALYTICS.matchAll(/\bgranted = true\b/g)].length, 1);
  assert.match(body(ANALYTICS, "grantConsent"), /if \(!ready \|\| granted\) return false;\s*granted = true;/);
});

test("gtag.js is requested only after a yes, and only with a real measurement id", () => {
  const grant = body(ANALYTICS, "grantConsent");
  assert.ok(
    grant.indexOf("if (!gaIdValid()) return false;") > -1 && grant.indexOf("if (!gaIdValid()) return false;") < grant.lastIndexOf("return true;"),
    "grantConsent can answer true without a valid measurement id, so the placeholder would load gtag.js",
  );
  const calls = [...BANNER.matchAll(/\bloadGtag\(\)/g)].length;
  const gated = [...BANNER.matchAll(/if \(grantConsent\((?:true|false)\)\) loadGtag\(\);/g)].length;
  assert.ok(calls >= 3, `the loader is called ${calls - 1} times - the walk has gone blind`);
  // Every call but the declaration sits behind grantConsent's true.
  assert.equal(gated, calls - 1, "loadGtag() is called somewhere grantConsent did not say yes");
  assert.ok(!/<script|next\/script/.test(BANNER), "gtag.js is loaded some other way than by the gated loader");
});

/**
 * What an event may carry. /legal: GA "never sees what you type into a form or
 * the domains you scan". LiveScanChecker sent `{ domain }` until 15 Oct 2026
 * and ScanFlow sent the confirmed topic; both are gone, and this keeps them
 * gone. Read from every track() call in the tree, with a floor, so a walk
 * that stops matching cannot pass as a clean one.
 */
const FORBIDDEN_PARAMS = ["domain", "email", "topic", "keyword", "website", "name", "message", "company", "brand", "url", "token"];

/** Each track() call in one source: the event and the keys of its params object. */
function trackKeys(source: string): { event: string; keys: string[] }[] {
  return [...code(source).matchAll(/\btrack\(\s*"([a-z_]+)"\s*(?:,\s*\{([^}]*)\})?/g)].map((m) => ({
    event: m[1]!,
    keys: (m[2] ?? "")
      .split(",")
      .map((k) => k.trim().split(/[:\s]/)[0]!.trim())
      .filter(Boolean),
  }));
}

function trackCalls(): { file: string; event: string; keys: string[] }[] {
  return FILES.filter(({ file }) => file !== "src/lib/analytics.ts").flatMap(({ file, source }) => trackKeys(source).map((c) => ({ file, ...c })));
}

test("no event carries a domain, an address or anything typed", () => {
  const calls = trackCalls();
  assert.ok(calls.length >= 14, `only ${calls.length} track() calls found - the walk has gone blind`);
  const bad = calls.flatMap((c) => c.keys.filter((k) => FORBIDDEN_PARAMS.includes(k)).map((k) => `${c.file}  ${c.event}.${k}`));
  assert.deepEqual(bad, [], "an event carries something /legal says GA never sees");
});

test("the dashboard does not reach the banner or track()", () => {
  // 17 Oct 2026: the dashboards host's tree and components too.
  const dash = FILES.filter(({ file }) => ["src/app/app/", "src/components/app/", "src/app/admin/", "src/app/dashboards/", "src/components/dash/", "src/lib/dash/"].some((d) => file.startsWith(d)));
  assert.ok(dash.length >= 40, `the dashboard walk found only ${dash.length} files`);
  const hits = dash.filter(({ source }) => /from\s+["'](?:@\/lib\/analytics|@\/components\/ConsentBanner)["']/.test(code(source))).map((f) => f.file);
  assert.deepEqual(hits, [], "a dashboard file imports the analytics module or the banner. /legal: GA is never loaded on the client dashboard.");
});

test("the measurement id is the real property's, and a placeholder would be inert", async () => {
  const { GA_ID_PATTERN, GA_MEASUREMENT_ID, gaSafeUrl } = await import("../config/analytics.ts");
  // 17 Oct 2026: Danny set the property - G-JRTF9CFF18 - so gtag.js loads after a yes.
  assert.equal(GA_MEASUREMENT_ID, "G-JRTF9CFF18");
  assert.equal(GA_ID_PATTERN.test(GA_MEASUREMENT_ID), true, "the real id would not load gtag.js");
  assert.equal(GA_ID_PATTERN.test("G-PENDING_SETUP"), false, "the old placeholder would load gtag.js");
  assert.equal(GA_ID_PATTERN.test("G-ABC123XYZ9"), true);
  assert.equal(typeof GA_MEASUREMENT_ID, "string");
  // What GA may see of a URL: no scan token, no scanned domain, no session id;
  // the campaign parameters survive.
  assert.equal(gaSafeUrl("https://alwayscited.com/scan/0123456789abcdef0123456789abcdef"), "https://alwayscited.com/scan/:token");
  assert.equal(gaSafeUrl("https://alwayscited.com/scan?domain=acme.com&utm_source=x"), "https://alwayscited.com/scan?utm_source=x");
  assert.equal(gaSafeUrl("https://alwayscited.com/checkout/done?session=cs_live_123&plan=cited"), "https://alwayscited.com/checkout/done");
  assert.equal(gaSafeUrl("https://alwayscited.com/blog/ai-visibility-2026"), "https://alwayscited.com/blog/ai-visibility-2026", "a hyphenated slug is not a token");
});

test("the served CSP lets GA in on the site and keeps it out of the dashboard", (t) => {
  const manifestFile = join(ROOT, ".next", "routes-manifest.json");
  if (!existsSync(manifestFile)) {
    t.skip("no build to read - run `npm run build`");
    return;
  }
  const manifest = JSON.parse(readFileSync(manifestFile, "utf8")) as { headers: { source: string; headers: { key: string; value: string }[] }[] };
  const cspOf = (source: string) =>
    manifest.headers.filter((r) => r.source === source).flatMap((r) => r.headers).find((h) => h.key.toLowerCase() === "content-security-policy")?.value;
  const site = cspOf("/:path*");
  assert.ok(site && /default-src 'self'/.test(site), "no site-wide CSP in the build manifest");
  for (const origin of ["https://www.googletagmanager.com", "https://www.google-analytics.com", "https://region1.google-analytics.com"]) {
    assert.ok(site!.includes(origin), `the site's CSP does not permit ${origin}, so GA4 would be blocked after a yes`);
  }
  for (const source of ["/app/:path*", "/admin/:path*", "/dashboards/:path*"]) {
    const dash = cspOf(source);
    assert.ok(dash && /default-src 'self'/.test(dash), `${source} has no CSP of its own, so it inherits the site's and GA's origins with it`);
    assert.ok(!/google/.test(dash!), `${source}'s CSP permits a Google origin`);
  }
  // 17 Oct 2026: dashboards.alwayscited.com - every path, /demo/ links included - gets its own GA-free policy by host.
  type Rule = { source: string; has?: { type: string; value: string }[]; headers: { key: string; value: string }[] };
  const hostRule = (manifest.headers as Rule[]).find((r) => r.has?.some((h) => h.type === "host" && /dashboards\\?\.alwayscited/.test(h.value)));
  const hostCsp = hostRule?.headers.find((h) => h.key.toLowerCase() === "content-security-policy")?.value;
  assert.ok(hostCsp && /default-src 'self'/.test(hostCsp), "the dashboards host has no CSP of its own");
  assert.ok(!/google/.test(hostCsp!), "the dashboards host's CSP permits a Google origin");
});

test("the dashboards host and its tree are the dashboard to the banner and track(), whatever the path", async () => {
  const { isDashboardHost, isDashboardPath } = await import("../config/analytics.ts");
  for (const host of ["dashboards.alwayscited.com", "dashboards.localhost:3215"]) assert.equal(isDashboardHost(host), true, host);
  for (const host of ["alwayscited.com", "www.alwayscited.com"]) assert.equal(isDashboardHost(host), false, host);
  for (const p of ["/dashboards", "/dashboards/acme-com", "/app/acme-com", "/admin"]) assert.equal(isDashboardPath(p), true, p);
  for (const p of ["/", "/dashboardsx", "/demo/abc", "/blog"]) assert.equal(isDashboardPath(p), false, `${p} is the site's on the marketing host`);
  const lib = code(readFileSync(join(ROOT, "src", "lib", "analytics.ts"), "utf8"));
  const on = lib.slice(lib.indexOf("export function onDashboard("), lib.indexOf("export function readConsent("));
  assert.match(on, /isDashboardHost\(window\.location\.host\)/, "onDashboard no longer asks the host");
  assert.match(on, /\[data-dash-tree\]/, "onDashboard no longer sees the dashboards layout's marker");
});

test("the rules can still tell the thing they forbid from the thing they allow", () => {
  // Proven in both directions against written instances, because four of this
  // repo's tripwires have passed by being blind.
  const host = (src: string) =>
    [...code(src).matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].some((m) =>
      ANALYTICS_HOSTS.some((h) => m[1].toLowerCase() === h || m[1].toLowerCase().endsWith(`.${h}`)),
    );
  assert.equal(host('const S = "https://www.googletagmanager.com/gtm.js?id=X";'), true);
  assert.equal(isGa("www.googletagmanager.com"), true, "a GA host is told apart from the other vendors");
  assert.equal(isGa("connect.facebook.net"), false);
  assert.equal(isGa("analytics.google.com"), false, "GA's console is not a host a page needs");
  assert.equal(host('<p>there is no Google Analytics, no tag manager</p>'), false, "prose naming a vendor is not a script");
  assert.equal(host('note: "GA4 and dataLayer, set up properly"'), false, "a service we sell is not a script we load");
  assert.equal(host('const T = "https://challenges.cloudflare.com/turnstile/v0/api.js";'), false);
  // And that the comment strip does not excuse a real one.
  assert.equal(host('// https://www.google-analytics.com/analytics.js'), false, "a commented-out script is not loaded");

  // The data layer rule, both ways. The false case is the live one:
  // TierJourney sells GA4 setup and named `dataLayer` in a services list.
  const writes = (src: string) => /\bdataLayer\b/.test(bare(src));
  assert.equal(writes("if (Array.isArray(w.dataLayer)) w.dataLayer.push(x);"), true);
  assert.equal(writes("w.dataLayer = w.dataLayer || [];"), true);

  // The event-parameter rule, both ways: the shape LiveScanChecker had until
  // 15 Oct 2026 is caught, shorthand included, and what it sends now is not.
  const keys = (src: string) => trackKeys(src).flatMap((c) => c.keys);
  assert.deepEqual(keys('track("scan_started", { domain });'), ["domain"]);
  assert.deepEqual(keys('track("scan_confirmed", { topic: input.topic, market: input.market });'), ["topic", "market"]);
  assert.deepEqual(keys('track("free_scan_start", { market: m, cta_location: box ? "card" : "hero" });'), ["market", "cta_location"]);
  assert.deepEqual(keys('// track("x", { domain })'), [], "a comment is not a call");
  assert.equal(writes('{ name: "Tracking and analytics", note: "GA4 and dataLayer, set up properly" }'), false);
  assert.equal(writes("/** pushes to window.dataLayer when a container exists */"), false, "prose about it is not a write");
});
