/**
 * The title rule (13 Oct 2026, DIY P2; spec 10 sections 6.7 and 7.3: "on 20 or
 * more cases, including both examples, years, list counts, separators, the
 * market qualifier, and too short"). Illustrative: Tallyroo and every brand
 * shown are made up.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { NO_TITLE, TITLE_ASKS_READER, TITLE_NO_TOPIC, TITLE_TOO_LONG, TITLE_TOO_SHORT, asksReader, cleanPart, namesMarket, plainText, promptFromTitle, titleCore, titleOf, wordCount } from "./title-rule.ts";

const CASES: [title: string, market: string, want: string | null, note: string][] = [
  // The spec's two examples, word for word.
  ["The 9 best invoicing apps for freelancers (2026) - SmallBizStack", "US", "best invoicing apps for freelancers", "spec example 1"],
  ["Brightly vs Ledgerly: which is better?", "US", "brightly vs ledgerly", "spec example 2: a vs title is kept as it is"],
  // List counts.
  ["Top 10 CRM Tools for Startups | Brightly Blog", "US", "best crm tools for startups", "Top 10 to top, then best"],
  ["10 Best Payroll Apps for Small Businesses in 2026", "US", "best payroll apps for small businesses", "a bare count and a trailing year"],
  ["The 12 Best Accounting Apps for Small Businesses in 2026 | The Small Biz Stack", "US", "best accounting apps for small businesses", "The 12, the year and the dangling preposition"],
  ["THE 9 BEST INVOICING APPS FOR FREELANCERS", "US", "best invoicing apps for freelancers", "capitals"],
  // Leading question words.
  ["What are the best bookkeeping apps for sole traders?", "UK", "best bookkeeping apps for sole traders", "what are the"],
  ["Which are the best expense trackers for contractors", "US", "best expense trackers for contractors", "which are the"],
  ["Who are the best payroll providers for restaurants?", "US", "best payroll providers for restaurants", "who are the"],
  // Separators.
  ["Bookkeeping software for landlords – A buyer's guide", "UK", "best bookkeeping software for landlords", "en dash; the head has 4 words"],
  ["Top accounting apps — tested by accountants", "US", "best accounting apps", "em dash"],
  ["SmallBizStack | The 9 best invoicing apps for freelancers", "US", "best invoicing apps for freelancers", "site name first: the longer side is kept"],
  ["Accounting software: the 10 best apps for freelancers in 2026", "US", "best apps for freelancers", "a two-word head gives way to the longer side"],
  ["Accounting Software for Freelancers: The Complete Guide (2026)", "US", "best accounting software for freelancers", "a 4-word head is kept over a longer subtitle"],
  // Brackets.
  ["[Updated] The 7 best time tracking apps", "US", "best time tracking apps", "square brackets"],
  ["The 5 Best Alternatives to Ledgerly (Free & Paid)", "US", "best alternatives to ledgerly", "round brackets"],
  ["Brightly vs Ledgerly vs Countwise (2026 comparison)", "US", "brightly vs ledgerly vs countwise", "a three-way vs"],
  // The market qualifier.
  ["The 12 Best Accounting Apps in the UK (2026)", "UK", "best accounting apps in the UK", "the title names the client's market"],
  ["The 12 Best Accounting Apps in the UK (2026)", "US", "best accounting apps", "it names another market: neither is said"],
  ["Best accounting apps for UK freelancers", "UK", "best accounting apps for freelancers in the UK", "the market is said once, at the end"],
  ["Best invoicing software for US contractors", "US", "best invoicing software for contractors in the US", "US in capitals"],
  ["Best invoicing apps - Contact us", "US", "best invoicing apps", "a lowercase us is the pronoun, not the market"],
  // 13 Oct 2026 review: an adjective is not the market, and a brand keeps its words.
  ["The best British bookkeeping apps", "UK", "best british bookkeeping apps", "British is an adjective: kept, and no qualifier"],
  ["The 7 Best American Express Alternatives for Small Businesses | CardGuide", "US", "best american express alternatives for small businesses", "American Express is a brand"],
  ["Best British Airways Alternatives for Business Travel - TravelDesk", "UK", "best british airways alternatives for business travel", "British Airways is a brand"],
  ["Bank of America alternatives for small businesses", "US", "best bank of america alternatives for small businesses", "America in a brand is not the market"],
  ["CONTACT US: Best Payroll Tools for Startups", "US", "best payroll tools for startups", "an all-capitals US is the pronoun"],
  ["Best invoicing apps | ABOUT US", "US", "best invoicing apps", "an all-capitals ABOUT US part names no market"],
  ["BEST CRM TOOLS IN THE US", "US", "best crm tools in the US", "an all-capitals IN THE US does name it"],
  ["Payroll software: the 9 best for UK sole traders in 2026", "UK", "best payroll software for sole traders in the UK", "a short topic before a bare 'best for' is the topic"],
  ["Which accounting app is best for freelancers?", "US", "which accounting app is best for freelancers", "a which ... best question already asks for a recommendation"],
  // how to, and too short.
  ["How to choose accounting software - Brightly", "US", "how to choose accounting software", "how to is kept as it is"],
  ["Best CRM", "US", null, "two words"],
  ["Home", "US", null, "one word"],
  ["Ledgerly review: is it worth it in 2026?", "US", "best ledgerly review", "a subtitle that asks the reader is never the prompt"],
];

test("promptFromTitle: the spec's examples, years, list counts, separators, brackets, the market and too short", () => {
  assert.ok(CASES.length >= 20, `${CASES.length} cases, floor 20`);
  for (const [title, market, want, note] of CASES) {
    const got = promptFromTitle(title, market);
    if (want === null) {
      assert.deepEqual(got, { ok: false, reason: TITLE_TOO_SHORT }, `${note}: "${title}"`);
    } else {
      assert.deepEqual(got, { ok: true, text: want }, `${note}: "${title}"`);
    }
  }
});

test("promptFromTitle: no title, and a title past the prompt length, are refused with their reasons", () => {
  assert.deepEqual(promptFromTitle(null, "US"), { ok: false, reason: NO_TITLE });
  assert.deepEqual(promptFromTitle("   ", "US"), { ok: false, reason: NO_TITLE });
  const long = `Best ${Array.from({ length: 80 }, (_, i) => `word${i}`).join(" ")}`;
  assert.deepEqual(promptFromTitle(long, "US"), { ok: false, reason: TITLE_TOO_LONG });
});

test("13 Oct 2026 review: a title that asks the reader, or names no topic, makes no prompt", () => {
  for (const [title, why] of [
    ["Is Ledgerly Worth It? An Honest Review - SmallBizStack", TITLE_ASKS_READER],
    ["Why freelancers love Ledgerly", TITLE_ASKS_READER],
    ["Should you switch to Ledgerly in 2026?", TITLE_ASKS_READER],
    ["What to look for in invoicing software", TITLE_ASKS_READER],
    ["The 9 best for freelancers - Brightly", TITLE_NO_TOPIC],
  ] as const) {
    assert.deepEqual(promptFromTitle(title, "UK"), { ok: false, reason: why }, title);
  }
  assert.equal(asksReader("how to choose an accounting app"), false, "how to is a thing people ask");
  assert.equal(asksReader("how ledgerly saves you time"), true);
  assert.equal(asksReader("which crm is best for startups"), false);
  assert.equal(asksReader("which is better"), true);
  assert.equal(titleCore("Is Ledgerly worth it? An honest review"), null, "the rest of the title is never the fallback");
});

test("promptFromTitle: the reason for too short is the spec's words exactly", () => {
  assert.equal(TITLE_TOO_SHORT, "title too short to make a prompt");
});

test("promptFromTitle: every prompt it makes is within the prompt length and has 3 words", () => {
  for (const [title, market] of CASES) {
    const got = promptFromTitle(title, market);
    if (!got.ok) continue;
    assert.ok(got.text.length >= 8 && got.text.length <= 300, got.text);
    assert.ok(wordCount(got.text) >= 3, got.text);
    assert.equal(got.text, got.text.trim());
    assert.doesNotMatch(got.text, /\s{2}/);
    assert.doesNotMatch(got.text, /\b(19|20)\d\d\b/, "no year survives");
  }
});

test("titleOf: the <title>, else the first <h1>, entities decoded", () => {
  assert.equal(titleOf("<html><head><title>Brightly &amp; Ledgerly: best invoicing apps compared</title></head></html>"), "Brightly & Ledgerly: best invoicing apps compared");
  assert.equal(titleOf("<title>\n  The 9 best apps\n</title>"), "The 9 best apps");
  assert.equal(titleOf("<title></title><h1 class=x>Best <em>bookkeeping</em> apps</h1><h1>Second</h1>"), "Best bookkeeping apps");
  assert.equal(titleOf("<p>no title here</p>"), null);
  assert.equal(titleOf("<title>It&#39;s &#x2014; here</title>"), "It's — here");
  assert.equal(plainText("a&nbsp;&nbsp;b &unknown; c"), "a b &unknown; c");
});

test("an ampersand is not a word: 'Brightly & Ledgerly' gives way to the longer side", () => {
  assert.equal(wordCount("brightly & ledgerly"), 2);
  assert.deepEqual(promptFromTitle("Brightly &amp; Ledgerly: best invoicing apps compared".replace("&amp;", "&"), "US"), { ok: true, text: "best invoicing apps compared" });
});

test("the parts: cleaning and choosing", () => {
  assert.equal(cleanPart("The 9 best invoicing apps for freelancers (2026)"), "best invoicing apps for freelancers");
  assert.equal(cleanPart("Top 10 CRM tools"), "top crm tools");
  assert.equal(titleCore("Ledgerly: Which is better?"), "ledgerly", "no fallback to a question to the reader");
  assert.equal(namesMarket("Best apps in the U.K. today", "UK"), true);
  assert.equal(namesMarket("Contact us for more", "US"), false);
  assert.equal(namesMarket("Made in the USA", "US"), true);
  assert.equal(namesMarket("The best American apps", "US"), false, "an adjective is not the market");
  assert.equal(namesMarket("The best British apps", "UK"), false);
  assert.equal(namesMarket("CONTACT US: best apps", "US"), false);
  assert.equal(namesMarket("BEST APPS FOR THE US", "US"), true);
});
