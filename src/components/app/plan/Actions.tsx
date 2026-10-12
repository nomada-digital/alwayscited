import Link from "@/components/app/AppLink";
import ChipRow from "@/components/app/ChipRow";
import { T } from "@/config/tokens";
import type { Arranged, PlanView } from "@/lib/diy/plan/board";
import { type PlanKeep, planPath } from "@/lib/diy/plan/paths";
import { KIND_GROUPS, KIND_GROUP_LABEL, type KindGroup, PLAN_STATUSES, type PlanItem, type PlanStatus, STATUS_LABEL } from "@/lib/diy/plan/types";

import AddTask from "./AddTask";
import Board, { type CardContext } from "./Board";
import List from "./List";
import PlanStyle from "./PlanStyle";
import { SECTION, SMALL } from "./styles";

/**
 * The Actions page's body (13 Oct 2026, DIY P3; spec 10 section 4.6):
 * heading, toast, This week pinned at the top, the view switch and filters,
 * the board or the list, Dropped, and Add a task. Everything is a link or a
 * plain form, so it all works with JS off; the filters and the view live in
 * the URL.
 *
 * With no view stated the page draws the board, which stacks into the list
 * below 640px, and the Placements group shows only there (`plan-only-sm`):
 * the list is the phone's default (spec: "?view=list is the default under
 * 640 px") without drawing the items twice.
 */


const PILL = (on: boolean) =>
  ({ display: "inline-flex", alignItems: "center", minHeight: "36px", padding: "0 14px", borderRadius: "999px", border: `1px solid ${on ? T.washLine : T.line}`, background: on ? T.wash : T.surface, color: T.ink, fontSize: "13px", fontWeight: 600, textDecoration: "none", whiteSpace: "nowrap" }) as const;

export const SECTION_ERROR = "We couldn't read this part just now. The rest of the page is up to date.";

