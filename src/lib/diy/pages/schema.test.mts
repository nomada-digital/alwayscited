import assert from "node:assert/strict";
import { test } from "node:test";

import { SOURCES as CORE } from "../core/core.sources.ts";
import { ADVICE } from "./schema.advice.ts";
import { foundTypes, looksLikeProduct, schemaChip, schemaFindings } from "./schema.ts";
import { basics, found } from "./fake-pages.mts";
import { advice } from "./words.ts";

/**
 * The schema rule table (13 Oct 2026, DIY P8; spec 10 section 6.4): each
 * check's applies-when, on the smallest page that makes it apply and one that
 * does not; the list's Schema chip; and the Schema tab's evidence box, which
 * carries the G2, S41 and G4 lines only and names no study.
 */

const ids = (f: ReturnType<typeof schemaFindings>) => f.map((x) => x.id);
const home = { url: "https://tallyroo.com/", homepage: true, results: null };
const inner = { url: "https://tallyroo.com/pricing", homepage: false, results: null };

test("Organization and WebSite apply on the homepage only; a partial Organization says which properties it lacks", () => {
  assert.deepEqual(ids(schemaFindings({ ...home, basics: basics(), found: found() })), ["pages.schema.organization", "pages.schema.website"]);
  assert.deepEqual(ids(schemaFindings({ ...inner, basics: basics(), found: found() })), []);
  const partial = schemaFindings({ ...home, basics: basics(), found: found([["Organization"], ["name", "url"]], [["WebSite"], ["name", "url"]]) });
  assert.deepEqual(ids(partial), ["pages.schema.organization_props"]);
  assert.deepEqual(partial[0]!.missing, ["logo", "sameAs"]);
  assert.equal(advice(partial[0]!.id, partial[0]!.vars)!.text, "Your Organization markup is missing logo and sameAs.");
  assert.deepEqual(ids(schemaFindings({ ...home, basics: basics(), found: found([["Corporation"], ["name", "url", "logo", "sameAs"]], [["WebSite"], ["name", "url"]]) })), [], "a subtype counts");
});

test("BreadcrumbList applies only where breadcrumbs show; Product only where a price shows", () => {
  assert.deepEqual(ids(schemaFindings({ ...inner, basics: basics({ breadcrumbs: [{ name: "Home", url: "https://tallyroo.com/" }, { name: "Pricing", url: "https://tallyroo.com/pricing" }] }), found: found() })), ["pages.schema.breadcrumbs"]);
  const priced = basics({ facts: { ...basics().facts, price: true, priceText: "$29" } });
  assert.deepEqual(ids(schemaFindings({ ...inner, basics: priced, found: found() })), ["pages.schema.product"]);
  assert.deepEqual(ids(schemaFindings({ ...inner, basics: priced, found: found([["Product"], ["name", "offers"]]) })), []);
});

test("a marked-up price the page does not show, and a rating with no visible reviews, both say remove - the rating only once the JavaScript read shows the HTML is the whole page", () => {
  const whole = { static: 800, rendered: 812 };
  const f = schemaFindings({ ...inner, words: whole, basics: basics({ markupOnly: ["price"] }), found: found([["Product"], ["name", "offers", "aggregateRating"]]) });
  assert.deepEqual(ids(f), ["pages.schema.product_hidden", "pages.schema.rating_hidden"]);
  assert.ok(f.every((x) => x.level === "remove"));
  assert.deepEqual(ids(schemaFindings({ ...inner, basics: basics({ reviewsVisible: true }), found: found([["Product"], ["name", "aggregateRating"]]) })), [], "visible reviews keep the rating");
});

test("a rating with no reviews in the HTML, where a script could draw them (no JavaScript read, or one that found more text): info, worded as what we didn't see", () => {
  // 13 Oct 2026, DIY P8 review: review widgets (Trustpilot, Yotpo, Judge.me and the like) draw with JavaScript, so the static HTML cannot say they are not shown.
  for (const words of [undefined, { static: 800, rendered: null }, { static: 300, rendered: 1400 }]) {
    const f = schemaFindings({ ...inner, words, basics: basics(), found: found([["Product"], ["name", "offers", "aggregateRating"]]) });
    assert.deepEqual(f.map((x) => [x.id, x.level]), [["pages.schema.rating_unseen", "info"]], JSON.stringify(words));
  }
  assert.match(advice("pages.schema.rating_unseen")!.text, /we didn't see any in the page's HTML/);
});

