import Link from "@/components/app/AppLink";

import { T } from "@/config/tokens";
import type { RankingRow, RankingSort } from "@/lib/diy/keywords/ranking";
import { ordinal } from "@/lib/diy/plan/words";

/**
 * "All ranking keywords" (13 Oct 2026, DIY P6; spec 10 section 4.3,
 * `?view=all`): every keyword in the latest footprint pull, a DataForSEO
 * estimate. Keyword, position, change since the previous reading, volume,
 * estimated traffic, intent and page; no difficulty column (spec 2.3). Each
 * untracked row has Track as a cluster. Sorting is links in the heads, so it
 * works with JS off; below 860px a row is a card with its position on the
 * right.
 */

const HEAD: React.CSSProperties = { fontSize: "12px", fontWeight: 600, color: T.soft, textDecoration: "none", whiteSpace: "nowrap" };
const GRID: React.CSSProperties = { display: "grid", gridTemplateColumns: "minmax(0, 1.6fr) 72px 72px 84px 84px 104px minmax(0, 1fr)", gap: "12px", alignItems: "center" };
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const n = (v: number | null) => (v === null ? "-" : v.toLocaleString("en-GB"));

export type RankSortLink = (sort: RankingSort) => { href: string; dir: "asc" | "desc" | null };

function Head({ label, sort, link, align = "left" }: { label: string; sort: RankingSort; link: RankSortLink; align?: "left" | "right" }) {
  const { href, dir } = link(sort);
  return (
    <span role="columnheader" aria-sort={dir === "asc" ? "ascending" : dir === "desc" ? "descending" : "none"} style={{ textAlign: align }}>
      <Link href={href} scroll={false} style={{ ...HEAD, color: dir ? T.ink : T.soft }}>
        {label}
        {dir ? <span aria-hidden="true">{dir === "asc" ? " ↑" : " ↓"}</span> : null}
      </Link>
    </span>
  );
}

export default function RankingTable({ rows, link, trackHref, canWrite, basis }: { rows: readonly RankingRow[]; link: RankSortLink; trackHref: (keyword: string) => string; canWrite: boolean; basis: "ours" | "dataforseo" }) {
  return (
    <div role="table" aria-label="Every keyword you rank for, DataForSEO estimate" style={{ display: "flex", flexDirection: "column" }}>
      <div role="row" className="gk-grid gr-head" style={{ ...GRID, padding: "10px 24px", borderTop: `1px solid ${T.line}`, borderBottom: `1px solid ${T.line}` }}>
        <Head label="Keyword" sort="keyword" link={link} />
        <Head label="Position" sort="position" link={link} align="right" />
        <Head label={basis === "ours" ? "Change" : "Change*"} sort="change" link={link} align="right" />
        <Head label="Volume" sort="volume" link={link} align="right" />
        <Head label="Est. traffic" sort="etv" link={link} align="right" />
        <span role="columnheader" className="gk-col" style={HEAD}>
          Intent
        </span>
        <span role="columnheader" className="gk-col" style={HEAD}>
          Page
        </span>
      </div>
      {rows.map((r) => {
        const ch = r.change === null ? (r.isNew ? "New" : "-") : r.change === 0 ? "No change" : `${r.change > 0 ? "+" : "−"}${Math.abs(r.change)}`;
        return (
          <div role="row" key={r.keyword} data-ranking={r.keyword} className="gk-grid gr-row" style={{ ...GRID, padding: "10px 24px", borderBottom: `1px solid ${T.hair}` }}>
            <span role="cell" style={{ display: "flex", flexDirection: "column", gap: "4px", minWidth: 0 }}>
              <span style={{ fontSize: "14px", fontWeight: 600, lineHeight: 1.4, color: T.ink, overflowWrap: "anywhere" }}>{r.keyword}</span>
              <span className="gk-sub-sm" style={{ fontSize: "12px", lineHeight: 1.5, color: T.soft }}>
                {[ch !== "-" ? ch : null, r.volume !== null ? `${n(r.volume)} a month` : null, r.intent ? cap(r.intent) : null, r.url].filter(Boolean).join("; ")}
              </span>
              {r.tracked ? (
                <span style={{ alignSelf: "flex-start", fontSize: "12px", fontWeight: 600, color: T.goodFg, background: T.goodBg, borderRadius: "999px", padding: "2px 9px" }}>Tracked</span>
              ) : canWrite ? (
                <Link href={trackHref(r.keyword)} data-usage="gaining_track" style={{ alignSelf: "flex-start", display: "inline-flex", alignItems: "center", minHeight: "32px", fontSize: "13px", fontWeight: 600, color: T.accent, textDecoration: "none" }}>
                  Track as a cluster<span className="sr-only">{`: '${r.keyword}'`}</span>
                </Link>
              ) : null}
            </span>
            <span role="cell" style={{ textAlign: "right", fontSize: "14px", fontWeight: 700, color: T.ink, fontVariantNumeric: "tabular-nums" }}>
              {r.position === null ? "-" : ordinal(r.position)}
            </span>
            <span role="cell" className="gk-col" style={{ textAlign: "right", fontSize: "13px", fontWeight: 600, color: r.change === null || r.change === 0 ? T.soft : r.change > 0 ? T.goodFg : T.badFg, fontVariantNumeric: "tabular-nums" }}>
              {ch}
            </span>
            <span role="cell" className="gk-col" style={{ textAlign: "right", fontSize: "13px", color: T.ink, fontVariantNumeric: "tabular-nums" }}>
              {n(r.volume)}
            </span>
            <span role="cell" className="gk-col" style={{ textAlign: "right", fontSize: "13px", color: T.ink, fontVariantNumeric: "tabular-nums" }}>
              {r.etv === null ? "-" : r.etv.toLocaleString("en-GB", { maximumFractionDigits: r.etv < 10 ? 1 : 0 })}
            </span>
            <span role="cell" className="gk-col" style={{ fontSize: "13px", color: T.soft }}>
              {r.intent ? cap(r.intent) : "-"}
            </span>
            <span role="cell" className="gk-col" style={{ fontSize: "13px", color: T.soft, overflowWrap: "anywhere" }}>
              {r.url ?? "-"}
            </span>
          </div>
        );
      })}
    </div>
  );
}
