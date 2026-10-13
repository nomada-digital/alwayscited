import { createHash } from "node:crypto";

import { REVIEW_SITES } from "../../scan/source-kinds.ts";
import { decodeEntities, toProse } from "../../scan/prose.ts";
import { urlKey } from "../../tracking/placements.ts";

/**
 * Our own read of one of the client's own pages (13 Oct 2026, DIY P8; spec
 * 10 section 6.4, "Weekly own fetch"): what the weekly job, the on-demand
 * check and the fix generator need, from the HTML our guarded fetch returned.
 * Pure: the HTML in, a summary out, nothing stored that is not named here.
 *
 * It reads, by rule and without a DOM:
 *
 * - the meta: status line facts come from the fetch; here the title,
 *   description, canonical, meta robots (with `X-Robots-Tag` from the
 *   headers), `og:site_name`, `og:image`, the article dates and a byline;
 * - the headings: every H1, and the H2s and H3s (at most 40, each at most 120
 *   characters, as page_reads holds a third party's);
 * - the visible text: its word count, a hash of it (a content change), and
 *   the facts in it - a currency amount, a phone number, an address, opening
 *   hours - each found or not, with the price nearest the H1 and the address
 *   block kept for the fix (they are the client's own visible words);
 * - images and how many carry alt text; a table of 3 or more rows; a date
 *   near "updated" or "published"; breadcrumbs; microdata (`itemscope`), and
 *   the schema.org types its `itemtype`s name, so a type marked up as static
 *   microdata is never called missing (13 Oct 2026, DIY P8 review);
 * - the opening: the first paragraph of prose, at most 300 characters, the
 *   client's own words, for the drafted example's "Now" column;
 * - JSON-LD: every `<script type="application/ld+json">` block parsed, a
 *   malformed one counted rather than thrown, `@graph` flattened, each node's
 *   types and property names; two nodes of one type with different names
 *   are a conflict; a price, address or phone stated in the markup and not in
 *   the text is said;
 * - the header logo candidate (an image in `<header>` whose src or alt says
 *   logo, else `og:image`), the social and review profile links in the footer
 *   (the whole page when it has no footer), and the links to the client's own
 *   pages (for "internal links to this page").
 *
 * `capSchemaPayload` trims what is stored to the shape page_checks' checks
 * allow: types, property names, and per validator result a level and a
 * message of at most 160 characters, at most 40 results, at most 16 KB, and
 * never a value.
 */

export type JsonLdNode = { types: string[]; props: string[]; name: string | null };

export type Facts = {
  price: boolean;
  phone: boolean;
  address: boolean;
  hours: boolean;
  /** The currency amount nearest the H1, as the page writes it ("$29"), or null. */
  priceText: string | null;
  /** That amount follows the H1 within PRICE_NEAR characters of text: the page's own price, not one mentioned in passing. */
  priceNearH1?: boolean;
  /** The visible address block, at most 200 characters, or null. */
  addressText: string | null;
  /** The phone number as written, or null. */
  phoneText: string | null;
};

export type OwnParse = {
  title: string | null;
  description: string | null;
  canonical: string | null;
  metaRobots: string | null;
  xRobots: string | null;
  /** noindex in the meta robots or the X-Robots-Tag header. */
  noindex: boolean;
  ogSiteName: string | null;
  ogImage: string | null;
  publishedTime: string | null;
  modifiedTime: string | null;
  byline: string | null;
  h1: string[];
  headings: { level: 2 | 3; text: string }[];
  wordCount: number;
  contentHash: string;
  images: number;
  imagesWithAlt: number;
  hasTable: boolean;
  dateShown: boolean;
  breadcrumbs: { name: string; url: string }[] | null;
  microdata: boolean;
  /** The schema.org types named by the page's static microdata (`itemtype`), at most 20. */
  microdataTypes: string[];
  /** The first paragraph of prose, at most OPENING_CHARS: the client's own words, as the page reads now. */
  opening: string | null;
  jsonLd: JsonLdNode[];
  /** JSON-LD blocks that did not parse. */
  jsonLdErrors: number;
  /** Types with two or more nodes naming different things. */
  conflicts: string[];
  /** Facts stated in the markup and missing from the visible text. */
  markupOnly: ("price" | "address" | "phone")[];
  /** Reviews or ratings visible in the text. */
  reviewsVisible: boolean;
  logo: { url: string; from: "header" | "og_image" } | null;
  social: string[];
  facts: Facts;
  /** url_keys of links to the client's own pages, at most 200. */
  internal: string[];
};

