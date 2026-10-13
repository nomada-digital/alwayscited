import { type Day, addDays } from "../../tracking/figures.ts";
import { STALLED_DAYS, STALLED_MIN } from "../../tracking/upgrade-prompts.ts";
import { KIND_GROUP, type PlanItem } from "../plan/types.ts";

/**
 * U4's gatherer (13 Oct 2026, DIY P9; spec 10 sections 2.7 and 4.6): the
 * opportunity items in Doing whose status has not changed for STALLED_DAYS
 * (21) days or more. P4 wrote the trigger and the copy (upgrade-prompts.ts
 * triggeredRows, rowCopy); this reads the fact from the Actions items the
 * page already holds, and nothing else.
 *
 * `since` is the latest day any of them reached Doing, so "in Doing since 3
 * Oct with no change" is true of every one. `ids` are the opportunities they
 * are about (`ref_table = 'opportunities'`), for "Ask about these 3", which
 * the ask route reads as this client's opportunity rows (kind=opportunity)
 * and lists by address - never a title typed into a form.
 */
export type Stalled = { items: number; since: Day; ids: string[] };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function stalledOpportunities(items: readonly Pick<PlanItem, "kind" | "status" | "statusAt" | "refTable" | "refId">[], today: Day): Stalled | null {
  const line = addDays(today, -STALLED_DAYS);
  const stalled = items.filter((i) => i.status === "doing" && KIND_GROUP[i.kind] === "opportunities" && i.statusAt.slice(0, 10) <= line);
  if (stalled.length < STALLED_MIN) return null;
  const since = stalled.map((i) => i.statusAt.slice(0, 10)).sort().at(-1)!;
  const ids = [...new Set(stalled.filter((i) => i.refTable === "opportunities" && i.refId && UUID.test(i.refId)).map((i) => i.refId!))];
  return { items: stalled.length, since, ids };
}
