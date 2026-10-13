import { ENGINE_SPECS, isEngine } from "../../scan/engines.ts";
import { type AnswerRow, type ComparisonKind, type Day, type Range, type Rate, daysIn, formatDay, namedRate } from "../../tracking/figures.ts";
import { type EngineRate, answering, strongestEngine, weakestEngine } from "../ai/engine-rates.ts";
import { ordinal } from "./diff.ts";

/**
 * The Overview's headline paragraph and its "What it means" bullets (13 Oct
 * 2026, DIY P4; spec 10 section 4.1 rows 3 and 3b). Every sentence is a rule:
 * fixed branches over figures the page already draws (figures.ts and
 * cluster-figures.ts), passed in, so the paragraph cannot say a number the
 * figures beside it do not. "up from", "down from" or "the same as" is the
 * sign of the like-for-like change in rounded points. No causal word, no new
 * figure.
 */

const n = (x: number) => x.toLocaleString("en-GB");
const pct = (r: Rate) => (r.pct === null ? "-" : `${r.pct}%`);
const label = (e: string) => (isEngine(e) ? ENGINE_SPECS[e].label : e);
const plural = (k: number, one: string, many: string) => `${n(k)} ${k === 1 ? one : many}`;

export type HeadlineInput = {
  /** The headline's answers naming the client: the clusters with readings, or every prompt. */
  named: Rate;
  /** The prompts those answers are to. */
  prompts: number;
  range: Range;
  today: Day;
  /** The one day read, when the client's only check is in the range: the first-reading variant. */
  firstReading: Day | null;
  /** Like-for-like, as the key figures' chips read it: on the clusters (or prompts) tracked all of both periods. */
  lfl: { now: Rate; before: Rate; basis: "clusters" | "prompts"; count: number } | null;
  compareKind: ComparisonKind | null;
  /** On Google's page 1 now, of the keywords read; `before` only when it is on the same keywords. */
  keywords: { onPage1: number; of: number; before: number | null; cluster: boolean } | null;
};

export type Headline = { variant: "first" | "compared" | "plain"; text: string };

/** "in the last 28 days", or "from 2 Sep to 29 Sep" for a range that ends before today. */
export function periodWords(range: Range, today: Day): string {
  const len = daysIn(range).length;
  if (range.to === today) return len === 1 ? "today" : `in the last ${len} days`;
  return range.from === range.to ? `on ${formatDay(range.from)}` : `from ${formatDay(range.from)} to ${formatDay(range.to)}`;
}

/** What the comparison is, after "up from 5%": "in the 28 days before", "in the month before", "in your first week", "on your first reading". */
export function beforeWords(kind: ComparisonKind | null, range: Range): string {
  if (kind === "start") return "in your first week";
  if (kind === "first") return "on your first reading";
  if (kind === "month") return "in the month before";
  return `in the ${daysIn(range).length} days before`;
}

/** "up from", "down from" or "the same as", by the sign of the change in rounded points. */
export function direction(now: Rate, before: Rate): string {
  const d = (now.pct ?? 0) - (before.pct ?? 0);
  return d > 0 ? "up from" : d < 0 ? "down from" : "the same as";
}

function keywordSentence(k: HeadlineInput["keywords"], first: boolean): string {
  if (!k || !k.of) return "";
  const what = k.cluster ? "cluster keywords" : "keywords";
  if (first) return ` ${n(k.onPage1)} of ${n(k.of)} ${what} on Google's page 1.`;
  const verb = k.onPage1 === 1 ? "is" : "are";
  const was = k.before !== null ? `, was ${n(k.before)}` : "";
  return ` ${n(k.onPage1)} of ${n(k.of)} ${what} ${verb} on Google's page 1${was}.`;
}

