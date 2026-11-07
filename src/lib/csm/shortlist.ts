import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { LISTING_TTL_DAYS } from "@/config/csm";
import { normalizeDomain } from "@/lib/scan/domain";

import { INVENTORY_PAGE, type InventoryCursor, type Listing, UnitBudget, cursorFrom, inventorySig } from "./fatgrid-request";
import { readDomains, readInventoryPage, runBudget } from "./fatgrid";
import { checkHosts, readHomepage } from "./host-check";
import { GEO_CHECKS_PER_RUN, TOPIC_CHECKS_PER_RUN, type HostCheck, clientProfile, marketVerdict, topicVerdict } from "./host-gates";
import { recordUnits, unitsLeft } from "./usage";
import { type Candidate, type CitedPage, type HostNote, rankShortlist } from "./shortlist-rank";
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
 * The quality gates (7 Nov 2026, host-gates.ts): a domain the client has had rejected is never offered again; a cited
 * host is checked for topic before a unit is spent on it; inventory comes a fixed-size page at a time from where the
 * last run stopped (the cursor on shortlist_runs), each page gated on market and topic before the next is bought, and
 * the pull stops once ENOUGH_PASSING hosts have passed. What failed, and why, is in the run's note.
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
  cursor: InventoryCursor | null;
};

/** Inventory hosts that passed both gates, after which no further page is bought. */
export const ENOUGH_PASSING = 8;
/** No inventory page is bought after this long into a run, so the request ends inside the route's limit with its run recorded. */
export const RUN_MS = 180_000;

/** Whether migration 20261107000000 (batch B) is in: its columns are written only then. */
async function hasBatchB(db: SupabaseClient): Promise<boolean> {
  const { error } = await db.from("shortlist_items").select("market_share").limit(0);
  return !error;
}

