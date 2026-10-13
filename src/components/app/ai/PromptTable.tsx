import Link from "@/components/app/AppLink";
import type { ReactNode } from "react";

import { T } from "@/config/tokens";
import type { PromptRow, Sort } from "@/lib/diy/ai/prompt-table";

/**
 * The AI visibility prompt table (13 Oct 2026, DIY P4; spec 10 section 4.2
 * row 5): one row per prompt, with its cluster and angle under it, its origin,
 * the engines naming it at the latest check ("2 of 3", engines that did not
 * answer left out), the answers naming the client over the range ("9 of 56"),
 * Google's AI Overview at the latest check and the change against the first
 * check in the range, like for like. A first reading is shown and flagged,
 * never scored. Sorting is links in the column heads, so it works with JS off.
 * A row opens its one-cluster page on that prompt - its evidence; a prompt in
 * no cluster has no such page and is not linked. Below 860px each row is a
 * card: the prompt, its one figure (answers naming you) on the right, the rest
 * as a line under it.
 */

const HEAD: React.CSSProperties = { fontSize: "12px", fontWeight: 600, color: T.soft, textDecoration: "none", whiteSpace: "nowrap" };
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export type SortLink = (sort: Sort) => { href: string; dir: "asc" | "desc" | null };

function Head({ label, sort, link, align = "left" }: { label: string; sort: Sort; link: SortLink; align?: "left" | "right" }) {
  const { href, dir } = link(sort);
  return (
    <span role="columnheader" aria-sort={dir === "asc" ? "ascending" : dir === "desc" ? "descending" : "none"} style={{ textAlign: align }}>
      <Link href={href} data-usage="ai_filter" style={{ ...HEAD, color: dir ? T.ink : T.soft }}>
        {label}
        {dir ? <span aria-hidden="true">{dir === "asc" ? " ↑" : " ↓"}</span> : null}
      </Link>
    </span>
  );
}

export default function PromptTable({
  rows,
  link,
  rowHref,
  origin,
  aio,
  compared,
}: {
  rows: readonly PromptRow[];
  link: SortLink;
  /** The prompt's evidence page, or null for one in no cluster. */
  rowHref: (r: PromptRow) => string | null;
  /** The origin cell: P2's OriginChip once P5 wires it, the plain label until then. */
  origin: (r: PromptRow) => ReactNode;
  /** The tier reads Google's AI Overviews, so the column draws. */
  aio: boolean;
  /** The range has a first check before its latest, so "was" and the change can be drawn. */
  compared: boolean;
}) {
  const grid: React.CSSProperties = { display: "grid", gridTemplateColumns: aio ? "minmax(0, 1fr) 130px 104px 104px 84px 72px" : "minmax(0, 1fr) 130px 104px 104px 72px", gap: "12px", alignItems: "center" };
  return (
    <div role="table" aria-label="Your prompts" style={{ display: "flex", flexDirection: "column" }}>
      <div role="row" className="ai-grid ai-head" style={{ ...grid, padding: "10px 24px", borderTop: `1px solid ${T.line}`, borderBottom: `1px solid ${T.line}` }}>
        <Head label="Prompt" sort="prompt" link={link} />
        <span role="columnheader" style={HEAD}>
          Origin
        </span>
        <Head label="Engines naming you" sort="engines" link={link} align="right" />
        <Head label="Answers naming you" sort="named" link={link} align="right" />
        {aio ? (
          <span role="columnheader" style={{ ...HEAD, textAlign: "right" }}>
            AI Overview
          </span>
        ) : null}
        <Head label="Change" sort="change" link={link} align="right" />
      </div>
      {rows.map((r) => {
        const to = rowHref(r);
        const where = [r.clusterLabel, r.angle ? cap(r.angle) : null].filter(Boolean).join(" · ") || "Not in a cluster";
        const engines = r.latest ? `${r.latest.named} of ${r.latest.of}` : "-";
        const was = r.from && !r.first ? `was ${r.from.named} of ${r.from.of}` : null;
        const named = `${r.answers.num.toLocaleString("en-GB")} of ${r.answers.den.toLocaleString("en-GB")}`;
        const change = r.first || r.change === null ? null : r.change === 0 ? "No change" : `${r.change > 0 ? "+" : "−"}${Math.abs(r.change)}`;
        return (
          <div role="row" key={r.id} data-prompt={r.id} data-missing={r.missing ? "1" : undefined} className="ai-grid ai-row" style={{ ...grid, padding: "12px 24px", borderBottom: `1px solid ${T.hair}` }}>
            <span role="cell" style={{ display: "flex", flexDirection: "column", gap: "3px", minWidth: 0 }}>
              <span style={{ fontSize: "14px", fontWeight: 600, lineHeight: 1.4, color: T.ink, overflowWrap: "anywhere" }}>
                {to ? (
                  <Link href={to} style={{ color: T.ink, textDecorationColor: T.faint, textUnderlineOffset: "3px" }}>
                    {r.text}
                  </Link>
                ) : (
                  r.text
                )}
              </span>
              <span style={{ fontSize: "12px", color: T.soft }}>{where}</span>
              {r.first ? <span style={{ fontSize: "12px", color: T.soft }}>First reading: scored from the next full check.</span> : null}
              <span className="ai-sub-sm" style={{ fontSize: "12px", lineHeight: 1.5, color: T.soft }}>
                {`${engines} engines at the latest check${was ? `, ${was}` : ""}${change && compared ? `; ${change === "No change" ? "no change" : `change ${change}`}` : ""}${aio && r.aio ? `; AI Overview ${r.aio}` : ""}`}
              </span>
            </span>
            <span role="cell" className="ai-col" style={{ minWidth: 0 }}>
              {origin(r)}
            </span>
            <span role="cell" className="ai-col" style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "2px", fontVariantNumeric: "tabular-nums" }}>
              <span style={{ fontSize: "14px", fontWeight: 700, color: T.ink }}>{engines}</span>
              {was ? <span style={{ fontSize: "12px", color: T.soft }}>{was}</span> : null}
            </span>
            <span role="cell" style={{ textAlign: "right", fontSize: "14px", fontWeight: 700, color: T.ink, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }} title={`${named} answers named you in this range`}>
              {named}
            </span>
            {aio ? (
              <span role="cell" className="ai-col" style={{ textAlign: "right", fontSize: "13px", color: r.aio === "named" ? T.goodFg : T.soft, fontWeight: r.aio === "named" ? 600 : 400 }}>
                {r.aio === "named" ? "Named" : r.aio === "shown" ? "Shown" : r.aio === "none" ? "None" : "-"}
              </span>
            ) : null}
            <span role="cell" className="ai-col" style={{ textAlign: "right", fontSize: "13px", fontWeight: 600, color: !change || change === "No change" ? T.soft : r.change! > 0 ? T.goodFg : T.badFg, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
              {compared && change ? change : "-"}
            </span>
          </div>
        );
      })}
    </div>
  );
}
