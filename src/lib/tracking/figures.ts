/**
 * The alwaystracked overview's figures (T4, 29 Sep 2026), pure and testable
 * like `result-figures.ts`. Every rate carries its numerator and denominator
 * (BRIEF decision 10), and every date is an ISO day, `YYYY-MM-DD`.
 *
 * "Like-for-like" is BRIEF decision 8: only questions live for every day of
 * both the current and the comparison period.
 */

import { brandKey, pickDisplayName } from "../scan/brand-name.ts";

export type Day = string;

export type AnswerRow = {
  run_date: Day;
  question_id: string;
  engine: string;
  answered: boolean;
  named: boolean;
  /** Other brands named in the answer, as the runner writes them. */
  brands: string[];
  /**
   * False when the runner's brand extraction failed for this answer, so
   * `brands` is not the list of others named (8 Oct 2026, audit
   * reliability-1 / data-6). Absent - a read from before the column, or the
   * fixture - is read: true is the column's default.
   */
  brands_ok?: boolean;
};

/**
 * Whether an answer's other brands were read. An answered row that fails this
 * is left out of every brand figure - share of voice, the brand board, Who is
 * named, a prompt's brands - in numerator and denominator alike, the way an
 * unanswered read is left out of the named rate. Counted as naming no one, it
 * shortened every rival's count and raised the client's share.
 */
export const brandsRead = (a: Pick<AnswerRow, "brands_ok">): boolean => a.brands_ok !== false;

/** Answers in the range whose other brands were not read, per day and engine, oldest first. */
export function brandGaps(rows: readonly AnswerRow[], r: Range): { day: Day; engine: string; answers: number }[] {
  const n = new Map<string, number>();
  for (const a of rows) {
    if (!a.answered || brandsRead(a) || !within(a.run_date, r)) continue;
    const key = `${a.run_date} ${a.engine}`;
    n.set(key, (n.get(key) ?? 0) + 1);
  }
  return [...n]
    .map(([key, answers]) => {
      const [day, engine] = key.split(" ") as [Day, string];
      return { day, engine, answers };
    })
    .sort((x, y) => x.day.localeCompare(y.day) || x.engine.localeCompare(y.engine));
}

export type QuestionRow = { id: string; added_on: Day; stopped_on: Day | null };
export type SerpRow = { run_date: Day; keyword_id: string; position: number | null };

export type Rate = { num: number; den: number; pct: number | null };
export type Range = { from: Day; to: Day };

export function rate(num: number, den: number): Rate {
  return { num, den, pct: den ? Math.round((num / den) * 100) : null };
}

/** A figure's one-line basis, "2,924 of 8,559 mentions", counted the way the page prints its counts (DS18, 2 Oct 2026). */
export function basis(r: { num: number; den: number }, unit: string): string {
  return `${r.num.toLocaleString("en-GB")} of ${r.den.toLocaleString("en-GB")} ${unit}`;
}

const DAY_MS = 86_400_000;
const ms = (d: Day) => Date.parse(`${d}T00:00:00Z`);
const iso = (t: number): Day => new Date(t).toISOString().slice(0, 10);

export function addDays(d: Day, n: number): Day {
  return iso(ms(d) + n * DAY_MS);
}

export function daysIn({ from, to }: Range): Day[] {
  const out: Day[] = [];
  for (let t = ms(from); t <= ms(to); t += DAY_MS) out.push(iso(t));
  return out;
}

/** The period the range is compared with: `prev` is the same length just before, `month` is one calendar month back. */
export function comparisonRange(r: Range, compare: "prev" | "month" | "none"): Range | null {
  if (compare === "none") return null;
  if (compare === "prev") {
    const len = daysIn(r).length;
    return { from: addDays(r.from, -len), to: addDays(r.from, -1) };
  }
  const back = (d: Day) => {
    const t = new Date(ms(d));
    const day = t.getUTCDate();
    t.setUTCDate(1);
    t.setUTCMonth(t.getUTCMonth() - 1);
    const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
    t.setUTCDate(Math.min(day, last));
    return iso(t.getTime());
  };
  return { from: back(r.from), to: back(r.to) };
}

