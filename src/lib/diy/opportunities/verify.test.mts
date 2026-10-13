import assert from "node:assert/strict";
import { test } from "node:test";

import type { Guarded, GuardedGet } from "../core/fetch.ts";

import { type FallbackRead, pursuingLine, removedSince, verifyPage, verificationOf } from "./verify.ts";

/**
 * Verification (13 Oct 2026, DIY P7; spec 10 sections 5.4 and 6.9): a link
 * followed or not on our own fetch; "follow status not read" on the
 * content_parsing fallback, which returns no rel; a mention; a page we could
 * not read, which is never "doesn't name you"; and robots.txt honoured.
 * Illustrative: every brand and site here is made up.
 */

const SUBJECT = { brand: "Tallyroo", domain: "tallyroo.com", aliases: [] };
const TODAY = "2026-11-14";
const NOW = Date.parse(`${TODAY}T03:40:00Z`);
const PAGE = { url: "https://lists.example/best-invoicing-apps", urlKey: "lists.example/best-invoicing-apps" };

/** A fake network: robots.txt and pages by URL. */
function net(pages: Record<string, { status: number; html: string; type?: string }>): GuardedGet {
  return async (url): Promise<Guarded> => {
    const p = pages[url];
    if (!p) return { ok: true, status: 404, html: "", headers: {}, url };
    return { ok: true, status: p.status, html: p.html, headers: { "content-type": p.type ?? "text/html" }, url };
  };
}
const ROBOTS_OPEN = { "https://lists.example/robots.txt": { status: 404, html: "" } };
const ROBOTS_SHUT = { "https://lists.example/robots.txt": { status: 200, html: "User-agent: *\nDisallow: /", type: "text/plain" } };

const deps = (get: GuardedGet, fallback: ((url: string) => Promise<FallbackRead>) | null = null) => ({ get, fallback, today: TODAY, now: NOW });

test("a followed link, read by our own fetch", async () => {
  const get = net({ ...ROBOTS_OPEN, [PAGE.url]: { status: 200, html: '<p>Tallyroo is on the list. <a href="https://tallyroo.com/">Tallyroo</a></p>' } });
  const { verification: v } = await verifyPage(PAGE, SUBJECT, null, deps(get));
  assert.equal(v.text, "Verified: link to tallyroo.com found on the page, followed, 14 Nov");
  assert.equal(v.rel, "followed");
  assert.equal(v.names, true);
  assert.equal(v.names_since, TODAY);
});

test("a link not followed", async () => {
  const get = net({ ...ROBOTS_OPEN, [PAGE.url]: { status: 200, html: '<a rel="nofollow" href="https://tallyroo.com/">an app</a>' } });
  const { verification: v } = await verifyPage(PAGE, SUBJECT, null, deps(get));
  assert.equal(v.text, "Verified: link to tallyroo.com found on the page, not followed, 14 Nov");
});

test("the content_parsing fallback when robots.txt keeps us out: found, follow status not read", async () => {
  const get = net({ ...ROBOTS_SHUT, [PAGE.url]: { status: 200, html: '<a href="https://tallyroo.com/">x</a>' } });
  let fetched = 0;
  const spy: GuardedGet = async (url, o) => {
    if (url === PAGE.url) fetched++;
    return get(url, o);
  };
  const fallback = async (): Promise<FallbackRead> => ({ kind: "read", value: { status: 200, title: "Best invoicing apps", h1: null, headings: [], dates: [], links: [{ url: "https://tallyroo.com/pricing", anchor: "Tallyroo" }], wordCount: 800 } });
  const { verification: v } = await verifyPage(PAGE, SUBJECT, null, deps(spy, fallback));
  assert.equal(fetched, 0, "a page robots.txt disallows is not fetched");
  assert.equal(v.via, "content_parsing");
  assert.equal(v.rel, null);
  assert.equal(v.text, "Verified: link to tallyroo.com found on the page, 14 Nov. Follow status not read.");
});

