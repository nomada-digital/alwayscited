import { type Finding, ARTICLE_TYPES, LOCAL_TYPES, ORG_TYPES, REQUIRED } from "./schema.ts";
import type { SchemaFound } from "./own-parse.ts";
import type { Basics } from "./types.ts";

/**
 * The fix generator, `buildFix` (13 Oct 2026, DIY P8; spec 10 section 6.4):
 * one JSON-LD block per type the checks call for, deterministic and pure,
 * filled only from the page's own visible content.
 *
 * - **Values come only from the page.** The name from `og:site_name`, else
 *   the title before a separator; the url from the canonical, and only when it
 *   is https; the logo from the logo candidate; sameAs from the profile links
 *   found; the description from the meta description; the price and currency
 *   from the visible amount nearest the H1; the address from the visible
 *   address block; the author from the byline; the dates from the article
 *   meta tags.
 * - **Provenance.** Every property says where it came from.
 * - **Placeholders.** A required property with no source is
 *   `"[ADD: <what>]"`, and the block is marked as one that won't validate
 *   until the [ADD] fields are filled.
 * - **The diff.** Against the block already on the page, property by
 *   property: what is there already, and what the fix adds (or "new" when the
 *   page has no block of that type). Property names only, as schema_found
 *   holds them: no current value is stored to compare.
 * - **Never invented.** No rating at all (a rating is only ever kept when
 *   reviews are visible, and the fix never writes one), no value from another
 *   page, no model.
 */

export type FixProp = { name: string; from: string | null; placeholder: boolean; added: boolean };

export type FixBlock = {
  type: string;
  status: "new" | "update";
  block: Record<string, unknown>;
  /** The block as the page would carry it, pretty-printed. */
  json: string;
  props: FixProp[];
  /** True when no required property is an [ADD] placeholder. */
  validates: boolean;
};

export type FixInput = { url: string; homepage: boolean; basics: Basics; found: SchemaFound | null };

const add = (what: string) => `[ADD: ${what}]`;
const isPlaceholder = (v: unknown): boolean => typeof v === "string" ? v.startsWith("[ADD:") : Array.isArray(v) ? v.some(isPlaceholder) : v !== null && typeof v === "object" ? Object.values(v).some(isPlaceholder) : false;

const SEPARATOR = /\s+[|\u2013\u2014\-:\u00b7\u2022]\s+/;

/** The organisation's name: og:site_name, else the title before its first separator. */
export function nameFrom(b: Basics): { value: string; from: string } | null {
  if (b.ogSiteName) return { value: b.ogSiteName, from: "your og:site_name tag" };
  if (b.title) {
    const first = b.title.split(SEPARATOR)[0]!.trim();
    if (first) return { value: first, from: "your page title, before its separator" };
  }
  return null;
}

/** An https address, or null: http is never written into a fix. */
export function httpsUrl(u: string | null): string | null {
  if (!u) return null;
  try {
    const x = new URL(u);
    return x.protocol === "https:" ? x.toString() : null;
  } catch {
    return null;
  }
}

const origin = (u: string) => {
  try {
    return `${new URL(u).origin}/`;
  } catch {
    return null;
  }
};

const CURRENCY: Record<string, string> = { $: "USD", "£": "GBP", "€": "EUR" };

/** "$1,299.00" as an Offer's price and currency. */
export function priceParts(text: string | null): { price: string; currency: string } | null {
  if (!text) return null;
  const m = /^([$£€])\s?(\d[\d,]*(?:\.\d{2})?)$/.exec(text.trim());
  if (!m) return null;
  return { price: m[2]!.replace(/,/g, ""), currency: CURRENCY[m[1]!]! };
}

type Prop = { value: unknown; from: string | null };

