import { Spark, longDay } from "@/components/dash/Figures";
import type { CopilotView } from "@/lib/dash/copilot";

const n = (v: number) => v.toLocaleString("en-GB");
const path = (u: string) => {
  try { const x = new URL(u); return (x.pathname === "/" ? "Home page" : x.pathname.replace(/\/$/, "")) + x.search; } catch { return u; }
};

/**
 * Microsoft Copilot (26 Nov 2026): Bing = search + Copilot, so this sits beside the chat engines, never among them.
 * Anchor #copilot is the deep link used in client emails. No data yet is "First numbers coming soon".
 */
export default function CopilotCard({ view }: { view: CopilotView | null }) {
  return (
    <div className="dash-card copilot-card" id="copilot" style={{ marginTop: 16, scrollMarginTop: 16 }}>
      <h2>Microsoft Copilot</h2>
      <p className="intro">How often Copilot cites your site, from Bing Webmaster Tools. This is Copilot reading your pages, not answers to our prompts, so it is kept apart from the engines above.</p>
      {!view ? (
        <p className="copilot-empty">First numbers coming soon</p>
      ) : (
        <>
          <div className="copilot-head">
            <div>
              <span className="copilot-total">{n(view.total)}</span>
              <span className="copilot-unit"> citations in the 28 days to {longDay(view.asOf)}</span>
            </div>
            {view.pct !== null ? <span className={`copilot-delta ${view.pct < 0 ? "down" : "up"}`}>{view.pct > 0 ? "+" : ""}{view.pct}% on the 28 days before</span> : null}
          </div>
          {view.days.length > 1 ? (
            <div className="copilot-chart" role="img" aria-label={`Daily Copilot citations, last ${view.days.length} days`}>
              <Spark values={view.days.map((d) => d.c)} width={600} height={64} max={Math.max(...view.days.map((d) => d.c), 1)} fluid />
              <div className="copilot-axis"><span>{longDay(view.days[0]!.day)}</span><span>{longDay(view.days[view.days.length - 1]!.day)}</span></div>
            </div>
          ) : null}
          {view.pages ? (
            <div className="tbl-wrap" style={{ marginTop: 14 }}>
              <table className="tbl">
                <thead><tr><th>Most cited pages</th><th className="r">Citations</th></tr></thead>
                <tbody>
                  {view.pages.top.map((p) => (
                    <tr key={p.page}><td title={p.page} style={{ overflowWrap: "anywhere" }}>{path(p.page)}</td><td className="r">{n(p.c)}</td></tr>
                  ))}
                </tbody>
              </table>
              <p className="faint" style={{ fontSize: 12, margin: "8px 0 0" }}>Pages cited {longDay(view.pages.from)} to {longDay(view.pages.to)}{view.pages.n > view.pages.top.length ? `, top ${view.pages.top.length} of ${view.pages.n}` : ""}.</p>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
