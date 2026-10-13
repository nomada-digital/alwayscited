import { type Day, addDays } from "../../tracking/figures.ts";
import type { PlanItem } from "./types.ts";
import { TOO_EARLY_DAYS } from "./readout.ts";

/**
 * The Overview's work log (13 Oct 2026, DIY P3; spec 10 section 4.1 row 10):
 * the last 30 days of work in one strip, newest first - Actions items done,
 * placements gone live, prompts added (with where they came from) and wins a
 * re-read verified. Anything under 21 days old says it is too early to read.
 * Pure; P5 mounts `<WorkLog>` with these entries, and passes the prompts from
 * P2's loadPromptOrigins.
 */

export const LOG_DAYS = 30;

export type LogEntry = {
  day: Day;
  kind: "done" | "placement" | "prompt" | "verified";
  /** The entry's words, without its date. */
  text: string;
  /** Under 21 days old. */
  early: boolean;
};

const DAY_MS = 86_400_000;
const age = (d: Day, today: Day) => Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${d}T00:00:00Z`)) / DAY_MS);

export function workLog(input: {
  today: Day;
  items: readonly Pick<PlanItem, "title" | "status" | "doneOn" | "verified">[];
  placements: readonly { url_key: string; status: string; live_on: Day | null }[];
  /** Prompts added, with their origin's label ("Placement", "Opportunity"...). */
  prompts?: readonly { day: Day; text: string; origin: string }[];
}): LogEntry[] {
  const from = addDays(input.today, -(LOG_DAYS - 1));
  const inWindow = (d: Day | null | undefined): d is Day => !!d && d >= from && d <= input.today;
  const out: LogEntry[] = [];
  const add = (day: Day, kind: LogEntry["kind"], text: string) => out.push({ day, kind, text, early: age(day, input.today) < TOO_EARLY_DAYS });
  for (const i of input.items) {
    if (i.status === "done" && inWindow(i.doneOn)) add(i.doneOn, "done", `Done: ${i.title}`);
    if (i.status === "done" && i.verified && inWindow(i.verified.at)) add(i.verified.at, "verified", i.verified.text);
  }
  for (const p of input.placements) if (p.status === "live" && inWindow(p.live_on)) add(p.live_on, "placement", `Placement live: ${p.url_key}`);
  for (const p of input.prompts ?? []) if (inWindow(p.day)) add(p.day, "prompt", `Prompt added (${p.origin}): ${p.text}`);
  const rank: Record<LogEntry["kind"], number> = { verified: 0, done: 1, placement: 2, prompt: 3 };
  return out.sort((a, b) => b.day.localeCompare(a.day) || rank[a.kind] - rank[b.kind] || a.text.localeCompare(b.text));
}
