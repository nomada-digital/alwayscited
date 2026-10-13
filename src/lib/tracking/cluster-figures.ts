import { type AnswerRow, type Day, type Overview, type Range, type Rate, type SerpRow, averagePosition, brandsRead, daysIn, formatDay, pointsDelta, rate } from "./figures.ts";
import { APP_LIMITS } from "../../config/contact.ts";
import type { Angle } from "./limits.ts";

/**
 * The overview's cluster figures (T4b part 1, 30 Sep 2026; BRIEF-3 T4b against
 * boards-3/Main.dc.html, figures as boards-3/dataset.py derives them). Pure:
 * the cards, the heat map rows and the cluster chart all read from here, so
 * the three agree.
 *
 * - A cluster's rate is its answers naming the client, of every answer its
 *   prompts got in the range; the change is against the comparison range, and
 *   only for a cluster read in both (a cluster added mid-range has none).
 * - The keyword's position is its latest reading in the range; the change is
 *   places gained since the latest reading in the comparison range.
 * - "pending" is a cluster whose first check is after today: no readings, the
 *   card says "Asked from tomorrow" (DS2, 2 Oct: one line; the time is in its foot). "added" is one that began inside
 *   the range or its comparison, so like-for-like leaves it out. "live" was
 *   tracked throughout both.
 */

export type ClusterInput = {
  clusters: { id: string; name: string; keyword_id: string | null; started_on: Day; stopped_on: Day | null }[];
  questions: { id: string; text: string; cluster_id: string | null; angle: Angle | null; added_on: Day; stopped_on: Day | null }[];
  keywords: { id: string; keyword: string; search_volume: number | null; intent: string | null }[];
  answers: AnswerRow[];
  serp: SerpRow[];
  range: Range;
  before: Range | null;
  today: Day;
  engines: readonly string[];
};

export type ClusterStatus = "live" | "added" | "pending";

export type ClusterPrompt = {
  id: string;
  text: string;
  angle: Angle | null;
  now: Rate;
  before: Rate | null;
  /** Engines that named the client at least once in the range - the card's full marks. */
  namedBy: string[];
  /** Days in the range with at least one answer to this prompt (T6's "of N"). */
  daysChecked: number;
  /** Per engine, in the tier's order: days that engine named the client for this prompt, of the days it answered (DS73, 2 Oct 2026: a partial check reads an engine on fewer days than the prompt). */
  daysNamed: { engine: string; days: number; of: number }[];
  /** Set once stopped (T6 part 2b); after today it is a stop still pending, which Undo can clear. */
  stoppedOn: Day | null;
  /** Has any reading at all, so its text is fixed (limits.ts `refuseEdit`) - in a pending cluster, a prompt moved in from ungrouped (DS3, 2 Oct 2026). */
  fixed: boolean;
  /** Added after the range ends - tomorrow's prompt on a range ending today. Listed, never counted (8 Oct 2026, audit data-1). */
  pending: boolean;
};

export type ClusterCard = {
  id: string;
  name: string;
  /** The tracked_keywords id, for T11's "Ask about these" on the alwayscited prompt. */
  keywordId: string | null;
  keyword: string | null;
  volume: number | null;
  intent: string | null;
  status: ClusterStatus;
  /** Set once the cluster is stopped (T6 part 2b); after today the stop is still pending. */
  stoppedOn: Day | null;
  /** The card's "Tracked since". */
  started_on: Day;
  now: Rate;
  before: Rate | null;
  delta: number | null;
  /** Prompts with at least one named answer in the range, of the cluster's prompts. */
  promptsNamed: Rate;
  position: number | null;
  /** The keyword had a Google reading in the range - so a null position is "outside the top 20", not "not read". */
  positionRead: boolean;
  /** The day of that latest reading, null when it was not read in the range (13 Oct 2026: the slot's sentence dates it). */
  positionOn: Day | null;
  positionBefore: number | null;
  /** Places gained: #7 to #4 is +3. */
  positionChange: number | null;
  /**
   * 8 Oct 2026 (audit data-7): a live cluster's keyword that left the top 20
   * ("dropped": ranked in the comparison, read and unranked now) or came into
   * it ("entered"), or stayed out of it ("unranked"). positionChange is null
   * for all three, and they read "New" and "same as from #13" before.
   */
  positionEvent: "dropped" | "entered" | "unranked" | null;
  prompts: ClusterPrompt[];
  /** One cell a day in the range: that day's share of the cluster's answers naming the client, null before its first check. */
  heat: (Rate | null)[];
};

