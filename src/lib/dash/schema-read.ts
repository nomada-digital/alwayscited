import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { jsonLdNodes, parseOwnPage } from "@/lib/diy/pages/own-parse";
import { guardedRead } from "@/lib/scan/crawl";

import { type PageFacts, type Platform, detectPlatform } from "./schema-build";

/**
 * Rendered reads of the customer's pages (page_checks, Your pages' monthly or on-demand read with JavaScript): the
 * schema an app or plugin injects after load - a review widget, a store app - that a plain read cannot see. Types and
 * property names only, by url_key, newest read first. Never fatal: none when the read fails.
 */
export async function renderedSchema(db: SupabaseClient, clientId: string): Promise<Map<string, { types: string[]; props: string[] }[]>> {
  const { data, error } = await db.from("page_checks").select("url_key, checked_at, schema_found").eq("client_domain_id", clientId).not("schema_found", "is", null).order("checked_at", { ascending: false }).limit(200);
  const out = new Map<string, { types: string[]; props: string[] }[]>();
  if (error) return out;
  for (const r of data ?? []) {
    if (out.has(r.url_key as string)) continue;
    const blocks = ((r.schema_found as { blocks?: { types: string[]; props: string[]; via: string }[] } | null)?.blocks ?? []).filter((b) => b.via === "rendered");
    out.set(r.url_key as string, blocks.map((b) => ({ types: b.types, props: b.props })));
  }
  return out;
}

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

const TRACKING = /^(utm_[a-z]+|_t|_r|igsh|igshid|si|fbclid|gclid|ref|ref_src|mibextid)$/i;

/** A profile address with tracking parameters taken off and no trailing slash. */
export function untracked(u: string): string {
  try {
    const x = new URL(u);
    for (const k of [...x.searchParams.keys()]) if (TRACKING.test(k)) x.searchParams.delete(k);
    x.hash = "";
    return x.toString().replace(/\/+$/, "").replace(/\/\?/, "?");
  } catch {
    return u;
  }
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
      // A logo only from the site's own header: a share image is usually a photo, not the logo.
      logo: p.logo?.from === "header" ? p.logo.url : null,
      // Profile addresses without their tracking parameters (an id a profile needs, as Facebook's, is kept).
      social: [...new Set(p.social.map(untracked))],
      addressText: p.facts.addressText,
      phoneText: p.facts.phoneText,
      publishedTime: p.publishedTime,
      modifiedTime: p.modifiedTime,
      byline: p.byline,
      nodes: jsonLdNodes(r.html).nodes as Record<string, unknown>[],
      faqs: faqsIn(r.html),
      microdataTypes: p.microdataTypes,
    },
  };
}
