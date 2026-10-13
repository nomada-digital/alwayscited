import type { SupabaseClient } from "@supabase/supabase-js";

import { type Day } from "../../tracking/figures.ts";
import { PROMPTS_PER_CLUSTER, freeAngle, insertPrompts, missingColumn, readPromptRoom, readingsFor } from "../../tracking/limits.ts";
import { stop, stopDay, undoStop } from "../../tracking/stop.ts";
import { duplicateOf } from "../prompts/dedupe.ts";
import { promptForOpportunity } from "../prompts/opportunity-rule.ts";

import type { Opportunity, PageFacts } from "./types.ts";

/**
 * The prompt step of a pursuit (13 Oct 2026, DIY P7, on P2's rules; spec 10
 * section 6.7, "Opportunity prompts"; Danny's 12 Oct call: for DIY clients,
 * prompts come "from the opportunities they pursue").
 *
 * 1. The prompt is the opportunity rule's (P2 `promptForOpportunity`): the
 *    title rule for lists, comparisons and articles, a thread's own request,
 *    "best <keyword>" for a profile. Link lenses get none: watched, not asked.
 * 2. A duplicate of a live prompt in the cluster (P2 `duplicateOf`, 75% of
 *    core words) adds nothing: the opportunity links that prompt.
 * 3. A free angle slot takes it at once - source `client`, origin
 *    `opportunity`, origin_ref the opportunity, the first free angle
 *    (limits.ts `freeAngle`), first asked tomorrow - through limits.ts
 *    `insertPrompts`, the one writer. Undo stops it through the existing stop
 *    path while it is pending (before its first reading).
 * 4. A full cluster sends the member to the swap picker (`?swap=1`): Swap
 *    stops the chosen prompt from tomorrow and inserts the new one into its
 *    angle; "Just watch the page" adds nothing. Placement prompts are never
 *    offered or stopped here: they are not in an angle slot.
 *
 * Whatever the member chose, the page is watched (watch.job.ts).
 *
 * The reads and writes go through a `PromptPort`: Supabase's (`dbPromptPort`,
 * limits.ts and stop.ts as they are), or the fixture's (the route's twin on
 * the tracking fixture's own write twins). The logic here runs the same on
 * both, and on the tests' fake port.
 */

export type LivePrompt = { id: string; text: string; angle: string | null; added_on: Day; placement: boolean };

export type PromptPort = {
  /** The cluster's live prompts, placement prompts flagged. */
  live(clusterId: string): Promise<LivePrompt[]>;
  /** The angle-slot room in the cluster (limits.ts readPromptRoom). */
  room(clusterId: string): Promise<number>;
  insert(clusterId: string, row: { text: string; angle: string | null; originRef: string; addedOn: Day; by: string }): Promise<{ ok: true; id: string } | { ok: false; message: string }>;
  stop(id: string): Promise<{ ok: true } | { ok: false; message: string }>;
  undoStop(id: string): Promise<{ ok: true } | { ok: false; message: string }>;
  /** Readings the prompt has had; a prompt with none is pending. */
  readings(id: string): Promise<number>;
  /** Point the opportunity at its prompt (or at none). */
  link(opportunityId: string, promptId: string | null): Promise<void>;
};

export type StepResult =
  | { kind: "added"; promptId: string; text: string; slot: number; of: number }
  | { kind: "duplicate"; promptId: string; text: string }
  | { kind: "full"; text: string }
  | { kind: "none"; reason: string }
  | { kind: "refused"; message: string };

export const NO_CLUSTER = "its page has no cluster yet";

/** The prompt this opportunity offers, or why none. Pure. */
export function offeredPrompt(opp: Pick<Opportunity, "lens" | "pageType" | "title">, facts: Pick<PageFacts, "title" | "h1"> | null, keyword: string | null, market: string): { ok: true; text: string } | { ok: false; reason: string } {
  return promptForOpportunity({ lens: opp.lens, page_type: opp.pageType, keyword }, { title: facts?.title ?? opp.title, h1: facts?.h1 ?? null }, market);
}

