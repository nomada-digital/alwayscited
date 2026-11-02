import type { SupabaseClient } from "@supabase/supabase-js";

import { keywordForm } from "../scan/dataforseo-request.ts";
import { insertKeyword, readingsFor } from "./limits.ts";
import { refuseRole, stopDay } from "./stop.ts";
import { MANAGED_TIERS } from "../dash/types.ts";

/**
 * R179 (Danny, 2 Oct 2026, danny.md line 211): "Change keyword" on a pending
 * cluster. Until its first reading a cluster's keyword can be swapped for one
 * that passed the same Check keyword (signed verdict, same refusals); its
 * prompts are kept, and the page offers a redraft. After the first reading the
 * keyword is fixed, as a prompt's text is: the cluster is stopped (with Undo)
 * and a new one added. Owners and editors only. Nothing is deleted.
 */
export const KEYWORD_FIXED = "Its first reading is in, so its keyword is fixed. Stop this cluster and add a new one.";

/** What a read cluster's keyword card says beside its stop. */
export const KEYWORD_FIXED_NOTE = "Its keyword is fixed now it has readings, so its history stays true to what was checked. For a different keyword, stop this cluster and add a new one.";

/** As dash/ops.ts MANAGED_SWAP, for this route's words. */
export const MANAGED_KEYWORD = "We work on this cluster each month, so its keyword changes on request. Ask us from the plan tab.";

export type RekeyCluster = { started_on: string; stopped_on: string | null } | null;

/**
 * Whether this cluster's keyword may change today: null, or the reason it may not.
 *
 * `keywordless` (ON-1, 9 Oct 2026, LB8): the cluster has never had a keyword
 * and none of its prompts has a reading - the "Needs a keyword" cluster a
 * signup with no scan makes. Nothing of it has been read, so its start day is
 * no reason to refuse: from the day after purchase "Use this keyword" was
 * refused as fixed, and the setup card that drafts its prompts from its
 * keyword was a dead end on any day but the first. It may be given its first
 * keyword at any time, checked from the next daily check once the cluster has
 * started (changeKeyword). A keyword it has is fixed as before.
 *
 * Not a scan signup whose scan chose no keyword (review, 9 Oct 2026): its
 * prompts are read from its start, and a keyword set on it renames the
 * cluster across past ranges and labels past CSV rows with it, so it stays
 * under the start-day rule.
 */
export function refuseRekey(p: { role: string; cluster: RekeyCluster; today: string; readings: number; taken: boolean; keywordless?: boolean }): string | null {
  const role = refuseRole(p.role);
  if (role) return role;
  if (!p.cluster) return "That cluster is not on this client.";
  if (p.cluster.stopped_on !== null) return "That cluster is stopped.";
  // A cluster started today or earlier has been, or is being, read: its keyword is part of that history.
  if (!p.keywordless && (p.cluster.started_on <= p.today || p.readings > 0)) return KEYWORD_FIXED;
  if (p.taken) return "You already track this keyword.";
  return null;
}

export type Rekey = { clientId: string; clusterId: string; keyword: string; volume: number; intent: string; today: string; role: string; by: string };

/** The live write: the cluster's keyword row updated in place (or added, for a cluster that has none), and its name with it. */
export async function changeKeyword(db: SupabaseClient, p: Rekey): Promise<{ ok: true } | { ok: false; message: string }> {
  const { data: c, error } = await db.from("tracked_clusters").select("id, keyword_id, tier, started_on, stopped_on").eq("id", p.clusterId).eq("client_domain_id", p.clientId).maybeSingle();
  if (error) return { ok: false, message: `Could not read the cluster: ${error.message}` };
  const keyword = keywordForm(p.keyword);
  const { data: live, error: kErr } = await db.from("tracked_keywords").select("id, keyword").eq("client_domain_id", p.clientId).is("stopped_on", null);
  if (kErr) return { ok: false, message: `Could not read the tracked keywords: ${kErr.message}` };
  const own = (c?.keyword_id as string | null | undefined) ?? null;
  // 2 Nov 2026: a managed cluster's keyword changes on request only (dash/ops.ts MANAGED_SWAP), before its start day too.
  if (own && (MANAGED_TIERS as readonly string[]).includes(String(c?.tier))) return { ok: false, message: MANAGED_KEYWORD };
  const taken = (live ?? []).some((k) => k.id !== own && keywordForm(k.keyword as string) === keyword);
  const readings = own ? await readingsFor(db, "keyword", own) : 0;
  if (typeof readings === "string") return { ok: false, message: readings };
  // ON-1: a cluster that never had a keyword, and whose prompts have no reading, has no history to keep true.
  let keywordless = false;
  if (c && !own) {
    const unread = await clusterUnread(db, p.clientId, p.clusterId);
    if (typeof unread === "string") return { ok: false, message: unread };
    keywordless = unread;
  }
  const refused = refuseRekey({ role: p.role, cluster: c ? { started_on: c.started_on as string, stopped_on: c.stopped_on as string | null } : null, today: p.today, readings, taken, keywordless });
  if (refused) return { ok: false, message: refused };
  if (own && (live ?? []).some((k) => k.id === own)) {
    const { error: uErr } = await db.from("tracked_keywords").update({ keyword, search_volume: p.volume, intent: p.intent }).eq("id", own).eq("client_domain_id", p.clientId);
    if (uErr) return { ok: false, message: `Could not change the keyword: ${uErr.message}` };
  } else {
    // A pending cluster's keyword starts with it; a keywordless one already started (ON-1) is checked from the next daily check.
    const from = (c!.started_on as string) > p.today ? (c!.started_on as string) : stopDay(p.today);
    const k = await insertKeyword(db, p.clientId, p.clusterId, { keyword, added_on: from, added_by: p.by, search_volume: p.volume, intent: p.intent });
    if (!k.ok) return k;
  }
  const { error: nErr } = await db.from("tracked_clusters").update({ name: keyword }).eq("id", p.clusterId).eq("client_domain_id", p.clientId);
  if (nErr) return { ok: false, message: `Keyword changed, but not the cluster's name: ${nErr.message}` };
  return { ok: true };
}

/** Whether none of a cluster's prompts, stopped ones included, has a reading (ON-1 review). Its words on a failed read. */
async function clusterUnread(db: SupabaseClient, clientId: string, clusterId: string): Promise<boolean | string> {
  const { data: qs, error: qErr } = await db.from("tracked_questions").select("id").eq("client_domain_id", clientId).eq("cluster_id", clusterId);
  if (qErr) return `Could not read the cluster's prompts: ${qErr.message}`;
  const ids = (qs ?? []).map((q) => q.id as string);
  if (!ids.length) return true;
  const { count, error } = await db.from("tracking_answers").select("id", { count: "exact", head: true }).eq("client_domain_id", clientId).in("question_id", ids);
  if (error) return `Could not count the cluster's readings: ${error.message}`;
  return (count ?? 0) === 0;
}
