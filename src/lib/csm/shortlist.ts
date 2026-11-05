import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { LISTING_TTL_DAYS } from "@/config/csm";
import { normalizeDomain } from "@/lib/scan/domain";

import { type Listing, UnitBudget } from "./fatgrid-request";
import { readDomains, readInventory, runBudget } from "./fatgrid";
import { recordUnits, unitsLeft } from "./usage";
import { type Candidate, type CitedPage, rankShortlist } from "./shortlist-rank";
import { type TopRow, drFloor, latestUsableTop, topThree } from "./serp-floor";

/**
 * Builds one cluster's placement shortlist (phase 1, 5 Nov 2026). AGENCY ONLY: every table it touches is one
 * csm-isolation.test.mts keeps away from the client.
 *
 * Units, cheapest evidence first, and never past the cap: the run's budget is FATGRID_UNIT_CAP cut to what the month
 * has left under FATGRID_MONTHLY_UNIT_CAP (fatgrid_usage). A listing read in the last LISTING_TTL_DAYS is reused for
 * nothing. Spending order: the SERP's top three and the client's own domain (the DR floor and the own-site test),
 * then the cited hosts by how many answers cite them, then the inventory pull at the floor, half guest posts and half
 * insertions. A run that has no units left reads nothing and records "capped".
 *
 * Items keep their state across runs: an approved item stays approved; a proposed item a later run does not find is
 * marked dropped; first_run_id says what is new since last time.
 *
 * `dryRun` reads and ranks and writes nothing - not the cache, not the ledger, not a run - so it can be tried before
 * migration 20261106000000 exists. It still spends Fatgrid units, which it reports.
 */
export type ShortlistResult = {
  outcome: "ok" | "capped" | "no_key" | "failed";
  units: number;
  floor: ReturnType<typeof drFloor>;
  keyword: string | null;
  items: Candidate[];
  added: number;
  dropped: number;
  note: string | null;
};