/** The first week of tracking: the comparison a client too young for the previous period gets (8 Oct 2026, audit data-10). */
export const FIRST_WEEK_DAYS = 7;

export function firstWeek(startedOn: Day): Range {
  return { from: startedOn, to: addDays(startedOn, FIRST_WEEK_DAYS - 1) };
}

/**
 * What a comparison is: the period picked, "start" - the first week standing
 * in for one before tracking began - or "first", the first reading standing
 * in while the first week is still running (ON-3, 9 Oct 2026).
 */
export type ComparisonKind = "prev" | "month" | "start" | "first";

/**
 * The day the first week starts (8 Oct 2026, review of audit data-10): the
 * first day a check had a prompt to ask - started_on, or the day the first
 * prompt was added when that came later (a signup with no scan adds none, so
 * a client can start days before anything is asked). Read from started_on
 * and the prompts alone, which every page and the date picker hold whatever
 * the range. It used to be the first day an answer came back, which only a
 * page whose comparison reached back had loaded, so the picker named one
 * first week and the page another. A first check that failed stays in the
 * week: it is still the first week of checks.
 */
export function firstCheckDay(startedOn: Day | null, questions: readonly Pick<QuestionRow, "added_on" | "stopped_on">[]): Day | null {
  if (!startedOn) return null;
  let first: Day | null = null;
  for (const q of questions) {
    if (q.stopped_on !== null && q.stopped_on <= q.added_on) continue; // stopped before it was ever asked
    const d = q.added_on > startedOn ? q.added_on : startedOn;
    if (first === null || d < first) first = d;
  }
  return first ?? startedOn;
}

/**
 * The comparison every page reads (8 Oct 2026, audit data-10). The previous
 * period or the month before, as picked; when that reaches back before the
 * first check (firstCheckDay, else started_on), the client's first week
 * instead - before this, a client saw no change at all for its first 55
 * days, the whole 14-day trial included. A range that ends inside the first
 * week has nothing to compare yet, and says when it will. The first week may
 * overlap the range: the change is then this period against its first seven
 * days, which is what "vs your first week" says. Pages and the date picker
 * (date-range.ts compareText) both call this, with the same firstCheck.
 *
 * ON-3 (9 Oct 2026, LB8): inside the first week - half the 14-day trial - a
 * range that holds the first reading and a day after it is compared with that
 * first reading ("first"): the chips are then the whole range, its first day
 * included, against that first day alone - not the latest reading against the
 * first - instead of nothing. A young client opens on "Since tracking began"
 * (date-range.ts defaultRange), which always holds it. The range's own
 * figures are counted exactly as before; only a comparison that was hidden is
 * now made, and named with its date wherever it is drawn (comparisonLabel,
 * periodPair). A range that ends on the first reading still has nothing to
 * compare, and says from when it will.
 *
 * Only when that first check read every engine the plan reads (review, 9 Oct
 * 2026): `firstComplete` is its run's status, complete (firstReadComplete). A
 * partial first check - one engine answered on day 1, all four after - read
 * "+67 pts vs your first reading", an engine-mix artefact shown as a client
 * result; a failed one named a reading that does not exist. Without it the
 * range waits for the first week, as before ON-3, and says so.
 */
export function resolveComparison(
  range: Range,
  compare: "prev" | "month" | "none",
  startedOn: Day | null,
  firstCheck?: Day | null,
  firstComplete = false,
): { range: Range | null; kind: ComparisonKind | null; hidden: string | null } {
  const c = comparisonRange(range, compare);
  if (!c || compare === "none") return { range: null, kind: null, hidden: null };
  const start = startedOn && firstCheck && firstCheck > startedOn ? firstCheck : startedOn;
  if (!startedOn || !start || c.from >= start) return { range: c, kind: compare, hidden: null };
  const first = firstWeek(start);
  if (first.to < range.to) return { range: first, kind: "start", hidden: null };
  if (firstComplete && range.from <= start && start < range.to) return { range: { from: start, to: start }, kind: "first", hidden: null };
  return {
    range: null,
    kind: null,
    // A range that holds a complete first reading, or ends on it, waits for the day after it; any other for the first week.
    hidden:
      firstComplete && range.from <= start
        ? `Tracking began ${formatDay(startedOn)}, so there is no earlier reading to compare with yet. From ${formatDay(addDays(start, 1))} the changes are against your first reading, ${formatDay(start)}.`
        : `Tracking began ${formatDay(startedOn)}, so there is no earlier period to compare with yet. From ${formatDay(addDays(first.to, 1))} the changes are against your first week.`,
  };
}

