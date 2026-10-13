import Link from "@/components/app/AppLink";
import SubmitButton from "@/components/app/SubmitButton";

import { T } from "@/config/tokens";
import { formatDate } from "@/lib/format-date";
import { type Momentum, gainingLabel, gainingSummary } from "@/lib/diy/keywords/momentum";
import type { Dismissal } from "@/lib/diy/keywords/data";
import { draftPrompts } from "@/lib/tracking/add-cluster";

/**
 * Gaining ground (13 Oct 2026, DIY P6; spec 10 section 4.3 row 3 and 6.6):
 * untracked keywords climbing or new in DataForSEO's index, from the two
 * newest footprint pulls. A collapsed accent row, as on Nomada's tab, opened
 * by `?gaining=1` - a link, so it works with JS off. Each row is a watch row:
 * a weekly position from DataForSEO's index, never counted in the daily
 * figures, and the block says so.
 *
 * Track as a cluster opens Clusters' add panel prefilled (`?add=1&kw=&src=gaining`);
 * the client still presses Check keyword, the existing door with its Google
 * Ads volume and its 20 a day. Dismiss is a plain POST to the keywords route
 * that answers with a 303 and a toast. Viewers, and members of an ended
 * client, see both disabled, with the reason that applies to them.
 *
 * The intent switch and the Dismissed list (with Restore) stay reachable when
 * nothing is gaining under the current filter: a member who dismissed the
 * last keyword, or whose only climbers are informational, can still restore
 * one or see every intent (13 Oct 2026, review of the P6 handoff).
 */

const H2: React.CSSProperties = { margin: 0, fontSize: "19px", fontWeight: 700, letterSpacing: "-0.022em", color: T.ink };
const BTN: React.CSSProperties = { display: "inline-flex", alignItems: "center", height: "44px", padding: "0 16px", boxSizing: "border-box", borderRadius: "12px", fontSize: "14px", fontWeight: 600, textDecoration: "none", fontFamily: "inherit", whiteSpace: "nowrap" };
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export type GainingState =
  | { kind: "ok"; m: Momentum }
  | { kind: "pending"; firstReadOn: string }
  | { kind: "none"; readOn: string; domain: string }
  | { kind: "error"; text: string };

