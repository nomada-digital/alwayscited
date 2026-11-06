import assert from "node:assert/strict";
import { test } from "node:test";

import { cursorFrom, inventorySig } from "./fatgrid-request.ts";
import { MIN_MARKET_SHARE, clientProfile, homepageHeadlines, marketShare, marketVerdict, topicVerdict } from "./host-gates.ts";

const UK = 2826;
const US = 2840;
const row = (location_code: number, etv: number) => ({ location_code, metrics: { organic: { etv } } });

test("a market share is the client's market over every location, and noise below the floor is unmeasured", () => {
  const r = marketShare([row(UK, 62), row(US, 26), row(2356, 6), row(UK, 0), { location_code: US }], UK);
  assert.equal(r.totalEtv, 94);
  assert.equal(Math.round(r.share! * 100), 66);
  assert.equal(marketShare([row(UK, 10), row(US, 5)], UK).share, null, "15 a month everywhere is not a share");
  assert.equal(marketShare([], UK).share, null);
});

// The three Kev turned down for Common on 6 Nov 2026, as DataForSEO read them that day (share of all-location etv).
test("Kev's three: both US-traffic sites fail the market gate; the music site passes it and fails on topic", () => {
  const viiewerr = { market: "UK", marketShare: 0.08, totalEtv: 1430 };
  const heights = { market: "UK", marketShare: 0.01, totalEtv: 6327 };
  const rgm = { market: "UK", marketShare: 0.62, totalEtv: 3979 };
  assert.equal(marketVerdict(viiewerr, { cited: false }).pass, false);
  assert.match(marketVerdict(viiewerr, { cited: false }).why, /8% UK traffic, under 35%/);
  assert.equal(marketVerdict(heights, { cited: false }).pass, false);
  assert.equal(marketVerdict(rgm, { cited: false }).pass, true);
  assert.equal(topicVerdict({ fits: false, fitReason: "music and band interviews" }).pass, false);
  assert.ok(MIN_MARKET_SHARE >= 0.3 && MIN_MARKET_SHARE <= 0.4, "the threshold Danny asked for: 30 to 40%");
});

test("a cited host is measured but never refused on market; an unmeasured inventory host is refused", () => {
  assert.equal(marketVerdict({ market: "UK", marketShare: 0.05, totalEtv: 900 }, { cited: true }).pass, true);
  assert.equal(marketVerdict({ market: "UK", marketShare: null, totalEtv: 12 }, { cited: false }).pass, false);
  assert.equal(marketVerdict({ market: "UK", marketShare: null, totalEtv: null }, { cited: false }).pass, false, "a read that failed proves nothing");
  assert.equal(marketVerdict({ market: "DE", marketShare: null, totalEtv: null }, { cited: false }).pass, true, "no location code, no gate");
});

test("only a yes from the topic read passes; an unread site does not", () => {
  assert.deepEqual(topicVerdict({ fits: true, fitReason: "UK tech news; reviews CMS platforms" }), { pass: true, why: "UK tech news; reviews CMS platforms" });
  assert.equal(topicVerdict({ fits: null, fitReason: null }).pass, false);
});

test("a homepage reads as its title, description, headings and headline-length links, scripts and nav left out", () => {
  const html = `<html><head><title>Tech &amp; Agency News</title><meta name="description" content="Web, CMS and agency news">
    <script>var x = "<h2>not this</h2>";</script></head><body><nav><a href="/">Home</a></nav>
    <h1>Latest</h1><h2>Why Craft CMS suits content-heavy sites</h2><a href="/a">Ten agencies rebuilding public sector sites in 2026</a>
    <h2>Why Craft CMS suits content-heavy sites</h2><h2>C O M M O N i s a s t u d i o</h2></body></html>`;
  assert.deepEqual(homepageHeadlines(html), [
    "Title: Tech & Agency News",
    "Description: Web, CMS and agency news",
    "Latest",
    "Why Craft CMS suits content-heavy sites",
    "Ten agencies rebuilding public sector sites in 2026",
  ]);
  assert.ok(homepageHeadlines(`<h2>${"x".repeat(200)}</h2>`.repeat(50)).join("").length <= 1800);
});

test("the client profile carries its clusters, its homepage and the hosts rejected as off-topic", () => {
  const p = clientProfile({ brand: "COMMON", domain: "common.agency", topic: null, clusters: ["craft cms agency", "craft cms"], homepage: ["Title: Common"], offTopic: [{ domain: "rgm.press", note: "Rejected: Off-topic." }] });
  assert.match(p, /craft cms agency; craft cms/);
  assert.match(p, /rgm\.press - Rejected: Off-topic\./);
  assert.doesNotMatch(p, /Topic:/);
});

test("the inventory cursor resumes for the same filters and page size, and starts again when either changes", () => {
  const sig = inventorySig({ minDr: 40, minTraffic: 1000, maxPrice: 1260, languages: ["en"], databases: ["uk"] });
  assert.deepEqual(cursorFrom({ sig, page_size: 5, guest_post: 3, link_insertion: 2 }, sig), { sig, page_size: 5, guest_post: 3, link_insertion: 2 });
  assert.deepEqual(cursorFrom({ sig, page_size: 10, guest_post: 3, link_insertion: 2 }, sig), { sig, page_size: 5, guest_post: 1, link_insertion: 1 });
  const other = inventorySig({ minDr: 52, minTraffic: 1000, maxPrice: 1260, languages: ["en"], databases: ["uk"] });
  assert.deepEqual(cursorFrom({ sig, page_size: 5, guest_post: 3, link_insertion: 2 }, other).guest_post, 1);
  assert.deepEqual(cursorFrom(null, sig).link_insertion, 1);
  assert.equal(cursorFrom({ sig, page_size: 5, guest_post: -4, link_insertion: "x" }, sig).guest_post, 1);
});