/** The headline paragraph, in its three variants: the first reading, a period with its comparison, and one with none. */
export function headline(h: HeadlineInput): Headline {
  const answers = `${n(h.named.num)} of ${n(h.named.den)} AI answers to your ${plural(h.prompts, "prompt", "prompts")}`;
  if (h.firstReading) {
    return { variant: "first", text: `First reading on ${formatDay(h.firstReading)}: named in ${answers} (${pct(h.named)}).${keywordSentence(h.keywords, true)} Change figures start from the next check.` };
  }
  const lead = `Named in ${answers} ${periodWords(h.range, h.today)} (${pct(h.named)})`;
  if (!h.lfl || !h.lfl.before.den || h.lfl.now.pct === null || h.lfl.before.pct === null) return { variant: "plain", text: `${lead}.${keywordSentence(h.keywords, false)}` };
  const was = `${direction(h.lfl.now, h.lfl.before)} ${pct(h.lfl.before)} ${beforeWords(h.compareKind, h.range)}`;
  const throughout = h.compareKind === "start" ? "since your first week" : h.compareKind === "first" ? "since your first reading" : "all period";
  // The paragraph's rate and the like-for-like one are the same when nothing was added: one clause. Otherwise both, each named.
  const change = h.lfl.now.pct === h.named.pct ? `${lead}, ${was}, same ${h.lfl.basis}.` : `${lead}. On the ${plural(h.lfl.count, h.lfl.basis.slice(0, -1), h.lfl.basis)} tracked ${throughout} it is ${pct(h.lfl.now)}, ${was}.`;
  return { variant: "compared", text: `${change}${keywordSentence(h.keywords, false)}` };
}

export type MeaningLink = { to: "engine"; engine: string } | { to: "keyword"; keyword: string } | { to: "cluster"; cluster: string };
export type Bullet = { kind: "engines" | "google" | "change"; text: string; link: MeaningLink | null; /** The words the link sits on, inside `text`. */ linkText: string | null };

export type MeaningInput = {
  /** The first reading: bullets 1 and 2 only. */
  first: boolean;
  /** Per-engine answers naming the client over the range, on the headline's basis (engine-rates.ts engineRates). */
  engines: readonly EngineRate[];
  /** Each (cluster) keyword's latest reading in the range: its position, null outside the top 20; `read` false when it was not read at all. */
  keywords: readonly { id: string; keyword: string; position: number | null; read: boolean }[];
  cluster: boolean;
  /** Per cluster, answers naming the client now and before on the same prompts (clusterChanges); null without a comparison. */
  clusters: readonly ClusterChange[] | null;
};

export type ClusterChange = { id: string; label: string; now: number; before: number };

/** Bullet 1: the engines naming the client in the largest and smallest share of their answers; none with fewer than two answering. */
function enginesBullet(rates: readonly EngineRate[]): Bullet | null {
  const live = answering(rates);
  if (live.length < 2) return null;
  const top = strongestEngine(live)!;
  const low = weakestEngine(live)!;
  const of = (r: EngineRate) => `${n(r.rate.num)} of ${n(r.rate.den)}`;
  if (top.rate.pct === low.rate.pct) {
    return { kind: "engines", text: `All ${live.length} engines that answered name you in ${pct(top.rate)} of their answers.`, link: null, linkText: null };
  }
  // With every engine on the same number of answers, the largest share is the most answers, as the spec words it.
  const same = live.every((r) => r.rate.den === live[0]!.rate.den);
  const text = same
    ? `${label(top.engine)} names you in the most answers (${of(top)}); ${label(low.engine)} in the fewest (${of(low)}).`
    : `${label(top.engine)} names you in the largest share of its answers (${of(top)}); ${label(low.engine)} in the smallest (${of(low)}).`;
  return { kind: "engines", text, link: { to: "engine", engine: top.engine }, linkText: label(top.engine) };
}

