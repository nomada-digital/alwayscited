/**
 * "Schema for your site" (Danny, 14 Nov 2026): the JSON-LD a customer can add to their own site, built from what their
 * pages already say - never an invented detail. Each block says where it goes. Pure: the pages arrive read and parsed
 * (schema-read.ts); nothing here fetches.
 *
 * - Organization, or LocalBusiness for a customer on the map pack or whose homepage shows an address: name, url, and
 *   only what the homepage itself carries - logo, its social and review profiles (sameAs), the address and phone as
 *   written, the meta description - plus areaServed, the market their dashboard tracks.
 * - WebSite on the homepage, published by that organisation.
 * - Service for each cluster, on its target page, named by the page's own heading.
 * - FAQPage where a page asks questions as headings and answers them under each, the words copied as they are.
 * - Article where a target page is a dated post.
 *
 * A node the site already has with an @id is extended, not duplicated: the block repeats that @id and adds only the
 * properties it lacks. Imports are relative and carry the extension (pure, as dataforseo-request.ts).
 */

export type PageFacts = {
  url: string;
  title: string | null;
  description: string | null;
  h1: string | null;
  ogSiteName: string | null;
  logo: string | null;
  social: string[];
  addressText: string | null;
  phoneText: string | null;
  publishedTime: string | null;
  modifiedTime: string | null;
  byline: string | null;
  /** The page's own JSON-LD nodes, whole. */
  nodes: Record<string, unknown>[];
  /** Questions asked as headings, each with the text under it. */
  faqs: { q: string; a: string }[];
};

export type SchemaInput = {
  domain: string;
  brand: string | null;
  market: string;
  local: boolean;
  home: PageFacts | null;
  clusters: { name: string; keyword: string | null; target: string | null; page: PageFacts | null }[];
};

export type SchemaBlock = { id: string; label: string; where: "sitewide" | string; jsonld: Record<string, unknown>; extends: string | null; liveIds: string[] };
export type SchemaPlan = { blocks: SchemaBlock[]; notes: string[] };

const COUNTRY: Record<string, string> = { GB: "United Kingdom", UK: "United Kingdom", US: "United States", IE: "Ireland", AU: "Australia", CA: "Canada", NZ: "New Zealand", DE: "Germany", FR: "France", ES: "Spain", NL: "Netherlands" };
const ORG_TYPES = ["Organization", "LocalBusiness", "Corporation", "ProfessionalService", "Store", "OnlineStore"];

const typesOf = (n: Record<string, unknown>) => (Array.isArray(n["@type"]) ? n["@type"] : [n["@type"]]).filter((t): t is string => typeof t === "string");
const has = (n: Record<string, unknown>, k: string) => n[k] !== undefined && n[k] !== null && n[k] !== "" && !(Array.isArray(n[k]) && (n[k] as unknown[]).length === 0);
const isOrg = (t: string) => ORG_TYPES.includes(t) || /Business$|Service$|Store$/.test(t) && t !== "Service";

/** The site's own node of one of these types, preferring one with an @id. */
function existing(nodes: readonly Record<string, unknown>[], pick: (t: string) => boolean): Record<string, unknown> | null {
  const all = nodes.filter((n) => typesOf(n).some(pick));
  return all.find((n) => typeof n["@id"] === "string") ?? all[0] ?? null;
}

/** A full node, or - for one the site already has with an @id - that @id and only what it lacks; null when it lacks nothing. */
function extendOrNew(want: Record<string, unknown>, have: Record<string, unknown> | null): { node: Record<string, unknown> | null; extends: string | null } {
  if (!have || typeof have["@id"] !== "string") return { node: want, extends: null };
  const add = Object.fromEntries(Object.entries(want).filter(([k]) => k !== "@context" && k !== "@id" && k !== "@type" && !has(have, k)));
  if (!Object.keys(add).length) return { node: null, extends: have["@id"] as string };
  return { node: { "@context": "https://schema.org", "@id": have["@id"], "@type": typesOf(have)[0] ?? want["@type"], ...add }, extends: have["@id"] as string };
}

const clip = (s: string | null | undefined, n: number) => (s ? s.replace(/\s+/g, " ").trim().slice(0, n) : null);