export default function GainingGround(p: {
  state: GainingState;
  slug: string;
  open: boolean;
  showAll: boolean;
  canWrite: boolean;
  /** Why a member who cannot write cannot (write.ts readOnlyReason): a viewer's, or an ended client's. */
  reason: string;
  /** Live dismissals, newest first, each with its Restore. */
  dismissed: readonly Dismissal[];
  /** The page's view state, which the forms carry back. */
  keep: Record<string, string>;
  toggle: string;
  intentHref: (all: boolean) => string;
  trackHref: (keyword: string) => string;
  notice: { text: string; undo: string | null; ok: boolean } | null;
}) {
  const route = `/api/app/${encodeURIComponent(p.slug)}/keywords?${new URLSearchParams(p.keep)}`;
  const s = p.state;
  const head = s.kind === "ok" ? `${gainingSummary(s.m, p.showAll)} From DataForSEO's index, read ${formatDate(s.m.readOn)}.` : null;
  const total = s.kind === "ok" ? s.m.total : 0;
  const pill = (on: boolean): React.CSSProperties => ({ display: "inline-flex", alignItems: "center", height: "36px", padding: "0 14px", borderRadius: "999px", border: `1px solid ${on ? T.washLine : T.line}`, background: on ? T.surface : "transparent", color: T.ink, fontSize: "13px", fontWeight: 600, textDecoration: "none" });
  return (
    <section id="gaining" aria-labelledby="gaining-h" style={{ scrollMarginTop: "24px", background: T.wash, border: `1px solid ${T.washLine}`, borderRadius: "18px", minWidth: 0 }}>
      <div className="gg-pad" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px 16px", flexWrap: "wrap", padding: "18px 22px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "4px", minWidth: 0, flex: "1 1 320px" }}>
          <h2 id="gaining-h" style={H2}>
            Gaining ground
          </h2>
          <p data-gaining-summary="" style={{ margin: 0, fontSize: "14px", lineHeight: 1.5, color: T.ink }}>
            {s.kind === "ok" ? head : s.kind === "pending" ? `Your Google footprint is read weekly. First read ${formatDate(s.firstReadOn)}.` : s.kind === "none" ? `DataForSEO's index has no Google rankings for ${s.domain} yet (read ${formatDate(s.readOn)}).` : s.text}
          </p>
        </div>
        {s.kind === "ok" && total ? (
          <Link href={p.toggle} scroll={false} aria-expanded={p.open} style={{ ...BTN, border: `1px solid ${T.washLine}`, background: T.surface, color: T.ink }}>
            {p.open ? "Hide them" : `Show ${s.m.rows.length === total ? (total === 1 ? "it" : `all ${total}`) : `the top ${s.m.rows.length}`}`}
          </Link>
        ) : s.kind === "ok" && !p.open ? (
          // Nothing gaining under this filter: the other intents, and the dismissed keywords, stay one link away.
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            <Link href={p.intentHref(!p.showAll)} scroll={false} data-gaining-intent="" style={{ ...BTN, border: `1px solid ${T.washLine}`, background: T.surface, color: T.ink }}>
              {p.showAll ? "Buying intent only" : "See every intent"}
            </Link>
            {p.dismissed.length ? (
              <Link href={p.toggle} scroll={false} aria-expanded={false} style={{ ...BTN, border: `1px solid ${T.washLine}`, background: T.surface, color: T.ink }}>
                {`Dismissed (${p.dismissed.length})`}
              </Link>
            ) : null}
          </div>
        ) : s.kind === "ok" ? (
          <Link href={p.toggle} scroll={false} aria-expanded={true} style={{ ...BTN, border: `1px solid ${T.washLine}`, background: T.surface, color: T.ink }}>
            Hide
          </Link>
        ) : null}
      </div>
      {p.notice ? (
        <div role="status" data-gaining-notice={p.notice.ok ? "done" : "refused"} className="gg-pad" style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap", margin: "0 22px 14px", padding: "12px 16px", borderRadius: "12px", background: p.notice.ok ? T.ink : T.surface, color: p.notice.ok ? T.surface : T.ink, border: p.notice.ok ? 0 : `1px solid ${T.washLine}`, fontSize: "14px", lineHeight: 1.4 }}>
          <span style={{ flex: "1 1 240px" }}>{p.notice.text}</span>
          {p.notice.undo && p.canWrite ? (
            <form method="post" action={route} style={{ margin: 0 }}>
              <input id="gg-undo-do" type="hidden" name="do" value="restore" />
              <input id="gg-undo-kw" type="hidden" name="keyword" value={p.notice.undo} />
              <SubmitButton busy="Restoring..." style={{ ...BTN, height: "36px", border: `1px solid ${T.faint}`, background: "transparent", color: T.surface }}>
                Undo
              </SubmitButton>
            </form>
          ) : null}
        </div>
      ) : null}
      {s.kind === "ok" && p.open ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px", padding: "0 22px 20px" }} className="gg-pad">
          <nav aria-label="Which intents" style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            {[false, true].map((all) => (
              <Link key={String(all)} href={p.intentHref(all)} aria-current={p.showAll === all ? "true" : undefined} scroll={false} style={pill(p.showAll === all)}>
                {all ? "Every intent" : "Buying intent only"}
              </Link>
            ))}
          </nav>
          {total ? (
            <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "8px" }}>
              {s.m.rows.map((g, i) => (
                <li key={g.keyword} data-gaining={g.keyword} style={{ background: T.surface, border: `1px solid ${T.line}`, borderRadius: "14px", padding: "14px 16px", display: "flex", flexDirection: "column", gap: "8px" }}>
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "8px 16px", flexWrap: "wrap" }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: "3px", minWidth: 0, flex: "1 1 280px" }}>
                      <span style={{ fontSize: "15px", fontWeight: 700, color: T.ink, overflowWrap: "anywhere" }}>{g.keyword}</span>
                      <span style={{ fontSize: "13px", fontWeight: 600, color: T.goodFg }}>{gainingLabel(g)}</span>
                      <span style={{ fontSize: "13px", lineHeight: 1.5, color: T.soft, overflowWrap: "anywhere" }}>
                        {[g.volume !== null ? `${g.volume.toLocaleString("en-GB")} searches a month` : null, g.intent ? cap(g.intent) : null, g.url ? `ranking with ${g.url}` : null].filter(Boolean).join(" · ")} (DataForSEO estimate)
                      </span>
                    </div>
                    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
                      {p.canWrite ? (
                        <>
                          <Link href={p.trackHref(g.keyword)} data-usage="gaining_track" data-track={g.keyword} style={{ ...BTN, background: T.accent, color: T.surface }}>
                            Track as a cluster<span className="sr-only">{`: '${g.keyword}'`}</span>
                          </Link>
                          <form method="post" action={route} style={{ margin: 0 }}>
                            <input id={`gg-do-${i}`} type="hidden" name="do" value="dismiss" />
                            <input id={`gg-kw-${i}`} type="hidden" name="keyword" value={g.keyword} />
                            <SubmitButton busy="Dismissing..." style={{ ...BTN, border: `1px solid ${T.line}`, background: T.surface, color: T.ink }}>
                              Dismiss<span className="sr-only">{` '${g.keyword}'`}</span>
                            </SubmitButton>
                          </form>
                        </>
                      ) : (
                        <>
                          <button type="button" disabled aria-describedby="gg-viewer" style={{ ...BTN, border: 0, background: T.chip, color: T.soft, cursor: "not-allowed" }}>
                            Track as a cluster
                          </button>
                          <button type="button" disabled aria-describedby="gg-viewer" style={{ ...BTN, border: `1px solid ${T.line}`, background: T.surface, color: T.soft, cursor: "not-allowed" }}>
                            Dismiss
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                  <details>
                    <summary style={{ cursor: "pointer", minHeight: "32px", display: "flex", alignItems: "center", fontSize: "13px", fontWeight: 600, color: T.accent }}>Its 5 drafted prompts</summary>
                    <ul style={{ margin: "6px 0 0", paddingLeft: "18px", display: "flex", flexDirection: "column", gap: "4px", fontSize: "13px", lineHeight: 1.5, color: T.ink }}>
                      {draftPrompts(g.keyword).map((t) => (
                        <li key={t}>{t}</li>
                      ))}
                    </ul>
                    <p style={{ margin: "6px 0 0", fontSize: "12px", color: T.soft }}>Drafted from the keyword. You can edit each one before tracking starts.</p>
                  </details>
                </li>
              ))}
            </ol>
          ) : null}
          {!p.canWrite ? (
            <p id="gg-viewer" style={{ margin: 0, fontSize: "13px", color: T.soft }}>
              {p.reason}
            </p>
          ) : null}
          {p.dismissed.length ? (
            <div data-dismissed="" style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <span style={{ fontSize: "13px", fontWeight: 600, color: T.ink }}>{`Dismissed (${p.dismissed.length})`}</span>
              <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "6px" }}>
                {p.dismissed.map((d, i) => (
                  <li key={d.key} style={{ display: "flex", alignItems: "center", gap: "8px 12px", flexWrap: "wrap", fontSize: "13px", color: T.soft }}>
                    <span style={{ color: T.ink, overflowWrap: "anywhere" }}>{d.key}</span>
                    <span>{`out of this list until ${formatDate(d.until)}`}</span>
                    {p.canWrite ? (
                      <form method="post" action={route} style={{ margin: 0 }}>
                        <input id={`gg-r-do-${i}`} type="hidden" name="do" value="restore" />
                        <input id={`gg-r-kw-${i}`} type="hidden" name="keyword" value={d.key} />
                        <SubmitButton busy="Restoring..." style={{ ...BTN, height: "44px", padding: "0 12px", border: `1px solid ${T.line}`, background: T.surface, color: T.ink, fontSize: "13px" }}>
                          Restore<span className="sr-only">{` '${d.key}'`}</span>
                        </SubmitButton>
                      </form>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <p style={{ margin: 0, fontSize: "12px", lineHeight: 1.5, color: T.soft }}>{basisNote(s.m)}</p>
        </div>
      ) : null}
    </section>
  );
}

/** The block's footnote: what the rows are, and what each is compared with. */
export function basisNote(m: Pick<Momentum, "basis" | "fallback" | "previousOn" | "previousRows">): string {
  const watch = "These are watch rows: weekly positions from DataForSEO's index, never counted in the daily figures above. Positions are among Google's organic results.";
  const rule = "Climbing means up 5 or more places; new means it arrived in the top 20.";
  if (m.basis === "dataforseo") return `${watch} With one pull so far, each is compared with DataForSEO's own previous reading of that keyword, counted in places on the results page and dated on its row; from our second pull, with ours. ${rule}`;
  const ours = `Each is compared with our previous pull, read ${formatDate(m.previousOn!)}.`;
  const fb = m.fallback
    ? ` That pull read the top ${m.previousRows.toLocaleString("en-GB")} keywords by estimated traffic, so ${m.fallback === 1 ? "one keyword" : `${m.fallback} keywords`} below it ${m.fallback === 1 ? "is" : "are"} compared with DataForSEO's own previous reading instead, as ${m.fallback === 1 ? "its row says" : "their rows say"}.`
    : "";
  return `${watch} ${ours}${fb} ${rule}`;
}
