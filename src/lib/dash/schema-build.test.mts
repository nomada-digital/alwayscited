import assert from "node:assert/strict";
import { test } from "node:test";

import { aiPrompt, buildSchema, detectPlatform, gtmText, liveStatus, type PageFacts } from "./schema-build.ts";

// A made-up site: only what a homepage might carry.
const page = (o: Partial<PageFacts>): PageFacts => ({ url: "https://example.com/", title: "Example Ltd | Wedding photography", description: "Wedding photographer in Leeds.", h1: "Wedding photography", ogSiteName: null, logo: null, social: [], addressText: null, phoneText: null, publishedTime: null, modifiedTime: null, byline: null, nodes: [], faqs: [], ...o });

test("only the page's own details go in; missing ones are left out and said", () => {
  const p = buildSchema({ domain: "example.com", brand: "Example", market: "GB", local: true, home: page({ social: ["https://instagram.com/example"] }), clusters: [{ name: "leeds wedding photographer", keyword: "leeds wedding photographer", target: null, page: null }] });
  const org = p.blocks.find((b) => b.id === "organization")!.jsonld;
  assert.equal(org["@type"], "LocalBusiness");
  assert.deepEqual(org.sameAs, ["https://instagram.com/example"]);
  assert.equal(org.areaServed, "United Kingdom");
  assert.equal(org.address, undefined, "no address invented");
  assert.equal(org.logo, undefined);
  assert.ok(p.notes.some((n) => /address/.test(n)));
  assert.ok(p.notes.some((n) => /no target page yet/.test(n)));
  assert.ok(p.blocks.some((b) => b.id === "website"));
});

test("existing markup with an @id is extended with what it lacks, never duplicated", () => {
  const home = page({ logo: "https://example.com/logo.png", nodes: [{ "@type": "Organization", "@id": "https://example.com/#org", name: "Example", url: "https://example.com/" }] });
  const p = buildSchema({ domain: "example.com", brand: "Example", market: "GB", local: false, home, clusters: [] });
  const b = p.blocks.find((x) => x.id === "organization")!;
  assert.equal(b.extends, "https://example.com/#org");
  assert.equal(b.jsonld["@id"], "https://example.com/#org");
  assert.equal(b.jsonld.logo, "https://example.com/logo.png");
  assert.equal(b.jsonld.name, undefined, "what it already has is not repeated");
  assert.equal((p.blocks.find((x) => x.id === "website")!.jsonld.publisher as { "@id": string })["@id"], "https://example.com/#org");
});

test("Service on the target page, FAQPage where it asks and answers, Article on a dated post; live once on the page", () => {
  const tp = page({ url: "https://example.com/weddings", h1: "Leeds weddings", publishedTime: "2026-01-02", faqs: [{ q: "How much?", a: "Packages start from the price on this page." }, { q: "Do you travel?", a: "Yes, across Yorkshire and beyond." }] });
  const p = buildSchema({ domain: "example.com", brand: "Example", market: "GB", local: false, home: page({}), clusters: [{ name: "weddings", keyword: "leeds wedding photographer", target: "https://example.com/weddings", page: tp }] });
  assert.deepEqual(p.blocks.map((b) => b.id.split(":")[0]), ["organization", "website", "service", "faq", "article"]);
  const live = liveStatus(p, [page({ nodes: [p.blocks[0]!.jsonld] })]);
  assert.equal(live[0]!.live, true);
  assert.equal(live[1]!.live, false);
  assert.match(gtmText(p), /Trigger: All Pages/);
  const prompt = aiPrompt(p, { domain: "example.com", platform: "wix" });
  assert.match(prompt, /runs on Wix/);
  assert.match(prompt, /Settings > Custom code/);
  assert.match(prompt, /search\.google\.com\/test\/rich-results/);
});

test("the platform is read from the homepage", () => {
  assert.equal(detectPlatform('<link href="//cdn.shopify.com/s/files/x.css">'), "shopify");
  assert.equal(detectPlatform('<script src="/wp-content/themes/a.js">'), "wordpress");
  assert.equal(detectPlatform('<img src="https://static1.squarespace.com/x.jpg">'), "squarespace");
  assert.equal(detectPlatform("<html></html>"), null);
});