const within = (d: Day, r: Range) => d >= r.from && d <= r.to;

/** The keyword's latest Google reading in the range: its position (null outside the top 20) and its day, or no day when it was not read. */
function latestReading(serp: SerpRow[], keywordId: string | null, r: Range | null): { at: Day | null; position: number | null } {
  if (!keywordId || !r) return { at: null, position: null };
  let at: Day | null = null;
  let pos: number | null = null;
  for (const s of serp) {
    if (s.keyword_id !== keywordId || !within(s.run_date, r)) continue;
    if (at === null || s.run_date > at) {
      at = s.run_date;
      pos = s.position;
    }
  }
  return { at, position: pos };
}

function tally(answers: AnswerRow[], ids: Set<string>, r: Range): Rate {
  let num = 0;
  let den = 0;
  for (const a of answers) {
    if (!a.answered || !ids.has(a.question_id) || !within(a.run_date, r)) continue;
    den++;
    if (a.named) num++;
  }
  return rate(num, den);
}

export type ClusterSummary = {
  /** Every answer in the range across the clusters with readings. */
  now: Rate;
  /** The same on the clusters tracked all period, against the comparison range. */
  lfl: Rate;
  lflBefore: Rate | null;
  lflDelta: number | null;
  clusters: number;
  clustersLfl: number;
  prompts: number;
  promptsLfl: number;
  /** "40 of 45": every prompt read in the range. */
  promptsNamed: Rate;
  /**
   * 8 Oct 2026 (audit data-4): the like-for-like prompts named in now and
   * before - "37 of 40, was 37 of 40", no change. The strip used to set "40
   * of 45" against "was 37 of 40", a gain made of the prompts added since.
   */
  promptsNamedLfl: Rate | null;
  promptsNamedBefore: Rate | null;
  never: { cluster: string; text: string }[];
  /**
   * Cluster keywords whose latest position is 1-10, of the keywords of
   * clusters with readings, and the average position of those read, one
   * outside the top 20 counted as UNRANKED_AS (`unranked` of them; audit
   * data-7, 8 Oct 2026).
   */
  page1: Rate & { avg: number | null; ranked: number; unranked: number };
  /** On page 1 at the comparison's latest reading, and now, both on the clusters tracked all period (audit data-4). */
  page1Before: number | null;
  page1Lfl: number | null;
  /** Keywords at #11-#20: the ones a push would put on page 1. */
  offPage1: string[];
  /**
   * The prompts behind `now` - every prompt of a cluster with readings - and
   * behind `lfl`, those of the clusters tracked all period (review of audit
   * ia-3, 8 Oct 2026). The Overview's "Who is named instead" card counts
   * these, so it reads the headline's answers: counting every answer, a
   * pending cluster holding moved prompts set the client at 27% under a
   * headline of 25%.
   */
  ids: ReadonlySet<string>;
  lflIds: ReadonlySet<string>;
};

/**
 * The headline and the four figures by cluster (T4b part 2, 30 Sep 2026;
 * boards-3/overview.py's headline and "Key figures" strip). A pending cluster
 * counts nowhere; an added one counts in this period but not like-for-like.
 */
