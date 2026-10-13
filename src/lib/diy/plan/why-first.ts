import { SOURCES } from "../core/core.sources.ts";
import { type AdviceLine, type GradeChip, type Source, gradeChip } from "../core/evidence.ts";
import type { Grade } from "../core/evidence.ts";
import type { ItemSeverity, PlanItem } from "./types.ts";
import { ADVICE } from "./why-first.advice.ts";

/**
 * The "Why this is first" line for a card, and the card's own grade chip
 * (13 Oct 2026, DIY P3; spec 10 sections 2.6 and 6.1). Pure.
 *
 * A line or a chip that fails the register's rules does not render
 * (evidence.ts gradeChip answers null): a documented line whose source is not
 * verified, or one that cites an internal source, is left off rather than
 * shown with a weaker grade. A member's own task has neither.
 */

export type FirstLine = { text: string; chip: GradeChip };

/** The register the Plan reads: P1's seed. A package's own `*.sources.ts` joins it when one is written. */
export const REGISTER: readonly Source[] = SOURCES;

const BY_SEVERITY: Partial<Record<ItemSeverity, AdviceLine>> = Object.fromEntries(ADVICE.map((l) => [l.id.replace(/^plan\.first\./, ""), l]));

/** The fixed line for a severity, with its chip, or null (a task, or a line that may not render). */
export function whyFirst(severity: ItemSeverity, register: readonly Source[] = REGISTER): FirstLine | null {
  const line = BY_SEVERITY[severity];
  if (!line) return null;
  const chip = gradeChip(line, register);
  return chip ? { text: line.text, chip } : null;
}

/** The card's grade chip, from the item's own grade and source; null for a task or a grade that may not render. */
export function itemChip(item: Pick<PlanItem, "grade" | "sourceId">, register: readonly Source[] = REGISTER): GradeChip | null {
  if (!item.grade) return null;
  return gradeChip({ grade: item.grade as Grade, ...(item.sourceId ? { sourceId: item.sourceId } : {}) }, register);
}