/**
 * Whether the first check read every engine the plan reads (review of ON-3,
 * 9 Oct 2026): its day's run finished complete. Partial, failed, still
 * running, or not read in this range's runs is no.
 */
export function firstReadComplete(runs: readonly { run_date: Day; status: string }[] | undefined, firstCheck: Day | null): boolean {
  return !!firstCheck && !!runs?.some((r) => r.run_date === firstCheck && r.status === "complete");
}

/**
 * "45% this period, 43% the one before" under a figure (8 Oct 2026, review of
 * audit data-10): against the first week the second rate is "in your first
 * week" - that week can sit inside this period, so "the one before" called
 * seven of its own days an earlier period.
 */
export function periodPair(now: Rate, before: Rate | null, kind: ComparisonKind | null): string {
  const p = (r: Rate) => (r.pct === null ? "-" : `${r.pct}%`);
  return before ? `${p(now)} this period, ${p(before)} ${kind === "start" ? "in your first week" : kind === "first" ? "on your first reading" : "the one before"}` : `${p(now)} this period`;
}

/**
 * "vs 5 Aug - 1 Sep", "vs your first week, 20 Sep - 26 Sep", or (ON-3) "vs
 * your first reading, 3 Oct" - the comparison as a chip or a date face says
 * it, so every change names what it is against and from which date.
 */
export function comparisonLabel(c: Range, kind: ComparisonKind | null): string {
  if (kind === "first") return `vs your first reading, ${formatDay(c.from)}`;
  return `vs ${kind === "start" ? "your first week, " : ""}${formatDay(c.from)} - ${formatDay(c.to)}`;
}

/** What a comparison is against, in words for a column head or a caption: "your first week", "your first reading", or "the period before". */
export function comparisonNoun(kind: ComparisonKind | null): string {
  return kind === "start" ? "your first week" : kind === "first" ? "your first reading" : kind === "month" ? "the month before" : "the period before";
}

const within = (d: Day, r: Range) => d >= r.from && d <= r.to;

/** A question is live on a day from `added_on` up to the day before `stopped_on`. */
export function liveThroughout(q: QuestionRow, r: Range): boolean {
  return q.added_on <= r.from && (q.stopped_on === null || q.stopped_on > r.to);
}

/** Answers naming the client, of every answer an engine gave in the range. */
export function namedRate(rows: AnswerRow[], r: Range, only?: Set<string>): Rate {
  let num = 0;
  let den = 0;
  for (const a of rows) {
    if (!a.answered || !within(a.run_date, r) || (only && !only.has(a.question_id))) continue;
    den++;
    if (a.named) num++;
  }
  return rate(num, den);
}

/**
 * DS1 / R177 (2 Oct 2026): prompts in no cluster that have an answer in the
 * range. Above zero alongside clusters, the Overview's headline counts every
 * prompt's readings, grouped or not, so it agrees with Who is named.
 */
export function ungroupedRead(questions: readonly { id: string; cluster_id?: string | null }[], rows: AnswerRow[], r: Range): number {
  const loose = new Set(questions.filter((q) => (q.cluster_id ?? null) === null).map((q) => q.id));
  const read = new Set<string>();
  for (const a of rows) if (a.answered && within(a.run_date, r) && loose.has(a.question_id)) read.add(a.question_id);
  return read.size;
}

