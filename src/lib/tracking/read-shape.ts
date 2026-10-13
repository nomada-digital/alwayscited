import { selectAllCounted } from "../supabase/page.ts";

import { missingColumn } from "./decide.ts";
import { type AnswerRow, type CitationRow, type Day, type Range, addDays, comparisonRange } from "./figures.ts";
import type { LatestAnswers, LatestRow } from "./latest-answers.ts";
import type { OverviewData } from "./overview-data.ts";

/**
 * What each dashboard page reads, and no more (8 Oct 2026, audit perf-4,
 * perf-9 and perf-1). No I/O of its own - readAnswers runs on whatever table
 * it is handed - so the fixture repo shapes its copy with the same plan as
 * the Supabase read, and node --test can run both.
 *
 * Every page used to read every answer of the range with its `brands` and
 * `citations` jsonb - most of each row's bytes, citation titles included -
 * whether or not it drew them:
 *
 * - Settings and Setup draw only the clusters, prompts and keywords, so they
 *   read the structure and no answer at all (`loadStructure`).
 * - The keywords CSV is tracking_serp's rows only (`answers: "none"`).
 * - Reports' monthly cards read verdicts only (`"verdicts"`): monthFigures
 *   takes the named rate, like-for-like, prompts named and page 1, none of
 *   which reads a brand or a citation. read-shape.test.mts holds every card
 *   equal on full and verdict-only rows, on every fixture state.
 * - Placements reads the picked cluster's prompts with their citations, no
 *   brands (`"cites"`, `cluster`); the one-cluster page reads its own
 *   prompts, every column (`cluster`). Both are held equal to the full read.
 * - Overview, Cited pages and Clusters read everything. The audit had
 *   Clusters as using neither jsonb column; it does - the never-named upgrade
 *   prompt names the hosts cited for those prompts (upgrade-facts.ts
 *   neverNamedFacts) - so it is left whole.
 * - Who is named reads brands without citations (`"brands"`) until a row is
 *   open (13 Oct 2026, dashboard speed, payload): only an open row's cited
 *   pages read a citation (`namedRead`).
 *
 * A column left out comes back as an empty list, not as a missing field, so
 * every figure type still holds. That is also how a page that starts to need
 * a column it does not ask for would fail: silently, as zero. So the pages on
 * a narrow read are named in read-shape.test.mts with the figures they draw,
 * and a new use of their answers fails the census there.
 */

export type AnswerColumns = "full" | "cites" | "brands" | "verdicts" | "none";

/** The tracking_answers columns each shape selects; "none" reads no answer. */
export const ANSWER_SELECT: Record<Exclude<AnswerColumns, "none">, string> = {
  // brands_ok (20261008020000, audit reliability-1): an answer whose brand extraction failed is out of every brand figure.
  // Read again without it while the column is missing (readAnswers, review of the integration, 8 Oct 2026).
  full: "run_date, question_id, engine, answered, named, brands, brands_ok, citations",
  cites: "run_date, question_id, engine, answered, named, citations",
  // 13 Oct 2026 (dashboard speed): Who is named with no row open. brands_ok as on the full read, and read again without it the same way.
  brands: "run_date, question_id, engine, answered, named, brands, brands_ok",
  verdicts: "run_date, question_id, engine, answered, named",
};

/**
 * Who is named's shape (13 Oct 2026, dashboard speed, payload): brands only,
 * unless `?open=` names a row, whose "Pages cited in answers that name"
 * list (citedWithBrand) is the page's one read of a citation.
 * read-shape.test.mts holds everything else the page draws, an open row's
 * prompt links included, equal on both reads.
 */
export function namedRead(open: string | null): AnswerColumns {
  return open === null ? "brands" : "full";
}

/** The clusters, prompts and keywords: every page's frame, read without a single answer. */
export type Structure = Pick<OverviewData, "clusters" | "questions" | "keywords">;

export type ReadOpts = {
  /** Which answer columns to read; "full" when unsaid. */
  answers?: AnswerColumns;
  /** Only this cluster's prompts' answers (clusterQuestionIds). */
  cluster?: string;
  /** The structure, when the caller has already read it, so it is not read twice. */
  structure?: Structure;
};

/**
 * The prompts a one-cluster read takes: every prompt now in the cluster,
 * stopped ones included, which is the superset clusterCards, clusterChart and
 * the placements view each narrow from. Their answers are found by
 * question_id, so a prompt moved in from ungrouped brings its earlier answers,
 * as it does on the full read.
 */
export function clusterQuestionIds(questions: readonly { id: string; cluster_id: string | null }[], cluster: string): string[] {
  return questions.filter((q) => q.cluster_id === cluster).map((q) => q.id);
}

