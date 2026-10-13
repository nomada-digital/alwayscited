import type { SupabaseClient } from "@supabase/supabase-js";

import type { Day } from "../../tracking/figures.ts";
import { itemOf } from "./data.ts";
import { type RefreshPlan, SYSTEM, cleanCandidate, contentOf, insertRow } from "./refresh.ts";
import type { PlanPatch } from "./transitions.ts";
import { type Candidate, PLAN_COLUMNS, type PlanItem, type Verified } from "./types.ts";

/**
 * Every write to plan_items (13 Oct 2026, DIY P3; spec 10 sections 3.6, 6.1
 * and 6.9). The database is passed in. Each write looks at its own error
 * (writes.test.mts), and every update is held to one client's row.
 *
 * - `upsertPlanItemFor`: one candidate in, idempotent on (client, dedupe
 *   key), for a package that writes an item outside the nightly job.
 * - `markVerified`: what P7's `watch` and P8's `key_pages_weekly` call when
 *   a re-read confirms the work, found by `ref_table`/`ref_id`.
 * - `updatePlanItem` and `insertTask`: the route's writes.
 * - `applyRefresh`: the nightly job's writes, from refresh.ts's plan.
 *
 * No upsert call: a duplicate dedupe key on insert is Postgres's 23505,
 * read as "already there", so nothing here depends on an on-conflict clause.
 */

const DUPLICATE = "23505";

/** One item of this client, or null. A failed read throws. */
export async function getPlanItem(db: SupabaseClient, clientId: string, id: string): Promise<PlanItem | null> {
  const { data, error } = await db.from("plan_items").select(PLAN_COLUMNS).eq("client_domain_id", clientId).eq("id", id).maybeSingle();
  if (error) throw new Error(`could not read the item: ${error.message}`);
  return data ? itemOf(data as Record<string, unknown>) : null;
}

/**
 * Apply one patch to one of this client's items, only while it still has
 * `expect` as its status: two members moving one card at once cannot both
 * win, and the second is told the item has changed. True when a row moved.
 */
export async function updatePlanItem(db: SupabaseClient, clientId: string, id: string, patch: PlanPatch | Record<string, unknown>, expect: PlanItem["status"]): Promise<boolean> {
  const { data, error } = await db.from("plan_items").update(patch).eq("client_domain_id", clientId).eq("id", id).eq("status", expect).select("id");
  if (error) throw new Error(`could not update the item: ${error.message}`);
  return Array.isArray(data) && data.length > 0;
}

/** A member's own task, straight into To do. The dedupe key is its own, so two tasks with one title are two tasks. */
export function taskRow(clientId: string, p: { title: string; clusterId: string | null; by: string; now: string; key: string }): Record<string, unknown> {
  return {
    client_domain_id: clientId,
    cluster_id: p.clusterId,
    kind: "own_task",
    severity: "own",
    status: "todo",
    title: p.title,
    why: [],
    dedupe_key: `task:${p.key}`,
    created_by: p.by,
    status_at: p.now,
    status_by: p.by,
  };
}

export async function insertTask(db: SupabaseClient, clientId: string, p: { title: string; clusterId: string | null; by: string; now: string }): Promise<string> {
  const row = taskRow(clientId, { ...p, key: crypto.randomUUID() });
  const { data, error } = await db.from("plan_items").insert(row).select("id").single();
  if (error) throw new Error(`could not add the task: ${error.message}`);
  return String((data as { id: unknown }).id);
}

/**
 * One candidate as an item, idempotent: a new key is inserted as a
 * suggestion; an existing suggestion takes the candidate's words and facts;
 * an item the client has moved is left as it is. Answers the item's id and
 * whether this call created it, or null for a candidate that may not be
 * stored (refresh.ts cleanCandidate).
 */