export async function buildShortlist(
  db: SupabaseClient,
  p: { clientId: string; clusterId: string; reason: "onboarded" | "cluster_changed" | "month_end" | "manual"; dryRun?: boolean; budget?: UnitBudget; unitCap?: number },
): Promise<ShortlistResult> {
  const { data: client, error: cErr } = await db.from("client_domains").select("id, domain, market").eq("id", p.clientId).single();
  if (cErr || !client) throw new Error(`could not read the client: ${cErr?.message ?? "not found"}`);
  const { data: cluster, error: kErr } = await db.from("tracked_clusters").select("id, keyword_id").eq("id", p.clusterId).single();
  if (kErr || !cluster) throw new Error(`could not read the cluster: ${kErr?.message ?? "not found"}`);
  // Read on its own: the two tables point at each other, so an embedded read is ambiguous.
  const { data: kw, error: kwErr } = cluster.keyword_id ? await db.from("tracked_keywords").select("keyword").eq("id", cluster.keyword_id).maybeSingle() : { data: null, error: null };
  if (kwErr) throw new Error(`could not read the cluster's keyword: ${kwErr.message}`);
  const keyword = (kw?.keyword as string | undefined) ?? null;

  // The run's units: the per-run cap, cut to what the month has left.
  // A caller may ask for fewer units than FATGRID_UNIT_CAP (a trial run, 6 Nov 2026), never more.
  const budget = p.budget ?? (p.unitCap !== undefined ? new UnitBudget(Math.min(runBudget().cap, p.unitCap)) : runBudget());
  if (!p.budget) {
    const left = await unitsLeft(db);
    if (left < budget.cap) budget.spend(budget.cap - left);
  }

  const { data: serp, error: sErr } = cluster.keyword_id
    ? await db.from("tracking_serp").select("run_date, top").eq("client_domain_id", p.clientId).eq("keyword_id", cluster.keyword_id).order("run_date", { ascending: false }).limit(14)
    : { data: [] as TopRow[], error: null };
  if (sErr) throw new Error(`could not read the SERP: ${sErr.message}`);
  const usable = latestUsableTop((serp ?? []) as TopRow[]);
  const top3 = usable ? topThree(usable, client.domain) : [];

  const { data: opps, error: oErr } = await db
    .from("opportunities")
    .select("id, url, domain, route, cluster_id, evidence")
    .eq("client_domain_id", p.clientId)
    .eq("live", true)
    .or(`cluster_id.eq.${p.clusterId},cluster_id.is.null`)
    .limit(500);
  if (oErr) throw new Error(`could not read the opportunities: ${oErr.message}`);
  const cited: CitedPage[] = (opps ?? []).map((o) => ({
    opportunityId: o.id as string,
    url: o.url as string,
    domain: normalizeDomain(o.domain as string),
    route: (o.route as string | null) ?? null,
    answers: Number((o.evidence as { answers?: number } | null)?.answers) || 0,
  }));

  // Listings: the cache first, then Fatgrid for what is missing or stale, in the spending order above.
  const listings = new Map<string, Listing>();
  const fresh = new Date(Date.now() - LISTING_TTL_DAYS * 86_400_000).toISOString();
  const citedHosts = [...new Map(cited.sort((a, b) => b.answers - a.answers).map((c) => [c.domain, c])).keys()];
  const wanted = [...new Set([...top3, normalizeDomain(client.domain), ...citedHosts])];
  const { data: cache, error: cacheErr } = await db.from("fatgrid_listings").select("domain, dr, traffic, best_price_usd, offers, categories, language, sponsored, link_follow").in("domain", wanted).gte("fetched_at", fresh);
  if (!cacheErr) {
    for (const r of cache ?? []) listings.set(r.domain as string, { domain: r.domain as string, dr: r.dr === null ? null : Number(r.dr), traffic: r.traffic === null ? null : Number(r.traffic), bestPrice: r.best_price_usd === null ? null : Number(r.best_price_usd), offers: (r.offers as Listing["offers"]) ?? [], categories: (r.categories as string[]) ?? [], language: (r.language as string | null) ?? null, sponsored: (r.sponsored as boolean | null) ?? null, linkFollow: (r.link_follow as string | null) ?? null });
  }
  const read: Listing[] = [];
  let stopped: "done" | "capped" | "no_key" | "failed" = "done";
  let detail: string | undefined;
  const missing = (ds: string[]) => ds.filter((d) => !listings.has(d));
  for (const batch of [missing([...top3, normalizeDomain(client.domain)]), missing(citedHosts).slice(0, Math.max(0, Math.floor(budget.left / 2)))]) {
    if (!batch.length || stopped === "no_key" || stopped === "failed") continue;
    const r = await readDomains(batch, budget);
    for (const l of r.listings) listings.set(l.domain, l);
    read.push(...r.listings);
    if (r.stopped !== "done") ({ stopped, detail } = r);
  }

  const floor = drFloor((serp ?? []) as TopRow[], client.domain, new Map([...listings].map(([d, l]) => [d, l.dr])));
  const inventory: { listing: Listing; offer: "guest_post" | "link_insertion" }[] = [];
  const databases = client.market === "UK" ? ["uk"] : client.market === "US" ? ["us"] : undefined;
  for (const offer of ["guest_post", "link_insertion"] as const) {
    if (stopped === "no_key" || stopped === "failed" || budget.left < 1) break;
    const half = new UnitBudget(offer === "guest_post" ? Math.ceil(budget.left / 2) : budget.left);
    const r = await readInventory({ offerType: offer, minDr: floor.floor, minTraffic: 1000, maxPrice: 1260, languages: ["en"], databases }, half);
    budget.spend(half.used);
    inventory.push(...r.listings.map((listing) => ({ listing, offer })));
    read.push(...r.listings);
    if (r.stopped === "no_key" || r.stopped === "failed") ({ stopped, detail } = r);
    else if (r.stopped === "capped") stopped = "capped";
  }

  const items = rankShortlist({ clientDomain: client.domain, clientDr: listings.get(normalizeDomain(client.domain))?.dr ?? null, floor: floor.floor, keyword, cited, listings, inventory });
  // Units are what Fatgrid returned on this run: one per domain on the Pro plan.
  const outcome = stopped === "done" ? "ok" : stopped;
  const result: ShortlistResult = { outcome, units: read.length, floor, keyword, items, added: 0, dropped: 0, note: detail ?? null };
  if (p.dryRun) return result;
  return writeRun(db, p, client.id as string, result, read);
}