/** Questions with at least one named answer, of the questions with any answer in the range. */
export function questionsNamed(rows: AnswerRow[], r: Range, only?: Set<string>): Rate {
  const asked = new Set<string>();
  const named = new Set<string>();
  for (const a of rows) {
    if (!a.answered || !within(a.run_date, r) || (only && !only.has(a.question_id))) continue;
    asked.add(a.question_id);
    if (a.named) named.add(a.question_id);
  }
  return rate(named.size, asked.size);
}

/**
 * Share of voice: the client's mentions over every brand mention in the range,
 * with the client's rank among the brands named. One named answer is one
 * mention, the same unit as one other brand in one answer. An answer whose
 * other brands were not read counts on neither side (brandsRead).
 */
export function shareOfVoice(rows: AnswerRow[], r: Range, only?: Set<string>): Rate & { rank: number | null; brands: number } {
  const counts = new Map<string, number>();
  let mine = 0;
  for (const a of rows) {
    if (!a.answered || !brandsRead(a) || !within(a.run_date, r) || (only && !only.has(a.question_id))) continue;
    if (a.named) mine++;
    // R143 (1 Oct 2026): spellings fold by the scan's brandKey, as brandBoard's rows do.
    for (const b of a.brands) counts.set(brandKey(b), (counts.get(brandKey(b)) ?? 0) + 1);
  }
  const others = [...counts.values()];
  const total = mine + others.reduce((s, n) => s + n, 0);
  const rank = mine ? others.filter((n) => n > mine).length + 1 : null;
  return { ...rate(mine, total), rank, brands: others.length + (mine ? 1 : 0) };
}

/**
 * Where a keyword outside the top 100 counts in an average position (8 Oct 2026, audit data-7): one place below the
 * deepest read (TRACKING_SERP_DEPTH, 100 since 14 Nov 2026; it was 21 while the read stopped at 20 - figures.test.mts
 * holds the two together; not imported, as this file is in the date picker's client bundle), so a keyword dropping
 * out makes the average worse. Averaging the ranked ones only made a drop from #13 to unranked read as an improvement.
 */
export const UNRANKED_AS = 101;

/** The average of keyword positions with an unranked one counted as UNRANKED_AS, to one decimal; null with none read. */
export function averagePosition(positions: readonly (number | null)[]): number | null {
  if (!positions.length) return null;
  return Math.round((positions.reduce<number>((s, p) => s + (p ?? UNRANKED_AS), 0) / positions.length) * 10) / 10;
}

/**
 * Keywords whose latest reading in the range is on page 1 (position 1-10), and
 * the average position of every keyword read, an unranked one counted as
 * UNRANKED_AS (`unranked` says how many). `only` narrows to those keyword ids.
 */
export function keywordsOnPage1(rows: SerpRow[], r: Range, keywords: number, only?: Set<string>): Rate & { avg: number | null; ranked: number; unranked: number } {
  const latest = new Map<string, SerpRow>();
  for (const s of rows) {
    if (!within(s.run_date, r) || (only && !only.has(s.keyword_id))) continue;
    const prev = latest.get(s.keyword_id);
    if (!prev || s.run_date > prev.run_date) latest.set(s.keyword_id, s);
  }
  const positions = [...latest.values()].map((s) => s.position);
  const ranked = positions.filter((p): p is number => p !== null);
  return { ...rate(ranked.filter((p) => p <= 10).length, keywords), avg: averagePosition(positions), ranked: ranked.length, unranked: positions.length - ranked.length };
}

/** Every daily check by engine: per day, the share of that engine's answered questions that named the client. Null where no check ran. */
export function checkGrid(rows: AnswerRow[], r: Range, engines: readonly string[]): Record<string, (Rate | null)[]> {
  const days = daysIn(r);
  const at = new Map(days.map((d, i) => [d, i]));
  const grid: Record<string, { num: number; den: number }[]> = {};
  for (const e of engines) grid[e] = days.map(() => ({ num: 0, den: 0 }));
  for (const a of rows) {
    const i = at.get(a.run_date);
    if (i === undefined || !a.answered || !grid[a.engine]) continue;
    grid[a.engine]![i]!.den++;
    if (a.named) grid[a.engine]![i]!.num++;
  }
  const out: Record<string, (Rate | null)[]> = {};
  for (const e of engines) out[e] = grid[e]!.map((c) => (c.den ? rate(c.num, c.den) : null));
  return out;
}

