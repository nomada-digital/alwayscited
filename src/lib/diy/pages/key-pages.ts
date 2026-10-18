import type { SupabaseClient } from "@supabase/supabase-js";

import { selectAll } from "../../supabase/page.ts";
import { type CitationRow, type Day, addDays, citedPageRows } from "../../tracking/figures.ts";
import { urlKey } from "../../tracking/placements.ts";
import { ALLOWANCES } from "../core/allowances.ts";
import { type KeyPage, type KeyPageOrigin, KEY_PAGE_ORIGINS } from "./types.ts";

/**
 * Key pages (13 Oct 2026, DIY P8; spec 10 sections 4.9 and 6.4): the at most
 * 10 pages of the client's own site that the checks read. The weekly job
 * picks automatic pages until 10 are live, in this order:
 *
 * 1. the homepage;
 * 2. each live cluster's latest ranking URL (tracking_serp.url), deduplicated;
 * 3. the client's own pages the engines cited most in 28 days;
 * 4. from relevant_pages (monthly, when DIY is on), the highest-traffic pages.
 *
 * A member's page is never removed by the job. A page a member removed keeps
 * its row with removed_on, and is never added again automatically. A member
 * adding an 11th page replaces the oldest automatic one; with 10 pages all
 * added by members, there is no room, and the member is told so.
 */

/** Live key pages per client (allowances.ts key_pages; the same 10 on every tier). */
export const KEY_PAGES_MAX = ALLOWANCES.key_pages.full;

/** A key page's address, at most this long (key_pages.url's own check; the add form's bound). */
export const KEY_PAGE_URL_MAX = 500;

/** The cited pages counted over this many days. */
export const CITED_DAYS = 28;

export const KEY_PAGE_COLUMNS = "id, url, url_key, origin, cluster_ids, added_by, added_on, removed_on, removed_by";

const bare = (h: string) => h.toLowerCase().replace(/^www\./, "");

/** Whether a URL is on the client's own domain (or one of its subdomains), over http or https. */
export function isOwnUrl(raw: string, domain: string): boolean {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return false;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return false;
  if (u.username || u.password) return false;
  const host = bare(u.hostname);
  const own = bare(domain);
  return host === own || host.endsWith(`.${own}`);
}

/** The homepage's address. */
export const homepageOf = (domain: string) => `https://${bare(domain)}/`;

/** One key_pages row as the pages read it; null for a row that is not one. */
export function keyPageOf(r: Record<string, unknown>): KeyPage | null {
  if (typeof r.id !== "string" && typeof r.id !== "number") return null;
  if (typeof r.url !== "string" || typeof r.url_key !== "string") return null;
  const origin = (KEY_PAGE_ORIGINS as readonly string[]).includes(String(r.origin)) ? (r.origin as KeyPageOrigin) : null;
  if (!origin) return null;
  return {
    id: String(r.id),
    url: r.url,
    urlKey: r.url_key,
    origin,
    clusterIds: Array.isArray(r.cluster_ids) ? (r.cluster_ids as unknown[]).map(String) : [],
    addedBy: String(r.added_by ?? ""),
    addedOn: String(r.added_on ?? "").slice(0, 10),
    removedOn: r.removed_on ? String(r.removed_on).slice(0, 10) : null,
    removedBy: r.removed_by ? String(r.removed_by) : null,
  };
}

export type Candidate = { url: string; origin: Exclude<KeyPageOrigin, "member">; clusterIds: string[] };

export type Pick = {
  add: { url: string; urlKey: string; origin: KeyPageOrigin; clusterIds: string[] }[];
  clusters: { id: string; clusterIds: string[] }[];
  /** Candidates left out because their address is longer than key_pages allows (KEY_PAGE_URL_MAX). */
  tooLong: number;
};

const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x) => b.includes(x));

/**
 * The automatic picks, in the spec's order, until KEY_PAGES_MAX are live, and
 * each live page's clusters brought up to date from the same candidates (a
 * page serves the clusters whose keyword it ranks for). Every candidate must
 * be on the client's domain; a page removed by a member (any row of it with
 * removed_on) is never picked again. A candidate longer than KEY_PAGE_URL_MAX
 * (a ranking URL with faceted or tracking query strings) is left out and
 * counted: key_pages.url's own check would refuse it, and one such address
 * must not fail the week's job (13 Oct 2026, DIY P8 review).
 */
export function pickKeyPages(p: { rows: readonly KeyPage[]; candidates: readonly Candidate[]; domain: string; limit?: number }): Pick {
  const limit = p.limit ?? KEY_PAGES_MAX;
  const live = p.rows.filter((r) => r.removedOn === null);
  const removed = new Set(p.rows.filter((r) => r.removedOn !== null && !live.some((l) => l.urlKey === r.urlKey)).map((r) => r.urlKey));
  const served = new Map<string, Set<string>>();
  const add: Pick["add"] = [];
  const long = new Set<string>();
  for (const c of p.candidates) {
    if (!isOwnUrl(c.url, p.domain)) continue;
    if (c.url.length > KEY_PAGE_URL_MAX) {
      long.add(c.url);
      continue;
    }
    const key = urlKey(c.url);
    if (!key) continue;
    const s = served.get(key) ?? served.set(key, new Set()).get(key)!;
    for (const id of c.clusterIds) s.add(id);
    if (removed.has(key) || live.some((l) => l.urlKey === key) || add.some((a) => a.urlKey === key)) continue;
    if (live.length + add.length >= limit) continue;
    add.push({ url: c.url, urlKey: key, origin: c.origin, clusterIds: [] });
  }
  for (const a of add) a.clusterIds = [...(served.get(a.urlKey) ?? [])].sort();
  // A member's page keeps the clusters a person gave it, plus any it ranks for (18 Oct 2026): it can be a cluster's
  // chosen target page (dash/target.ts), and one that does not rank yet must not lose its cluster on the next run.
  const clusters = live
    .map((l) => ({ id: l.id, clusterIds: [...new Set([...(served.get(l.urlKey) ?? []), ...(l.origin === "member" ? l.clusterIds : [])])].sort() }))
    .filter((c) => !sameSet(c.clusterIds, live.find((l) => l.id === c.id)!.clusterIds));
  return { add, clusters, tooLong: long.size };
}

