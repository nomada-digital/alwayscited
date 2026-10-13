import Link from "@/components/app/AppLink";

import { T } from "@/config/tokens";
import type { Suggestion } from "@/lib/diy/keywords/setup-suggestions";

/**
 * Suggested clusters (13 Oct 2026, DIY P6; spec 10 section 4.10): while a
 * cluster slot is free, up to 5 keywords to track - gaining ground first,
 * then keywords the client already ranks 4th to 30th for with a buying
 * intent - each with its reason line and its estimate's read date. "Use this
 * keyword" opens the Add panel prefilled (`?add=1&kw=&src=gaining`), so the
 * existing Check keyword still decides, at 20 a day. A link, so it works with
 * JS off. Viewers see the list with the control disabled and the reason.
 */
export default function SuggestedClusters({ items, hrefFor, canWrite, free }: { items: readonly Suggestion[]; hrefFor: (keyword: string) => string; canWrite: boolean; free: number }) {
  if (!items.length) return null;
  return (
    <section aria-labelledby="suggested-h" data-suggested="" style={{ padding: "18px 22px", borderRadius: "18px", background: T.surface, border: `1px solid ${T.line}`, display: "flex", flexDirection: "column", gap: "12px", minWidth: 0 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
        <h2 id="suggested-h" style={{ margin: 0, fontSize: "17px", fontWeight: 700, color: T.ink }}>
          Suggested clusters
        </h2>
        <p style={{ margin: 0, fontSize: "13px", lineHeight: 1.5, color: T.soft }}>{`${free} ${free === 1 ? "cluster slot is" : "cluster slots are"} free. Keywords your site already ranks for on Google, from DataForSEO's index. Each is checked again before anything is tracked.`}</p>
      </div>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column" }}>
        {items.map((s) => (
          <li key={s.keyword} data-suggestion={s.keyword} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px 16px", flexWrap: "wrap", padding: "10px 0", borderTop: `1px solid ${T.hair}` }}>
            <span style={{ display: "flex", flexDirection: "column", gap: "2px", minWidth: 0, flex: "1 1 280px" }}>
              <span style={{ fontSize: "14px", fontWeight: 600, color: T.ink, overflowWrap: "anywhere" }}>{s.keyword}</span>
              <span style={{ fontSize: "13px", lineHeight: 1.5, color: T.soft, overflowWrap: "anywhere" }}>{s.reason}</span>
            </span>
            {canWrite ? (
              <Link href={hrefFor(s.keyword)} scroll={false} data-usage="gaining_track" style={{ display: "inline-flex", alignItems: "center", height: "44px", padding: "0 14px", borderRadius: "10px", border: `1px solid ${T.line}`, background: T.surface, color: T.ink, fontSize: "13px", fontWeight: 600, textDecoration: "none", whiteSpace: "nowrap" }}>
                Use this keyword<span className="sr-only">{`: '${s.keyword}'`}</span>
              </Link>
            ) : (
              <button type="button" disabled aria-describedby="suggested-viewer" style={{ display: "inline-flex", alignItems: "center", height: "44px", padding: "0 14px", borderRadius: "10px", border: 0, background: T.chip, color: T.soft, fontSize: "13px", fontWeight: 600, fontFamily: "inherit", cursor: "not-allowed" }}>
                Use this keyword
              </button>
            )}
          </li>
        ))}
      </ul>
      {canWrite ? null : (
        <p id="suggested-viewer" style={{ margin: 0, fontSize: "13px", color: T.soft }}>
          Viewers can&apos;t change this. Ask an owner or editor.
        </p>
      )}
    </section>
  );
}