export function clusterSummary(cards: ClusterCard[]): ClusterSummary {
  const read = cards.filter((c) => c.status !== "pending");
  const lfl = read.filter((c) => c.status === "live");
  const sum = (cs: ClusterCard[], pick: (c: ClusterCard) => Rate | null) => {
    const rs = cs.map(pick).filter((r): r is Rate => r !== null);
    return rs.length ? rate(rs.reduce((s, r) => s + r.num, 0), rs.reduce((s, r) => s + r.den, 0)) : null;
  };
  const lflNow = sum(lfl, (c) => c.now) ?? rate(0, 0);
  const lflBefore = lfl.length && lfl.every((c) => c.before) ? sum(lfl, (c) => c.before) : null;
  // A prompt not yet asked counts in no denominator (audit data-1).
  const prompts = read.flatMap((c) => c.prompts.filter((p) => !p.pending));
  const promptsLfl = lfl.flatMap((c) => c.prompts.filter((p) => !p.pending));
  const readKw = read.filter((c) => c.positionRead);
  const ranked = readKw.map((c) => c.position).filter((p): p is number => p !== null);
  const hasBefore = lfl.length > 0 && lfl.some((c) => c.positionBefore !== null);
  const promptsNamedBefore = promptsLfl.every((p) => p.before) && promptsLfl.length ? rate(promptsLfl.filter((p) => p.before!.num > 0).length, promptsLfl.length) : null;
  return {
    now: sum(read, (c) => c.now) ?? rate(0, 0),
    lfl: lflNow,
    lflBefore,
    lflDelta: pointsDelta(lflNow, lflBefore),
    clusters: read.length,
    clustersLfl: lfl.length,
    prompts: prompts.length,
    promptsLfl: promptsLfl.length,
    promptsNamed: rate(prompts.filter((p) => p.now.num > 0).length, prompts.length),
    promptsNamedLfl: promptsNamedBefore ? rate(promptsLfl.filter((p) => p.now.num > 0).length, promptsLfl.length) : null,
    promptsNamedBefore,
    never: read.flatMap((c) => c.prompts.filter((p) => !p.pending && p.now.den > 0 && p.now.num === 0).map((p) => ({ cluster: c.keyword ?? c.name, text: p.text }))),
    page1: { ...rate(ranked.filter((p) => p <= 10).length, read.length), avg: averagePosition(readKw.map((c) => c.position)), ranked: ranked.length, unranked: readKw.length - ranked.length },
    page1Before: hasBefore ? lfl.filter((c) => c.positionBefore !== null && c.positionBefore <= 10).length : null,
    page1Lfl: hasBefore ? lfl.filter((c) => c.position !== null && c.position <= 10).length : null,
    offPage1: read.filter((c) => c.position !== null && c.position >= 11 && c.position <= 20).map((c) => c.keyword ?? c.name),
    ids: new Set(read.flatMap((c) => c.prompts.map((p) => p.id))),
    lflIds: new Set(lfl.flatMap((c) => c.prompts.map((p) => p.id))),
  };
}

export type KeyFigureChanges = {
  /** The headline's and the first figure's change, in points. */
  named: number | null;
  /** Prompts named in, like-for-like now and before. */
  prompts: { now: Rate; before: Rate } | null;
  /** "like-for-like 37 of 40, no change" - the prompts figure's foot. */
  promptsLine: string | null;
  sov: number | null;
  /** Keywords on page 1, in keywords. */
  page1: number | null;
};

/**
 * The Overview's key-figure chips (8 Oct 2026, audit data-4): every one is
 * its like-for-like change, as the headline's is. The figure counts
 * everything in the range; the chip only what was tracked all of both
 * periods, so "40 of 45, was 37 of 40" - really no change - and a cluster
 * added on page 1 no longer read as gains. `byCluster` is the summary when
 * the headline reads by cluster (every prompt grouped), else null; `cs` the
 * summary whenever there are clusters, for page 1.
 */
export function keyFigureChanges(o: Pick<Overview, "lfl" | "change">, cs: ClusterSummary | null, byCluster: ClusterSummary | null): KeyFigureChanges {
  const prompts = byCluster
    ? byCluster.promptsNamedLfl && byCluster.promptsNamedBefore
      ? { now: byCluster.promptsNamedLfl, before: byCluster.promptsNamedBefore }
      : null
    : (o.change?.questions ?? null);
  return {
    named: byCluster ? byCluster.lflDelta : o.lfl ? pointsDelta(o.lfl.now, o.lfl.before) : null,
    prompts,
    promptsLine: prompts
      ? `like-for-like ${prompts.now.num} of ${prompts.now.den}, ${
          prompts.now.den !== prompts.before.den ? `was ${prompts.before.num} of ${prompts.before.den}` : prompts.now.num === prompts.before.num ? "no change" : `was ${prompts.before.num}`
        }`
      : null,
    sov: o.change?.sov ?? null,
    page1: cs ? (cs.page1Lfl !== null && cs.page1Before !== null ? cs.page1Lfl - cs.page1Before : null) : o.change?.keywords ? o.change.keywords.now - o.change.keywords.before : null,
  };
}

