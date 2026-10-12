import { type Day, type SerpRow, addDays, formatDay } from "../../tracking/figures.ts";
import type { PlanItem } from "./types.ts";
import { listWords, positionWords } from "./words.ts";

/**
 * What happened after a Done item (13 Oct 2026, DIY P3; spec 10 sections 4.6
 * and 6.9). Pure. Counts in two stated windows and two dated positions, with
 * every denominator said, and no derived figure, no adjective and no causal
 * word: the readout says what was read, not why.
 *
 * > Done 3 Nov. 'invoicing software': 14th on 3 Nov, 9th on 12 Dec. Its
 * > prompts named you in 6 of 112 answers in the 7 checks before 3 Nov, and
 * > 19 of 112 in the last 7 checks, same prompts. Other work on this cluster
 * > since: 1 placement live 12 Nov.
 *
 * - A check is a day on which any of the client's prompts was answered.
 * - The windows are the 7 checks before `done_on` and the latest 7 checks.
 *   Each count is over the answers actually read in its window: a missing
 *   read lowers the denominator and never counts as a miss (section 2.6
 *   rules 1 and 5).
 * - "Same prompts": only the cluster's prompts answered in both windows are
 *   counted, so a prompt added since is compared from its first reading
 *   (rule 3) by being left out of both.
 * - The Google line is the reading on `done_on` and the latest reading. A
 *   day the keyword was not read says "not measured that day"; one read and
 *   outside the top 20 says so (rule 2).
 * - Under 21 days it is too early to read (rule 9).
 * - Other work on the same cluster since `done_on` is listed with it, as
 *   sharing one movement (rule 8).
 */

/** Anything done under this many days ago is too early to read. */
export const TOO_EARLY_DAYS = 21;
/** Checks in each window. */
export const WINDOW_CHECKS = 7;

const DAY_MS = 86_400_000;
const daysBetween = (a: Day, b: Day) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);

export type ReadoutData = {
  today: Day;
  /** Every cluster with its keyword id. */
  clusters: readonly { id: string; keyword_id: string | null }[];
  keywords: readonly { id: string; keyword: string }[];
  /** The prompts and their clusters. */
  prompts: readonly { id: string; cluster_id: string | null }[];
  /** Verdicts only: the readout reads no brand and no citation. */
  answers: readonly { run_date: Day; question_id: string; answered: boolean; named: boolean }[];
  serp: readonly SerpRow[];
  /** Placements, for other work on the cluster. */
  placements: readonly { cluster_id: string; status: string; live_on: Day | null }[];
  /** Every Plan item, for other work on the cluster. */
  items: readonly Pick<PlanItem, "id" | "clusterId" | "status" | "doneOn">[];
};

export type Readout = { kind: "early"; daysLeft: number; text: string } | { kind: "read"; text: string };

/** The readout of one done item, or null when it is not done. */
export function readout(item: Pick<PlanItem, "id" | "status" | "doneOn" | "clusterId">, data: ReadoutData): Readout | null {
  if (item.status !== "done" || !item.doneOn) return null;
  const done = item.doneOn;
  const age = daysBetween(done, data.today);
  if (age < TOO_EARLY_DAYS) {
    const daysLeft = TOO_EARLY_DAYS - age;
    return { kind: "early", daysLeft, text: `Too early to read: ${daysLeft} ${daysLeft === 1 ? "day" : "days"} to go` };
  }
  const parts = [`Done ${formatDay(done)}.`];
  const cluster = item.clusterId ? data.clusters.find((c) => c.id === item.clusterId) : undefined;
  if (cluster) {
    const google = googleLine(cluster.keyword_id, done, data);
    if (google) parts.push(google);
    const prompts = promptsLine(cluster.id, done, data);
    if (prompts) parts.push(prompts);
    const other = otherWork(item, cluster.id, done, data);
    if (other) parts.push(other);
  }
  return { kind: "read", text: parts.join(" ") };
}

