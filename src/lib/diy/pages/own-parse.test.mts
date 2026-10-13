import assert from "node:assert/strict";
import { test } from "node:test";

import { SCHEMA_PAYLOAD_BYTES, capSchemaPayload, factsIn, jsonLdNodes, parseOwnPage, schemaFoundOf } from "./own-parse.ts";

/**
 * Our own read of a client page (13 Oct 2026, DIY P8; spec 10 section 6.4),
 * on small made-up pages: JSON-LD with @graph, a malformed block tolerated,
 * several blocks, the logo, the profile links, the visible facts, the
 * breadcrumbs; and capSchemaPayload's trim, on an oversized validator answer.
 */

const page = (head: string, body: string) => `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;
const ld = (o: unknown) => `<script type="application/ld+json">${JSON.stringify(o)}</script>`;

test("JSON-LD: @graph is flattened, several blocks are all read, and a malformed block is counted, not thrown", () => {
  const html = page(
    `<title>Tallyroo | Accounting</title>${ld({ "@context": "https://schema.org", "@graph": [{ "@type": "Organization", name: "Tallyroo", url: "https://tallyroo.com/" }, { "@type": "WebSite", name: "Tallyroo", url: "https://tallyroo.com/" }] })}<script type="application/ld+json">{ not json </script>${ld({ "@type": ["Product", "Thing"], name: "Tallyroo Pro", offers: { "@type": "Offer", price: "29" } })}`,
    "<h1>Hi</h1>",
  );
  const p = parseOwnPage(html, "https://tallyroo.com/");
  assert.deepEqual(
    p.jsonLd.map((n) => n.types),
    [["Organization"], ["WebSite"], ["Product", "Thing"]],
  );
  assert.equal(p.jsonLdErrors, 1);
  assert.deepEqual(p.jsonLd[0]!.props, ["name", "url"]);
  assert.deepEqual(jsonLdNodes(html).nodes.length, 3);
});

test("two blocks of one type naming different things are a conflict", () => {
  const html = page(`${ld({ "@type": "Organization", name: "Tallyroo" })}${ld({ "@type": "Organization", name: "Tallyroo Inc" })}`, "<h1>x</h1>");
  assert.deepEqual(parseOwnPage(html, "https://tallyroo.com/").conflicts, ["Organization"]);
  const same = page(`${ld({ "@type": "Organization", name: "Tallyroo" })}${ld({ "@type": "Organization", name: "tallyroo" })}`, "<h1>x</h1>");
  assert.deepEqual(parseOwnPage(same, "https://tallyroo.com/").conflicts, []);
});

test("the logo: an image in the header that says logo, else og:image; the profile links come from the footer", () => {
  const withHeader = page(`<meta property="og:image" content="/og.png">`, `<header><img src="/hero.jpg" alt="A desk"><a href="/"><img src="/img/brand.svg" alt="Tallyroo logo"></a></header><footer><a href="https://linkedin.com/company/tallyroo">In</a> <a href="https://x.com/tallyroo">X</a> <a href="https://g2.com/products/tallyroo">G2</a> <a href="/about">About</a></footer>`);
  const p = parseOwnPage(withHeader, "https://tallyroo.com/");
  assert.deepEqual(p.logo, { url: "https://tallyroo.com/img/brand.svg", from: "header" });
  assert.deepEqual(p.social, ["https://linkedin.com/company/tallyroo", "https://x.com/tallyroo", "https://g2.com/products/tallyroo"]);
  const noHeader = page(`<meta property="og:image" content="https://tallyroo.com/og.png">`, `<p>Hi</p>`);
  assert.deepEqual(parseOwnPage(noHeader, "https://tallyroo.com/").logo, { url: "https://tallyroo.com/og.png", from: "og_image" });
});

test("the visible facts: a price nearest the H1, a phone, an address block, opening hours", () => {
  const f = factsIn("Plans Starter $9 a month. Tallyroo Pro is $29 per month. Call +1 555 010 0199. Open Mon - Fri 9am to 5pm.", "Tallyroo Pro", "<p>12 Harbor Street, Portland, OR 97201</p>");
  assert.equal(f.price, true);
  assert.equal(f.priceText, "$29");
  assert.equal(f.phone, true);
  assert.equal(f.address, true);
  assert.equal(f.addressText, "12 Harbor Street, Portland, OR 97201");
  assert.equal(f.hours, true);
  const none = factsIn("Invoicing for freelancers. Send your first invoice today.", null, null);
  assert.deepEqual([none.price, none.phone, none.address, none.hours], [false, false, false, false]);
});

test("breadcrumbs: a nav named breadcrumb, or an ordered list of links above the H1", () => {
  const named = page("", `<nav aria-label="Breadcrumb"><a href="/">Home</a> <a href="/features">Features</a></nav><h1>Invoicing</h1>`);
  assert.deepEqual(parseOwnPage(named, "https://tallyroo.com/features/invoicing").breadcrumbs, [
    { name: "Home", url: "https://tallyroo.com/" },
    { name: "Features", url: "https://tallyroo.com/features" },
  ]);
  const ol = page("", `<ol><li><a href="/">Home</a></li><li><a href="/blog">Blog</a></li></ol><h1>Post</h1>`);
  assert.equal(parseOwnPage(ol, "https://tallyroo.com/blog/post").breadcrumbs?.length, 2);
  assert.equal(parseOwnPage(page("", "<h1>Post</h1><ol><li><a href='/a'>a</a></li><li><a href='/b'>b</a></li></ol>"), "https://tallyroo.com/x").breadcrumbs, null, "a list below the H1 is content, not breadcrumbs");
});

test("the meta and the text: canonical, noindex from meta or header, headings capped, word count and a hash of the words", () => {
  const html = page(`<title>Pricing | Tallyroo</title><meta name="description" content="Plans"><link rel="canonical" href="/pricing"><meta name="robots" content="noindex, follow">`, `<h1>Pricing</h1>${Array.from({ length: 45 }, (_, i) => `<h2>Heading ${i}</h2>`).join("")}<p>One two three.</p><script>var hidden = "not words";</script>`);
  const p = parseOwnPage(html, "https://tallyroo.com/pricing", { "x-robots-tag": "noarchive" });
  assert.equal(p.canonical, "https://tallyroo.com/pricing");
  assert.equal(p.noindex, true);
  assert.equal(p.headings.length, 40);
  assert.ok(!/hidden/.test(p.contentHash) && p.contentHash.length === 32);
  const again = parseOwnPage(html.replace("One two three.", "One two four."), "https://tallyroo.com/pricing");
  assert.notEqual(again.contentHash, p.contentHash, "the hash moves when the words do");
  assert.equal(parseOwnPage(page("", "<h1>x</h1>"), "https://tallyroo.com/", { "x-robots-tag": "noindex" }).noindex, true);
});

test("a fact in the markup and not in the text is said; reviews are seen only when the page shows them", () => {
  const html = page(ld({ "@type": "LocalBusiness", name: "Tallyroo", telephone: "+1 555 010 0199", address: { "@type": "PostalAddress", streetAddress: "12 Harbor Street" } }), "<h1>Tallyroo</h1><p>Rated 4.8 out of 5 from 120 reviews.</p>");
  const p = parseOwnPage(html, "https://tallyroo.com/");
  assert.deepEqual(p.markupOnly.sort(), ["address", "phone"]);
  assert.equal(p.reviewsVisible, true);
  assert.equal(parseOwnPage(page("", "<h1>x</h1>"), "https://tallyroo.com/").reviewsVisible, false);
});

test("capSchemaPayload: names only, never a value; at most 40 results; at most 16 KB, on an oversized validator answer", () => {
  const items = Array.from({ length: 50 }, (_, i) => ({
    types: [`Type${i}`],
    fields: Array.from({ length: 60 }, (_, j) => ({ name: `prop${j}`, value: `a value that must never be stored ${"x".repeat(150)}` })),
    results: Array.from({ length: 5 }, () => ({ level: "error", message: `m${"y".repeat(300)}` })),
  }));
  const { results } = capSchemaPayload(null, { summary: { error: 250, warning: 3 }, items });
  assert.ok(results);
  const json = JSON.stringify(results);
  assert.ok(!/a value that must never be stored/.test(json), "no field value is kept");
  assert.equal(results!.items.flatMap((i) => i.results).length <= 40, true);
  assert.ok(results!.items.flatMap((i) => i.results).every((r) => r.message.length <= 160));
  assert.ok(Buffer.byteLength(json, "utf8") <= SCHEMA_PAYLOAD_BYTES, `${Buffer.byteLength(json)} bytes`);
  assert.equal(results!.summary.error, 250);
  const found = capSchemaPayload(schemaFoundOf({ jsonLd: [{ types: ["Organization"], props: ["name", "url"], name: "Tallyroo" }], jsonLdErrors: 0, conflicts: [], microdata: false }), null).found;
  assert.deepEqual(found, { blocks: [{ types: ["Organization"], props: ["name", "url"], via: "static" }], errors: 0, conflicts: [], microdata: false });
  assert.ok(!JSON.stringify(found).includes("Tallyroo"), "the block's name value is not kept");
});
