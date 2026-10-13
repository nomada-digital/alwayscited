import Link from "@/components/app/AppLink";

import EngineLogo from "@/components/EngineLogo";
import { PagePath } from "@/components/app/PagePath";
import { CLOSE_WASH, D } from "@/components/home/dark";
import { T } from "@/config/tokens";
import { ENGINE_SPECS, type Engine } from "@/lib/scan/engines";
import {
  keywordsIn,
  type Day,
  type Range,
  type Rate,
  UNRANKED_AS,
  addDays,
  basis as basisLine,
  brandGaps,
  citedPages,
  comparisonLabel,
  dailySeries,
  daysIn,
  firstCheckDay,
  firstReadComplete,
  formatDay,
  keywordRows,
  movers,
  namedRate,
  overview,
  pointsDelta,
  sparkPoints,
  ungroupedRead,
} from "@/lib/tracking/figures";
import { type ClusterCard, clusterCards, clusterChart, clusterSummary, keyFigureChanges, pendingBasis } from "@/lib/tracking/cluster-figures";
import { NO_PROMPT_NO_CHECK, checkTime, clockIn } from "@/lib/tracking/check-time";
import { rangeLabel } from "@/lib/tracking/date-range";
import { whoIsNamedCard } from "@/lib/tracking/named-figures";
import type { Compare, OverviewData } from "@/lib/tracking/overview-data";
import { type PlacementRow, chartMarkers } from "@/lib/tracking/placement-figures";
import { MISSING_READS, brandGapNote, failedTodayNote, lostReads, runNote, sovGapNote, todayRun } from "@/lib/tracking/run-note";
import { answerHref, answersByPromptDay, dayAnswerIn } from "@/lib/tracking/evidence";
import { type ChangeLink, type Diff, diffChecks } from "@/lib/diy/changes/diff";
import { type Bullet, clusterChanges, headline, whatItMeans } from "@/lib/diy/changes/meaning";
import { engineRates } from "@/lib/diy/ai/engine-rates";
import { addedFromWork } from "@/lib/diy/ai/prompt-table";

import type { ChartMark } from "./chart-board";
import ClusterChart from "./ClusterChart";
import SinceLastCheck from "./SinceLastCheck";
import DatePicker from "./DatePicker";
import Fig from "./Fig";
import OverviewChart, { type ChartDay } from "./OverviewChart";
import GridKeys from "./GridKeys";
import ScrollCue from "./ScrollCue";
import { SEE_ALL, navFrom } from "./nav";

/** The Ungrouped prompts card's rows before it points to Clusters (DS58). */
const UNGROUPED_ROWS = 10;

/** R132: a card's link to its full page, or "Coming soon" unlinked while that page is not built (R130's rule). */
function SeeAll({ card, clientPath, keep }: { card: keyof typeof SEE_ALL; clientPath: string | null; keep: string }) {
  const to = clientPath ? navFrom(SEE_ALL[card], clientPath) : null;
  if (to)
    return (
      // BRIEF-4: from/to/compare kept, so the full page opens on the panel's range.
      <Link href={`${to}?${keep}`} style={{ fontSize: "14px", fontWeight: 600, color: T.accent, textDecoration: "none", whiteSpace: "nowrap" }}>
        See all
        <span className="sr-only">{`: ${card}`}</span>
      </Link>
    );
  return (
    <span aria-disabled="true" style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "14px", fontWeight: 500, color: T.soft, whiteSpace: "nowrap", cursor: "default" }}>
      See all
      <span style={{ fontSize: "10px", fontWeight: 600, color: T.soft, background: T.chip, borderRadius: "999px", padding: "2px 6px" }}>Coming soon</span>
    </span>
  );
}

/**
 * The alwaystracked overview (T4, 29 Sep 2026), in the order
 * boards/Main.dc.html draws it: the dark headline card and the check grid,
 * the four key figures, the chart, biggest movers and who is named instead,
 * then Google keywords and the pages the engines cite most (biggest movers
 * became R138's "Ungrouped prompts" card, 30 Sep 2026). Since T4b part 3
 * (30 Sep 2026) the headline, heat map and key figures read by cluster, as
 * boards-3/Main.dc.html draws them, from `cluster-figures.ts`.
 *
 * Every figure is a count from stored rows (BRIEF decision 10), computed in
 * `figures.ts`, and each rate is shown with its numerator and denominator.
 * Rendered on the server, so the settled figures are there with JS off.
 */

const WORDS = ["no", "one", "two", "three", "four", "five"];

function enginesSentence(engines: readonly Engine[]): string {
  const names = engines.map((e) => ENGINE_SPECS[e].label);
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : (names[0] ?? "");
}

const span = (r: Range, year = false) => `${formatDay(r.from)} - ${formatDay(r.to, year)}`;
const pct = (r: Rate) => (r.pct === null ? "-" : `${r.pct}%`);

/**
 * What a change is against, on the chip itself (ON-3, 9 Oct 2026): "vs your
 * first reading, 3 Oct", "vs 5 Aug - 1 Sep" (figures.ts comparisonLabel). It
 * is read out after the figure; the page says it once where the eye lands -
 * the date face, the column heads and the captions. Not a hover title too
 * (review, same day): a title saying the same words was read twice.
 */
export function VsText({ vs }: { vs?: string | null }) {
  return vs ? <span className="sr-only" data-vs="">{` ${vs}`}</span> : null;
}

function Delta({ value, unit = " pts", dark = false, vs = null }: { value: number | null; unit?: string; dark?: boolean; vs?: string | null }) {
  if (value === null) return null;
  if (value === 0)
    return (
      <span style={{ fontSize: "13px", color: dark ? D.cardHead : T.soft, whiteSpace: "nowrap" }}>
        No change
        <VsText vs={vs} />
      </span>
    );
  const up = value > 0;
  const fg = dark ? D.accent : up ? T.goodFg : T.badFg;
  const bg = dark ? D.field : up ? T.goodBg : T.badBg;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "2px", padding: "2px 8px 2px 5px", borderRadius: "999px", background: bg, color: fg, fontSize: "13px", fontWeight: 600, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={fg} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d={up ? "M6 15l6-6 6 6" : "M6 9l6 6 6-6"} />
      </svg>
      {up ? "+" : "−"}
      {Math.abs(value)}
      {unit}
      <VsText vs={vs} />
    </span>
  );
}

const CARD: React.CSSProperties = { background: T.surface, border: `1px solid ${T.line}`, borderRadius: "18px" };
const H2: React.CSSProperties = { margin: 0, fontSize: "19px", fontWeight: 700, letterSpacing: "-0.022em", color: T.ink };
const LABEL: React.CSSProperties = { fontSize: "13px", fontWeight: 600, color: T.soft };
const TH: React.CSSProperties = { textAlign: "left", fontSize: "12px", fontWeight: 600, color: T.soft, padding: "10px 24px", borderBottom: `1px solid ${T.line}` };
const TD: React.CSSProperties = { padding: "12px 24px", borderBottom: `1px solid ${T.hair}`, fontSize: "14px", color: T.ink, verticalAlign: "middle", whiteSpace: "nowrap" };
/** The one column that wraps and takes the slack. */
const TD_WIDE: React.CSSProperties = { ...TD, whiteSpace: "normal", width: "100%", minWidth: "160px" };

/** The heat colour of one check-grid cell: the dark ground's bar at 0%, the dark accent at 60% and over. */
const heat = (p: number | null) => (p === null ? D.bar : `color-mix(in srgb, ${D.accent} ${Math.round(Math.min(p / 60, 1) * 100)}%, ${D.bar})`);

