import type { ReactNode } from "react";

import Link from "@/components/app/AppLink";
import { T } from "@/config/tokens";
import { type Arranged, listSections } from "@/lib/diy/plan/board";
import { type PlacementGroupRow } from "@/lib/diy/plan/placements";
import type { PlanStatus } from "@/lib/diy/plan/types";

import { Cards, type CardContext, EMPTY, hiddenNote } from "./Board";
import { H2, LINK, SECTION, SMALL } from "./styles";

/**
 * The list (13 Oct 2026, DIY P3; spec 10 section 4.6), the page's default at
 * every width since Danny's call the same day: most clients only need "do
 * these three", what is in progress and what is done. Under This week, one
 * section after another:
 *
 * - **Suggested**: what the checks found, best first (section 6.1's order);
 * - **In progress**: To do and Doing together, Doing first, each card saying
 *   its state in words, with Add a task at the top (`add`);
 * - **Done**: the most recent, with their readouts, and "All n done";
 * - **Dropped**: folded away in a `<details>`, open when `?status=dropped`
 *   asks for it - a disclosure works with JS off.
 *
 * A status filter draws its own section only. On placed tiers it ends with
 * the read-only Placements group (`after`).
 */
const COUNT = { fontSize: "13px", fontWeight: 600, color: T.soft } as const;
const HEAD = { ...H2, display: "flex", alignItems: "baseline", gap: "8px", scrollMarginTop: "16px" } as const;
const GROUP = { display: "flex", flexDirection: "column", gap: "10px", minWidth: 0 } as const;

export default function List({ arranged, ctx, status, after, add, allDone }: { arranged: Arranged; ctx: CardContext; status: PlanStatus | null; after?: ReactNode; add: ReactNode; allDone: string }) {
  const s = listSections(arranged, status);
  const dropped = status === null || status === "dropped";
  return (
    <div className="plan-list" style={{ display: "flex", flexDirection: "column", gap: "24px", minWidth: 0 }}>
      {s.suggested ? (
        <section aria-labelledby="col-suggested" style={GROUP}>
          <h2 id="col-suggested" style={HEAD}>
            Suggested
            <span style={COUNT}>{s.suggested.length}</span>
          </h2>
          <p style={SMALL}>What your checks found, best first.</p>
          {hiddenNote(arranged.hidden)}
          {s.suggested.length ? <Cards items={s.suggested} ctx={ctx} /> : <p style={SMALL}>{EMPTY.suggested}</p>}
        </section>
      ) : null}
      {s.progress ? (
        <section aria-labelledby="col-progress" style={GROUP}>
          <h2 id="col-progress" style={HEAD}>
            In progress
            <span style={COUNT}>{s.progress.length}</span>
          </h2>
          {add}
          {s.progress.length ? <Cards items={s.progress} ctx={ctx} state /> : <p style={SMALL}>Nothing in progress. Start a suggestion, or add a task of your own.</p>}
        </section>
      ) : null}
      {s.done ? (
        <section aria-labelledby="col-done" style={GROUP}>
          <h2 id="col-done" style={HEAD}>
            Done
            <span style={COUNT}>{s.done.of}</span>
          </h2>
          {s.done.items.length ? <Cards items={s.done.items} ctx={ctx} /> : <p style={SMALL}>{EMPTY.done}</p>}
          {s.done.of > s.done.items.length ? (
            <p style={SMALL}>
              {`The ${s.done.items.length} most recent. `}
              <Link href={allDone} style={LINK}>
                {`All ${s.done.of} done`}
              </Link>
            </p>
          ) : null}
        </section>
      ) : null}
      {dropped ? (
        <details id="dropped" className="plan-dropped" open={status === "dropped"} style={{ display: "block", minWidth: 0, scrollMarginTop: "16px" }}>
          <summary id="col-dropped" style={{ ...HEAD, cursor: "pointer", minHeight: "36px", alignItems: "center", width: "fit-content" }}>
            <svg className="plan-chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M9 6l6 6-6 6" />
            </svg>
            Dropped
            <span style={COUNT}>{arranged.dropped.length}</span>
          </summary>
          <div style={{ ...GROUP, paddingTop: "10px" }}>
            <p style={SMALL}>Dropped items stay here. Bring one back with the select on its card.</p>
            {arranged.dropped.length ? <Cards items={arranged.dropped} ctx={ctx} /> : <p style={SMALL}>Nothing dropped.</p>}
          </div>
        </details>
      ) : null}
      {after}
    </div>
  );
}

/**
 * The placed tiers' Placements group: the client's placements, live and
 * scheduled, read-only, owned by "nomada digital" - or "Your account
 * contact" in agency mode, which never names Nomada (spec 2.2). Pages are
 * host and path as text, never a link, as on Cited pages.
 */
export function PlacementsGroup({ rows, owner, className }: { rows: readonly PlacementGroupRow[]; owner: string; className?: string }) {
  return (
    <section aria-labelledby="pl-h" className={className} style={{ ...SECTION, gap: "10px" }}>
      <h2 id="pl-h" style={H2}>
        Placements
      </h2>
      <p style={SMALL}>{`Read-only. Each placement is owned by ${owner.replace(/^Your /, "your ")}.`}</p>
      {rows.length === 0 ? (
        <p style={SMALL}>No placement is live or scheduled.</p>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column" }}>
          {rows.map((r) => (
            <li key={r.id} style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: "4px 16px", padding: "10px 0", borderTop: `1px solid ${T.hair}`, fontSize: "14px", minWidth: 0 }}>
              <span style={{ display: "flex", flexDirection: "column", gap: "2px", minWidth: 0 }}>
                <span style={{ fontWeight: 600, color: T.ink, overflowWrap: "anywhere" }}>{r.page}</span>
                <span style={{ fontSize: "13px", color: T.soft }}>{r.cluster ? `${r.cluster} · ${r.when}` : r.when}</span>
              </span>
              <span style={{ fontSize: "13px", color: T.soft }}>{`Owner: ${owner}`}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
