/**
 * A suggested target page for a cluster that has none (Danny, 11 Nov 2026: "why wasn't mor's target page in the
 * dashboard can we make sure this is clear for mor and all customers going forward"). Only ever a suggestion: it is
 * shown "suggested, needs confirming" and becomes the target when a person confirms it (target-write.ts); nothing here
 * writes.
 *
 * The pages are the customer's own: its sitemap, its key pages and the page Google ranks for the keyword. Each is
 * scored by how many of the keyword's words its address carries (household-staff for "household staff agency"),
 * a word matching its plural or singular; a ranking page wins a tie, then the shorter address. Nothing matching: the
 * homepage, said as such. Pure, no imports.
 */
export type PageCandidate = { url: string; source: "ranking" | "sitemap" | "key_page" | "homepage"; position?: number | null };
export type Suggestion = { url: string; why: string };

const STOP = new Set(["the", "a", "an", "and", "or", "for", "of", "in", "to", "on", "with", "best", "near", "me", "uk", "top"]);
const stem = (w: string) => w.replace(/ies$/, "y").replace(/(?<=[^s])s$/, "");
const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

/** The share of the keyword's words (stop words aside) in the page's path. 0 for the homepage. */
export function pathScore(url: string, keyword: string): number {
  let path: string;
  try {
    path = decodeURIComponent(new URL(url).pathname);
  } catch {
    return 0;
  }
  const kw = [...new Set(words(keyword).filter((w) => !STOP.has(w)).map(stem))];
  if (!kw.length) return 0;
  const have = new Set(words(path).map(stem));
  return kw.filter((w) => have.has(w)).length / kw.length;
}

const depth = (url: string) => {
  try {
    return new URL(url).pathname.split("/").filter(Boolean).length;
  } catch {
    return 99;
  }
};

/** The best page for the keyword among the customer's own, with why, or null when there is none at all. */
export function bestTarget(keyword: string, pages: readonly PageCandidate[]): Suggestion | null {
  const seen = new Map<string, PageCandidate>();
  for (const p of pages) {
    const k = p.url.toLowerCase().replace(/^https?:\/\/(www\.)?/, "").replace(/[?#].*$/, "").replace(/\/+$/, "");
    const was = seen.get(k);
    if (!was || (p.source === "ranking" && was.source !== "ranking")) seen.set(k, p);
  }
  const scored = [...seen.values()].map((p) => ({ p, s: pathScore(p.url, keyword) }));
  scored.sort((a, b) => b.s - a.s || Number(b.p.source === "ranking") - Number(a.p.source === "ranking") || depth(a.p.url) - depth(b.p.url) || a.p.url.length - b.p.url.length);
  const top = scored[0];
  if (top && top.s > 0) {
    const ranks = top.p.source === "ranking" && top.p.position ? `; Google ranks it #${top.p.position} for "${keyword}"` : "";
    const from = top.p.source === "sitemap" ? "from the site's sitemap" : top.p.source === "key_page" ? "one of the site's key pages" : "the page Google ranks for it";
    return { url: top.p.url, why: `${Math.round(top.s * 100)}% of the keyword's words are in its address, ${from}${ranks}` };
  }
  const ranking = pages.find((p) => p.source === "ranking");
  if (ranking) return { url: ranking.url, why: `the page Google ranks${ranking.position ? ` #${ranking.position}` : ""} for "${keyword}"` };
  const home = pages.find((p) => p.source === "homepage");
  return home ? { url: home.url, why: "nothing on the site matches the keyword; the homepage until a better page exists" } : null;
}

/** <loc> addresses in a sitemap or sitemap index, at most `cap`. */
export function sitemapLocs(xml: string, cap = 2000): string[] {
  const out: string[] = [];
  for (const m of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) {
    out.push(m[1]!.replace(/&amp;/g, "&"));
    if (out.length >= cap) break;
  }
  return out;
}