/**
 * What one shaped read asks tracking_answers for: the columns to select, and
 * the cluster whose prompts it is held to (null for every prompt). null when
 * it reads no answer at all.
 *
 * One decision, taken here for both reads (review, 8 Oct 2026). loadOverview
 * made it in its own lines and shapeRead in its own, and only shapeRead ran
 * under node --test - overview-data.ts imports server-only - so a dropped
 * `.in("question_id", ...)` or a wrong column list would have read
 * differently in production and left every equality test here green.
 */
export type AnswerPlan = { select: string; cluster: string | null };

export function answerPlan(opts: ReadOpts): AnswerPlan | null {
  const cols = opts.answers ?? "full";
  return cols === "none" ? null : { select: ANSWER_SELECT[cols], cluster: opts.cluster ?? null };
}

/** The prompt ids a plan reads, from the structure: null for every prompt; an empty list reads nothing. */
export function planPrompts(plan: AnswerPlan, structure: Pick<Structure, "questions">): string[] | null {
  return plan.cluster === null ? null : clusterQuestionIds(structure.questions, plan.cluster);
}

/** A row cut to a select's columns, as PostgREST returns it: what the fixture stands in for, and the test's fake server. */
export function selectColumns(row: object, select: string): Record<string, unknown> {
  const r = row as Record<string, unknown>;
  return Object.fromEntries(select.split(",").map((c) => [c.trim(), r[c.trim()]]));
}

/** One answer as the dashboard holds it, from a row as a select returned it: a column the select left out reads as an empty list. */
export function answerRow(a: Record<string, unknown>): AnswerRow & CitationRow {
  return {
    run_date: a.run_date as Day,
    question_id: a.question_id as string,
    engine: a.engine as string,
    answered: a.answered as boolean,
    named: a.named as boolean,
    brands: Array.isArray(a.brands) ? (a.brands as unknown[]).filter((b): b is string => typeof b === "string") : [],
    ...(a.brands_ok === false ? { brands_ok: false as const } : {}),
    citations: Array.isArray(a.citations) ? (a.citations as CitationRow["citations"]) : [],
  };
}

/** The query-builder calls the answers read makes: supabase-js's, or the fake PostgREST in read-shape.test.mts. */
export type AnswersQuery = PromiseLike<{ data: unknown[] | null; error: { message: string } | null; count?: number | null }> & {
  eq(column: string, value: string): AnswersQuery;
  gte(column: string, value: string): AnswersQuery;
  lte(column: string, value: string): AnswersQuery;
  in(column: string, values: readonly string[]): AnswersQuery;
  order(column: string): AnswersQuery;
  range(from: number, to: number): AnswersQuery;
};
export type AnswersTable = () => { select(columns: string, options: { count?: "exact" }): AnswersQuery };

/** A select without brands_ok: what a read names while 20261008020000 has not been applied. */
export function withoutBrandsOk(select: string): string {
  return select
    .split(",")
    .map((c) => c.trim())
    .filter((c) => c !== "brands_ok")
    .join(", ");
}

/**
 * The answers read itself, on a plan: its columns, one client's days, its
 * prompts, ordered by id and paged (selectAllCounted). loadOverview runs it
 * on tracking_answers; read-shape.test.mts runs the same function on a fake
 * PostgREST serving the fixture and holds it equal to shapeRead.
 *
 * A select naming brands_ok on a table without it (review of the integration
 * of audit packages A, B and C, 8 Oct 2026) is read again without it, and
 * every row then reads as read - what the column's default says of the rows
 * written before it. A deploy can land before its additive migration
 * (AGENTS.md), and package A wrapped this fallback round the old overview
 * read; the merge with package C's planned read dropped it, on the
 * assumption that 20261008020000 is applied first, so until it was, the
 * full plan's pages - Overview, Who is named, Cited pages, Clusters and one
 * cluster - failed. Here rather than in loadOverview, so it runs under node
 * --test on the fake PostgREST.
 */
export async function readAnswers(table: AnswersTable, plan: AnswerPlan, ids: string[] | null, where: { clientId: string; from: Day; to: Day }): Promise<(AnswerRow & CitationRow)[]> {
  if (ids && !ids.length) return [];
  const read = (select: string) =>
    selectAllCounted<unknown>((lo, hi, count) => {
      let q = table()
        .select(select, count ? { count: "exact" } : {})
        .eq("client_domain_id", where.clientId)
        .gte("run_date", where.from)
        .lte("run_date", where.to);
      if (ids) q = q.in("question_id", ids);
      return q.order("id").range(lo, hi);
    });
  let rows: unknown[];
  try {
    rows = await read(plan.select);
  } catch (err) {
    const without = withoutBrandsOk(plan.select);
    if (without === plan.select || !missingColumn(err, "brands_ok")) throw err;
    rows = await read(without);
  }
  return rows.map((a) => answerRow(a as Record<string, unknown>));
}

