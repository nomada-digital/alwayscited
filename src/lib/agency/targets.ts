import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

import { type Client, type Done, audit } from "@/lib/agency/edit";
import { chosenTarget } from "@/lib/dash/target";
import { type PageCandidate, bestTarget, sitemapLocs } from "@/lib/dash/target-suggest";
import { setClusterTarget } from "@/lib/dash/target-write";
import { guardedRead } from "@/lib/scan/crawl";
import { trackingDay } from "@/lib/tracking/decide";

/**
 * Each live cluster's target page, for the hub (11 Nov 2026, Danny: MOR's was never set and nobody could see that).
 * team_read's sibling on /api/hub/agency: target_read answers every live cluster with its keyword (the anchor), its
 * target page or null, and for one with none a suggestion (target-suggest.ts) shown "suggested, needs confirming";
 * target_set sets one (target-write.ts, as Setup does) under the staff member's name, in agency_edits. A suggestion is
 * never written as a target here: a person confirms it with target_set.
 */
const UA = "alwayscited-targets/1.0 (+https://alwayscited.com)";

/** The customer's own sitemap addresses: sitemap.xml, or an index and up to five of its sitemaps. Never fatal. */
async function sitemapPages(domain: string): Promise<string[]> {
  const read = async (u: string) => {
    const r = await guardedRead(u, { capBytes: 3_000_000, ua: UA, timeoutMs: 6000 });
    return r.ok && r.status === 200 ? r.html : "";
  };
  const host = (u: string) => {
    try {
      return new URL(u).hostname.toLowerCase().replace(/^www\./, "");
    } catch {
      return "";
    }
  };
  const own = domain.toLowerCase().replace(/^www\./, "");
  for (const first of [`https://${domain}/sitemap.xml`, `https://${domain}/sitemap_index.xml`, `https://www.${own}/sitemap.xml`]) {
    const xml = await read(first).catch(() => "");
    if (!xml) continue;
    const locs = sitemapLocs(xml);
    if (!/<sitemapindex/i.test(xml)) return locs.filter((u) => host(u) === own || host(u).endsWith(`.${own}`));
    const pages: string[] = [];
    for (const sm of locs.filter((u) => /\.xml/i.test(u)).slice(0, 5)) pages.push(...sitemapLocs(await read(sm).catch(() => "")));
    return pages.filter((u) => host(u) === own || host(u).endsWith(`.${own}`)).slice(0, 2000);
  }
  return [];
}

type Live = { id: string; name: string; keyword: string | null; keywordId: string | null; target: string | null };

async function liveClusters(db: SupabaseClient, client: Client): Promise<{ clusters: Live[]; pages: { url: string; origin: string }[]; ranking: Map<string, { url: string; position: number | null }> } | string> {
  const [{ data: cl, error: e1 }, { data: kp, error: e2 }, { data: kw, error: e3 }, { data: serp, error: e4 }] = await Promise.all([
    db.from("tracked_clusters").select("id, name, keyword_id").eq("client_domain_id", client.id).is("stopped_on", null).is("superseded_by", null).order("created_at", { ascending: true }),
    db.from("key_pages").select("url, origin, cluster_ids, added_on, removed_on").eq("client_domain_id", client.id).is("removed_on", null),
    db.from("tracked_keywords").select("id, keyword").eq("client_domain_id", client.id),
    db.from("tracking_serp").select("keyword_id, url, position, run_date").eq("client_domain_id", client.id).not("url", "is", null).order("run_date", { ascending: false }).limit(200),
  ]);
  const err = e1 ?? e2 ?? e3 ?? e4;
  if (err) return `Could not read the clusters' target pages: ${err.message}`;
  const word = new Map((kw ?? []).map((k) => [k.id as string, k.keyword as string]));
  const ranking = new Map<string, { url: string; position: number | null }>();
  for (const s of serp ?? []) if (!ranking.has(s.keyword_id as string)) ranking.set(s.keyword_id as string, { url: s.url as string, position: (s.position as number | null) ?? null });
  const pages = (kp ?? []) as { url: string; origin: string; cluster_ids: string[] | null; added_on: string; removed_on: string | null }[];
  return {
    clusters: (cl ?? []).map((c) => ({ id: c.id as string, name: c.name as string, keyword: c.keyword_id ? (word.get(c.keyword_id as string) ?? null) : null, target: chosenTarget(pages, c.id as string), keywordId: c.keyword_id as string | null })),
    pages,
    ranking,
  };
}

export async function targetRead(db: SupabaseClient, client: Client): Promise<Done> {
  const got = await liveClusters(db, client);
  if (typeof got === "string") return { ok: false, message: got };
  const missing = got.clusters.filter((c) => !c.target);
  const site = missing.length ? await sitemapPages(client.domain).catch(() => []) : [];
  const own = client.domain.toLowerCase().replace(/^www\./, "");
  const onSite = (u: string) => {
    try {
      const h = new URL(u).hostname.toLowerCase().replace(/^www\./, "");
      return h === own || h.endsWith(`.${own}`);
    } catch {
      return false;
    }
  };
  const clusters = got.clusters.map((c) => {
    if (c.target) return { cluster_id: c.id, name: c.name, keyword: c.keyword, target: c.target, suggestion: null };
    const rank = c.keywordId ? got.ranking.get(c.keywordId) : undefined;
    const cands: PageCandidate[] = [
      ...(rank && onSite(rank.url) ? [{ url: rank.url, source: "ranking" as const, position: rank.position }] : []),
      ...got.pages.map((p) => ({ url: p.url, source: p.origin === "homepage" ? ("homepage" as const) : ("key_page" as const) })),
      ...site.map((url) => ({ url, source: "sitemap" as const })),
      { url: `https://${client.domain}/`, source: "homepage" as const },
    ];
    return { cluster_id: c.id, name: c.name, keyword: c.keyword, target: null, suggestion: c.keyword ? bestTarget(c.keyword, cands) : null };
  });
  return { ok: true, message: `${clusters.length - missing.length} of ${clusters.length} clusters have a target page.`, data: { clusters, sitemap_pages: site.length } };
}

export async function targetSet(db: SupabaseClient, client: Client, by: string, p: { clusterId: string; url: string; confirmed: boolean }): Promise<Done> {
  const got = await liveClusters(db, client);
  if (typeof got === "string") return { ok: false, message: got };
  const c = got.clusters.find((x) => x.id === p.clusterId);
  if (!c) return { ok: false, message: "That is not one of this customer's live clusters." };
  const r = await setClusterTarget(db, { id: client.id, domain: client.domain }, c.id, p.url, { by, today: trackingDay() });
  if (!r.ok) return r;
  await audit(db, client.id, by, p.confirmed ? "target_confirm" : "target_set", c.id, c.target, r.url);
  return { ok: true, message: `${c.name} links to ${r.url}${c.keyword ? `, anchor "${c.keyword}"` : ""}.` };
}
