import assert from "node:assert/strict";
import { test } from "node:test";

import { enteredUrl, homepageCandidates, isPlausibleDomain, normalizeDomain } from "./domain.ts";

/**
 * The first real check in this repo, and it is here rather than anywhere else
 * because `normalizeDomain` is the one function whose failure is silent all
 * the way down.
 *
 * 2ca695a: userinfo was stripped before the path, query and fragment were cut.
 * Userinfo is "everything up to an @ containing no /", and a query string is
 * allowed to contain an @, so `https://example.com?email=me@other.com`
 * normalised to `other.com`. Nothing errored. `isPlausibleDomain` says yes to
 * `other.com`, so the scan ran, was billed, and returned a report headed with
 * a company the visitor never typed - and on the citation path a cited URL
 * with an @ in its query was filed under the wrong host, moving the
 * leaderboard. No test, no log line and no screen would have shown it.
 *
 * That check was originally re-derived under python3 by reading the regexes
 * back out of the source, because no JavaScript runner was reachable. Node 24
 * strips types natively and ships a test runner, so it costs no dependency and
 * no config to leave the real thing behind instead:
 *
 *     npm run check
 *
 * Not wired into a CI gate, because this repo has none and `.github/` is not
 * writable from here. It is one command, it is in package.json next to
 * `lint`, and it runs in under a second.
 *
 * Two notes on the plumbing, both of which cost a wrong turn to find.
 *
 * `.mts` rather than `.ts` makes this file ESM by extension, so Node does not
 * have to sniff it. That is worth having on its own, but it does NOT silence
 * MODULE_TYPELESS_PACKAGE_JSON - the warning is raised for `domain.ts`, the
 * module under test, which is ordinary app source and will always be `.ts`.
 * Renaming the test cannot reach it. Node's own advice is to add
 * `"type": "module"` to package.json; do not take it, because that changes
 * how `next.config`, `postcss.config` and `eslint.config` are loaded - a real
 * risk to the build in exchange for silencing a notice. The npm script names
 * that one warning in `--disable-warning` instead, which leaves every other
 * warning where a check ought to have it: on screen.
 *
 * The import below is "./domain.ts", extension and all, because Node does not
 * resolve extensionless specifiers. `allowImportingTsExtensions` in tsconfig
 * is what lets tsc read that, and it is safe only because `noEmit` is on.
 */

test("strips scheme, www, port, credentials and trailing dot", () => {
  assert.equal(normalizeDomain("https://www.Example.com/about"), "example.com");
  assert.equal(normalizeDomain("  https://WWW.Example.com/about "), "example.com");
  assert.equal(normalizeDomain("http://example.com:8443/x"), "example.com");
  assert.equal(normalizeDomain("example.com."), "example.com");
  assert.equal(normalizeDomain("EXAMPLE.CO.UK"), "example.co.uk");
});

test("real credentials still come off", () => {
  assert.equal(normalizeDomain("https://user:pass@example.com/path"), "example.com");
  assert.equal(normalizeDomain("ftp://anon@files.example.com"), "files.example.com");
});

test("an @ after the authority never renames the host", () => {
  // The regression. Each of these returned the domain in the comment before
  // the two lines in normalizeDomain were reordered.
  assert.equal(normalizeDomain("https://example.com?email=me@other.com"), "example.com"); // other.com
  assert.equal(normalizeDomain("example.com?ref=a@b.co"), "example.com"); // b.co
  assert.equal(normalizeDomain("https://example.com#a@b.com"), "example.com"); // b.com
  assert.equal(normalizeDomain("https://example.com/mailto:me@other.com"), "example.com");
});

test("a backslash cuts the authority exactly as a slash does", () => {
  // The second member of the same class. Each of these returned the domain in
  // the comment before "\\" joined "/" in the cut set.
  assert.equal(normalizeDomain("https://example.com\\@evil.com"), "example.com"); // evil.com
  assert.equal(normalizeDomain("example.com\\@evil.com"), "example.com"); // evil.com
  assert.equal(normalizeDomain("https://example.com\\path"), "example.com");
  assert.equal(normalizeDomain("https://example.com\\\\evil.com"), "example.com");
});

