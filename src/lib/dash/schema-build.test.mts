import assert from "node:assert/strict";
import { test } from "node:test";

import { aiPrompt, buildSchema, detectPlatform, developerText, gtmText, type PageFacts } from "./schema-build.ts";

// A made-up site: only what a homepage might carry.
const page = (o: Partial<PageFacts>): PageFacts => ({ url: "https://example.com/", title: "Example Ltd | Wedding photography", description: "Wedding photographer in Leeds.", h1: "Wedding photography", ogSiteName: null, logo: null, social: [], addressText: null, phoneText: null, publishedTime: null, modifiedTime: null, byline: null, nodes: [], faqs: [], ...o });
const plan = (home: PageFacts | null, clusters: Parameters<typeof buildSchema>[0]["clusters"] = [], local = false) => buildSchema({ domain: "example.com", brand: "Example", market: "GB", local, home, clusters });

test("nothing on the site: every block is missing, built from the page's own details only", () => {
  const p = plan(page({ social: ["https://instagram.com/example"] }), [{ name: "weddings", keyword: "leeds wedding photographer", target: null, page: null }], true);
  const org = p.blocks.find((b) => b.id === "organization")!;
  assert.equal(org.status, "missing");
  assert.equal(org.jsonld["@type"], "LocalBusiness");
  assert.deepEqual(org.jsonld.sameAs, ["https://instagram.com/example"]);
  assert.equal(org.jsonld.address, undefined, "no address invented");
  assert.ok(p.notes.some((n) => /no target page yet/.test(n)));
});

test("an @id the site already has is extended with only what it lacks", () => {
  const p = plan(page({ logo: "https://example.com/logo.png", nodes: [{ "@type": "Organization", "@id": "https://example.com/#org", name: "Example", url: "https://example.com/" }] }));
  const b = p.blocks.find((x) => x.id === "organization")!;
  assert.equal(b.status, "partly");
  assert.equal(b.jsonld["@id"], "https://example.com/#org");
  assert.deepEqual(Object.keys(b.jsonld).filter((k) => !k.startsWith("@")).sort(), ["areaServed", "description", "logo"]);
  assert.equal((p.blocks.find((x) => x.id === "website")!.jsonld.publisher as { "@id": string })["@id"], "https://example.com/#org");
});

test("existing markup with no @id (MOR's EmploymentAgency, Service and FAQPage) is never duplicated", () => {
  const tp = page({ url: "https://example.com/staff", h1: "Staff", faqs: [{ q: "How long?", a: "Usually two to four weeks from brief." }, { q: "Where?", a: "London and across the UK and Europe." }],
    nodes: [{ "@type": "Service", name: "Staff", description: "Wedding photographer in Leeds.", serviceType: "staff", provider: { "@id": "x" }, url: "https://example.com/staff", areaServed: "UK" }, { "@type": "FAQPage", mainEntity: [{ "@type": "Question", name: "How long?" }] }] });
  const home = page({ nodes: [{ "@type": "EmploymentAgency", name: "Example", url: "https://example.com/", description: "d", areaServed: "UK", sameAs: ["https://x.com/e"] }] });
  const p = plan(home, [{ name: "staff", keyword: "staff", target: "https://example.com/staff", page: tp }]);
  const by = Object.fromEntries(p.blocks.map((b) => [b.id.split(":")[0], b]));
  assert.equal(by.organization!.status, "already", "EmploymentAgency is a business");
  assert.equal(by.service!.status, "already");
  assert.equal(by.faq!.status, "already");
  assert.equal(by.website!.status, "missing");
  assert.doesNotMatch(developerText(p, null), /EmploymentAgency|"@type": "Service"|FAQPage/, "only what's missing is handed over");
});

test("app-injected schema seen by a rendered read, and microdata, count as there", () => {
  const p = plan(page({ rendered: [{ types: ["Organization"], props: ["name", "url", "description", "areaServed"] }], microdataTypes: ["https://schema.org/WebSite"] }));
  assert.equal(p.blocks.find((b) => b.id === "organization")!.status, "already");
  const w = p.blocks.find((b) => b.id === "website")!;
  assert.equal(w.status, "partly", "microdata names the type; its fields are added");
});

test("the three ways, and the platform", () => {
  const p = plan(page({}));
  assert.match(gtmText(p), /Trigger: All Pages/);
  const prompt = aiPrompt(p, { domain: "example.com", platform: "wix" });
  assert.match(prompt, /runs on Wix/);
  assert.match(prompt, /search\.google\.com\/test\/rich-results/);
  assert.equal(detectPlatform('<link href="//cdn.shopify.com/s/files/x.css">'), "shopify");
  assert.equal(detectPlatform('<script src="/wp-content/themes/a.js">'), "wordpress");
  assert.equal(detectPlatform("<html></html>"), null);
});