export default function Actions({
  slug,
  view,
  keep,
  filters,
  arranged,
  items,
  ctx,
  toast,
  week,
  clusters,
  placements,
  emptyText,
  notice,
  readOnly,
}: {
  slug: string;
  /** The view the URL states, or null for the default. */
  view: PlanView | null;
  keep: PlanKeep;
  filters: { kind: KindGroup | null; cluster: string | null; status: PlanStatus | null };
  /** Null when the items could not be read. */
  arranged: Arranged | null;
  items: readonly PlanItem[];
  ctx: CardContext;
  toast: string | null;
  /** This week, drawn by the page. */
  week: React.ReactNode;
  clusters: readonly { id: string; name: string }[];
  /** The placed tiers' Placements group, or null. */
  placements: React.ReactNode;
  /** Day 0 in words, drawn instead of the board when there is no item at all; else null. */
  emptyText: string | null;
  /** A line above the board: nothing open, while Done and Dropped still show. */
  notice: string | null;
  /** The read-only reason, drawn once under the heading, or null. */
  readOnly: string | null;
}) {
  const href = (over: Partial<Record<keyof PlanKeep, string | null>>, hash = "") => {
    const q: PlanKeep = { ...keep };
    for (const [k, v] of Object.entries(over) as [keyof PlanKeep, string | null][]) {
      if (v === null) delete q[k];
      else q[k] = v;
    }
    return planPath(slug, q, hash);
  };
  const filtered = Boolean(filters.kind || filters.cluster || filters.status);
  const used = new Set(items.map((i) => i.clusterId).filter((c): c is string => c !== null));
  const clusterPills = clusters.filter((c) => used.has(c.id) || c.id === filters.cluster);
  const list = view === "list" || filters.status === "dropped";
  const droppedCount = items.filter((i) => i.status === "dropped").length;

  return (
    <div className="app-col" style={{ display: "flex", flexDirection: "column", gap: "20px", minWidth: 0 }}>
      <PlanStyle />
      <header style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
        <h1 style={{ margin: 0, fontSize: "28px", fontWeight: 700, letterSpacing: "-0.03em", color: T.ink }}>Actions</h1>
        <p style={{ margin: 0, fontSize: "14px", lineHeight: 1.5, color: T.soft, maxWidth: "680px" }}>What to do next, why, and what was read after you did it.</p>
      </header>
      {toast ? (
        <p role="status" style={{ margin: 0, padding: "12px 16px", borderRadius: "14px", background: T.ink, color: T.surface, fontSize: "14px", lineHeight: 1.4, alignSelf: "flex-start", maxWidth: "100%", boxSizing: "border-box", overflowWrap: "anywhere" }}>
          {toast}
        </p>
      ) : null}
      {readOnly ? <p style={{ margin: 0, padding: "12px 16px", borderRadius: "12px", background: T.wash, border: `1px solid ${T.washLine}`, fontSize: "14px", color: T.ink }}>{readOnly}</p> : null}

      {week}

      {arranged === null ? (
        <section aria-label="Your actions" style={SECTION}>
          <p role="status" style={{ margin: 0, fontSize: "14px", color: T.ink }}>
            {SECTION_ERROR}
          </p>
        </section>
      ) : emptyText ? (
        <section aria-label="Your actions" style={SECTION}>
          <p style={{ margin: 0, fontSize: "14px", lineHeight: 1.5, color: T.ink }}>{emptyText}</p>
          {droppedCount ? (
            <p style={SMALL}>
              <Link href={href({ view: "list", status: "dropped" })} style={{ color: T.accent, fontWeight: 600, textDecoration: "none" }}>{`Dropped (${droppedCount})`}</Link>
            </p>
          ) : null}
        </section>
      ) : (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: "10px", minWidth: 0 }}>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 16px" }}>
              <nav aria-label="View" style={{ display: "flex", gap: "8px" }}>
                <Link href={href({ view: "board" })} aria-current={view === "board" ? "page" : undefined} style={PILL(view === "board")}>
                  Board
                </Link>
                <Link href={href({ view: "list" })} aria-current={view === "list" ? "page" : undefined} style={PILL(view === "list")}>
                  List
                </Link>
              </nav>
              {filtered ? (
                <Link href={href({ kind: null, cluster: null, status: null })} style={{ fontSize: "14px", fontWeight: 600, color: T.accent, textDecoration: "none" }}>
                  Clear filters
                </Link>
              ) : null}
            </div>
            <ChipRow label="Kind" current={filters.kind ?? "all"}>
              <Link href={href({ kind: null })} aria-current={filters.kind === null ? "true" : undefined} style={PILL(filters.kind === null)}>
                All kinds
              </Link>
              {KIND_GROUPS.map((g) => (
                <Link key={g} href={href({ kind: g })} aria-current={filters.kind === g ? "true" : undefined} style={PILL(filters.kind === g)}>
                  {KIND_GROUP_LABEL[g]}
                </Link>
              ))}
            </ChipRow>
            {clusterPills.length ? (
              <ChipRow label="Cluster" current={filters.cluster ?? "all"}>
                <Link href={href({ cluster: null })} aria-current={filters.cluster === null ? "true" : undefined} style={PILL(filters.cluster === null)}>
                  All clusters
                </Link>
                {clusterPills.map((c) => (
                  <Link key={c.id} href={href({ cluster: c.id })} aria-current={filters.cluster === c.id ? "true" : undefined} style={PILL(filters.cluster === c.id)}>
                    {c.name}
                  </Link>
                ))}
              </ChipRow>
            ) : null}
            {list ? (
              <ChipRow label="Status" current={filters.status ?? "all"}>
                <Link href={href({ status: null })} aria-current={filters.status === null ? "true" : undefined} style={PILL(filters.status === null)}>
                  All statuses
                </Link>
                {PLAN_STATUSES.map((s) => (
                  <Link key={s} href={href({ status: s, view: "list" })} aria-current={filters.status === s ? "true" : undefined} style={PILL(filters.status === s)}>
                    {STATUS_LABEL[s]}
                  </Link>
                ))}
              </ChipRow>
            ) : null}
          </div>

          {notice ? <p style={{ margin: 0, fontSize: "14px", lineHeight: 1.5, color: T.ink }}>{notice}</p> : null}
          {list ? <List arranged={arranged} ctx={ctx} dropped={filters.status === "dropped"} after={placements} /> : <Board arranged={arranged} ctx={ctx} after={placements} />}

          {filters.status !== "dropped" ? (
            <p style={SMALL}>
              <Link href={href({ view: "list", status: "dropped" })} style={{ color: T.accent, fontWeight: 600, textDecoration: "none" }}>
                {`Dropped (${droppedCount})`}
              </Link>
            </p>
          ) : null}
        </>
      )}

      <AddTask slug={slug} keep={keep} clusters={clusters} canWrite={ctx.canWrite} reason={ctx.reason} />
    </div>
  );
}