test("Product only on a product or pricing page by its own signs: never an article or the homepage that mentions a price, and a suggestion that does not hold the fit", () => {
  const priced = (over = {}) => basics({ facts: { ...basics().facts, price: true, priceText: "$1,200", ...over } });
  // The review's case: a blog post with valid BlogPosting markup that says "about $1,200 a year".
  const post = { url: "https://tallyroo.com/blog/bookkeeping-cost", homepage: false, results: null, basics: basics({ publishedTime: "2026-09-01T00:00:00Z", byline: "Sam Doe" }), found: found([["BlogPosting"], ["headline", "author", "datePublished"]]) };
  assert.deepEqual(ids(schemaFindings({ ...post, basics: { ...post.basics, facts: { ...post.basics.facts, price: true, priceText: "$1,200" } } })), [], "an article that mentions a price");
  assert.equal(looksLikeProduct({ ...home, basics: priced({ priceNearH1: true }), found: found() }), false, "never the homepage");
  assert.ok(!ids(schemaFindings({ ...home, basics: priced({ priceNearH1: true }), found: found() })).includes("pages.schema.product"));
  const generic = { url: "https://tallyroo.com/small-business", homepage: false, results: null };
  assert.deepEqual(ids(schemaFindings({ ...generic, basics: priced(), found: found() })), [], "a price far from the H1 on a page with no product signs");
  assert.deepEqual(ids(schemaFindings({ ...generic, basics: priced({ priceNearH1: true }), found: found() })), ["pages.schema.product"], "a price shown right under the H1");
  assert.deepEqual(ids(schemaFindings({ ...generic, basics: priced(), found: found([["Offer"], ["price"]]) })), ["pages.schema.product"], "an Offer already marked up");
  const pricing = schemaFindings({ ...inner, basics: priced(), found: found() });
  assert.deepEqual(pricing.map((x) => [x.id, x.level]), [["pages.schema.product", "suggest"]], "a product path by rule; a suggestion, not a fix");
  assert.deepEqual(schemaChip({ ...inner, basics: priced(), found: found(), checked: true, readable: true }), { label: "Missing Product", tone: "warn" });
});

test("static microdata is found: never called missing, never handed a duplicate, never 'only after JavaScript'", () => {
  // The review's case: a /pricing page with static itemscope Product/Offer markup, and a validator item of type Product.
  const micro = { blocks: [], errors: 0, conflicts: [], microdata: true, microdataTypes: ["Product", "Offer"] };
  const results = { summary: { fatal: 0, error: 0, warning: 0, info: 0 }, items: [{ types: ["Product"], props: ["name", "offers"], results: [] }] };
  const priced = basics({ facts: { ...basics().facts, price: true, priceText: "$29", priceNearH1: true } });
  assert.deepEqual(ids(schemaFindings({ ...inner, results, basics: priced, found: micro })), []);
  assert.deepEqual(foundTypes(micro, results), [
    { type: "Product", where: "static", microdata: true },
    { type: "Offer", where: "static", microdata: true },
  ]);
  const homeMicro = { blocks: [], errors: 0, conflicts: [], microdata: true, microdataTypes: ["Organization", "WebSite"] };
  assert.deepEqual(ids(schemaFindings({ ...home, basics: basics(), found: homeMicro })), [], "Organization and WebSite as microdata: found, and their properties not read, so nothing said");
  const blogMicro = { blocks: [], errors: 0, conflicts: [], microdata: true, microdataTypes: ["BlogPosting"] };
  assert.deepEqual(ids(schemaFindings({ url: "https://tallyroo.com/blog/x", homepage: false, results: null, basics: basics(), found: blogMicro })), []);
  // JSON-LD a script injects is still said: it is in no static read.
  assert.deepEqual(ids(schemaFindings({ ...inner, results: { ...results, items: [{ types: ["FAQPage"], props: [], results: [] }] }, basics: priced, found: micro })), ["pages.schema.js_only"]);
});

test("LocalBusiness where an address shows on the homepage or a contact page, not on every page with a footer address", () => {
  const addr = basics({ facts: { ...basics().facts, address: true, addressText: "12 Harbor Street" } });
  assert.ok(ids(schemaFindings({ ...home, basics: addr, found: found([["Organization"], ["name", "url", "logo", "sameAs"]], [["WebSite"], ["name"]]) })).includes("pages.schema.local"));
  assert.ok(ids(schemaFindings({ url: "https://tallyroo.com/contact", homepage: false, results: null, basics: addr, found: found() })).includes("pages.schema.local"));
  assert.ok(!ids(schemaFindings({ ...inner, basics: addr, found: found() })).includes("pages.schema.local"));
});