export async function upsertPlanItemFor(db: SupabaseClient, clientId: string, candidate: Candidate, p: { today: Day; weekOf?: Day | null; newSinceMonday?: boolean }): Promise<{ id: string; created: boolean } | null> {
  const c = cleanCandidate(candidate);
  if (!c) return null;
  const read = async () => {
    const { data, error } = await db.from("plan_items").select("id, status").eq("client_domain_id", clientId).eq("dedupe_key", c.dedupeKey).maybeSingle();
    if (error) throw new Error(`could not read the item: ${error.message}`);
    return data as { id: unknown; status: string } | null;
  };
  const had = await read();
  if (!had) {
    const { data, error } = await db.from("plan_items").insert(insertRow(clientId, c, { today: p.today, weekOf: p.weekOf ?? null, newSinceMonday: p.newSinceMonday ?? false })).select("id").single();
    if (!error) return { id: String((data as { id: unknown }).id), created: true };
    if (error.code !== DUPLICATE) throw new Error(`could not add the item: ${error.message}`);
    // Another writer got there first: it is there now, so it is updated like any other.
  }
  const now = had ?? (await read());
  if (!now) throw new Error("the item was neither added nor found");
  const patch: Record<string, unknown> = { seen_on: p.today, missed: 0, missed_on: null, ...(now.status === "suggested" ? contentOf(c) : {}) };
  // Pinned to a week, it is new since Monday only when the caller says so: a flag from an earlier week never rides along (review, 13 Oct 2026).
  if (p.weekOf) Object.assign(patch, { week_of: p.weekOf, new_since_monday: p.newSinceMonday ?? false });
  const { error } = await db.from("plan_items").update(patch).eq("client_domain_id", clientId).eq("id", now.id);
  if (error) throw new Error(`could not update the item: ${error.message}`);
  return { id: String(now.id), created: false };
}

/**
 * Write what a re-read verified (section 6.9). `text` is the card's whole
 * line - "Verified: Organization found with name, url, logo, 14 Nov" - so
 * the caller, which knows what it read, words it. Only a done item takes
 * one; true when one did.
 */
export async function markVerified(db: SupabaseClient, itemId: string, v: Verified): Promise<boolean> {
  if (!v.text.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(v.at)) throw new Error("a verification needs its text and its day");
  const { data, error } = await db.from("plan_items").update({ verified: { by: v.by, at: v.at, text: v.text } }).eq("id", itemId).eq("status", "done").select("id");
  if (error) throw new Error(`could not mark the item verified: ${error.message}`);
  return Array.isArray(data) && data.length > 0;
}

/** The items a verifying job is looking for: this client's, by what they refer to. */
export async function itemsByRef(db: SupabaseClient, clientId: string, refTable: string, refId: string): Promise<PlanItem[]> {
  const { data, error } = await db.from("plan_items").select(PLAN_COLUMNS).eq("client_domain_id", clientId).eq("ref_table", refTable).eq("ref_id", refId);
  if (error) throw new Error(`could not read the items: ${error.message}`);
  return ((data ?? []) as Record<string, unknown>[]).map(itemOf).filter((i): i is PlanItem => i !== null);
}

/**
 * The nightly job's writes. Inserts first; a duplicate key is one written
 * since the job read the list, and is left for tomorrow's run. Every failure
 * is counted and the run throws after trying the rest, so the job is marked
 * failed with the count rather than half-written in silence.
 */
export async function applyRefresh(db: SupabaseClient, clientId: string, plan: Pick<RefreshPlan, "inserts" | "updates">): Promise<{ inserted: number; updated: number }> {
  let inserted = 0;
  let updated = 0;
  const failed: string[] = [];
  for (const row of plan.inserts) {
    const { error } = await db.from("plan_items").insert(row);
    if (!error) inserted++;
    else if (error.code !== DUPLICATE) failed.push(error.message);
  }
  for (const u of plan.updates) {
    const { error } = await db.from("plan_items").update(u.patch).eq("client_domain_id", clientId).eq("id", u.id);
    if (!error) updated++;
    else failed.push(error.message);
  }
  if (failed.length) throw new Error(`${failed.length} plan writes failed: ${failed[0]}`);
  return { inserted, updated };
}

// ---- The fixture twin: the same writes, on rows held in memory. ----

/** A patch applied to a fixture row, or null when the row's status is no longer `expect`. */
export function patchRow(row: Record<string, unknown>, patch: Record<string, unknown>, expect: string | null): Record<string, unknown> | null {
  if (expect !== null && row.status !== expect) return null;
  return { ...row, ...patch };
}

/** Who the system is, for the cards' "No longer applies" line. */
export const SYSTEM_BY = SYSTEM;