export type ClusterChart = {
  days: Day[];
  /** The cluster's share of answers naming the client each day; null is a gap (no reading), never a zero. */
  named: (Rate | null)[];
  /** The keyword's Google position each day; null where it was not read or not ranked. */
  google: (number | null)[];
  /** The same, day for day, over the comparison range; null when there is none or the cluster was not live through it. */
  namedBefore: (Rate | null)[] | null;
  googleBefore: (number | null)[] | null;
};

/**
 * One cluster's chart (T4b part 5a, 30 Sep 2026; BRIEF-3 T4b step 4 against
 * boards-3/Main.dc.html): two panels on one time axis, AI above and Google
 * below, the previous period dashed behind them. Pure; the heat row and this
 * top panel count the same answers.
 */
export function clusterChart(input: ClusterInput, clusterId: string): ClusterChart | null {
  const c = input.clusters.find((x) => x.id === clusterId);
  if (!c) return null;
  const ids = new Set(input.questions.filter((q) => q.cluster_id === c.id && (q.stopped_on === null || q.stopped_on > input.range.from)).map((q) => q.id));
  const namedFor = (r: Range) =>
    daysIn(r).map((d) => {
      const t = tally(input.answers, ids, { from: d, to: d });
      return t.den ? t : null;
    });
  const googleFor = (r: Range) =>
    daysIn(r).map((d) => {
      const s = c.keyword_id ? input.serp.find((x) => x.keyword_id === c.keyword_id && x.run_date === d) : undefined;
      return s?.position ?? null;
    });
  // 8 Oct 2026 (audit data-10): the comparison's first day, even when it is the first week inside the range.
  const earliest = input.before ? input.before.from : input.range.from;
  const live = c.started_on <= earliest;
  return {
    days: daysIn(input.range),
    named: namedFor(input.range),
    google: googleFor(input.range),
    namedBefore: input.before && live ? namedFor(input.before) : null,
    googleBefore: input.before && live ? googleFor(input.before) : null,
  };
}

/**
 * What a pending cluster's rate counts (DS3, 2 Oct 2026): it has no check of its
 * own yet, so any answers are those of prompts moved in from ungrouped, read
 * before they joined. Null when there are none - the card shows no rate then.
 */
export function pendingBasis(c: ClusterCard): string | null {
  if (c.status !== "pending" || !c.now.den) return null;
  const k = c.prompts.filter((p) => p.now.den > 0).length;
  return `Its rate counts ${k === 1 ? "1 moved prompt" : `${k} moved prompts`} only: ${c.now.num} of ${c.now.den} answers`;
}