/**
 * The fixture's copy of a shaped read: the plan's prompts kept and each row
 * cut to the plan's columns and mapped as the Supabase read maps it, so a
 * page that needs what it did not ask for shows it on the fixture, in specs
 * and in parity, too.
 */
export function shapeRead(data: OverviewData, opts: ReadOpts = {}): OverviewData {
  const plan = answerPlan(opts);
  const s = opts.structure ?? data;
  const ids = plan && planPrompts(plan, s);
  const keep = ids && new Set(ids);
  const answers = plan === null ? [] : data.answers.filter((a) => keep === null || keep.has(a.question_id)).map((a) => answerRow(selectColumns(a, plan.select)));
  return { ...data, clusters: s.clusters, questions: s.questions, keywords: s.keywords, answers };
}

/**
 * The one-cluster page's answers panel (T7 part 3b; DB-2, 9 Oct 2026): one
 * prompt's answers at one check, with their words - the day `?day=` names
 * (latest-answers.ts pickedDay), or else the latest day with an answer on or
 * before the range's last (audit data-3: a failed run still stores its reads,
 * unanswered, and picked by any row it put four blank tabs over yesterday's
 * real answers). A picked day is read as it is, answered or not, so a failed
 * day shows its blank tabs and a day with no check shows none.
 *
 * One decision, taken here for both reads, as answerPlan is for the range:
 * loadAnswerDay runs readAnswerDay on tracking_answers, the fixture repo runs
 * shapeAnswerDay on its rows, and read-shape.test.mts holds readAnswerDay on a
 * fake PostgREST equal to shapeAnswerDay on the fixture, every state. The
 * client and the prompt are the page's own (its membership check and its
 * cluster's prompts), never the URL's: `?day=` moves the date and nothing else.
 */
export type DayPlan = { question: string; day: Day | null; to: Day };

export function dayPlan(question: string, to: Day, day: Day | null): DayPlan {
  return { question, day, to };
}

/** The panel's columns: the words, which no other read takes, and when each answer was stored. Read again without brands_ok while it is missing. */
export const DAY_SELECT = "engine, answered, named, response_text, brands, brands_ok, citations, created_at";

/** One answer as the panel holds it, from a row as DAY_SELECT returned it. */
export function dayRow(a: Record<string, unknown>): LatestRow {
  return {
    engine: a.engine as string,
    answered: a.answered as boolean,
    named: a.named as boolean,
    text: typeof a.response_text === "string" ? a.response_text : null,
    brands: Array.isArray(a.brands) ? (a.brands as unknown[]).filter((b): b is string => typeof b === "string") : [],
    ...(a.brands_ok === false ? { brands_ok: false as const } : {}),
    citations: Array.isArray(a.citations) ? (a.citations as LatestRow["citations"]) : [],
    at: typeof a.created_at === "string" ? a.created_at : null,
  };
}

/** The query-builder calls the panel's read makes: supabase-js's, or the fake PostgREST in read-shape.test.mts. */
export type DayQuery = PromiseLike<{ data: unknown[] | null; error: { message: string } | null }> & {
  eq(column: string, value: string | boolean): DayQuery;
  lte(column: string, value: string): DayQuery;
  order(column: string, options: { ascending: boolean }): DayQuery;
  limit(count: number): DayQuery;
};
export type DayTable = () => { select(columns: string): DayQuery };

/**
 * The panel's read on a plan: at most one row to find the latest day, then at
 * most one per engine - two small reads and no paging, each held to one
 * client and one prompt. Moved here from overview-data.ts loadLatestAnswers
 * with DB-2, so it runs under node --test.
 */
