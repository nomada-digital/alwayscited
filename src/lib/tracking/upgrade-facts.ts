import type { ClusterCard } from "./cluster-figures.ts";
import type { CitationRow, Day, Range, SerpRow } from "./figures.ts";
import { FIT_READINGS, type Facts, STALLED_DAYS } from "./upgrade-prompts.ts";

/**
 * The facts the two cluster prompts are judged on (BRIEF-3 T11: "prompts that
 * never name you, and a keyword at #11-#20"), read from the cluster cards the
 * Clusters page, the overview and the one-cluster page already draw, so the
 * prompt's figures are the figures beside it. Pure and unwired, like
 * upgrade-prompts.ts.
 *
 * Only what is tracked now counts: a pending cluster has no readings, and a
 * stopped cluster or prompt is not one an upgrade would act on.
 */

const tracked = (cards: ClusterCard[]) => cards.filter((c) => c.status !== "pending" && c.stoppedOn === null);

const bare = (h: string) => h.toLowerCase().replace(/^www\./, "");

/**
 * alwaysmentioned: prompts read this period that named the client in none of
 * their answers, of every prompt read; their answers; and the two hosts the
 * engines cited most in those answers, the client's own left out.
 */
export function neverNamedFacts(p: {
  cards: ClusterCard[];
  answers: ({ question_id: string; run_date: string; answered: boolean } & Pick<CitationRow, "citations">)[];
  range: Range;
  domain: string;
}): NonNullable<Facts["neverNamed"]> {
  const prompts = tracked(p.cards).flatMap((c) => c.prompts.filter((q) => q.stoppedOn === null && q.now.den > 0));
  const never = prompts.filter((q) => q.now.num === 0);
  const ids = new Set(never.map((q) => q.id));
  const own = bare(p.domain);
  const counts = new Map<string, number>();
  for (const a of p.answers) {
    if (!a.answered || !ids.has(a.question_id) || a.run_date < p.range.from || a.run_date > p.range.to) continue;
    for (const host of new Set(a.citations.map((c) => bare(c.source_domain || "")))) {
      if (!host || host === own || host.endsWith(`.${own}`)) continue;
      counts.set(host, (counts.get(host) ?? 0) + 1);
    }
  }
  const hosts = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 2).map(([h]) => h);
  return { prompts: never.length, of: prompts.length, answers: never.reduce((n, q) => n + q.now.den, 0), hosts, ids: never.map((q) => q.id) };
}

/**
 * alwayscited: cluster keywords whose latest reading is #11 to #20, of the cluster keywords read.
 * A keyword read with no rank counts in `of`, as it does in the overview's "Cluster keywords on
 * page 1" (clusterSummary's page1), so the two say the same N (DS51, 2 Oct 2026).
 */
export function offPageOneFacts(cards: ClusterCard[]): NonNullable<Facts["offPageOne"]> {
  const read = tracked(cards).filter((c) => c.keyword !== null);
  const offCards = read.filter((c) => c.position !== null && c.position >= 11 && c.position <= 20);
  const off = offCards.map((c) => c.position as number);
  const ids = offCards.map((c) => c.keywordId).filter((id): id is string => id !== null);
  return { keywords: off.length, of: read.length, best: off.length ? Math.min(...off) : 0, worst: off.length ? Math.max(...off) : 0, ids };
}

/**
 * U6's readings (13 Oct 2026, DIY P4; spec 10 section 2.7): of a keyword's
 * last FIT_READINGS readings - days Google was read for it, whatever the
 * range - how many were #11 to #20. A day it was not read is not a reading.
 * The fit verdict itself is P8's; the page joins the two into `fit`.
 */
export function offPageOneReadings(serp: readonly SerpRow[], keywordId: string): { offPage1: number; readings: number } {
  const byDay = new Map<Day, number | null>();
  for (const s of serp) if (s.keyword_id === keywordId && !byDay.has(s.run_date)) byDay.set(s.run_date, s.position);
  const last = [...byDay].sort((a, b) => b[0].localeCompare(a[0])).slice(0, FIT_READINGS);
  return { offPage1: last.filter(([, p]) => p !== null && p >= 11 && p <= 20).length, readings: last.length };
}

/**
 * U4's facts (section 2.7): opportunity items in Doing whose status has not
 * changed for STALLED_DAYS or more, and the latest day one of them got there,
 * so "since <day>" is true of every one. The plan's own status words are P3's;
 * the page maps each item to these two flags.
 */
export function stalledFacts(items: readonly { opportunity: boolean; doing: boolean; statusAt: Day }[], today: Day): NonNullable<Facts["stalled"]> | null {
  const cutoff = new Date(Date.parse(`${today}T00:00:00Z`) - STALLED_DAYS * 86_400_000).toISOString().slice(0, 10);
  const stalled = items.filter((i) => i.opportunity && i.doing && i.statusAt <= cutoff);
  if (!stalled.length) return null;
  return { items: stalled.length, since: stalled.map((i) => i.statusAt).sort().reverse()[0]! };
}