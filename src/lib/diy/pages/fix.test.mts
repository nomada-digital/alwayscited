import assert from "node:assert/strict";
import { test } from "node:test";

import { basics, found } from "./fake-pages.mts";
import { buildFix, diffLines, fixSummary, httpsUrl, nameFrom, priceParts } from "./fix.ts";
import { schemaFindings } from "./schema.ts";

/**
 * The fix generator (13 Oct 2026, DIY P8; spec 10 section 6.4): every value
 * from the page with where it came from, [ADD] placeholders for a required
 * property with no source, never a rating, an https url only, and the diff
 * against the block already on the page.
 */

const fixFor = (url: string, homepage: boolean, b = basics(), f = found()) => buildFix({ url, homepage, basics: b, found: f }, schemaFindings({ url, homepage, basics: b, found: f, results: null }));

test("provenance per property: the name from og:site_name, the url from the canonical, the logo from the header, sameAs from the footer", () => {
  const [org] = fixFor("https://tallyroo.com/", true);
  assert.equal(org!.type, "Organization");
  assert.equal(org!.status, "new");
  assert.deepEqual(org!.block, {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "Tallyroo",
    url: "https://tallyroo.com/",
    logo: "https://tallyroo.com/logo.svg",
    sameAs: ["https://linkedin.com/company/tallyroo"],
    description: "Accounting software.",
  });
  assert.deepEqual(
    org!.props.map((p) => [p.name, p.from]),
    [
      ["name", "your og:site_name tag"],
      ["url", "your canonical address"],
      ["logo", "the header image"],
      ["sameAs", "your footer links"],
      ["description", "your meta description"],
    ],
  );
  assert.equal(org!.validates, true);
  assert.deepEqual(nameFrom(basics({ ogSiteName: null, title: "Tallyroo | Accounting software" })), { value: "Tallyroo", from: "your page title, before its separator" });
});

test("a required property with no source is an [ADD] placeholder, and the block says it won't validate", () => {
  const [org] = fixFor("https://tallyroo.com/", true, basics({ logo: null, social: [], ogSiteName: null, title: null }));
  assert.equal(org!.block.name, "[ADD: your organisation's name]");
  assert.equal(org!.block.logo, "[ADD: your logo URL]");
  assert.deepEqual(org!.block.sameAs, ["[ADD: your profile URLs, one each]"]);
  assert.equal(org!.validates, false);
  assert.deepEqual(fixSummary([org!]), [{ type: "Organization", status: "new", placeholders: 3 }]);
});

test("never a rating, even on a Product with visible reviews; the price and currency from the amount nearest the H1", () => {
  const b = basics({ canonical: "https://tallyroo.com/pro", facts: { ...basics().facts, price: true, priceText: "$1,299.00" }, reviewsVisible: true, h1: ["Tallyroo Pro"] });
  const [product] = fixFor("https://tallyroo.com/pro", false, b);
  assert.equal(product!.type, "Product");
  assert.deepEqual(product!.block.offers, { "@type": "Offer", price: "1299.00", priceCurrency: "USD", url: "https://tallyroo.com/pro" });
  assert.ok(!("aggregateRating" in product!.block) && !("review" in product!.block));
  assert.ok(!/rating/i.test(product!.json));
  assert.deepEqual(priceParts("£29"), { price: "29", currency: "GBP" });
  assert.equal(priceParts("29 dollars"), null);
});

test("an https url only: an http canonical is never written into the fix", () => {
  const [org] = fixFor("http://tallyroo.com/", true, basics({ canonical: "http://tallyroo.com/" }));
  assert.equal(org!.block.url, "[ADD: your https homepage address]");
  assert.equal(httpsUrl("http://tallyroo.com/"), null);
  assert.equal(httpsUrl("https://tallyroo.com/x"), "https://tallyroo.com/x");
});

test("the diff: against the block on the page, what is there and what the fix adds", () => {
  const f = found([["Organization"], ["name", "url"]], [["WebSite"], ["name", "url"]]);
  const [org] = fixFor("https://tallyroo.com/", true, basics(), f);
  assert.equal(org!.status, "update");
  assert.deepEqual(
    diffLines(org!).map((l) => `${l.mark} ${l.text}`),
    ["= name - from your og:site_name tag (already on your page)", "= url - from your canonical address (already on your page)", "+ logo - from the header image", "+ sameAs - from your footer links", "+ description - from your meta description"],
  );
});

test("the other templates: WebSite, BreadcrumbList from the visible crumbs, LocalBusiness from the address block, Article with a Person", () => {
  const home = fixFor("https://tallyroo.com/", true);
  assert.deepEqual(home.map((b) => b.type), ["Organization", "WebSite"]);
  const crumbs = fixFor("https://tallyroo.com/features/invoicing", false, basics({ breadcrumbs: [{ name: "Home", url: "https://tallyroo.com/" }, { name: "Features", url: "http://tallyroo.com/features" }] }));
  assert.deepEqual((crumbs[0]!.block.itemListElement as { item: string }[]).map((i) => i.item), ["https://tallyroo.com/", "[ADD: the https address of 'Features']"]);
  const local = fixFor("https://tallyroo.com/contact", false, basics({ facts: { ...basics().facts, address: true, addressText: "12 Harbor Street, Portland, OR 97201", phone: true, phoneText: "+1 555 010 0199" } }));
  assert.equal(local[0]!.type, "LocalBusiness");
  assert.equal((local[0]!.block.address as { streetAddress: string }).streetAddress, "12 Harbor Street, Portland, OR 97201");
  assert.equal(local[0]!.block.telephone, "+1 555 010 0199");
  const art = fixFor("https://tallyroo.com/blog/first-invoice", false, basics({ byline: "Sam Rivera", publishedTime: "2026-03-02" }));
  assert.deepEqual(art[0]!.block.author, { "@type": "Person", name: "Sam Rivera" });
  assert.equal(art[0]!.block.datePublished, "2026-03-02");
});
