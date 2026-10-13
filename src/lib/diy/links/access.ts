import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Whether the Backlinks data is available to this account (13 Oct 2026, DIY
 * P10; spec 10 section 4.8, "Backlinks access inactive"), and which filter
 * names the night's free probe stored.
 *
 * **Access is read from the latest paid Backlinks call, never from the
 * probe.** The free `available_filters` read answers whatever the account's
 * access (research note 04 section 1), so it only says which filter names
 * exist. The latest `diy_reads` row on the `backlinks` door that settled -
 * ok, partial or failed, across the whole account, since access is the
 * account's - decides:
 *
 * - none yet: `not_read` (the page says the profile is read weekly, and when);
 * - ok or partial: `active`;
 * - failed with an access code: `inactive` - sections 1-5 are hidden and the
 *   page says "Your link profile isn't available yet." Check a link and the
 *   pursued link wins still work;
 * - failed with any other code (a timeout, a 5xx): `failed` - what was read
 *   before still shows, with the night's "didn't finish" line.
 *
 * The codes, from DataForSEO's appendix/errors read 13 Oct 2026: 40204 is
 * "access denied. visit plans and subscriptions to activate your
 * subscription and get access to this api" - the Backlinks commitment's
 * code, the one this state exists for ([VERIFY] on the first failing call:
 * the commitment was removed on 1 Jul 2026, research note 04 section 1, so a
 * live account should never see it). The account-wide refusals read the same
 * way, since no Backlinks read can succeed past them: 40100 (not
 * authorised), 40104 (account not verified), 40200 and 40210 (payment
 * required, insufficient funds), 40201 (access paused), 40207 (IP not
 * whitelisted), and HTTP 401, 402 and 403.
 *
 * Plain module, the database passed in, so node --test runs it.
 */

export const ACCESS_CODES: readonly number[] = [40100, 40104, 40200, 40201, 40204, 40207, 40210];
export const ACCESS_HTTP: readonly number[] = [401, 402, 403];

export type AccessState = "not_read" | "active" | "inactive" | "failed";
export type Access = { state: AccessState; at: string | null; code: number | null };

/** The latest settled Backlinks ledger row, as `diy_reads` holds it. */
export type LedgerRow = { status: string; code: string | null; created_at: string };

/**
 * The DataForSEO code in a ledger row's `code`, as the ledger writes it
 * (tracking/decide.ts readFailureReason): "task 40204 access denied...",
 * "DataForSEO returned no task (40204 ...)", or "HTTP 403". Null for a
 * timeout or anything without a code.
 */
export function codeOf(code: string | null): { task: number | null; http: number | null } {
  if (!code) return { task: null, http: null };
  const http = /^HTTP (\d{3})\b/.exec(code);
  if (http) return { task: null, http: Number(http[1]) };
  const task = /\b(4\d{4}|5\d{4})\b/.exec(code);
  return { task: task ? Number(task[1]) : null, http: null };
}

/** Access from the latest settled Backlinks read. Pure. */
export function accessFrom(latest: LedgerRow | null): Access {
  if (!latest) return { state: "not_read", at: null, code: null };
  if (latest.status === "ok" || latest.status === "partial") return { state: "active", at: latest.created_at, code: null };
  const c = codeOf(latest.code);
  if ((c.task !== null && ACCESS_CODES.includes(c.task)) || (c.http !== null && ACCESS_HTTP.includes(c.http))) return { state: "inactive", at: latest.created_at, code: c.task ?? c.http };
  return { state: "failed", at: latest.created_at, code: c.task ?? c.http };
}

/** The latest settled Backlinks read across the account. Throws on a failed read: the page's section says so. */
export async function readLinksAccess(db: SupabaseClient): Promise<Access> {
  const { data, error } = await db
    .from("diy_reads")
    .select("status, code, created_at")
    .eq("door", "backlinks")
    .in("status", ["ok", "partial", "failed"])
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(`could not read the Backlinks ledger: ${error.message}`);
  return accessFrom(((data ?? []) as LedgerRow[])[0] ?? null);
}

/** What the stored filter names say the wave 3 requests can rely on. */
export type FilterNames = { read: boolean; intersectionsCount: boolean };

/**
 * From the night's `backlinks_filters` payload (P1's parseBacklinksFilters:
 * filter names per object group): whether `domain_intersection` can filter
 * on `intersections_count`. Unread, or a payload of another shape, reads as
 * no filter - the gap then takes the pairwise reads, which give the same set
 * at two more calls.
 */
export function filterNames(payload: unknown): FilterNames {
  const groups = payload && typeof payload === "object" ? (payload as { groups?: unknown }).groups : null;
  if (!groups || typeof groups !== "object") return { read: false, intersectionsCount: false };
  const di = (groups as Record<string, unknown>).domain_intersection;
  return { read: true, intersectionsCount: Array.isArray(di) && di.includes("intersections_count") };
}

/** The latest stored Backlinks filter names. A failed read throws; the caller treats it as unread. */
export async function readFilterNames(db: SupabaseClient): Promise<FilterNames> {
  const { data, error } = await db.from("diy_vendor_status").select("payload, read_on").eq("kind", "backlinks_filters").order("read_on", { ascending: false }).limit(1);
  if (error) throw new Error(`could not read the Backlinks filter names: ${error.message}`);
  return filterNames(((data ?? []) as { payload: unknown }[])[0]?.payload ?? null);
}