export function clusterCards(input: ClusterInput): ClusterCard[] {
  const { range, before, today, engines } = input;
  const days = daysIn(range);
  // Like-for-like runs from the comparison's first day (figures.ts overview). That is
  // before the range for the previous period; for a young client's first week
  // (audit data-10, 8 Oct 2026) it can be after the range's first, untracked, day.
  const earliest = before ? before.from : range.from;

  // 8 Oct 2026 (audit data-1): a past range counted clusters and prompts that
  // started after it ended - August read "37 of 45" when there were 40. Only a
  // range that ends today shows what starts tomorrow, as pending, uncounted.
  const current = range.to >= today;
  return input.clusters
    .filter((c) => (c.stopped_on === null || c.stopped_on > range.from) && (current || c.started_on <= range.to))
    .map((c) => {
      const kw = input.keywords.find((k) => k.id === c.keyword_id) ?? null;
      const prompts = input.questions.filter((q) => q.cluster_id === c.id && (q.stopped_on === null || q.stopped_on > range.from) && (current || q.added_on <= range.to));
      const ids = new Set(prompts.map((q) => q.id));
      const status: ClusterStatus = c.started_on > today ? "pending" : c.started_on > earliest ? "added" : "live";

      const now = tally(input.answers, ids, range);
      const then = before && status === "live" ? tally(input.answers, ids, before) : null;
      const wasRate = then && then.den ? then : null;

      const cells = new Map<Day, { num: number; den: number }>();
      const byPrompt = new Map<string, { engines: Set<string> }>();
      const checkedDays = new Map<string, Set<Day>>();
      const namedDays = new Map<string, Set<Day>>();
      const engineDays = new Map<string, Set<Day>>();
      for (const a of input.answers) {
        if (!a.answered || !ids.has(a.question_id) || !within(a.run_date, range)) continue;
        const ek = `${a.question_id} ${a.engine}`;
        const ed = engineDays.get(ek) ?? new Set<Day>();
        ed.add(a.run_date);
        engineDays.set(ek, ed);
        const cell = cells.get(a.run_date) ?? { num: 0, den: 0 };
        cell.den++;
        const seen = checkedDays.get(a.question_id) ?? new Set<Day>();
        seen.add(a.run_date);
        checkedDays.set(a.question_id, seen);
        if (a.named) {
          cell.num++;
          const p = byPrompt.get(a.question_id) ?? { engines: new Set<string>() };
          p.engines.add(a.engine);
          byPrompt.set(a.question_id, p);
          const key = `${a.question_id} ${a.engine}`;
          const nd = namedDays.get(key) ?? new Set<Day>();
          nd.add(a.run_date);
          namedDays.set(key, nd);
        }
        cells.set(a.run_date, cell);
      }

      const reading = latestReading(input.serp, c.keyword_id, range);
      const was = status === "live" ? latestReading(input.serp, c.keyword_id, before) : { at: null, position: null };
      const position = reading.position;
      const positionBefore = was.position;
      const positionEvent =
        reading.at === null || was.at === null ? null : positionBefore !== null && position === null ? "dropped" : positionBefore === null && position !== null ? "entered" : positionBefore === null && position === null ? "unranked" : null;

      return {
        id: c.id,
        name: c.name,
        keywordId: kw?.id ?? null,
        keyword: kw?.keyword ?? null,
        volume: kw?.search_volume ?? null,
        intent: kw?.intent ?? null,
        status,
        stoppedOn: c.stopped_on,
        started_on: c.started_on,
        now,
        before: wasRate,
        delta: pointsDelta(now, wasRate),
        promptsNamed: rate(byPrompt.size, prompts.filter((q) => q.added_on <= range.to).length),
        position,
        positionRead: reading.at !== null,
        positionOn: reading.at,
        positionBefore,
        positionChange: position !== null && positionBefore !== null ? positionBefore - position : null,
        positionEvent,
        prompts: prompts.map((q) => {
          const one = new Set([q.id]);
          const p = tally(input.answers, one, range);
          const b = before && status === "live" ? tally(input.answers, one, before) : null;
          return {
            id: q.id,
            text: q.text,
            angle: q.angle,
            now: p,
            before: b && b.den ? b : null,
            namedBy: engines.filter((e) => byPrompt.get(q.id)?.engines.has(e)),
            daysChecked: checkedDays.get(q.id)?.size ?? 0,
            daysNamed: engines.map((e) => ({ engine: e, days: namedDays.get(`${q.id} ${e}`)?.size ?? 0, of: engineDays.get(`${q.id} ${e}`)?.size ?? 0 })),
            stoppedOn: q.stopped_on,
            fixed: input.answers.some((a) => a.question_id === q.id),
            pending: q.added_on > range.to,
          };
        }),
        heat: days.map((d) => {
          const cell = cells.get(d);
          return cell ? rate(cell.num, cell.den) : null;
        }),
      };
    });
}

export type ClusterDetail = {
  card: ClusterCard;
  /** The engine naming the client in most of this cluster's answers in range, of that engine's answers (board: "n of 140", 5 prompts x 28 days). Null with none named. */
  reliable: { engine: string; rate: Rate } | null;
  /** The day of the comparison range's Google reading, for "up from #N on 1 Sep". */
  positionBeforeOn: Day | null;
};

