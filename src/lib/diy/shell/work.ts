import type { SupabaseClient } from "@supabase/supabase-js";

import type { ChartMark } from "./chart-board.ts";
import { appPath } from "../../app-host.ts";
import type { UpsellMode } from "../../tracking/ask.ts";
import type { Day } from "../../tracking/figures.ts";
import { itemOf } from "../plan/data.ts";
import { planPath } from "../plan/paths.ts";
import { PLAN_COLUMNS, type PlanItem } from "../plan/types.ts";
import { mondayOf } from "../plan/week.ts";
import { type PromptOrigin, originLabel } from "../prompts/origins.ts";

/**
 * What the wave 1 shell (13 Oct 2026, DIY P5; spec 10 section 7.6) wires
 * between the packages, as pure functions: the Actions badge's words and its
 * one narrow read, the work markers the Overview and AI visibility charts take
 * from Actions items and placements (section 4.1 row 8, 4.2 row 3), and the
 * prompts the work log lists with where each came from (section 4.1 row 10).
 *
 * Plain module, relative imports, the database passed in: node --test runs it.
 */

// ------------------------------------------------------------ the Actions badge

/** The nav's one badge (section 3.1): "2 of 3 this week". None when nothing is pinned this week. */
export function badgeWords(c: { done: number; of: number }): string | null {
  return c.of > 0 ? `${c.done} of ${c.of} this week` : null;
}

/** At most this many items are pinned to one Monday: three, plus any Blocking ones new since (section 6.1). */
export const WEEK_READ_MAX = 50;

/**
 * This week's items alone - the rows pinned to this Monday - for the badge on
 * every page, so a page that draws no Actions pays one small read, not the
 * client's whole plan. A failed read throws; the badge then draws nothing.
 */
export async function readWeekItems(db: SupabaseClient, clientId: string, today: Day): Promise<PlanItem[]> {
  const { data, error } = await db.from("plan_items").select(PLAN_COLUMNS).eq("client_domain_id", clientId).eq("week_of", mondayOf(today)).limit(WEEK_READ_MAX);
  if (error) throw new Error(`could not read this week's actions: ${error.message}`);
  return ((data ?? []) as Record<string, unknown>[]).map(itemOf).filter((i): i is PlanItem => i !== null);
}

// ------------------------------------------------------------ work markers

/** A chart marker with the cluster it is about, so a cluster's chart draws its own work only. */
export type WorkMark = ChartMark & { cluster: string | null };

type PlacementLike = { url_key: string; status: string; live_on: Day | null; cluster_id: string };

/**
 * The work on the charts (section 4.1 row 8): an Actions item started and
 * done, and a placement gone live. A started or done marker opens Actions on
 * that item's cluster (`/plan?view=list&cluster=`); a placement opens
 * Placements. A dropped item marks nothing. `kinds` picks which: AI
 * visibility's chart takes done items and placements only (section 4.2 row 3),
 * beside the prompt markers it draws itself.
 */
export function workMarks(input: {
  slug: string;
  items: readonly Pick<PlanItem, "title" | "status" | "clusterId" | "startedOn" | "doneOn">[];
  placements: readonly PlacementLike[];
  kinds?: readonly ("started" | "done" | "placement")[];
}): WorkMark[] {
  const kinds = new Set(input.kinds ?? ["started", "done", "placement"]);
  const out: WorkMark[] = [];
  for (const i of input.items) {
    if (i.status === "dropped") continue;
    const href = planPath(input.slug, i.clusterId ? { view: "list", cluster: i.clusterId } : { view: "list" });
    if (kinds.has("started") && i.startedOn) out.push({ date: i.startedOn, kind: "started", label: i.title, href, cluster: i.clusterId });
    if (kinds.has("done") && i.status === "done" && i.doneOn) out.push({ date: i.doneOn, kind: "done", label: i.title, href, cluster: i.clusterId });
  }
  if (kinds.has("placement")) {
    const href = appPath(`/${encodeURIComponent(input.slug)}/placements`);
    for (const p of input.placements) if (p.status === "live" && p.live_on) out.push({ date: p.live_on, kind: "placement", label: p.url_key, href, cluster: p.cluster_id });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind) || a.label.localeCompare(b.label));
}

/** The marks one chart draws: a cluster's own, or every one when the chart is the whole client's. Without the cluster field, which no chart reads. */
export function marksFor(marks: readonly WorkMark[], cluster: string | null): ChartMark[] {
  return marks.filter((m) => cluster === null || m.cluster === cluster).map((m) => ({ date: m.date, kind: m.kind, label: m.label, ...(m.href ? { href: m.href } : {}) }));
}

// ------------------------------------------------------------ the work log's prompts

/**
 * Prompts added after the client's first day, each with the words of where it
 * came from (P2's originLabel: in agency mode Nomada is "Your account
 * contact"). The prompts a client started with are setup, not work, so they
 * are left out, as is a prompt whose origin was not read: the log names an
 * origin or says nothing.
 */
export function promptsAdded(input: {
  questions: readonly { id: string; text: string; added_on: Day }[];
  origins: ReadonlyMap<string, PromptOrigin>;
  mode: UpsellMode;
  startedOn: Day | null;
}): { day: Day; text: string; origin: string }[] {
  const out: { day: Day; text: string; origin: string }[] = [];
  for (const q of input.questions) {
    const o = input.origins.get(q.id);
    if (!o || o.kind === "setup") continue;
    if (input.startedOn !== null && q.added_on <= input.startedOn) continue;
    out.push({ day: q.added_on, text: q.text, origin: originLabel(o, input.mode) });
  }
  return out;
}
