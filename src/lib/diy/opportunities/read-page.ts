import { namesBrand } from "../../scan/brand-name.ts";
import type { ParsedPage } from "../../scan/dataforseo-request.ts";
import type { Day } from "../../tracking/figures.ts";
import { type Subject, namesBrandIn } from "../../tracking/limits.ts";

import { bare } from "./classify-rules.ts";
import type { PageFacts } from "./types.ts";

/**
 * What one read of a third-party page found (13 Oct 2026, DIY P7; spec 10
 * section 6.2, "Page reads"). Pure: the fetch is done elsewhere and its HTML,
 * or content_parsing's parsed page, handed in.
 *
 * Kept: the title, the first h1, h2 and h3 headings (at most 40, each at most
 * 120 characters), a last-updated date, whether the page names the client
 * with at most 200 characters around the first match, which competitors from
 * the evidence it names, and its first link to the client with the anchor
 * and whether the link is followed. **No body text is kept**: the visible text
 * is read here and dropped.
 *
 * **The brand matcher reads everything a reader sees** (Nomada's W19: a page
 * read reported no mention where an engine had named the brand). The visible
 * text includes headings, table cells, link text and image alt text, and the
 * match is `namesBrandIn` (limits.ts), the same rule as "named": brand,
 * domain and aliases.
 *
 * A content_parsing read (the paid fallback, when our own fetch is not
 * allowed) returns headings and links but no body text through the parser
 * (dataforseo-request.ts ParsedPage), so its "names you" is read from the
 * title, h1, headings and link anchors, and is "not known" - never "doesn't
 * name you" - when none of them names the client. Nor does it return `rel`,
 * so a link it finds is never said to be followed or not.
 */

export const HEADINGS_MAX = 40;
export const HEADING_CHARS = 120;
export const SNIPPET_CHARS = 200;
export const TITLE_CHARS = 300;

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "-", mdash: "-", rsquo: "'", lsquo: "'", ldquo: '"', rdquo: '"', hellip: "...", pound: "£", euro: "€" };

/** HTML entities decoded: the named ones above and every numeric one. */
export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : " ";
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

const clean = (s: string, max: number) => {
  const t = decodeEntities(s.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
  return t ? t.slice(0, max) : null;
};

/** The text a reader sees: no scripts, styles or templates; image alt text and every element's text, headings and table cells included. */
export function visibleText(html: string): string {
  return decodeEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(script|style|noscript|template|svg)\b[\s\S]*?<\/\1\s*>/gi, " ")
      .replace(/<img\b[^>]*?\balt\s*=\s*("([^"]*)"|'([^']*)')[^>]*>/gi, (_m, _q, a: string | undefined, b: string | undefined) => ` ${a ?? b ?? ""} `)
      .replace(/<\/?(p|div|li|tr|td|th|h[1-6]|br|section|article|header|footer|table|ul|ol)\b[^>]*>/gi, " \n ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t\f\v\r]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

export function pageTitle(html: string): string | null {
  const m = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return m ? clean(m[1]!, TITLE_CHARS) : null;
}

export function firstH1(html: string): string | null {
  const m = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  return m ? clean(m[1]!, TITLE_CHARS) : null;
}

/** The h2 and h3 headings, in order: at most HEADINGS_MAX, each cut to HEADING_CHARS. */
export function pageHeadings(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<h([23])\b[^>]*>([\s\S]*?)<\/h\1>/gi)) {
    const t = clean(m[2]!, HEADING_CHARS);
    if (t) out.push(t);
    if (out.length >= HEADINGS_MAX) break;
  }
  return out;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A date string as a day: ISO, "2 Sep 2026", "September 2, 2026", "Sep 2026" (the 1st). Null when it is not one, or not a real day. */
export function dayOf(raw: string): Day | null {
  const s = raw.trim();
  let y: number, m: number, d: number;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  const dmy = /^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})/.exec(s);
  const mdy = /^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/.exec(s);
  const my = /^([A-Za-z]{3,9})\.?\s+(\d{4})/.exec(s);
  if (iso) [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else if (dmy) [y, m, d] = [Number(dmy[3]), MONTHS.indexOf(dmy[2]!.slice(0, 3).toLowerCase()) + 1, Number(dmy[1])];
  else if (mdy) [y, m, d] = [Number(mdy[3]), MONTHS.indexOf(mdy[1]!.slice(0, 3).toLowerCase()) + 1, Number(mdy[2])];
  else if (my) [y, m, d] = [Number(my[2]), MONTHS.indexOf(my[1]!.slice(0, 3).toLowerCase()) + 1, 1];
  else return null;
  if (!(m >= 1 && m <= 12) || !(d >= 1 && d <= 31) || y < 1995 || y > 2100) return null;
  const out = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const t = new Date(`${out}T00:00:00Z`);
  return DAY_RE.test(out) && t.toISOString().slice(0, 10) === out ? out : null;
}