/** Run the step for a pursued opportunity. Never throws for a rule's answer; a port that fails throws. */
export async function runPromptStep(port: PromptPort, p: { opp: Pick<Opportunity, "id" | "lens" | "pageType" | "title" | "clusterId">; facts: Pick<PageFacts, "title" | "h1"> | null; keyword: string | null; market: string; today: Day; by: string }): Promise<StepResult> {
  if (!p.opp.clusterId) return { kind: "none", reason: NO_CLUSTER };
  const offered = offeredPrompt(p.opp, p.facts, p.keyword, p.market);
  if (!offered.ok) return { kind: "none", reason: offered.reason };
  const live = await port.live(p.opp.clusterId);
  const dup = duplicateOf(offered.text, live);
  if (dup) {
    await port.link(p.opp.id, dup.id);
    return { kind: "duplicate", promptId: dup.id, text: dup.text };
  }
  const slots = live.filter((q) => !q.placement);
  if ((await port.room(p.opp.clusterId)) < 1) return { kind: "full", text: offered.text };
  const angle = freeAngle(slots.map((q) => q.angle));
  const made = await port.insert(p.opp.clusterId, { text: offered.text, angle, originRef: p.opp.id, addedOn: stopDay(p.today), by: p.by });
  if (!made.ok) return { kind: "refused", message: made.message };
  await port.link(p.opp.id, made.id);
  return { kind: "added", promptId: made.id, text: offered.text, slot: slots.length + 1, of: PROMPTS_PER_CLUSTER };
}

/**
 * Undo an added prompt while it is pending: only the prompt this opportunity
 * added (never one it links as a duplicate), only before its first reading,
 * through the stop path. The opportunity stays pursued and watched.
 */
export async function undoPromptStep(port: PromptPort, p: { opportunityId: string; prompt: { id: string; origin_ref: string | null; added_on: Day; stopped_on: Day | null } | null; today: Day }): Promise<{ ok: true } | { ok: false; message: string }> {
  const q = p.prompt;
  if (!q || q.origin_ref !== p.opportunityId) return { ok: false, message: "That prompt wasn't added from this page." };
  if (q.stopped_on !== null) return { ok: false, message: "It is already stopped." };
  if (q.added_on <= p.today || (await port.readings(q.id)) > 0) return { ok: false, message: "It has had its first reading, so it stays. Stop it from Clusters if you want." };
  const s = await port.stop(q.id);
  if (!s.ok) return s;
  await port.link(p.opportunityId, null);
  return { ok: true };
}

/**
 * Swap: stop the chosen prompt from tomorrow and put the new one in its
 * angle. The chosen one must be a live angle prompt of the same cluster. An
 * insert refused after the stop takes the stop back, so a failed swap leaves
 * the cluster as it was.
 */
export async function swapPromptStep(port: PromptPort, p: { opp: Pick<Opportunity, "id" | "lens" | "pageType" | "title" | "clusterId">; facts: Pick<PageFacts, "title" | "h1"> | null; keyword: string | null; market: string; stopId: string; today: Day; by: string }): Promise<StepResult> {
  if (!p.opp.clusterId) return { kind: "none", reason: NO_CLUSTER };
  const offered = offeredPrompt(p.opp, p.facts, p.keyword, p.market);
  if (!offered.ok) return { kind: "none", reason: offered.reason };
  const live = await port.live(p.opp.clusterId);
  const chosen = live.find((q) => q.id === p.stopId && !q.placement);
  if (!chosen) return { kind: "refused", message: "Pick one of this cluster's prompts to swap." };
  const dup = duplicateOf(offered.text, live.filter((q) => q.id !== chosen.id));
  if (dup) {
    await port.link(p.opp.id, dup.id);
    return { kind: "duplicate", promptId: dup.id, text: dup.text };
  }
  const stopped = await port.stop(chosen.id);
  if (!stopped.ok) return { kind: "refused", message: stopped.message };
  const made = await port.insert(p.opp.clusterId, { text: offered.text, angle: chosen.angle, originRef: p.opp.id, addedOn: stopDay(p.today), by: p.by });
  if (!made.ok) {
    const back = await port.undoStop(chosen.id);
    if (!back.ok) console.warn(`[diy] prompt swap: the insert failed and the stop could not be taken back: ${back.message}`);
    return { kind: "refused", message: made.message };
  }
  await port.link(p.opp.id, made.id);
  return { kind: "added", promptId: made.id, text: offered.text, slot: live.filter((q) => !q.placement).length, of: PROMPTS_PER_CLUSTER };
}