export function buildSchema(p: SchemaInput): SchemaPlan {
  const blocks: SchemaBlock[] = [];
  const notes: string[] = [];
  const root = `https://${p.domain.replace(/^https?:\/\//, "").replace(/\/+$/, "")}/`;
  const orgId = `${root}#organization`;
  const siteId = `${root}#website`;
  const area = COUNTRY[p.market.toUpperCase()] ?? null;
  const home = p.home;
  const name = clip(p.brand, 120) ?? clip(home?.ogSiteName, 120) ?? clip(home?.title?.split(/\s[|\-\u2013]\s/)[0], 120);

  if (!home) notes.push("We couldn't read your homepage just now, so this is built from your dashboard details only. Press Check again later.");
  if (!name) notes.push("We couldn't find your business name on your homepage. Your developer should add a name before using the organisation markup.");

  // Organization or LocalBusiness, sitewide.
  const local = p.local || !!home?.addressText;
  const org: Record<string, unknown> = { "@context": "https://schema.org", "@type": local ? "LocalBusiness" : "Organization", "@id": orgId, ...(name ? { name } : {}), url: root };
  if (home?.logo) org.logo = home.logo;
  if (home?.social.length) org.sameAs = [...new Set(home.social)].slice(0, 10);
  if (home?.description) org.description = clip(home.description, 300);
  if (home?.addressText) org.address = clip(home.addressText, 200);
  if (home?.phoneText) org.telephone = home.phoneText;
  if (area) org.areaServed = area;
  const haveOrg = home ? existing(home.nodes, isOrg) : null;
  const o = extendOrNew(org, haveOrg);
  const orgRef = o.extends ?? orgId;
  if (o.node) blocks.push({ id: "organization", label: o.extends ? `Add to your existing ${typesOf(haveOrg!)[0]} markup` : local ? "Your business (LocalBusiness)" : "Your business (Organization)", where: "sitewide", jsonld: o.node, extends: o.extends, liveIds: [orgRef] });
  else notes.push("Your site already describes your business with everything we would add. Nothing to change there.");
  if (haveOrg && typeof haveOrg["@id"] !== "string") notes.push(`Your homepage already has ${typesOf(haveOrg)[0]} markup without an @id. Give it the @id ${orgId} and add what's missing from the block below, rather than adding a second copy.`);
  if (!home?.logo) notes.push("No logo found on your homepage, so none is included. Add one when you have it.");
  if (!home?.social.length) notes.push("No social or review profile links found on your homepage, so sameAs is left out.");
  if (local && !home?.addressText) notes.push("We couldn't find your address on your homepage, so it's left out. Add it there and press Check again.");

  // WebSite, on the homepage.
  const site: Record<string, unknown> = { "@context": "https://schema.org", "@type": "WebSite", "@id": siteId, url: root, ...(name ? { name } : {}), publisher: { "@id": orgRef } };
  const ws = extendOrNew(site, home ? existing(home.nodes, (t) => t === "WebSite") : null);
  if (ws.node) blocks.push({ id: "website", label: ws.extends ? "Add to your existing WebSite markup" : "Your website (WebSite)", where: root, jsonld: ws.node, extends: ws.extends, liveIds: [ws.extends ?? siteId] });

  // Per cluster: Service on its target page, and FAQPage or Article where that page calls for it.
  for (const c of p.clusters) {
    if (!c.target) {
      notes.push(`"${c.name}" has no target page yet, so its service markup is waiting for one.`);
      continue;
    }
    const pg = c.page;
    const svcId = `${c.target.replace(/#.*$/, "")}#service`;
    const svc: Record<string, unknown> = { "@context": "https://schema.org", "@type": "Service", "@id": svcId, name: clip(pg?.h1, 120) ?? c.name, ...(c.keyword ? { serviceType: c.keyword } : {}), provider: { "@id": orgRef }, url: c.target };
    if (pg?.description) svc.description = clip(pg.description, 300);
    if (area) svc.areaServed = area;
    const sv = extendOrNew(svc, pg ? existing(pg.nodes, (t) => t === "Service" || t === "Product") : null);
    if (sv.node) blocks.push({ id: `service:${c.target}`, label: sv.extends ? `Add to the existing markup on ${short(c.target)}` : `${c.name} (Service)`, where: c.target, jsonld: sv.node, extends: sv.extends, liveIds: [sv.extends ?? svcId] });
    if (pg && pg.faqs.length >= 2 && !existing(pg.nodes, (t) => t === "FAQPage")) {
      blocks.push({ id: `faq:${c.target}`, label: `Questions on ${short(c.target)} (FAQPage)`, where: c.target, extends: null, liveIds: [`${c.target}#faq`],
        jsonld: { "@context": "https://schema.org", "@type": "FAQPage", "@id": `${c.target}#faq`, mainEntity: pg.faqs.slice(0, 10).map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) } });
    }
    if (pg?.publishedTime && !existing(pg.nodes, (t) => /Article|BlogPosting/.test(t))) {
      blocks.push({ id: `article:${c.target}`, label: `The article on ${short(c.target)} (Article)`, where: c.target, extends: null, liveIds: [`${c.target}#article`],
        jsonld: { "@context": "https://schema.org", "@type": "Article", "@id": `${c.target}#article`, headline: clip(pg.h1 ?? pg.title, 110), datePublished: pg.publishedTime, ...(pg.modifiedTime ? { dateModified: pg.modifiedTime } : {}), ...(pg.byline ? { author: { "@type": "Person", name: pg.byline } } : {}), publisher: { "@id": orgRef }, mainEntityOfPage: c.target } });
    }
  }
  return { blocks, notes };
}

