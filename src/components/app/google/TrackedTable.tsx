import Link from "@/components/app/AppLink";

import { T } from "@/config/tokens";
import { formatDate } from "@/lib/format-date";
import type { TopHit } from "@/lib/diy/keywords/serp-competitors";
import type { TrackedRow, TrackedSort } from "@/lib/diy/keywords/tracked";
import { ordinal } from "@/lib/diy/plan/words";

import Sparkline from "./Sparkline";

/**
 * The tracked keywords table (13 Oct 2026, DIY P6; spec 10 section 4.3 rows 4
 * and 5): each keyword the client tracks, its position at the first and the
 * latest reading in the range, the change, its best, the page ranking with
 * the "URL changed" and "two of your pages take turns" flags, and its last
 * 28 readings. Read by us, every day. A keyword's row opens "Who holds page
 * 1" (`?row=<keyword id>`), Google's top 10 at its latest reading, as a row of
 * its own with one cell across the table (so the table holds only rows), drawn
 * in Google's order without rank numbers: a page where Nomada has placed
 * another client is left out, and numbers would leave a gap that points at it
 * (13 Oct 2026, review of the P6 handoff). Sorting is
 * links in the column heads, so all of it works with JS off. Below 860px a
 * row is a card: the keyword, its one figure (the latest position) on the
 * right, the rest as a line under it.
 */

const HEAD: React.CSSProperties = { fontSize: "12px", fontWeight: 600, color: T.soft, textDecoration: "none", whiteSpace: "nowrap" };
const GRID: React.CSSProperties = { display: "grid", gridTemplateColumns: "minmax(0, 1.5fr) 108px 92px 92px minmax(0, 1fr) 80px", gap: "12px", alignItems: "center" };
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const pos = (p: number | null) => (p === null ? "Not in the top 20" : ordinal(p));
/** A URL as a short path on its host: the client's own pages read as their paths. */
export const pathOf = (url: string) => {
  try {
    const u = new URL(url);
    return `${u.pathname}${u.search}` || "/";
  } catch {
    return url;
  }
};

export type SortLink = (sort: TrackedSort) => { href: string; dir: "asc" | "desc" | null };