test("a mention with no link", async () => {
  const get = net({ ...ROBOTS_OPEN, [PAGE.url]: { status: 200, html: "<h2>4. Tallyroo</h2><p>Good for freelancers.</p>" } });
  const { verification: v } = await verifyPage(PAGE, SUBJECT, null, deps(get));
  assert.equal(v.text, "Verified: the page names Tallyroo, 14 Nov");
});

test("neither: read in full says so; the fallback never says the page doesn't name you", async () => {
  const full = await verifyPage(PAGE, SUBJECT, null, deps(net({ ...ROBOTS_OPEN, [PAGE.url]: { status: 200, html: "<p>Brightly and Ledgerly.</p>" } })));
  assert.equal(full.verification.text, "Checked 14 Nov: the page doesn't name Tallyroo or link to tallyroo.com yet.");
  const fallback = async (): Promise<FallbackRead> => ({ kind: "read", value: { status: 200, title: "Lists", h1: null, headings: [], dates: [], links: [], wordCount: 800 } });
  const thin = await verifyPage(PAGE, SUBJECT, null, deps(net(ROBOTS_SHUT), fallback));
  assert.equal(thin.verification.text, "Checked 14 Nov: Tallyroo isn't in the page's title, headings or links.");
  assert.equal(thin.verification.names, null);
});

test("a page we could not read; and with robots.txt shut and no paid read allowed, it waits for the fallback", async () => {
  const err = await verifyPage(PAGE, SUBJECT, null, deps(net({ ...ROBOTS_OPEN, [PAGE.url]: { status: 403, html: "" } })));
  assert.equal(err.verification.text, "We couldn't read this page on 14 Nov (HTTP 403).");
  assert.equal(err.verification.ok, false);
  const shut = await verifyPage(PAGE, SUBJECT, null, deps(net(ROBOTS_SHUT), null));
  assert.equal(shut.verification.fallback, true, "the paid page_reads job reads it when DIY is on");
  assert.equal(shut.verification.text, "We couldn't read this page on 14 Nov: it asks crawlers like ours not to.");
  const refused = await verifyPage(PAGE, SUBJECT, null, deps(net(ROBOTS_SHUT), async () => ({ kind: "refused" })));
  assert.equal(refused.verification.fallback, true);
});

test("a link or mention found before and gone now is flagged; the brand's since-day carries", async () => {
  const before = verificationOf({ at: "2026-11-07", via: "own", ok: true, http: 200, names: true, link: true, rel: "followed", anchor: "x", text: "Verified", names_since: "2026-10-01" })!;
  const gone = await verifyPage(PAGE, SUBJECT, before, deps(net({ ...ROBOTS_OPEN, [PAGE.url]: { status: 200, html: "<p>Tallyroo is mentioned.</p>" } })));
  assert.equal(removedSince(before, gone.verification), "link");
  assert.equal(gone.verification.names_since, "2026-10-01");
  assert.equal(pursuingLine(gone.verification, "tallyroo.com"), "Your brand appears on the page: yes, since 1 Oct. Link to tallyroo.com: no. Checked 14 Nov.");
  assert.equal(pursuingLine(null, "tallyroo.com"), "Not checked yet. Pursued pages are checked weekly.");
  const unread = await verifyPage(PAGE, SUBJECT, before, deps(net({ ...ROBOTS_OPEN, [PAGE.url]: { status: 500, html: "" } })));
  assert.equal(removedSince(before, unread.verification), null, "a page we could not read removed nothing");
});

test("a stored verification is read back field by field", () => {
  assert.equal(verificationOf(null), null);
  assert.equal(verificationOf({ at: "x", text: "y" }), null);
  const v = verificationOf({ at: "2026-11-14", text: "Verified", rel: "sponsored", extra: 1, removed: "link" });
  assert.equal(v?.rel, null, "only followed or not followed");
  assert.equal(v?.removed, "link");
  assert.ok(!("extra" in v!));
});
