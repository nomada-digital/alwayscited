import { typeByRule } from "./fit.ts";
import type { SchemaFound, SchemaResults } from "./own-parse.ts";
import type { Basics } from "./types.ts";

/**
 * The schema check (13 Oct 2026, DIY P8; spec 10 section 6.4, the rule
 * table): which of the table's checks apply to one page, and what each says.
 * Pure. The words are schema.advice.ts's, by id; this decides only whether a
 * line applies and fills its blanks.
 *
 * Copy says "the structured data we found", never "the schema Google sees":
 * whether a JavaScript read catches JSON-LD a tag manager injects is
 * [VERIFY] on a real client site (section 6.4).
 *
 * Two narrowings, both on the side of saying less:
 *
 * - LocalBusiness is suggested on the homepage and on a contact or location
 *   page only. A software company's footer address is on every page, and
 *   "add LocalBusiness" on each of them would be noise, not a check.
 * - SoftwareApplication is not checked at all until Google's requirements are
 *   read from its own page (pages.sources.ts V-SOFTWAREAPP, [VERIFY]).
 *
 * Three more, from the review of 13 Oct 2026:
 *
 * - Product is checked only on a page that is a product or pricing page by
 *   its own signs (looksLikeProduct): never the homepage or an article, which
 *   mention prices in passing, and a Product named after a headline would
 *   mark a page up as something it is not - against G2, the line's own
 *   source. Its absence is a suggestion (level `suggest`): the fix drafts it,
 *   and it does not hold the page's fit at "fix first".
 * - A type the page carries as static microdata (`itemtype`) is found: it is
 *   never called missing, never handed a duplicate block, and never "only
 *   after JavaScript". Its properties are not read, so no "missing
 *   properties" line is drawn for it either.
 * - Hidden ratings are said as "remove it" only when the JavaScript read shows
 *   the page's HTML is the whole page (its word count no more than the
 *   static one's, give or take). A review widget drawn by script is not in
 *   the HTML, so otherwise the line says only what we didn't see, as info.
 */

/** The types each check looks for, any of which counts. */
export const ORG_TYPES = ["Organization", "Corporation", "OnlineBusiness", "OnlineStore", "LocalBusiness", "NGO", "EducationalOrganization", "MedicalOrganization", "SportsOrganization"];
export const LOCAL_TYPES = ["LocalBusiness", "Store", "ProfessionalService", "Restaurant", "MedicalBusiness", "HomeAndConstructionBusiness", "AutomotiveBusiness", "FinancialService", "LegalService"];
export const ARTICLE_TYPES = ["Article", "BlogPosting", "NewsArticle", "TechArticle"];

/** Our own required-property table: what a block of each type needs before we call it whole (the fix is checked against it). */
export const REQUIRED: Record<string, readonly string[]> = {
  Organization: ["name", "url", "logo", "sameAs"],
  WebSite: ["name", "url"],
  BreadcrumbList: ["itemListElement"],
  Product: ["name", "offers"],
  LocalBusiness: ["name", "address"],
  Article: ["headline", "author", "datePublished"],
};

/** fix and remove hold a page's fit at "fix first"; suggest is drafted by the fix but does not; info is said only. */
export type FindingLevel = "fix" | "remove" | "suggest" | "info";

export type Finding = {
  /** The advice line, schema.advice.ts. */
  id: string;
  /** The schema type the line is about, or null for a page-wide one. */
  type: string | null;
  level: FindingLevel;
  /** The blanks the line fills. */
  vars: Record<string, string | number>;
  /** For a block that is there and incomplete: the properties it lacks. */
  missing?: string[];
};

export type SchemaInput = {
  url: string;
  homepage: boolean;
  basics: Basics | null;
  /** Our static read's blocks. */
  found: SchemaFound | null;
  /** The JavaScript read's validator, when one has run. */
  results: SchemaResults | null;
  /** Word counts: our static read's, and the JavaScript read's when one has run. */
  words?: { static: number | null; rendered: number | null };
};