const NEAR = /\b(?:last\s+)?(?:updated|modified|published|posted)\b[^\n.]{0,30}?(\d{4}-\d{2}-\d{2}|\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]{3,9}\.?,?\s+\d{4}|[A-Za-z]{3,9}\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}|[A-Za-z]{3,9}\.?\s+\d{4})/i;

/** The page's last-updated date: the article:modified_time meta, else a date near "updated" or "published" in its text. Never after `today`. */
export function updatedOn(html: string, text: string, today: Day): Day | null {
  const meta = /<meta\b[^>]*(?:property|name)\s*=\s*["'](?:article:modified_time|og:updated_time|article:published_time)["'][^>]*>/i.exec(html)?.[0];
  const content = meta ? /\bcontent\s*=\s*["']([^"']+)["']/i.exec(meta)?.[1] : null;
  const fromMeta = content ? dayOf(content) : null;
  if (fromMeta && fromMeta <= today) return fromMeta;
  const near = NEAR.exec(text);
  const fromText = near ? dayOf(near[1]!) : null;
  return fromText && fromText <= today ? fromText : null;
}

/** At most SNIPPET_CHARS around the first place the client is named, cut at word edges; null when it is not named. */
export function snippetAround(text: string, s: Subject): string | null {
  if (!namesBrandIn(text, s)) return null;
  const lower = text.toLowerCase();
  const names = [s.brand ?? "", s.domain, ...(s.aliases ?? [])].map((n) => n.trim().toLowerCase()).filter((n) => n.length >= 2);
  const at = names.map((n) => lower.indexOf(n)).filter((i) => i >= 0).sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, at - 80);
  let cut = text.slice(start, start + SNIPPET_CHARS).replace(/\s+/g, " ");
  if (start > 0) cut = cut.replace(/^\S*\s/, "");
  if (start + SNIPPET_CHARS < text.length) cut = cut.replace(/\s\S*$/, "");
  return cut.trim().slice(0, SNIPPET_CHARS) || null;
}

/** Which of these brands the text names, each once, in the order given. */
export function brandsIn(text: string, brands: readonly string[]): string[] {
  return [...new Set(brands)].filter((b) => namesBrand(text, b));
}

/** The rel tokens that tell a search engine not to follow a link. */
const NOT_FOLLOWED = /\b(nofollow|ugc|sponsored)\b/i;

export type ClientLink = { found: boolean; rel: "followed" | "not_followed" | null; anchor: string | null };

/** The page's first link to the client's domain (or under it): its anchor and whether it is followed. */
export function linkToClient(html: string, domain: string): ClientLink {
  const own = bare(domain);
  for (const m of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const attrs = m[1]!;
    const href = /\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs);
    const raw = href ? (href[2] ?? href[3] ?? href[4] ?? "") : "";
    let host: string;
    try {
      host = bare(new URL(decodeEntities(raw), "https://placeholder.invalid/").hostname);
    } catch {
      continue;
    }
    if (host !== own && !host.endsWith(`.${own}`)) continue;
    const rel = /\brel\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs);
    const relText = rel ? (rel[2] ?? rel[3] ?? rel[4] ?? "") : "";
    const anchor = clean(m[2]!.replace(/<img\b[^>]*?\balt\s*=\s*"([^"]*)"[^>]*>/gi, " $1 "), 200);
    return { found: true, rel: NOT_FOLLOWED.test(relText) ? "not_followed" : "followed", anchor };
  }
  return { found: false, rel: null, anchor: null };
}