/**
 * The rule, rather than a list of cases: for an http(s) URL the browser can
 * parse, we must name the host the browser would go to.
 *
 * Pinned against `new URL()` on purpose. Both faults this file records were
 * found by comparing the step-by-step normaliser against the WHATWG parser,
 * and hand-typed expectations are what let the first one through - they can
 * only encode the cases somebody already thought of. This compares against the
 * thing visitors actually use, so a third member of the class fails here
 * without anybody having to guess it in advance.
 */
test("agrees with the URL parser on every host a browser would resolve", () => {
  const urls = [
    "https://example.com\\@evil.com",
    "https://example.com?email=me@other.com",
    "https://example.com#a@b.com",
    "https://example.com/@evil.com",
    "https://user:pass@example.com/path",
    "https://WWW.Example.com/about",
    "https://example.com:8443/x",
    "https://example.com\\path",
    "https://example.com/a\\b@evil.com",
    "http://sub.example.co.uk/x?y=@z.com",
  ];
  for (const raw of urls) {
    assert.equal(
      normalizeDomain(raw),
      new URL(raw).hostname.replace(/^www\./, ""),
      `normalizeDomain disagrees with new URL() on ${raw}`,
    );
  }
});

test("isPlausibleDomain refuses what is not a hostname", () => {
  assert.equal(isPlausibleDomain("example.com"), true);
  assert.equal(isPlausibleDomain("a.b.example.co.uk"), true);
  // A bare IP has no letters in its last label, which is what keeps the
  // scanner off an address - see lib/scan/address.ts for the rest of it.
  assert.equal(isPlausibleDomain("127.0.0.1"), false);
  assert.equal(isPlausibleDomain("localhost"), false);
  assert.equal(isPlausibleDomain(""), false);
  assert.equal(isPlausibleDomain("example..com"), false);
  assert.equal(isPlausibleDomain("-bad.example.com"), false);
  assert.equal(isPlausibleDomain("bad-.example.com"), false);
  assert.equal(isPlausibleDomain("例え.com"), false);
});

test("the first fetch goes where the visitor pointed, www included (26 Nov 2026)", () => {
  assert.equal(enteredUrl("https://www.sandburnhall.co.uk/", "sandburnhall.co.uk"), "https://www.sandburnhall.co.uk/");
  assert.equal(enteredUrl("WWW.Sandburnhall.co.uk", "sandburnhall.co.uk"), "https://www.sandburnhall.co.uk/");
  assert.equal(enteredUrl("sandburnhall.co.uk", "sandburnhall.co.uk"), "https://sandburnhall.co.uk/");
  assert.equal(enteredUrl("http://example.com/en/?utm=1#x", "example.com"), "http://example.com/en/");
  // Credentials and ports are dropped; a different host, and the "\\@" trick, are not accepted.
  assert.equal(enteredUrl("https://user:pw@example.com:8443/", "example.com"), "https://example.com/");
  assert.equal(enteredUrl("https://example.com\\@evil.com", "example.com"), "https://example.com/");
  assert.equal(enteredUrl("https://evil.com/", "example.com"), null);
  assert.equal(enteredUrl("ftp://example.com", "example.com"), null);
  assert.equal(enteredUrl("", "example.com"), null);
});

test("the homepage is tried as entered, then on the www counterpart, then the other scheme (26 Nov 2026)", () => {
  assert.deepEqual(homepageCandidates("sandburnhall.co.uk", "https://www.sandburnhall.co.uk/"), ["https://www.sandburnhall.co.uk/", "https://sandburnhall.co.uk/", "http://www.sandburnhall.co.uk/", "http://sandburnhall.co.uk/"]);
  assert.deepEqual(homepageCandidates("sandburnhall.co.uk", "https://sandburnhall.co.uk/"), ["https://sandburnhall.co.uk/", "https://www.sandburnhall.co.uk/", "http://sandburnhall.co.uk/", "http://www.sandburnhall.co.uk/"]);
  assert.deepEqual(homepageCandidates("example.com", "http://example.com/en/"), ["http://example.com/en/", "http://www.example.com/en/", "https://example.com/", "https://www.example.com/"]);
  assert.deepEqual(homepageCandidates("example.com"), ["https://example.com/", "https://www.example.com/", "http://example.com/", "http://www.example.com/"]);
});
