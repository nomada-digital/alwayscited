import "server-only";

import { FATGRID_DEFAULTS, capFrom } from "@/config/csm";

import { FATGRID_BASE, type InventoryFilters, type Listing, UnitBudget, errorSnippet, inventoryQuery, readPage, searchBatch } from "./fatgrid-request";

/**
 * Fatgrid reads for the placement shortlist (phase 1, 5 Nov 2026). AGENCY ONLY - see fatgrid-request.ts.
 *
 * Keyed on FATGRID_API_KEY from the environment and nowhere else, the variable the scan's difficulty score already
 * uses. Every read spends from a UnitBudget and stops at its cap; the budget a run starts with is
 * `runBudget()`, FATGRID_UNIT_CAP (default FATGRID_DEFAULTS.unitCapPerRun), cut further to what the month has left
 * under FATGRID_MONTHLY_UNIT_CAP by the caller, which reads fatgrid_usage. No key, an error or a refusal end the same way: the read returns what
 * it has so far and says why it stopped. Never throws.
 */
export type ReadOutcome = { listings: Listing[]; units: number; stopped: "done" | "capped" | "no_key" | "failed"; detail?: string };

/** A refusal, named by the call that met it: the status and the start of Fatgrid's own message. Logged and returned. */
async function refused(res: Response, call: string, key: string): Promise<string> {
  const body = await res.text().catch(() => "");
  const detail = `Fatgrid answered ${res.status} on ${call}${body ? `: ${errorSnippet(body, key)}` : ""}`;
  console.warn(`[csm] ${detail}`);
  return detail;
}

export function runBudget(): UnitBudget {
  return new UnitBudget(capFrom(process.env.FATGRID_UNIT_CAP, FATGRID_DEFAULTS.unitCapPerRun));
}

export function monthlyUnitCap(): number {
  return capFrom(process.env.FATGRID_MONTHLY_UNIT_CAP, FATGRID_DEFAULTS.monthlyUnitCap);
}

/**
 * One page of `domains_list`, `pageSize` domains, from the budget. The page size is fixed by the caller so a page
 * number always means the same offset, and a rerun can start where the last run stopped (shortlist.ts keeps the
 * cursor) instead of paying again for domains it has already seen.
 */
export async function readInventoryPage(filters: InventoryFilters, page: number, pageSize: number, budget: UnitBudget): Promise<ReadOutcome & { hasMore: boolean }> {
  const key = process.env.FATGRID_API_KEY;
  if (!key) return { listings: [], units: 0, stopped: "no_key", hasMore: false };
  if (budget.left < pageSize) return { listings: [], units: 0, stopped: "capped", hasMore: true };
  const q = inventoryQuery(filters, page, pageSize);
  if (!q) return { listings: [], units: 0, stopped: "capped", hasMore: true };
  q.set("key", key);
  try {
    const res = await fetch(`${FATGRID_BASE}?${q}`, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) return { listings: [], units: 0, stopped: "failed", hasMore: false, detail: await refused(res, `domains_list ${filters.offerType} page ${page}`, key) };
    const read = readPage(await res.json());
    budget.spend(read.listings.length);
    // A full page may have more behind it whatever `hasMore` says: at five a page Fatgrid answered false on pages that
    // were not the last, and MOR's run on 7 Nov 2026 bought the same two pages over and over (56 units, 8 domains).
    return { listings: read.listings, units: read.listings.length, stopped: "done", hasMore: read.hasMore || read.listings.length >= pageSize };
  } catch (err) {
    return { listings: [], units: 0, stopped: "failed", hasMore: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

/** `search-domains` for named domains (the SERP's top three, the client's own, cited pages' hosts). */
export async function readDomains(domains: readonly string[], budget: UnitBudget, call = "search-domains"): Promise<ReadOutcome> {
  const key = process.env.FATGRID_API_KEY;
  if (!key) return { listings: [], units: 0, stopped: "no_key" };
  const batch = searchBatch(domains, budget.left);
  if (!batch.length) return { listings: [], units: 0, stopped: domains.length ? "capped" : "done" };
  try {
    const res = await fetch(`${FATGRID_BASE}/search-domains`, {
      method: "POST",
      headers: { "x-api-key": key, "content-type": "application/json" },
      body: JSON.stringify({ search: batch.join(",") }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return { listings: [], units: 0, stopped: "failed", detail: await refused(res, call, key) };
    const { listings } = readPage(await res.json());
    budget.spend(listings.length);
    return { listings, units: listings.length, stopped: batch.length < new Set(domains).size ? "capped" : "done" };
  } catch (err) {
    return { listings: [], units: 0, stopped: "failed", detail: err instanceof Error ? err.message : String(err) };
  }
}
