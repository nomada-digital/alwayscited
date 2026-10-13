import Link from "@/components/app/AppLink";
import { APP_LIMITS } from "@/config/contact";
import { T } from "@/config/tokens";
import type { GradeChip } from "@/lib/diy/core/evidence";
import { clientHref, planAction, type PlanKeep } from "@/lib/diy/plan/paths";
import type { Readout } from "@/lib/diy/plan/readout";
import { type Member, noteLines, ownerName } from "@/lib/diy/plan/card";
import { movesFrom } from "@/lib/diy/plan/transitions";
import { ASKS_CHANGED, CHANGED, CHANGED_LABEL, EFFORT_LABEL, type PlanItem, SEVERITY_LABEL, STATUS_LABEL, TITLE_COPY, actLabel, clip } from "@/lib/diy/plan/types";
import { itemChip, whyFirst } from "@/lib/diy/plan/why-first";
import { formatDay } from "@/lib/tracking/figures";

import { BUTTON, CHIP, DARK, FIELD, LABEL, LINK, OFF, SEVERITY_CHIP, SMALL } from "./styles";

/**
 * One Actions item (13 Oct 2026, DIY P3; spec 10 section 4.6, the card
 * anatomy used everywhere items appear): severity, a verb-first title, the
 * cluster, 1-3 facts with their evidence links, the grade, our effort
 * estimate, where to act, the owner, the note, and - once done - what was
 * verified and the readout. Server drawn: every control is a plain form
 * posted to the plan route, so it all works with JS off.
 *
 * A viewer, or anyone on an ended client, sees the controls disabled with
 * the reason (`reason`). The grade chip's source and date show on hover and
 * focus, and as text under the card on a phone. Every control is described
 * by the card's title, so a list of buttons says which card each is on
 * (review, 13 Oct 2026); a disabled one by the reason as well.
 *
 * The article carries `data-plan-kind`, which the gating census reads to
 * hold opportunity and link cards to the price rule (spec 6.10 item 2).
 */

export type { Member };

export function Chip({ chip, id }: { chip: GradeChip; id: string }) {
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "flex-start", gap: "2px", minWidth: 0 }}>
      <span className="plan-chip" tabIndex={chip.note ? 0 : undefined} title={chip.note ?? undefined} style={{ ...CHIP, border: `1px solid ${T.line}`, background: T.surface, color: T.ink }} aria-describedby={chip.note ? id : undefined}>
        {chip.label}
      </span>
      {chip.note ? (
        <span id={id} className="plan-chip-note" style={{ fontSize: "12px", lineHeight: 1.4, color: T.soft }}>
          {chip.note}
        </span>
      ) : null}
    </span>
  );
}

/** The verified line, or for a done item nothing verified, "Marked done by you." (spec 6.9: never "Verified" without a re-read). */
export function verifiedLine(item: Pick<PlanItem, "status" | "verified">): string | null {
  if (item.status !== "done") return null;
  return item.verified ? item.verified.text : "Marked done by you.";
}