async function writeRun(db: SupabaseClient, p: { clientId: string; clusterId: string; reason: string }, clientId: string, r: ShortlistResult, read: Listing[]): Promise<ShortlistResult> {
  const now = new Date().toISOString();
  if (read.length) {
    const { error } = await db.from("fatgrid_listings").upsert(
      read.map((l) => ({ domain: l.domain, dr: l.dr, traffic: l.traffic, best_price_usd: l.bestPrice, offers: l.offers, categories: l.categories, language: l.language, sponsored: l.sponsored, link_follow: l.linkFollow, fetched_at: now })),
      { onConflict: "domain" },
    );
    if (error) console.warn(`[csm] listings not cached: ${error.message}`);
  }
  const { data: run, error: runErr } = await db
    .from("shortlist_runs")
    .insert({ client_domain_id: clientId, cluster_id: p.clusterId, keyword: r.keyword, reason: p.reason, dr_floor: r.floor.floor, dr_floor_source: r.floor.source, serp_read_on: r.floor.readOn, units_used: r.units, outcome: r.outcome, note: r.note?.slice(0, 500) ?? null })
    .select("id")
    .single();
  if (runErr || !run) throw new Error(`could not record the run: ${runErr?.message ?? "no row"}`);
  await recordUnits(db, { source: "shortlist", units: r.units, clientId, runId: run.id as string });
  // A run that read nothing new is not evidence anything went away: only an "ok" run marks items dropped.
  const { data: existing, error: exErr } = await db.from("shortlist_items").select("id, domain, kind, state").eq("client_domain_id", clientId).eq("cluster_id", p.clusterId);
  if (exErr) throw new Error(`could not read the shortlist: ${exErr.message}`);
  const prior = new Map((existing ?? []).map((e) => [`${e.domain}|${e.kind}`, e]));
  let added = 0;
  for (const c of r.items) {
    const before = prior.get(`${c.domain}|${c.kind}`);
    const row = {
      client_domain_id: clientId, cluster_id: p.clusterId, domain: c.domain, page_url: c.pageUrl, kind: c.kind, queue_month: c.queueMonth,
      price_usd: c.priceUsd, dr: c.dr, traffic: c.traffic, cited_by: c.citedBy, score: c.score, opportunity_id: c.opportunityId,
      client_visible: c.clientVisible, own_site: c.ownSite, note: c.note, last_run_id: run.id, updated_at: now,
      ...(before ? (before.state === "dropped" ? { state: "proposed" } : {}) : { first_run_id: run.id, state: "proposed" }),
    };
    const { error } = await db.from("shortlist_items").upsert(row, { onConflict: "client_domain_id,cluster_id,domain,kind" });
    if (error) throw new Error(`could not store ${c.domain}: ${error.message}`);
    if (!before) added++;
  }
  let dropped = 0;
  if (r.outcome === "ok") {
    const found = new Set(r.items.map((c) => `${c.domain}|${c.kind}`));
    const gone = (existing ?? []).filter((e) => e.state === "proposed" && !found.has(`${e.domain}|${e.kind}`)).map((e) => e.id as string);
    if (gone.length) {
      const { error } = await db.from("shortlist_items").update({ state: "dropped", last_run_id: run.id, updated_at: now }).in("id", gone);
      if (error) throw new Error(`could not mark dropped items: ${error.message}`);
      dropped = gone.length;
    }
  }
  return { ...r, added, dropped };
}