/**
 * One cluster's page (T7 part 1, 30 Sep 2026; BRIEF-3 T7 against
 * boards-3/QuestionDetail.dc.html): the card the overview draws, plus the
 * summary strip's last figure and the date its Google line quotes. Null for
 * an id that is not one of this client's clusters in range.
 */
export function clusterDetail(input: ClusterInput, clusterId: string): ClusterDetail | null {
  const card = clusterCards(input).find((c) => c.id === clusterId);
  if (!card) return null;
  const ids = new Set(card.prompts.map((p) => p.id));
  const reliable = input.engines
    .map((engine) => {
      let num = 0;
      let den = 0;
      for (const a of input.answers) {
        if (a.engine !== engine || !a.answered || !ids.has(a.question_id) || !within(a.run_date, input.range)) continue;
        den++;
        if (a.named) num++;
      }
      return { engine, rate: rate(num, den) };
    })
    .reduce<{ engine: string; rate: Rate } | null>((best, e) => (e.rate.num > 0 && (!best || e.rate.num > best.rate.num) ? e : best), null);
  const keywordId = input.clusters.find((c) => c.id === clusterId)?.keyword_id ?? null;
  let positionBeforeOn: Day | null = null;
  // The day of the comparison's reading - a ranked one, or the unranked one a keyword entered the top 20 from (audit data-7).
  if ((card.positionBefore !== null || card.positionEvent === "entered") && keywordId && input.before) {
    for (const s of input.serp) if (s.keyword_id === keywordId && within(s.run_date, input.before) && (positionBeforeOn === null || s.run_date > positionBeforeOn)) positionBeforeOn = s.run_date;
  }
  return { card, reliable, positionBeforeOn };
}

/**
 * The one-cluster page's Google line after its position (8 Oct 2026, audit
 * data-7): ", up from #7 on 1 Sep", ", down from #13 on 1 Sep" for a keyword
 * that left the top 20, ", up from outside the top 20 on 1 Sep" for one that
 * entered it. "" with no reading to compare. A null change fell through to
 * "same as" before, so a drop-out read "Not in the top 20, same as from #13".
 */
export function positionMove(c: Pick<ClusterCard, "positionEvent" | "positionChange" | "positionBefore">, beforeOn: Day | null): string {
  if (!beforeOn) return "";
  const on = formatDay(beforeOn);
  if (c.positionEvent === "dropped") return `, down from #${c.positionBefore} on ${on}`;
  if (c.positionEvent === "entered") return `, up from outside the top 20 on ${on}`;
  if (c.positionChange === null || c.positionBefore === null) return "";
  return `, ${c.positionChange > 0 ? "up from" : c.positionChange < 0 ? "down from" : "unchanged from"} #${c.positionBefore} on ${on}`;
}

/** The row's "days named, of N" (DS73, 2 Oct 2026): "of up to N" once any engine answered on fewer of the prompt's days, so no count reads against days it was not read. */
export const daysOfLine = (p: Pick<ClusterPrompt, "daysChecked" | "daysNamed">) =>
  `days named, of ${p.daysNamed.some((d) => d.of < p.daysChecked) ? "up to " : ""}${p.daysChecked}`;

export type StripRow = {
  engine: string;
  /** One cell a day in range: named, not named, or null where that engine gave no answer. */
  cells: (boolean | null)[];
  /** "13 of 28": days named, of days answered. */
  named: number;
  answered: number;
};

/**
 * "Every check, day by day" for one prompt (T7 part 2a, 30 Sep 2026;
 * boards-3/QuestionDetail.dc.html): a row per engine in the tier's order, a
 * cell per day in range. Pure; its totals are the T6 day counts.
 */
export function promptStrip(input: Pick<ClusterInput, "answers" | "range" | "engines">, promptId: string): StripRow[] {
  const days = daysIn(input.range);
  const at = new Map<string, boolean>();
  for (const a of input.answers) {
    if (a.question_id !== promptId || !a.answered || !within(a.run_date, input.range)) continue;
    const key = `${a.engine} ${a.run_date}`;
    at.set(key, (at.get(key) ?? false) || a.named);
  }
  return input.engines.map((engine) => {
    const cells = days.map((d) => at.get(`${engine} ${d}`) ?? null);
    return { engine, cells, named: cells.filter((c) => c === true).length, answered: cells.filter((c) => c !== null).length };
  });
}