test("Article on a blog or article page: missing, or missing its author and dates", () => {
  const blog = { url: "https://tallyroo.com/blog/first-invoice", homepage: false, results: null };
  assert.deepEqual(ids(schemaFindings({ ...blog, basics: basics(), found: found() })), ["pages.schema.article"]);
  const f = schemaFindings({ ...blog, basics: basics(), found: found([["BlogPosting"], ["headline"]]) });
  assert.deepEqual(f[0]!.missing, ["author", "datePublished"]);
  assert.deepEqual(ids(schemaFindings({ ...inner, basics: basics(), found: found() })), [], "not an article page");
});

test("the validator, a conflict, markup only after JavaScript, a fact only in the markup, FAQPage, and a block that did not parse", () => {
  const results = { summary: { fatal: 0, error: 2, warning: 1, info: 0 }, items: [{ types: ["Product", "FAQPage"], props: [], results: [{ level: "error" as const, message: "a" }, { level: "error" as const, message: "b" }] }] };
  const f = schemaFindings({ ...inner, results, basics: basics({ markupOnly: ["phone"] }), found: { blocks: [{ types: ["FAQPage"], props: ["mainEntity"], via: "static" }], errors: 1, conflicts: ["Organization"], microdata: false } });
  assert.deepEqual(ids(f), ["pages.schema.validator", "pages.schema.conflict", "pages.schema.js_only", "pages.schema.facts_text", "pages.schema.faq", "pages.schema.unparsed"]);
  assert.equal(advice("pages.schema.validator", f[0]!.vars)!.text, "The validator found 2 errors in the structured data we found.");
  assert.equal(f.find((x) => x.id === "pages.schema.js_only")!.type, "Product");
  assert.equal(f.find((x) => x.id === "pages.schema.faq")!.level, "info");
  assert.match(advice("pages.schema.faq")!.text, /No longer produces a Google rich result \(from 7 May 2026\)/);
});

test("the Schema chip: OK, n errors, Missing <type>, and Not checked for an unread or unreadable page - never no schema", () => {
  const base = { ...home, basics: basics(), checked: true, readable: true };
  assert.deepEqual(schemaChip({ ...base, found: found() }), { label: "Missing Organization", tone: "warn" });
  assert.deepEqual(schemaChip({ ...base, found: found([["Organization"], ["name", "url", "logo", "sameAs"]], [["WebSite"], ["name", "url"]]) }), { label: "OK", tone: "good" });
  assert.deepEqual(schemaChip({ ...base, found: found(), results: { summary: { fatal: 0, error: 2, warning: 0, info: 0 }, items: [] } }), { label: "2 errors", tone: "bad" });
  assert.deepEqual(schemaChip({ ...base, found: null, readable: false }), { label: "Not checked", tone: "none" });
  assert.deepEqual(schemaChip({ ...base, found: null, checked: false }), { label: "Not checked", tone: "none" });
});

test("the evidence box: G2, S41 and G4 lines only, each with its grade, and no study named", () => {
  const box = ["pages.evidence.eligible", "pages.evidence.ai_features", "pages.evidence.faq"].map((id) => ADVICE.find((l) => l.id === id)!);
  assert.deepEqual(
    box.map((l) => [l.grade, l.sourceId]),
    [
      ["documented", "G2"],
      ["documented", "S41"],
      ["documented", "G4"],
    ],
  );
  for (const l of box) assert.ok(advice(l.id), `${l.id} renders`);
  const internal = CORE.filter((s) => s.internal).map((s) => s.id);
  assert.ok(!ADVICE.some((l) => l.sourceId && internal.includes(l.sourceId)), "no line cites an internal study");
  const all = ADVICE.map((l) => l.text).join("\n");
  assert.ok(!/\b(study|studies|ahrefs|semrush|sitechecker|peec|profound|gumshoe|sparktoro)\b/i.test(all), "no study or tool named in any line");
  assert.ok(!/helps? (AI|the engines?) (cite|find)|gets? you cited/i.test(all), "never 'schema helps AI cite you'");
});
