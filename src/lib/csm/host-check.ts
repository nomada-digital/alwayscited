import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { readHostFit } from "@/lib/scan/anthropic";
import { readTrafficByLocation } from "@/lib/scan/dataforseo";

import { HOST_CHECK_TTL_DAYS, type HostCheck, MARKET_LOCATION, homepageHeadlines, marketShare } from "./host-gates";

/**
 * The reads behind the shortlist's quality gates (7 Nov 2026; the rule is host-gates.ts). AGENCY ONLY.
 *
 * A host is read once per client and kept HOST_CHECK_TTL_DAYS in shortlist_host_checks, so a rerun pays nothing to
 * pass or fail it again. The two halves are read in the order of their cost (7 Nov 2026, MOR's first run): the topic
 * first - the homepage and one small-model call for up to FIT_BATCH hosts, through scan/anthropic.ts readHostFit (the
 * one gate every model call goes through), a fraction of a cent a host - and the market only for a host that fits,
 * DataForSEO Labs' every-location traffic at about $0.02. Most inventory fails on topic and never costs the second.
 * Each half has its own allowance and its own read date. Nothing here is fatal: a host that cannot be read stays
 * unknown, and the gates treat unknown as not proven.
 *
 * `stored` is false before migration 20261107000000 is applied: nothing is cached then, and every run reads afresh.
 */

const FIT_BATCH = 8;

/** The homepage, as headlines. Empty when it cannot be fetched: many sites refuse a server, and that proves nothing. */
export async function readHomepage(domain: string): Promise<string[]> {
  for (const url of [`https://${domain}/`, `https://www.${domain}/`]) {
    try {
      const res = await fetch(url, { headers: { "user-agent": "alwayscited-shortlist/1.0 (+https://alwayscited.com)", accept: "text/html" }, redirect: "follow", signal: AbortSignal.timeout(8000) });
      if (!res.ok || !(res.headers.get("content-type") ?? "").includes("html")) continue;
      const lines = homepageHeadlines((await res.text()).slice(0, 400_000));
      if (lines.length) return lines;
    } catch {
      // Unreachable or slow: try the www host, then give up.
    }
  }
  return [];
}

type Row = { domain: string; market: string | null; market_share: number | null; market_etv: number | null; total_etv: number | null; geo_read_on: string | null; fits: boolean | null; fit_reason: string | null; fit_read_on: string | null };

const asCheck = (r: Row): HostCheck => ({
  domain: r.domain, market: r.market, marketShare: r.market_share === null ? null : Number(r.market_share),
  marketEtv: r.market_etv === null ? null : Number(r.market_etv), totalEtv: r.total_etv === null ? null : Number(r.total_etv),
  fits: r.fits, fitReason: r.fit_reason,
});

/**
 * Every host's reading for one client: the cache first, then fresh topic reads (at most `topicLimit`), then fresh
 * market reads for the hosts that fit (at most `geoLimit`), cached as they are made. `categories` is what Fatgrid says
 * of a host when it has come back from it already; a hint, never the verdict.
 */
