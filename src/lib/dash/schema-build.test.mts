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

// ---- Schema Nomada delivered (14 Nov 2026): reported on its own terms, and never recommended again. ----

test("delivered schema: added when its latest version is live, waiting when only an earlier one is, never duplicated", () => {
  const org = "https://www.example.com/#organization";
  const svc = "https://www.example.com/craft#service";
  const v1 = { block_key: "site", version: 1, label: "Site-wide graph", where_url: "sitewide", how: null, supplied_on: "2026-10-29", supplied_by: "Luke Wilson, Nomada", expected: { [org]: { types: ["Organization"], props: ["name", "url"] } } };
  const v2 = { ...v1, version: 2, supplied_on: "2026-11-13", expected: { [org]: { types: ["Organization"], props: ["name", "url", "slogan"] }, "https://www.example.com/#phil": { types: ["Person"], props: ["name"] } } };
  const craft = { block_key: "craft", version: 1, label: "Craft page", where_url: "https://www.example.com/craft", how: null, supplied_on: "2026-11-13", supplied_by: "Luke Wilson, Nomada", expected: { [svc]: { types: ["Service"], props: ["name"] } } };
  const home = page({ nodes: [{ "@type": "Organization", "@id": org, name: "Example", url: "https://www.example.com/" }] });
  const p = buildSchema({ domain: "example.com", brand: "Example", market: "GB", local: false, home, clusters: [], delivered: [v1, v2, craft] });
  const by = Object.fromEntries(p.delivered.map((d) => [d.key, d]));
  assert.equal(by.site!.status, "updated_waiting");
  assert.match(by.site!.text, /^Updated version supplied 13 Nov 2026, waiting to go live/);
  assert.equal(by.craft!.status, "waiting");
  assert.match(by.craft!.text, /^Supplied 13 Nov 2026, waiting to go live/);
  assert.equal(p.blocks.find((b) => b.id === "organization"), undefined, "never a second Organization");
  const live = buildSchema({ domain: "example.com", brand: "Example", market: "GB", local: false, home: page({ nodes: [{ "@type": "Organization", "@id": org, name: "E", url: "u", slogan: "s" }, { "@type": "Person", "@id": "https://www.example.com/#phil", name: "Phil" }] }), clusters: [], delivered: [v1, v2] });
  assert.equal(live.delivered[0]!.status, "added");
  assert.equal(live.delivered[0]!.text, "Added by Nomada on 13 Nov 2026");
});