export const short = (u: string) => u.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/+$/, "") || u;

// ---- Where it goes, three ways. ----

export type Platform = "shopify" | "wordpress" | "webflow" | "squarespace" | "wix" | null;
export const PLATFORM_NAME: Record<Exclude<Platform, null>, string> = { shopify: "Shopify", wordpress: "WordPress", webflow: "Webflow", squarespace: "Squarespace", wix: "Wix" };

/** The site's platform from its homepage HTML and headers, or null when it does not say. */
export function detectPlatform(html: string, headers: Record<string, string> = {}): Platform {
  const h = html.slice(0, 400_000);
  if (/cdn\.shopify\.com|Shopify\.theme|myshopify\.com/i.test(h) || headers["x-shopid"] || headers["x-shopify-stage"]) return "shopify";
  if (/static1\.squarespace\.com|squarespace-cdn\.com|Squarespace\.Constants/i.test(h)) return "squarespace";
  if (/data-wf-site|webflow\.js|assets\.website-files\.com|cdn\.prod\.website-files\.com/i.test(h)) return "webflow";
  if (/static\.wixstatic\.com|wix-bolt|_wixCssImports/i.test(h) || headers["x-wix-request-id"]) return "wix";
  if (/\/wp-content\/|\/wp-includes\/|wp-json/i.test(h) || /WordPress/i.test(headers["x-powered-by"] ?? "")) return "wordpress";
  return null;
}

export const scriptTag = (b: SchemaBlock) => `<script type="application/ld+json">\n${JSON.stringify(b.jsonld, null, 2)}\n</script>`;
export const whereText = (b: SchemaBlock) => (b.where === "sitewide" ? "Every page (in the <head> of your site template)" : `Only on ${short(b.where)}`);

const STEPS: Record<Exclude<Platform, null>, { sitewide: string; page: string }> = {
  shopify: { sitewide: "In Shopify admin go to Online Store > Themes > Edit code, open layout/theme.liquid and paste it just before </head>.", page: "In theme.liquid, wrap it in {% if request.path == '<path>' %} ... {% endif %} just before </head>, so it only appears on that page." },
  wordpress: { sitewide: "Use a header-code plugin such as WPCode (Code Snippets > Header & Footer > Header), or the theme's header settings. If Yoast or Rank Math already outputs Organization or WebSite markup, extend theirs instead of adding a second copy.", page: "Edit that page, add a Custom HTML block and paste it there, or use WPCode's page-level header snippet." },
  webflow: { sitewide: "In Webflow go to Site settings > Custom code > Head code, paste it and publish.", page: "Open that page's settings > Custom code > Inside <head> tag, paste it and publish." },
  squarespace: { sitewide: "Go to Settings > Advanced > Code Injection > Header and paste it (needs a Business plan or higher).", page: "Open that page's settings > Advanced > Page Header Code Injection and paste it." },
  wix: { sitewide: "Go to Settings > Custom code > Add custom code, paste it, choose All pages and Head, and apply.", page: "Go to Settings > Custom code > Add custom code, paste it, choose that one page and Head, and apply." },
};

