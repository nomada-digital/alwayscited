import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { DEFAULT_CATEGORIES, categoryOf, parseCategories, withDefaults } from "./blog-categories.ts";
import { blocks, earlyCtaAt, isListicle, placeCtas } from "./hub-post-blocks.ts";
import { blogRef, handoffMayStart, handoffPartner, scanRef } from "./scan/handoff.ts";

/** The blog's inline free scan and its categories (Danny, 1 Nov 2026). */

const ROOT = path.resolve(import.meta.dirname, "../..");
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");
const body = (n: number, cta = false) =>
  Array.from({ length: n }, (_, i) => `## Section ${i + 1}\n\nText ${i + 1}.\n\nMore ${i + 1}.`).join("\n\n") + (cta ? "\n\n[[cta]]" : "");

const ctas = (bs: readonly { k: string }[]) => bs.flatMap((b, i) => (b.k === "cta" ? [i] : []));
const after = (bs: readonly { k: string }[], i: number) => (bs[i + 1] as { text?: string }).text;

test("the early box sits just before the second section, and one more at the end (Danny, 1 Nov 2026)", () => {
  const { blocks: bs, end } = placeCtas(blocks(`Intro.\n\n${body(5)}`).blocks);
  assert.equal(end, true);
  assert.deepEqual(ctas(bs).map((i) => after(bs, i)), ["Section 2"]);
  // one section: only the end box
  assert.equal(ctas(placeCtas(blocks(body(1)).blocks).blocks).length, 0);
});

test("a later [[cta]] becomes the end box, never a third; one before the second section is the early one", () => {
  const later = placeCtas(blocks(body(5, true)).blocks);
  assert.deepEqual(ctas(later.blocks).map((i) => after(later.blocks, i)), ["Section 2"], "the token is not rendered mid-post");
  assert.equal(later.end, true);
  const mid = placeCtas(blocks(`${body(2)}\n\n[[cta]]\n\n${body(2)}\n\n[[cta]]`).blocks);
  assert.equal(ctas(mid.blocks).length + (mid.end ? 1 : 0), 2, "never more than two");
  const early = placeCtas(blocks(`Intro.\n\n[[cta]]\n\n${body(4)}`).blocks);
  assert.deepEqual(ctas(early.blocks), [1], "the writer's early token stands where it is");
  assert.equal(ctas(early.blocks).length + (early.end ? 1 : 0), 2);
});

test("a listicle's early box goes just before its first ranked entry, not the second section", () => {
  const md = `Intro.\n\n## How we ranked them\n\nCriteria.\n\nWe do not quote their prices.\n\n## 1. alwayscited - best for being named\n\nWhy.\n\n## 2. Another\n\nWhy.\n\n## What to ask\n\nAsk.\n\nMore.`;
  const { blocks: bs } = placeCtas(blocks(md).blocks, "Best AI SEO agencies");
  assert.deepEqual(ctas(bs).map((i) => after(bs, i)), ["1. alwayscited - best for being named"]);
  const h3 = placeCtas(blocks(`Intro.\n\n## Why\n\nW.\n\n## At a glance\n\nG.\n\n## The list\n\nText.\n\n### 1. First\n\nA.\n\n### 2. Second\n\nB.\n\n## After\n\nC.\n\nD.`).blocks, "Peec AI alternatives").blocks;
  assert.deepEqual(ctas(h3).map((i) => after(h3, i)), ["1. First"], "a ranked entry set as ### counts too");
  assert.equal(earlyCtaAt([{ at: 3, level: 2, text: "**1.** Bold" }], 10), 3);
  assert.ok(isListicle("Best AI visibility trackers in 2026") && isListicle("Otterly.AI alternatives") && !isListicle("GEO vs SEO"));
});

test("a guide's numbered steps deep in the post do not pull the box down; a list that starts sooner is not split", () => {
  const guide = blocks(`Intro.\n\n## The short version\n\nS.\n\n## Side by side\n\nX.\n\n## What changes\n\nC.\n\n### 1. Third party pages\n\nT.\n\n### 2. Answers\n\nA.\n\n## Bottom line\n\nB.\n\nEnd.`).blocks;
  const g = placeCtas(guide, "GEO vs SEO: what changes").blocks;
  assert.deepEqual(ctas(g).map((i) => after(g, i)), ["Side by side"]);
  const check = placeCtas(blocks(`Intro.\n\n## 1. Let the engines in\n\nA.\n\n## 2. Get indexed\n\nB.\n\n## 3. More\n\nC.\n\nEnd.`).blocks, "AI search optimization: a checklist").blocks;
  assert.deepEqual(ctas(check).map((i) => after(check, i)), ["1. Let the engines in"]);
  assert.equal(earlyCtaAt([{ at: 9, level: 2, text: "1. Last" }], 10), -1, "never in the tail");
});

test("a hand-written post gets the same early box and the end one, and the shell holds no other domain field", () => {
  const shell = read("src/components/PostShell.tsx");
  assert.match(shell, /withEarlyCta\(p\.children, p\.post\.slug, p\.post\.title\)/);
  assert.match(shell, /const early = earlyCtaAt\(heads, items\.length, isListicle\(title\)\)/);
  assert.equal((shell.match(/<BlogScanCta /g) ?? []).length, 2, "early and end");
  assert.ok(!shell.includes('name="domain"') && !shell.includes(">Run it yourself<"), "the aside's own scan field is gone");
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
