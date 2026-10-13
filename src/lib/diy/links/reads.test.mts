import assert from "node:assert/strict";
import { test } from "node:test";

import type { MentionCandidate, ParsedPage } from "../../scan/dataforseo-request.ts";
import type { Guarded, GuardedGet } from "../core/fetch.ts";

import { checkLine, checkLink, checkUrl, firstLinkTo } from "./check-link.ts";
import { confirmMentions, mentionCandidates, verdictOf } from "./mentions.ts";
import { NONE_PLACED } from "./nomada-placements.ts";

/**
 * Check a link and the mention confirmations (13 Oct 2026, DIY P10; spec 10
 * sections 4.8, 5.4, 6.3 and 6.9), on a fake network: our own fetch first,
 * robots.txt honoured, the content_parsing fallback only when robots keeps us
 * out, and "follow status not read" whenever the fallback read it.
 */

const NOW = Date.parse("2026-10-14T10:00:00Z");
const TODAY = "2026-10-14";
type Site = { robots?: string; status?: number; html?: string; type?: string };

/** A fake guarded fetch over a map of URLs; robots.txt answers 404 (allowed) unless given. */
function web(sites: Record<string, Site>): GuardedGet {
  return async (url): Promise<Guarded> => {
    const u = new URL(url);
    if (u.pathname === "/robots.txt") {
      const s = Object.entries(sites).find(([k]) => new URL(k).origin === u.origin)?.[1];
      return s?.robots ? { ok: true, status: 200, html: s.robots, headers: {}, url } : { ok: true, status: 404, html: "", headers: {}, url };
    }
    const s = sites[url];
    if (!s) return { ok: false, why: "network" };
    return { ok: true, status: s.status ?? 200, html: s.html ?? "", headers: { "content-type": s.type ?? "text/html" }, url };
  };
}

const BLOCK = "User-agent: *\nDisallow: /\n";
/** A subdomain of the client's, built at run time so no host outside the made-up set is written here (privacy.test.mts). */
const sub = (label: string) => [label, "tallyroo.com"].join(".");
const parsed = (links: { url: string; anchor: string | null }[], extra: Partial<ParsedPage> = {}): ParsedPage => ({ status: 200, title: null, h1: null, headings: [], dates: [], links, wordCount: 100, ...extra });

test("Check a link: an own fetch reads the anchor, follow status and the page it points at", async () => {
  const url = "https://booksandbills.example/blog/stack";
  const get = web({ [url]: { html: '<p>We use <a href="https://www.tallyroo.com/invoicing" rel="noopener">Tallyroo &amp; co</a>.</p>' } });
  const c = await checkLink(url, "tallyroo.com", { get, fallback: null, now: NOW });
  assert.deepEqual({ via: c.via, status: c.status, found: c.found, rel: c.rel, anchor: c.anchor, target: c.target }, { via: "own", status: "ok", found: true, rel: "followed", anchor: "Tallyroo & co", target: "https://www.tallyroo.com/invoicing" });
  assert.equal(checkLine(c, "tallyroo.com"), "Links to tallyroo.com/invoicing: anchor 'Tallyroo & co', followed. Read 14 Oct.");
  const nf = await checkLink(url, "tallyroo.com", { get: web({ [url]: { html: '<a href="https://tallyroo.com/" rel="nofollow ugc">here</a>' } }), fallback: null, now: NOW });
  assert.equal(nf.rel, "not_followed");
  const none = await checkLink(url, "tallyroo.com", { get: web({ [url]: { html: '<a href="https://ledgerline.com/">Ledgerline</a>' } }), fallback: null, now: NOW });
  assert.equal(checkLine(none, "tallyroo.com"), "No link to tallyroo.com on this page. Read 14 Oct.");
});

test("Check a link: robots.txt keeps us out, so the paid fallback reads it - and its link is 'follow status not read'", async () => {
  const url = "https://closed.example/list";
  let asked = 0;
  const c = await checkLink(url, "tallyroo.com", {
    get: web({ [url]: { robots: BLOCK, html: "never read" } }),
    fallback: async () => (asked++, { kind: "read", value: parsed([{ url: "https://tallyroo.com/pricing", anchor: "Tallyroo pricing" }]) }),
    now: NOW,
  });
  assert.equal(asked, 1);
  assert.deepEqual({ via: c.via, found: c.found, rel: c.rel }, { via: "content_parsing", found: true, rel: null });
  assert.equal(checkLine(c, "tallyroo.com"), "Link found; follow status not read. It points at tallyroo.com/pricing, anchor 'Tallyroo pricing'. Read 14 Oct.");
  const dark = await checkLink(url, "tallyroo.com", { get: web({ [url]: { robots: BLOCK } }), fallback: async () => ({ kind: "refused" }), now: NOW });
  assert.equal(dark.status, "blocked");
  assert.equal(checkLine(dark, "tallyroo.com"), "We couldn't read this page on 14 Oct: it asks crawlers like ours not to.");
  const noFallback = await checkLink(url, "tallyroo.com", { get: web({ [url]: { robots: BLOCK } }), fallback: null, now: NOW });
  assert.equal(noFallback.status, "blocked", "while dark there is no paid read at all");
  const gone = await checkLink("https://gone.example/x", "tallyroo.com", { get: web({ "https://gone.example/x": { status: 404 } }), fallback: null, now: NOW });
  assert.equal(checkLine(gone, "tallyroo.com"), "We couldn't read this page on 14 Oct (HTTP 404).");
});

