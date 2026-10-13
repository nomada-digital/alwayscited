import Link from "@/components/app/AppLink";
import { T } from "@/config/tokens";
import { clientHref, itemPath, planAction, planPath, type PlanKeep } from "@/lib/diy/plan/paths";
import { EFFORT_LABEL, type PlanItem, SEVERITY_LABEL, STATUS_LABEL, TITLE_COPY, actLabel, clip } from "@/lib/diy/plan/types";
import { itemChip, whyFirst } from "@/lib/diy/plan/why-first";

import { Chip } from "./PlanCard";
import PlanStyle from "./PlanStyle";
import { BUTTON, DARK, H2, LINK, OFF, SECTION, SEVERITY_CHIP, SMALL } from "./styles";

/**
 * This week (13 Oct 2026, DIY P3; spec 10 sections 4.1 row 6, 4.6 and 6.1):
 * the up-to-three items pinned to this Monday, plus any Blocking item new
 * since, pinned at the top of Actions and mounted on the Overview by the
 * shell (P5). Each card: the severity, a verb-first title, one "why" line
 * with its counts, the grade chip, our effort, the one button that does the
 * job, and - on a suggestion - Start and Not now, posted to the plan route.
 * Footer: "1 of 3 done this week · All 12 open items". Each card carries
 * `data-plan-kind` for the gating census (spec 6.10 item 2), as PlanCard's
 * article does.
 *
 * On the Overview (`back="overview"`) the route answers `?plan=<code>`, and
 * the Overview passes transitions.ts overviewPlanToast(code) as `toast`.
 */
export default function ThisWeek({
  items,
  counts,
  slug,
  canWrite,
  reason,
  back = "plan",
  keep = {},
  empty,
  toast = null,
  heading = "This week",
  tally = true,
}: {
  /** The footer's "1 of 3 done this week": off where the cards are not this week's pins (day 0). */
  tally?: boolean;
  /**
   * The heading. 13 Oct 2026, DIY P9 (spec 10 section 4.1, day 0): before a client's first check the Overview draws
   * the same cards as "3 things you can do before your first check", from the open Blocking and Tidy-up items.
   */
  heading?: string;
  /** thisWeek(items, today): already cut to this week and ordered. */
  items: readonly PlanItem[];
  counts: { done: number; of: number; open: number };
  slug: string;
  canWrite: boolean;
  reason: string;
  /** Where the forms return: Actions, or the Overview. */
  back?: "plan" | "overview";
  keep?: PlanKeep;
  /** The empty state's words; the page's own when unsaid. */
  empty?: string;
  /** A toast for the Overview's way back (`?plan=`), already in words. */
  toast?: string | null;
}) {
  // Each card's buttons are described by its title, so "Start" is never one of several unnamed (review, 13 Oct 2026).
  const off = (title: string) => (canWrite ? { "aria-describedby": title } : { disabled: true, "aria-describedby": `${title} wk-ro` });
  const offStyle = canWrite ? {} : OFF;
  const at = back === "overview" ? { back } : { ...keep, at: "week" as const };
  return (
    <section id="this-week" aria-labelledby="wk-h" style={{ ...SECTION, scrollMarginTop: "16px" }}>
      <PlanStyle />
      <h2 id="wk-h" style={H2}>
        {heading}
      </h2>
      {toast ? (
        <p role="status" style={{ margin: 0, padding: "10px 14px", borderRadius: "12px", background: T.ink, color: T.surface, fontSize: "14px" }}>
          {toast}
        </p>
      ) : null}
      {items.length === 0 ? (
        <p style={SMALL}>{empty ?? "Nothing is pinned for this week yet. Each Monday, up to three of your suggestions are picked here."}</p>
      ) : (
        <ol className="plan-week" style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "12px" }}>
          {items.map((item) => {
            const chip = itemChip(item);
            const lead = whyFirst(item.severity);
            const fact = item.why[0];
            // A done item past the list's five newest is drawn only under status=done (review, 13 Oct 2026: itemPath).
            const act = item.href ? clientHref(slug, item.href) : itemPath(slug, item);
            const label = item.href ? actLabel(item.kind) : "Open in Actions";
            const title = `wk-${item.id}-t`;
            return (
              <li key={item.id} data-plan-kind={item.kind} style={{ border: `1px solid ${T.line}`, borderRadius: "14px", padding: "14px", display: "flex", flexDirection: "column", gap: "8px", minWidth: 0, background: T.surface }}>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", alignItems: "flex-start" }}>
                  <span style={SEVERITY_CHIP[item.severity]}>{SEVERITY_LABEL[item.severity]}</span>
                  {item.newSinceMonday ? <span style={{ ...SEVERITY_CHIP.blocking }}>New since Monday</span> : null}
                  {item.status !== "suggested" ? <span style={{ ...SEVERITY_CHIP.own }}>{STATUS_LABEL[item.status]}</span> : null}
                  {chip ? <Chip chip={chip} id={`w-${item.id}-src`} /> : null}
                </div>
                <h3 id={title} style={{ margin: 0, fontSize: "15px", fontWeight: 650, lineHeight: 1.35, color: T.ink, overflowWrap: "anywhere" }}>
                  {clip(item.title, TITLE_COPY)}
                </h3>
                {fact ? (
                  <p style={{ ...SMALL, color: T.ink, overflowWrap: "anywhere" }}>
                    {fact.text}
                    {fact.href ? (
                      <>
                        {" "}
                        <Link href={clientHref(slug, fact.href)} style={LINK}>
                          See the evidence
                        </Link>
                      </>
                    ) : null}
                  </p>
                ) : null}
                {lead ? <p style={SMALL}>{lead.text}</p> : null}
                {item.effort ? <p style={SMALL}>{`Effort: ${EFFORT_LABEL[item.effort]} (our estimate)`}</p> : null}
                <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center", marginTop: "auto" }}>
                  <Link href={act} style={{ ...DARK, display: "inline-flex", alignItems: "center", textDecoration: "none" }}>
                    {label}
                  </Link>
                  {item.status === "suggested" ? (
                    <form method="post" action={planAction(slug, { ...at, id: item.id })} style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                      <button type="submit" name="do" value="start" style={{ ...BUTTON, ...offStyle }} {...off(title)}>
                        Start
                      </button>
                      <button type="submit" name="do" value="later" style={{ ...BUTTON, ...offStyle }} {...off(title)}>
                        Not now
                      </button>
                    </form>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {canWrite ? null : (
        <p id="wk-ro" style={SMALL}>
          {reason}
        </p>
      )}
      {items.length || counts.open ? (
        <p style={SMALL}>
          {items.length && tally ? `${counts.done} of ${counts.of} done this week · ` : ""}
          <Link href={planPath(slug, { view: "list" })} style={LINK}>
            {`All ${counts.open} open ${counts.open === 1 ? "item" : "items"}`}
          </Link>
        </p>
      ) : null}
    </section>
  );
}