export type OwnRead = { status: number; html: string; contentType?: string | null };

/** The facts of an own fetch: everything a reader sees, kept as the allow-listed fields only. */
export function factsFromHtml(p: { url: string; urlKey: string; at: string; today: Day; read: OwnRead; subject: Subject; competitors: readonly string[] }): PageFacts {
  const base = { urlKey: p.urlKey, url: p.url.slice(0, 500), readAt: p.at, via: "own" as const, http: p.read.status };
  const type = (p.read.contentType ?? "text/html").toLowerCase();
  if (p.read.status < 200 || p.read.status >= 300) return { ...base, ...EMPTY_FACTS, status: "error" };
  if (!/html|xml/.test(type)) return { ...base, ...EMPTY_FACTS, status: "not_html" };
  const text = visibleText(p.read.html);
  const link = linkToClient(p.read.html, p.subject.domain);
  return {
    ...base,
    status: "ok",
    title: pageTitle(p.read.html),
    h1: firstH1(p.read.html),
    updatedOn: updatedOn(p.read.html, text, p.today),
    headings: pageHeadings(p.read.html),
    namesClient: namesBrandIn(text, p.subject),
    snippet: snippetAround(text, p.subject),
    brandsFound: brandsIn(text, p.competitors),
    linksToClient: link.found,
    linkRel: link.rel,
    linkAnchor: link.anchor,
  };
}

const EMPTY_FACTS = { title: null, h1: null, updatedOn: null, headings: [] as string[], namesClient: null, snippet: null, brandsFound: [] as string[], linksToClient: null, linkRel: null, linkAnchor: null };

/** A page our own fetch may not read: robots.txt disallows us, or the network or the address refused it. */
export function blockedFacts(p: { url: string; urlKey: string; at: string; why: "robots" | "network" | "private" | "timeout" | "bad_url" }): PageFacts {
  return { urlKey: p.urlKey, url: p.url.slice(0, 500), readAt: p.at, via: "own", http: null, ...EMPTY_FACTS, status: p.why === "robots" ? "blocked" : "error" };
}

/**
 * The facts of a content_parsing read. Its headings, title and link anchors
 * are read for the client's name; with no body text, a page that does not
 * name the client there is "not known", never "doesn't name you". No `rel`.
 */
export function factsFromParsed(p: { url: string; urlKey: string; at: string; today: Day; parsed: ParsedPage | null; subject: Subject; competitors: readonly string[] }): PageFacts {
  const base = { urlKey: p.urlKey, url: p.url.slice(0, 500), readAt: p.at, via: "content_parsing" as const };
  const page = p.parsed;
  if (!page) return { ...base, http: null, ...EMPTY_FACTS, status: "error" };
  if (page.status !== null && (page.status < 200 || page.status >= 300)) return { ...base, http: page.status, ...EMPTY_FACTS, status: "error" };
  const own = bare(p.subject.domain);
  const clientLink = page.links.find((l) => {
    try {
      const h = bare(new URL(l.url, "https://placeholder.invalid/").hostname);
      return h === own || h.endsWith(`.${own}`);
    } catch {
      return false;
    }
  });
  const seen = [page.title ?? "", page.h1 ?? "", ...page.headings.map((h) => h.text), ...page.links.map((l) => l.anchor ?? "")].join("\n");
  const named = namesBrandIn(seen, p.subject);
  const updated = page.dates.map(dayOf).find((d): d is Day => d !== null && d <= p.today) ?? null;
  return {
    ...base,
    http: page.status,
    status: "ok",
    title: page.title?.slice(0, TITLE_CHARS) ?? null,
    h1: page.h1?.slice(0, TITLE_CHARS) ?? null,
    updatedOn: updated,
    headings: page.headings.map((h) => h.text.slice(0, HEADING_CHARS)).slice(0, HEADINGS_MAX),
    namesClient: named ? true : null,
    snippet: named ? snippetAround(seen, p.subject) : null,
    brandsFound: brandsIn(seen, p.competitors),
    linksToClient: clientLink ? true : page.links.length ? false : null,
    linkRel: null,
    linkAnchor: clientLink?.anchor?.slice(0, 200) ?? null,
  };
}
