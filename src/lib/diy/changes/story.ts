import { type ClusterCard, type ClusterInput, type ClusterSummary, clusterCards, clusterSummary } from "../../tracking/cluster-figures.ts";
import { type Day, type Range, firstCheckDay, keywordRows, keywordsIn, overview, ungroupedRead } from "../../tracking/figures.ts";
import type { Compare, OverviewData } from "../../tracking/overview-data.ts";
import { engineRates } from "../ai/engine-rates.ts";
import { type Diff, diffChecks } from "./diff.ts";
import { type Bullet, type Headline, clusterChanges, headline, whatItMeans } from "./meaning.ts";

/**
 * How the Overview feeds its rules (review of P4, 13 Oct 2026): the figures
 * the page draws (`overviewBasis`) and, from them, the headline paragraph,
 * "What it means" and "Since last check" (`overviewStory`). Pure, and the one
 * wiring: Overview.tsx calls both, and fixture-states.test.mts runs both on
 * every fixture state, so the test cannot pass on wiring the page does not
 * use.
 */

/** The rows the rules read, as the page's OverviewData holds them (its prompts are the `questions:` rows). */
type PromptRows = OverviewData extends { questions: infer Q } ? Q : never;
export type StoryData = Pick<OverviewData, "answers" | "serp" | "keywords" | "runs" | "clusters"> & { questions: PromptRows };
export type Recent = { ok: true; data: Pick<OverviewData, "answers" | "serp" | "runs"> } | { ok: false };

export type Basis = {
  o: ReturnType<typeof overview>;
  /** The cluster reading's input, or null for a client with no prompt in any cluster (the flat T4 reading). */
  clusterInput: ClusterInput | null;
  cards: ClusterCard[] | null;
  cs: ClusterSummary | null;
  /** Ungrouped prompts with readings beside the clusters (DS1 / R177). */
  loose: number;
  /** The cluster reading when every read prompt is in a cluster; else the headline counts every prompt. */
  byCluster: ClusterSummary | null;
  /** The prompts tracked from the comparison's first day to the range's last: like-for-like when not by cluster. */
  lflIds: Set<string> | null;
};

export function overviewBasis(p: { data: StoryData; range: Range; compare: Compare; startedOn: Day | null; engines: readonly string[]; today: Day }): Basis {
  const { data, range, today, engines } = p;
  const o = overview({ range, compare: p.compare, startedOn: p.startedOn, engines, questions: data.questions, answers: data.answers, serp: data.serp, keywordCount: keywordsIn(data.keywords, range), keywords: data.keywords, runs: data.runs });
  // BRIEF-3 T4b part 3: by cluster; a client with no cluster rows keeps the flat reading. `?.` for /app/parity's older fixture.
  // R138: cluster rows with no prompt in any of them are still the ungrouped state.
  const clusterInput: ClusterInput | null =
    data.clusters?.length && data.questions.some((q) => q.cluster_id)
      ? { clusters: data.clusters, questions: data.questions, keywords: data.keywords, answers: data.answers, serp: data.serp, range, before: o.compare, today, engines }
      : null;
  const cards = clusterInput ? clusterCards(clusterInput) : null;
  const cs = cards ? clusterSummary(cards) : null;
  const loose = cs ? ungroupedRead(data.questions, data.answers, range) : 0;
  const byCluster = cs && !loose ? cs : null;
  const lflIds = o.compare ? new Set(data.questions.filter((q) => q.added_on <= o.compare!.from && (q.stopped_on === null || q.stopped_on > range.to)).map((q) => q.id)) : null;
  return { o, clusterInput, cards, cs, loose, byCluster, lflIds };
}

export type Story = {
  said: Headline;
  bullets: Bullet[];
  /** None without a recent read (/app/parity); `error` when that read failed. */
  diff: Diff | { error: true } | null;
  /** The one day read, when the client's only check is in what was read. */
  firstReading: Day | null;
};

export function overviewStory(b: Basis, p: { data: StoryData; range: Range; today: Day; engines: readonly string[]; brand: string; domain: string; startedOn: Day | null; recent?: Recent }): Story {
  const { o, cards, cs, byCluster, lflIds } = b;
  const { data, range, today, engines } = p;
  // The headline paragraph: one rule over the figures the card draws, in its first-reading, compared or plain variant.
  const readDays = new Set(data.answers.filter((a) => a.answered).map((a) => a.run_date));
  const firstReading = readDays.size === 1 && !o.compare ? [...readDays][0]! : null;
  const said = headline({
    named: byCluster ? byCluster.now : o.named,
    prompts: byCluster ? byCluster.prompts : o.questions.den,
    range,
    today,
    firstReading,
    lfl: byCluster
      ? byCluster.lflBefore
        ? { now: byCluster.lfl, before: byCluster.lflBefore, basis: "clusters", count: byCluster.clustersLfl }
        : null
      : o.lfl
        ? { now: o.lfl.now, before: o.lfl.before, basis: "prompts", count: o.lfl.questions }
        : null,
    compareKind: o.compareKind,
    keywords: cs
      ? { onPage1: cs.page1.num, of: cs.page1.den, before: cs.page1Before !== null && cs.clustersLfl === cs.clusters ? cs.page1Before : null, cluster: true }
      : { onPage1: o.keywords.num, of: o.keywords.den, before: o.change?.keywords && o.change.keywords.of === o.keywords.den ? o.change.keywords.before : null, cluster: false },
  });
  // "What it means": the headline's own answers, by engine; each keyword's latest reading; each live cluster like for like.
  const latestKw = keywordRows(data.serp, range);
  const bullets = whatItMeans({
    first: firstReading !== null,
    engines: engineRates(data.answers, range, engines, byCluster ? byCluster.ids : null),
    keywords: cards
      ? cards.filter((c) => c.status !== "pending" && c.keywordId && c.keyword).map((c) => ({ id: c.keywordId!, keyword: c.keyword!, position: c.position, read: c.positionRead }))
      : data.keywords.filter((k) => k.stopped_on === null && k.added_on <= range.to).map((k) => ({ id: k.id, keyword: k.keyword, position: latestKw.get(k.id)?.position ?? null, read: latestKw.has(k.id) })),
    cluster: !!cards,
    clusters:
      o.compare && cards && lflIds
        ? clusterChanges({ clusters: cards.filter((c) => c.status === "live").map((c) => ({ id: c.id, label: c.keyword ?? c.name })), prompts: data.questions, answers: data.answers, range, compare: o.compare, lfl: lflIds })
        : null,
  });
  // "Since last check" over the last week of checks, whatever the range (section 6.8).
  const recent = p.recent;
  const diff: Story["diff"] = !recent
    ? null
    : !recent.ok
      ? { error: true }
      : diffChecks({
          today,
          firstCheck: firstCheckDay(p.startedOn, data.questions),
          answers: recent.data.answers,
          serp: recent.data.serp,
          runs: recent.data.runs,
          prompts: data.questions.map((q) => ({ id: q.id, text: q.text })),
          keywords: cards
            ? cards.filter((c) => c.keywordId && c.keyword).map((c) => ({ id: c.keywordId!, keyword: c.keyword! }))
            : data.keywords.filter((k) => k.stopped_on === null).map((k) => ({ id: k.id, keyword: k.keyword })),
          brand: p.brand,
          domain: p.domain,
          engines,
        });
  return { said, bullets, diff, firstReading };
}
