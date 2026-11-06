import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { readHostFit } from "@/lib/scan/anthropic";
import { readTrafficByLocation } from "@/lib/scan/dataforseo";

import { HOST_CHECK_TTL_DAYS, type HostCheck, MARKET_LOCATION, homepageHeadlines, marketShare } from "./host-gates";

/**
 * The reads behind the shortlist's quality gates (7 Nov 2026; the rule is host-gates.ts). AGENCY ONLY.
 *
 * A host is read once per client and kept HOST_CHECK_TTL_DAYS in shortlist_host_checks, so a rerun pays nothing to
 * pass or fail it again. A fresh read is DataForSEO Labs' every-location traffic (about $0.02) and the homepage, then
 * one model call for up to FIT_BATCH hosts, through scan/anthropic.ts readHostFit (the one gate every model call
 * goes through). Nothing here is fatal: a host that cannot be read stays unknown, and the gates treat unknown as not
 * proven.
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

/**
 * Every host's reading for one client: the cache first, then at most `limit` fresh reads, cached as they are made.
 * `categories` is what Fatgrid says of a host, when the host has come back from it already; a hint, never the verdict.
 */
export async function checkHosts(
  db: SupabaseClient,
  p: { clientId: string; market: string | null; profile: string; domains: readonly string[]; categories?: ReadonlyMap<string, string[]>; limit: number; stored: boolean },
): Promise<{ checks: Map<string, HostCheck>; fresh: number; costUsd: number; modelCalls: number }> {
  const checks = new Map<string, HostCheck>();
  const wanted = [...new Set(p.domains)];
  if (!wanted.length) return { checks, fresh: 0, costUsd: 0, modelCalls: 0 };
  if (p.stored) {
    const since = new Date(Date.now() - HOST_CHECK_TTL_DAYS * 86_400_000).toISOString();
    const { data, error } = await db.from("shortlist_host_checks").select("domain, market, market_share, market_etv, total_etv, geo_read_on, fits, fit_reason, fit_read_on").eq("client_domain_id", p.clientId).in("domain", wanted);
    if (error) console.warn(`[csm] host checks not read: ${error.message}`);
    for (const r of data ?? []) {
      // Kept only while both halves are fresh and for the same market; anything else is read again.
      if (r.market !== p.market || !r.geo_read_on || r.geo_read_on < since || !r.fit_read_on || r.fit_read_on < since) continue;
      checks.set(r.domain as string, {
        domain: r.domain as string, market: r.market as string | null, marketShare: r.market_share === null ? null : Number(r.market_share),
        marketEtv: r.market_etv === null ? null : Number(r.market_etv), totalEtv: r.total_etv === null ? null : Number(r.total_etv),
        fits: r.fits as boolean | null, fitReason: r.fit_reason as string | null,
      });
    }
  }
  const todo = wanted.filter((d) => !checks.has(d)).slice(0, Math.max(0, p.limit));
  let costUsd = 0;
  const location = p.market ? MARKET_LOCATION[p.market] : undefined;
  const read = await Promise.all(
    todo.map(async (domain) => {
      let geo: ReturnType<typeof marketShare> | null = null;
      if (location !== undefined) {
        try {
          const r = await readTrafficByLocation(domain);
          costUsd += r.cost;
          geo = marketShare(r.items, location);
        } catch (err) {
          console.warn(`[csm] traffic by location not read for ${domain}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      return { domain, geo, lines: await readHomepage(domain) };
    }),
  );
  const fit = new Map<string, { fits: boolean; reason: string }>();
  const billed = { calls: 0 };
  for (let i = 0; i < read.length; i += FIT_BATCH) {
    const batch = read.slice(i, i + FIT_BATCH).map((r) => ({ domain: r.domain, lines: r.lines, categories: p.categories?.get(r.domain) ?? [] }));
    try {
      for (const h of await readHostFit(p.profile, batch, billed)) {
        const d = h.domain.trim().toLowerCase();
        if (batch.some((x) => x.domain === d)) fit.set(d, { fits: h.fits, reason: h.reason.replace(/\s+/g, " ").trim().slice(0, 300) });
      }
    } catch (err) {
      console.warn(`[csm] topic fit not read for ${batch.length} hosts: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  const now = new Date().toISOString();
  const rows = read.map((r) => {
    const f = fit.get(r.domain) ?? null;
    const c: HostCheck = {
      domain: r.domain, market: p.market, marketShare: r.geo?.share ?? null, marketEtv: r.geo ? Math.round(r.geo.marketEtv) : null,
      totalEtv: r.geo ? Math.round(r.geo.totalEtv) : null, fits: f?.fits ?? null, fitReason: f?.reason ?? null,
    };
    checks.set(r.domain, c);
    return {
      client_domain_id: p.clientId, domain: r.domain, market: p.market, market_share: c.marketShare, market_etv: c.marketEtv, total_etv: c.totalEtv,
      // A half that could not be read is not kept as read, so the next run tries it again.
      geo_read_on: r.geo || location === undefined ? now : null, fits: c.fits, fit_reason: c.fitReason, fit_read_on: f ? now : null,
    };
  });
  if (p.stored && rows.length) {
    const { error } = await db.from("shortlist_host_checks").upsert(rows, { onConflict: "client_domain_id,domain" });
    if (error) console.warn(`[csm] host checks not cached: ${error.message}`);
  }
  return { checks, fresh: read.length, costUsd: Math.round(costUsd * 10_000) / 10_000, modelCalls: billed.calls };
}