export type MemberAdd =
  | { ok: true; add: { url: string; urlKey: string }; replace: KeyPage | null }
  | { ok: false; why: "not_own" | "already" | "full" | "bad_url" };

/** A member's page: on the client's domain, not live already, and a slot for it - the oldest automatic page gives way at 10. */
export function memberAdd(rows: readonly KeyPage[], raw: string, domain: string): MemberAdd {
  const url = raw.trim();
  if (url.length > KEY_PAGE_URL_MAX) return { ok: false, why: "bad_url" };
  const key = urlKey(url);
  if (!key || !/^https?:\/\//i.test(url)) return { ok: false, why: "bad_url" };
  if (!isOwnUrl(url, domain)) return { ok: false, why: "not_own" };
  const live = rows.filter((r) => r.removedOn === null);
  if (live.some((r) => r.urlKey === key)) return { ok: false, why: "already" };
  if (live.length < KEY_PAGES_MAX) return { ok: true, add: { url, urlKey: key }, replace: null };
  const auto = live.filter((r) => r.origin !== "member" && r.origin !== "homepage").sort((a, b) => (a.addedOn < b.addedOn ? -1 : a.addedOn > b.addedOn ? 1 : a.id < b.id ? -1 : 1));
  return auto.length ? { ok: true, add: { url, urlKey: key }, replace: auto[0]! } : { ok: false, why: "full" };
}

// ---- Reads and writes. Each looks at its own error, and every one is held to one client. ----

export async function readKeyPages(db: SupabaseClient, clientId: string): Promise<KeyPage[]> {
  const { data, error } = await db.from("key_pages").select(KEY_PAGE_COLUMNS).eq("client_domain_id", clientId).order("added_on", { ascending: true }).limit(500);
  if (error) throw new Error(`could not read the key pages: ${error.message}`);
  return ((data ?? []) as Record<string, unknown>[]).map(keyPageOf).filter((k): k is KeyPage => k !== null);
}

const DUPLICATE = "23505";
const CHECK_VIOLATION = "23514";

/**
 * One key page in: "added"; "duplicate" for a page live already (the unique
 * index), which is not an error - it is there; "refused" for a row the
 * table's own checks turn away, which the jobs count in their note rather
 * than fail on. Anything else throws.
 */
export async function insertKeyPage(db: SupabaseClient, clientId: string, row: { url: string; urlKey: string; origin: KeyPageOrigin; clusterIds: string[]; by: string; today: Day }): Promise<"added" | "duplicate" | "refused"> {
  if (row.url.length > KEY_PAGE_URL_MAX) return "refused";
  const { error } = await db.from("key_pages").insert({ client_domain_id: clientId, url: row.url, url_key: row.urlKey, origin: row.origin, cluster_ids: row.clusterIds, added_by: row.by, added_on: row.today });
  if (!error) return "added";
  if (error.code === DUPLICATE) return "duplicate";
  if (error.code === CHECK_VIOLATION) return "refused";
  throw new Error(`could not add the key page: ${error.message}`);
}

/** Remove one live key page of this client. True when a row moved. */
export async function removeKeyPage(db: SupabaseClient, clientId: string, id: string, p: { by: string; today: Day }): Promise<boolean> {
  const { data, error } = await db.from("key_pages").update({ removed_on: p.today, removed_by: p.by }).eq("client_domain_id", clientId).eq("id", id).is("removed_on", null).select("id");
  if (error) throw new Error(`could not remove the key page: ${error.message}`);
  return Array.isArray(data) && data.length > 0;
}

export async function setKeyPageClusters(db: SupabaseClient, clientId: string, id: string, clusterIds: string[]): Promise<void> {
  const { error } = await db.from("key_pages").update({ cluster_ids: clusterIds }).eq("client_domain_id", clientId).eq("id", id);
  if (error) throw new Error(`could not update the key page's clusters: ${error.message}`);
}

/**
 * The client's own pages the engines cited in the last CITED_DAYS days, most
 * cited first (figures.ts citedPageRows, as Cited pages counts them), as
 * https addresses.
 */
export async function citedOwnPages(db: SupabaseClient, client: { id: string; domain: string }, today: Day): Promise<{ url: string; count: number; prompts: string[] }[]> {
  const from = addDays(today, -(CITED_DAYS - 1));
  const rows = await selectAll<CitationRow & { question_id: string; answered: boolean }>((lo, hi) =>
    db.from("tracking_answers").select("run_date, question_id, engine, answered, citations").eq("client_domain_id", client.id).gte("run_date", from).lte("run_date", today).order("id").range(lo, hi),
  );
  return ownCited(rows, { from, to: today }, client.domain);
}

/** The pure half of citedOwnPages, for the fixture and the tests. */
export function ownCited(rows: (CitationRow & { question_id?: string; answered?: boolean })[], range: { from: Day; to: Day }, domain: string): { url: string; count: number; prompts: string[] }[] {
  return citedPageRows(rows, range, domain)
    .filter((r) => r.yours)
    .sort((a, b) => b.count - a.count)
    .map((r) => ({ url: `https://${r.page}`, count: r.count, prompts: r.prompts.map((x) => x.id) }));
}