export async function buildShortlist(
  db: SupabaseClient,
  p: { clientId: string; clusterId: string; reason: "onboarded" | "cluster_changed" | "month_end" | "manual"; dryRun?: boolean; budget?: UnitBudget; unitCap?: number },
): Promise<ShortlistResult> {
  const { data: client, error: cErr } = await db.from("client_domains").select("id, domain, market, brand_name, topic").eq("id", p.clientId).single();
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

  const started = Date.now();
  const stored = await hasBatchB(db);
  const own = normalizeDomain(client.domain);

  // Rejected once for this client, never offered again - any cluster, any kind. Off-topic ones teach the topic gate.
  const { data: rejectedRows, error: rjErr } = await db.from("shortlist_items").select(stored ? "domain, note, reject_reason" : "domain, note").eq("client_domain_id", p.clientId).eq("state", "rejected");
  if (rjErr) throw new Error(`could not read the rejections: ${rjErr.message}`);
  const rejections = (rejectedRows ?? []) as unknown as { domain: string; note: string | null; reject_reason?: string | null }[];
  const rejected = new Set(rejections.map((r) => normalizeDomain(r.domain)));
  const offTopic = rejections.filter((r) => r.reject_reason === "off_topic" || /off.?topic/i.test(r.note ?? "")).map((r) => ({ domain: r.domain, note: r.note }));

  const { data: clusterRows, error: clErr } = await db.from("tracked_clusters").select("name").eq("client_domain_id", p.clientId).is("stopped_on", null);
  if (clErr) throw new Error(`could not read the client's clusters: ${clErr.message}`);
  const profile = clientProfile({
    brand: (client.brand_name as string | null) ?? null, domain: own, topic: (client.topic as string | null) ?? null,
    clusters: [...new Set([keyword, ...(clusterRows ?? []).map((c) => c.name as string)].filter((x): x is string => !!x))],
    homepage: await readHomepage(own), offTopic,
  });
  const market = (client.market as string | null) ?? null;
  const checks = new Map<string, HostCheck>();
  let topicBudget = TOPIC_CHECKS_PER_RUN;
  let geoBudget = GEO_CHECKS_PER_RUN;
  let checkCost = 0;
  let modelCalls = 0;
  const check = async (domains: string[], categories?: Map<string, string[]>) => {
    const r = await checkHosts(db, { clientId: p.clientId, market, profile, domains: domains.filter((d) => !checks.has(d)), categories, topicLimit: topicBudget, geoLimit: geoBudget, stored });
    topicBudget -= r.topicReads;
    geoBudget -= r.geoReads;
    checkCost += r.costUsd;
    modelCalls += r.modelCalls;
    for (const [d, c] of r.checks) checks.set(d, c);
  };
  const gatedOut = new Map<string, string>();
  const passes = (domain: string, cited: boolean): boolean => {
    const c = checks.get(domain);
    const why = !c ? "not checked: the run's host-check allowance was used" : [topicVerdict(c), marketVerdict(c, { cited })].find((v) => !v.pass)?.why;
    if (why) gatedOut.set(domain, why);
    return !why;
  };

  // Listings: the cache first, then Fatgrid for what is missing or stale, in the spending order above.
  const listings = new Map<string, Listing>();
  const fresh = new Date(Date.now() - LISTING_TTL_DAYS * 86_400_000).toISOString();
  const citedAll = [...new Map(cited.sort((a, b) => b.answers - a.answers).map((c) => [c.domain, c])).keys()].filter((d) => d !== own && !d.endsWith(`.${own}`) && !rejected.has(d));
  // A cited host is checked for topic before a unit is spent on it; its market share is shown, not gated. Where the
  // page the engines cite is itself a list or directory of the client's kind of firm (route ask_added or get_listed),
  // that page is the topic evidence and the homepage is not asked: parexcellence.vip reads as a yachting magazine,
  // and its cited page is "the nine best household and domestic staffing agencies in Europe" (MOR, 7 Nov 2026).
  const listPage = new Map<string, string>();
  for (const c of cited) if ((c.route === "ask_added" || c.route === "get_listed") && !listPage.has(c.domain)) listPage.set(c.domain, c.url);
  await check(citedAll.filter((d) => !listPage.has(d)));
  for (const [d, url] of listPage) {
    if (!citedAll.includes(d)) continue;
    const path = url.replace(/^https?:\/\/[^/]+/, "").replace(/\?.*$/, "").slice(0, 120) || "/";
    checks.set(d, { ...(checks.get(d) ?? { domain: d, market, marketShare: null, marketEtv: null, totalEtv: null }), fits: true, fitReason: `AI engines already cite its list page ${path} for this client's questions` });
  }
  const citedHosts = citedAll.filter((d) => passes(d, true));
  const wanted = [...new Set([...top3, own, ...citedHosts])];
  const { data: cache, error: cacheErr } = await db.from("fatgrid_listings").select("domain, dr, traffic, best_price_usd, offers, categories, language, sponsored, link_follow").in("domain", wanted).gte("fetched_at", fresh);
  if (!cacheErr) {
    for (const r of cache ?? []) listings.set(r.domain as string, { domain: r.domain as string, dr: r.dr === null ? null : Number(r.dr), traffic: r.traffic === null ? null : Number(r.traffic), bestPrice: r.best_price_usd === null ? null : Number(r.best_price_usd), offers: (r.offers as Listing["offers"]) ?? [], categories: (r.categories as string[]) ?? [], language: (r.language as string | null) ?? null, sponsored: (r.sponsored as boolean | null) ?? null, linkFollow: (r.link_follow as string | null) ?? null });
  }
  const read: Listing[] = [];
  let stopped: "done" | "capped" | "no_key" | "failed" = "done";
  let detail: string | undefined;
  const missing = (ds: string[]) => ds.filter((d) => !listings.has(d));
  for (const [i, batch] of [missing([...top3, own]), missing(citedHosts).slice(0, Math.max(0, Math.floor(budget.left / 2)))].entries()) {
    if (!batch.length || stopped === "no_key" || stopped === "failed") continue;
    const r = await readDomains(batch, budget, `search-domains batch ${i + 1}`);
    for (const l of r.listings) listings.set(l.domain, l);
    read.push(...r.listings);
    if (r.stopped !== "done") ({ stopped, detail } = r);
  }

  const floor = drFloor((serp ?? []) as TopRow[], client.domain, new Map([...listings].map(([d, l]) => [d, l.dr])));
  const databases = client.market === "UK" ? ["uk"] : client.market === "US" ? ["us"] : undefined;
  const filters = { minDr: floor.floor, minTraffic: 1000, maxPrice: 1260, languages: ["en"], databases };
  // Where the last run of this cluster got to, for these filters; a page it has paid for is not bought again.
  const { data: lastRun } = stored
    ? await db.from("shortlist_runs").select("inventory_cursor").eq("cluster_id", p.clusterId).not("inventory_cursor", "is", null).order("created_at", { ascending: false }).limit(1).maybeSingle()
    : { data: null };
  const cursor = cursorFrom(lastRun?.inventory_cursor, inventorySig(filters));
  const inventory: { listing: Listing; offer: "guest_post" | "link_insertion" }[] = [];
  const passed = new Set<string>();
  const offers = ["guest_post", "link_insertion"] as const;
  // A page is bought only while it can be vetted and the request has time left: a host the run cannot read cannot
  // pass, so buying it is paying for nothing (MOR's first run, 7 Nov 2026, had 22 cited hosts to read first).
  const vettable = () => topicBudget >= INVENTORY_PAGE && geoBudget >= 1 && Date.now() - started < RUN_MS;
  // An offer is done for this run when its pages run out or a page brings nothing this run has not already paid for:
  // a page is never bought twice in one run, whatever Fatgrid says about the next one.
  const exhausted = new Set<string>();
  const seenThisRun = new Set<string>();
  const notes: string[] = [];
  for (let turn = 0; turn < 40; turn++) {
    if (exhausted.size === offers.length) break;
    if (stopped === "no_key" || stopped === "failed" || budget.left < INVENTORY_PAGE || passed.size >= ENOUGH_PASSING || !vettable()) break;
    const offer = offers[turn % 2]!;
    if (exhausted.has(offer)) continue;
    const page = cursor[offer];
    const r = await readInventoryPage({ ...filters, offerType: offer }, page, INVENTORY_PAGE, budget);
    if (r.stopped === "no_key" || r.stopped === "failed") {
      ({ stopped, detail } = r);
      break;
    }
    const repeated = r.listings.length > 0 && r.listings.every((l) => seenThisRun.has(`${offer}|${l.domain}`));
    for (const l of r.listings) seenThisRun.add(`${offer}|${l.domain}`);
    if (!r.listings.length || !r.hasMore || repeated) {
      // The end of this offer's inventory, or a page Fatgrid has already sent: start from the top next run.
      exhausted.add(offer);
      cursor[offer] = 1;
      if (repeated) notes.push(`Fatgrid repeated ${offer} page ${page}; stopped that offer.`);
    } else cursor[offer] = page + 1;
    read.push(...r.listings);
    const incoming = r.listings.filter((l) => !rejected.has(l.domain) && l.domain !== own && !l.domain.endsWith(`.${own}`));
    await check(incoming.map((l) => l.domain), new Map(incoming.map((l) => [l.domain, l.categories])));
    for (const l of incoming) {
      if (!passes(l.domain, citedHosts.includes(l.domain))) continue;
      inventory.push({ listing: l, offer });
      passed.add(l.domain);
    }
  }
  if (stopped === "done" && budget.left < INVENTORY_PAGE && passed.size < ENOUGH_PASSING) stopped = "capped";

  const hosts = new Map<string, HostNote>();
  for (const [d, c] of checks) if (!gatedOut.has(d)) hosts.set(d, { marketShare: c.marketShare, market: c.market, fitReason: c.fitReason });
  const keptCited = cited.filter((c) => citedHosts.includes(c.domain));
  const items = rankShortlist({ clientDomain: client.domain, clientDr: listings.get(own)?.dr ?? null, floor: floor.floor, keyword, cited: keptCited, listings, inventory, hosts }).filter((c) => c.ownSite || !rejected.has(c.domain));
  // Units are what Fatgrid returned on this run: one per domain on the Pro plan.
  const outcome = stopped === "done" ? "ok" : stopped;
  // The note holds 500 characters, so each host gets the first clause of why ("8% UK traffic", "off topic"); the
  // full reading is in shortlist_host_checks once batch B is in.
  const out = [...gatedOut].map(([d, why]) => `${d} (${why.split(/[:;,]/)[0]!.trim()})`);
  const gateNote = [
    detail ?? null,
    ...notes,
    out.length ? `Gated out: ${out.join("; ")}.` : null,
    checks.size ? `Host checks: ${checks.size} read, $${checkCost.toFixed(2)} of DataForSEO, ${modelCalls} model calls.` : null,
  ].filter(Boolean).join(" ");
  const result: ShortlistResult = { outcome, units: read.length, floor, keyword, items, added: 0, dropped: 0, note: gateNote || null, cursor: stored ? cursor : null };
  if (p.dryRun) return result;
  return writeRun(db, p, client.id as string, result, read, stored);
}