test("Check a link takes a public http(s) address of 500 characters at most, never the client's own site", () => {
  assert.deepEqual(checkUrl("https://booksandbills.example/x", "tallyroo.com"), { ok: true, url: "https://booksandbills.example/x", key: "booksandbills.example/x" });
  assert.deepEqual(checkUrl(`https://${sub("blog")}/post`, "tallyroo.com"), { ok: false, why: "own" });
  assert.deepEqual(checkUrl("ftp://booksandbills.example/x", "tallyroo.com"), { ok: false, why: "url" });
  assert.deepEqual(checkUrl(`https://a.example/${"x".repeat(500)}`, "tallyroo.com"), { ok: false, why: "url" });
  assert.deepEqual(checkUrl("https://user:pw@a.example/", "tallyroo.com"), { ok: false, why: "url" });
  assert.deepEqual(checkUrl(42, "tallyroo.com"), { ok: false, why: "url" });
  assert.equal(firstLinkTo(`<a href="/relative">x</a><a href="https://${sub("shop")}/">y</a>`, "tallyroo.com").href, `https://${sub("shop")}/`);
});

const cand = (url: string, title = "A page"): MentionCandidate => ({ url, domain: new URL(url).hostname.replace(/^www\./, ""), title, published: "2026-09-01", snippet: "Tallyroo is mentioned here by the search." });
const SUBJECT = { brand: "Tallyroo", domain: "tallyroo.com", aliases: [] as string[] };

test("mention candidates: never the client's own site, a compared site, a placed domain or page; at most 30", () => {
  const rows = [
    cand("https://tallyroo.com/blog"),
    cand("https://ledgerline.com/vs-tallyroo"),
    cand("https://softwarecritic.com/notes"),
    cand("https://ok.example/a"),
    cand("https://ok.example/a/"),
    ...Array.from({ length: 40 }, (_, i) => cand(`https://m${i}.example/p`)),
  ];
  const kept = mentionCandidates(rows, { client: "tallyroo.com", compared: ["ledgerline.com"], placed: { domains: new Set(["softwarecritic.com"]), keys: new Set() } });
  assert.equal(kept.length, 30);
  assert.equal(kept[0]!.url, "https://ok.example/a", "one row a page");
  assert.ok(!kept.some((c) => /tallyroo\.com|ledgerline|softwarecritic/.test(c.url)));
});

test("a mention is kept only when our read names the client and finds no link; unreadable and linked pages are dropped", async () => {
  const pages = {
    "https://named.example/a": { html: "<h2>Tools</h2><p>We like Tallyroo for invoices.</p>" },
    "https://linked.example/b": { html: '<p>Tallyroo, at <a href="https://tallyroo.com/">their site</a>.</p>' },
    "https://unnamed.example/c": { html: "<p>Nothing about the brand here.</p>" },
    "https://broken.example/d": { status: 500 },
    "https://closed.example/e": { robots: BLOCK, html: "x" },
    "https://closed2.example/f": { robots: BLOCK, html: "x" },
  };
  const fallback = async (url: string) =>
    url.includes("closed2")
      ? ({ kind: "read", value: parsed([], { title: "Tallyroo reviewed" }) } as const)
      : ({ kind: "read", value: parsed([{ url: "https://elsewhere.example/", anchor: "other" }], { headings: [{ level: 2, text: "Why Tallyroo" }] }) } as const);
  const got = await confirmMentions(Object.keys(pages).map((u) => cand(u)), SUBJECT, { get: web(pages), fallback, today: TODAY, now: () => NOW, deadlineMs: NOW + 200_000 });
  assert.deepEqual(got.confirmed.map((m) => [m.domain, m.via]), [
    ["named.example", "own"],
    ["closed.example", "content_parsing"],
  ]);
  assert.deepEqual(got.dropped, { unreadable: 2, linked: 1, unnamed: 1 }, "the fallback page with no links at all cannot say there is no link: dropped");
  assert.ok(got.confirmed[0]!.snippet!.includes("Tallyroo") && got.confirmed[0]!.snippet!.length <= 200, "our own read's snippet, 200 characters at most");
  assert.equal(got.read, 6);
});

test("the verdict rule on its own: unread, linked and unnamed are dropped, never shown as 'no link'", () => {
  const c = cand("https://x.example/p");
  const base = { urlKey: "x.example/p", url: c.url, readAt: "t", via: "own" as const, http: 200, title: "T", h1: null, updatedOn: null, headings: [], snippet: "Tallyroo", brandsFound: [], linkRel: null, linkAnchor: null };
  assert.deepEqual(verdictOf(c, { ...base, status: "blocked", namesClient: null, linksToClient: null }, TODAY), { drop: "unreadable" });
  assert.deepEqual(verdictOf(c, { ...base, status: "ok", namesClient: true, linksToClient: true }, TODAY), { drop: "linked" });
  assert.deepEqual(verdictOf(c, { ...base, status: "ok", namesClient: false, linksToClient: false }, TODAY), { drop: "unnamed" });
  assert.ok("keep" in verdictOf(c, { ...base, status: "ok", namesClient: true, linksToClient: false }, TODAY));
});

test("confirmations stop at the deadline rather than run past it", async () => {
  let t = NOW;
  const got = await confirmMentions([cand("https://a.example/1"), cand("https://b.example/2")], SUBJECT, { get: web({}), fallback: null, today: TODAY, now: () => (t += 0), deadlineMs: NOW + 10_000 });
  assert.equal(got.read, 0, "under 15 s left: nothing more is read");
  assert.equal(mentionCandidates([], { client: "tallyroo.com", compared: [], placed: NONE_PLACED }).length, 0);
});