export async function readAnswerDay(table: DayTable, plan: DayPlan, clientId: string): Promise<LatestAnswers> {
  let day = plan.day;
  if (day === null) {
    const { data, error } = await table().select("run_date").eq("client_domain_id", clientId).eq("question_id", plan.question).eq("answered", true).lte("run_date", plan.to).order("run_date", { ascending: false }).limit(1);
    if (error) throw new Error(`could not read the latest check: ${error.message}`);
    day = (data?.[0] as { run_date?: Day } | undefined)?.run_date ?? null;
    if (!day) return { day: null, rows: [] };
  }
  const on = day;
  const read = async (select: string) => {
    const { data, error } = await table().select(select).eq("client_domain_id", clientId).eq("question_id", plan.question).eq("run_date", on).order("id", { ascending: true });
    if (error) throw new Error(`could not read the check's answers: ${error.message}`);
    return (data ?? []) as Record<string, unknown>[];
  };
  let rows: Record<string, unknown>[];
  try {
    rows = await read(DAY_SELECT);
  } catch (err) {
    if (!missingColumn(err, "brands_ok")) throw err;
    rows = await read(withoutBrandsOk(DAY_SELECT));
  }
  return { day: on, rows: rows.map(dayRow) };
}

/** A tracking_answers row as the panel's read sees it: what the fixture stands in for, and the test's fake table holds. */
export type StoredAnswer = AnswerRow & CitationRow & { response_text: string | null; created_at: string | null };

/** The fixture's copy of readAnswerDay: one client's rows, the day picked as the read picks it, each row cut to DAY_SELECT and mapped as the read maps it. */
export function shapeAnswerDay(rows: readonly StoredAnswer[], plan: DayPlan): LatestAnswers {
  const mine = rows.filter((a) => a.question_id === plan.question);
  // As readAnswerDay picks it (audit data-3): the latest day with an answer, so a failed day's blank rows never stand in.
  const day = plan.day ?? mine.reduce<Day | null>((d, a) => (a.run_date <= plan.to && a.answered && (d === null || a.run_date > d) ? a.run_date : d), null);
  if (!day) return { day: null, rows: [] };
  return { day, rows: mine.filter((a) => a.run_date === day).map((a) => dayRow(selectColumns(a, DAY_SELECT))) };
}

/**
 * Reports' one read (perf-1): from the furthest any monthly card looks back -
 * the oldest month's own comparison period - to today. It was the whole span
 * on "prev", which reads as far again before the first month as the history
 * is long, so a year of history read two.
 */
export function reportSpan(months: readonly { range: Range }[], today: Day): Range {
  let from: Day = today;
  for (const m of months) {
    const back = comparisonRange(m.range, "prev")?.from ?? m.range.from;
    if (back < from) from = back;
  }
  return { from, to: today };
}

/**
 * One month card's rows (perf-1): the answers and readings in the month and
 * the comparison period before it, the only days monthFigures counts.
 * Every card used to scan the whole history's rows, a dozen times over for a
 * year; held equal to the unsliced card in read-shape.test.mts.
 */
export function monthSlice(data: OverviewData, range: Range): OverviewData {
  const from = comparisonRange(range, "prev")?.from ?? range.from;
  const inside = (d: Day) => d >= from && d <= range.to;
  return { ...data, answers: data.answers.filter((a) => inside(a.run_date)), serp: data.serp.filter((s) => inside(s.run_date)) };
}

/**
 * The earliest day a range stated in the URL may start (8 Oct 2026, audit
 * perf-8): the first of the month a year before today, or the first of the
 * month tracking began in when that is longer ago. `rangeFrom` honoured any
 * from up to today, so a hand-edited `?from=1900-01-01` read and drew 46,000
 * days - 134 MB and 66 s for one cluster on the fixture dev server - and
 * doubled it again for the comparison.
 *
 * Not started_on itself: the default range is today's 28 days whatever the
 * client's age, and every page's links carry it, so a client under 28 days
 * old routinely states a from before its start. Clamping that would change
 * the range - and so the figures - between a page and the link it wrote.
 *
 * The first of the month, not the day (review, 8 Oct 2026): Reports' cards
 * are calendar months from the one tracking began in, and each links its
 * CSVs with its own range, which starts on the 1st. On the day itself, a
 * client started on 15 Sep 2025 had its September card's file cut to
 * 15-30 Sep, and one started on 20 Oct 2025 had October's cut to start on 8
 * Oct - a file whose name and rows were not the card's. read-shape.test.mts
 * holds every month card, every preset and the default range unmoved at
 * client ages either side of a year.
 */
export function rangeFloor(today: Day, startedOn: Day | null): Day {
  const yearBack = addDays(today, -365);
  const floor = startedOn && startedOn < yearBack ? startedOn : yearBack;
  return `${floor.slice(0, 7)}-01`;
}

/** A stated range held to `rangeFloor`: an earlier from starts on the floor, and a range wholly before it is none. */
export function boundStated(r: Range, today: Day, startedOn: Day | null): Range | null {
  const floor = rangeFloor(today, startedOn);
  const from = r.from < floor ? floor : r.from;
  return from <= r.to ? { from, to: r.to } : null;
}