export default function PlanCard({
  item,
  slug,
  keep,
  canWrite,
  reason,
  members,
  viewer,
  clusterName,
  readout,
  first = false,
  monday,
}: {
  item: PlanItem;
  slug: string;
  /** The page state the forms return to. */
  keep: PlanKeep;
  canWrite: boolean;
  /** Why the controls are off: the viewer line, or the ended client's. */
  reason: string;
  /** The live team, for the owner select and names; null when it could not be read. */
  members: readonly Member[] | null;
  viewer: string;
  clusterName: string | null;
  /** The readout, or the section error when its readings could not be read. */
  readout: Readout | { kind: "error"; text: string } | null;
  /** Show "Why this is first" (suggestions). */
  first?: boolean;
  /** This week's Monday (UTC): "New since Monday" is drawn only on an item pinned to it. */
  monday: string;
}) {
  const uid = `p-${item.id}`;
  const chip = itemChip(item);
  const lead = first ? whyFirst(item.severity) : null;
  const action = planAction(slug, { ...keep, id: item.id });
  const off = canWrite ? { "aria-describedby": `${uid}-t` } : { disabled: true, "aria-describedby": `${uid}-t ${uid}-ro` };
  const offStyle = canWrite ? {} : OFF;
  const verified = verifiedLine(item);
  const moves = movesFrom(item.status);
  const owner = ownerName(item.ownerEmail, viewer, members);
  const lines = noteLines(item);
  const fresh = item.newSinceMonday && item.weekOf === monday;

  return (
    <article id={`item-${item.id}`} aria-labelledby={`${uid}-t`} data-plan-kind={item.kind} className="plan-card" style={{ background: T.surface, border: `1px solid ${T.line}`, borderRadius: "14px", padding: "14px 16px", display: "flex", flexDirection: "column", gap: "10px", minWidth: 0, scrollMarginTop: "16px" }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", alignItems: "flex-start" }}>
        <span style={SEVERITY_CHIP[item.severity]}>{SEVERITY_LABEL[item.severity]}</span>
        {fresh ? <span style={{ ...CHIP, background: T.badBg, color: T.badFg }}>New since Monday</span> : null}
        {clusterName ? <span style={{ ...CHIP, background: T.chip, color: T.ink, whiteSpace: "normal" }}>{clusterName}</span> : null}
        {chip ? <Chip chip={chip} id={`${uid}-src`} /> : null}
      </div>
      <h3 id={`${uid}-t`} title={item.title.length > TITLE_COPY ? item.title : undefined} style={{ margin: 0, fontSize: "15px", fontWeight: 650, lineHeight: 1.35, color: T.ink, overflowWrap: "anywhere" }}>
        {clip(item.title, TITLE_COPY)}
      </h3>
      {item.why.length ? (
        <ul style={{ margin: 0, paddingLeft: "18px", display: "flex", flexDirection: "column", gap: "4px", fontSize: "13px", lineHeight: 1.5, color: T.ink }}>
          {item.why.map((f, i) => (
            <li key={i} style={{ overflowWrap: "anywhere" }}>
              {f.text}
              {f.href ? (
                <>
                  {" "}
                  <Link href={clientHref(slug, f.href)} style={LINK}>
                    See the evidence
                  </Link>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {lead ? (
        <p style={SMALL}>
          <span style={{ fontWeight: 600, color: T.ink }}>Why this is first. </span>
          {lead.text}
        </p>
      ) : null}
      <p style={{ ...SMALL, display: "flex", flexWrap: "wrap", gap: "4px 14px" }}>
        {item.effort ? <span>{`Effort: ${EFFORT_LABEL[item.effort]} (our estimate)`}</span> : null}
        {owner ? <span>{`Owner: ${owner}`}</span> : null}
        {item.status === "doing" && item.startedOn ? <span>{`Started ${formatDay(item.startedOn)}`}</span> : null}
      </p>
      {item.href ? (
        <p style={{ margin: 0, fontSize: "13px" }}>
          <Link href={clientHref(slug, item.href)} style={LINK}>
            {`${actLabel(item.kind)} →`}
          </Link>
        </p>
      ) : null}
      {lines.note ? <p style={{ ...SMALL, color: T.ink, overflowWrap: "anywhere" }}>{`Note: ${lines.note}`}</p> : null}
      {lines.stale ? <p style={SMALL}>{lines.stale}</p> : null}
      {verified ? <p style={{ ...SMALL, color: item.verified ? T.goodFg : T.soft, fontWeight: item.verified ? 600 : 400 }}>{verified}</p> : null}
      {readout ? (
        <p data-readout={readout.kind} style={{ margin: 0, fontSize: "13px", lineHeight: 1.55, color: T.ink, background: T.bg, borderRadius: "10px", padding: "10px 12px" }}>
          {readout.text}
        </p>
      ) : null}

      <div style={{ display: "flex", flexDirection: "column", gap: "8px", borderTop: `1px solid ${T.hair}`, paddingTop: "10px" }}>
        {item.status === "suggested" ? (
          <form method="post" action={action} style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
            <button type="submit" name="do" value="start" style={{ ...DARK, ...offStyle }} {...off}>
              Start
            </button>
            <button type="submit" name="do" value="accept" style={{ ...BUTTON, ...offStyle }} {...off}>
              Accept
            </button>
            <button type="submit" name="do" value="later" style={{ ...BUTTON, ...offStyle }} {...off}>
              Not now
            </button>
          </form>
        ) : moves.length ? (
          <form method="post" action={action} className="plan-move" style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: "8px" }}>
            <span style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
              <label htmlFor={`${uid}-to`} style={LABEL}>
                {item.status === "dropped" ? "Bring back to" : "Move to"}
              </label>
              <select id={`${uid}-to`} name="to" defaultValue={moves[0]} style={{ ...FIELD, ...offStyle }} {...off}>
                {moves.map((s) => (
                  <option key={s} value={s}>
                    {s === "dropped" ? "Drop" : STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
            </span>
            {ASKS_CHANGED.has(item.kind) && moves.includes("done") ? (
              <span className="plan-changed" style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                <label htmlFor={`${uid}-ch`} style={LABEL}>
                  If done: did you change the page?
                </label>
                <select id={`${uid}-ch`} name="changed" defaultValue="" style={{ ...FIELD, ...offStyle }} {...off}>
                  <option value="">No answer</option>
                  {CHANGED.map((c) => (
                    <option key={c} value={c}>
                      {CHANGED_LABEL[c]}
                    </option>
                  ))}
                </select>
              </span>
            ) : null}
            <button type="submit" name="do" value="move" style={{ ...BUTTON, ...offStyle }} {...off}>
              Save
            </button>
          </form>
        ) : null}
        {item.status !== "dropped" ? (
          <details className="plan-more">
            <summary style={{ cursor: "pointer", fontSize: "13px", fontWeight: 600, color: T.accent, minHeight: "32px", display: "flex", alignItems: "center" }}>Note and owner</summary>
            <div style={{ display: "flex", flexDirection: "column", gap: "10px", paddingTop: "8px" }}>
              <form method="post" action={action} style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: "8px" }}>
                <span style={{ display: "flex", flexDirection: "column", gap: "4px", flex: "1 1 180px", minWidth: 0 }}>
                  <label htmlFor={`${uid}-note`} style={LABEL}>
                    Note (up to {APP_LIMITS.note} characters)
                  </label>
                  <input id={`${uid}-note`} name="note" type="text" maxLength={APP_LIMITS.note} defaultValue={lines.note ?? ""} style={{ ...FIELD, width: "100%", ...offStyle }} {...off} />
                </span>
                <button type="submit" name="do" value="note" style={{ ...BUTTON, ...offStyle }} {...off}>
                  Save note
                </button>
              </form>
              {members ? (
                <form method="post" action={action} style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: "8px" }}>
                  <span style={{ display: "flex", flexDirection: "column", gap: "4px", flex: "1 1 180px", minWidth: 0 }}>
                    <label htmlFor={`${uid}-own`} style={LABEL}>
                      Owner
                    </label>
                    <select id={`${uid}-own`} name="owner" defaultValue={item.ownerEmail ?? ""} style={{ ...FIELD, width: "100%", ...offStyle }} {...off}>
                      <option value="">Nobody in particular</option>
                      {members.map((m) => (
                        <option key={m.email} value={m.email}>
                          {m.name?.trim() ? `${m.name.trim()} (${m.email})` : m.email}
                        </option>
                      ))}
                    </select>
                  </span>
                  <button type="submit" name="do" value="assign" style={{ ...BUTTON, ...offStyle }} {...off}>
                    Save owner
                  </button>
                </form>
              ) : null}
            </div>
          </details>
        ) : null}
        {canWrite ? null : (
          <p id={`${uid}-ro`} style={SMALL}>
            {reason}
          </p>
        )}
      </div>
    </article>
  );
}
