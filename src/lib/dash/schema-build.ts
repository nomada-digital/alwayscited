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
 * Live first (Danny, 14 Nov 2026: "always check the live schema first, then work out what to recommend"): every
 * block is compared with what the pages carry now - their JSON-LD (matched by @id, else by type), what a rendered read
 * found (schema an app or plugin injects with JavaScript, page_checks), and microdata - and comes out Already on your
 * site, Partly there (only the missing fields are given, on the existing node's @id), or Missing. Nothing the site
 * already says is repeated. The pages are re-read every time this is built. Imports are relative and carry the
 * extension (pure, as dataforseo-request.ts).
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
  /** Types the page's microdata names (itemtype). */
  microdataTypes?: string[];
  /** Blocks a rendered read of the page found (JavaScript-injected schema included): types and property names only. */
  rendered?: { types: string[]; props: string[] }[];
};

export type SchemaInput = {
  domain: string;
  brand: string | null;
  market: string;
  local: boolean;
  home: PageFacts | null;
  clusters: { name: string; keyword: string | null; target: string | null; page: PageFacts | null }[];
};

export type BlockStatus = "already" | "partly" | "missing";
/** `jsonld` is what to add: the whole block when missing, only the missing fields (on the existing @id) when partly. */
export type SchemaBlock = { id: string; label: string; where: "sitewide" | string; jsonld: Record<string, unknown>; extends: string | null; liveIds: string[]; status: BlockStatus; missing: string[]; existingType: string | null };
export type SchemaPlan = { blocks: SchemaBlock[]; notes: string[] };

const COUNTRY: Record<string, string> = { GB: "United Kingdom", UK: "United Kingdom", US: "United States", IE: "Ireland", AU: "Australia", CA: "Canada", NZ: "New Zealand", DE: "Germany", FR: "France", ES: "Spain", NL: "Netherlands" };
const ORG_TYPES = ["Organization", "LocalBusiness", "Corporation", "ProfessionalService", "Store", "OnlineStore"];

const typesOf = (n: Record<string, unknown>) => (Array.isArray(n["@type"]) ? n["@type"] : [n["@type"]]).filter((t): t is string => typeof t === "string");
const has = (n: Record<string, unknown>, k: string) => n[k] !== undefined && n[k] !== null && n[k] !== "" && !(Array.isArray(n[k]) && (n[k] as unknown[]).length === 0);
const isOrg = (t: string) => ORG_TYPES.includes(t) || (t !== "Service" && /(Organization|Business|Agency|Service|Store|Shop|Company|Studio|Clinic|Firm|Office|Restaurant|Practice)$/.test(t));

