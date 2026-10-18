/**
 * Where a placement points, and which keyword form its anchor is for (18 Oct
 * 2026 brief, 2b and 2c).
 *
 * Every placement and link insertion for a cluster links to the cluster's one
 * target page (dash/target.ts chosenTarget). Its anchor is for the cluster's
 * keyword or that keyword's plural/singular, alternated so the split stays as
 * even as the count allows: a "best AI SEO agency" article with the anchor
 * "AI SEO agency", a "best AI SEO agencies" one with "AI SEO agencies", both to
 * the same page. Nothing here blocks a save; each rule is a warning.
 *
 * Pure, no imports, so `node --test` loads it as is.
 */

export type FormKeyword = { id: string; keyword: string; form: "primary" | "plural" | "singular" };
export type CountedPlacement = { target_keyword_id: string | null; status: string };

/** Lower-case, apostrophes and punctuation dropped, single spaces: "AI-SEO  agency's" -> "ai seo agencys". */
function norm(s: string): string {
  return s.toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * The form the next placement should target: the one with fewer placements that
 * are not removed, the primary on a tie. With no paired form it is always the
 * primary.
 */
export function nextForm(forms: readonly FormKeyword[], placements: readonly CountedPlacement[]): FormKeyword | null {
  if (!forms.length) return null;
  const counted = placements.filter((p) => p.status !== "removed");
  const n = (id: string) => counted.filter((p) => p.target_keyword_id === id).length;
  const ordered = [...forms].sort((a, b) => n(a.id) - n(b.id) || (a.form === "primary" ? -1 : b.form === "primary" ? 1 : 0));
  return ordered[0];
}

/** How the cluster's placements split across its forms, for the internal view ("ai seo agency 2 · ai seo agencies 1"). */
export function formSplit(forms: readonly FormKeyword[], placements: readonly CountedPlacement[]): { keyword: string; count: number }[] {
  const counted = placements.filter((p) => p.status !== "removed");
  return forms.map((f) => ({ keyword: f.keyword, count: counted.filter((p) => p.target_keyword_id === f.id).length }));
}

/** A warning when the anchor does not contain the keyword form the placement targets; null when it does or either is unknown. */
export function anchorWarning(anchor: string | null | undefined, keyword: string | null | undefined): string | null {
  if (!anchor?.trim() || !keyword?.trim()) return null;
  return norm(anchor).includes(norm(keyword)) ? null : `Anchor "${anchor.trim()}" does not contain the target keyword "${keyword.trim()}".`;
}

/** URLs compared as pages: scheme, www, query, hash and trailing slash ignored, case-insensitive. */
export function samePage(a: string, b: string): boolean {
  const key = (u: string) => u.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/[?#].*$/, "").replace(/\/+$/, "");
  return key(a) === key(b);
}

/** A warning when a placement links somewhere other than its cluster's target page; null when it matches or either is unknown. */
export function targetWarning(linksTo: string | null | undefined, clusterTarget: string | null | undefined): string | null {
  if (!linksTo || !clusterTarget) return null;
  return samePage(linksTo, clusterTarget) ? null : `Links to ${linksTo}, not the cluster's target page ${clusterTarget}.`;
}

/**
 * Clusters on one client that share a target page (brief 2b's conflict check):
 * two clusters aimed at one page compete for it. One line per shared page.
 */
export function sharedTargets(clusters: readonly { name: string; target: string | null }[]): string[] {
  const byPage = new Map<string, { page: string; names: string[] }>();
  for (const c of clusters) {
    if (!c.target) continue;
    const hit = [...byPage.values()].find((g) => samePage(g.page, c.target!));
    if (hit) hit.names.push(c.name);
    else byPage.set(c.target, { page: c.target, names: [c.name] });
  }
  return [...byPage.values()].filter((g) => g.names.length > 1).map((g) => `${g.names.join(" and ")} share the target page ${g.page}, so they compete for it.`);
}

/**
 * Internal links on one cluster's target page whose anchor is another cluster's
 * keyword (brief 2b): the page tells Google it is about the other keyword.
 * `links` are the page's internal links as read; `others` the other clusters'
 * keyword forms.
 */
export function crossAnchorWarnings(page: { url: string; cluster: string }, links: readonly { anchor: string; href: string }[], others: readonly { cluster: string; target: string | null; keywords: readonly string[] }[]): string[] {
  const out: string[] = [];
  for (const o of others) {
    const hit = links.find((l) => o.keywords.some((k) => norm(l.anchor) === norm(k)));
    if (!hit) continue;
    const where = o.target && samePage(hit.href, o.target) ? "" : ` and points it at ${hit.href}`;
    out.push(`${page.url} (${page.cluster}) uses "${hit.anchor}", ${o.cluster}'s keyword, as anchor text${where}.`);
  }
  return out;
}
