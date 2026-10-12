import { type Day, formatDay } from "../../tracking/figures.ts";
import { GRADES } from "../core/evidence.ts";
import { type Candidate, EFFORTS, PLAN_KINDS, type PlanItem, SEVERITIES, type WhyFact, clientPath } from "./types.ts";
import { mondayOf, pickWeek } from "./week.ts";

/**
 * What one `plan_refresh` run writes (13 Oct 2026, DIY P3; spec 10 sections
 * 5.7 and 6.1). Pure: the job reads the candidates and the client's items,
 * asks `planRefresh`, and applies its answer. Run twice on one day it asks
 * for nothing new the second time, because the stale-suggestion count is
 * kept per day (`missed_on`) - the worker's 15-minute stale reclaim can run
 * a job twice (section 8.1).
 *
 * - A new candidate becomes a Suggested item.
 * - A Suggested item's words and facts follow its candidate: the evidence
 *   is fresh each night.
 * - An item the client moved keeps its status and its words.
 * - An item the system dropped as no longer applying comes back as a
 *   suggestion when it applies again. One the client dropped never does.
 * - The week's three are pinned on the first run of the week (Monday's,
 *   unless that run found nothing), and a new Blocking item joins mid-week.
 * - A suggestion no longer gathered on 2 runs is dropped by the system with
 *   "No longer applies (checked 14 Oct)". Only when every source answered:
 *   a source that failed has not said its candidates are gone.
 */

/** Who the system writes as, in created_by and status_by. */
export const SYSTEM = "system";

/** A suggestion not gathered on this many runs no longer applies. */
export const STALE_RUNS = 2;

/** At most this many facts per item; a title at most plan_items.title's 200. */
const WHY_MAX = 3;
const TITLE_MAX = 200;

/** A candidate fit to store, or null with nothing stored: an unknown kind, an empty title, a fact with no words. Hrefs that are not dashboard paths are dropped. */
export function cleanCandidate(c: Candidate): Candidate | null {
  if (!c || typeof c.dedupeKey !== "string" || !c.dedupeKey || c.dedupeKey.length > 200) return null;
  if (!(PLAN_KINDS as readonly string[]).includes(c.kind) || c.kind === "own_task") return null;
  if (!(SEVERITIES as readonly string[]).includes(c.severity)) return null;
  if (!(GRADES as readonly string[]).includes(c.grade) || !(EFFORTS as readonly string[]).includes(c.effort)) return null;
  const title = typeof c.title === "string" ? c.title.replace(/\s+/g, " ").trim().slice(0, TITLE_MAX) : "";
  if (!title) return null;
  const why: WhyFact[] = (Array.isArray(c.why) ? c.why : [])
    .filter((f) => f && typeof f.text === "string" && f.text.trim())
    .slice(0, WHY_MAX)
    .map((f) => {
      const href = clientPath(f.href);
      return href ? { text: f.text.trim(), href } : { text: f.text.trim() };
    });
  if (!why.length) return null;
  return { ...c, title, why, href: clientPath(c.href) ?? "" };
}

/** A new item's row, in column names. */
export function insertRow(clientId: string, c: Candidate, p: { today: Day; weekOf: Day | null; newSinceMonday: boolean }): Record<string, unknown> {
  return {
    client_domain_id: clientId,
    ...contentOf(c),
    status: "suggested",
    dedupe_key: c.dedupeKey,
    week_of: p.weekOf,
    new_since_monday: p.newSinceMonday,
    created_by: SYSTEM,
    status_by: SYSTEM,
    seen_on: p.today,
    missed: 0,
  };
}

/** The columns a candidate decides, refreshed on a suggestion each run. */
export function contentOf(c: Candidate): Record<string, unknown> {
  return {
    cluster_id: c.clusterId,
    kind: c.kind,
    severity: c.severity,
    title: c.title,
    why: c.why,
    grade: c.grade,
    source_id: c.sourceId ?? null,
    effort: c.effort,
    href: c.href || null,
    ref_table: c.ref?.table ?? null,
    ref_id: c.ref?.id ?? null,
  };
}

export type RefreshPlan = {
  inserts: Record<string, unknown>[];
  updates: { id: string; patch: Record<string, unknown> }[];
  /** Dedupe keys pinned to this week by this run. */
  picked: string[];
  added: number;
  dropped: number;
  skipped: number;
};

