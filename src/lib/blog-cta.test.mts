import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { DEFAULT_CATEGORIES, categoryOf, parseCategories, withDefaults } from "./blog-categories.ts";
import { blocks, placeCtas } from "./hub-post-blocks.ts";
import { blogRef, handoffMayStart, handoffPartner, scanRef } from "./scan/handoff.ts";

/** The blog's inline free scan and its categories (Danny, 1 Nov 2026). */

const ROOT = path.resolve(import.meta.dirname, "../..");
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");
const body = (n: number, cta = false) =>
  Array.from({ length: n }, (_, i) => `## Section ${i + 1}\n\nText ${i + 1}.\n\nMore ${i + 1}.`).join("\n\n") + (cta ? "\n\n[[cta]]" : "");

test("a post that places [[cta]] gets the box there and nowhere else", () => {
  const { blocks: bs, end } = placeCtas(blocks(body(5, true)).blocks);
  assert.equal(bs.filter((b) => b.k === "cta").length, 1);
  assert.equal(end, false);
});

test("a post with none gets one where the third section starts, and one at the end", () => {
  const parsed = blocks(body(5)).blocks;
  const { blocks: bs, end } = placeCtas(parsed);
  const at = bs.findIndex((b) => b.k === "cta");
  assert.equal(end, true);
  assert.equal(bs[at + 1]!.k, "h2");
  assert.equal((bs[at + 1] as { text: string }).text, "Section 3");
  // two sections: before the second; one section: only the end box
  assert.equal((placeCtas(blocks(body(2)).blocks).blocks.find((_, i, a) => a[i - 1]?.k === "cta") as { text: string }).text, "Section 2");
  assert.equal(placeCtas(blocks(body(1)).blocks).blocks.filter((b) => b.k === "cta").length, 0);
});

test("a post's ref is blog-<slug>, cut to the ref's length, and always a valid ref", () => {
  assert.equal(blogRef("why-most-aeo-audits-are-a-waste-of-money"), "blog-why-most-aeo-audits-are-a");
  assert.ok(blogRef("why-most-aeo-audits-are-a-waste-of-money").length <= 32);
  for (const s of ["short", "a-very-long-slug-that-goes-on-and-on-and-on", "x-"]) assert.equal(scanRef(blogRef(s)), blogRef(s), s);
  assert.equal(blogRef("best-ai-seo-agencies", "nomada-blog"), "nomada-blog-best-ai-seo-agencies");
});

test("a blog ref starts the scan only from our own pages; nomada-blog refs only from nomadadigital.co.uk", () => {
  assert.equal(handoffPartner("blog-best-ai-seo-agencies"), "blog");
  assert.equal(handoffPartner("nomada-blog-x"), "nomada");
  assert.equal(handoffPartner("nomada"), "nomada");
  assert.equal(handoffPartner("blogger"), null, "a prefix needs its dash");
  assert.equal(handoffMayStart("blog-x", "https://alwayscited.com/blog/x"), true);
  assert.equal(handoffMayStart("blog-x", "https://www.alwayscited.com/blog/x"), true);
  assert.equal(handoffMayStart("blog-x", "https://evil.example/"), false);
  assert.equal(handoffMayStart("blog-x", null), false, "a crawler sends no Referer");
  assert.equal(handoffMayStart("nomada-blog-x", "https://www.nomadadigital.co.uk/blog/x"), true);
  assert.equal(handoffMayStart("nomada-blog-x", "https://alwayscited.com/"), false);
});

test("the box is a plain GET to /scan with the ref, US market and the slug, checked first, and fires no analytics", () => {
  const src = read("src/components/BlogScanCta.tsx");
  assert.match(src, /<form\s+action="\/scan"\s+method="get"/);
  for (const f of ['name="domain"', 'name="ref" value={p.scanRef}', 'name="market" value={p.market ?? "US"}', 'name="utm_content" value={p.slug}']) assert.ok(src.includes(f), f);
  assert.match(src, /if \(!isPlausibleDomain\(d\)\) \{ e\.preventDefault\(\)/, "a bad domain is caught before the GET");
  assert.doesNotMatch(src, /gtag|dataLayer|track\(/, "nothing fires before consent");
  assert.match(read("src/components/HubPostBody.tsx"), /\{end \? <Cta post=\{post\} \/> : null\}/);
  assert.match(read("src/components/PostShell.tsx"), /p\.post\.slug && !p\.bodyCta \? <BlogScanCta/);
});

test("categories: the feed's list with the defaults' copy as fallback; a kind finds its page", () => {
  assert.deepEqual(DEFAULT_CATEGORIES.map((c) => c.name), ["Findings", "Method", "Running an agency"]);
  assert.deepEqual(withDefaults([]), DEFAULT_CATEGORIES);
  const merged = withDefaults(parseCategories({ categories: [{ slug: "method", name: "Method", intro: "Hub intro." }, { slug: "Bad Slug", name: "x" }] }));
  assert.deepEqual(merged.map((c) => c.slug), ["method"]);
  assert.equal(merged[0]!.intro, "Hub intro.");
  assert.equal(merged[0]!.servicePath, "/alwayscited", "the default link stays when the hub has none");
  assert.equal(categoryOf("findings", DEFAULT_CATEGORIES)?.slug, "findings");
  const page = read("src/app/blog/category/[slug]/page.tsx");
  assert.match(page, /robots: d\.posts\.length \? undefined : \{ index: false, follow: true \}/);
  assert.match(page, /<BlogScanCta scanRef=\{blogRef\(category\.slug, "blog-c"\)\}/);
});
