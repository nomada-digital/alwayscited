import { CHIP } from "@/components/app/plan/styles";
import { T } from "@/config/tokens";
import { SOURCES } from "@/lib/diy/core/core.sources";
import { type AdviceLine, type GradeChip, gradeChip } from "@/lib/diy/core/evidence";

/**
 * One graded line of advice (13 Oct 2026, DIY P7; spec 10 section 2.6): its
 * words and its evidence chip, the chip's source and date on hover and focus
 * and always on a phone. A line that may not render - no grade, or a
 * documented line whose source is not verified and dated - draws nothing
 * (evidence.ts gradeChip answers null), which advice-grades.test.mts also
 * holds at build time.
 */

export function Chip({ chip, id }: { chip: GradeChip; id: string }) {
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "flex-start", gap: "2px", minWidth: 0 }}>
      <span className="opp-chip" tabIndex={chip.note ? 0 : undefined} title={chip.note ?? undefined} aria-describedby={chip.note ? id : undefined} style={{ ...CHIP, border: `1px solid ${T.line}`, background: T.surface, color: T.ink }}>
        {chip.label}
      </span>
      {chip.note ? (
        <span id={id} className="opp-chip-note" style={{ fontSize: "12px", lineHeight: 1.4, color: T.soft }}>
          {chip.note}
        </span>
      ) : null}
    </span>
  );
}

/** The chip for a line, from the register; null when the line may not render. */
export const chipFor = (line: Pick<AdviceLine, "grade" | "sourceId">): GradeChip | null => gradeChip(line, SOURCES);

/** A line and its chip, as a list item or a paragraph. Nothing when the line may not render. */
export default function Advice({ line, as = "p", lead }: { line: AdviceLine; as?: "p" | "li"; lead?: string }) {
  const chip = chipFor(line);
  if (!chip) return null;
  if (as === "li")
    return (
      <li style={{ margin: "0 0 8px", fontSize: "14px", lineHeight: 1.5, color: T.ink }}>
        <span style={{ marginRight: "10px" }}>{line.text}</span>
        <Chip chip={chip} id={`adv-${line.id}`} />
      </li>
    );
  return (
    <p style={{ margin: 0, display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: "6px 10px", fontSize: "14px", lineHeight: 1.5, color: T.ink }}>
      <span style={{ minWidth: 0, flex: "1 1 240px" }}>
        {lead ? <strong style={{ fontWeight: 650 }}>{lead} </strong> : null}
        {line.text}
      </span>
      <Chip chip={chip} id={`adv-${line.id}`} />
    </p>
  );
}
