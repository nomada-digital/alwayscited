import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { LINK_CHECK_UA } from "../../tracking/placements.ts";

import { type Guarded, type GuardedGet, productToken, readGuardedPage, robotsAllows, robotsVerdict } from "./fetch.ts";

/**
 * Our own fetches (13 Oct 2026, DIY P1; spec 10 section 5.4): robots.txt is
 * honoured for third-party pages, by RFC 9309's rules, and "could not read
 * it" is never read as "allowed". The live reader, crawl.ts guardedRead, is
 * server-only; its guard is held here by reading its source.
 */

const UA = LINK_CHECK_UA;

test("our UA's product token is what robots.txt groups are matched against", () => {
  assert.equal(productToken(UA), "alwayscited-linkcheck");
});

test("the group naming our UA wins over *, then the longest rule, Allow on a tie", () => {
  const txt = [
    "User-agent: *",
    "Disallow: /private",
    "Allow: /private/open",
    "",
    "User-agent: alwayscited-linkcheck",
    "Disallow: /reviews",
    "Allow: /reviews/best",
    "Disallow: /*.pdf$",
    "Allow: /tie",
    "Disallow: /tie",
  ].join("\n");
  assert.deepEqual(robotsVerdict(txt, "/reviews/x", UA), { allowed: false, line: "Disallow: /reviews", inherited: false });
  assert.equal(robotsVerdict(txt, "/reviews/best-payroll", UA).allowed, true, "the longer Allow wins");
  assert.equal(robotsVerdict(txt, "/private/thing", UA).allowed, true, "our own group applies, not *'s");
  assert.equal(robotsVerdict(txt, "/guide.pdf", UA).allowed, false, "a $-anchored wildcard");
  assert.equal(robotsVerdict(txt, "/guide.pdf?x=1", UA).allowed, true, "anchored: a query string after .pdf is not a match");
  assert.equal(robotsVerdict(txt, "/tie", UA).allowed, true, "Allow wins a tie");
  assert.equal(robotsVerdict(txt, "/robots.txt", UA).allowed, true);
});

test("with no group of its own our UA inherits *'s rules, and no matching rule allows", () => {
  const txt = "User-agent: GPTBot\nUser-agent: ClaudeBot\nDisallow: /\n\nUser-agent: *\nDisallow: /admin\nDisallow:\n";
  assert.deepEqual(robotsVerdict(txt, "/admin/x", UA), { allowed: false, line: "Disallow: /admin", inherited: true });
  assert.equal(robotsVerdict(txt, "/best-payroll", UA).allowed, true);
  assert.equal(robotsVerdict("", "/anything", UA).allowed, true, "an empty robots.txt allows");
  assert.equal(robotsVerdict("# just a comment\nSitemap: https://roundup.example/sitemap.xml", "/x", UA).allowed, true);
});

function fakeGet(pages: Record<string, Guarded>): { get: GuardedGet; asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    get: async (url) => {
      asked.push(url);
      return pages[url] ?? { ok: true, status: 404, html: "", headers: {}, url };
    },
  };
}

const page = (url: string, status = 200, html = "<h1>Best payroll tools</h1>"): Guarded => ({ ok: true, status, html, headers: { "content-type": "text/html" }, url });

test("readGuardedPage honours robots for a third-party page: disallowed, it is never fetched", async () => {
  const { get, asked } = fakeGet({
    "https://roundup.example/robots.txt": page("https://roundup.example/robots.txt", 200, "User-agent: alwayscited-linkcheck\nDisallow: /"),
    "https://roundup.example/best": page("https://roundup.example/best"),
  });
  const out = await readGuardedPage("https://roundup.example/best", { get, thirdParty: true });
  assert.deepEqual(out, { ok: false, why: "robots" });
  assert.deepEqual(asked, ["https://roundup.example/robots.txt"], "the page itself was not requested");
});

test("allowed, the page is read with our UA, and its status, final URL and headers come back", async () => {
  const seen: string[] = [];
  const get: GuardedGet = async (url, opts) => {
    seen.push(`${url} ${opts.ua}`);
    if (url.endsWith("/robots.txt")) return page(url, 200, "User-agent: *\nDisallow: /admin");
    return { ok: true, status: 200, html: "<p>hi</p>", headers: { "x-robots-tag": "noindex" }, url: "https://roundup.example/best/" };
  };
  const out = await readGuardedPage("https://roundup.example/best", { get, thirdParty: true });
  assert.deepEqual(out, { ok: true, status: 200, finalUrl: "https://roundup.example/best/", headers: { "x-robots-tag": "noindex" }, html: "<p>hi</p>" });
  assert.ok(seen.every((s) => s.endsWith(UA)));
});

test("robots.txt answering 4xx allows; 5xx, a network failure or a private address does not", async () => {
  const url = "https://roundup.example/best";
  const with4xx = fakeGet({});
  assert.equal(await robotsAllows(url, UA, with4xx.get), true, "404: no robots.txt");
  const with5xx = fakeGet({ "https://roundup.example/robots.txt": page("https://roundup.example/robots.txt", 503, "") });
  assert.equal(await robotsAllows(url, UA, with5xx.get), false);
  const down: GuardedGet = async () => ({ ok: false, why: "network" });
  assert.equal(await robotsAllows(url, UA, down), false);
  const priv: GuardedGet = async () => ({ ok: false, why: "private" });
  assert.equal(await robotsAllows(url, UA, priv), false);
  assert.deepEqual(await readGuardedPage(url, { get: down, thirdParty: true }), { ok: false, why: "robots" });
});

test("the client's own page is read without the robots check; a URL that is not http(s) is refused", async () => {
  const { get, asked } = fakeGet({ "https://tallyroo.com/payroll": page("https://tallyroo.com/payroll") });
  const out = await readGuardedPage("https://tallyroo.com/payroll", { get, thirdParty: false });
  assert.equal(out.ok, true);
  assert.deepEqual(asked, ["https://tallyroo.com/payroll"]);
  assert.deepEqual(await readGuardedPage("file:///etc/passwd", { get, thirdParty: false }), { ok: false, why: "bad_url" });
  assert.deepEqual(await readGuardedPage("not a url", { get, thirdParty: true }), { ok: false, why: "bad_url" });
});

test("crawl.ts guardedRead keeps getText's guard: every host checked, redirects by hand and counted, bytes capped", () => {
  const src = readFileSync(new URL("../../scan/crawl.ts", import.meta.url), "utf8");
  const body = src.slice(src.indexOf("export async function guardedRead"));
  assert.ok(body.length > 200, "guardedRead is exported");
  assert.match(body, /await checkHost\(target\.hostname, signal\)/, "every hop's host, the first included");
  assert.doesNotMatch(body, /trusted/, "no host is trusted");
  assert.match(body, /redirect: "manual"/);
  assert.match(body, /if \(hop >= MAX_REDIRECTS\)/);
  assert.match(body, /bodyUpTo\(res\.body, opts\.capBytes\)/);
  assert.match(body, /target\.protocol !== "https:" && target\.protocol !== "http:"/);
});

test("freeRead refuses every path but the two free ones before any request", () => {
  const src = readFileSync(new URL("./doors.ts", import.meta.url), "utf8");
  const body = src.slice(src.indexOf("export async function freeRead"));
  const first = body.split("\n")[1]!.trim();
  assert.match(first, /^if \(!isDiyFreePath\(path\)\) throw/, "the guard is the first statement");
});