export async function checkHosts(
  db: SupabaseClient,
  p: { clientId: string; market: string | null; profile: string; domains: readonly string[]; categories?: ReadonlyMap<string, string[]>; topicLimit: number; geoLimit: number; stored: boolean },
): Promise<{ checks: Map<string, HostCheck>; topicReads: number; geoReads: number; costUsd: number; modelCalls: number }> {
  const wanted = [...new Set(p.domains)];
  const rows = new Map<string, Row>();
  const blank = (domain: string): Row => ({ domain, market: p.market, market_share: null, market_etv: null, total_etv: null, geo_read_on: null, fits: null, fit_reason: null, fit_read_on: null });
  if (!wanted.length) return { checks: new Map(), topicReads: 0, geoReads: 0, costUsd: 0, modelCalls: 0 };
  const since = new Date(Date.now() - HOST_CHECK_TTL_DAYS * 86_400_000).toISOString();
  if (p.stored) {
    const { data, error } = await db.from("shortlist_host_checks").select("domain, market, market_share, market_etv, total_etv, geo_read_on, fits, fit_reason, fit_read_on").eq("client_domain_id", p.clientId).in("domain", wanted);
    if (error) console.warn(`[csm] host checks not read: ${error.message}`);
    for (const r of (data ?? []) as Row[]) {
      // A half is kept while it is fresh; the market half only for the same market. Anything else is read again.
      const geoFresh = r.market === p.market && !!r.geo_read_on && r.geo_read_on >= since;
      const fitFresh = !!r.fit_read_on && r.fit_read_on >= since;
      rows.set(r.domain, {
        ...blank(r.domain),
        ...(geoFresh ? { market_share: r.market_share, market_etv: r.market_etv, total_etv: r.total_etv, geo_read_on: r.geo_read_on } : {}),
        ...(fitFresh ? { fits: r.fits, fit_reason: r.fit_reason, fit_read_on: r.fit_read_on } : {}),
      });
    }
  }
  for (const d of wanted) if (!rows.has(d)) rows.set(d, blank(d));
  const now = new Date().toISOString();
  const touched = new Set<string>();

  // 1. Topic, for the hosts with no fresh reading: the homepage, then the model in batches.
  const topicTodo = wanted.filter((d) => !rows.get(d)!.fit_read_on).slice(0, Math.max(0, p.topicLimit));
  const pages = await Promise.all(topicTodo.map(async (domain) => ({ domain, lines: await readHomepage(domain) })));
  const billed = { calls: 0 };
  for (let i = 0; i < pages.length; i += FIT_BATCH) {
    const batch = pages.slice(i, i + FIT_BATCH).map((r) => ({ domain: r.domain, lines: r.lines, categories: p.categories?.get(r.domain) ?? [] }));
    try {
      for (const h of await readHostFit(p.profile, batch, billed)) {
        const d = h.domain.trim().toLowerCase();
        if (!batch.some((x) => x.domain === d)) continue;
        Object.assign(rows.get(d)!, { fits: h.fits, fit_reason: h.reason.replace(/\s+/g, " ").trim().slice(0, 300), fit_read_on: now });
        touched.add(d);
      }
    } catch (err) {
      console.warn(`[csm] topic fit not read for ${batch.length} hosts: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 2. Market, only for hosts that fit and have no fresh reading for this market.
  const location = p.market ? MARKET_LOCATION[p.market] : undefined;
  let costUsd = 0;
  const geoTodo = location === undefined ? [] : wanted.filter((d) => rows.get(d)!.fits === true && !rows.get(d)!.geo_read_on).slice(0, Math.max(0, p.geoLimit));
  await Promise.all(
    geoTodo.map(async (domain) => {
      try {
        const r = await readTrafficByLocation(domain);
        costUsd += r.cost;
        const g = marketShare(r.items, location!);
        Object.assign(rows.get(domain)!, { market: p.market, market_share: g.share, market_etv: Math.round(g.marketEtv), total_etv: Math.round(g.totalEtv), geo_read_on: now });
        touched.add(domain);
      } catch (err) {
        console.warn(`[csm] traffic by location not read for ${domain}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }),
  );

  if (p.stored && touched.size) {
    const out = [...touched].map((d) => ({ client_domain_id: p.clientId, ...rows.get(d)! }));
    const { error } = await db.from("shortlist_host_checks").upsert(out, { onConflict: "client_domain_id,domain" });
    if (error) console.warn(`[csm] host checks not cached: ${error.message}`);
  }
  return {
    checks: new Map([...rows].map(([d, r]) => [d, asCheck(r)])),
    topicReads: pages.length, geoReads: geoTodo.length, costUsd: Math.round(costUsd * 10_000) / 10_000, modelCalls: billed.calls,
  };
}