function draft(type: string, i: FixInput): Record<string, Prop> | null {
  const b = i.basics;
  const canonical = httpsUrl(b.canonical) ?? httpsUrl(i.url);
  const name = nameFrom(b);
  switch (type) {
    case "Organization":
      return {
        name: name ? { value: name.value, from: name.from } : { value: add("your organisation's name"), from: null },
        url: canonical && origin(canonical) ? { value: origin(canonical), from: "your canonical address" } : { value: add("your https homepage address"), from: null },
        logo: b.logo ? { value: b.logo.url, from: b.logo.from === "header" ? "the header image" : "your og:image tag" } : { value: add("your logo URL"), from: null },
        sameAs: b.social.length ? { value: b.social, from: "your footer links" } : { value: [add("your profile URLs, one each")], from: null },
        ...(b.description ? { description: { value: b.description, from: "your meta description" } } : {}),
      };
    case "WebSite":
      return {
        name: name ? { value: name.value, from: name.from } : { value: add("your site's name"), from: null },
        url: canonical && origin(canonical) ? { value: origin(canonical), from: "your canonical address" } : { value: add("your https homepage address"), from: null },
      };
    case "BreadcrumbList":
      if (!b.breadcrumbs?.length) return null;
      return {
        itemListElement: {
          value: b.breadcrumbs.map((c, n) => ({ "@type": "ListItem", position: n + 1, name: c.name, item: httpsUrl(c.url) ?? add(`the https address of '${c.name}'`) })),
          from: "the breadcrumbs on your page",
        },
      };
    case "Product": {
      const price = priceParts(b.facts.priceText);
      return {
        name: b.h1[0] ? { value: b.h1[0], from: "your H1" } : { value: add("the product's name"), from: null },
        ...(b.description ? { description: { value: b.description, from: "your meta description" } } : {}),
        offers: price
          ? { value: { "@type": "Offer", price: price.price, priceCurrency: price.currency, ...(canonical ? { url: canonical } : {}) }, from: "the price shown nearest your H1" }
          : { value: { "@type": "Offer", price: add("the price shown on the page"), priceCurrency: add("its currency code") }, from: null },
      };
    }
    case "LocalBusiness":
      return {
        name: name ? { value: name.value, from: name.from } : { value: add("your business name"), from: null },
        address: b.facts.addressText
          ? { value: { "@type": "PostalAddress", streetAddress: b.facts.addressText, addressLocality: add("your town or city"), postalCode: add("your postcode") }, from: "the address shown on your page (split it into its parts)" }
          : { value: { "@type": "PostalAddress", streetAddress: add("your street address") }, from: null },
        ...(b.facts.phoneText ? { telephone: { value: b.facts.phoneText, from: "the phone number shown on your page" } } : {}),
        ...(canonical ? { url: { value: canonical, from: "your canonical address" } } : {}),
      };
    case "Article":
      return {
        headline: b.h1[0] ? { value: b.h1[0], from: "your H1" } : b.title ? { value: b.title, from: "your page title" } : { value: add("the headline"), from: null },
        author: b.byline ? { value: { "@type": "Person", name: b.byline }, from: "the byline on your page" } : { value: { "@type": "Person", name: add("the author's name") }, from: null },
        datePublished: b.publishedTime ? { value: b.publishedTime, from: "your article:published_time tag" } : { value: add("the date it was published"), from: null },
        ...(b.modifiedTime ? { dateModified: { value: b.modifiedTime, from: "your article:modified_time tag" } } : {}),
      };
    default:
      return null;
  }
}

const FAMILY: Record<string, readonly string[]> = { Organization: ORG_TYPES, LocalBusiness: LOCAL_TYPES, Article: ARTICLE_TYPES };

/** The types the findings call for a block of, in the rule table's order, each once. */
export function fixTypes(findings: readonly Finding[]): string[] {
  const out: string[] = [];
  for (const f of findings) {
    if (f.level !== "fix" || !f.type || !REQUIRED[f.type]) continue;
    if (!out.includes(f.type)) out.push(f.type);
  }
  return out;
}

/** One block per type the findings call for, each diffed against the page's own block of that type. */
export function buildFix(i: FixInput, findings: readonly Finding[]): FixBlock[] {
  const out: FixBlock[] = [];
  for (const type of fixTypes(findings)) {
    const props = draft(type, i);
    if (!props) continue;
    const current = (i.found?.blocks ?? []).find((blk) => blk.types.some((t) => (FAMILY[type] ?? [type]).includes(t))) ?? null;
    const block: Record<string, unknown> = { "@context": "https://schema.org", "@type": type };
    const list: FixProp[] = [];
    for (const [k, p] of Object.entries(props)) {
      block[k] = p.value;
      list.push({ name: k, from: p.from, placeholder: isPlaceholder(p.value), added: !current || !current.props.includes(k) });
    }
    const required = REQUIRED[type] ?? [];
    out.push({
      type,
      status: current ? "update" : "new",
      block,
      json: JSON.stringify(block, null, 2),
      props: list,
      validates: !list.some((p) => p.placeholder && required.includes(p.name)),
    });
  }
  return out;
}

/** The fix as page_checks.fix keeps it: the types it drafts and how many [ADD] fields each has. */
export function fixSummary(blocks: readonly FixBlock[]): { type: string; status: "new" | "update"; placeholders: number }[] {
  return blocks.map((b) => ({ type: b.type, status: b.status, placeholders: b.props.filter((p) => p.placeholder).length }));
}

/** The diff as lines: "+ logo (from the header image)" for what the fix adds, "  name (already on your page)" for what is there. */
export function diffLines(b: FixBlock): { mark: "+" | "="; text: string }[] {
  return b.props.map((p) => ({
    mark: p.added ? "+" : "=",
    text: `${p.name}${p.placeholder ? " - to fill in" : p.from ? ` - from ${p.from}` : ""}${p.added ? "" : " (already on your page)"}`,
  }));
}