/** "For your developer": every script tag with where it goes. */
export function developerText(plan: SchemaPlan, platform: Platform): string {
  return plan.blocks.map((b) => `<!-- ${b.label}. Goes on: ${whereText(b)}${b.extends ? `. Extends your existing markup with @id ${b.extends}: merge these properties into it rather than adding a second node` : ""} -->\n${scriptTag(b)}`).join("\n\n")
    + (platform ? `\n\n<!-- Your site looks like it runs on ${PLATFORM_NAME[platform]}. -->` : "");
}

/** "Ask an AI to add it": a prompt for ChatGPT, Claude, or an AI browser agent working in the customer's CMS. */
export function aiPrompt(plan: SchemaPlan, p: { domain: string; platform: Platform }): string {
  const plat = p.platform;
  const steps = (b: SchemaBlock) => {
    if (!plat) return b.where === "sitewide" ? "Add it to the <head> of every page (the site-wide header or theme template)." : `Add it to the <head> of ${b.where} only.`;
    const s = STEPS[plat];
    return b.where === "sitewide" ? s.sitewide : s.page.replace("<path>", (() => { try { return new URL(b.where).pathname; } catch { return b.where; } })()) + ` The page is ${b.where}.`;
  };
  return [
    `I want to add structured data (JSON-LD schema) to my website, ${p.domain}${plat ? `, which runs on ${PLATFORM_NAME[plat]}` : ""}. Please help me add it, or if you can work in my browser, add it for me through the ${plat ? PLATFORM_NAME[plat] : "site's"} admin.`,
    "",
    "Rules:",
    "- Add each block exactly as written. Don't change the values or invent new details.",
    "- Before adding, check whether the page already has JSON-LD of the same type. If it does, merge the new properties into the existing block (keep the same @id) instead of adding a second copy.",
    "- After adding, test each page in Google's Rich Results Test (https://search.google.com/test/rich-results) and the Schema Markup Validator (https://validator.schema.org), and tell me about any errors or warnings.",
    "",
    ...plan.blocks.flatMap((b, i) => [`${i + 1}. ${b.label}`, `Where: ${whereText(b)}. ${steps(b)}`, b.extends ? `This extends markup the site already has (@id ${b.extends}). Merge these properties into it.` : "", scriptTag(b), ""]).filter((l, i, a) => l !== "" || a[i - 1] !== ""),
    plat ? "" : "If you can tell which platform the site is built on (Shopify, WordPress, Webflow, Squarespace or Wix), use that platform's own place for header code.",
  ].join("\n").trim();
}

/** "Google Tag Manager": one Custom HTML tag a block, with its trigger. */
export function gtmText(plan: SchemaPlan): string {
  return plan.blocks.map((b) => {
    const trig = b.where === "sitewide" ? "Trigger: All Pages" : `Trigger: Page View where Page URL equals ${b.where}`;
    return `Tag name: Schema - ${b.label}\nTag type: Custom HTML\n${trig}\n\n${scriptTag(b)}`;
  }).join("\n\n----------\n\n");
}

/**
 * Whether each block is on the live pages now: a JSON-LD node with the block's @id that carries every property the
 * block adds. A block extending existing markup is live once those properties are on that node.
 */
export function liveStatus(plan: SchemaPlan, pages: readonly (PageFacts | null)[]): { id: string; live: boolean }[] {
  const norm = (s: string) => s.replace(/\/+#/, "/#").replace(/^http:/, "https:").toLowerCase();
  const byId = new Map<string, Record<string, unknown>[]>();
  for (const pg of pages) for (const n of pg?.nodes ?? []) if (typeof n["@id"] === "string") byId.set(norm(n["@id"] as string), [...(byId.get(norm(n["@id"] as string)) ?? []), n]);
  return plan.blocks.map((b) => {
    const id = typeof b.jsonld["@id"] === "string" ? norm(b.jsonld["@id"] as string) : null;
    const nodes = id ? (byId.get(id) ?? []) : [];
    const keys = Object.keys(b.jsonld).filter((k) => !k.startsWith("@"));
    return { id: b.id, live: nodes.length > 0 && keys.every((k) => nodes.some((n) => has(n, k))) };
  });
}