export type Overview = {
  range: Range;
  compare: Range | null;
  /** What `compare` is: the period picked, or "start", the first week standing in for one before tracking began. */
  compareKind: ComparisonKind | null;
  /** Why the comparison is hidden, when it reaches before tracking began. */
  compareHidden: string | null;
  named: Rate;
  namedBefore: Rate | null;
  /** Questions live all of both periods, and their rate in each. */
  lfl: { questions: number; now: Rate; before: Rate } | null;
  questions: Rate;
  questionsBefore: Rate | null;
  sov: ReturnType<typeof shareOfVoice>;
  sovBefore: Rate | null;
  keywords: ReturnType<typeof keywordsOnPage1>;
  keywordsBefore: Rate | null;
  /**
   * Every key figure's change, like-for-like (8 Oct 2026, audit data-4): the
   * figure itself counts everything in the range, but its change counts only
   * prompts (or keywords) tracked all of both periods, so a prompt added
   * mid-range never reads as a gain. "40 of 45, was 37 of 40" was really
   * no change. Null without a comparison.
   */
  change: {
    named: number | null;
    /** Prompts named in, on the like-for-like prompts, now and before. */
    questions: { now: Rate; before: Rate } | null;
    sov: number | null;
    /** Keywords on page 1, on the keywords tracked all of both periods; null without keyword rows. */
    keywords: { now: number; before: number; of: number } | null;
  } | null;
  grid: Record<string, (Rate | null)[]>;
};

export function overview(input: {
  range: Range;
  compare: "prev" | "month" | "none";
  startedOn: Day | null;
  engines: readonly string[];
  questions: QuestionRow[];
  answers: AnswerRow[];
  serp: SerpRow[];
  keywordCount: number;
  /** The keyword rows, for the page-1 change like-for-like; without them that change is not given. */
  keywords?: readonly { id: string; added_on: Day; stopped_on: Day | null }[];
  /** The range's runs, any status (OverviewData.runs): a first reading is compared with only when its run was complete. */
  runs?: readonly { run_date: Day; status: string }[];
}): Overview {
  const { range, answers, serp } = input;
  const firstCheck = firstCheckDay(input.startedOn, input.questions);
  const resolved = resolveComparison(range, input.compare, input.startedOn, firstCheck, firstReadComplete(input.runs, firstCheck));
  const compare = resolved.range;
  const compareHidden = resolved.hidden;
  // Like-for-like: live from the comparison's first day to the range's last (BRIEF decision 8).
  const lflFrom = compare ? compare.from : null;
  const lflIds = compare && lflFrom
    ? new Set(input.questions.filter((q) => liveThroughout(q, { from: lflFrom, to: range.to })).map((q) => q.id))
    : null;
  const lflKw = compare && lflFrom && input.keywords ? new Set(input.keywords.filter((k) => liveThroughout(k, { from: lflFrom, to: range.to })).map((k) => k.id)) : null;
  const lfl = compare && lflIds ? { questions: lflIds.size, now: namedRate(answers, range, lflIds), before: namedRate(answers, compare, lflIds) } : null;
  let change: Overview["change"] = null;
  if (compare && lflIds && lfl) {
    const qNow = questionsNamed(answers, range, lflIds);
    const qBefore = questionsNamed(answers, compare, lflIds);
    const kNow = lflKw ? keywordsOnPage1(serp, range, lflKw.size, lflKw) : null;
    const kBefore = lflKw ? keywordsOnPage1(serp, compare, lflKw.size, lflKw) : null;
    const read = (k: ReturnType<typeof keywordsOnPage1> | null) => !!k && k.ranked + k.unranked > 0;
    change = {
      named: pointsDelta(lfl.now, lfl.before),
      questions: qNow.den && qBefore.den ? { now: qNow, before: qBefore } : null,
      sov: pointsDelta(shareOfVoice(answers, range, lflIds), shareOfVoice(answers, compare, lflIds)),
      keywords: lflKw && read(kNow) && read(kBefore) ? { now: kNow!.num, before: kBefore!.num, of: lflKw.size } : null,
    };
  }
  return {
    range,
    compare,
    compareKind: resolved.kind,
    compareHidden,
    named: namedRate(answers, range),
    namedBefore: compare ? namedRate(answers, compare) : null,
    lfl,
    questions: questionsNamed(answers, range),
    questionsBefore: compare ? questionsNamed(answers, compare) : null,
    sov: shareOfVoice(answers, range),
    sovBefore: compare ? shareOfVoice(answers, compare) : null,
    keywords: keywordsOnPage1(serp, range, input.keywordCount),
    keywordsBefore: compare ? keywordsOnPage1(serp, compare, input.keywordCount) : null,
    change,
    grid: checkGrid(answers, range, input.engines),
  };
}

