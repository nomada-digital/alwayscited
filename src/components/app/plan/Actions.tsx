import Link from "@/components/app/AppLink";
import ChipRow from "@/components/app/ChipRow";
import { T } from "@/config/tokens";
import { type Arranged, type PlanView, drawnView } from "@/lib/diy/plan/board";
import { type PlanKeep, planPath } from "@/lib/diy/plan/paths";
import { KIND_GROUPS, KIND_GROUP_LABEL, type KindGroup, PLAN_STATUSES, type PlanItem, type PlanStatus, STATUS_LABEL } from "@/lib/diy/plan/types";

import AddTask from "./AddTask";
import Board, { type CardContext } from "./Board";
import List from "./List";
import PlanStyle from "./PlanStyle";
import { LABEL, SECTION, SMALL } from "./styles";

/**
 * The Actions page's body (13 Oct 2026, DIY P3; spec 10 section 4.6):
 * heading, toast, This week pinned at the top, the view switch and the
 * filters, the list or the board, and Add a task. Everything is a link, a
 * plain form or a `<details>`, so it all works with JS off; the filters and
 * the view live in the URL.
 *
 * Simple by default (13 Oct 2026, Danny): with no view stated the page draws
 * the list at every width - This week, then Suggested, In progress (To do and
 * Doing together), Done and Dropped folded away - with Add a task at the top of
 * In progress. The kind, cluster and status chips sit behind one "Filter"
 * disclosure, closed until a filter is on. The four-column board is the
 * option, `view=board`, with Add a task under it as before.
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
  upgrade = null,
}: {
  /** 13 Oct 2026, DIY P9 (spec 10 sections 2.7 and 4.6): the screen's one upgrade slot, U4, drawn by the page; null draws none. */
  upgrade?: React.ReactNode;
  slug: string;
  /** The view the URL states, or null for the default (the list). */
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
  const on = [filters.kind, filters.cluster, filters.status].filter(Boolean).length;
  const used = new Set(items.map((i) => i.clusterId).filter((c): c is string => c !== null));
  const clusterPills = clusters.filter((c) => used.has(c.id) || c.id === filters.cluster);
  const drawn = drawnView(view, filters.status);
  const list = drawn === "list";
  // The dropped the link opens: under the kind and cluster filters the list keeps (review, 13 Oct 2026).
  const droppedCount = arranged ? arranged.dropped.length : 0;
  // Add a task sits at the top of In progress when the list draws that section; anywhere else, under the page as before.
  const progressDrawn = list && arranged !== null && !emptyText && (filters.status === null || filters.status === "todo" || filters.status === "doing");
  const addTask = (compact: boolean) => <AddTask slug={slug} keep={keep} clusters={clusters} canWrite={ctx.canWrite} reason={ctx.reason} compact={compact} />;

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

      {upgrade ? <div data-upgrade-slot="plan" style={{ background: T.surface, border: `1px solid ${T.line}`, borderRadius: "18px", minWidth: 0 }}>{upgrade}</div> : null}

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
              <Link href={href({ view: null, status: "dropped" })} style={{ color: T.accent, fontWeight: 600, textDecoration: "none" }}>{`Dropped (${droppedCount})`}</Link>
            </p>
          ) : null}
        </section>
      ) : (
        <>
          {/* The Filter disclosure on the left, its chips opening full width under it; the view switch on the right of its row. */}
          <div className="plan-tools" style={{ position: "relative", minWidth: 0 }}>
            <details className="plan-filter" open={on > 0} style={{ minWidth: 0 }}>
              <summary style={{ ...PILL(on > 0), cursor: "pointer", listStyle: "none", width: "fit-content", gap: "6px" }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M4 6h16M7 12h10M10 18h4" />
                </svg>
                {on ? `Filter (${on} on)` : "Filter"}
              </summary>
              <div style={{ display: "flex", flexDirection: "column", gap: "10px", paddingTop: "10px", minWidth: 0 }}>
                <span style={LABEL}>Kind</span>
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
                  <>
                    <span style={LABEL}>Cluster</span>
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
                  </>
                ) : null}
                {list ? (
                  <>
                    <span style={LABEL}>Status</span>
                    <ChipRow label="Status" current={filters.status ?? "all"}>
                      <Link href={href({ status: null })} aria-current={filters.status === null ? "true" : undefined} style={PILL(filters.status === null)}>
                        All statuses
                      </Link>
                      {PLAN_STATUSES.map((s) => (
                        <Link key={s} href={href({ status: s })} aria-current={filters.status === s ? "true" : undefined} style={PILL(filters.status === s)}>
                          {STATUS_LABEL[s]}
                        </Link>
                      ))}
                    </ChipRow>
                  </>
                ) : null}
                {on ? (
                  <Link href={href({ kind: null, cluster: null, status: null })} style={{ fontSize: "14px", fontWeight: 600, color: T.accent, textDecoration: "none", width: "fit-content" }}>
                    Clear filters
                  </Link>
                ) : null}
              </div>
            </details>
            <nav aria-label="View" style={{ position: "absolute", top: 0, right: 0, display: "flex", gap: "8px" }}>
              <Link href={href({ view: null })} aria-current={list ? "page" : undefined} style={PILL(list)}>
                List
              </Link>
              <Link href={href({ view: "board", ...(filters.status === "dropped" ? { status: null } : {}) })} aria-current={list ? undefined : "page"} style={PILL(!list)}>
                Board
              </Link>
            </nav>
          </div>

          {notice ? <p style={{ margin: 0, fontSize: "14px", lineHeight: 1.5, color: T.ink }}>{notice}</p> : null}
          {list ? (
            <List arranged={arranged} ctx={ctx} status={filters.status} after={placements} add={progressDrawn ? addTask(true) : null} allDone={href({ view: null, status: "done" }, "#col-done")} />
          ) : (
            <Board arranged={arranged} ctx={ctx} after={placements} />
          )}

          {!list ? (
            <p style={SMALL}>
              <Link href={href({ view: null, status: "dropped" })} style={{ color: T.accent, fontWeight: 600, textDecoration: "none" }}>
                {`Dropped (${droppedCount})`}
              </Link>
            </p>
          ) : null}
        </>
      )}

      {progressDrawn ? null : addTask(false)}
    </div>
  );
}
