import { type Day, addDays } from "../../tracking/figures.ts";
import { type Candidate, type Effort, type PlanItem, SEVERITIES, type Severity } from "./types.ts";

/**
 * The weekly three (13 Oct 2026, DIY P3; spec 10 section 6.1). Pure.
 *
 * Each Monday the Plan pins up to three suggestions as "This week", and they
 * stay pinned until the next Monday: the list does not churn daily (section
 * 1.1 row 20). Only a new Blocking item may join mid-week, flagged
 * `new_since_monday`.
 *
 * The order is an order, not a score, and no number is shown: severity
 * first (Blocking, Slipping, Closest win, Biggest gap, Tidy-up), then search
 * volume (high first), then effort (low first), then the newest evidence.
 * The dedupe key settles anything left, so the pick is the same every run.
 */

/** The Monday a UTC day falls in: the week's boundary is UTC's 00:00 Monday. */
export function mondayOf(day: Day): Day {
  const dow = new Date(`${day}T00:00:00Z`).getUTCDay();
  return addDays(day, -((dow + 6) % 7));
}

const EFFORT_RANK: Record<Effort, number> = { minutes: 0, hour: 1, days: 2 };
/** Where an item with no effort sorts: after every effort. */
const EFFORTS_AFTER = 3;
const SEVERITY_RANK = Object.fromEntries(SEVERITIES.map((s, i) => [s, i])) as Record<Severity, number>;

/** Section 6.1's ordering, as a comparator. */
export function byOrder(a: Pick<Candidate, "severity" | "volume" | "effort" | "evidenceOn" | "dedupeKey">, b: Pick<Candidate, "severity" | "volume" | "effort" | "evidenceOn" | "dedupeKey">): number {
  return (
    SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
    (b.volume ?? 0) - (a.volume ?? 0) ||
    EFFORT_RANK[a.effort] - EFFORT_RANK[b.effort] ||
    (b.evidenceOn ?? "").localeCompare(a.evidenceOn ?? "") ||
    a.dedupeKey.localeCompare(b.dedupeKey)
  );
}

/**
 * The same order for stored suggestions: the board's Suggested column, so
 * the card at the top is the one the weekly pick would take first and its
 * "Why this is first" line holds (review, 13 Oct 2026). A member's own task
 * sorts after every severity; an item with no effort after every effort.
 */
export function byItemOrder(a: Pick<PlanItem, "severity" | "volume" | "effort" | "evidenceOn" | "dedupeKey">, b: Pick<PlanItem, "severity" | "volume" | "effort" | "evidenceOn" | "dedupeKey">): number {
  const sev = (s: PlanItem["severity"]) => (s === "own" ? SEVERITIES.length : SEVERITY_RANK[s]);
  const eff = (e: Effort | null) => (e === null ? EFFORTS_AFTER : EFFORT_RANK[e]);
  return (
    sev(a.severity) - sev(b.severity) ||
    (b.volume ?? 0) - (a.volume ?? 0) ||
    eff(a.effort) - eff(b.effort) ||
    (b.evidenceOn ?? "").localeCompare(a.evidenceOn ?? "") ||
    a.dedupeKey.localeCompare(b.dedupeKey)
  );
}

/**
 * Whether a candidate may be pinned, given the item it already is (if any).
 * Never one the client hid in the last 14 days (`hidden_until` still ahead)
 * or has dropped, and never one already done.
 */
export function pickable(item: Pick<PlanItem, "status" | "hiddenUntil"> | undefined, today: Day): boolean {
  if (!item) return true;
  if (item.status === "dropped" || item.status === "done") return false;
  return item.hiddenUntil === null || item.hiddenUntil <= today;
}

/**
 * Up to three candidates for the week, in order: at most one per severity,
 * never two in one cluster (a candidate with no cluster is in none), and
 * only pickable ones. `items` maps a dedupe key to the item it already is.
 */
export function pickWeek(candidates: readonly Candidate[], items: ReadonlyMap<string, Pick<PlanItem, "status" | "hiddenUntil">>, today: Day): Candidate[] {
  const out: Candidate[] = [];
  const severities = new Set<Severity>();
  const clusters = new Set<string>();
  for (const c of [...candidates].sort(byOrder)) {
    if (out.length === 3) break;
    if (severities.has(c.severity)) continue;
    if (c.clusterId !== null && clusters.has(c.clusterId)) continue;
    if (!pickable(items.get(c.dedupeKey), today)) continue;
    out.push(c);
    severities.add(c.severity);
    if (c.clusterId !== null) clusters.add(c.clusterId);
  }
  return out;
}

/**
 * This week's items, as the page and the Overview draw them: the ones pinned
 * to this Monday, Blocking ones that joined since first, then the week's
 * three in pick order. An item hidden with "Not now" leaves the week.
 */
export function thisWeek<T extends Pick<PlanItem, "weekOf" | "newSinceMonday" | "hiddenUntil" | "status" | "severity" | "dedupeKey">>(items: readonly T[], today: Day): T[] {
  const monday = mondayOf(today);
  const rank = (i: T) => (i.newSinceMonday ? -1 : i.severity === "own" ? SEVERITIES.length : SEVERITY_RANK[i.severity]);
  return items
    .filter((i) => i.weekOf === monday && i.status !== "dropped" && (i.hiddenUntil === null || i.hiddenUntil <= today))
    .sort((a, b) => rank(a) - rank(b) || a.dedupeKey.localeCompare(b.dedupeKey));
}

/** The footer's counts: "1 of 3 done this week · All 12 open items". Open is Suggested (not hidden), To do and Doing. */
export function weekCounts(items: readonly Pick<PlanItem, "weekOf" | "newSinceMonday" | "hiddenUntil" | "status" | "severity" | "dedupeKey">[], today: Day): { done: number; of: number; open: number } {
  const week = thisWeek(items, today);
  const open = items.filter((i) => (i.status === "todo" || i.status === "doing" || (i.status === "suggested" && (i.hiddenUntil === null || i.hiddenUntil <= today)))).length;
  return { done: week.filter((i) => i.status === "done").length, of: week.length, open };
}