function Head({ label, sort, link, align = "left" }: { label: string; sort: TrackedSort; link: SortLink; align?: "left" | "right" }) {
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

export function changeWords(r: Pick<TrackedRow, "change" | "move" | "firstOnly">): { text: string; tone: "good" | "bad" | "soft" } {
  if (r.firstOnly) return { text: "First reading", tone: "soft" };
  if (r.move === "entered") return { text: "Entered the top 20", tone: "good" };
  if (r.move === "left") return { text: "Left the top 20", tone: "bad" };
  if (r.change === null) return { text: "-", tone: "soft" };
  if (r.change === 0) return { text: "No change", tone: "soft" };
  return { text: `${r.change > 0 ? "+" : "−"}${Math.abs(r.change)}`, tone: r.change > 0 ? "good" : "bad" };
}

export default function TrackedTable(p: {
  rows: readonly TrackedRow[];
  clusterLabel: ReadonlyMap<string, string>;
  link: SortLink;
  rowHref: (id: string) => string;
  open: string | null;
  /** The open row's page 1: its top 10 less other clients' placed pages; "none" when none is stored for its latest reading. */
  top: { day: string; hits: TopHit[] } | "none" | "error" | null;
  /** Chips: placements live and pages pursued, by cluster. */
  placed: ReadonlyMap<string, number>;
  pursuing: ReadonlyMap<string, number>;
  placementsHref: string;
  pursuingHref: (cluster: string) => string;
  own: string;
}) {
  return (
    <div role="table" aria-label="Your tracked keywords" style={{ display: "flex", flexDirection: "column" }}>
      <div role="row" className="gk-grid gk-head" style={{ ...GRID, padding: "10px 24px", borderTop: `1px solid ${T.line}`, borderBottom: `1px solid ${T.line}` }}>
        <Head label="Keyword" sort="keyword" link={p.link} />
        <Head label="Position" sort="position" link={p.link} align="right" />
        <Head label="Change" sort="change" link={p.link} align="right" />
        <Head label="Best" sort="best" link={p.link} align="right" />
        <span role="columnheader" className="gk-col" style={HEAD}>
          Your ranking page
        </span>
        <span role="columnheader" className="gk-col" style={{ ...HEAD, textAlign: "right" }}>
          Last 28
        </span>
      </div>
      {p.rows.map((r) => {
        const ch = changeWords(r);
        const open = p.open === r.id;
        // A cluster is named for its keyword; its name is said only when it says something more.
        const label = r.clusterId ? (p.clusterLabel.get(r.clusterId) ?? null) : null;
        const meta = [label && label.toLowerCase() !== r.keyword.toLowerCase() ? label : null, r.volume !== null ? `${r.volume.toLocaleString("en-GB")} a month` : null, r.intent ? cap(r.intent) : null].filter(Boolean).join(" · ");
        const placed = r.clusterId ? (p.placed.get(r.clusterId) ?? 0) : 0;
        const pursued = r.clusterId ? (p.pursuing.get(r.clusterId) ?? 0) : 0;
        const was = r.from && r.to && r.from !== r.to ? `was ${r.from.position === null ? "not in the top 20" : ordinal(r.from.position)} on ${formatDate(r.from.day)}` : null;
        return (
          <div key={r.id} data-keyword={r.id} style={{ borderBottom: `1px solid ${T.hair}` }}>
            <div role="row" className="gk-grid gk-row" style={{ ...GRID, padding: "12px 24px" }}>
              <span role="cell" style={{ display: "flex", flexDirection: "column", gap: "3px", minWidth: 0 }}>
                <Link href={p.rowHref(r.id)} scroll={false} aria-expanded={open} style={{ fontSize: "14px", fontWeight: 600, lineHeight: 1.4, color: T.ink, textDecorationColor: T.faint, textUnderlineOffset: "3px", overflowWrap: "anywhere" }}>
                  {r.keyword}
                  <span className="sr-only">{open ? ": hide who holds page 1" : ": who holds page 1"}</span>
                </Link>
                {meta ? <span style={{ fontSize: "12px", color: T.soft }}>{meta}</span> : null}
                {placed || pursued ? (
                  <span style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                    {placed ? (
                      <Link href={p.placementsHref} style={{ fontSize: "12px", fontWeight: 600, color: T.accent, background: T.surface, border: `1px solid ${T.washLine}`, borderRadius: "999px", padding: "2px 9px", textDecoration: "none" }}>
                        {`${placed} ${placed === 1 ? "placement" : "placements"} live`}
                      </Link>
                    ) : null}
                    {pursued ? (
                      <Link href={p.pursuingHref(r.clusterId!)} style={{ fontSize: "12px", fontWeight: 600, color: T.accent, background: T.surface, border: `1px solid ${T.washLine}`, borderRadius: "999px", padding: "2px 9px", textDecoration: "none" }}>
                        {`Pursuing ${pursued} ${pursued === 1 ? "page" : "pages"}`}
                      </Link>
                    ) : null}
                  </span>
                ) : null}
                {r.notReadOn ? <span style={{ fontSize: "12px", color: T.warnFg }}>{`Not measured on ${formatDate(r.notReadOn)}; its latest reading is shown.`}</span> : null}
                <span className="gk-sub-sm" style={{ fontSize: "12px", lineHeight: 1.5, color: T.soft }}>
                  {[was, ch.text !== "-" ? ch.text : null, r.best ? `best ${ordinal(r.best.position)}` : null, r.url ? pathOf(r.url) : null].filter(Boolean).join("; ")}
                </span>
              </span>
              <span role="cell" style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "2px", fontVariantNumeric: "tabular-nums", textAlign: "right" }}>
                <span style={{ fontSize: r.to?.position === null ? "13px" : "14px", fontWeight: 700, color: r.to?.position === null ? T.soft : T.ink }}>{r.to ? pos(r.to.position) : "Not read yet"}</span>
                {was ? (
                  <span className="gk-col" style={{ fontSize: "12px", color: T.soft }}>
                    {was}
                  </span>
                ) : null}
              </span>
              <span role="cell" className="gk-col" style={{ textAlign: "right", fontSize: "13px", fontWeight: 600, color: ch.tone === "good" ? T.goodFg : ch.tone === "bad" ? T.badFg : T.soft, fontVariantNumeric: "tabular-nums" }}>
                {ch.text}
              </span>
              <span role="cell" className="gk-col" style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "2px", fontVariantNumeric: "tabular-nums" }}>
                <span style={{ fontSize: "13px", fontWeight: 600, color: T.ink }}>{r.best ? ordinal(r.best.position) : "-"}</span>
                {r.best ? <span style={{ fontSize: "12px", color: T.soft }}>{formatDate(r.best.day)}</span> : null}
              </span>
              <span role="cell" className="gk-col" style={{ display: "flex", flexDirection: "column", gap: "3px", minWidth: 0 }}>
                {r.url ? (
                  <a href={r.url} rel="noopener noreferrer" target="_blank" style={{ fontSize: "13px", color: T.ink, overflowWrap: "anywhere", textDecorationColor: T.faint }}>
                    {pathOf(r.url)}
                  </a>
                ) : (
                  <span style={{ fontSize: "13px", color: T.soft }}>-</span>
                )}
                {r.urlFlag?.kind === "changed" ? <span data-flag="url-changed" style={{ fontSize: "12px", fontWeight: 600, color: T.warnFg }}>{`URL changed ${formatDate(r.urlFlag.on)}`}</span> : null}
                {r.urlFlag?.kind === "turns" ? (
                  <span data-flag="take-turns" style={{ fontSize: "12px", lineHeight: 1.45, color: T.warnFg }}>
                    <strong>Two of your pages take turns: </strong>
                    {r.urlFlag.held
                      .slice(0, 3)
                      .map((h) => `${pathOf(h.url)} ${h.days} ${h.days === 1 ? "day" : "days"}`)
                      .join(", ")}
                  </span>
                ) : null}
              </span>
              <span role="cell" className="gk-col" style={{ display: "flex", justifyContent: "flex-end" }}>
                <Sparkline points={r.spark} />
              </span>
            </div>
            {open ? (
              <div role="row" style={{ display: "block" }}>
                <div role="cell" data-page-one={r.id} className="gk-pad" style={{ margin: "0 24px 16px", padding: "14px 16px", borderRadius: "12px", background: T.bg, border: `1px solid ${T.line}` }}>
                  <h3 style={{ margin: "0 0 8px", fontSize: "14px", fontWeight: 700, color: T.ink }}>{`Who holds page 1 for '${r.keyword}'`}</h3>
                  {p.top === "error" ? (
                    <p style={{ margin: 0, fontSize: "13px", color: T.soft }}>We couldn&apos;t read this part just now. The rest of the page is up to date.</p>
                  ) : p.top === "none" || p.top === null ? (
                    <p style={{ margin: 0, fontSize: "13px", lineHeight: 1.5, color: T.soft }}>Google&apos;s top 10 is kept from each daily reading since 13 Oct 2026. None is stored for this keyword&apos;s latest reading yet.</p>
                  ) : (
                    <>
                      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "4px" }}>
                        {p.top.hits.map((h) => (
                          <li key={`${h.domain}-${h.url ?? ""}`} data-hit={h.domain} style={{ fontSize: "13px", lineHeight: 1.5, minWidth: 0, overflowWrap: "anywhere" }}>
                            <span style={{ fontWeight: 600, color: h.domain === p.own || h.domain.endsWith(`.${p.own}`) ? T.accent : T.ink }}>{h.domain}</span>{" "}
                            {h.url ? (
                              <a href={h.url} rel="noopener noreferrer" target="_blank" style={{ color: T.soft, textDecorationColor: T.faint }}>
                                {pathOf(h.url)}
                              </a>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                      <p style={{ margin: "8px 0 0", fontSize: "12px", color: T.soft }}>{`Google's organic results for this keyword, top to bottom, checked ${formatDate(p.top.day)}.`}</p>
                    </>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
