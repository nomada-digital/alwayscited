import { addDays, type Day } from "../../tracking/figures.ts";

/**
 * The swap picker's list (13 Oct 2026, DIY P2 rules; P7's detail page draws
 * it at `?swap=1`; spec 10 section 6.7, opportunity prompts step 4). Pure.
 *
 * When a pursued page's cluster has no free angle slot, the picker lists the
 * cluster's live angle prompts, each with "named in n of m answers (28 days)".
 * m counts answers that came back; an engine that returned none is left out
 * of it, as everywhere (spec 2.6 rule 5). Placement prompts are never offered:
 * they are not in an angle slot.
 *
 * One is suggested: a prompt named in no answer in the 28 days and not added
 * in them, oldest first (by added_on, then by angle order). None is suggested
 * when every prompt named the client, or is too new to judge.
 */

export const SWAP_DAYS = 28;

export type SwapPrompt = { id: string; text: string; angle: string | null; added_on: Day; stopped_on?: Day | null; placement?: boolean };
export type SwapAnswer = { question_id: string; run_date: Day; answered: boolean; named: boolean };
export type SwapCandidate = { id: string; text: string; angle: string | null; named: number; of: number; suggested: boolean; line: string };

/** "named in 0 of 56 answers (28 days)", or "no answers in 28 days" when none came back. */
export function namedLine(named: number, of: number): string {
  return of ? `named in ${named} of ${of} answer${of === 1 ? "" : "s"} (${SWAP_DAYS} days)` : `no answers in ${SWAP_DAYS} days`;
}

/**
 * The cluster's live angle prompts, in their own order, each with its count and
 * at most one marked suggested. `answers28d` may hold more than the 28 days and
 * other prompts' rows: both are cut here, to the 28 days ending `today`.
 */
export function swapCandidates(clusterPrompts: readonly SwapPrompt[], answers28d: readonly SwapAnswer[], opts: { today: Day }): SwapCandidate[] {
  const from = addDays(opts.today, -(SWAP_DAYS - 1));
  const live = clusterPrompts.filter((p) => !p.placement && (p.stopped_on ?? null) === null);
  const ids = new Set(live.map((p) => p.id));
  const tally = new Map<string, { named: number; of: number }>();
  for (const a of answers28d) {
    if (!ids.has(a.question_id) || !a.answered || a.run_date < from || a.run_date > opts.today) continue;
    const t = tally.get(a.question_id) ?? { named: 0, of: 0 };
    t.of++;
    if (a.named) t.named++;
    tally.set(a.question_id, t);
  }
  const rows = live.map((p, i) => ({ p, i, t: tally.get(p.id) ?? { named: 0, of: 0 } }));
  const pick = rows
    .filter(({ p, t }) => t.named === 0 && p.added_on < from)
    .sort((a, b) => a.p.added_on.localeCompare(b.p.added_on) || a.i - b.i)[0]?.p.id;
  return rows.map(({ p, t }) => ({ id: p.id, text: p.text, angle: p.angle, named: t.named, of: t.of, suggested: p.id === pick, line: namedLine(t.named, t.of) }));
}