/**
 * "Named in answers to this prompt" (T7 part 3a, 30 Sep 2026;
 * boards-3/QuestionDetail.dc.html): of the prompt's answers in range, how
 * many named each brand - the client always, then the three others named in
 * most, most first. A count of answers, not of mentions, so no row can
 * exceed `answers`. An answer whose other brands were not read counts for no
 * one, the client included (figures.ts brandsRead, 8 Oct 2026, audit data-6).
 */
export function promptBrands(input: Pick<ClusterInput, "answers" | "range">, promptId: string, you: string): { answers: number; rows: { name: string; you: boolean; n: number }[] } {
  let answers = 0;
  let mine = 0;
  const others = new Map<string, { name: string; n: number }>();
  for (const a of input.answers) {
    if (a.question_id !== promptId || !a.answered || !brandsRead(a) || !within(a.run_date, input.range)) continue;
    answers++;
    if (a.named) mine++;
    for (const key of new Set(a.brands.map((b) => b.toLowerCase()))) {
      if (key === you.toLowerCase()) continue;
      const c = others.get(key) ?? { name: a.brands.find((b) => b.toLowerCase() === key)!, n: 0 };
      c.n++;
      others.set(key, c);
    }
  }
  const top = [...others.values()].sort((x, y) => y.n - x.n || x.name.localeCompare(y.name)).slice(0, 3);
  const rows = [{ name: you, you: true, n: mine }, ...top.map((c) => ({ ...c, you: false }))].sort((x, y) => y.n - x.n);
  return { answers, rows };
}

/**
 * `?prompt=` on the one-cluster page (T7 part 2b): a 0-based index into its prompts; anything else, or past the
 * last, is the first. Two digits since the review of 95a8747 (9 Oct 2026): a cluster's list keeps the prompts
 * stopped within the range beside its five live ones, so it can pass ten, and `prompt=10` - a link Who is named
 * or Cited pages builds - opened prompt 0.
 */
export function promptIndex(raw: string | string[] | undefined, count: number): number {
  const n = typeof raw === "string" && /^\d{1,2}$/.test(raw) ? Number(raw) : 0;
  return n < count ? n : 0;
}

export type ClusterFilter ="all" | "named" | "never";

/** Prompts with at least one named answer in range. */
export const namedCount = (c: ClusterCard) => c.prompts.filter((p) => p.now.num > 0).length;
/** Prompts checked in range that never named the client. */
export const neverCount = (c: ClusterCard) => c.prompts.filter((p) => p.now.den > 0 && p.now.num === 0).length;

/**
 * T6's filters and search (30 Sep 2026): the search matches the keyword or any
 * prompt; "named" keeps checked clusters with a prompt naming the client,
 * "never" those with a prompt that never did. A pending cluster is in "all" only.
 */
export function filterClusters(cards: ClusterCard[], filter: ClusterFilter, q: string): ClusterCard[] {
  const term = q.trim().toLowerCase();
  return cards.filter((c) => {
    if (term && !(c.keyword ?? c.name).toLowerCase().includes(term) && !c.prompts.some((p) => p.text.toLowerCase().includes(term))) return false;
    if (filter === "named") return c.status !== "pending" && namedCount(c) > 0;
    if (filter === "never") return c.status !== "pending" && neverCount(c) > 0;
    return true;
  });
}

/** DS55 (R173 pass 6, 2 Oct 2026): the same search over ungrouped prompts, matched on their text as a cluster's prompts are. */
export function searchPrompts<R extends { text: string }>(rows: readonly R[], q: string): R[] {
  const term = q.trim().toLowerCase();
  return term ? rows.filter((r) => r.text.toLowerCase().includes(term)) : [...rows];
}

/** `?q=` as the Clusters page reads it: cut to APP_LIMITS.search before it filters anything. */
export function clusterSearch(q: string | null): string {
  return (q ?? "").slice(0, APP_LIMITS.search);
}
