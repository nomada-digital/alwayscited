/**
 * The pure half of the Fatgrid client (phase 1, 5 Nov 2026): what we ask, how we read the answer, and how many units
 * a read may spend. No key and no network, so Node's runner executes it; fatgrid.ts keeps the fetch.
 *
 * AGENCY ONLY. Fatgrid's prices, DR and traffic are never shown to a client and never stored outside the agency
 * tables (csm-isolation.test.mts holds the line). Nothing here logs a response.
 *
 * API shape (the fatgrid skill): base https://api.fatgrid.com/api/public; GET takes ?key=, POST takes x-api-key.
 * `domains_list` pages up to 500 a request, `domain_prices` reads one domain, `search-domains` batches up to 500,
 * `marketplaces_list` is free. Free and Pro plans charge one unit per domain returned.
 *
 * Imports are relative and carry the extension, for the reason dataforseo-request.ts gives.
 */

import { normalizeDomain } from "../scan/domain.ts";

export const FATGRID_BASE = "https://api.fatgrid.com/api/public";
/** The most one request returns. */
export const PAGE_MAX = 500;

export type OfferType = "guest_post" | "link_insertion";

/** One marketplace listing as the shortlist uses it. USD throughout: Fatgrid prices are all USD. */
export type Listing = {
  domain: string;
  dr: number | null;
  traffic: number | null;
  bestPrice: number | null;
  /** Each marketplace offer: guest post or link insertion, and its USD price. */
  offers: { type: OfferType | null; price: number | null }[];
  categories: string[];
  language: string | null;
  sponsored: boolean | null;
  linkFollow: string | null;
};

/** Units left to spend on one run. Spending stops at the cap; it never goes over. */
export class UnitBudget {
  used = 0;
  readonly cap: number;
  constructor(cap: number) {
    this.cap = cap;
  }
  get left(): number {
    return Math.max(0, this.cap - this.used);
  }
  spend(n: number): void {
    this.used += Math.max(0, n);
  }
}

export type InventoryFilters = {
  offerType: OfferType;
  minDr?: number;
  maxDr?: number;
  minTraffic?: number;
  maxPrice?: number;
  categories?: string[];
  languages?: string[];
  databases?: string[];
};

/** The query for one page of `domains_list`, asking for no more domains than the budget has left. Null when it has none. */
export function inventoryQuery(f: InventoryFilters, page: number, left: number): URLSearchParams | null {
  const limit = Math.min(PAGE_MAX, left);
  if (limit < 1) return null;
  const q = new URLSearchParams({ type: "domains_list", page: String(page), limit: String(limit), offerType: f.offerType, linkFollow: "dofollow", sponsored: "false" });
  if (f.minDr !== undefined) q.set("minDr", String(Math.round(f.minDr)));
  if (f.maxDr !== undefined) q.set("maxDr", String(Math.round(f.maxDr)));
  if (f.minTraffic !== undefined) q.set("minTotalOrganicTraffic", String(Math.round(f.minTraffic)));
  if (f.maxPrice !== undefined) q.set("maxPrice", String(Math.round(f.maxPrice)));
  if (f.categories?.length) q.set("categories", f.categories.join(","));
  if (f.languages?.length) q.set("languages", f.languages.join(","));
  if (f.databases?.length) q.set("databases", f.databases.join(","));
  return q;
}

/** The domains for one `search-domains` request: normalised, deduplicated, and cut to what the budget has left. */
export function searchBatch(domains: readonly string[], left: number): string[] {
  const out: string[] = [];
  for (const d of domains) {
    const n = normalizeDomain(d);
    if (n && !out.includes(n)) out.push(n);
    if (out.length >= Math.min(PAGE_MAX, left)) break;
  }
  return out;
}

const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};
const offerType = (v: unknown): OfferType | null => (v === "guest_post" || v === "link_insertion" ? v : null);

/** A response item as a Listing, or null when it names no domain. Fields we do not use are dropped here. */
export function readListing(raw: unknown): Listing | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const domain = typeof r.url === "string" ? normalizeDomain(r.url) : "";
  if (!domain) return null;
  const resources = Array.isArray(r.resources) ? r.resources : [];
  return {
    domain,
    dr: num(r.dr),
    traffic: num(r.totalOrganicTraffic),
    bestPrice: num(r.bestPrice),
    offers: resources.map((o) => ({ type: offerType((o as Record<string, unknown>)?.type), price: num((o as Record<string, unknown>)?.price) })),
    categories: Array.isArray(r.categories) ? r.categories.filter((c): c is string => typeof c === "string").slice(0, 12) : [],
    language: typeof r.language === "string" ? r.language : null,
    sponsored: typeof r.sponsored === "boolean" ? r.sponsored : null,
    linkFollow: typeof r.linkFollow === "string" ? r.linkFollow : null,
  };
}

/** The listings in a `domains_list` or `search-domains` answer, and whether `domains_list` has another page. */
export function readPage(body: unknown): { listings: Listing[]; hasMore: boolean } {
  const b = (body ?? {}) as { items?: unknown; hasMore?: unknown };
  const listings = (Array.isArray(b.items) ? b.items : []).map(readListing).filter((l): l is Listing => l !== null);
  return { listings, hasMore: b.hasMore === true };
}

/** The cheapest offer of a type, else the best price. */
export function priceFor(l: Listing, type: OfferType): number | null {
  const ofType = l.offers.filter((o) => o.type === type && o.price !== null).map((o) => o.price!);
  return ofType.length ? Math.min(...ofType) : l.bestPrice;
}