type Known = Pick<PlanItem, "id" | "dedupeKey" | "status" | "statusBy" | "createdBy" | "hiddenUntil" | "weekOf" | "note" | "missed" | "missedOn">;

/**
 * The run's writes. `complete` is false when any source failed: then no
 * suggestion is counted as gone. `now` is the run's ISO instant.
 */
export function planRefresh(input: { clientId: string; candidates: readonly Candidate[]; complete: boolean; items: readonly Known[]; today: Day; now: string }): RefreshPlan {
  const { clientId, today, now } = input;
  const monday = mondayOf(today);
  const byKey = new Map(input.items.map((i) => [i.dedupeKey, i]));
  const seen = new Map<string, Candidate>();
  let skipped = 0;
  for (const raw of input.candidates) {
    const c = cleanCandidate(raw);
    if (!c) skipped++;
    else if (!seen.has(c.dedupeKey)) seen.set(c.dedupeKey, c);
  }
  const candidates = [...seen.values()];

  // The status each item will have after this run, for the week's pick.
  const after = new Map<string, Pick<PlanItem, "status" | "hiddenUntil">>();
  for (const i of input.items) after.set(i.dedupeKey, { status: i.status, hiddenUntil: i.hiddenUntil });
  const reopen = (i: Known) => i.status === "dropped" && i.statusBy === SYSTEM;
  for (const c of candidates) {
    const i = byKey.get(c.dedupeKey);
    if (i && reopen(i)) after.set(c.dedupeKey, { status: "suggested", hiddenUntil: i.hiddenUntil });
  }

  const weekPicked = input.items.some((i) => i.weekOf === monday);
  const picks = weekPicked ? [] : pickWeek(candidates, after, today);
  const pickedKeys = new Set(picks.map((c) => c.dedupeKey));

  const inserts: Record<string, unknown>[] = [];
  const updates: RefreshPlan["updates"] = [];
  let added = 0;
  for (const c of candidates) {
    const i = byKey.get(c.dedupeKey);
    const pinned = pickedKeys.has(c.dedupeKey);
    // Mid-week, only a Blocking item that is new to the list joins the week.
    const joins = weekPicked && !i && c.severity === "blocking";
    if (!i) {
      inserts.push(insertRow(clientId, c, { today, weekOf: pinned || joins ? monday : null, newSinceMonday: joins }));
      added++;
      continue;
    }
    const patch: Record<string, unknown> = { seen_on: today, missed: 0, missed_on: null };
    if (i.status === "suggested") Object.assign(patch, contentOf(c));
    if (reopen(i)) Object.assign(patch, contentOf(c), { status: "suggested", status_at: now, status_by: SYSTEM });
    if (pinned) patch.week_of = monday;
    updates.push({ id: i.id, patch });
  }

  let dropped = 0;
  if (input.complete) {
    for (const i of input.items) {
      if (i.status !== "suggested" || i.createdBy !== SYSTEM || seen.has(i.dedupeKey) || i.missedOn === today) continue;
      const missed = i.missed + 1;
      const patch: Record<string, unknown> = { missed, missed_on: today };
      if (missed >= STALE_RUNS) {
        Object.assign(patch, { status: "dropped", status_at: now, status_by: SYSTEM });
        if (!i.note) patch.note = staleNote(today);
        dropped++;
      }
      updates.push({ id: i.id, patch });
    }
  }
  return { inserts, updates, picked: picks.map((c) => c.dedupeKey), added, dropped, skipped };
}

/** The note on a suggestion the system dropped. */
export function staleNote(today: Day): string {
  return `No longer applies (checked ${formatDay(today)})`;
}

/** The job's one-line note: what the run did, for diy_jobs.note and the run-health mail. */
export function refreshNote(p: Pick<RefreshPlan, "added" | "dropped" | "picked" | "skipped">, failed: readonly string[]): string {
  const parts = [`${p.added} new`, `${p.dropped} no longer applying`];
  if (p.picked.length) parts.push(`${p.picked.length} pinned for the week`);
  if (p.skipped) parts.push(`${p.skipped} candidates refused`);
  if (failed.length) parts.push(`sources failed: ${failed.join(", ")} (nothing counted as gone)`);
  return parts.join("; ");
}
