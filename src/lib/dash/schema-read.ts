import "server-only";

import { jsonLdNodes, parseOwnPage } from "@/lib/diy/pages/own-parse";
import { guardedRead } from "@/lib/scan/crawl";

import { type PageFacts, type Platform, detectPlatform } from "./schema-build";

/**
 * The customer's own pages, read for "Schema for your site" (schema-build.ts) each time the page opens or Check again
 * is pressed: the homepage and each cluster's target page, through crawl.ts guardedRead (public addresses only, our own
 * user agent, a size cap), parsed by Your pages' own parser. A page that does not answer reads as null.
 */
const UA = "alwayscited-schema/1.0 (+https://alwayscited.com)";
const READ_MS = 9000;
const PAGE_BYTES = 2_000_000;
const FAQ_MAX = 10;

const text = (html: string) => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&rsquo;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();

/** Questions asked as h2 or h3 headings, each with the text under it up to the next heading, copied as the page says it. */
export function faqsIn(html: string): { q: string; a: string }[] {
  const out: { q: string; a: string }[] = [];
  const re = /<h([23])\b[^>]*>([\s\S]*?)<\/h\1>([\s\S]*?)(?=<h[1-6]\b|$)/gi;
  for (const m of html.matchAll(re)) {
    const q = text(m[2]!);
    const a = text(m[3]!).slice(0, 600);
    if (q.endsWith("?") && q.length <= 200 && a.length >= 20) out.push({ q, a });
    if (out.length >= FAQ_MAX) break;
  }
  return out;
}

export async function readPage(url: string): Promise<{ facts: PageFacts; platform: Platform } | null> {
  const r = await guardedRead(url, { capBytes: PAGE_BYTES, ua: UA, timeoutMs: READ_MS }).catch(() => null);
  if (!r || !r.ok || r.status >= 400) return null;
  const p = parseOwnPage(r.html, r.url, r.headers);
  return {
    platform: detectPlatform(r.html, r.headers),
    facts: {
      url: r.url,
      title: p.title,
      description: p.description,
      h1: p.h1[0] ?? null,
      ogSiteName: p.ogSiteName,
      logo: p.logo?.url ?? null,
      social: p.social,
      addressText: p.facts.addressText,
      phoneText: p.facts.phoneText,
      publishedTime: p.publishedTime,
      modifiedTime: p.modifiedTime,
      byline: p.byline,
      nodes: jsonLdNodes(r.html).nodes as Record<string, unknown>[],
      faqs: faqsIn(r.html),
    },
  };
}
