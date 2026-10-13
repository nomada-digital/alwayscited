import assert from "node:assert/strict";
import { test } from "node:test";

import type { Pull } from "../keywords/footprint.ts";
import type { BotCheck, KeyPage, PageCheck } from "../pages/types.ts";

import { beforeFirstCheck, crawlersLine, googleLine, schemaLine, topPagesLine, whereYouStand } from "./day-zero.ts";

/**
 * "Where you stand today" (13 Oct 2026, DIY P9; spec 10 section 4.1): every
 * line from a stored read, labelled by its kind, left out when there is no
 * read behind it. Illustrative: Tallyroo and every site here are made up.
 */

const pull = (over: Partial<Pull> = {}): Pull => ({
  pulledOn: "2026-10-10",
  labsDate: "2026-10-09",
  total: 1342,
  etv: 5400,
  rows: [
    { k: "invoicing software", p: 6, u: "/invoicing", v: 2400, i: "commercial", e: 900 },
    { k: "free invoice template", p: 3, u: "/templates", v: 4400, i: "informational", e: 1200 },
    { k: "invoice app", p: 14, u: "/invoicing", v: 1000, i: "commercial", e: 40 },
    { k: "tallyroo", p: 1, u: "/", v: 300, i: "navigational", e: 250 },
    { k: "invoice generator", p: 22, u: "/templates", v: 800, i: "commercial", e: 0 },
  ],
  ...over,
});

test("Google: the total DataForSEO holds, and page 1 among the rows read, labelled as its estimate with the read date", () => {
  const l = googleLine(pull(), "tallyroo.com")!;
  assert.equal(l.text, "1,342 keywords rank for tallyroo.com on Google. Of the 5 with the most estimated traffic, 3 are on page 1.");
  assert.equal(l.basis, "DataForSEO estimate, read 10 Oct");
  assert.equal(l.to, "/google?view=all");
  assert.equal(googleLine(pull({ total: 5 }), "tallyroo.com")!.text, "5 keywords rank for tallyroo.com on Google, 3 of them on page 1.");
  assert.equal(googleLine(pull({ total: 0, rows: [] }), "tallyroo.com")!.text, "DataForSEO's index has no Google rankings for tallyroo.com yet.");
  assert.equal(googleLine(null, "tallyroo.com"), null, "no pull, no line: nothing is promised");
});

test("top pages: each page's estimated traffic summed over its keywords, the top three, none with no traffic", () => {
  const l = topPagesLine(pull())!;
  assert.equal(l.text, "Your 3 pages with the most estimated traffic from Google: /templates (about 1,200 a month), /invoicing (about 940 a month), / (about 250 a month).");
  assert.match(l.basis, /^DataForSEO estimate, read /);
  assert.equal(topPagesLine(pull({ rows: [{ k: "x", p: 30, u: "/x", v: 10, i: null, e: 0 }] })), null);
});

const verdict = (name: string, state: "allowed" | "partial" | "blocked") => ({ name, state, inherited: false, line: null, blocked: state === "allowed" ? [] : ["/"] });
const bot = (over: Partial<BotCheck> = {}): BotCheck => ({ id: "b1", checkedAt: "2026-10-12T02:10:00Z", robotsStatus: 200, crawlers: [verdict("Googlebot", "allowed"), verdict("GPTBot", "blocked"), verdict("PerplexityBot", "allowed")], hosts: [], llmsTxtStatus: 404, pages: [], ...over });

test("crawlers: what robots.txt allows, by name, from our own read - never a claim about what an engine does", () => {
  assert.equal(crawlersLine(bot(), "UK")!.text, "Your robots.txt keeps GPTBot from some or all of your key pages. Every other crawler we check can read them.");
  assert.equal(crawlersLine(bot(), "UK")!.basis, "Checked 12 Oct");
  assert.equal(crawlersLine(bot({ crawlers: [verdict("Googlebot", "allowed")] }), "UK")!.text, "Your robots.txt lets every crawler we check read your key pages.");
  assert.equal(crawlersLine(bot({ crawlers: [verdict("GPTBot", "blocked"), verdict("ClaudeBot", "partial"), verdict("CCBot", "blocked")] }), "UK")!.text, "Your robots.txt keeps GPTBot, ClaudeBot and CCBot from some or all of your key pages. Every other crawler we check can read them.");
  assert.equal(crawlersLine(bot({ robotsStatus: null }), "UK")!.text, "We couldn't read your robots.txt.");
  assert.equal(crawlersLine(null, "UK"), null);
  // The day is the client's: 02:10 UTC on 12 Oct is still 11 Oct in New York.
  assert.equal(crawlersLine(bot(), "US")!.basis, "Checked 11 Oct");
});