/** Per question: the named rate now and before, and which engines named the client in the range. Sorted by the size of the change, biggest first. */
export function movers(rows: AnswerRow[], r: Range, before: Range | null): { id: string; now: Rate; before: Rate | null; delta: number | null; engines: string[] }[] {
  const ids = [...new Set(rows.filter((a) => a.answered && within(a.run_date, r)).map((a) => a.question_id))];
  return ids
    .map((id) => {
      const one = new Set([id]);
      const now = namedRate(rows, r, one);
      const was = before ? namedRate(rows, before, one) : null;
      const engines = [...new Set(rows.filter((a) => a.question_id === id && a.named && within(a.run_date, r)).map((a) => a.engine))];
      return { id, now, before: was, delta: pointsDelta(now, was), engines };
    })
    .sort((x, y) => Math.abs(y.delta ?? 0) - Math.abs(x.delta ?? 0) || (y.now.pct ?? 0) - (x.now.pct ?? 0));
}

/**
 * Who is named instead: every brand's share of all brand mentions, the client
 * included as `you`, with its change in points against the comparison.
 * R143 (1 Oct 2026; BRIEF-4 P3): brands are keyed by the scan's folding rules
 * (`brand-name.ts` brandKey), so "Xero" and "Xero." are one row, shown in the
 * spelling the engines used most; `key` is that fold, `before` the mentions
 * in the comparison range (0 is "New"). An answer whose other brands were not
 * read counts for no one, the client included (brandsRead, 8 Oct 2026).
 */
export function brandBoard(rows: AnswerRow[], r: Range, before: Range | null, you: string): { key: string; name: string; you: boolean; share: Rate; delta: number | null; before: number | null }[] {
  const youKey = brandKey(you);
  const tally = (range: Range) => {
    const counts = new Map<string, { names: Map<string, number>; n: number }>();
    let total = 0;
    const bump = (name: string, key = brandKey(name)) => {
      const c = counts.get(key) ?? { names: new Map<string, number>(), n: 0 };
      c.n++;
      c.names.set(name, (c.names.get(name) ?? 0) + 1);
      counts.set(key, c);
      total++;
    };
    for (const a of rows) {
      if (!a.answered || !brandsRead(a) || !within(a.run_date, range)) continue;
      if (a.named) bump(you, youKey);
      // The client is counted once, off `named`; the runner never lists it among the others.
      for (const b of a.brands) if (brandKey(b) !== youKey) bump(b);
    }
    return { counts, total };
  };
  const now = tally(r);
  const was = before ? tally(before) : null;
  return [...now.counts.entries()]
    .map(([key, c]) => {
      const share = rate(c.n, now.total);
      const prevN = was ? (was.counts.get(key)?.n ?? 0) : null;
      const prev = was ? rate(prevN ?? 0, was.total) : null;
      return { key, name: key === youKey ? you : pickDisplayName(c.names), you: key === youKey, share, delta: pointsDelta(share, prev), before: prevN };
    })
    .sort((x, y) => y.share.num - x.share.num);
}

/**
 * One row per keyword: the latest position in the range, the change on the
 * first reading in the range, and the daily positions for the sparkline.
 * `since` is that first reading's day, so the change can say what it is
 * against (ON-3, 9 Oct 2026); null with fewer than two readings.
 */
