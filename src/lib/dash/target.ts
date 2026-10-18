/**
 * A cluster's target page (18 Oct 2026): the page a person chose for it, held
 * as a live key_pages row with origin `member` whose cluster_ids list the
 * cluster - newest first when there are several. Null when nobody has chosen.
 *
 * It is the page placements point at and the page the cluster is meant to
 * rank with, so a person's choice wins over the heuristics (the brief's
 * ranking URL and its "never a blog post for a buying keyword" rule, and the
 * weekly key-pages job's ranking-based clusters - key-pages.ts keeps a
 * member page's clusters). Pure, no imports.
 */
export type KeyPageRow = { url: string; origin: string; cluster_ids: readonly string[] | null; added_on: string; removed_on: string | null };

export function chosenTarget(pages: readonly KeyPageRow[], clusterId: string): string | null {
  return chosenTargetRow(pages, clusterId)?.url ?? null;
}

/** The chosen target's whole row (its key_pages id for placements.target_page_id, 18 Oct 2026 brief 2b). */
export function chosenTargetRow<R extends KeyPageRow>(pages: readonly R[], clusterId: string): R | null {
  const mine = pages.filter((p) => p.origin === "member" && p.removed_on === null && (p.cluster_ids ?? []).includes(clusterId));
  mine.sort((a, b) => (a.added_on < b.added_on ? 1 : a.added_on > b.added_on ? -1 : 0));
  return mine[0] ?? null;
}

/** A target page as it is shown: no scheme, no www, no trailing slash ("nomadadigital.co.uk/blog/best-seo-agency-for-b2b"). */
export function targetLabel(url: string): string {
  return url.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/+$/, "");
}

export const TARGET_NOT_OWN = "The target page has to be on your own site.";
export const TARGET_BAD = "That is not a page address. Paste the full URL, starting https://";

/** Why a URL cannot be a cluster's target page on `domain` (18 Oct 2026 brief 2b), or null. Pure, for the browser and the server alike. */
export function refuseTargetUrl(raw: string, domain: string): string | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return TARGET_BAD;
  }
  if ((u.protocol !== "https:" && u.protocol !== "http:") || u.username || u.password || !u.hostname.includes(".")) return TARGET_BAD;
  const bare = (h: string) => h.toLowerCase().replace(/^www\./, "");
  const host = bare(u.hostname), own = bare(domain);
  return host === own || host.endsWith(`.${own}`) ? null : TARGET_NOT_OWN;
}