const home: KeyPage = { id: "kp-1", url: "https://tallyroo.com/", urlKey: "tallyroo.com", origin: "homepage", clusterIds: [], addedBy: "system", addedOn: "2026-10-11", removedOn: null, removedBy: null } as unknown as KeyPage;
const check = (over: Partial<PageCheck> = {}): PageCheck =>
  ({ id: "c1", keyPageId: "kp-1", url: "https://tallyroo.com/", urlKey: "tallyroo.com", checkedAt: "2026-10-12T02:00:00Z", via: "own", trigger: "onboarding", status: "ok", httpStatus: 200, finalUrl: null, basics: null, fix: null, schemaFound: { blocks: [{ types: ["Organization"], props: ["name"], via: "static" }, { types: ["WebSite"], props: ["url"], via: "static" }], errors: 0, conflicts: [], microdata: false }, schemaResults: null, contentHash: null, wordCount: 400, renderedWordCount: null, ...over }) as PageCheck;

test("schema: the types on the homepage from our latest own read; none said as none; an unread page said as unread", () => {
  assert.equal(schemaLine(home, [check()], "UK")!.text, "Schema on your homepage: Organization, WebSite.");
  assert.equal(schemaLine(home, [check()], "UK")!.to, "/pages/kp-1");
  assert.equal(schemaLine(home, [check({ schemaFound: { blocks: [], errors: 0, conflicts: [], microdata: true, microdataTypes: ["Product"] } })], "UK")!.text, "Schema on your homepage: Product.");
  assert.equal(schemaLine(home, [check({ schemaFound: null })], "UK")!.text, "No schema found on your homepage.");
  assert.equal(schemaLine(home, [check({ status: "unreadable", httpStatus: 503 })], "UK")!.text, "We couldn't read your homepage (HTTP 503).");
  assert.equal(schemaLine(home, [check({ via: "instant_pages" })], "UK"), null, "only our own read: the paid one is not the homepage's day-zero read");
  assert.equal(schemaLine(null, [check()], "UK"), null);
});

test("the block: every part with a read behind it, in order; nothing at all with no read", () => {
  assert.deepEqual(
    whereYouStand({ domain: "tallyroo.com", market: "UK", pull: pull(), bot: bot(), homepage: home, checks: [check()] }).map((l) => l.id),
    ["google", "pages", "crawlers", "schema"],
  );
  assert.deepEqual(whereYouStand({ domain: "tallyroo.com", market: "UK", pull: null, bot: null, homepage: null, checks: [] }), []);
  for (const l of whereYouStand({ domain: "tallyroo.com", market: "UK", pull: pull(), bot: bot(), homepage: home, checks: [check()] })) {
    assert.doesNotMatch(l.text, /\b(caused|drove|because of|thanks to|resulted in|delivered)\b/i, `${l.id}: a causal word`);
    assert.doesNotMatch(`${l.text} ${l.basis}`, /\d{1,2}:\d{2}/, `${l.id}: a clock time`);
  }
});

const item = (over: Record<string, unknown>) => ({ severity: "tidy", status: "suggested", hiddenUntil: null, createdAt: "2026-10-12T03:00:00Z", dedupeKey: "k", ...over }) as Parameters<typeof beforeFirstCheck>[0][number];

test("3 things before the first check: open Blocking first, then Tidy-up; never a hidden, done or other kind", () => {
  const picked = beforeFirstCheck(
    [
      item({ dedupeKey: "t1" }),
      item({ dedupeKey: "b1", severity: "blocking", createdAt: "2026-10-12T04:00:00Z" }),
      item({ dedupeKey: "g1", severity: "gap" }),
      item({ dedupeKey: "t2", status: "done" }),
      item({ dedupeKey: "t3", hiddenUntil: "2026-10-20" }),
      item({ dedupeKey: "t4", createdAt: "2026-10-12T05:00:00Z" }),
      item({ dedupeKey: "t5", createdAt: "2026-10-12T06:00:00Z" }),
    ],
    "2026-10-13",
  );
  assert.deepEqual(picked.map((i) => i.dedupeKey), ["b1", "t1", "t4"]);
});
