import { SOURCES as CORE_SOURCES } from "../core/core.sources.ts";
import { type GradeChip, type Source, adviceProblem, gradeChip } from "../core/evidence.ts";
import { ADVICE } from "./schema.advice.ts";
import { SOURCES as PAGE_SOURCES } from "./pages.sources.ts";

/**
 * How Your pages draws an advice line (13 Oct 2026, DIY P8): the line's
 * fixed words from schema.advice.ts with its blanks filled, and its grade
 * chip from the register (P1's core sources and this package's). A line
 * that fails the register's rules draws nothing: `advice` answers null, as
 * evidence.ts gradeChip does, so an unverified source can never put a claim
 * on the page.
 */

export const REGISTER: readonly Source[] = [...CORE_SOURCES, ...PAGE_SOURCES];

export type AdviceId = (typeof ADVICE)[number]["id"];

export type Said = { id: string; text: string; chip: GradeChip };

/** Fill `{name}` blanks; a blank with no value is left out with its braces, never drawn as "undefined". */
export function fill(text: string, vars: Record<string, string | number> = {}): string {
  return text.replace(/\{(\w+)\}/g, (_, k: string) => (vars[k] === undefined ? "" : String(vars[k]))).replace(/\s+([.,;:])/g, "$1").replace(/\s{2,}/g, " ").trim();
}

/** One advice line, filled, with its chip; null when it must not render. */
export function advice(id: AdviceId, vars: Record<string, string | number> = {}): Said | null {
  const line = ADVICE.find((l) => l.id === id);
  if (!line) return null;
  if (adviceProblem(line, REGISTER) !== null) return null;
  const chip = gradeChip(line, REGISTER);
  return chip ? { id, text: fill(line.text, vars), chip } : null;
}

/** Whether a register source may back a line that renders: verified, dated, not internal. */
export function sourceRenders(id: string): boolean {
  return adviceProblem({ grade: "documented", sourceId: id }, REGISTER) === null;
}