const HEADING_MAX = 40;
const HEADING_CHARS = 120;
const LINKS_MAX = 200;
/** The opening kept, in characters. */
export const OPENING_CHARS = 300;
/** A price this close after the H1, in characters of text, is the page's own. */
export const PRICE_NEAR = 300;

const clean = (s: string | null | undefined, max: number): string | null => {
  if (s == null) return null;
  const t = decodeEntities(s).replace(/\s+/g, " ").trim();
  return t ? t.slice(0, max) : null;
};

/** One attribute of one tag's source, or null. */
function attr(tag: string, name: string): string | null {
  const m = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  return m ? (m[2] ?? m[3] ?? m[4] ?? null) : null;
}

/** Every opening tag of this name. */
function tags(html: string, name: string): string[] {
  return [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, "gi"))].map((m) => m[0]);
}

/** The inner HTML of every element of this name (not nested in itself). */
function inner(html: string, name: string): string[] {
  return [...html.matchAll(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, "gi"))].map((m) => m[1] ?? "");
}

function meta(html: string, key: string): string | null {
  for (const t of tags(html, "meta")) {
    const k = (attr(t, "name") ?? attr(t, "property") ?? "").toLowerCase();
    if (k === key) return clean(attr(t, "content"), 500);
  }
  return null;
}

