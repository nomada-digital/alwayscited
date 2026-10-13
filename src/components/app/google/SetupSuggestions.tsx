import SubmitButton from "@/components/app/SubmitButton";

import { MICRO, T } from "@/config/tokens";
import type { Suggestion } from "@/lib/diy/keywords/setup-suggestions";

/**
 * Setup's "Suggested keywords" (13 Oct 2026, DIY P6; spec 10 section 4.12):
 * up to 10 keywords the site already ranks 4th to 30th for with a buying
 * intent, the gaining-ground ones, and the keyword typed at checkout, each
 * with its position, volume and page as DataForSEO estimates them. "Use this
 * keyword" runs the existing Check keyword on the cluster card that needs
 * one (the same plain POST its own field makes, so the same signed pass, the
 * same 20 a day, and the same 303 back to that card); with no such card it
 * opens Clusters' Add panel prefilled. Viewers see the list and the reason.
 */
export default function SetupSuggestions({ items, slug, card, addHref, canWrite }: { items: readonly Suggestion[]; slug: string; card: string | null; addHref: (keyword: string) => string; canWrite: boolean }) {
  if (!items.length) return null;
  const BTN = { height: "44px", padding: "0 14px", border: `1px solid ${T.ink}`, borderRadius: "10px", background: T.surface, color: T.ink, fontFamily: "inherit", fontSize: "13px", fontWeight: 600, whiteSpace: "nowrap" } as const;
  return (
    <div data-suggested-keywords="" style={{ border: `1px solid ${T.line}`, borderRadius: "14px", padding: "18px 22px", marginBottom: "40px", background: T.surface }}>
      <div style={MICRO}>Suggested keywords</div>
      <p style={{ margin: "4px 0 12px", fontSize: "14px", lineHeight: 1.6, color: T.soft }}>
        {card ? "Keywords your site already ranks for on Google. Use one to check it on the cluster that needs a keyword." : "Keywords your site already ranks for on Google. Use one to add it as a cluster; it is checked first."}
      </p>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column" }}>
        {items.map((s, i) => (
          <li key={s.keyword} data-suggestion={s.keyword} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px 16px", flexWrap: "wrap", padding: "10px 0", borderTop: `1px solid ${T.hair}` }}>
            <span style={{ display: "flex", flexDirection: "column", gap: "2px", minWidth: 0, flex: "1 1 260px" }}>
              <span style={{ fontSize: "15px", fontWeight: 600, color: T.ink, overflowWrap: "anywhere" }}>{s.keyword}</span>
              <span style={{ fontSize: "13px", lineHeight: 1.5, color: T.soft, overflowWrap: "anywhere" }}>{s.reason}</span>
            </span>
            {!canWrite ? (
              <button type="button" disabled aria-describedby="setup-sg-viewer" style={{ ...BTN, border: 0, background: T.chip, color: T.soft, cursor: "not-allowed" }}>
                Use this keyword
              </button>
            ) : card ? (
              <form method="post" action={`/api/app/${encodeURIComponent(slug)}/check`} style={{ margin: 0 }}>
                <input id={`setup-sg-card-${i}`} type="hidden" name="card" value={card} />
                <input id={`setup-sg-own-${i}`} type="hidden" name="own" value="" />
                <input id={`setup-sg-kw-${i}`} type="hidden" name="keyword" value={s.keyword} />
                <SubmitButton busy="Checking..." style={BTN}>
                  Use this keyword<span className="sr-only">{`: '${s.keyword}'`}</span>
                </SubmitButton>
              </form>
            ) : (
              <a href={addHref(s.keyword)} style={{ ...BTN, display: "inline-flex", alignItems: "center", textDecoration: "none", boxSizing: "border-box" }}>
                Use this keyword<span className="sr-only">{`: '${s.keyword}'`}</span>
              </a>
            )}
          </li>
        ))}
      </ul>
      {canWrite ? null : (
        <p id="setup-sg-viewer" style={{ margin: "8px 0 0", fontSize: "13px", color: T.soft }}>
          Viewers can&apos;t change this. Ask an owner or editor.
        </p>
      )}
    </div>
  );
}
