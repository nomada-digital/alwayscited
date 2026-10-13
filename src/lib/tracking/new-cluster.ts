import type { SupabaseClient } from "@supabase/supabase-js";

import { keywordForm } from "../scan/dataforseo-request.ts";

import { refuseDrafts } from "./add-cluster.ts";
import type { Fixture, FixtureQuestion } from "./fixture-mode.ts";
import { ANGLES, PROMPTS_PER_CLUSTER, insertCluster, insertKeyword, insertPrompts, readClusterRefusal } from "./limits.ts";
import { refuseDraftsAt } from "./prompt-text.ts";
import { type FilledAll, fillSlots } from "./slot.ts";
import { refuseRole, stopDay } from "./stop.ts";

/**
 * "Start tracking this cluster" - BRIEF-3 T6 part 3c (30 Sep 2026;
 * boards-3/Questions.dc.html). The keyword has already passed Check keyword
 * (its signed verdict is verified by the route); this writes the keyword, the
 * cluster and its five prompts through limits.ts, each first read at
 * tomorrow's daily check, as the pending cluster the board shows.
 *
 * Every refusal is read before the first write: role, the prompts' text, the
 * keyword not already tracked, and room for a cluster. The three inserts are
 * not one transaction; if a later one fails, the cluster just written is
 * stopped on its start day, so it is never read and nothing is deleted.
 */
export type Added = { ok: true; clusterId: string } | { ok: false; message: string };

/**
 * 13 Oct 2026, DIY P6 (spec 10 sections 3.5 and 6.6): a cluster added from a
 * gaining-ground keyword - Google's Track, or Clusters' Suggested clusters -
 * arrives with `src=gaining`, carried through Check keyword's round trip and
 * posted with the add. Its five prompts are then the client's own (`source`
 * client, as every add here) with `origin_kind` momentum, so their chips say
 * where they came from. Any other `src`, or none, sets no origin: the row is
 * written as it always was. The signed check is unchanged.
 */
export const MOMENTUM_SRC = "gaining";
export function momentumOrigin(src: unknown): "momentum" | null {
  return src === MOMENTUM_SRC ? "momentum" : null;
}

/** The writable fixture's twin: the new cluster's prompts carry the momentum origin on their own rows, where loadPromptOrigins reads it. */
export function tagMomentumFixture(f: Fixture, clusterId: string): Fixture {
  const questions = f.data.questions.map((q) => (q.cluster_id === clusterId ? ({ ...q, source: "client", origin_kind: "momentum" } as FixtureQuestion) : q));
  return { ...f, data: { ...f.data, questions } };
}

export async function addCluster(
  db: SupabaseClient,
  p: { clientId: string; tier: string; keyword: string; volume: number; intent: string; prompts: string[]; today: string; by: string; role: string; origin?: "momentum" | null },
): Promise<Added> {
  const r = refuseRole(p.role) ?? refuseDrafts(p.prompts);
  if (r) return { ok: false, message: r };
  const keyword = keywordForm(p.keyword);
  const { data: kws, error } = await db.from("tracked_keywords").select("keyword").eq("client_domain_id", p.clientId).is("stopped_on", null);
  if (error) return { ok: false, message: `Could not read the keywords: ${error.message}` };
  if ((kws ?? []).some((k) => keywordForm(k.keyword as string) === keyword)) return { ok: false, message: "You already track this keyword." };
  const room = await readClusterRefusal(db, p.clientId);
  if (room) return { ok: false, message: room };

  const day = stopDay(p.today);
  const k = await insertKeyword(db, p.clientId, null, { keyword, added_on: day, added_by: p.by, search_volume: p.volume, intent: p.intent });
  if (!k.ok) return k;
  const c = await insertCluster(db, p.clientId, { name: keyword, tier: p.tier, started_on: day, keyword_id: k.ids[0] });
  if (!c.ok) return { ok: false, message: c.message + (await stopRow(db, "tracked_keywords", k.ids[0], p.clientId, day)) };
  const clusterId = c.ids[0];
  const w = await insertPrompts(db, p.clientId, clusterId, p.prompts.map((text, i) => ({ text: text.trim(), source: "client", added_on: day, added_by: p.by, angle: ANGLES[i], ...(p.origin ? { origin_kind: p.origin } : {}) })));
  if (!w.ok) {
    const undone = (await stopRow(db, "tracked_clusters", clusterId, p.clientId, day)) + (await stopRow(db, "tracked_keywords", k.ids[0], p.clientId, day));
    return { ok: false, message: w.message + undone };
  }
  return { ok: true, clusterId };
}

/** Stop a row just written, on its start day, so it is never read. Says so when that fails too. */
async function stopRow(db: SupabaseClient, table: "tracked_clusters" | "tracked_keywords", id: string, clientId: string, day: string): Promise<string> {
  const { error } = await db.from(table).update({ stopped_on: day }).eq("id", id).eq("client_domain_id", clientId);
  return error ? ` Could not stop ${table} ${id} either: ${error.message}` : "";
}

/**
 * ON-1 (9 Oct 2026, launch blocker LB8): a cluster that has its keyword but
 * no prompt - a signup with no scan, once its keyword is set - gets the five
 * prompts `draftPrompts` drafts from that keyword, as edited on the setup
 * card or the Clusters row. The drafts' rule (refuseDrafts: five, each 8 to
 * ADMIN_LIMITS.question characters, no two the same) is read before anything,
 * then they go through the free slot's write (slot.ts fillSlots), one per
 * angle in ANGLES order, as "Start tracking this cluster" writes them. Each
 * is first read at the next daily check. A cluster that already has live
 * prompts has no room for five more, which insertPrompts' rule refuses.
 */
export async function fillDrafts(db: SupabaseClient, p: { clientId: string; clusterId: string; prompts: string[]; today: string; by: string; role: string }): Promise<FilledAll> {
  const role = refuseRole(p.role);
  if (role) return { ok: false, message: role };
  // ON-1 review (9 Oct 2026): which field a text refusal is about rides back, so the card marks that one.
  const r = refuseDraftsAt(p.prompts, PROMPTS_PER_CLUSTER);
  if (r) return { ok: false, message: r.message, ...(r.at === null ? {} : { at: r.at }) };
  return fillSlots(db, { clientId: p.clientId, clusterId: p.clusterId, slots: p.prompts.map((text, i) => ({ text, angle: ANGLES[i]! })), today: p.today, by: p.by, role: p.role });
}
