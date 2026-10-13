import type { SupabaseClient } from "@supabase/supabase-js";

import type { Day } from "../../tracking/figures.ts";
import { urlKey } from "../../tracking/placements.ts";
import { ensureOpportunity, pursueOpportunity, type PursueAnswer } from "../opportunities/status.ts";
import type { Route } from "../opportunities/types.ts";

import { bareHost } from "./nomada-placements.ts";
import type { ComparisonSet, LinkCheck, LinkKind, LinkLens } from "./types.ts";

/**
 * Links' writes (13 Oct 2026, DIY P10; spec 10 sections 3.6, 5.8 and 6.3):
 * a night's read into `backlink_reads`, the month's set into
 * `comparison_sets`, a member's check into `link_checks`, and the reveal and
 * Pursue rows into P7's `opportunities` - through P7's exported
 * `ensureOpportunity` and `pursueOpportunity` (spec 7.11: P10 never touches
 * opportunities code; P7 accepts every lens). Each write looks at its own
 * error. Loadable by node --test.
 */

/** A stored payload stays well under the table's backstop (migration: 128 KB). */
export const PAYLOAD_MAX = 120_000;

/** One read into backlink_reads, replacing the same day's of the same kind (a reclaimed job re-runs it). Throws on a failed write. */
export async function writeLinkRead(db: SupabaseClient, clientId: string, p: { kind: LinkKind; readOn: Day; payload: unknown; readId: string | null; total?: number | null }): Promise<void> {
  const size = JSON.stringify(p.payload).length;
  if (size > PAYLOAD_MAX) throw new Error(`the ${p.kind} payload is ${size} characters, over ${PAYLOAD_MAX}`);
  const { error } = await db
    .from("backlink_reads")
    .upsert([{ client_domain_id: clientId, kind: p.kind, read_on: p.readOn, read_id: p.readId, total_count: p.total ?? null, payload: p.payload }], { onConflict: "client_domain_id,kind,read_on" });
  if (error) throw new Error(`could not store the ${p.kind} read: ${error.message}`);
}

/** The month's comparison set, replacing a re-run's. */
export async function writeSet(db: SupabaseClient, clientId: string, set: ComparisonSet): Promise<void> {
  const { error } = await db
    .from("comparison_sets")
    .upsert([{ client_domain_id: clientId, month: set.month, domains: set.domains, basis: { ...set.basis } }], { onConflict: "client_domain_id,month" });
  if (error) throw new Error(`could not store the comparison set: ${error.message}`);
}

/** One check a member made. Throws on a failed write: the member is told it did not save. */
export async function writeCheck(db: SupabaseClient, clientId: string, c: Omit<LinkCheck, "id">, by: string): Promise<string> {
  const { data, error } = await db
    .from("link_checks")
    .insert({ client_domain_id: clientId, url: c.url, url_key: urlKey(c.url) ?? c.url, checked_at: c.checkedAt, via: c.via, status: c.status, http_status: c.http, found: c.found, rel: c.rel, anchor: c.anchor, target: c.target, by_email: by })
    .select("id")
    .single();
  if (error) throw new Error(`could not store the check: ${error.message}`);
  return String((data as { id: unknown }).id);
}

/** What a Links row becomes in opportunities: its lens, address, route and title. */
export type LinkRowInput = { lens: LinkLens; url: string; domain: string; title: string | null; route: Route };

export const routeOf = (lens: LinkLens): Route => (lens === "mention" ? "ask_for_link" : "earn_link");

/** A domain's row address: its homepage, which is what a domain-level row points at. */
export const domainUrl = (domain: string) => `https://${bareHost(domain)}/`;

/**
 * Reveal pages (the targets the plan chose): one `link_page` row each, with
 * `revealed_at` set once - a page already revealed keeps its first time - one
 * millisecond apart so the order they were revealed in is the order shown.
 * Answers how many were newly revealed.
 */
export async function revealPages(db: SupabaseClient, clientId: string, pages: readonly { url: string; domain: string; title: string | null }[], p: { today: Day; now: number }): Promise<number> {
  let n = 0;
  for (const [i, page] of pages.entries()) {
    const made = await ensureOpportunity(db, clientId, { lens: "link_page", url: page.url, domain: bareHost(page.domain), title: page.title, route: "earn_link", today: p.today, now: new Date(p.now).toISOString() });
    if (!made) continue;
    const { data, error } = await db
      .from("opportunities")
      .update({ revealed_at: new Date(p.now + i).toISOString() })
      .eq("client_domain_id", clientId)
      .eq("id", made.id)
      .is("revealed_at", null)
      .select("id");
    if (error) throw new Error(`could not reveal a link target: ${error.message}`);
    if (Array.isArray(data) && data.length) n++;
  }
  return n;
}

/** Pursue a Links row: made in opportunities if it is not there, then pursued by P7's rule (the cap, the move, its Plan item). */
export async function pursueLink(
  db: SupabaseClient,
  client: { id: string; trial: boolean; ended: boolean },
  row: LinkRowInput,
  p: { role: string; by: string; today: Day; now: string },
): Promise<PursueAnswer & { id?: string }> {
  const made = await ensureOpportunity(db, client.id, { lens: row.lens, url: row.url, domain: bareHost(row.domain), title: row.title, route: row.route, today: p.today, now: p.now });
  if (!made) return { ok: false, why: "gone" };
  const answer = await pursueOpportunity(db, client, made.id, p);
  return { ...answer, id: made.id };
}