export function keywordRows(rows: SerpRow[], r: Range): Map<string, { position: number | null; change: number | null; series: (number | null)[]; since: Day | null }> {
  const days = daysIn(r);
  const out = new Map<string, { position: number | null; change: number | null; series: (number | null)[]; since: Day | null }>();
  const byKw = new Map<string, Map<Day, number | null>>();
  for (const s of rows) {
    if (!within(s.run_date, r)) continue;
    const m = byKw.get(s.keyword_id) ?? new Map();
    m.set(s.run_date, s.position);
    byKw.set(s.keyword_id, m);
  }
  for (const [id, m] of byKw) {
    const series = days.map((d) => (m.has(d) ? m.get(d)! : null));
    const read = days.filter((d) => m.has(d));
    const position = read.length ? m.get(read[read.length - 1]!)! : null;
    const first = read.length ? m.get(read[0]!)! : null;
    // A positive change is places gained: position 11 to 7 is +4.
    const change = position !== null && first !== null && read.length > 1 ? first - position : null;
    out.set(id, { position, change, series, since: read.length > 1 ? read[0]! : null });
  }
  return out;
}

/**
 * A keyword's four-week sparkline as boards/Main.dc.html draws it (R104, 29 Sep
 * 2026): one point a week - the last position read in each seven-day block -
 * scaled to that keyword's own best and worst, so a climb from #11 to #7
 * slopes across the cell rather than drawing flat on a 1-20 scale. Better
 * positions sit higher. Unchanged draws level through the middle; a week with
 * no reading in the top 100 is a gap (null y).
 */
export function sparkPoints(series: (number | null)[], w = 64, h = 20, pad = 2): { x: number; y: number | null }[] {
  const weeks: (number | null)[] = [];
  for (let end = series.length; end > 0; end -= 7) {
    const block = series.slice(Math.max(0, end - 7), end).filter((p): p is number => p !== null);
    weeks.unshift(block.length ? block[block.length - 1]! : null);
  }
  const read = weeks.filter((p): p is number => p !== null);
  const best = read.length ? Math.min(...read) : 0;
  const worst = read.length ? Math.max(...read) : 0;
  const step = weeks.length > 1 ? (w - pad * 2) / (weeks.length - 1) : 0;
  return weeks.map((p, i) => ({
    x: Math.round((pad + i * step) * 10) / 10,
    y: p === null ? null : worst === best ? h / 2 : Math.round((pad + ((p - best) / (worst - best)) * (h - pad * 2)) * 10) / 10,
  }));
}

export type CitationRow ={ run_date: Day; engine: string; citations: { source_domain: string; url: string | null }[] };

/** The pages the engines cite most in the range: times cited, which engines cite it, and whether it is the client's own site. */
export function citedPages(rows: CitationRow[], r: Range, domain: string, limit = 6): { page: string; count: number; engines: string[]; yours: boolean }[] {
  return citedPageRows(rows, r, domain)
    .slice(0, limit)
    .map(({ page, count, engines, yours }) => ({ page, count, engines, yours }));
}

export type CitedPageRow = {
  /** Host and path, lowercase host, no www, no query, no trailing slash - the placements url_key form. */
  page: string;
  host: string;
  count: number;
  engines: string[];
  yours: boolean;
  first: Day;
  last: Day;
  /** Per prompt: days cited for it of days it had an answer. Most days first. */
  prompts: { id: string; daysCited: number; daysAnswered: number }[];
};

const bareHost = (h: string) => h.toLowerCase().replace(/^www\./, "");

/**
 * One citation as the page Cited pages lists it - host and path, as
 * CitedPageRow.page says - with its host; null with no host. Its own function
 * since DB-2 (9 Oct 2026), so the answer a Cited pages row opens
 * (evidence.ts citedEvidence) cites the page by the key the row counts it
 * by: one rule, not a second copy of it.
 */
export function citedPage(c: { source_domain: string; url: string | null }): { page: string; host: string } | null {
  const host = bareHost(c.source_domain || "");
  if (!host) return null;
  let page = host;
  if (c.url) {
    try {
      const u = new URL(c.url);
      page = `${bareHost(u.hostname)}${u.pathname.replace(/\/$/, "")}`;
    } catch {
      // an unparseable URL counts against its domain
    }
  }
  return { page, host };
}

