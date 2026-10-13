import type { Day } from "../../tracking/figures.ts";
import { isHidden } from "./transitions.ts";
import { KIND_GROUP, KIND_GROUPS, type KindGroup, PLAN_STATUSES, type PlanItem, type PlanStatus } from "./types.ts";
import { byItemOrder } from "./week.ts";

/**
 * How the Actions page arranges the items (13 Oct 2026, DIY P3; spec 10
 * section 4.6). Pure. The page reads its query keys through the pickers
 * here, each a whitelist, and draws what `arrange` answers.
 */

export const VIEWS = ["board", "list"] as const;
export type PlanView = (typeof VIEWS)[number];

/** `?view=`: board or list, else none stated (the board above 640px, the list below it). */
export function pickView(v: string | null): PlanView | null {
  return v === "board" || v === "list" ? v : null;
}

/** `?status=`: one of the statuses, else every status. */
export function pickStatus(v: string | null): PlanStatus | null {
  return v !== null && (PLAN_STATUSES as readonly string[]).includes(v) ? (v as PlanStatus) : null;
}

/** `?kind=`: one of the four groups, else every kind. */
export function pickGroup(v: string | null): KindGroup | null {
  return v !== null && (KIND_GROUPS as readonly string[]).includes(v) ? (v as KindGroup) : null;
}

/** `?cluster=`: one of this client's cluster ids, else every cluster. */
export function pickCluster(v: string | null, clusterIds: readonly string[]): string | null {
  return v !== null && clusterIds.includes(v) ? v : null;
}

/**
 * Within a column: Suggested in section 6.1's order - severity, then volume,
 * then effort, then the newest evidence, as the weekly pick takes them
 * (week.ts byItemOrder); the rest newest change first; Done newest done first.
 */
function order(status: PlanStatus) {
  return (a: PlanItem, b: PlanItem) => {
    if (status === "done") return (b.doneOn ?? "").localeCompare(a.doneOn ?? "") || b.statusAt.localeCompare(a.statusAt);
    if (status === "suggested") return byItemOrder(a, b) || a.id.localeCompare(b.id);
    return b.statusAt.localeCompare(a.statusAt) || a.id.localeCompare(b.id);
  };
}

export type Filters = { kind: KindGroup | null; cluster: string | null; status: PlanStatus | null };

/** The items a filter keeps. */
export function filterItems(items: readonly PlanItem[], f: Filters): PlanItem[] {
  return items.filter((i) => (!f.kind || KIND_GROUP[i.kind] === f.kind) && (!f.cluster || i.clusterId === f.cluster) && (!f.status || i.status === f.status));
}

export type Arranged = {
  /** The columns, in board order, each with its items in order. Dropped is not a column. */
  columns: { status: Exclude<PlanStatus, "dropped">; items: PlanItem[] }[];
  /** Suggestions hidden by "Not now" today, left out of Suggested. */
  hidden: number;
  /** Dropped items: a count and a link, or the list when `?status=dropped`. */
  dropped: PlanItem[];
  /** True when the client has no item at all, before any filter. */
  none: boolean;
  /** True when nothing is open (Suggested, To do or Doing), before any filter. */
  nothingOpen: boolean;
};

/** The board's columns for the filters, with Suggested's hidden items counted apart. */
export function arrange(all: readonly PlanItem[], f: Filters, today: Day): Arranged {
  const kept = filterItems(all, { ...f, status: null });
  const col = (status: Exclude<PlanStatus, "dropped">) => kept.filter((i) => i.status === status && !(status === "suggested" && isHidden(i, today))).sort(order(status));
  const statuses = f.status && f.status !== "dropped" ? [f.status] : f.status === "dropped" ? [] : (["suggested", "todo", "doing", "done"] as const);
  return {
    columns: statuses.map((status) => ({ status, items: col(status) })),
    hidden: kept.filter((i) => i.status === "suggested" && isHidden(i, today)).length,
    dropped: kept.filter((i) => i.status === "dropped").sort(order("dropped")),
    none: all.length === 0,
    nothingOpen: !all.some((i) => i.status === "todo" || i.status === "doing" || (i.status === "suggested" && !isHidden(i, today))),
  };
}
