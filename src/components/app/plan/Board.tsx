import type { ReactNode } from "react";

import { T } from "@/config/tokens";
import type { Arranged } from "@/lib/diy/plan/board";
import type { PlanKeep } from "@/lib/diy/plan/paths";
import type { Readout } from "@/lib/diy/plan/readout";
import { type PlanItem, type PlanStatus, STATUS_LABEL } from "@/lib/diy/plan/types";

import PlanCard, { type Member } from "./PlanCard";
import { H2, SMALL } from "./styles";

/**
 * The board (13 Oct 2026, DIY P3; spec 10 section 4.6): Suggested, To do,
 * Doing and Done, side by side above 1180px, two by two below it, and one
 * under another below 640px, where the board reads as the list does.
 * "Dropped (n)" is a link under it, drawn by the page.
 */

/** What every column needs to draw its cards. */
export type CardContext = {
  slug: string;
  keep: PlanKeep;
  canWrite: boolean;
  reason: string;
  members: readonly Member[] | null;
  viewer: string;
  clusterNames: ReadonlyMap<string, string>;
  readouts: ReadonlyMap<string, Readout | { kind: "error"; text: string } | null>;
  /** This week's Monday (UTC), for "New since Monday". */
  monday: string;
};

/** Each column's empty state (spec 4.6 States: "Done is empty"). */
export const EMPTY: Record<Exclude<PlanStatus, "dropped">, string> = {
  suggested: "No suggestions right now. New ones arrive as your checks find them.",
  todo: "Nothing in To do.",
  doing: "Nothing in progress.",
  done: "When you mark something done, we show what changed after it, here.",
};

export function Cards({ items, ctx }: { items: readonly PlanItem[]; ctx: CardContext }) {
  return (
    <>
      {items.map((item) => (
        <PlanCard
          key={item.id}
          item={item}
          slug={ctx.slug}
          keep={ctx.keep}
          canWrite={ctx.canWrite}
          reason={ctx.reason}
          members={ctx.members}
          viewer={ctx.viewer}
          clusterName={item.clusterId ? (ctx.clusterNames.get(item.clusterId) ?? null) : null}
          readout={ctx.readouts.get(item.id) ?? null}
          first={item.status === "suggested"}
          monday={ctx.monday}
        />
      ))}
    </>
  );
}

export function Column({ status, items, ctx, note }: { status: Exclude<PlanStatus, "dropped">; items: readonly PlanItem[]; ctx: CardContext; note?: ReactNode }) {
  const id = `col-${status}`;
  return (
    <section aria-labelledby={id} style={{ display: "flex", flexDirection: "column", gap: "10px", minWidth: 0 }}>
      <h2 id={id} style={{ ...H2, fontSize: "15px", display: "flex", alignItems: "baseline", gap: "8px" }}>
        {STATUS_LABEL[status]}
        <span style={{ fontSize: "13px", fontWeight: 600, color: T.soft }}>{items.length}</span>
      </h2>
      {note}
      {items.length ? <Cards items={items} ctx={ctx} /> : <p style={SMALL}>{EMPTY[status]}</p>}
    </section>
  );
}

export function hiddenNote(hidden: number): ReactNode {
  return hidden ? <p style={SMALL}>{`${hidden} hidden with Not now. ${hidden === 1 ? "It comes" : "They come"} back after 14 days if ${hidden === 1 ? "it still applies" : "they still apply"}.`}</p> : null;
}

export default function Board({ arranged, ctx, after }: { arranged: Arranged; ctx: CardContext; after?: ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px", minWidth: 0 }}>
      <div className="plan-board">
        {arranged.columns.map((c) => (
          <Column key={c.status} status={c.status} items={c.items} ctx={ctx} note={c.status === "suggested" ? hiddenNote(arranged.hidden) : undefined} />
        ))}
      </div>
      {after}
    </div>
  );
}