export default function Overview({
  brand,
  domain,
  market,
  engines,
  startedOn,
  today,
  range,
  compareMode,
  data,
  selected,
  clustersPath,
  clusterLimit,
  reportPath,
  placements,
  canWrite = true,
  ended = false,
  lead = null,
  recent,
  thisWeek = null,
  workLog = null,
  origins,
  marks,
}: {
  /**
   * 13 Oct 2026, DIY P4 (spec 10 section 4.1 row 5): the last week of checks
   * for "Since last check", whatever the range shows - the page's own read when
   * its range holds that week, a narrow read when it does not, or `ok: false`
   * when that read failed (the section says so; the rest of the page draws).
   * None draws no section (/app/parity).
   */
  recent?: { ok: true; data: Pick<OverviewData, "answers" | "serp" | "runs"> } | { ok: false };
  /** 13 Oct 2026, DIY P4: the slots P5 fills in wave 1 - P3's This week (section 4.1 row 6) and work log (row 10). */
  thisWeek?: React.ReactNode;
  workLog?: React.ReactNode;
  /** P2's prompt origins by prompt id (loadPromptOrigins), for the basis line under the key figures (row 4). None draws no line. */
  origins?: ReadonlyMap<string, string>;
  /** Work markers for the chart (row 8): Actions items started and done, placements live. None draws none. */
  marks?: ChartMark[];
  /** client_domains.status is ended: no next check is promised (8 Oct 2026, audit activation-5). */
  ended?: boolean;
  /** ON-3 (9 Oct 2026): the activation checklist, drawn under the page's heading and date. */
  lead?: React.ReactNode;
  /** DS75 (2 Oct 2026): owner or editor. A viewer cannot group prompts, so the ungrouped card sends them to Clusters to see them, not to group them. */
  canWrite?: boolean;
  /** R97 part 5: the client's placements, on mentioned and above; the cluster chart's "Show placements" draws the live ones. Undefined draws no switch. */
  placements?: (PlacementRow & { cluster_id: string })[];
  /** R90 T8: the client's CSV route (api/app/[client]/report); none on /app/parity. */
  reportPath?: string;
  brand: string;
  domain: string;
  market: string;
  engines: readonly Engine[];
  startedOn: Day | null;
  today: Day;
  range: Range;
  compareMode: Compare;
  data: OverviewData;
  /** The cluster the chart shows, from `?cluster=`. */
  selected?: string;
  /** The client's Clusters page (T6), for the phone chart's "Open this cluster"; none on /app/parity. */
  clustersPath?: string;
  /** The client's cluster_limit, for the board's "N of 10 clusters in use" beside "Manage clusters". */
  clusterLimit?: number;
}) {
  const where = market === "UK" ? "the United Kingdom" : "the United States";
  // 9 Oct 2026 (audit copy-2, ia-9): every check time here is the client's zone's, labelled, from the
  // cron's hour on the day meant (check-time.ts). A bare London time was an hour wrong from 25 Oct.
  const next = checkTime(addDays(today, 1), market);
  const o = overview({ range, compare: compareMode, startedOn, engines, questions: data.questions, answers: data.answers, serp: data.serp, keywordCount: keywordsIn(data.keywords, range), keywords: data.keywords, runs: data.runs });
  // 8 Oct 2026 (audit data-10): a young client's comparison is its first week, and the charts draw no dashed
  // "same day last period" line for it - a week laid over the range's first seven days would read as a period it is not.
  // ON-3 (9 Oct 2026): nor against a first reading - one day is not a period to lay over the range.
  const chartBefore = o.compareKind === "start" || o.compareKind === "first" ? null : o.compare;
  // ON-3: every chip says what its change is against, from which date (Chip's `vs`).
  const vs = o.compare ? comparisonLabel(o.compare, o.compareKind) : null;
  // BRIEF-3 T4b part 3 (30 Sep 2026): the headline, heat map and four figures
  // read by cluster (boards-3/Main.dc.html). A client with no cluster rows yet
  // keeps the flat T4 reading rather than print 0 of 0. `?.` because
  // /app/parity reads docs/parity/T4/fixture.json, generated before clusters.
  // R138: cluster rows with no prompt in any of them are still the ungrouped state.
  const clusterInput = data.clusters?.length && data.questions.some((q) => q.cluster_id)
    ? { clusters: data.clusters, questions: data.questions, keywords: data.keywords, answers: data.answers, serp: data.serp, range, before: o.compare, today, engines }
    : null;
  const cards = clusterInput ? clusterCards(clusterInput) : null;
  const cs = cards ? clusterSummary(cards) : null;
  // T4b part 5b: the picked card (?cluster=) sets the chart; the first card by default, as the board opens on c1.
  const picked = cards ? (cards.find((c) => c.id === selected) ?? cards[0]!) : null;
  const drawn = clusterInput && picked ? clusterChart(clusterInput, picked.id) : null;
  const pickedChart = drawn && !chartBefore ? { ...drawn, namedBefore: null, googleBefore: null } : drawn;
  const rangeQuery = { from: range.from, to: range.to, ...(compareMode === "prev" ? {} : { compare: compareMode }) };
  const clusterHref = (id: string) => `?${new URLSearchParams({ ...rangeQuery, cluster: id })}`;
  // R132 (Danny, 30 Sep 2026, danny.md 121): a cluster card opens its one-cluster page (T7) and a
  // prompt row opens it on that prompt. None on /app/parity, which has no Clusters page to open.
  const detailHref = clustersPath
    ? (id: string, prompt?: number) => `${clustersPath}/${encodeURIComponent(id)}?${new URLSearchParams({ ...rangeQuery, ...(prompt === undefined ? {} : { prompt: String(prompt) }) })}`
    : null;
  // T6 (30 Sep 2026): the board's "10 of 10 clusters in use" and "Manage clusters" (phone: "Manage"),
  // counted as the Clusters page counts - a stopped cluster frees its slot at once. None on /app/parity.
  const manage =
    cards && clustersPath
      ? { href: `${clustersPath}?${new URLSearchParams(rangeQuery)}`, inUse: clusterLimit ? `${cards.filter((c) => c.stoppedOn === null).length} of ${clusterLimit} clusters in use` : null }
      : null;
  const clientPath = clustersPath ? clustersPath.replace(/\/clusters$/, "") : null;
  // R90 T8 v1: the board's "Download report" beside the date, as CSVs of this range (api/app/[client]/report).
  const report = reportPath ? (kind: "answers" | "keywords") => `${reportPath}?${new URLSearchParams({ kind, from: range.from, to: range.to })}` : null;
  const pickedHasPrev =!!pickedChart?.namedBefore?.some((p) => p !== null);
  // R124: the phone board's one line under the chart's name - "42% named, #4 on Google. Dashed: 5 Aug - 1 Sep".
  const phoneLine = !picked
    ? ""
    : picked.status === "pending"
      ? `First check tomorrow at ${next}.`
      : `${pct(picked.now)} named, ${picked.position === null ? (picked.keyword ? "no Google position" : "no keyword yet") : `#${picked.position} on Google`}.` +
        (pickedHasPrev && chartBefore ? ` Dashed: ${span(chartBefore)}` : ` Tracked from ${formatDay(picked.started_on)}.`);
  const heatRows = cards ? cards.filter((c) => c.status !== "pending") : [];
  const pendingKeywords = cards ? cards.filter((c) => c.status === "pending" && c.keyword).length : 0;
  // R148 pass 7 (1 Oct 2026): "set up" includes prompts whose first check is tomorrow - on day zero that is all of them.
  const liveQuestions = data.questions.filter((q) => q.stopped_on === null).length;
  // The runner skips a client with no live prompt (decide.ts shouldTrack), so a
  // day-zero client with none must not be promised tomorrow's check (8 Oct 2026, audit activation-4).
  const firstCheckLine = ended ? "Tracking has ended." : liveQuestions ? `Your first check runs tomorrow at ${next}.` : NO_PROMPT_NO_CHECK;
  const hasData = o.named.den > 0;
  const beforeRange = !!startedOn && range.to < startedOn;
  // R151 (3 Oct 2026): with nothing read in the range, the filled "Download report" outweighed the
  // headline's own next step (See your prompts) and fetched an empty CSV. The date stays, to move off it.
  const download = hasData ? report : null;

  const header = (
    <header style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: "24px", flexWrap: "wrap" }}>
      {/* The phone draws no title (Mobile.dc.html), so the page keeps its h1 for screen readers there (R173 pass 3, DS34). */}
      {cards ? <h1 className="sr-only app-show-sm">Overview</h1> : null}
      {/* R90 sweep: the lede wraps before the controls do, so the date and Download report stay on the title's row as on Main.dc.html. */}
      <div style={{ display: "flex", flexDirection: "column", gap: "4px", flex: "1 1 320px", minWidth: 0 }} className={cards ? "app-hide-sm" : undefined}>
        <h1 style={{ margin: 0, fontSize: "28px", fontWeight: 700, letterSpacing: "-0.03em", color: T.ink }}>Overview</h1>
        <p style={{ margin: 0, fontSize: "14px", color: T.soft }}>
          {brand} in {where}. {cards ? `${cards.length} cluster${cards.length === 1 ? "" : "s"} on ` : ""}
          {enginesSentence(engines)}.
        </p>
      </div>
      <div className={cards ? "app-date" : undefined} style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
      {download ? (
        <a className="app-hide-sm" href={download("keywords")} download style={{ fontSize: "13px", fontWeight: 600, color: T.accent, textDecoration: "none" }}>
          Keywords CSV
        </a>
      ) : null}
      {/* T5 (30 Sep 2026): the face is drawn here, on the server, so JS off still shows the range; DatePicker opens boards/DatePicker.dc.html on it. */}
      <DatePicker range={range} compare={compareMode} today={today} startedOn={startedOn} firstCheck={firstCheckDay(startedOn, data.questions)} firstComplete={firstReadComplete(data.runs, firstCheckDay(startedOn, data.questions))}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={T.ink} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="5" width="18" height="16" rx="2" />
          <path d="M3 10h18M8 3v4M16 3v4" />
        </svg>
        {/* Mobile.dc.html: one line, "Last 28 days 2 - 29 Sep", no comparison range. */}
        {cards ? (
          <span className="app-show-sm" style={{ fontSize: "14px" }}>
            <strong>{rangeLabel(range, today, startedOn)}</strong>{" "}
            <span style={{ color: T.soft }}>{span(range)}</span>
          </span>
        ) : null}
        <span className={cards ? "app-hide-sm" : undefined} style={{ display: "flex", flexDirection: "column", lineHeight: 1.25 }}>
          <span style={{ fontSize: "14px", fontWeight: 700 }}>{rangeLabel(range, today, startedOn)}</span>
          <span style={{ fontSize: "12px", color: T.soft }}>
            {span(range, true)}
            {o.compare ? `, ${comparisonLabel(o.compare, o.compareKind)}` : ""}
          </span>
        </span>
      </DatePicker>
      {/* Main.dc.html: the dark "Download report" after the date; "Download CSV" since 13 Oct 2026 (DIY P4, RP-1: it is the range's CSV). */}
      {download ? (
        <a className="app-hide-sm" href={download("answers")} download style={{ display: "inline-flex", alignItems: "center", gap: "8px", height: "48px", padding: "0 18px", boxSizing: "border-box", borderRadius: "12px", background: T.ink, color: T.surface, fontSize: "14px", fontWeight: 600, textDecoration: "none" }}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke={T.surface} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
          </svg>
          Download CSV
        </a>
      ) : null}
      </div>
    </header>
  );

  // 8 Oct 2026 (audit data-3 / reliability-3): today's run of any status. A failed one read "Nothing from
  // today's check yet", and one still queued or running read the same as one not yet started.
  const todays = todayRun(data.runs, today);
  // The range's lost checks - partial or failed days, whose reads every figure leaves out - in one note under
  // the line; a failed today is the line's own, so the note leaves it out.
  // Review of audit data-3 (8 Oct 2026): the failed-today line says where the figures run to, so only on a
  // range that ends today - an earlier range gets an aside after "Last checked". A failed run can have stored
  // its answers first (runner.ts), which every figure then counts; run-note.ts reads which it was.
  const failed = failedTodayNote(data, range, today);
  const lostNote = runNote(data, range, today, { skipToday: !!failed?.line });
  // R151 (1 Oct 2026): a partial run (decide.ts runOutcome - some reads failed after the retry)
  // said "Checked today" like a whole one. The figures skip an unanswered read, so say so - in the note when there is one.
  // 8 Oct 2026: not for a run partial only because brand extraction failed - no read was lost;
  // the Who is named instead panel says what was (brandGapNote), and runNote leaves it out too (runLostReads).
  const missing = lostReads(data.lastRun) && !lostNote ? ` ${MISSING_READS}` : "";
  const nextLine = ended ? "Tracking has ended, so no more checks run." : liveQuestions ? `Next check tomorrow at ${next}.` : "No more checks until a cluster has prompts.";
  const checked = failed?.line
    ? `${failed.line} ${nextLine}`
    : data.lastRun?.finished_at
      ? data.lastRun.run_date === today
        ? `Checked today at ${clockIn(data.lastRun.finished_at, market)}.${missing} ${ended ? "Tracking has ended, so this was the last check." : liveQuestions ? `Next check tomorrow at ${next}.` : "No more checks until a cluster has prompts."}`
        : `Last checked ${formatDay(data.lastRun.run_date)} at ${clockIn(data.lastRun.finished_at, market)}.${missing} ${ended ? "Tracking has ended, so no more checks run." : !liveQuestions ? "No more checks until a cluster has prompts." : range.to === today ? (todays && todays.status !== "complete" && todays.status !== "partial" ? "Today's check has not finished yet, so today is blank." : "Nothing from today's check yet, so today is blank.") : failed?.aside ? `${failed.aside} Next check tomorrow at ${next}.` : `Next check at ${checkTime(today, market)}.`}`
      : firstCheckLine;
  // Mobile.dc.html: "Checked today at" its time, nothing after it. DS8 (2 Oct 2026, R172 pass 1): a
  // partial run is not on the board, and "some reads missing" alone left the phone guessing what
  // it meant for the figures, so the phone says the same sentence the desktop line does.
  const checkedShort = failed?.line ? failed.line : data.lastRun?.finished_at && data.lastRun.run_date === today ? `Checked today at ${clockIn(data.lastRun.finished_at, market)}${missing ? `.${missing}` : ""}` : null;

  if (!hasData) {
    // R148 pass 7 (1 Oct 2026): only a start that has happened "began" - on day zero it starts tomorrow, and said "Tracking began" with tomorrow's date.
    const line = beforeRange && startedOn && startedOn <= today ? `Tracking began ${formatDay(startedOn, true)}.` : firstCheckLine;
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "24px", minWidth: 0 }}>
        {header}
        {lead}
        <section aria-label="Headline" className="on-dark" style={{ padding: "36px 40px", borderRadius: "18px", background: `${CLOSE_WASH}, ${D.ground}`, color: T.surface }}>
          <h2 style={{ margin: 0, fontSize: "28px", lineHeight: 1.2, fontWeight: 700, letterSpacing: "-0.03em" }}>{line}</h2>
          <p style={{ margin: "12px 0 0", fontSize: "16px", lineHeight: 1.55, color: D.cardHead, maxWidth: "520px" }}>
            {ended ? (
              // An ended client opens here once its last reading is out of the default range (review of 2379757).
              <>No more checks run.{data.lastRun ? ` The last was on ${formatDay(data.lastRun.run_date, true)}; pick a range that includes it to see what was read.` : ""}</>
            ) : (
              <>
                {liveQuestions ? `${liveQuestions} prompts are set up on ${WORDS[engines.length] ?? engines.length} engines. ` : ""}
                The figures fill in from the first daily check, and history starts that day.
              </>
            )}
          </p>
          {/* R148 pass 10 (1 Oct 2026): a new buyer's first view had no next step; the prompts it names are one click away. */}
          {clustersPath && liveQuestions && !ended ? (
            <Link href={clustersPath} style={{ display: "inline-flex", alignItems: "center", height: "48px", marginTop: "20px", padding: "0 18px", boxSizing: "border-box", borderRadius: "12px", background: T.surface, color: T.ink, fontSize: "14px", fontWeight: 600, textDecoration: "none" }}>
              See your prompts
            </Link>
          ) : null}
        </section>
        {thisWeek}
      </div>
    );
  }

  // ---- 1. headline ----
  // DS1 / R177 (2 Oct 2026): clusters and ungrouped prompts with readings side by side. The headline and the
  // first figures then count every prompt, as Who is named does, and say so; by cluster only when all are grouped.
  const loose = cs ? ungroupedRead(data.questions, data.answers, range) : 0;
  const byCluster = cs && !loose ? cs : null;
  const looseWords = `${loose} ungrouped prompt${loose === 1 ? "" : "s"}`;
  // A pending cluster has no answers yet, so it is not named in the count ("5 ungrouped prompts", not "0 clusters and ...").
  const across = !cs ? "" : loose && !cs.clusters ? looseWords : `${cs.clusters} cluster${cs.clusters === 1 ? "" : "s"}${loose ? ` and ${looseWords}` : ""}`;
  const fig = byCluster
    ? { now: byCluster.now, promptsNamed: byCluster.promptsNamed, promptsNamedBefore: byCluster.promptsNamedBefore, never: byCluster.never.length }
    : { now: o.named, promptsNamed: o.questions, promptsNamedBefore: o.questionsBefore && o.questionsBefore.den ? o.questionsBefore : null, never: o.questions.den - o.questions.num };
  // 8 Oct 2026 (audit data-4): every key figure's chip is its like-for-like change, as the headline's is
  // (cluster-figures.ts keyFigureChanges, where the rule and its tests live).
  const chg = keyFigureChanges(o, cs, byCluster);
  const lflDelta = chg.named;
  const promptsChange = chg.promptsLine;
  const lflWhat = byCluster ? "clusters" : "prompts";
  const changeCaption = o.compare
    ? o.compareKind === "start"
      ? `Every change is like-for-like, against your first week (${span(o.compare)}): it counts only the ${lflWhat} tracked since then.`
      : o.compareKind === "first"
        ? `Every change is like-for-like, against your first reading (${formatDay(o.compare.from)}): it counts only the ${lflWhat} tracked since then.`
        : `Every change is like-for-like: it counts only the ${lflWhat} tracked all of this period and ${span(o.compare)}.`
    : null;
  // An average position counts a keyword outside the top 20 as #21 (audit data-7), and says so.
  const avgLine = (k: { avg: number | null; ranked: number; unranked: number }) =>
    !k.ranked ? "No keyword in the top 20 yet" : `Average position ${k.avg}${k.unranked ? `; the ${k.unranked} outside the top 20 count${k.unranked === 1 ? "s" : ""} as #${UNRANKED_AS}` : ""}`;
  const gridDays = daysIn(range).slice(-28);
  const gridFrom = daysIn(range).length - gridDays.length;
  const questionsAnswered = o.questions.den;
  const direction = (d: number) => (d > 0 ? "up from" : d < 0 ? "down from" : "the same as");
  const headlineRate = fig.now;
  // 13 Oct 2026, DIY P4: the desktop sub-line and its like-for-like sentence are the headline paragraph now
  // (lib/diy/changes/meaning.ts headline, below); the phone's short line keeps its own words.
  const inBefore = o.compareKind === "start" ? " in your first week" : o.compareKind === "first" ? " on your first reading" : "";
  // The prompts tracked from the comparison's first day to the range's last: like-for-like when not by cluster.
  const lflIds = o.compare ? new Set(data.questions.filter((q) => q.added_on <= o.compare!.from && (q.stopped_on === null || q.stopped_on > range.to)).map((q) => q.id)) : null;
  // Audit ia-3 (8 Oct 2026): the brand named in most of the headline's own answers, on the headline's basis.
  // Review of audit ia-3 (8 Oct 2026): the card below and this line read the headline's own answers - by
  // cluster, the prompts of the clusters with readings - and the card's change the headline's like-for-like ones.
  const who = whoIsNamedCard({ answers: data.answers, range, before: o.compare, you: brand, only: byCluster ? byCluster.ids : null, lfl: byCluster ? byCluster.lflIds : lflIds });
  const leader = [...who.page.rows].sort((x, y) => y.answers - x.answers)[0];
  // Merge of audit packages A and B (8 Oct 2026): the card is a brand figure, so on a range whose other brands
  // were not all read (figures.ts brandsRead) the leader's share is of the answers that were, and says so.
  const leaderOf = who.page.answers === fig.now.den ? "the same answers" : `the ${who.page.answers.toLocaleString("en-GB")} of them whose other brands were read`;
  const leaderLine = !leader || !leader.answers ? "" : leader.you ? " No other brand was named in more of them." : ` ${leader.name} was named in ${pct(leader.reach)} of ${leaderOf}.`;

  // ---- 13 Oct 2026, DIY P4 (spec 10 section 4.1 rows 3 to 6) ----
  // The headline paragraph: one rule over the figures above, in its first-reading, compared or plain variant.
  const readDays = new Set(data.answers.filter((a) => a.answered).map((a) => a.run_date));
  const firstReading = readDays.size === 1 && !o.compare ? [...readDays][0]! : null;
  const said = headline({
    named: fig.now,
    prompts: byCluster ? byCluster.prompts : questionsAnswered,
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
  const bulletHref = (b: Bullet): string | null =>
    !b.link || !clientPath
      ? null
      : b.link.to === "engine"
        ? `${clientPath}/ai?${new URLSearchParams({ ...rangeQuery, eng: b.link.engine })}`
        : b.link.to === "cluster" && detailHref
          ? detailHref(b.link.cluster)
          : null; // a keyword is plain text until the Google page exists (wave 2)
  // "Since last check" over the last week of checks, whatever the range (section 6.8).
  const promptAt = new Map((cards ?? []).flatMap((c) => c.prompts.map((p, i) => [p.id, { cluster: c.id, index: i }] as const)));
  const diff: Diff | { error: true } | null = !recent
    ? null
    : !recent.ok
      ? { error: true }
      : diffChecks({
          today,
          answers: recent.data.answers,
          serp: recent.data.serp,
          runs: recent.data.runs,
          prompts: data.questions.map((q) => ({ id: q.id, text: q.text })),
          keywords: cards
            ? cards.filter((c) => c.keywordId && c.keyword).map((c) => ({ id: c.keywordId!, keyword: c.keyword! }))
            : data.keywords.filter((k) => k.stopped_on === null).map((k) => ({ id: k.id, keyword: k.keyword })),
          brand,
          domain,
          engines,
        });
  const changeHref = (l: ChangeLink): string | null => {
    if (!clientPath) return null;
    if (l.to === "answer") {
      const at = promptAt.get(l.question);
      return at && clustersPath ? answerHref(`${clustersPath}/${encodeURIComponent(at.cluster)}`, { ...rangeQuery, prompt: String(at.index) }, { day: l.day, engine: l.engine }) : null;
    }
    if (l.to === "engine") return `${clientPath}/ai?${new URLSearchParams({ ...rangeQuery, eng: l.engine })}`;
    if (l.to === "cited") return `${clientPath}/cited?${new URLSearchParams({ ...rangeQuery, kind: "yours" })}`;
    if (l.to === "named") return `${clientPath}/named?${new URLSearchParams({ ...rangeQuery, open: l.key })}`;
    if (l.to === "href") return l.href;
    return null; // a keyword: plain text until the Google page exists (wave 2)
  };
  // The basis line under the key figures (row 4): prompts added from work, which are likelier to name the client.
  const fromWork = origins ? addedFromWork(origins, data.questions.filter((q) => q.stopped_on === null && q.added_on <= today).map((q) => q.id)) : null;

  // ---- 3. chart ----
  const toChart = (days: ReturnType<typeof dailySeries>): ChartDay[] => days.map((d) => ({ label: formatDay(d.day), all: d.all, by: d.by }));
  // Left out of like-for-like: added after the comparison began (audit data-10: for a young client that is its
  // first day, so the prompts it began with are not "added mid-range").
  const addedMid = data.questions.filter((q) => q.added_on > (o.compare ? o.compare.from : range.from) && q.added_on <= range.to);
  const lflNote =
    o.lfl && addedMid.length
      ? `Like-for-like leaves out the ${addedMid.length === 1 ? "prompt" : `${addedMid.length} prompts`} added on ${[...new Set(addedMid.map((q) => formatDay(q.added_on)))].join(", ")}.`
      : o.compareHidden;
  const notes = [
    ...data.notes.map((n) => ({ day: n.note_date, text: n.text })),
    ...[...new Set(addedMid.map((q) => q.added_on))].map((d) => {
      const n = addedMid.filter((q) => q.added_on === d).length;
      return { day: d, text: `${n} prompt${n === 1 ? "" : "s"} added` };
    }),
  ]
    .map((n) => ({ index: daysIn(range).indexOf(n.day), text: n.text }))
    .filter((n) => n.index >= 0);

  // ---- 4 and 5 ----
  const moved = movers(data.answers, range, o.compare);
  // Audit ia-3 (8 Oct 2026): "Who is named instead" on the headline's basis - answers naming each brand, of
  // the headline's answers - from Who is named's own rows (named-figures.ts whoIsNamedCard), so the two pages
  // cannot drift. Its share of every brand mention set a trailing client's 10% beside a leader's 22%, under a
  // headline of 27%. The change is like-for-like, as every chip on the page.
  const whoPage = who.page;
  const whoLfl = who.change;
  const board = [...whoPage.rows].filter((r) => r.answers > 0).sort((x, y) => y.answers - x.answers);
  // 8 Oct 2026 (audit data-6): answers whose other brands were not read are out of the card and share of voice.
  // Merge of audit packages A and B (8 Oct 2026): the note counts the card's own answers - the headline's prompts -
  // so the card's answers and the note's add up to the headline's. Share of voice counts every prompt, so by
  // cluster it can leave out more - a pending cluster's moved prompts' - and then says how many (review of the
  // integration, same day; run-note.ts sovGapNote).
  const gaps = brandGaps(byCluster ? data.answers.filter((a) => byCluster.ids.has(a.question_id)) : data.answers, range);
  const gapNote = [brandGapNote(gaps), sovGapNote(gaps, brandGaps(data.answers, range))].filter(Boolean).join(" ") || null;
  const top = board.slice(0, 5);
  const rest = board.slice(5);
  const kwRows = keywordRows(data.serp, { from: addDays(range.to, -27) < range.from ? range.from : addDays(range.to, -27), to: range.to });
  const pages = citedPages(data.answers, range, domain);

  // The lower cards; the cluster layout keeps two of them (boards-3/Main.dc.html).
  // R138 (Danny, 30 Sep 2026, danny.md 126): a client with no prompt in a cluster gets one
  // "Ungrouped prompts" card in place of the old flat Biggest movers list. No board draws it,
  // so it is the Overview board's cluster card - same card, same type scale - with a row per prompt.
  const ungroupedCard = (() => {
    // R151 (3 Oct 2026): beside clusters (pilot-mixed) the card shows too, so it holds only the prompts
    // in no cluster and reads its rate from their answers - the read ones had no card on the Overview.
    const mine = cards ? data.questions.filter((q) => (q.cluster_id ?? null) === null) : data.questions;
    const ids = cards ? new Set(mine.map((q) => q.id)) : undefined;
    const rateNow = cards ? namedRate(data.answers, range, ids) : o.named;
    // Audit data-4 (8 Oct 2026): the chip is like-for-like, on these prompts tracked all of both periods.
    const same = lflIds ? (ids ? new Set([...ids].filter((id) => lflIds.has(id))) : lflIds) : null;
    const sameNow = same && o.compare ? namedRate(data.answers, range, same) : null;
    const sameBefore = same && o.compare ? namedRate(data.answers, o.compare, same) : null;
    const change = sameNow && sameBefore?.den ? pointsDelta(sameNow, sameBefore) : null;
    const live = mine.filter((q) => q.stopped_on === null && q.added_on <= today);
    // R151 (3 Oct 2026): Clusters lists these too ("Ungrouped prompts 50"), so a card saying
    // 45 read as five prompts gone missing between the two pages.
    const pending = mine.filter((q) => q.stopped_on === null && q.added_on > today).length;
    // DS58 (2 Oct 2026, R173 pass 6): the card ran to 45 rows on the ungrouped state; the Overview's
    // other lists show a few and point to the full page, which has the search (DS55).
    const shown = live.slice(0, UNGROUPED_ROWS);
    const rate = new Map(moved.map((m) => [m.id, m]));
    return (
      <section aria-labelledby="ug-h" style={{ ...CARD, padding: "22px 24px 24px", display: "flex", flexDirection: "column", gap: "14px" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "12px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "3px", minWidth: 0 }}>
            <h2 id="ug-h" style={H2}>
              Ungrouped prompts
            </h2>
            <span style={{ fontSize: "12px", color: T.soft }}>{`${live.length} prompt${live.length === 1 ? "" : "s"}, not yet in a cluster${pending ? `; ${pending} more start${pending === 1 ? "s" : ""} at the next daily check` : ""}`}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
            <Fig style={{ fontSize: "20px", fontWeight: 700, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums" }} def={basisLine(rateNow, "answers")}>
              {pct(rateNow)}
            </Fig>
            <Chip value={change} unit=" pts" none={o.compare ? "New" : ""} vs={vs} />
          </div>
        </div>
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "4px" }}>
          {shown.map((q) => {
            const m = rate.get(q.id);
            return (
              <li key={q.id} style={{ display: "flex", alignItems: "center", gap: "8px", minHeight: "22px" }}>
                <span style={{ flex: "1 1 auto", minWidth: 0, fontSize: "12px", lineHeight: 1.35, fontWeight: 600, color: T.ink, overflowWrap: "anywhere" }}>
                  {q.text}
                </span>
                <span style={{ display: "flex", gap: "3px", flexShrink: 0 }}>
                  {engines.map((e) => (
                    <span key={e} style={{ display: "inline-flex", opacity: m?.engines.includes(e) ? 1 : 0.22 }}>
                      <EngineLogo engine={e} size={16} title={`${ENGINE_SPECS[e].label}${m?.engines.includes(e) ? " named you" : " did not name you"}: ${q.text}`} />
                    </span>
                  ))}
                </span>
                <span aria-hidden="true" className="app-hide-sm" style={{ width: "120px", flexShrink: 0, height: "6px", borderRadius: "3px", background: T.hair, overflow: "hidden" }}>
                  <span style={{ display: "block", height: "100%", width: `${Math.min(100, (m?.now.pct ?? 0) * 1.6)}%`, borderRadius: "3px", background: m?.now.num ? T.accent : T.line }} />
                </span>
                <span style={{ width: "34px", flexShrink: 0, textAlign: "right", fontSize: "12px", fontWeight: 700, fontVariantNumeric: "tabular-nums" }} title={m ? basisLine(m.now, "answers") : undefined}>
                  {m ? pct(m.now) : "-"}
                </span>
              </li>
            );
          })}
        </ul>
        <p style={{ margin: 0, fontSize: "13px", lineHeight: 1.5, color: T.soft }}>
          {live.length > shown.length ? `Showing ${shown.length} of ${live.length}. ` : null}
          {clustersPath ? (
            <>
              {canWrite ? (live.length > shown.length ? "See them all and group them into clusters on the " : "Group these into clusters on the ") : live.length > shown.length ? "See them all on the " : "See them on the "}
              <Link href={clustersPath} style={{ fontWeight: 600, color: T.accent, textDecoration: "none" }}>
                Clusters
              </Link>
              {" page."}
            </>
          ) : (
            "Group these into clusters on the Clusters page."
          )}
        </p>
      </section>
    );
  })();
  const whoNamed = (
    <section aria-labelledby="lb-h" style={{ ...CARD, paddingTop: "22px", minWidth: 0 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "4px", padding: "0 24px 14px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "12px" }}>
              <h2 id="lb-h" style={H2}>
                Who is named instead
              </h2>
              <SeeAll card="Who is named instead" clientPath={clientPath} keep={new URLSearchParams(rangeQuery).toString()} />
            </div>
            <p style={{ margin: 0, fontSize: "14px", color: T.soft }}>{`The share of the ${whoPage.answers.toLocaleString("en-GB")} answers to your prompts that name each brand.`}</p>
            {gapNote ? <p style={{ margin: 0, fontSize: "13px", lineHeight: 1.5, color: T.soft }}>{gapNote}</p> : null}
          </div>
          <ol style={{ listStyle: "none", margin: 0, padding: "0 0 8px" }}>
            {top.map((b, i) => (
              <li key={b.key} className="app-brand" style={{ display: "grid", gridTemplateColumns: "20px minmax(0, 1fr) 72px 40px 78px", gap: "12px", alignItems: "center", padding: "10px 24px", background: b.you ? T.wash : undefined }}>
                <span style={{ fontSize: "13px", color: T.soft, fontVariantNumeric: "tabular-nums" }}>{i + 1}</span>
                <span style={{ fontSize: "14px", fontWeight: b.you ? 700 : 500, color: b.you ? T.accent : T.ink, overflowWrap: "anywhere" }}>{b.name}</span>
                <span aria-hidden="true" className="app-hide-sm" style={{ height: "6px", borderRadius: "999px", background: T.hair }}>
                  <span style={{ display: "block", height: "100%", width: `${Math.round(((b.answers || 0) / (top[0]!.answers || 1)) * 100)}%`, borderRadius: "999px", background: b.you ? T.accent : T.faint }} />
                </span>
                <Fig style={{ fontSize: "14px", fontWeight: 600, fontVariantNumeric: "tabular-nums", textAlign: "right" }} def={basisLine(b.reach, "answers")}>
                  {pct(b.reach)}
                </Fig>
                <span style={{ display: "flex", justifyContent: "flex-end" }}>
                  <Delta value={whoLfl?.get(b.key) ?? null} vs={vs} />
                </span>
              </li>
            ))}
            {rest.length ? (
              <li className="app-brand" style={{ display: "grid", gridTemplateColumns: "20px minmax(0, 1fr) 72px 40px 78px", gap: "12px", alignItems: "center", padding: "10px 24px" }}>
                <span />
                {/* One answer can name several brands, so the others' shares do not add up to a share of their own. */}
                <span style={{ fontSize: "14px", color: T.soft }}>{`${rest.length} other${rest.length === 1 ? "" : "s"}, each named in ${pct(rest[0]!.reach)} or fewer`}</span>
                <span />
                <span />
                <span />
              </li>
            ) : null}
          </ol>
          <p style={{ margin: 0, padding: "4px 24px 20px", fontSize: "13px", color: T.soft }}>{`${board.length} brand${board.length === 1 ? " was" : "s were"} named across ${whoPage.answers.toLocaleString("en-GB")} answers.${whoLfl ? " Changes are like-for-like." : ""}`}</p>
        </section>
  );
  const keywordsCard = (
    // ON-3 (9 Oct 2026): positioned, so the Places chips' absolute .sr-only words are held by this scroller, not the page (as .pkg-scroll, 28 Sep).
    <section aria-labelledby="kw-h" tabIndex={0} style={{ ...CARD, paddingTop: "22px", minWidth: 0, overflowX: "auto", position: "relative" }}>
          <div style={{ padding: "0 24px 14px" }}>
            <h2 id="kw-h" style={H2}>
              Google keywords
            </h2>
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ ...TH, paddingRight: "8px" }}>Keyword</th>
                <th style={{ ...TH, padding: "10px 8px" }} className="app-hide-sm">4 weeks</th>
                <th style={{ ...TH, padding: "10px 8px", textAlign: "right" }}>Position</th>
                <th style={{ ...TH, paddingLeft: "8px", textAlign: "right" }}>Places</th>
              </tr>
            </thead>
            <tbody>
              {data.keywords
                .filter((k) => k.stopped_on === null)
                .map((k) => {
                  const row = kwRows.get(k.id);
                  return (
                    <tr key={k.id}>
                      {/* One line, as the board keeps it; the phone lets it wrap (R104). */}
                      <td style={{ ...TD_WIDE, whiteSpace: "nowrap", fontWeight: 500, paddingRight: "8px" }} className="app-kw">{k.keyword}</td>
                      <td style={{ ...TD, padding: "12px 8px", lineHeight: 0 }} className="app-hide-sm">{row ? <Spark series={row.series} colour={!row.change ? T.soft : row.change > 0 ? T.goodFg : T.badFg} /> : null}</td>
                      <td style={{ ...TD, padding: "12px 8px", textAlign: "right", fontSize: "15px", fontWeight: 700, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                        {/* R151 (3 Oct 2026): held to one line, this pushed the Places column 89px off the 390 card,
                            so it wraps on the phone (.app-kw-note); wrapping everywhere broke it into four lines at 1440. */}
                        {k.added_on > today ? <span className="app-kw-note" style={{ display: "inline-block", fontWeight: 400, fontSize: "13px", lineHeight: 1.35, color: T.soft }}>{`First check tomorrow at ${next}`}</span> : row?.position ? `#${row.position}` : <span style={{ fontWeight: 400, fontSize: "13px", color: T.soft }}>Not in top 20</span>}
                      </td>
                      <td style={{ ...TD, paddingLeft: "8px", textAlign: "right" }}>{row?.change === null || row?.change === undefined ? null : <Delta value={row.change} unit="" vs={row.since ? `since ${formatDay(row.since)}` : null} />}</td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </section>
  );
  const citedCard = (
    <section aria-labelledby="cited-h" style={{ ...CARD, paddingTop: "22px", minWidth: 0 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "4px", padding: "0 24px 14px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "12px" }}>
              <h2 id="cited-h" style={H2}>
                Pages the engines cite most
              </h2>
              <SeeAll card="Pages the engines cite most" clientPath={clientPath} keep={new URLSearchParams(rangeQuery).toString()} />
            </div>
            <p style={{ margin: 0, fontSize: "14px", color: T.soft }}>Times cited in answers to your prompts.</p>
          </div>
          {pages.length ? (
            <ol style={{ listStyle: "none", margin: 0, padding: "0 24px 12px" }}>
              {pages.map((p) => (
                <li key={p.page} style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "center", padding: "12px 0", borderBottom: `1px solid ${T.hair}` }}>
                  <span style={{ display: "flex", flexDirection: "column", gap: "6px", minWidth: 0 }}>
                    <span style={{ fontSize: "14px", fontWeight: 600, overflowWrap: "anywhere" }}><PagePath page={p.page} /></span>
                    <span style={{ display: "flex", gap: "4px", alignItems: "center" }}>
                      {p.engines.map((e) => (
                        <EngineLogo key={e} engine={e as Engine} size={14} title={ENGINE_SPECS[e as Engine]?.label ?? e} />
                      ))}
                    </span>
                  </span>
                  <span style={{ display: "flex", gap: "10px", alignItems: "center", flexShrink: 0 }}>
                    {p.yours ? <span style={{ fontSize: "12px", fontWeight: 600, color: T.accent, background: T.wash, borderRadius: "999px", padding: "2px 8px" }}>You</span> : null}
                    <span style={{ fontSize: "14px", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{p.count}</span>
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <p style={{ margin: 0, padding: "0 24px 20px", fontSize: "14px", color: T.soft }}>No engine cited a page in this range. Pick a longer range at the top of the page.</p>
          )}
          {/* BRIEF T4: the alwaysmentioned line appears only when at least one
              cited publisher provably does not name the client, with that
              count. Nothing stored yet says what a cited page names - the
              runner keeps the citation, not the page - so the line stays off
              rather than claim a count it cannot stand behind. */}
        </section>
  );

  return (
    <div className={cs ? "app-col" : undefined} style={{ display: "flex", flexDirection: "column", gap: "24px", minWidth: 0 }}>
      {header}
      {lead}

      <section aria-label="Headline" className="on-dark app-headline" style={{ position: "relative", display: "flex", flexWrap: "wrap", gap: cs ? "40px" : "48px", padding: cs ? "34px 36px" : "36px 40px", borderRadius: "18px", background: `${CLOSE_WASH}, ${D.ground}`, color: T.surface, overflow: "hidden" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "16px", flex: "1 1 320px", minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", color: D.muted }}>
            <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: D.accent }} />
            {cs && checkedShort ? (
              <>
                <span className="app-hide-sm">{checked}</span>
                <span className="app-show-sm">{checkedShort}</span>
              </>
            ) : (
              checked
            )}
          </div>
          {/* Audit data-3 (8 Oct 2026): earlier partial or failed checks in the range, whose reads every figure below leaves out. */}
          {lostNote ? <p style={{ margin: 0, fontSize: "13px", lineHeight: 1.5, color: D.cardHead, maxWidth: "520px" }}>{lostNote}</p> : null}
          <h2 style={{ margin: 0, fontSize: cs ? "36px" : "40px", lineHeight: 1.12, fontWeight: 700, letterSpacing: "-0.03em", maxWidth: "520px" }} className={cs ? "app-headline-h app-hide-sm" : "app-headline-h"}>
            {brand} was named in <span data-figure="headline-named">{pct(headlineRate)}</span> of AI answers
          </h2>
          {/* Mobile.dc.html's short headline and one-line sub-line (T4b mobile, 30 Sep 2026): the same figures, fewer words. */}
          {cs ? (
            <h2 className="app-show-sm" style={{ margin: 0, fontSize: "28px", lineHeight: 1.15, fontWeight: 700, letterSpacing: "-0.03em" }}>
              {`Named in ${pct(headlineRate)} of AI answers`}
            </h2>
          ) : null}
          <p className={cs ? "app-hide-sm" : undefined} style={{ margin: 0, fontSize: cs ? "15px" : "16px", lineHeight: 1.55, color: D.cardHead, maxWidth: "500px" }}>
            <span data-headline={said.variant}>{said.text}</span>
            {leaderLine}
            {o.compareHidden ? ` ${o.compareHidden}` : ""}
          </p>
          {cs ? (
            <p className="app-show-sm" style={{ margin: 0, fontSize: "14px", lineHeight: 1.5, color: D.cardHead }}>
              {`${fig.now.num.toLocaleString("en-GB")} of ${fig.now.den.toLocaleString("en-GB")} answers across ${across}.`}
              {byCluster ? (byCluster.lflBefore && lflDelta !== null ? ` Like-for-like ${pct(byCluster.lfl)}, ${direction(lflDelta)} ${pct(byCluster.lflBefore)}${inBefore}.` : "") : o.lfl && lflDelta !== null ? ` Like-for-like ${pct(o.lfl.now)}, ${direction(lflDelta)} ${pct(o.lfl.before)}${inBefore}.` : ""}
            </p>
          ) : null}
          {o.compare ? (
            <div className={cs ? "app-hide-sm" : undefined} style={{ display: "flex", gap: "8px", marginTop: "4px", flexWrap: "wrap" }}>
              {lflDelta !== null ? (
                <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", padding: "4px 10px 4px 7px", borderRadius: "999px", background: D.field, color: D.accent, fontSize: "13px", fontWeight: 600 }}>
                  {lflDelta === 0 ? "No change" : `${lflDelta > 0 ? "+" : "−"}${Math.abs(lflDelta)} pts`} like-for-like
                </span>
              ) : null}
              <span style={{ display: "inline-flex", alignItems: "center", padding: "4px 10px", borderRadius: "999px", background: D.fieldLine, color: D.cardHead, fontSize: "13px", fontWeight: 500 }}>{comparisonLabel(o.compare, o.compareKind)}</span>
            </div>
          ) : null}
          {/* 13 Oct 2026, DIY P4 (spec 10 section 4.1 row 3b): "What it means", fixed rules over the figures above. */}
          {bullets.length ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "4px", maxWidth: "520px" }}>
              <h3 id="wim-h" style={{ margin: 0, fontSize: "13px", fontWeight: 600, color: D.muted }}>
                What it means
              </h3>
              <ul aria-labelledby="wim-h" data-meaning="" style={{ margin: 0, padding: "0 0 0 18px", display: "flex", flexDirection: "column", gap: "6px", fontSize: "14px", lineHeight: 1.5, color: D.cardHead }}>
                {bullets.map((b) => {
                  const to = bulletHref(b);
                  const at = to && b.linkText ? b.text.indexOf(b.linkText) : -1;
                  return (
                    <li key={b.kind} data-kind={b.kind}>
                      {to && at >= 0 ? (
                        <>
                          {b.text.slice(0, at)}
                          <Link href={to} style={{ color: T.surface, fontWeight: 600, textDecorationColor: D.quiet, textUnderlineOffset: "3px" }}>
                            {b.linkText}
                          </Link>
                          {b.text.slice(at + b.linkText!.length)}
                        </>
                      ) : (
                        b.text
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
        </div>

        {/* R151 (3 Oct 2026): a pilot whose only cluster starts tomorrow drew this grid with no rows -
            labels and a legend round nothing - while every answer counted came from ungrouped prompts.
            With no cluster read yet, the by-engine grid below shows those answers. */}
        {cs && heatRows.length ? (
          <ClusterHeat heatRows={heatRows} data={data} range={range} compareMode={compareMode} today={today} brand={brand} engines={engines} clustersPath={clustersPath} rangeQuery={rangeQuery} detailHref={!!detailHref} />
        ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px", flex: "0 1 auto", minWidth: 0 }}>
          <div style={{ fontSize: "13px", fontWeight: 600, color: D.cardHead }}>Every daily check, by engine</div>
          {/* Audit mobile-1 (8 Oct 2026): at 390 the grid scaled to 194px wide - 5.7px squares, rows 7px
              apart - beside labels still 17px apart, so ChatGPT's row sat by "Google AI Overviews" and
              Gemini and Perplexity by the date axis. The grid keeps its size and scrolls, opening on
              Today, so every row stays level with its label; on a phone each label is the engine's mark
              (the name stays for a screen reader). */}
          <div style={{ display: "flex", gap: "12px", minWidth: 0 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "3px", flexShrink: 0 }}>
              {engines.map((e) => (
                <div key={e} data-heat-label="" title={ENGINE_SPECS[e].label} style={{ height: "14px", display: "flex", alignItems: "center", justifyContent: "flex-end", fontSize: "12px", fontWeight: 500, color: D.cardHead, whiteSpace: "nowrap" }}>
                  <span className="app-heat-mark">
                    <EngineLogo engine={e} size={14} />
                  </span>
                  <span className="app-heat-name">{ENGINE_SPECS[e].label}</span>
                </div>
              ))}
            </div>
            <div id="ov-heat-scroll" className="app-heat-scroll" role="group" aria-label="Daily checks by engine" style={{ minWidth: 0, flex: "0 1 auto", overflowX: "auto" }}>
            <div className="app-heat-in" style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              <svg width={gridDays.length * 17 - 3} height={engines.length * 17 - 3} viewBox={`0 0 ${gridDays.length * 17 - 3} ${engines.length * 17 - 3}`} style={{ display: "block" }} role="img" aria-label={`Each engine's daily share of prompts naming ${brand}, ${formatDay(gridDays[0]!)} to ${formatDay(gridDays[gridDays.length - 1]!)}`}>
                {engines.map((e, row) =>
                  gridDays.map((d, col) => {
                    const cell = o.grid[e]?.[gridFrom + col] ?? null;
                    return (
                      <rect key={`${e}-${d}`} x={col * 17} y={row * 17} width={14} height={14} rx={3} fill={heat(cell?.pct ?? null)}>
                        <title>{`${ENGINE_SPECS[e].label}, ${formatDay(d)}: ${cell ? `${cell.pct}% (${cell.num} of ${cell.den})` : "no check"}`}</title>
                      </rect>
                    );
                  }),
                )}
              </svg>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", color: D.quiet }}>
                <span>{formatDay(gridDays[0]!)}</span>
                <span>{formatDay(gridDays[Math.floor(gridDays.length / 2)]!)}</span>
                <span>{gridDays[gridDays.length - 1] === today ? "Today" : formatDay(gridDays[gridDays.length - 1]!)}</span>
              </div>
            </div>
            </div>
          </div>
          <ScrollCue target="ov-heat-scroll" color={D.quiet}>{`Swipe for the earlier days, back to ${formatDay(gridDays[0]!)}.`}</ScrollCue>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", color: D.quiet, flexWrap: "wrap" }}>
            Share of prompts naming you that day
            {/* mobile-1: the scale is one piece, so "0 to 60%+" never wraps away from its squares. */}
            <span style={{ display: "inline-flex", alignItems: "center", gap: "8px", whiteSpace: "nowrap" }}>
              <span style={{ display: "flex", gap: "3px" }} aria-hidden="true">
                {[0, 15, 30, 45, 60].map((p) => (
                  <span key={p} style={{ width: "12px", height: "12px", borderRadius: "3px", background: heat(p) }} />
                ))}
              </span>
              0 to 60%+
            </span>
          </div>
        </div>
        )}
      </section>

      {/* 13 Oct 2026, DIY P4 (spec 10 section 4.1 rows 5 and 6): Since last check on the left (7 of 12) and This week on
          the right (5 of 12); on a phone This week comes first. This week is first in the source and the row runs right to
          left, so wrapping puts it on top with no media query and no script. */}
      {diff || thisWeek ? (
        <div data-overview-work="" style={{ display: "flex", flexDirection: "row-reverse", flexWrap: "wrap", gap: "24px", alignItems: "flex-start", minWidth: 0 }}>
          {thisWeek ? <div style={{ flex: "5 1 300px", minWidth: 0 }}>{thisWeek}</div> : null}
          {diff ? (
            <div style={{ flex: "7 1 420px", minWidth: 0 }}>
              <SinceLastCheck diff={diff} href={changeHref} />
            </div>
          ) : null}
        </div>
      ) : null}

      <section aria-label="Key figures" className={cs ? "app-figures app-hide-sm" : "app-figures"} style={{ ...CARD, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", overflow: "hidden" }}>
        {(cs
          ? [
              {
                figure: "named",
                label: "Answers naming you",
                value: pct(fig.now),
                delta: <Delta value={chg.named} vs={vs} />,
                foot: <span style={{ fontSize: "13px", color: T.soft }}>{`${fig.now.num.toLocaleString("en-GB")} of ${fig.now.den.toLocaleString("en-GB")} answers${loose ? ` across ${across}` : ""}`}</span>,
              },
              {
                figure: "questions",
                label: "Prompts you are named in",
                value: `${fig.promptsNamed.num} of ${fig.promptsNamed.den}`,
                delta: promptsChange ? <span style={{ fontSize: "13px", color: T.soft }}>{promptsChange}</span> : null,
                foot: <span style={{ fontSize: "13px", color: T.soft }}>{`${fig.never ? `${fig.never} never name you` : "Named in every prompt"}${loose ? `, ${looseWords} counted` : ""}`}</span>,
              },
              {
                figure: "sov",
                label: "Share of voice",
                value: pct(o.sov),
                delta: <Delta value={chg.sov} vs={vs} />,
                foot: <span style={{ fontSize: "13px", color: T.soft }}>{o.sov.rank ? `${ordinal(o.sov.rank)} of ${o.sov.brands} brands named` : `Not named; ${o.sov.brands} other brands were`}</span>,
              },
              {
                figure: "keywords",
                label: "Cluster keywords on page 1",
                // DS57 (2 Oct 2026, R173 pass 6): no cluster keyword read in the range is "-", not "0 of 0", as OneCluster's count.
                value: cs.page1.den ? `${cs.page1.num} of ${cs.page1.den}` : "-",
                delta: chg.page1 !== null ? <Delta value={chg.page1} unit="" vs={vs} /> : null,
                foot: (
                  <span style={{ fontSize: "13px", color: T.soft }}>
                    {cs.page1.den
                      ? `${avgLine(cs.page1)}${pendingKeywords ? `. ${pendingKeywords} more from tomorrow` : ""}`
                      : pendingKeywords
                        ? `First check tomorrow at ${next}`
                        : "No cluster keyword checked in this range"}
                  </span>
                ),
              },
            ]
          : [
          {
            figure: "named",
            label: "Answers naming you",
            value: pct(o.named),
            delta: <Delta value={chg.named} vs={vs} />,
            foot: <span style={{ fontSize: "13px", color: T.soft }}>{`${o.named.num.toLocaleString("en-GB")} of ${o.named.den.toLocaleString("en-GB")} answers`}</span>,
          },
          {
            figure: "questions",
            label: "Prompts you are named in",
            value: `${o.questions.num} of ${o.questions.den}`,
            delta: promptsChange ? <span style={{ fontSize: "13px", color: T.soft }}>{promptsChange}</span> : null,
            foot: o.questions.den - o.questions.num ? <span style={{ fontSize: "13px", color: T.soft }}>{`${o.questions.den - o.questions.num} never name you`}</span> : <span style={{ fontSize: "13px", color: T.soft }}>Named in every prompt</span>,
          },
          {
            figure: "sov",
            label: "Share of voice",
            value: pct(o.sov),
            delta: <Delta value={chg.sov} vs={vs} />,
            foot: <span style={{ fontSize: "13px", color: T.soft }}>{o.sov.rank ? `${ordinal(o.sov.rank)} of ${o.sov.brands} brands named` : `Not named; ${o.sov.brands} other brands were`}</span>,
          },
          {
            figure: "keywords",
            label: "Google keywords on page 1",
            value: `${o.keywords.num} of ${o.keywords.den}`,
            delta: chg.page1 !== null ? <Delta value={chg.page1} unit="" vs={vs} /> : null,
            foot: <span style={{ fontSize: "13px", color: T.soft }}>{avgLine(o.keywords)}</span>,
          },
        ]).map((f, i) => (
          <div key={f.label} style={{ display: "flex", flexDirection: "column", gap: "8px", padding: "22px 24px", minWidth: 0, borderLeft: i ? `1px solid ${T.line}` : undefined, marginLeft: i ? "-1px" : undefined }}>
            <div style={LABEL}>{f.label}</div>
            <div style={{ display: "flex", alignItems: "baseline", gap: "10px", flexWrap: "wrap" }}>
              <span style={{ fontSize: "30px", fontWeight: 700, letterSpacing: "-0.03em", color: T.ink, fontVariantNumeric: "tabular-nums" }} data-figure={f.figure}>{f.value}</span>
              {f.delta}
            </div>
            {f.foot}
          </div>
        ))}
        {changeCaption ? <p style={{ gridColumn: "1 / -1", margin: 0, padding: "12px 24px 14px", borderTop: `1px solid ${T.line}`, fontSize: "13px", lineHeight: 1.5, color: T.soft }}>{changeCaption}</p> : null}
      </section>

      {/* Mobile.dc.html's four figure cards (T4b mobile, 30 Sep 2026): the headline already says the named share, so the phone trades it for rank among brands. Same figures as above. */}
      {cs ? (
        <section aria-label="Key figures" className="app-show-sm">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "10px" }}>
            {[
              { label: "Prompts named in", value: `${fig.promptsNamed.num} of ${fig.promptsNamed.den}`, foot: promptsChange ? <span style={{ fontSize: "12px", color: T.soft }}>{promptsChange}</span> : loose ? <span style={{ fontSize: "12px", color: T.soft }}>{`With ${looseWords}`}</span> : null },
              { label: "Share of voice", value: pct(o.sov), foot: <Delta value={chg.sov} vs={vs} /> },
              { label: "Keywords on page 1", value: cs.page1.den ? `${cs.page1.num} of ${cs.page1.den}` : "-", foot: chg.page1 !== null ? <Delta value={chg.page1} unit="" vs={vs} /> : !cs.page1.den && pendingKeywords ? <span style={{ fontSize: "12px", color: T.soft }}>From tomorrow</span> : null },
              {
                label: "Rank among brands",
                value: o.sov.rank ? `${ordinal(o.sov.rank)} of ${o.sov.brands}` : "-",
                foot: board[0] ? <span style={{ fontSize: "12px", color: T.soft }}>{board[0].you ? "You lead" : `${board[0].name} leads`}</span> : null,
              },
            ].map((f) => (
              <div key={f.label} style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "6px", padding: "16px", background: T.surface, border: `1px solid ${T.line}`, borderRadius: "16px", minWidth: 0 }}>
                <span style={{ fontSize: "12px", fontWeight: 600, color: T.soft }}>{f.label}</span>
                <span style={{ fontSize: "24px", fontWeight: 700, letterSpacing: "-0.03em", color: T.ink, fontVariantNumeric: "tabular-nums" }}>{f.value}</span>
                {f.foot}
              </div>
            ))}
          </div>
          {changeCaption ? <p style={{ margin: "10px 0 0", fontSize: "12px", lineHeight: 1.5, color: T.soft }}>{changeCaption}</p> : null}
        </section>
      ) : null}

      {/* 13 Oct 2026, DIY P4 (spec 10 section 4.1 row 4): the basis line, when prompts added from work are live - they are
          likelier to name the client, and the figures above count them (audit data-2). */}
      {fromWork ? (
        <p data-basis="origins" style={{ margin: "-8px 0 0", fontSize: "13px", lineHeight: 1.5, color: T.soft }}>
          {`${fromWork.text} `}
          {clientPath ? (
            <Link href={`${clientPath}/ai?${new URLSearchParams({ ...rangeQuery, origin: "chosen" })}`} style={{ color: T.accent, fontWeight: 600, textDecoration: "none" }}>
              See the figures on the prompts you chose
            </Link>
          ) : null}
        </p>
      ) : null}

      {cards ? <ClusterCards cards={cards} engines={engines} picked={picked?.id ?? null} href={clusterHref} detail={detailHref} manage={manage} next={next} vs={vs} /> : ungroupedCard}
      {cards ? <ClusterRows cards={cards} picked={detailHref ? null : (picked?.id ?? null)} href={detailHref ?? clusterHref} opens={!!detailHref} manage={manage} next={next} vs={vs} /> : null}
      {/* R151 (3 Oct 2026): the headline counts read ungrouped prompts beside clusters ("1 cluster and 5 ungrouped prompts"), so they get their card too. */}
      {cards && loose ? ungroupedCard : null}

      {picked && pickedChart ? (
        <ClusterChart
          data={{
            keyword: picked.keyword ?? picked.name,
            site: domain,
            brand,
            days: pickedChart.days.map((d, i) => (i === pickedChart.days.length - 1 && d === today ? "Today" : formatDay(d))),
            dayLabels: pickedChart.days.map((d) => formatDay(d, true)),
            named: pickedChart.named,
            google: pickedChart.google,
            prevLabels: chartBefore ? daysIn(chartBefore).map((d) => formatDay(d)) : null,
            namedBefore: pickedChart.namedBefore,
            googleBefore: pickedChart.googleBefore,
            beforeLabel: chartBefore ? span(chartBefore) : null,
            answersPerDay: picked.prompts.length * engines.length,
            pending: picked.status === "pending",
            firstCheckAt: next,
            note:
              picked.status !== "pending" && !pickedHasPrev
                ? o.compareKind === "start" && o.compare
                  ? `Tracked from ${formatDay(picked.started_on)}. Its changes are against your first week, ${span(o.compare)}.`
                  : o.compareKind === "first" && o.compare
                    ? `Tracked from ${formatDay(picked.started_on)}. Its changes are against your first reading, ${formatDay(o.compare.from)}.`
                    : `Tracked from ${formatDay(picked.started_on)}. No earlier period to compare yet.`
                : null,
            phoneLine,
            placements: placements ? chartMarkers(pickedChart.days, placements, picked.id) : null,
            isoDays: pickedChart.days,
            marks,
            // T7 part 2b: the phone board's "Open this cluster" goes to QuestionDetail, the one-cluster page.
            openHref: clustersPath ? `${clustersPath}/${encodeURIComponent(picked.id)}?${new URLSearchParams(rangeQuery)}` : null,
          }}
        />
      ) : (
      <OverviewChart
        data={{
          engines: [...engines],
          now: toChart(dailySeries(data.answers, range, engines)),
          before: chartBefore ? toChart(dailySeries(data.answers, chartBefore, engines)).slice(0, daysIn(range).length) : null,
          lflNow: lflIds ? toChart(dailySeries(data.answers, range, engines, lflIds)) : null,
          lflBefore: lflIds && chartBefore ? toChart(dailySeries(data.answers, chartBefore, engines, lflIds)).slice(0, daysIn(range).length) : null,
          beforeLabel: chartBefore ? span(chartBefore) : null,
          lflNote,
          notes,
          brand,
          questions: questionsAnswered,
          isoDays: daysIn(range),
          marks,
        }}
      />
      )}

      {cards ? (
        <div className="app-pair" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: "24px" }}>
          {whoNamed}
          {citedCard}
        </div>
      ) : (
        <>
          <div className="app-pair" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.35fr) minmax(0, 1fr)", gap: "24px" }}>
            {keywordsCard}
            {whoNamed}
          </div>
          {citedCard}
        </>
      )}
      {/* 13 Oct 2026, DIY P4 (spec 10 section 4.1 row 10): the work log slot, which P5 fills with P3's WorkLog. */}
      {workLog}
    </div>
  );
}

/**
 * The by-cluster heat map (T4b part 3, 30 Sep 2026; DB-2, 9 Oct 2026): one
 * row per cluster with readings, one cell per day of the range's last 28, each
 * a link to an answer it counts. Its own component since 13 Oct 2026 (DIY P4,
 * spec 10 section 4.2 row 7) so the AI visibility page draws the same map,
 * full width, on the same dark ground - not a second copy of it. `detailHref`
 * is whether the one-cluster page exists to open (none on /app/parity).
 */
export function ClusterHeat({
  heatRows,
  data,
  range,
  compareMode,
  today,
  brand,
  engines,
  clustersPath,
  rangeQuery,
  detailHref,
}: {
  heatRows: ClusterCard[];
  data: Pick<OverviewData, "answers">;
  range: Range;
  compareMode: Compare;
  today: Day;
  brand: string;
  engines: readonly Engine[];
  clustersPath?: string;
  rangeQuery: Record<string, string>;
  detailHref: boolean;
}) {
  const gridDays = daysIn(range).slice(-28);
  const gridFrom = daysIn(range).length - gridDays.length;
  // DS77 (2 Oct 2026, R173 pass 13, failed cold read): a day with no reading after a cluster started
  // read "not tracked yet" in the heat grid, though the cluster was tracked and only the check missed.
  const gapLabel = (startedOn: Day, d: Day) => (d >= startedOn ? "no reading" : "not tracked yet");
  const heatGap = heatRows.some((c) => gridDays.some((d, col) => !c.heat[gridFrom + col] && d >= c.started_on));
  // DB-2 (9 Oct 2026): a cell with a reading opens one of the answers it counts, on the one-cluster page at that
  // day and engine (evidence.ts dayAnswerIn) - a name when the cell counted one. None on /app/parity (no detailHref).
  // Review of 95a8747 (same day): only the days the grid draws are indexed, not the range's comparison period too.
  const byPromptDay = detailHref && heatRows.length ? answersByPromptDay(data.answers, { from: gridDays[0]!, to: gridDays[gridDays.length - 1]! }) : null;
  const heatW = gridDays.length * 14 - 3;
  const heatH = heatRows.length * 14 - 3;
  const heatOpens = (c: ClusterCard, d: Day) => {
    const at = byPromptDay && clustersPath ? dayAnswerIn(byPromptDay, c.prompts.map((p) => p.id), d, engines) : null;
    return at ? answerHref(`${clustersPath}/${encodeURIComponent(c.id)}`, { ...rangeQuery, prompt: String(at.prompt) }, at) : null;
  };
  return (
          <div style={{ display: "flex", flexDirection: "column", gap: "12px", flex: "0 1 auto", minWidth: 0 }}>
            <div style={{ fontSize: "13px", fontWeight: 600, color: D.cardHead }}>
              <span className="app-hide-sm">Every daily check, by cluster</span>
              <span className="app-show-sm">Every daily check, one row per cluster</span>
            </div>
            <div style={{ display: "flex", gap: "12px", minWidth: 0 }}>
              <div className="app-heat-labels app-hide-sm" style={{ display: "flex", flexDirection: "column", width: "196px", minWidth: 0, flexShrink: 1 }}>
                {heatRows.map((c) => (
                  // DS43 (2 Oct 2026): a block, not a flex row - a flex container's text never draws the ellipsis, so a long keyword was cut mid-letter.
                  <div key={c.id} title={c.keyword ?? c.name} style={{ height: "11px", marginBottom: "3px", textAlign: "right", fontSize: "11px", fontWeight: 500, color: D.cardHead, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", lineHeight: "11px" }}>
                    {c.keyword ?? c.name}
                  </div>
                ))}
              </div>
              {/* Audit mobile-1 (8 Oct 2026): the grid scaled to fit (maxWidth 100%) while its labels kept
                  their 14px rows, so at 600 and 900 the labels drifted 2px a row off theirs. It keeps its
                  size now and scrolls, opening on Today (.app-heat-scroll); on a phone, where it has no
                  labels, it still fits the card (.app-heat-fit). */}
              <div id="ov-heat-scroll" className="app-heat-scroll app-heat-fit" role="group" aria-label="Daily checks by cluster" style={{ minWidth: 0, flex: "0 1 auto", overflowX: "auto" }}>
              <div className="app-heat-in" style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {/* DB-2 (9 Oct 2026): with links in it the grid is a group, not an image - an image's children are not read. */}
                <svg width={gridDays.length * 14 - 3} height={heatRows.length * 14 - 3} viewBox={`0 0 ${gridDays.length * 14 - 3} ${heatRows.length * 14 - 3}`} style={{ display: "block" }} role={detailHref ? "group" : "img"} aria-label={`Daily share of answers naming ${brand}, one row per cluster, ${formatDay(gridDays[0]!)} to ${formatDay(gridDays[gridDays.length - 1]!, true)}${detailHref ? ". Each day opens its answers; the arrow keys move between days" : ""}`}>
                  {heatRows.map((c, row) =>
                    gridDays.map((d, col) => {
                      const cell = c.heat[gridFrom + col] ?? null;
                      const label = `${c.keyword ?? c.name}, ${formatDay(d)}: ${cell ? `${cell.pct}% (${cell.num} of ${cell.den})` : gapLabel(c.started_on, d)}`;
                      const to = cell ? heatOpens(c, d) : null;
                      // DB-2: a link the size of the cell's whole pitch, so a tap between two squares still lands on one -
                      // held inside the grid at its edges (review of 95a8747, 9 Oct 2026), where the SVG cut the focus ring.
                      // Its one name is its <title>, which is also the hover tip: an aria-label beside it read it twice.
                      // Known gap, 9 Oct 2026 (target size): the pitch is 14px here and about 11px on a phone, under
                      // WCAG 2.5.8's 24px. Not restructured: each cell's answers are also one tap from the one-cluster
                      // page's day grid, whose squares are 24px wide.
                      const hx = Math.max(0, col * 14 - 1.5);
                      const hy = Math.max(0, row * 14 - 1.5);
                      return to && cell ? (
                        <a key={`${c.id}-${d}`} href={to} className="app-heat-a" data-row={row} data-col={col}>
                          <title>{`${c.keyword ?? c.name}, ${formatDay(d, true)}: named you in ${cell.num} of ${cell.den} answers (${cell.pct}%). Open that day's answers.`}</title>
                          <rect x={hx} y={hy} width={Math.min(heatW, col * 14 + 12.5) - hx} height={Math.min(heatH, row * 14 + 12.5) - hy} fill="transparent" />
                          <rect x={col * 14} y={row * 14} width={11} height={11} rx={3} fill={heat(cell.pct)} />
                        </a>
                      ) : cell ? (
                        <rect key={`${c.id}-${d}`} x={col * 14} y={row * 14} width={11} height={11} rx={3} fill={heat(cell.pct)}>
                          <title>{label}</title>
                        </rect>
                      ) : (
                        <rect key={`${c.id}-${d}`} x={col * 14 + 0.5} y={row * 14 + 0.5} width={10} height={10} rx={2.5} fill="none" stroke={D.quiet} strokeOpacity={0.45}>
                          <title>{label}</title>
                        </rect>
                      );
                    }),
                  )}
                </svg>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", color: D.quiet }}>
                  <span>{formatDay(gridDays[0]!)}</span>
                  <span className="app-hide-sm">{formatDay(gridDays[Math.floor(gridDays.length / 2)]!)}</span>
                  <span>{gridDays[gridDays.length - 1] === today ? "Today" : formatDay(gridDays[gridDays.length - 1]!)}</span>
                </div>
              </div>
              </div>
            </div>
            <ScrollCue target="ov-heat-scroll" color={D.quiet} phone={false}>{`Swipe for the earlier days, back to ${formatDay(gridDays[0]!)}.`}</ScrollCue>
            {/* DB-2: 280 day links are one tab stop with script, the arrow keys moving between days and clusters. */}
            {detailHref ? <GridKeys target="ov-heat-scroll" version={`${range.from} ${range.to} ${compareMode}`} /> : null}
            <div className="app-hide-sm" style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px", color: D.quiet, flexWrap: "wrap" }}>
              {/* DS74 (2 Oct 2026): "up to" once a shown day had fewer answers - a partial check or a stopped prompt - so the count is never one a cell was not read on. */}
              {`Share of the cluster's ${heatRows.some((c) => gridDays.some((_, col) => { const h = c.heat[gridFrom + col]; return h && h.den < 5 * engines.length; })) ? "up to " : ""}${5 * engines.length} answers naming you that day`}
              <span style={{ display: "inline-flex", alignItems: "center", gap: "8px", whiteSpace: "nowrap" }}>
                <span style={{ display: "flex", gap: "3px" }} aria-hidden="true">
                  {[0, 15, 30, 45, 60].map((p) => (
                    <span key={p} style={{ width: "11px", height: "11px", borderRadius: "3px", background: heat(p) }} />
                  ))}
                </span>
                0 to 60%+
              </span>
              <span aria-hidden="true" style={{ display: "inline-flex", width: "10px", height: "10px", borderRadius: "2.5px", border: `1px solid ${D.quiet}`, opacity: 0.45, marginLeft: "6px" }} />
              {heatGap ? "no reading" : "not tracked yet"}
            </div>
          </div>
  );
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** A change chip in the cards' 12px size, or the grey word when there is no change to show. */
/** `vs` (ON-3, 9 Oct 2026): what the change is against, read out after it (VsText); a grey word with no change has nothing to say it of. */
export function Chip({ value, unit, none, size = 12, vs = null }: { value: number | null; unit: string; none: string; size?: number; vs?: string | null }) {
  if (value === null || value === 0)
    return (
      <span style={{ fontSize: `${size}px`, fontWeight: 600, color: T.soft, whiteSpace: "nowrap" }}>
        {value === 0 ? "No change" : none}
        {value === 0 ? <VsText vs={vs} /> : null}
      </span>
    );
  return (
    <Pill up={value > 0} size={size}>
      {value > 0 ? "+" : "−"}
      {Math.abs(value)}
      {unit}
      <VsText vs={vs} />
    </Pill>
  );
}

function Pill({ up, size, title, children }: { up: boolean; size: number; title?: string; children: React.ReactNode }) {
  const fg = up ? T.goodFg : T.badFg;
  return (
    <span title={title} style={{ display: "inline-flex", alignItems: "center", gap: "2px", padding: "2px 8px 2px 5px", borderRadius: "999px", background: up ? T.goodBg : T.badBg, color: fg, fontSize: `${size}px`, fontWeight: 600, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={fg} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d={up ? "M6 15l6-6 6 6" : "M6 9l6 6 6-6"} />
      </svg>
      {children}
    </span>
  );
}

/**
 * The grey word beside a cluster's rate when it has no change (8 Oct 2026,
 * audit data-7): "Tomorrow" before its first check, "New" for one begun
 * inside the period - never for a cluster tracked throughout, which with
 * "Compare: Nothing" read "New" on every card.
 */
export const noChange = (c: Pick<ClusterCard, "status">) => (c.status === "pending" ? "Tomorrow" : c.status === "added" ? "New" : "");

/**
 * A cluster keyword's Google change (8 Oct 2026, audit data-7): places
 * gained, or leaving or entering the top 20. A keyword gone from #13 to
 * outside the top 20 read "New", as a keyword never read does.
 */
export function PositionChip({ c, size = 12, vs = null }: { c: Pick<ClusterCard, "status" | "keyword" | "positionChange" | "positionEvent">; size?: number; vs?: string | null }) {
  // One word each, so the pill fits the cards' 108px Google box (82px inside); the title says it in full.
  if (c.positionEvent === "dropped")
    return (
      <Pill up={false} size={size} title="Dropped out of the top 20">
        Dropped
        <VsText vs={vs} />
      </Pill>
    );
  if (c.positionEvent === "entered")
    return (
      <Pill up size={size} title="Entered the top 20">
        Entered
        <VsText vs={vs} />
      </Pill>
    );
  return <Chip value={c.positionEvent === "unranked" ? 0 : c.positionChange} unit="" none={c.keyword === null ? "No keyword" : noChange(c)} size={size} vs={vs} />;
}

/**
 * "Your clusters" (T4b part 4, 30 Sep 2026; boards-3/Main.dc.html): two
 * columns, one card per cluster - keyword, intent and volume, the cluster's
 * rate and change, one row per angle with the engines that named the client
 * and a rate bar, lines joining each row to the Google node. Purple for a
 * prompt named in range, grey dashed for one that never was. Static until the
 * chart below is set by the picked card: each card is a link to `?cluster=`,
so picking works with JS off (T4b part 5b).
 */
type Manage = { href: string; inUse: string | null } | null;

function ClusterCards({
  cards,
  engines,
  picked,
  href,
  detail,
  manage,
  next,
  vs = null,
}: {
  cards: ClusterCard[];
  engines: readonly Engine[];
  picked: string | null;
  href: (id: string) => string;
  /** R132: the one-cluster page. When set the card opens it (the keyword's link stretches over the card), each prompt row opens it on that prompt, and "Chart this" picks the chart. */
  detail: ((id: string, prompt?: number) => string) | null;
  manage: Manage;
  /** Tomorrow's check time in the client's zone (check-time.ts). */
  next: string;
  /** ON-3: what every change is against (Chip's `vs`). */
  vs?: string | null;
}) {
  return (
    <section aria-labelledby="cl-h" className="app-hide-sm" style={{ ...CARD, padding: "22px 24px 24px", display: "flex", flexDirection: "column", gap: "18px" }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: "24px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          <h2 id="cl-h" style={H2}>
            Your clusters
          </h2>
          <p style={{ margin: 0, fontSize: "14px", lineHeight: 1.5, color: T.soft, maxWidth: "760px" }}>
            Each cluster is one Google keyword and the 5 prompts about it. An engine mark is full where that engine named you at least once this period. Pick a cluster to chart it below.
          </p>
        </div>
        {manage ? (
          <div style={{ display: "flex", alignItems: "center", gap: "16px", flexShrink: 0 }}>
            {manage.inUse ? <span style={{ fontSize: "13px", color: T.soft }}>{manage.inUse}</span> : null}
            <Link href={manage.href} style={{ fontSize: "14px", fontWeight: 600, color: T.accent, textDecoration: "none" }}>
              Manage clusters
            </Link>
          </div>
        ) : null}
      </div>
      <div className="app-pair" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "16px" }}>
        {cards.map((c) => {
          const pending = c.status === "pending";
          const meta = [c.intent ? cap(c.intent) : null, c.volume !== null ? `${c.volume.toLocaleString("en-GB")} searches a month` : null].filter(Boolean).join(", ");
          const since = formatDay(c.started_on);
          const basis = pendingBasis(c);
          const foot = pending
            ? basis ? `${basis}. Its first check is tomorrow at ${next}.` : `First check tomorrow at ${next}.`
            : `${c.promptsNamed.num} of ${c.promptsNamed.den} prompts name you. Tracked since ${since}${c.status === "added" ? ", so no change yet" : ""}.`;
          const rowY = (i: number) => 11 + i * 26;
          const h = Math.max(1, c.prompts.length) * 26 - 4;
          const mid = h / 2;
          const on = c.id === picked;
          const box: React.CSSProperties = { position: "relative", display: "flex", flexDirection: "column", gap: "12px", padding: "16px 18px 14px", border: `1px solid ${on ? T.accent : T.line}`, borderRadius: "16px", background: T.surface, boxShadow: on ? `0 0 0 3px ${T.wash}` : "none", color: T.ink, textDecoration: "none", minWidth: 0 };
          const title = c.keyword ?? c.name;
          const body = (
            <>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "12px" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: "3px", minWidth: 0 }}>
                  <h3 style={{ margin: 0, fontSize: "15px", fontWeight: 700, letterSpacing: "-0.01em", color: T.ink }}>
                    {detail ? (
                      <Link href={detail(c.id)} className="app-stretch" style={{ color: "inherit", textDecoration: "none" }}>
                        {title}
                      </Link>
                    ) : (
                      title
                    )}
                  </h3>
                  {meta ? <span style={{ fontSize: "12px", color: T.soft }}>{meta}</span> : null}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
                  <span style={{ fontSize: "20px", fontWeight: 700, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums" }} title={pending ? (basis ?? undefined) : basisLine(c.now, "answers")}>
                    {pct(c.now)}
                  </span>
                  <Chip value={c.delta} unit=" pts" none={noChange(c)} vs={vs} />
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "4px", flexGrow: 1, minWidth: 0 }}>
                  {c.prompts.map((r, i) => {
                    const row: React.CSSProperties = { display: "flex", alignItems: "center", gap: "8px", height: "22px" };
                    const cells = (
                      <>
                      <span style={{ width: "80px", flexShrink: 0, fontSize: "12px", fontWeight: 600, color: pending ? T.soft : T.ink }}>{r.angle ? cap(r.angle) : "Prompt"}</span>
                      {pending && !r.fixed ? (
                        // DS2 (2 Oct 2026): one line in the 22px row - it wrapped over the next angle at 1280. The time is in the card's foot.
                        <span title={`Asked from tomorrow's check, at ${next}`} style={{ fontSize: "12px", color: T.soft, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>Asked from tomorrow</span>
                      ) : (
                        <>
                          <span style={{ display: "flex", gap: "3px", flexShrink: 0 }}>
                            {engines.map((e) => (
                              <span key={e} style={{ display: "inline-flex", opacity: r.namedBy.includes(e) ? 1 : 0.22 }}>
                                <EngineLogo engine={e} size={16} title={`${ENGINE_SPECS[e].label}${r.namedBy.includes(e) ? " named you" : " did not name you"}: ${r.text}`} />
                              </span>
                            ))}
                          </span>
                          <span aria-hidden="true" style={{ flexGrow: 1, height: "6px", borderRadius: "3px", background: T.hair, overflow: "hidden" }}>
                            <span style={{ display: "block", height: "100%", width: `${Math.min(100, (r.now.pct ?? 0) * 1.6)}%`, borderRadius: "3px", background: r.now.num ? T.accent : T.line }} />
                          </span>
                          <span style={{ width: "34px", flexShrink: 0, textAlign: "right", fontSize: "12px", fontWeight: 700, fontVariantNumeric: "tabular-nums" }} title={basisLine(r.now, "answers")}>
                            {pct(r.now)}
                          </span>
                        </>
                      )}
                      </>
                    );
                    return (
                      <li key={r.id} title={r.text} style={detail ? undefined : row}>
                        {detail ? (
                          <Link href={detail(c.id, i)} className="app-over" aria-label={`${r.angle ? cap(r.angle) : "Prompt"}: ${r.text}`} style={{ ...row, color: "inherit", textDecoration: "none" }}>
                            {cells}
                          </Link>
                        ) : (
                          cells
                        )}
                      </li>
                    );
                  })}
                </ul>
                <svg width="56" height={h} viewBox={`0 0 56 ${h}`} aria-hidden="true" style={{ flexShrink: 0 }}>
                  {c.prompts.map((r, i) => (
                    <path
                      key={r.id}
                      d={`M0,${rowY(i)} C30,${rowY(i)} 26,${mid} 56,${mid}`}
                      fill="none"
                      stroke={pending ? T.line : r.now.num ? D.accent : D.cardHead}
                      strokeWidth={1.6}
                      strokeDasharray={pending || !r.now.num ? "3 4" : undefined}
                      strokeLinecap="round"
                    />
                  ))}
                  <circle cx={54} cy={mid} r={3} fill={pending ? T.line : T.accent} />
                </svg>
                <div style={{ width: "108px", flexShrink: 0, boxSizing: "border-box", padding: "10px 12px", borderRadius: "12px", border: `1px solid ${on ? T.washLine : T.line}`, background: T.bg, display: "flex", flexDirection: "column", gap: "4px", alignItems: "flex-start" }}>
                  <span style={{ fontSize: "11px", fontWeight: 600, color: T.soft }}>Google</span>
                  <span style={{ fontSize: "24px", fontWeight: 700, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums" }}>{c.position === null ? "-" : `#${c.position}`}</span>
                  <PositionChip c={c} vs={vs} />
                </div>
              </div>
              {detail ? (
                <span style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "12px" }}>
                  <span style={{ fontSize: "12px", color: T.soft }}>{foot}</span>
                  {on ? (
                    <span style={{ fontSize: "12px", fontWeight: 600, color: T.soft, whiteSpace: "nowrap" }}>In the chart below</span>
                  ) : (
                    <Link href={href(c.id)} scroll={false} className="app-over" style={{ fontSize: "12px", fontWeight: 600, color: T.accent, textDecoration: "none", whiteSpace: "nowrap" }}>
                      Chart this
                      <span className="sr-only">{`: ${title}`}</span>
                    </Link>
                  )}
                </span>
              ) : (
                <span style={{ fontSize: "12px", color: T.soft }}>{foot}</span>
              )}
            </>
          );
          return detail ? (
            <div key={c.id} aria-current={on ? "true" : undefined} style={box}>
              {body}
            </div>
          ) : (
            <Link key={c.id} href={href(c.id)} scroll={false} aria-current={on ? "true" : undefined} style={box}>
              {body}
            </Link>
          );
        })}
      </div>
    </section>
  );
}

/**
 * The phone's "Your clusters" (T4b mobile part 4, 30 Sep 2026;
 * boards-3/Mobile.dc.html): one compact row per cluster in place of the
 * desktop cards - a dot per prompt (filled where it named the client this
 * period) joined to the Google node, the keyword and its prompt count, the
 * rate and its change. Swapped by CSS, so it stands with JS off; each row
 * picks the chart below, as the cards do. "Manage" goes to the Clusters
 * page (T6).
 */
function ClusterRows({ cards, picked, href, opens, manage, next, vs = null }: { cards: ClusterCard[]; picked: string | null; href: (id: string) => string; opens: boolean; manage: Manage; next: string; vs?: string | null }) {
  return (
    <section aria-labelledby="cl-h-sm" className="app-show-sm" style={{ background: T.surface, border: `1px solid ${T.line}`, borderRadius: "16px", paddingTop: "14px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "0 16px 10px" }}>
        <h2 id="cl-h-sm" style={{ margin: 0, fontSize: "16px", fontWeight: 700, color: T.ink }}>
          Your clusters
        </h2>
        {manage ? (
          <Link href={manage.href} style={{ fontSize: "14px", fontWeight: 600, color: T.accent, textDecoration: "none" }}>
            Manage
          </Link>
        ) : null}
      </div>
      <p style={{ margin: "0 16px 10px", fontSize: "12px", lineHeight: 1.5, color: T.soft }}>Each keyword and its 5 prompts. A filled dot is a prompt that named you this period.</p>
      {cards.map((c) => {
        const pending = c.status === "pending";
        const h = Math.max(1, c.prompts.length) * 9 + 1;
        const mid = h / 2;
        return (
          <Link key={c.id} href={href(c.id)} scroll={!opens ? false : undefined} aria-current={c.id === picked ? "true" : undefined} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "12px 16px", borderTop: `1px solid ${T.hair}`, color: T.ink, textDecoration: "none" }}>
            <svg width="36" height={h} viewBox={`0 0 36 ${h}`} aria-hidden="true" style={{ flexShrink: 0 }}>
              {c.prompts.map((r, i) => {
                const y = 5 + i * 9;
                const named = !pending && r.now.num > 0;
                return (
                  <g key={r.id}>
                    <circle cx={5} cy={y} r={3.5} fill={pending ? T.wash : named ? T.accent : T.line} />
                    <path d={`M9,${y} C22,${y} 20,${mid} 34,${mid}`} fill="none" stroke={named ? T.washLine : T.line} strokeWidth={1.4} />
                  </g>
                );
              })}
            </svg>
            <span style={{ width: "44px", height: "40px", flexShrink: 0, boxSizing: "border-box", borderRadius: "10px", border: `1px solid ${pending ? T.line : T.washLine}`, background: T.surface, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
              <span style={{ fontSize: "9px", fontWeight: 600, color: T.soft }}>Google</span>
              <span style={{ fontSize: "14px", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{c.position === null ? "-" : `#${c.position}`}</span>
            </span>
            <span style={{ display: "flex", flexDirection: "column", gap: "3px", flexGrow: 1, minWidth: 0 }}>
              <span style={{ fontSize: "14px", fontWeight: 600, lineHeight: 1.3 }}>{c.keyword ?? c.name}</span>
              <span style={{ fontSize: "12px", color: T.soft }}>
                {pending ? (c.intent ? `${cap(c.intent)}, no readings yet` : "No readings yet") : `${c.promptsNamed.num} of ${c.promptsNamed.den} prompts name you`}
              </span>
              {pending ? <span className="app-ov-first-sm" style={{ fontSize: "12px", color: T.soft }}>{`First check tomorrow, ${next}`}</span> : null}
            </span>
            {pending ? (
              <span className="app-ov-first" style={{ fontSize: "12px", color: T.soft, textAlign: "right", flexShrink: 0 }}>
                First check
                <br />
                {`tomorrow, ${next}`}
              </span>
            ) : (
              <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "4px", flexShrink: 0 }}>
                <span style={{ fontSize: "16px", fontWeight: 700, fontVariantNumeric: "tabular-nums" }} title={basisLine(c.now, "answers")}>
                  {pct(c.now)}
                </span>
                <Chip value={c.delta} unit=" pts" none={noChange(c)} size={11} vs={vs} />
              </span>
            )}
          </Link>
        );
      })}
    </section>
  );
}

function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${s}`;
}

/** A keyword's four weeks, one point a week on its own scale (sparkPoints), gaps where it was outside the top 20 or not read. */
function Spark({ series, colour }: { series: (number | null)[]; colour: string }) {
  const w = 64;
  const h = 20;
  let d = "";
  let pen = false;
  for (const p of sparkPoints(series, w, h)) {
    if (p.y === null) {
      pen = false;
      continue;
    }
    d += `${pen ? "L" : "M"}${p.x},${p.y} `;
    pen = true;
  }
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <path d={d.trim()} fill="none" stroke={colour} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