/** "'invoicing software': 14th on 3 Nov, 9th on 12 Dec." or null with no keyword or no reading at all. */
export function googleLine(keywordId: string | null, done: Day, data: Pick<ReadoutData, "keywords" | "serp" | "today">): string | null {
  const kw = keywordId ? data.keywords.find((k) => k.id === keywordId) : undefined;
  if (!kw) return null;
  const rows = data.serp.filter((r) => r.keyword_id === kw.id && r.run_date <= data.today);
  if (!rows.length) return null;
  const on = rows.find((r) => r.run_date === done);
  const latest = rows.reduce((a, b) => (b.run_date > a.run_date ? b : a));
  // The line follows "Done 3 Nov.", so "that day" is the day it was done.
  const then = on ? `${positionWords(on.position)} on ${formatDay(done)}` : "not measured that day";
  if (latest.run_date <= done) return `'${kw.keyword}': ${then}.`;
  return `'${kw.keyword}': ${then}, ${positionWords(latest.position)} on ${formatDay(latest.run_date)}.`;
}

/** The two windows' counts, over the cluster's prompts answered in both, or null when there is nothing to compare. */
export function promptsLine(clusterId: string, done: Day, data: Pick<ReadoutData, "prompts" | "answers" | "today">): string | null {
  const checks = [...new Set(data.answers.filter((a) => a.answered && a.run_date <= data.today).map((a) => a.run_date))].sort();
  const before = checks.filter((d) => d < done).slice(-WINDOW_CHECKS);
  const latest = checks.slice(-WINDOW_CHECKS);
  if (!before.length || !latest.length) return null;
  const ids = new Set(data.prompts.filter((p) => p.cluster_id === clusterId).map((p) => p.id));
  const inWindow = (days: readonly Day[]) => {
    const set = new Set(days);
    return data.answers.filter((a) => a.answered && ids.has(a.question_id) && set.has(a.run_date));
  };
  const a = inWindow(before);
  const b = inWindow(latest);
  const same = new Set(a.map((x) => x.question_id).filter((id) => b.some((y) => y.question_id === id)));
  if (!same.size) return null;
  const count = (rows: typeof a) => {
    const kept = rows.filter((r) => same.has(r.question_id));
    return { n: kept.filter((r) => r.named).length, m: kept.length };
  };
  const x = count(a);
  const y = count(b);
  const checksSaid = (n: number) => (n === 1 ? "check" : `${n} checks`);
  const answersSaid = (m: number) => (m === 1 ? "answer" : "answers");
  return `Its prompts named you in ${x.n} of ${x.m} ${answersSaid(x.m)} in the ${checksSaid(before.length)} before ${formatDay(done)}, and ${y.n} of ${y.m} in the last ${checksSaid(latest.length)}, same prompts.`;
}

/** "Other work on this cluster since: 1 placement live 12 Nov." or null. */
export function otherWork(item: Pick<PlanItem, "id">, clusterId: string, done: Day, data: Pick<ReadoutData, "items" | "placements" | "today">): string | null {
  const doneDays = data.items
    .filter((i) => i.id !== item.id && i.clusterId === clusterId && i.status === "done" && i.doneOn && i.doneOn > done && i.doneOn <= data.today)
    .map((i) => i.doneOn!)
    .sort();
  const liveDays = data.placements
    .filter((p) => p.cluster_id === clusterId && p.status === "live" && p.live_on && p.live_on > done && p.live_on <= data.today)
    .map((p) => p.live_on!)
    .sort();
  const said: string[] = [];
  const dates = (days: Day[]) => (days.length > 3 ? `from ${formatDay(days[0]!)}` : listWords(days.map((d) => formatDay(d))));
  if (doneDays.length) said.push(`${doneDays.length} other ${doneDays.length === 1 ? "action" : "actions"} done ${dates(doneDays)}`);
  if (liveDays.length) said.push(`${liveDays.length} ${liveDays.length === 1 ? "placement" : "placements"} live ${dates(liveDays)}`);
  return said.length ? `Other work on this cluster since: ${listWords(said)}.` : null;
}

/** The range of tracking data the readouts on a page need: from the earliest window's start to today, or null when nothing is old enough to read. */
export function readoutRange(items: readonly Pick<PlanItem, "status" | "doneOn">[], today: Day, startedOn: Day | null): { from: Day; to: Day } | null {
  const done = items.filter((i) => i.status === "done" && i.doneOn && daysBetween(i.doneOn, today) >= TOO_EARLY_DAYS).map((i) => i.doneOn!);
  if (!done.length) return null;
  // Room for 7 checks before the earliest, with days that went unread.
  let from = addDays(done.sort()[0]!, -(WINDOW_CHECKS * 3));
  if (startedOn && from < startedOn) from = startedOn;
  return { from, to: today };
}