function legacyNote(c: Candidate): string | null {
  const share = c.marketShare === null ? null : `${Math.round(c.marketShare * 100)}% ${c.market} traffic.`;
  return [share, c.fitReason ? `Fits: ${c.fitReason}` : null].filter(Boolean).join(" ") || null;
}

async function writeRun(db: SupabaseClient, p: { clientId: string; clusterId: string; reason: string }, clientId: string, r: ShortlistResult, read: Listing[], stored: boolean): Promise<ShortlistResult> {
  const now = new Date().toISOString();
  // One row a domain: a host offering both guest posts and insertions comes back from both pulls, and an upsert that
  // touches a row twice fails whole - which left the cache empty after Common's run on 6 Nov 2026.
  const unique = [...new Map(read.map((l) => [l.domain, l])).values()];
  if (unique.length) {
    const { error } = await db.from("fatgrid_listings").upsert(
      unique.map((l) => ({ domain: l.domain, dr: l.dr, traffic: l.traffic, best_price_usd: l.bestPrice, offers: l.offers, categories: l.categories, language: l.language, sponsored: l.sponsored, link_follow: l.linkFollow, fetched_at: now })),
      { onConflict: "domain" },
    );
    if (error) console.warn(`[csm] listings not cached: ${error.message}`);
  }
  const { data: run, error: runErr } = await db
    .from("shortlist_runs")
    .insert({ client_domain_id: clientId, cluster_id: p.clusterId, keyword: r.keyword, reason: p.reason, dr_floor: r.floor.floor, dr_floor_source: r.floor.source, serp_read_on: r.floor.readOn, units_used: r.units, outcome: r.outcome, note: r.note?.slice(0, 500) ?? null, ...(stored ? { inventory_cursor: r.cursor } : {}) })
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
      client_visible: c.clientVisible, own_site: c.ownSite, last_run_id: run.id, updated_at: now,
      // Before batch B the gate's findings ride in the note; after it, in their own columns.
      ...(stored ? { note: c.note, market_share: c.marketShare, market: c.market, fit_reason: c.fitReason } : { note: [c.note, legacyNote(c)].filter(Boolean).join(" ").slice(0, 500) || null }),
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