type Evidence = { id: string | null; type: string; props: Set<string> };
const normId = (x: string) => x.replace(/\/+#/, "/#").replace(/^http:/, "https:").replace(/\/\/www\./, "//").toLowerCase();

/** What the pages already carry of these types: JSON-LD nodes (with their @id), rendered reads, microdata. */
function evidence(pages: readonly (PageFacts | null)[], pick: (t: string) => boolean): Evidence[] {
  const out: Evidence[] = [];
  for (const pg of pages) {
    if (!pg) continue;
    for (const n of pg.nodes) {
      const t = typesOf(n).find(pick);
      if (t) out.push({ id: typeof n["@id"] === "string" ? (n["@id"] as string) : null, type: t, props: new Set(Object.keys(n).filter((k) => !k.startsWith("@") && has(n, k))) });
    }
    for (const b of pg.rendered ?? []) {
      const t = b.types.find(pick);
      if (t) out.push({ id: null, type: t, props: new Set(b.props) });
    }
    for (const t of pg.microdataTypes ?? []) {
      const bare = t.replace(/^https?:\/\/schema\.org\//i, "");
      if (pick(bare)) out.push({ id: null, type: bare, props: new Set() });
    }
  }
  return out;
}

/**
 * The block as the site stands: missing (no such node anywhere), already there (every field it would add is there),
 * or partly there - then only the missing fields, on the existing node's @id (ours when it has none, with a note to
 * give it that @id so the two join up rather than read as two businesses).
 */
function compare(want: Record<string, unknown>, ev: Evidence[]): { status: BlockStatus; missing: string[]; jsonld: Record<string, unknown>; id: string; existingType: string | null; idless: boolean } {
  const wantId = want["@id"] as string;
  const fields = Object.keys(want).filter((k) => !k.startsWith("@"));
  if (!ev.length) return { status: "missing", missing: fields, jsonld: want, id: wantId, existingType: null, idless: false };
  const sameId = ev.filter((e) => e.id && normId(e.id) === normId(wantId));
  const withId = ev.find((e) => e.id);
  const base = sameId[0] ?? withId ?? ev.reduce((a, b) => (b.props.size > a.props.size ? b : a));
  const id = base.id ?? wantId;
  const present = new Set(ev.filter((e) => !e.id || normId(e.id) === normId(id)).flatMap((e) => [...e.props]));
  const missing = fields.filter((k) => !present.has(k));
  if (!missing.length) return { status: "already", missing, jsonld: {}, id, existingType: base.type, idless: !base.id };
  return { status: "partly", missing, jsonld: { "@context": "https://schema.org", "@id": id, "@type": base.type, ...Object.fromEntries(missing.map((k) => [k, want[k]])) }, id, existingType: base.type, idless: !base.id };
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

  const pages = [home, ...p.clusters.map((c) => c.page)];
  const push = (id: string, label: string, where: string, want: Record<string, unknown>, ev: Evidence[]) => {
    const c = compare(want, ev);
    blocks.push({ id, label: c.status === "partly" && c.existingType ? `${label}: add to your existing ${c.existingType} markup` : label, where, jsonld: c.jsonld, extends: c.status === "partly" ? c.id : null, liveIds: [c.id], status: c.status, missing: c.missing, existingType: c.existingType });
    if (c.status === "partly" && c.idless) notes.push(`Your ${c.existingType} markup has no @id. When you add the missing fields, give it "@id": "${c.id}" so everything joins up as one ${c.existingType}.`);
    return c.id;
  };

  // Organization or LocalBusiness, sitewide: compared with every business node on any page read.
  const local = p.local || !!home?.addressText;
  const org: Record<string, unknown> = { "@context": "https://schema.org", "@type": local ? "LocalBusiness" : "Organization", "@id": orgId, ...(name ? { name } : {}), url: root };
  if (home?.logo) org.logo = home.logo;
  if (home?.social.length) org.sameAs = [...new Set(home.social)].slice(0, 10);
  if (home?.description) org.description = clip(home.description, 300);
  if (home?.addressText) org.address = clip(home.addressText, 200);
  if (home?.phoneText) org.telephone = home.phoneText;
  if (area) org.areaServed = area;
  const orgRef = push("organization", local ? "Your business (LocalBusiness)" : "Your business (Organization)", "sitewide", org, evidence(pages, isOrg));
  if (!home?.logo) notes.push("We didn't find a logo in your site's header, so none is included.");
  if (local && !home?.addressText) notes.push("We couldn't find your address on your homepage, so it's left out. Add it there and press Check again.");

  // WebSite, on the homepage.
  const site: Record<string, unknown> = { "@context": "https://schema.org", "@type": "WebSite", "@id": siteId, url: root, ...(name ? { name } : {}), publisher: { "@id": orgRef } };
  push("website", "Your website (WebSite)", root, site, evidence([home], (t) => t === "WebSite"));

  // Per cluster: Service on its target page, and FAQPage or Article where that page calls for it.
  for (const c of p.clusters) {
    if (!c.target) {
      notes.push(`"${c.name}" has no target page yet, so its service markup is waiting for one.`);
      continue;
    }
    const pg = c.page;
    const svc: Record<string, unknown> = { "@context": "https://schema.org", "@type": "Service", "@id": `${c.target.replace(/#.*$/, "")}#service`, name: clip(pg?.h1, 120) ?? c.name, ...(c.keyword ? { serviceType: c.keyword } : {}), provider: { "@id": orgRef }, url: c.target };
    if (pg?.description) svc.description = clip(pg.description, 300);
    if (area) svc.areaServed = area;
    push(`service:${c.target}`, `${c.name} (Service)`, c.target, svc, evidence([pg], (t) => t === "Service" || t === "Product"));
    const faqEv = evidence([pg], (t) => t === "FAQPage");
    if (pg && (faqEv.length || pg.faqs.length >= 2)) {
      push(`faq:${c.target}`, `Questions on ${short(c.target)} (FAQPage)`, c.target,
        { "@context": "https://schema.org", "@type": "FAQPage", "@id": `${c.target}#faq`, mainEntity: pg.faqs.slice(0, 10).map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) }, faqEv);
    }
    const artEv = evidence([pg], (t) => /Article|BlogPosting/.test(t));
    if (pg?.publishedTime || artEv.length) {
      push(`article:${c.target}`, `The article on ${short(c.target)} (Article)`, c.target,
        { "@context": "https://schema.org", "@type": "Article", "@id": `${c.target}#article`, headline: clip(pg?.h1 ?? pg?.title, 110), ...(pg?.publishedTime ? { datePublished: pg.publishedTime } : {}), ...(pg?.modifiedTime ? { dateModified: pg.modifiedTime } : {}), ...(pg?.byline ? { author: { "@type": "Person", name: pg.byline } } : {}), publisher: { "@id": orgRef }, mainEntityOfPage: c.target }, artEv);
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
const isHome = (u: string) => { try { return new URL(u).pathname.replace(/\/+$/, "") === ""; } catch { return false; } };
export const whereText = (b: SchemaBlock) => (b.where === "sitewide" ? "Every page (in the <head> of your site template)" : isHome(b.where) ? "Your homepage only" : `Only on ${short(b.where)}`);

const STEPS: Record<Exclude<Platform, null>, { sitewide: string; page: string }> = {
  shopify: { sitewide: "In Shopify admin go to Online Store > Themes > Edit code, open layout/theme.liquid and paste it just before </head>.", page: "In theme.liquid, wrap it in {% if request.path == '<path>' %} ... {% endif %} just before </head>, so it only appears on that page." },
  wordpress: { sitewide: "Use a header-code plugin such as WPCode (Code Snippets > Header & Footer > Header), or the theme's header settings. If Yoast or Rank Math already outputs Organization or WebSite markup, extend theirs instead of adding a second copy.", page: "Edit that page, add a Custom HTML block and paste it there, or use WPCode's page-level header snippet." },
  webflow: { sitewide: "In Webflow go to Site settings > Custom code > Head code, paste it and publish.", page: "Open that page's settings > Custom code > Inside <head> tag, paste it and publish." },
  squarespace: { sitewide: "Go to Settings > Advanced > Code Injection > Header and paste it (needs a Business plan or higher).", page: "Open that page's settings > Advanced > Page Header Code Injection and paste it." },
  wix: { sitewide: "Go to Settings > Custom code > Add custom code, paste it, choose All pages and Head, and apply.", page: "Go to Settings > Custom code > Add custom code, paste it, choose that one page and Head, and apply." },
};

/** "For your developer": every script tag with where it goes. */
const todo = (plan: SchemaPlan) => plan.blocks.filter((b) => b.status !== "already");

export function developerText(plan: SchemaPlan, platform: Platform): string {
  if (!todo(plan).length) return "Everything we'd recommend is already on your site. Nothing to add.";
  return todo(plan).map((b) => `<!-- ${b.label}. Goes on: ${whereText(b)}${b.status === "partly" ? `. Partly there already: add only these fields (${b.missing.join(", ")}) to your existing ${b.existingType} markup, @id ${b.extends}, rather than adding a second one` : ""} -->\n${scriptTag(b)}`).join("\n\n")
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
    ...todo(plan).flatMap((b, i) => [`${i + 1}. ${b.label}`, `Where: ${whereText(b)}. ${steps(b)}`, b.status === "partly" ? `The page already has ${b.existingType} markup. Add only these fields to it (${b.missing.join(", ")}) and make sure it has the @id ${b.extends}. Don't add a second ${b.existingType}.` : "", scriptTag(b), ""]).filter((l, i, a) => l !== "" || a[i - 1] !== ""),
    plat ? "" : "If you can tell which platform the site is built on (Shopify, WordPress, Webflow, Squarespace or Wix), use that platform's own place for header code.",
  ].join("\n").trim();
}

/** "Google Tag Manager": one Custom HTML tag a block, with its trigger. */
export function gtmText(plan: SchemaPlan): string {
  if (!todo(plan).length) return "Everything we'd recommend is already on your site. Nothing to add.";
  return todo(plan).map((b) => {
    const trig = b.where === "sitewide" ? "Trigger: All Pages" : `Trigger: Page View where Page URL equals ${b.where}`;
    return `Tag name: Schema - ${b.label}\nTag type: Custom HTML\n${trig}\n\n${scriptTag(b)}`;
  }).join("\n\n----------\n\n");
}
