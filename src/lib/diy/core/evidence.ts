import { formatDate } from "../../format-date.ts";

/**
 * How a DIY claim stays true (13 Oct 2026, DIY P1 milestone M1; spec 10
 * sections 2.6 and 6.10). Pure.
 *
 * Every piece of advice carries one evidence grade, and a grade that leans on
 * a document names a source in the register (`*.sources.ts` files under
 * src/lib/diy, P1's first being core.sources.ts). An advice line that fails
 * any rule here does not render: `adviceProblem` says why, `gradeChip`
 * answers null, and advice-grades.test.mts (the rest of P1) fails the build
 * on every `*.advice.ts` line that would.
 *
 * Data is labelled by origin three ways - read by us, a vendor estimate,
 * written by a model - and the labels are here so no page types its own.
 */

/** The four grades, strongest first. Stored as plan_items.grade. */
export const GRADES = ["documented", "tested", "your_data", "practice"] as const;
export type Grade = (typeof GRADES)[number];

/** What each grade means, as the spec's grade table says it. Never rendered as a claim; it is the rule each label stands for. */
export const GRADE_MEANS: Record<Grade, string> = {
  documented: "the engine's owner says so in a dated document",
  tested: "a named, dated controlled study",
  your_data: "our own checks for this client",
  practice: "what agencies do; no outcome promised",
};

/** Grades that must name a verified, dated, rendered source. */
export const SOURCED: readonly Grade[] = ["documented", "tested"];

/**
 * One entry of the evidence register (spec 6.10 item 1). `internal` is design
 * rationale: no advice line may cite it and nothing renders it. `verified` is
 * true only once someone has read the page and dated it in `read`.
 */
export type Source = {
  id: string;
  title: string;
  /** Who published it, as the chip names them: "Google" makes "Google documents this". */
  publisher: string;
  url: string;
  /** The page's own updated date, YYYY-MM-DD; null when it states none or was not read. */
  updated: string | null;
  /** The day we read it, YYYY-MM-DD; null until someone has. */
  read: string | null;
  verified: boolean;
  internal: boolean;
  note: string;
};

/** One advice line as an `*.advice.ts` file declares it. */
export type AdviceLine = { id: string; text: string; grade: Grade; sourceId?: string };

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const isDay = (v: string | null): v is string => v !== null && DAY.test(v) && formatDate(v) !== v;

/** The register entry with this id, or null. */
export function sourceById(id: string, register: readonly Source[]): Source | null {
  return register.find((s) => s.id === id) ?? null;
}

/** What is wrong with one register entry, one line each; empty when nothing is. */
export function sourceProblems(s: Source): string[] {
  const out: string[] = [];
  if (!/^[A-Z][A-Z0-9-]{0,15}$/.test(s.id)) out.push(`${s.id}: not a source id`);
  if (!s.title.trim() || !s.publisher.trim() || !s.note.trim()) out.push(`${s.id}: title, publisher and note are all needed`);
  if (s.verified && !isDay(s.read)) out.push(`${s.id}: verified with no read date`);
  if (!s.internal && !/^https:\/\//.test(s.url)) out.push(`${s.id}: a rendered source needs an https URL`);
  return out;
}

/**
 * Why one advice line must not render, or null when it may. The rules, in
 * order:
 *
 * 1. it has a grade, and the grade is one of the four;
 * 2. a `documented` or `tested` line names a source that exists, has both
 *    dates, is verified and is not internal;
 * 3. no line cites an internal source, whatever its grade;
 * 4. a cited source of any grade exists.
 */
export function adviceProblem(line: Pick<AdviceLine, "grade" | "sourceId"> & { id?: string }, register: readonly Source[]): string | null {
  const who = line.id ? `${line.id}: ` : "";
  if (!line.grade || !(GRADES as readonly string[]).includes(line.grade)) return `${who}no evidence grade`;
  const source = line.sourceId ? sourceById(line.sourceId, register) : null;
  if (line.sourceId && !source) return `${who}cites ${line.sourceId}, which is not in the register`;
  if (source?.internal) return `${who}cites ${source.id}, an internal source`;
  if (!SOURCED.includes(line.grade)) return null;
  if (!source) return `${who}a ${line.grade} line needs a source`;
  if (!source.verified) return `${who}${source.id} is not verified yet`;
  if (!isDay(source.updated) || !isDay(source.read)) return `${who}${source.id} needs its updated and read dates`;
  return null;
}

export type GradeChip = {
  grade: Grade;
  /** The chip's words. */
  label: string;
  /**
   * Its source and date, shown on hover or focus, and under the card on
   * phone. Null for a grade with no document: a "Seen in your data" card
   * carries its own evidence link to the answers or reads instead.
   */
  note: string | null;
};

/**
 * The chip for one advice line, or null when the line must not render
 * (`adviceProblem`). A documented line's label names its publisher: "Google
 * documents this".
 */
export function gradeChip(line: Pick<AdviceLine, "grade" | "sourceId">, register: readonly Source[]): GradeChip | null {
  if (adviceProblem(line, register) !== null) return null;
  const source = line.sourceId ? sourceById(line.sourceId, register) : null;
  const note = source && isDay(source.updated) ? `${source.publisher}, ${source.title}, updated ${formatDate(source.updated)}` : null;
  switch (line.grade) {
    case "documented":
      return { grade: line.grade, label: `${source!.publisher} documents this`, note };
    case "tested":
      return { grade: line.grade, label: "Tested", note };
    case "your_data":
      return { grade: line.grade, label: "Seen in your data", note: null };
    case "practice":
      return { grade: line.grade, label: "Common practice", note: null };
  }
}

/** Read by us: an own fetch, an answer, a position. The day only; a time of day goes through check-time.ts. */
export function checkedLabel(day: string): string {
  return `Checked ${formatDate(day)}`;
}

/** A vendor estimate, always with its read date: an unchanged date means it did not re-run. */
export function vendorLabel(readOn: string): string {
  return `DataForSEO estimate, read ${formatDate(readOn)}`;
}

/** DataForSEO's rank, the one place it shows: never as a score. */
export function vendorRankLabel(readOn: string): string {
  return `DataForSEO estimate, 0-1000, read ${formatDate(readOn)}`;
}

/** Page and domain types a model wrote. */
export const CLASSIFIED_LABEL = "classified automatically";

/** A drafted example's line, on every one. */
export function exampleLabel(day: string): string {
  return `Example written from your page on ${formatDate(day)}. Check every fact before you publish. Nothing is published for you.`;
}
