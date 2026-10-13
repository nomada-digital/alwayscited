import type { SupabaseClient } from "@supabase/supabase-js";

import { selectAll } from "../../supabase/page.ts";
import { urlKey } from "../../tracking/placements.ts";

/**
 * Nomada's placements for other clients, subtracted from every Links list
 * (13 Oct 2026, DIY P10; spec 10 sections 2.3 and 6.3, and the review log's
 * blocker). On Links the subtraction is **by domain** as well as by page:
 * these lists are the closest to what the alwayscited plan sells (followed
 * links inside articles on pages that rank), so a domain where Nomada has
 * placed any other client - whatever that placement's status - is
 * inventory, and none of its pages is listed, counted or revealed either.
 *
 * Only `placements.domain` and `placements.url_key` of every client but this
 * one are read, and only to subtract: nothing about them is shown, and the
 * same words answer for every row that is not there. The client's own
 * placements are not subtracted. Applied before any count, so the "N more"
 * lines and the U5 trigger count what is left.
 */

export type Placed = { domains: ReadonlySet<string>; keys: ReadonlySet<string> };

export const NONE_PLACED: Placed = { domains: new Set(), keys: new Set() };

/** A host as the lists hold it: lower case, no `www.`, no trailing dot. */
export const bareHost = (host: string): string => host.trim().toLowerCase().replace(/^www\./, "").replace(/\.$/, "");

/** Whether a host is a placed domain or under one ("blog.brightbook.example" under "brightbook.example"). */
export function onPlacedDomain(host: string, placed: Placed): boolean {
  const h = bareHost(host);
  for (const d of placed.domains) if (h === d || h.endsWith(`.${d}`)) return true;
  return false;
}

/** Whether a page is a placed page, or on a placed domain. */
export function isPlacedUrl(url: string, placed: Placed): boolean {
  const key = urlKey(url);
  if (key && placed.keys.has(key)) return true;
  try {
    return onPlacedDomain(new URL(url).hostname, placed);
  } catch {
    return false;
  }
}

/**
 * The rows to keep: every row whose domain is not a placed domain and whose
 * page (when it has one) is not a placed page. Never the matches. Pure.
 */
export function withoutPlacedDomains<T extends { domain: string; url?: string | null }>(rows: readonly T[], placed: Placed): T[] {
  return rows.filter((r) => !onPlacedDomain(r.domain, placed) && !(r.url && isPlacedUrl(r.url, placed)));
}

/** The placements of every client but this one: their domains and page keys. Paged; a failed read throws, and the caller fails closed. */
export async function readPlacedDomains(db: SupabaseClient, clientId: string): Promise<Placed> {
  const rows = await selectAll<{ domain: string | null; url_key: string | null }>((lo, hi) => db.from("placements").select("domain, url_key").neq("client_domain_id", clientId).order("id", { ascending: true }).range(lo, hi));
  const domains = new Set<string>();
  const keys = new Set<string>();
  for (const r of rows) {
    if (typeof r.domain === "string" && r.domain.trim()) domains.add(bareHost(r.domain));
    if (typeof r.url_key === "string" && r.url_key) keys.add(r.url_key);
  }
  return { domains, keys };
}

/**
 * The rows to keep after subtracting every domain and page where Nomada has
 * placed any other client (spec 7.11: `excludePlacedDomains(rows, clientId)`).
 * The placements are read through `read` - Supabase's, or the fixture's - and
 * a read that fails throws: a list that could not be checked is not shown.
 */
export async function excludePlacedDomains<T extends { domain: string; url?: string | null }>(rows: readonly T[], clientId: string, read: (clientId: string) => Promise<Placed>): Promise<T[]> {
  return withoutPlacedDomains(rows, await read(clientId));
}