/** The prompt step's line on the detail page (section 4.7, "Prompt step"). */
export function stepLine(r: StepResult, clusterName: string): string {
  switch (r.kind) {
    case "added":
      return `Added '${r.text}' to '${clusterName}' (slot ${r.slot} of ${r.of}).`;
    case "duplicate":
      return `Already measured by '${r.text}'.`;
    case "full":
      return `'${clusterName}' has no free prompt slot. Swap one, or just watch the page.`;
    case "none":
      return `No prompt from this page: ${r.reason}. It is watched for citations.`;
    case "refused":
      return r.message;
  }
}

// ---- Supabase's port: limits.ts and stop.ts as they are. ----

type PromptRow = { id: string; text: string; angle: string | null; added_on: string; allowance?: string | null };

export function dbPromptPort(db: SupabaseClient, p: { clientId: string; today: Day; by: string; role: string }): PromptPort {
  return {
    async live(clusterId) {
      const read = (cols: string) => db.from("tracked_questions").select(cols).eq("client_domain_id", p.clientId).eq("cluster_id", clusterId).is("stopped_on", null).order("added_on", { ascending: true });
      let { data, error } = await read("id, text, angle, added_on, allowance");
      // Before 20261013010000 there is no allowance column, so no prompt is a placement prompt (limits.ts).
      if (error && missingColumn(error)) ({ data, error } = await read("id, text, angle, added_on"));
      if (error) throw new Error(`could not read the cluster's prompts: ${error.message}`);
      return ((data ?? []) as unknown as PromptRow[]).map((r) => ({ id: r.id, text: r.text, angle: r.angle, added_on: r.added_on, placement: r.allowance === "placement" }));
    },
    async room(clusterId) {
      const r = await readPromptRoom(db, p.clientId, clusterId);
      if (typeof r === "string") throw new Error(r);
      return r.room;
    },
    async insert(clusterId, row) {
      const w = await insertPrompts(db, p.clientId, clusterId, [{ text: row.text, source: "client", added_on: row.addedOn, added_by: row.by, angle: row.angle, origin_kind: "opportunity", origin_ref: row.originRef }]);
      return w.ok ? { ok: true, id: w.ids[0]! } : { ok: false, message: w.message };
    },
    async stop(id) {
      const s = await stop(db, { kind: "prompt", clientId: p.clientId, id, today: p.today, by: p.by, role: p.role });
      return s.ok ? { ok: true } : { ok: false, message: s.message };
    },
    async undoStop(id) {
      const s = await undoStop(db, { kind: "prompt", clientId: p.clientId, id, today: p.today, role: p.role });
      return s.ok ? { ok: true } : { ok: false, message: s.message };
    },
    async readings(id) {
      const n = await readingsFor(db, "prompt", id);
      if (typeof n === "string") throw new Error(n);
      return n;
    },
    async link(opportunityId, promptId) {
      const { error } = await db.from("opportunities").update({ prompt_id: promptId }).eq("client_domain_id", p.clientId).eq("id", opportunityId);
      if (error) throw new Error(`could not link the prompt: ${error.message}`);
    },
  };
}

/** One prompt of this client, for Undo: whether it came from this opportunity and is still pending. A failed read throws. */
export async function readPromptForUndo(db: SupabaseClient, clientId: string, id: string): Promise<{ id: string; origin_ref: string | null; added_on: Day; stopped_on: Day | null } | null> {
  const { data, error } = await db.from("tracked_questions").select("id, origin_ref, added_on, stopped_on").eq("client_domain_id", clientId).eq("id", id).maybeSingle();
  if (error) throw new Error(`could not read the prompt: ${error.message}`);
  return (data as { id: string; origin_ref: string | null; added_on: Day; stopped_on: Day | null } | null) ?? null;
}