/**
 * Every cited page in the range (R144, 1 Oct 2026; BRIEF-4 P4): the rows
 * citedPages draws on the Overview, with nothing cut, plus first and last day
 * cited and the prompts each page was cited for. citedPages is this list's
 * head, so a page's count here is the panel's.
 */
export function citedPageRows(rows: (CitationRow & { question_id?: string; answered?: boolean })[], r: Range, domain: string): CitedPageRow[] {
  const own = bareHost(domain);
  const pages = new Map<string, { count: number; engines: Set<string>; host: string; first: Day; last: Day; prompts: Map<string, Set<Day>> }>();
  const answered = new Map<string, Set<Day>>();
  for (const a of rows) {
    if (!within(a.run_date, r)) continue;
    if (a.question_id && a.answered !== false) {
      const d = answered.get(a.question_id) ?? new Set<Day>();
      d.add(a.run_date);
      answered.set(a.question_id, d);
    }
    for (const c of a.citations) {
      const cited = citedPage(c);
      if (!cited) continue;
      const { page, host } = cited;
      const p = pages.get(page) ?? { count: 0, engines: new Set<string>(), host, first: a.run_date, last: a.run_date, prompts: new Map<string, Set<Day>>() };
      p.count++;
      p.engines.add(a.engine);
      if (a.run_date < p.first) p.first = a.run_date;
      if (a.run_date > p.last) p.last = a.run_date;
      if (a.question_id) {
        const d = p.prompts.get(a.question_id) ?? new Set<Day>();
        d.add(a.run_date);
        p.prompts.set(a.question_id, d);
      }
      pages.set(page, p);
    }
  }
  return [...pages.entries()]
    .map(([page, p]) => ({
      page,
      host: p.host,
      count: p.count,
      engines: [...p.engines],
      yours: p.host === own || p.host.endsWith(`.${own}`),
      first: p.first,
      last: p.last,
      prompts: [...p.prompts.entries()]
        .map(([id, d]) => ({ id, daysCited: d.size, daysAnswered: answered.get(id)?.size ?? d.size }))
        .sort((x, y) => y.daysCited - x.daysCited || y.daysAnswered - x.daysAnswered),
    }))
    .sort((x, y) => y.count - x.count);
}

/** The chart's series: per day, the share of answers naming the client, per engine and across them all. */
export function dailySeries(rows: AnswerRow[], r: Range, engines: readonly string[], only?: Set<string>): { day: Day; all: Rate; by: Record<string, Rate> }[] {
  return daysIn(r).map((day) => {
    const one = { from: day, to: day };
    const pick = rows.filter((a) => a.run_date === day && (!only || only.has(a.question_id)));
    const by: Record<string, Rate> = {};
    for (const e of engines) by[e] = namedRate(pick.filter((a) => a.engine === e), one);
    return { day, all: namedRate(pick, one), by };
  });
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2 Sep", or "2 Sep 2026" with the year. */
export function formatDay(d: Day, year = false): string {
  const [y, m, day] = d.split("-");
  return `${Number(day)} ${MONTHS[Number(m) - 1]}${year ? ` ${y}` : ""}`;
}

/** The change in percentage points between two rates, or null when either has no denominator. */
export function pointsDelta(now: Rate, before: Rate | null): number | null {
  return before && now.pct !== null && before.pct !== null ? now.pct - before.pct : null;
}

/**
 * Keywords tracked at some point in the range (8 Oct 2026, audit data-1): added
 * by its end and not stopped before its start. The flat "Google keywords on
 * page 1, n of m" counted tomorrow's keyword in m, and a keyword stopped in
 * June in every later month.
 */
export function keywordsIn(keywords: readonly { added_on: Day; stopped_on: Day | null }[], range: Range): number {
  return keywords.filter((k) => k.added_on <= range.to && (k.stopped_on === null || k.stopped_on > range.from)).length;
}