/** A type is on the page as static microdata. */
const inMicrodata = (found: SchemaFound | null, types: readonly string[]) => (found?.microdataTypes ?? []).some((t) => types.includes(t));
/** A type is on the page: a JSON-LD block, or static microdata. */
const hasType = (found: SchemaFound | null, types: readonly string[]) => (found?.blocks ?? []).some((b) => b.types.some((t) => types.includes(t))) || inMicrodata(found, types);
const blockOf = (found: SchemaFound | null, types: readonly string[]) => (found?.blocks ?? []).find((b) => b.types.some((t) => types.includes(t))) ?? null;
const and = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}` : (xs[0] ?? ""));

function pathOf(url: string): string {
  try {
    return new URL(url).pathname.toLowerCase();
  } catch {
    return "";
  }
}

/** A blog or article page, by its own signs: an article published time, or a blog-like path. */
export function looksLikeArticle(url: string, basics: Basics | null): boolean {
  return Boolean(basics?.publishedTime) || /\/(blog|news|articles?|posts?|guides?|insights|resources)\//.test(pathOf(url));
}

const LOCATION_PATH = /\/(contact|contact-us|locations?|stores?|find-us|visit|branches)(\/|$)/;

/**
 * A product or pricing page by its own signs: a product path by rule
 * (fit.ts typeByRule), a Product or Offer already marked up, or a price
 * shown just after the H1. Never the homepage or an article.
 */
export function looksLikeProduct(p: Pick<SchemaInput, "url" | "homepage" | "basics" | "found">): boolean {
  if (p.homepage || looksLikeArticle(p.url, p.basics)) return false;
  if (typeByRule(p.url) === "product") return true;
  if (hasType(p.found, ["Product", "Offer", "AggregateOffer"])) return true;
  return p.basics?.facts.priceNearH1 === true;
}

/** The JavaScript read found no more text than our static read: the HTML is the whole page. */
export function htmlIsWholePage(words: SchemaInput["words"]): boolean {
  const s = words?.static ?? null;
  const r = words?.rendered ?? null;
  return s !== null && r !== null && r <= s * 1.05 + 25;
}

/** Errors (fatal and error) the validator found, per type. */
export function validatorErrors(results: SchemaResults | null): { total: number; byType: Map<string, number>; messages: string[] } {
  const byType = new Map<string, number>();
  const messages: string[] = [];
  let total = 0;
  for (const it of results?.items ?? []) {
    const n = it.results.filter((r) => r.level === "fatal" || r.level === "error").length;
    total += n;
    for (const t of it.types) byType.set(t, (byType.get(t) ?? 0) + n);
    for (const r of it.results) if (r.level === "fatal" || r.level === "error") messages.push(r.message);
  }
  if (!results?.items.length && results) total = results.summary.fatal + results.summary.error;
  return { total, byType, messages: messages.slice(0, 12) };
}

/** Every check of the rule table that applies to this page, in the table's order. */
export function schemaFindings(p: SchemaInput): Finding[] {
  const out: Finding[] = [];
  const b = p.basics;
  const f = p.found;
  if (p.homepage) {
    const org = blockOf(f, ORG_TYPES);
    if (!org) {
      if (!inMicrodata(f, ORG_TYPES)) out.push({ id: "pages.schema.organization", type: "Organization", level: "fix", vars: {} });
    } else {
      const missing = REQUIRED.Organization!.filter((k) => !org.props.includes(k));
      if (missing.length) out.push({ id: "pages.schema.organization_props", type: "Organization", level: "fix", vars: { props: and(missing) }, missing });
    }
    if (!hasType(f, ["WebSite"])) out.push({ id: "pages.schema.website", type: "WebSite", level: "fix", vars: {} });
  }
  if (b?.breadcrumbs && !hasType(f, ["BreadcrumbList"])) out.push({ id: "pages.schema.breadcrumbs", type: "BreadcrumbList", level: "fix", vars: {} });
  if (b?.facts.price && looksLikeProduct(p) && !hasType(f, ["Product"])) out.push({ id: "pages.schema.product", type: "Product", level: "suggest", vars: {} });
  if (hasType(f, ["Product"]) && b?.markupOnly.includes("price")) out.push({ id: "pages.schema.product_hidden", type: "Product", level: "remove", vars: {} });
  const rated = (f?.blocks ?? []).some((x) => x.types.some((t) => t === "AggregateRating" || t === "Review") || x.props.includes("aggregateRating") || x.props.includes("review"));
  if (rated && b && !b.reviewsVisible) {
    out.push(htmlIsWholePage(p.words) ? { id: "pages.schema.rating_hidden", type: "AggregateRating", level: "remove", vars: {} } : { id: "pages.schema.rating_unseen", type: "AggregateRating", level: "info", vars: {} });
  }
  if (b?.facts.address && (p.homepage || LOCATION_PATH.test(pathOf(p.url))) && !hasType(f, LOCAL_TYPES)) out.push({ id: "pages.schema.local", type: "LocalBusiness", level: "fix", vars: {} });
  if (looksLikeArticle(p.url, b)) {
    const art = blockOf(f, ARTICLE_TYPES);
    if (!art) {
      if (!inMicrodata(f, ARTICLE_TYPES)) out.push({ id: "pages.schema.article", type: "Article", level: "fix", vars: {} });
    } else {
      const missing = REQUIRED.Article!.filter((k) => !art.props.includes(k));
      if (missing.length) out.push({ id: "pages.schema.article_props", type: "Article", level: "fix", vars: { props: and(missing) }, missing });
    }
  }
  const v = validatorErrors(p.results);
  if (v.total > 0) out.push({ id: "pages.schema.validator", type: null, level: "fix", vars: { n: `${v.total} ${v.total === 1 ? "error" : "errors"}` } });
  for (const t of f?.conflicts ?? []) out.push({ id: "pages.schema.conflict", type: t, level: "fix", vars: { type: t } });
  // Static means our own read of the HTML: its JSON-LD blocks and its microdata both.
  const staticTypes = new Set([...(f?.blocks ?? []).filter((x) => x.via === "static").flatMap((x) => x.types), ...(f?.microdataTypes ?? [])]);
  const renderedOnly = [...new Set((p.results?.items ?? []).flatMap((it) => it.types))].filter((t) => !staticTypes.has(t));
  for (const t of renderedOnly) out.push({ id: "pages.schema.js_only", type: t, level: "info", vars: {} });
  for (const fact of b?.markupOnly ?? []) {
    if (fact === "price") continue; // product_hidden says it
    out.push({ id: "pages.schema.facts_text", type: null, level: "fix", vars: { fact: fact === "phone" ? "phone number" : fact } });
  }
  if (hasType(f, ["FAQPage"])) out.push({ id: "pages.schema.faq", type: "FAQPage", level: "info", vars: {} });
  if ((f?.errors ?? 0) > 0) out.push({ id: "pages.schema.unparsed", type: null, level: "fix", vars: { n: f!.errors } });
  return out;
}

export type SchemaChip = { label: string; tone: "good" | "warn" | "bad" | "none" };

/**
 * The list's Schema chip (section 4.9): OK · 2 errors · Missing Organization ·
 * Not checked. An unreadable page is "Not checked" - never "no schema"
 * (section 4.9, Unreadable page).
 */
export function schemaChip(p: SchemaInput & { checked: boolean; readable: boolean }): SchemaChip {
  if (!p.checked || !p.readable) return { label: "Not checked", tone: "none" };
  const v = validatorErrors(p.results);
  if (v.total > 0) return { label: `${v.total} ${v.total === 1 ? "error" : "errors"}`, tone: "bad" };
  const fixes = schemaFindings(p).filter((x) => x.level !== "info");
  const missingType = fixes.find((x) => x.id === "pages.schema.organization" || x.id === "pages.schema.website" || x.id === "pages.schema.product" || x.id === "pages.schema.breadcrumbs" || x.id === "pages.schema.local" || x.id === "pages.schema.article");
  if (missingType) return { label: `Missing ${missingType.type}`, tone: "warn" };
  if (fixes.length) return { label: fixes.length === 1 ? "1 to fix" : `${fixes.length} to fix`, tone: "warn" };
  return { label: "OK", tone: "good" };
}

/** The types found, and where: static HTML (JSON-LD or microdata), or only after JavaScript (the Schema tab's Found). */
export function foundTypes(found: SchemaFound | null, results: SchemaResults | null): { type: string; where: "static" | "rendered"; microdata: boolean }[] {
  const out = new Map<string, { where: "static" | "rendered"; microdata: boolean }>();
  for (const b of found?.blocks ?? []) for (const t of b.types) out.set(t, { where: "static", microdata: false });
  for (const t of found?.microdataTypes ?? []) if (!out.has(t)) out.set(t, { where: "static", microdata: true });
  for (const it of results?.items ?? []) for (const t of it.types) if (!out.has(t)) out.set(t, { where: "rendered", microdata: false });
  return [...out].map(([type, v]) => ({ type, ...v }));
}