/** Bullet 2: where the keywords stand on Google, from their latest readings. */
function googleBullet(keywords: MeaningInput["keywords"], cluster: boolean): Bullet | null {
  const read = keywords.filter((k) => k.read);
  if (!read.length) return null;
  const what = cluster ? "cluster keywords" : "keywords";
  const on = read.filter((k) => k.position !== null && k.position <= 10);
  const near = read.filter((k) => k.position !== null && k.position > 10 && k.position <= 20).sort((a, b) => a.position! - b.position!);
  if (on.length === read.length) {
    const lowest = [...on].sort((a, b) => b.position! - a.position!)[0]!;
    const text = read.length === 1 ? `Your ${what.slice(0, -1)} '${lowest.keyword}' is on page 1, at ${ordinal(lowest.position!)}.` : `All ${read.length} ${what} are on page 1; the lowest is '${lowest.keyword}' at ${ordinal(lowest.position!)}.`;
    return { kind: "google", text, link: { to: "keyword", keyword: lowest.id }, linkText: `'${lowest.keyword}'` };
  }
  if (near.length) {
    const k = near[0]!;
    return { kind: "google", text: `Closest to page 1: '${k.keyword}' at ${ordinal(k.position!)}.`, link: { to: "keyword", keyword: k.id }, linkText: `'${k.keyword}'` };
  }
  if (!on.length) return { kind: "google", text: `None of your ${what} is in Google's top 20 yet.`, link: null, linkText: null };
  const out = read.length - on.length;
  return { kind: "google", text: `${on.length} of ${read.length} ${what} ${on.length === 1 ? "is" : "are"} on page 1; the other ${out === 1 ? "one is" : `${out} are`} outside the top 20.`, link: null, linkText: null };
}

/** Bullet 3: the cluster whose answers naming the client moved most, like for like. None on a first reading, with no comparison, or with no move. */
function changeBullet(clusters: MeaningInput["clusters"]): Bullet | null {
  if (!clusters?.length) return null;
  const best = [...clusters].sort((a, b) => Math.abs(b.now - b.before) - Math.abs(a.now - a.before) || b.now - a.now)[0]!;
  if (best.now === best.before) return null;
  return { kind: "change", text: `'${best.label}': named in ${plural(best.now, "answer", "answers")}, was ${n(best.before)}, same prompts.`, link: { to: "cluster", cluster: best.id }, linkText: `'${best.label}'` };
}

/** The three bullets under the headline, each skipped when its rule has nothing to say. */
export function whatItMeans(m: MeaningInput): Bullet[] {
  const out = [enginesBullet(m.engines), googleBullet(m.keywords, m.cluster)];
  if (!m.first) out.push(changeBullet(m.clusters));
  return out.filter((b): b is Bullet => b !== null);
}

/**
 * Per cluster, the answers naming the client in the range and in the
 * comparison, on the prompts tracked all of both periods (`lfl`, the
 * like-for-like prompt ids the Overview already holds) - so a prompt added
 * since is in neither count. A cluster with none of those prompts is left out.
 * Counts compare only over periods of the same length: against a first week
 * or a first reading, or a calendar month a day longer, "named in 140
 * answers, was 7" would be the periods' lengths, not a change, so there is no
 * bullet.
 */
export function clusterChanges(p: {
  clusters: readonly { id: string; label: string }[];
  prompts: readonly { id: string; cluster_id: string | null }[];
  answers: readonly AnswerRow[];
  range: Range;
  compare: Range;
  lfl: ReadonlySet<string>;
}): ClusterChange[] {
  if (daysIn(p.compare).length !== daysIn(p.range).length) return [];
  return p.clusters.flatMap((c) => {
    const ids = new Set(p.prompts.filter((q) => q.cluster_id === c.id && p.lfl.has(q.id)).map((q) => q.id));
    if (!ids.size) return [];
    return [{ id: c.id, label: c.label, now: namedRate(p.answers as AnswerRow[], p.range, ids).num, before: namedRate(p.answers as AnswerRow[], p.compare, ids).num }];
  });
}