function absolute(href: string | null, base: string): string | null {
  if (!href) return null;
  try {
    const u = new URL(decodeEntities(href.trim()), base);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

const bareHost = (h: string) => h.toLowerCase().replace(/^www\./, "");

/** The social hosts a footer's profile links are read from (spec 6.4), and the review platforms the scan already knows. */
export const SOCIAL_HOSTS = ["linkedin.com", "x.com", "twitter.com", "facebook.com", "instagram.com", "youtube.com", "tiktok.com"];
const PROFILE_HOSTS = [...SOCIAL_HOSTS, ...Object.keys(REVIEW_SITES)];

function profileHost(url: string): boolean {
  try {
    const h = bareHost(new URL(url).hostname);
    return PROFILE_HOSTS.some((p) => h === p || h.endsWith(`.${p}`));
  } catch {
    return false;
  }
}

// ---- Visible facts. Patterns, not understanding: each says found or not. ----

const PRICE = /[$£€]\s?\d[\d,]*(?:\.\d{2})?/g;
const PHONE = /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{2,5}\)[\s.-]?)?\d{2,5}[\s.-]\d{3,4}[\s.-]?\d{3,4}/g;
const POSTCODE = /\b(?:[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}|[A-Z]{2}\s\d{5}(?:-\d{4})?)\b/;
const STREET = /\b\d{1,5}\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+(?:Street|St\.?|Road|Rd\.?|Avenue|Ave\.?|Lane|Ln\.?|Boulevard|Blvd\.?|Drive|Dr\.?|Way|Place|Square|Court)\b/;
const HOURS = /\b(?:opening hours|open (?:daily|monday|mon)|(?:mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\s*(?:-|\u2013|to)\s*(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\s*:?\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i;
const REVIEWS = /\b(?:\d(?:\.\d)?\s*(?:out of 5|\/\s?5|stars?)|\d[\d,]*\s+(?:reviews|ratings))\b/i;
const DATE_NEAR = /\b(?:updated|published|last modified|posted)\b[^.\n]{0,40}?(?:\d{1,2}(?:st|nd|rd|th)?\s+[A-Z][a-z]{2,8}\.?,?\s+\d{4}|[A-Z][a-z]{2,8}\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4})/i;

function phoneIn(text: string): string | null {
  for (const m of text.matchAll(PHONE)) {
    const digits = m[0].replace(/\D/g, "");
    if (digits.length >= 9 && digits.length <= 15) return m[0].trim();
  }
  return null;
}

/** The visible facts, with the price nearest the first H1 in the text. */
export function factsIn(text: string, h1: string | null, addressHtml: string | null): Facts {
  const prices = [...text.matchAll(PRICE)];
  let priceText: string | null = null;
  let priceNearH1 = false;
  if (prices.length) {
    // The first amount after the H1, else the last before it: a price belongs to the heading above it.
    const at = h1 ? text.indexOf(h1) : -1;
    const after = at < 0 ? undefined : prices.find((m) => m.index! >= at);
    const near = at < 0 ? prices[0]! : (after ?? prices[prices.length - 1]!);
    priceText = near[0].replace(/\s+/g, "");
    priceNearH1 = after !== undefined && after.index! - (at + h1!.length) <= PRICE_NEAR;
  }
  const phoneText = phoneIn(text);
  const block = addressHtml ? clean(toProse(addressHtml), 200) : null;
  const line = block ?? (() => {
    const m = POSTCODE.exec(text) ?? STREET.exec(text);
    if (!m) return null;
    return clean(text.slice(Math.max(0, m.index - 80), m.index + m[0].length), 200);
  })();
  return {
    price: prices.length > 0,
    phone: phoneText !== null,
    address: line !== null,
    hours: HOURS.test(text),
    priceText,
    priceNearH1,
    addressText: line,
    phoneText,
  };
}

// ---- JSON-LD. ----

/** Each JSON-LD block's nodes, `@graph` flattened and nested nodes kept as their own; a block that does not parse counts as an error. */
export function jsonLdNodes(html: string): { nodes: (Record<string, unknown> & { "@type"?: unknown })[]; errors: number } {
  const nodes: Record<string, unknown>[] = [];
  let errors = 0;
  for (const m of html.matchAll(/<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)) {
    let data: unknown;
    try {
      data = JSON.parse(m[1]!.trim().replace(/^<!--|-->$/g, ""));
    } catch {
      errors += 1;
      continue;
    }
    const walk = (v: unknown, depth: number) => {
      if (depth > 6 || v === null || typeof v !== "object") return;
      if (Array.isArray(v)) {
        for (const x of v) walk(x, depth + 1);
        return;
      }
      const o = v as Record<string, unknown>;
      if (Array.isArray(o["@graph"])) {
        for (const x of o["@graph"] as unknown[]) walk(x, depth + 1);
      }
      if (o["@type"] !== undefined) nodes.push(o);
    };
    walk(data, 0);
  }
  return { nodes, errors };
}

const typesOf = (o: Record<string, unknown>): string[] => [o["@type"]].flat().filter((t): t is string => typeof t === "string").map((t) => t.replace(/^.*[/#]/, "")).slice(0, 10);

const textValue = (v: unknown): string | null => (typeof v === "string" ? v : typeof v === "number" ? String(v) : null);

/** A price, an address and a phone stated in the markup, for "in the markup but not in the text". */
function markupFacts(nodes: Record<string, unknown>[]): { price: string[]; address: string[]; phone: string[] } {
  const out = { price: [] as string[], address: [] as string[], phone: [] as string[] };
  const visit = (o: unknown, depth: number) => {
    if (depth > 6 || !o || typeof o !== "object") return;
    if (Array.isArray(o)) return o.forEach((x) => visit(x, depth + 1));
    const r = o as Record<string, unknown>;
    const price = textValue(r.price) ?? textValue(r.lowPrice);
    if (price) out.price.push(price);
    const tel = textValue(r.telephone);
    if (tel) out.phone.push(tel);
    const addr = r.address;
    if (typeof addr === "string") out.address.push(addr);
    else if (addr && typeof addr === "object") {
      const street = textValue((addr as Record<string, unknown>).streetAddress) ?? textValue((addr as Record<string, unknown>).postalCode);
      if (street) out.address.push(street);
    }
    for (const v of Object.values(r)) if (v && typeof v === "object") visit(v, depth + 1);
  };
  nodes.forEach((n) => visit(n, 0));
  return out;
}

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** The schema.org types the page's microdata names: every `itemtype`, each of its space-separated URLs, the type after schema.org/. */
export function microdataTypesIn(html: string): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(/\bitemtype\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
    for (const u of (m[2] ?? m[3] ?? m[4] ?? "").trim().split(/\s+/)) {
      const t = /^(?:https?:)?\/\/(?:www\.)?schema\.org\/([A-Za-z][A-Za-z0-9]{0,79})\/?$/i.exec(u);
      if (t) out.add(t[1]!);
    }
  }
  return [...out].slice(0, 20);
}

/** The first paragraph of prose with 12 words or more, outside the header, nav, footer and asides, cut at a word within OPENING_CHARS. */
export function openingIn(body: string): string | null {
  const main = body.replace(/<(header|nav|footer|aside|script|style|template|noscript)\b[\s\S]*?<\/\1>/gi, " ");
  for (const p of inner(main, "p")) {
    const t = clean(toProse(p), 2000);
    if (!t || t.split(" ").length < 12) continue;
    if (t.length <= OPENING_CHARS) return t;
    const head = t.slice(0, OPENING_CHARS);
    const at = head.lastIndexOf(" ");
    return (at > OPENING_CHARS * 0.6 ? head.slice(0, at) : head).replace(/[\s,;:-]+$/, "");
  }
  return null;
}

// ---- The page. ----

/** The page's own summary. `url` is where it was read (its final URL); `headers` are the response's, lower-cased. */
export function parseOwnPage(html: string, url: string, headers: Record<string, string> = {}): OwnParse {
  const head = /<head\b[\s\S]*?<\/head>/i.exec(html)?.[0] ?? html;
  const body = /<body\b[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? html;
  const title = clean(inner(head, "title")[0] ?? null, 300);
  let canonical: string | null = null;
  for (const t of tags(head, "link")) {
    if ((attr(t, "rel") ?? "").toLowerCase().split(/\s+/).includes("canonical")) {
      canonical = absolute(attr(t, "href"), url);
      break;
    }
  }
  const metaRobots = meta(head, "robots");
  const xRobots = clean(headers["x-robots-tag"] ?? null, 200);
  const noindex = /\bnoindex\b/i.test(metaRobots ?? "") || /\bnoindex\b/i.test(xRobots ?? "");

  const h1 = inner(body, "h1").map((h) => clean(toProse(h), 200)).filter((h): h is string => h !== null).slice(0, 10);
  const headings: OwnParse["headings"] = [];
  for (const m of body.matchAll(/<h([23])\b[^>]*>([\s\S]*?)<\/h\1>/gi)) {
    const t = clean(toProse(m[2]!), HEADING_CHARS);
    if (t && headings.length < HEADING_MAX) headings.push({ level: Number(m[1]) as 2 | 3, text: t });
  }

  const text = toProse(body.replace(/<template\b[\s\S]*?<\/template>/gi, " "));
  const words = text.split(/\s+/).filter(Boolean);
  const imgs = tags(body, "img");
  const rows = inner(body, "table").map((t) => (t.match(/<tr\b/gi) ?? []).length);

  // Breadcrumbs: a nav (or list) named breadcrumb, else an ordered list of 2+ links before the first H1.
  let crumbHtml: string | null = null;
  const named = /<(nav|ol|ul|div)\b[^>]*(?:aria-label\s*=\s*["'][^"']*breadcrumb[^"']*["']|class\s*=\s*["'][^"']*breadcrumb[^"']*["'])[^>]*>([\s\S]*?)<\/\1>/i.exec(body);
  if (named) crumbHtml = named[2]!;
  else {
    const before = body.slice(0, Math.max(0, body.search(/<h1\b/i)));
    const ol = /<ol\b[^>]*>([\s\S]*?)<\/ol>/i.exec(before);
    if (ol && (ol[1]!.match(/<a\b/gi) ?? []).length >= 2) crumbHtml = ol[1]!;
  }
  const breadcrumbs = crumbHtml
    ? [...crumbHtml.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)]
        .map((m) => ({ name: clean(toProse(m[2]!), 80), url: absolute(attr(m[1]!, "href"), url) }))
        .filter((c): c is { name: string; url: string } => c.name !== null && c.url !== null)
        .slice(0, 8)
    : null;

  // The logo: an image in the header whose src or alt says logo, else og:image.
  const ogImage = absolute(meta(head, "og:image"), url);
  let logo: OwnParse["logo"] = null;
  for (const block of inner(body, "header")) {
    for (const t of tags(block, "img")) {
      const src = attr(t, "src");
      if (/logo/i.test(`${src ?? ""} ${attr(t, "alt") ?? ""}`)) {
        const abs = absolute(src, url);
        if (abs) {
          logo = { url: abs, from: "header" };
          break;
        }
      }
    }
    if (logo) break;
  }
  if (!logo && ogImage) logo = { url: ogImage, from: "og_image" };

  // Profile links: the footer's, or the page's when it has no footer.
  const footers = inner(body, "footer");
  const linkScope = footers.length ? footers.join(" ") : body;
  const social = [...new Set(tags(linkScope, "a").map((t) => absolute(attr(t, "href"), url)).filter((h): h is string => h !== null && profileHost(h)))].slice(0, 12);

  let host = "";
  try {
    host = bareHost(new URL(url).hostname);
  } catch {
    host = "";
  }
  const internal = [
    ...new Set(
      tags(body, "a")
        .map((t) => absolute(attr(t, "href"), url))
        .filter((h): h is string => h !== null)
        .filter((h) => {
          try {
            return bareHost(new URL(h).hostname) === host;
          } catch {
            return false;
          }
        })
        .map((h) => urlKey(h))
        .filter((k): k is string => k !== null),
    ),
  ].slice(0, LINKS_MAX);

  // The byline: meta author, else rel=author, else an element classed author or byline.
  const byline =
    meta(head, "author") ??
    (() => {
      const rel = /<a\b[^>]*rel\s*=\s*["'][^"']*\bauthor\b[^"']*["'][^>]*>([\s\S]*?)<\/a>/i.exec(body);
      if (rel) return clean(toProse(rel[1]!), 80);
      const cls = /<(\w+)\b[^>]*class\s*=\s*["'][^"']*\b(?:author|byline)\b[^"']*["'][^>]*>([\s\S]*?)<\/\1>/i.exec(body);
      return cls ? clean(toProse(cls[2]!).replace(/^by\s+/i, ""), 80) : null;
    })();

  const { nodes, errors } = jsonLdNodes(html);
  const jsonLd: JsonLdNode[] = nodes.slice(0, 40).map((n) => ({
    types: typesOf(n),
    props: Object.keys(n).filter((k) => !k.startsWith("@")).slice(0, 60),
    name: textValue(n.name)?.slice(0, 120) ?? null,
  }));
  const names = new Map<string, Set<string>>();
  for (const n of jsonLd) for (const t of n.types) if (n.name) (names.get(t) ?? names.set(t, new Set()).get(t)!).add(n.name.trim().toLowerCase());
  const conflicts = [...names].filter(([, s]) => s.size > 1).map(([t]) => t);

  const addressHtml = inner(body, "address")[0] ?? null;
  const facts = factsIn(text, h1[0] ?? null, addressHtml);
  const flat = squash(text);
  const mk = markupFacts(nodes);
  const markupOnly: OwnParse["markupOnly"] = [];
  if (mk.price.some((p) => !flat.includes(squash(p).replace(/00$/, "")) && !flat.includes(squash(p)))) markupOnly.push("price");
  if (mk.address.some((a) => !flat.includes(squash(a)))) markupOnly.push("address");
  if (mk.phone.some((p) => !flat.includes(p.replace(/\D/g, "").slice(-7)) && !text.replace(/\D/g, "").includes(p.replace(/\D/g, "").slice(-7)))) markupOnly.push("phone");

  return {
    title,
    description: meta(head, "description"),
    canonical,
    metaRobots,
    xRobots,
    noindex,
    ogSiteName: meta(head, "og:site_name"),
    ogImage,
    publishedTime: meta(head, "article:published_time"),
    modifiedTime: meta(head, "article:modified_time"),
    byline,
    h1,
    headings,
    wordCount: words.length,
    contentHash: createHash("sha256").update(words.join(" ").toLowerCase()).digest("hex").slice(0, 32),
    images: imgs.length,
    imagesWithAlt: imgs.filter((t) => (attr(t, "alt") ?? "").trim().length > 0).length,
    hasTable: rows.some((n) => n >= 3),
    dateShown: DATE_NEAR.test(text),
    breadcrumbs: breadcrumbs && breadcrumbs.length >= 2 ? breadcrumbs : null,
    microdata: /\bitemscope\b/i.test(html),
    microdataTypes: microdataTypesIn(html),
    opening: openingIn(body),
    jsonLd,
    jsonLdErrors: errors,
    conflicts,
    markupOnly,
    reviewsVisible: REVIEWS.test(text),
    logo,
    social,
    facts,
    internal,
  };
}

// ---- What is stored. ----

/** The schema we found, as page_checks.schema_found holds it: types and property names, never a value. */
export type SchemaFound = {
  blocks: { types: string[]; props: string[]; via: "static" | "rendered" }[];
  errors: number;
  conflicts: string[];
  microdata: boolean;
  /** The types the page's static microdata names (absent on a read stored before 13 Oct 2026's review). */
  microdataTypes?: string[];
};

/** The validator's findings, as page_checks.schema_results holds them. */
export type SchemaResults = {
  summary: { fatal: number; error: number; warning: number; info: number };
  items: { types: string[]; props: string[]; results: { level: "fatal" | "error" | "warning" | "info"; message: string }[] }[];
};

export const SCHEMA_PAYLOAD_BYTES = 16_384;

/**
 * An upper bound on a value's size as Postgres stores it in jsonb, before any
 * compression - what page_checks' `pg_column_size(...) <= 16384` checks
 * measure. The JSON text can be smaller than the jsonb: every string, array
 * element and object key carries a 4-byte entry, every container a header
 * and up to 3 bytes of alignment, and a number is a numeric of its own
 * (13 Oct 2026, DIY P8 review: a payload trimmed to just under 16 KB of text,
 * many short property names, could still fail the check after the paid read
 * was made). Each part is counted at its largest, so the bound is never under.
 */
export function jsonbBound(v: unknown): number {
  const node = (x: unknown): number => {
    if (x === null || x === undefined || typeof x === "boolean") return 4;
    if (typeof x === "number") return 4 + 3 + 4 + 2 + 2 * Math.ceil(String(Math.abs(x)).replace(/\D/g, "").length / 4) + 4;
    if (typeof x === "string") return 4 + Buffer.byteLength(x, "utf8");
    if (Array.isArray(x)) return 4 + 3 + 4 + x.reduce((n: number, y) => n + node(y), 0);
    if (typeof x === "object") return 4 + 3 + 4 + Object.entries(x as Record<string, unknown>).reduce((n, [k, y]) => n + node(k) + node(y), 0);
    return 4 + Buffer.byteLength(String(x), "utf8");
  };
  // The datum's own 4-byte header, on top of the root's.
  return 4 + node(v);
}
export const SCHEMA_RESULTS_MAX = 40;
export const SCHEMA_MESSAGE_CHARS = 160;

const LEVELS = ["fatal", "error", "warning", "info"] as const;

/**
 * The two payloads cut to page_checks' shape before insert (spec 5.8): types
 * and property names only - a field that arrives with a value keeps its name
 * and loses the value - a level and a message of at most 160 characters per
 * result, at most 40 results across the items, and each payload at most 16 KB
 * as jsonb stores it (jsonbBound; items dropped from the end until it fits).
 * The database's own checks are the backstop, never the first line.
 */
export function capSchemaPayload(
  found: SchemaFound | null,
  results: { summary?: Partial<Record<(typeof LEVELS)[number], number>>; items?: { types?: unknown; fields?: { name?: unknown }[]; props?: unknown; results?: { level?: unknown; message?: unknown }[] }[] } | null,
): { found: SchemaFound | null; results: SchemaResults | null } {
  const name = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : null);
  const fit = <T>(value: T, shrink: (v: T) => T | null): T | null => {
    let v: T | null = value;
    while (v !== null && (jsonbBound(v) > SCHEMA_PAYLOAD_BYTES || Buffer.byteLength(JSON.stringify(v), "utf8") > SCHEMA_PAYLOAD_BYTES)) v = shrink(v);
    return v;
  };
  let outFound: SchemaFound | null = null;
  if (found) {
    const blocks = found.blocks.slice(0, 40).map((b) => ({
      types: b.types.map((t) => name(t, 80)).filter((t): t is string => t !== null).slice(0, 10),
      props: b.props.map((p) => name(p, 80)).filter((p): p is string => p !== null).slice(0, 60),
      via: b.via === "rendered" ? ("rendered" as const) : ("static" as const),
    }));
    const microdataTypes = (found.microdataTypes ?? []).map((t) => name(t, 80)).filter((t): t is string => t !== null).slice(0, 20);
    outFound = fit({ blocks, errors: Math.max(0, Math.floor(found.errors)), conflicts: found.conflicts.map((c) => name(c, 80)).filter((c): c is string => c !== null).slice(0, 10), microdata: found.microdata === true, microdataTypes }, (v) =>
      v.blocks.length ? { ...v, blocks: v.blocks.slice(0, -1) } : null,
    );
  }
  let outResults: SchemaResults | null = null;
  if (results) {
    let left = SCHEMA_RESULTS_MAX;
    const items: SchemaResults["items"] = [];
    for (const it of (results.items ?? []).slice(0, 50)) {
      const types = [it.types].flat().map((t) => name(t, 80)).filter((t): t is string => t !== null).slice(0, 10);
      const props = (Array.isArray(it.props) ? (it.props as unknown[]) : (it.fields ?? []).map((f) => f?.name)).map((p) => name(p, 80)).filter((p): p is string => p !== null).slice(0, 60);
      const res: SchemaResults["items"][number]["results"] = [];
      for (const r of it.results ?? []) {
        if (left <= 0) break;
        const level = LEVELS.find((l) => l === r?.level);
        const message = name(r?.message, SCHEMA_MESSAGE_CHARS);
        if (!level || !message) continue;
        res.push({ level, message });
        left -= 1;
      }
      items.push({ types, props, results: res });
    }
    const s = results.summary ?? {};
    const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
    outResults = fit({ summary: { fatal: n(s.fatal), error: n(s.error), warning: n(s.warning), info: n(s.info) }, items }, (v) => (v.items.length ? { ...v, items: v.items.slice(0, -1) } : null));
  }
  return { found: outFound, results: outResults };
}

/** The schema an own read found, before capping. */
export function schemaFoundOf(p: Pick<OwnParse, "jsonLd" | "jsonLdErrors" | "conflicts" | "microdata"> & { microdataTypes?: string[] }, via: "static" | "rendered" = "static"): SchemaFound {
  return { blocks: p.jsonLd.map((n) => ({ types: n.types, props: n.props, via })), errors: p.jsonLdErrors, conflicts: p.conflicts, microdata: p.microdata, microdataTypes: p.microdataTypes ?? [] };
}
