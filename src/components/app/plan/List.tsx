import type { ReactNode } from "react";

import { T } from "@/config/tokens";
import type { Arranged } from "@/lib/diy/plan/board";
import { type PlacementGroupRow } from "@/lib/diy/plan/placements";
import { STATUS_LABEL } from "@/lib/diy/plan/types";

import { Cards, type CardContext, EMPTY, hiddenNote } from "./Board";
import { H2, SECTION, SMALL } from "./styles";

/**
 * The list (13 Oct 2026, DIY P3; spec 10 section 4.6): the same items as the
 * board, grouped by status one under another - the default below 640px -
 * with Dropped listed when `?status=dropped` asks for it. On placed tiers it
 * ends with the read-only Placements group (`after`).
 */
export default function List({ arranged, ctx, dropped, after }: { arranged: Arranged; ctx: CardContext; dropped: boolean; after?: ReactNode }) {
  return (
    <div className="plan-list" style={{ display: "flex", flexDirection: "column", gap: "20px", minWidth: 0 }}>
      {arranged.columns.map((c) => (
        <section key={c.status} aria-labelledby={`col-${c.status}`} style={{ display: "flex", flexDirection: "column", gap: "10px", minWidth: 0 }}>
          <h2 id={`col-${c.status}`} style={{ ...H2, display: "flex", alignItems: "baseline", gap: "8px" }}>
            {STATUS_LABEL[c.status]}
            <span style={{ fontSize: "13px", fontWeight: 600, color: T.soft }}>{c.items.length}</span>
          </h2>
          {c.status === "suggested" ? hiddenNote(arranged.hidden) : null}
          {c.items.length ? <Cards items={c.items} ctx={ctx} /> : <p style={SMALL}>{EMPTY[c.status]}</p>}
        </section>
      ))}
      {dropped ? (
        <section aria-labelledby="col-dropped" style={{ display: "flex", flexDirection: "column", gap: "10px", minWidth: 0 }}>
          <h2 id="col-dropped" style={{ ...H2, display: "flex", alignItems: "baseline", gap: "8px" }}>
            Dropped
            <span style={{ fontSize: "13px", fontWeight: 600, color: T.soft }}>{arranged.dropped.length}</span>
          </h2>
          {arranged.dropped.length ? <Cards items={arranged.dropped} ctx={ctx} /> : <p style={SMALL}>Nothing dropped.</p>}
        </section>
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
