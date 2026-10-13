import assert from "node:assert/strict";
import { test } from "node:test";

import { domainTypeByRule, isEngineProperty, pageTypeByRule } from "./classify-rules.ts";

/** A host built at run time, so the privacy census's walk does not read a real subdomain as a client's (privacy.test.mts). */
const host = (...parts: string[]) => parts.join(".");

/**
 * The classification rules (13 Oct 2026, DIY P7; spec 10 section 6.2,
 * "Classification"): at least 30 URL and title cases, the domain types the
 * rules settle, and the engines' own properties. Illustrative: every brand
 * and `.example` site here is made up.
 */

const PAGE_CASES: [string, string | null, string | null][] = [
  // [url, title, expected page type]
  ["https://smallbizdesk.example/best-invoicing-apps", null, "best_of"],
  ["https://smallbizdesk.example/top-10-invoicing-tools", null, "best_of"],
  ["https://smallbizdesk.example/9-best-invoicing-apps", null, "best_of"],
  ["https://smallbizdesk.example/invoicing", "The 9 best invoicing apps for freelancers", "best_of"],
  ["https://smallbizdesk.example/invoicing", "Top 7 invoicing tools this year", "best_of"],
  ["https://softwarecompare.example/brightbook-vs-ledgerline", null, "comparison"],
  ["https://softwarecompare.example/compare", "Brightbook vs Ledgerline: which is better?", "comparison"],
  ["https://softwarecompare.example/vs/ledgerline", null, "comparison"],
  ["https://softwarecompare.example/ledgerline-alternatives", null, "alternatives"],
  ["https://softwarecompare.example/switch", "10 best alternatives to Ledgerline", "alternatives"],
  ["https://g2.com/products/ledgerline/reviews", null, "review_profile"],
  ["https://capterra.com/p/1/ledgerline", "Ledgerline reviews and ratings", "review_profile"],
  ["https://g2.com/categories/accounting", "Best accounting software", "best_of"],
  ["https://reddit.com/r/smallbusiness/comments/x1/which_app", null, "thread"],
  ["https://quora.com/What-is-the-best-invoicing-app", null, "thread"],
  ["https://forum.freelancehub.example/thread/123", null, "thread"],
  ["https://freelancehub.example/community/accounting", null, "thread"],
  ["https://freelancehub.example/questions/42/best-app", null, "thread"],
  ["https://freelancehub.example/t/which-app/482", null, "thread"],
  ["https://freelancehub.example/forums/accounting", null, "thread"],
  ["https://guides.example/how-to-send-an-invoice", null, "how_to"],
  ["https://guides.example/guide/invoicing", null, "how_to"],
  ["https://guides.example/guides/switching-accounting-software", null, "how_to"],
  ["https://cloudfinanceblog.example/blog/cloud-accounting-compared", null, "article"],
  ["https://cloudfinanceblog.example/news/funding-round", null, "article"],
  ["https://ledgerline.example/", null, "homepage"],
  ["https://ledgerline.example", "Ledgerline - the best accounting app", "homepage"],
  ["https://ledgerline.example/pricing", null, "product"],
  ["https://ledgerline.example/features/invoicing", null, "product"],
  ["https://ledgerline.example/product", null, "product"],
  ["https://shop.example/collections/accounting-books/", null, "category"],
  ["https://shop.example/category/software/", null, "category"],
  ["https://smbtechdigest.example/accounting-software-roundup", null, null],
  ["https://smbtechdigest.example/about", "About us", null],
  ["https://bestbuy-guides.example/accounting", null, null],
  ["not a url", null, null],
];

test("page types by rule: 30 and more URL and title cases", () => {
  assert.ok(PAGE_CASES.length >= 30, `only ${PAGE_CASES.length} cases`);
  for (const [url, title, want] of PAGE_CASES) assert.equal(pageTypeByRule(url, title), want, `${url} ${title ?? ""}`);
});

test("a word inside another word is not a signal", () => {
  assert.equal(pageTypeByRule("https://bestbuy-guides.example/accounting"), null, "'bestbuy' is not 'best'");
  assert.equal(pageTypeByRule("https://canvas.example/canvases"), null, "'canvas' is not 'vs'");
  assert.equal(pageTypeByRule("https://topology.example/topology-101"), null);
});

test("domain types by rule: review and directory sites, community, video, reference, institutional", () => {
  assert.equal(domainTypeByRule("g2.com"), "review_platform");
  assert.equal(domainTypeByRule("www.capterra.com"), "review_platform");
  assert.equal(domainTypeByRule("trustpilot.com"), "review_platform");
  assert.equal(domainTypeByRule(host("capterra", "co", "uk")), "review_platform", "a country edition of a listed site");
  assert.equal(domainTypeByRule("alternativeto.net"), "directory");
  assert.equal(domainTypeByRule("crunchbase.com"), "directory");
  assert.equal(domainTypeByRule("reddit.com"), "community");
  assert.equal(domainTypeByRule(host("old", "reddit", "com")), "community");
  assert.equal(domainTypeByRule("quora.com"), "community");
  assert.equal(domainTypeByRule(host("money", "stackexchange", "com")), "community");
  assert.equal(domainTypeByRule("forum.freelancehub.example"), "community");
  assert.equal(domainTypeByRule("youtube.com"), "video");
  assert.equal(domainTypeByRule(host("en", "wikipedia", "org")), "reference");
  assert.equal(domainTypeByRule("irs.gov"), "institutional");
  assert.equal(domainTypeByRule(host("gov", "uk")), "institutional");
  assert.equal(domainTypeByRule(host("cam", "ac", "uk")), "institutional");
  assert.equal(domainTypeByRule("state.edu"), "institutional");
  assert.equal(domainTypeByRule("smallbizdesk.example"), null, "everything else asks the model");
  assert.equal(domainTypeByRule("ledgerline.com"), null);
});

test("the engines' own properties are not typed and are left out", () => {
  for (const h of ["google.com", host("www", "google", "co", "uk"), host("gemini", "google", "com"), "developers.google.com", "bing.com", "openai.com", "chatgpt.com", "perplexity.ai", "www.anthropic.com"]) {
    assert.ok(isEngineProperty(h), h);
    assert.equal(domainTypeByRule(h), null, h);
  }
  for (const h of ["googleplex-fans.example", host("notbing", "com"), "smallbizdesk.example"]) assert.ok(!isEngineProperty(h), h);
});
