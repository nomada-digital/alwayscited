import Link from "@/components/app/AppLink";

import EngineLogo from "@/components/EngineLogo";
import StartNowBars from "@/components/charts/StartNowBars";
import { CLOSE_WASH, D } from "@/components/home/dark";
import { T } from "@/config/tokens";
import { citingShare, engineRates, startAgainstNow, strongestEngine } from "@/lib/diy/ai/engine-rates";
import { type OriginFilter, ORIGINS, type PromptRow, type Sort, filterRows, inSet, originLabel, pageOf, promptRows, sortRows } from "@/lib/diy/ai/prompt-table";
import { appPath } from "@/lib/app-host";
import { ENGINE_SPECS, type Engine } from "@/lib/scan/engines";
import type { UpsellMode } from "@/lib/tracking/ask";
import { clusterCards } from "@/lib/tracking/cluster-figures";
import { rangeLabel } from "@/lib/tracking/date-range";
import { APP_LIMITS } from "@/config/contact";
import { type Day, type Range, type Rate, basis, comparisonLabel, comparisonRange, dailySeries, daysIn, firstCheckDay, firstReadComplete, formatDay, liveThroughout, namedRate, questionsNamed, resolveComparison } from "@/lib/tracking/figures";
import { ANGLES, type Angle } from "@/lib/tracking/limits";
import type { Compare, OverviewData } from "@/lib/tracking/overview-data";
import { lostReads, runNote, todayRun } from "@/lib/tracking/run-note";
import { neverNamedFacts } from "@/lib/tracking/upgrade-facts";
import { type Facts, type PromptCta, promptCopy, pickPrompt } from "@/lib/tracking/upgrade-prompts";
import type { TierKey } from "@/lib/tier-text";

import ChipRow from "../ChipRow";
import { ClearFilters, ClearSearch } from "../ClearLinks";
import DatePicker from "../DatePicker";
import Fig from "../Fig";
import OverviewChart, { type ChartDay } from "../OverviewChart";
import { ClusterHeat } from "../Overview";
import UpgradePrompt from "../UpgradePrompt";
import type { ChartMark } from "../chart-board";
import Measured from "./Measured";
import MissingToggle from "./MissingToggle";
import PromptTable, { type SortLink } from "./PromptTable";

/**
 * AI visibility (13 Oct 2026, DIY P4; spec 10 section 4.2): where am I named,
 * by engine and by prompt, and is it moving? Answers Danny's question (a).
 * Every figure is a count with its denominator from figures.ts, narrowed by
 * the page's filters; every filter, sort and lens is in the URL, and every
 * control is a link or a GET form, so the page reads the same with JS off.
 *
 * The set filters - cluster, angle, origin - narrow the figures as well as the
 * table, so `?origin=chosen` gives the figures on the prompts the client
 * chose, like for like (section 6.7 "Honesty"). The engine filter narrows the
 * chart and the table; the figures keep every engine, since one of them is
 * the strongest engine. Origins and work markers are props, empty until the
 * shell wires P2's origins and P3's plan dates in (spec 7.5).
 */

const pct = (r: Rate) => (r.pct === null ? "-" : `${r.pct}%`);
const n = (x: number) => x.toLocaleString("en-GB");
const PILL = (on: boolean) =>
  ({ display: "inline-flex", alignItems: "center", gap: "6px", height: "36px", padding: "0 14px", boxSizing: "border-box", borderRadius: "999px", border: `1px solid ${on ? T.washLine : T.line}`, background: on ? T.wash : T.surface, color: T.ink, fontSize: "13px", fontWeight: 600, textDecoration: "none", whiteSpace: "nowrap" }) as const;
const CARD: React.CSSProperties = { background: T.surface, border: `1px solid ${T.line}`, borderRadius: "18px", minWidth: 0 };
const H2: React.CSSProperties = { margin: 0, fontSize: "19px", fontWeight: 700, letterSpacing: "-0.022em", color: T.ink };
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The page's own layout rules: the table becomes cards below 860px. Hoisted once by React, beside globals.css. */
const CSS = `
.ai-sub-sm { display: none; }
@media (max-width: 860px) {
  .ai-grid { grid-template-columns: minmax(0, 1fr) auto !important; }
  .ai-head .ai-col, .ai-row .ai-col { display: none !important; }
  .ai-head > :not(:first-child):not(:nth-child(4)) { display: none !important; }
  .ai-sub-sm { display: block; }
  .ai-pad { padding-left: 16px !important; padding-right: 16px !important; }
}
`;

export type AiProps = {
  brand: string;
  domain: string;
  slug: string;
  tier: TierKey;
  engines: readonly Engine[];
  today: Day;
  range: Range;
  compareMode: Compare;
  startedOn: Day | null;
  data: OverviewData;
  cluster: string | null;
  angle: Angle | null;
  origin: OriginFilter | null;
  engine: Engine | null;
  lfl: boolean;
  missing: boolean;
  q: string;
  sort: Sort;
  dir: "asc" | "desc";
  page: number;
  mode: UpsellMode;
  hidden: ReadonlySet<PromptCta>;
  /** P2's prompt origins by id (loadPromptOrigins), which P5 passes in; empty reads every prompt as chosen. */
  origins?: ReadonlyMap<string, string>;
  /** Work markers for the chart: prompts added, placements live, Actions items done (P5 wires them). */
  marks?: ChartMark[];
  /** P2's OriginChip in the origin column, once P5 wires it; the plain label until then. */
  originCell?: (row: PromptRow) => React.ReactNode;
  /** U1's Hide or Ask, back on this page (review of P4, 13 Oct 2026): the page's fixed words, and whether it went through. */
  notice?: { text: string; done: boolean } | null;
};

export default function AiVisibility(p: AiProps) {
  const { data, range, today, engines, brand } = p;
  const origins = p.origins ?? new Map<string, string>();
  const firstCheck = firstCheckDay(p.startedOn, data.questions);
  const cmp = resolveComparison(range, p.compareMode, p.startedOn, firstCheck, firstReadComplete(data.runs, firstCheck));
  const before = cmp.range;
  const cards = clusterCards({ clusters: data.clusters ?? [], questions: data.questions, keywords: data.keywords, answers: data.answers, serp: data.serp, range, before, today, engines });
  // Each card's own prompt list: a row's ?prompt= is its place there (review of P4, 13 Oct 2026).
  const clusters = cards.map((c) => ({ id: c.id, label: c.keyword ?? c.name, prompts: c.prompts.map((q) => q.id) }));
  // A cluster whose first check is still to come has nothing to filter to.
  const read = cards.filter((c) => c.status !== "pending").map((c) => ({ id: c.id, label: c.keyword ?? c.name }));
  const loadedFrom = comparisonRange(range, p.compareMode)?.from ?? range.from;
  const rowEngines = p.engine ? [p.engine] : engines;
  const all = promptRows({ prompts: data.questions, clusters, answers: data.answers, range, loadedFrom, engines: rowEngines, origins, brand, domain: p.domain });

  // The set the figures read: cluster, angle and origin. No set filter is every prompt (null).
  const set = { cluster: p.cluster, angle: p.angle, origin: p.origin };
  const setOn = !!(p.cluster || p.angle || p.origin);
  const only = setOn ? new Set(all.filter((r) => inSet(r, set)).map((r) => r.id)) : null;
  const named = namedRate(data.answers, range, only ?? undefined);
  const lflIds = before ? new Set(data.questions.filter((q) => liveThroughout(q, { from: before.from, to: range.to }) && (!only || only.has(q.id))).map((q) => q.id)) : null;
  const lflNow = lflIds && before ? namedRate(data.answers, range, lflIds) : null;
  const lflBefore = lflIds && before ? namedRate(data.answers, before, lflIds) : null;
  const promptsNamed = questionsNamed(data.answers, range, only ?? undefined);
  const rates = engineRates(data.answers, range, engines, only);
  const strongest = strongestEngine(rates);
  const citing = citingShare(data.answers, range, p.domain, only);
  const checks = new Set(data.answers.filter((a) => a.answered && a.run_date >= range.from && a.run_date <= range.to && (!only || only.has(a.question_id))).map((a) => a.run_date));
  const startNow = startAgainstNow(data.answers, range, engines, only);

  // The URL's state, and links that change one part of it, keeping the range.
  const base: Record<string, string> = { from: range.from, to: range.to, ...(p.compareMode === "prev" ? {} : { compare: p.compareMode }) };
  const state: Record<string, string> = {
    ...base,
    ...(p.cluster ? { cluster: p.cluster } : {}),
    ...(p.angle ? { angle: p.angle } : {}),
    ...(p.origin ? { origin: p.origin } : {}),
    ...(p.engine ? { eng: p.engine } : {}),
    ...(p.lfl ? { lfl: "1" } : {}),
    ...(p.missing ? { missing: "1" } : {}),
    ...(p.q.trim() ? { q: p.q } : {}),
    ...(p.sort !== "cluster" ? { sort: p.sort } : {}),
    ...(p.dir !== "asc" ? { dir: p.dir } : {}),
  };
  const href = (over: Record<string, string | null>, keepPage = false) => {
    const q: Record<string, string> = { ...state, ...(keepPage && p.page > 1 ? { page: String(p.page) } : {}) };
    for (const [k, v] of Object.entries(over)) if (v === null) delete q[k];
    else q[k] = v;
    return `?${new URLSearchParams(q)}`;
  };
  const clientPath = appPath(`/${p.slug}`);
  const clustersPath = `${clientPath}/clusters`;

  // The table: the set filters, the missing lens and the search; sorted; a page of 100.
  const listed = filterRows(all, { ...set, missing: p.missing, q: p.q });
  const missingCount = filterRows(all, { ...set, missing: true, q: p.q }).length;
  // The "Prompts you are named in" figure's link opens the missing lens on the figure's own scope - every engine and
  // no search - and says the count that lens will show (review of P4, 13 Oct 2026: "5 never name you" opened a lens of 6
  // with ?eng=chatgpt). Those that name others are a subset of those never naming you, so the two counts can differ.
  const allEngineRows = p.engine ? promptRows({ prompts: data.questions, clusters, answers: data.answers, range, loadedFrom, engines, origins, brand, domain: p.domain }) : all;
  const missingAll = filterRows(allEngineRows, { ...set, missing: true, q: "" }).length;
  const neverNamed = promptsNamed.den - promptsNamed.num;
  const sorted = sortRows(listed, p.sort, p.dir);
  const shown = pageOf(sorted, p.page);
  const sortLink: SortLink = (s) => {
    const on = p.sort === s;
    const dir = on ? (p.dir === "asc" ? "desc" : "asc") : s === "prompt" ? "asc" : "desc";
    return { href: href({ sort: s === "cluster" ? null : s, dir: s === "cluster" && dir === "asc" ? null : dir, page: null }), dir: on ? p.dir : null };
  };
  const rowHref = (r: PromptRow) => (r.clusterId && r.index !== null ? `${clustersPath}/${encodeURIComponent(r.clusterId)}?${new URLSearchParams({ ...base, prompt: String(r.index) })}` : null);
  // No recorded origin, no chip (review of P4, 13 Oct 2026): it read "Setup", which a cluster added later is not.
  const originCell =
    p.originCell ??
    ((r: PromptRow) => {
      const words = originLabel(r.origin, p.mode);
      return words ? <span style={{ display: "inline-flex", fontSize: "12px", fontWeight: 600, color: T.ink, background: T.chip, borderRadius: "999px", padding: "3px 9px", whiteSpace: "nowrap" }}>{words}</span> : null;
    });

  // The chart: the set's prompts, the picked engine and like-for-like in the URL; prompts added in the range as markers.
  const toChart = (days: ReturnType<typeof dailySeries>): ChartDay[] => days.map((d) => ({ label: formatDay(d.day), all: d.all, by: d.by }));
  const chartBefore = cmp.kind === "start" || cmp.kind === "first" ? null : before;
  const lflChart = lflIds && lflIds.size ? lflIds : null;
  const setIds = only ?? undefined;
  const added = data.questions.filter((q) => q.added_on > range.from && q.added_on <= range.to && (!only || only.has(q.id)));
  const promptMarks: ChartMark[] = [...new Set(added.map((q) => q.added_on))].map((d) => {
    const these = added.filter((q) => q.added_on === d);
    // Only recorded origins are said; with none recorded the marker names no origin.
    const kinds = [...new Set(these.map((q) => originLabel(all.find((r) => r.id === q.id)?.origin ?? null, p.mode)).filter((k): k is string => k !== null))];
    const from = kinds.length ? ` (${kinds.join(", ")})` : "";
    return { date: d, kind: "prompt", label: these.length === 1 ? `'${these[0]!.text}'${from}` : `${these.length} prompts${from}` };
  });

  // The never-named prompt (U1), on its own facts; never on an empty or partial page.
  const empty = !all.length || !checks.size;
  const state1: Facts["state"] = empty ? "empty" : lostReads(data.lastRun) || todayRun(data.runs, today)?.status === "failed" ? "partial" : "ok";
  const facts: Facts = { tier: p.tier, mode: p.mode, hidden: new Set(p.hidden), startedOn: p.startedOn ?? today, today, state: state1, neverNamed: neverNamedFacts({ cards, answers: data.answers, range, domain: p.domain }) };
  const cta = pickPrompt(facts);
  const upgrade = cta === "mentioned" ? promptCopy("mentioned", facts) : null;

  const partial = runNote(data, range, today);
  const filtered = setOn || !!p.engine || p.missing || !!p.q.trim();
  const wordsFor = (o: OriginFilter) => (o === "chosen" ? "Prompts you chose" : originLabel(o, p.mode));
  const originsSeen = ORIGINS.filter((o) => all.some((r) => r.origin === o));
  const pending = data.questions.filter((q) => q.stopped_on === null && q.added_on > today).length;

  return (
    <div className="app-col" style={{ display: "flex", flexDirection: "column", gap: "20px", minWidth: 0 }}>
      <style href="diy-p4-ai" precedence="medium">
        {CSS}
      </style>
      <header style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: "24px", flexWrap: "wrap" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "6px", minWidth: 0, flex: "1 1 320px" }}>
          <h1 style={{ margin: 0, fontSize: "28px", fontWeight: 700, letterSpacing: "-0.03em", color: T.ink }}>AI visibility</h1>
          <p style={{ margin: 0, fontSize: "14px", lineHeight: 1.5, color: T.soft, maxWidth: "680px" }}>Where the engines name {brand}, engine by engine and prompt by prompt, and whether it is moving.</p>
          <span style={{ display: "flex", gap: "6px", alignItems: "center" }}>
            {engines.map((e) => (
              <EngineLogo key={e} engine={e} size={18} title={ENGINE_SPECS[e].label} />
            ))}
          </span>
          {partial ? <p style={{ margin: 0, fontSize: "14px", lineHeight: 1.5, color: T.soft, maxWidth: "680px" }}>{partial}</p> : null}
        </div>
        <DatePicker range={range} compare={p.compareMode} today={today} startedOn={p.startedOn} firstCheck={firstCheck} firstComplete={firstReadComplete(data.runs, firstCheck)} grow={false}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={T.ink} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="5" width="18" height="16" rx="2" />
            <path d="M3 10h18M8 3v4M16 3v4" />
          </svg>
          <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.25 }}>
            <span style={{ fontSize: "14px", fontWeight: 700 }}>{rangeLabel(range, today, p.startedOn)}</span>
            <span style={{ fontSize: "12px", color: T.soft }}>
              {formatDay(range.from)} - {formatDay(range.to, true)}
              {before ? `, ${comparisonLabel(before, cmp.kind)}` : ""}
            </span>
          </span>
        </DatePicker>
      </header>

      {p.notice ? (
        p.notice.done ? (
          // As the Clusters page draws it (CTAs.dc.html "After Ask about these"): a dark pill with the good pair's tick.
          <p role="status" data-ai-notice="done" style={{ margin: 0, display: "flex", alignItems: "center", gap: "12px", padding: "12px 16px", borderRadius: "14px", background: T.ink, color: T.surface, fontSize: "14px", lineHeight: 1.4, alignSelf: "flex-start", maxWidth: "100%", boxSizing: "border-box" }}>
            <span aria-hidden="true" style={{ flexShrink: 0, width: "22px", height: "22px", borderRadius: "50%", background: T.goodBg, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={T.goodFg} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12l5 5 9-10" />
              </svg>
            </span>
            {p.notice.text}
          </p>
        ) : (
          <p role="status" data-ai-notice="refused" style={{ margin: 0, padding: "12px 16px", borderRadius: "12px", background: T.wash, border: `1px solid ${T.washLine}`, fontSize: "14px", color: T.ink }}>
            {p.notice.text}
          </p>
        )
      ) : null}

      {!all.length ? (
        <section aria-label="No prompts yet" style={{ ...CARD, padding: "28px", display: "flex", flexDirection: "column", gap: "12px", alignItems: "flex-start" }}>
          <h2 style={H2}>{pending ? "Your prompts start tomorrow" : "No prompts in this range"}</h2>
          <p style={{ margin: 0, fontSize: "14px", lineHeight: 1.5, color: T.soft }}>{pending ? `${pending} ${pending === 1 ? "prompt is" : "prompts are"} set up. The first daily check reads them, and this page fills in from there.` : "Pick a longer range at the top of the page, or see what is tracked on the Clusters page."}</p>
          <Link href={clustersPath} style={{ fontSize: "14px", fontWeight: 600, color: T.accent, textDecoration: "none" }}>
            See your prompts on the Clusters page
          </Link>
        </section>
      ) : (
        <>
          <section aria-label="Key figures" className="app-figures" style={{ ...CARD, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", overflow: "hidden" }}>
            {[
              {
                id: "ai-named",
                label: "Share of answers naming you",
                value: <Fig def={basis(named, "answers")} style={{ fontSize: "30px", fontWeight: 700, letterSpacing: "-0.03em" }}>{pct(named)}</Fig>,
                foot: `${n(named.num)} of ${n(named.den)} answers${lflNow && lflBefore && lflBefore.den ? `; ${pct(lflNow)} on the prompts tracked throughout, was ${pct(lflBefore)}` : ""}`,
                to: `${clientPath}/named?${new URLSearchParams(base)}`,
                more: "Who is named",
              },
              {
                id: "ai-prompts",
                label: "Prompts you are named in",
                value: <Fig def={basis(promptsNamed, "prompts answered")} style={{ fontSize: "30px", fontWeight: 700, letterSpacing: "-0.03em" }}>{`${promptsNamed.num} of ${promptsNamed.den}`}</Fig>,
                foot: `${neverNamed} never name you${missingAll && missingAll < neverNamed ? `; answers to ${missingAll} of them name other brands` : ""}`,
                to: missingAll ? `${href({ missing: "1", eng: null, q: null, page: null })}#ai-prompts-h` : null,
                more: missingAll === neverNamed ? "See them" : `See the ${missingAll} naming others`,
              },
              {
                id: "ai-engine",
                label: "Strongest engine",
                value: strongest ? (
                  <Fig def={basis(strongest.rate, `${ENGINE_SPECS[strongest.engine as Engine]?.label ?? strongest.engine} answers`)} style={{ display: "inline-flex", alignItems: "center", gap: "8px", fontSize: "24px", fontWeight: 700, letterSpacing: "-0.02em" }}>
                    <EngineLogo engine={strongest.engine as Engine} size={20} />
                    {ENGINE_SPECS[strongest.engine as Engine]?.label ?? strongest.engine}
                  </Fig>
                ) : (
                  <span style={{ fontSize: "30px", fontWeight: 700 }}>-</span>
                ),
                foot: strongest ? `${pct(strongest.rate)} of its answers: ${n(strongest.rate.num)} of ${n(strongest.rate.den)}` : "No engine answered in this range",
                to: strongest ? `${href({ eng: strongest.engine, page: null })}#ai-chart-h` : null,
                more: "Chart it",
              },
              {
                id: "ai-cited",
                label: "Answers citing your site",
                value: <Fig def={basis(citing, "answers that cited any source")} style={{ fontSize: "30px", fontWeight: 700, letterSpacing: "-0.03em" }}>{pct(citing)}</Fig>,
                foot: citing.den ? `${n(citing.num)} of the ${n(citing.den)} answers that cited any source` : "No answer cited a source in this range",
                to: `${clientPath}/cited?${new URLSearchParams({ ...base, kind: "yours" })}`,
                more: "Your cited pages",
              },
            ].map((f, i) => (
              <div key={f.id} data-figure={f.id} style={{ display: "flex", flexDirection: "column", gap: "8px", padding: "20px 22px", minWidth: 0, borderLeft: i ? `1px solid ${T.line}` : undefined, marginLeft: i ? "-1px" : undefined }}>
                <span style={{ fontSize: "13px", fontWeight: 600, color: T.soft }}>{f.label}</span>
                <span style={{ color: T.ink, fontVariantNumeric: "tabular-nums" }}>{f.value}</span>
                <span style={{ fontSize: "13px", lineHeight: 1.45, color: T.soft }}>{f.foot}</span>
                {f.to ? (
                  <Link href={f.to} style={{ fontSize: "13px", fontWeight: 600, color: T.accent, textDecoration: "none", width: "fit-content" }}>
                    {f.more}
                    <span className="sr-only">{`: ${f.label}`}</span>
                  </Link>
                ) : null}
              </div>
            ))}
            <p style={{ gridColumn: "1 / -1", margin: 0, padding: "12px 22px 14px", borderTop: `1px solid ${T.line}`, fontSize: "13px", lineHeight: 1.5, color: T.soft }}>
              {`${setOn ? "On the prompts the filters pick. " : ""}An engine that returned no answer is left out of every count, not counted as a miss.${before ? ` "Was" is ${comparisonLabel(before, cmp.kind).replace(/^vs /, "")}, on the prompts tracked all of both periods.` : ""}`}
            </p>
          </section>

          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {cards.length ? (
              <ChipRow label="Filter by cluster" current={p.cluster ?? ""}>
                <Link href={href({ cluster: null, page: null })} aria-current={!p.cluster ? "true" : undefined} data-usage="ai_filter" style={PILL(!p.cluster)}>
                  All clusters
                </Link>
                {read.map((c) => (
                  <Link key={c.id} href={href({ cluster: c.id, page: null })} aria-current={p.cluster === c.id ? "true" : undefined} data-usage="ai_filter" style={PILL(p.cluster === c.id)}>
                    {c.label}
                  </Link>
                ))}
              </ChipRow>
            ) : null}
            <ChipRow label="Filter by angle" current={p.angle ?? ""}>
              <Link href={href({ angle: null, page: null })} aria-current={!p.angle ? "true" : undefined} data-usage="ai_filter" style={PILL(!p.angle)}>
                All angles
              </Link>
              {ANGLES.map((a) => (
                <Link key={a} href={href({ angle: a, page: null })} aria-current={p.angle === a ? "true" : undefined} data-usage="ai_filter" style={PILL(p.angle === a)}>
                  {cap(a)}
                </Link>
              ))}
            </ChipRow>
            <ChipRow label="Filter by where the prompt came from" current={p.origin ?? ""}>
              <Link href={href({ origin: null, page: null })} aria-current={!p.origin ? "true" : undefined} data-usage="ai_filter" style={PILL(!p.origin)}>
                Every prompt
              </Link>
              {(["chosen", ...originsSeen] as OriginFilter[]).map((o) => (
                <Link key={o} href={href({ origin: o, page: null })} aria-current={p.origin === o ? "true" : undefined} data-usage="ai_filter" style={PILL(p.origin === o)}>
                  {wordsFor(o)}
                </Link>
              ))}
            </ChipRow>
            {/* The chart's own engine chips set ?eng= for the whole page; this row stands in only when there is no chart. */}
            {checks.size > 1 ? null : (
            <ChipRow label="Filter by engine" current={p.engine ?? ""}>
              <Link href={href({ eng: null, page: null })} aria-current={!p.engine ? "true" : undefined} data-usage="engine_toggle" style={PILL(!p.engine)}>
                All engines
              </Link>
              {engines.map((e) => (
                <Link key={e} href={href({ eng: e, page: null })} aria-current={p.engine === e ? "true" : undefined} data-usage="engine_toggle" data-usage-engine={e} style={PILL(p.engine === e)}>
                  <EngineLogo engine={e} size={16} />
                  {ENGINE_SPECS[e].label}
                </Link>
              ))}
            </ChipRow>
            )}
          </div>

          {checks.size > 1 ? (
            <div id="ai-chart">
              <h2 id="ai-chart-h" className="sr-only">
                Share over time
              </h2>
              <OverviewChart
                data={{
                  engines: [...engines],
                  now: toChart(dailySeries(data.answers, range, engines, setIds)),
                  before: chartBefore ? toChart(dailySeries(data.answers, chartBefore, engines, setIds)).slice(0, daysIn(range).length) : null,
                  lflNow: lflChart ? toChart(dailySeries(data.answers, range, engines, lflChart)) : null,
                  lflBefore: lflChart && chartBefore ? toChart(dailySeries(data.answers, chartBefore, engines, lflChart)).slice(0, daysIn(range).length) : null,
                  beforeLabel: chartBefore ? `${formatDay(chartBefore.from)} - ${formatDay(chartBefore.to)}` : null,
                  lflNote: added.length ? `Like-for-like leaves out the ${added.length === 1 ? "prompt" : `${added.length} prompts`} added in this range.` : cmp.hidden,
                  notes: data.notes.map((x) => ({ index: daysIn(range).indexOf(x.note_date), text: x.text })).filter((x) => x.index >= 0),
                  brand,
                  questions: setIds ? setIds.size : new Set(data.answers.filter((a) => a.answered && a.run_date >= range.from && a.run_date <= range.to).map((a) => a.question_id)).size,
                  isoDays: daysIn(range),
                  marks: [...promptMarks, ...(p.marks ?? [])],
                  view: {
                    engine: p.engine ?? "all",
                    lfl: p.lfl && !!lflChart,
                    hrefs: { all: `${href({ eng: null })}#ai-chart`, engines: Object.fromEntries(engines.map((e) => [e, `${href({ eng: e })}#ai-chart`])), lfl: `${href({ lfl: p.lfl ? null : "1" })}#ai-chart` },
                  },
                }}
              />
            </div>
          ) : (
            <section aria-labelledby="ai-one-h" style={{ ...CARD, padding: "20px 24px", display: "flex", flexDirection: "column", gap: "6px" }}>
              <h2 id="ai-one-h" style={H2}>
                Share over time
              </h2>
              <p style={{ margin: 0, fontSize: "14px", lineHeight: 1.5, color: T.ink }}>
                <span aria-hidden="true" style={{ display: "inline-block", width: "10px", height: "10px", borderRadius: "50%", background: T.accent, marginRight: "8px" }} />
                {`One check so far, on ${formatDay([...checks][0] ?? today, true)}: named in ${n(named.num)} of ${n(named.den)} answers (${pct(named)}). The chart starts from the next check.`}
              </p>
            </section>
          )}

          {startNow && startNow.rows.length ? (
            <section aria-labelledby="ai-sn-h" style={{ ...CARD, padding: "22px 24px", display: "flex", flexDirection: "column", gap: "14px" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                <h2 id="ai-sn-h" style={H2}>
                  Start against now, by engine
                </h2>
                <p style={{ margin: 0, fontSize: "14px", lineHeight: 1.5, color: T.soft }}>{`Prompts each engine named you in at the first check in this range (${formatDay(startNow.from)}) and at the latest (${formatDay(startNow.to)}), counting only the prompts it answered on both days.`}</p>
              </div>
              <StartNowBars rows={startNow.rows.map((r) => ({ l: ENGINE_SPECS[r.engine as Engine]?.label ?? r.engine, then: r.then, now: r.now, of: r.of }))} of={Math.max(...startNow.rows.map((r) => r.of))} unit="prompts" />
            </section>
          ) : null}

          <section aria-labelledby="ai-prompts-h" style={{ ...CARD, overflow: "hidden" }}>
            <div className="ai-pad" style={{ display: "flex", flexDirection: "column", gap: "10px", padding: "20px 24px 14px" }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "8px 16px", flexWrap: "wrap" }}>
                <h2 id="ai-prompts-h" style={H2}>
                  {p.missing ? `${missingCount} ${missingCount === 1 ? "prompt names" : "prompts name"} others and never you` : `${listed.length} ${listed.length === 1 ? "prompt" : "prompts"}`}
                </h2>
                {filtered ? <ClearFilters href={`?${new URLSearchParams(base)}`} /> : null}
              </div>
              <p style={{ margin: 0, fontSize: "13px", lineHeight: 1.5, color: T.soft }}>
                {p.missing
                  ? "In this range, answers to these prompts named at least one other brand and never named you."
                  : `Engines naming you is at the latest check, of the engines that answered; answers naming you is over the range${p.engine ? `, ${ENGINE_SPECS[p.engine].label} only` : ""}. A row opens its answers.`}
              </p>
              <div style={{ display: "flex", alignItems: "center", gap: "8px 16px", flexWrap: "wrap" }}>
                <MissingToggle on={p.missing} count={missingCount} href={href({ missing: p.missing ? null : "1", page: null })} />
                <form method="get" role="search" className="app-search" style={{ display: "flex", alignItems: "center", gap: "8px", width: "300px", maxWidth: "100%", height: "44px", boxSizing: "border-box", padding: "0 12px", border: `1px solid ${T.line}`, borderRadius: "12px", background: T.surface }}>
                  {Object.entries(state)
                    .filter(([k]) => k !== "q")
                    .map(([k, v]) => (
                      <input key={k} id={`ai-${k}`} type="hidden" name={k} value={v} />
                    ))}
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={T.soft} strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                    <circle cx="11" cy="11" r="7" />
                    <path d="M20 20l-4-4" />
                  </svg>
                  <label htmlFor="ai-search" className="sr-only">
                    Search prompts
                  </label>
                  <input id="ai-search" type="search" name="q" defaultValue={p.q} maxLength={APP_LIMITS.search} placeholder="Search prompts" enterKeyHint="search" autoCapitalize="none" autoCorrect="off" spellCheck={false} style={{ flexGrow: 1, minWidth: 0, border: 0, outline: 0, fontFamily: "inherit", fontSize: "14px", color: T.ink, background: "transparent" }} />
                  {p.q.trim() ? <ClearSearch href={href({ q: null, page: null })} /> : null}
                </form>
              </div>
            </div>
            {shown.rows.length ? (
              <PromptTable rows={shown.rows} link={sortLink} rowHref={rowHref} origin={originCell} aio={rowEngines.includes("google_aio")} compared={checks.size > 1} />
            ) : (
              <p className="ai-pad" style={{ margin: 0, padding: "4px 24px 22px", fontSize: "14px", color: T.soft }}>{p.missing ? "No prompt named others and never you in this range." : "No prompt matches these filters."}</p>
            )}
            {shown.pages > 1 ? (
              <nav aria-label="Pages of prompts" className="ai-pad" style={{ display: "flex", alignItems: "center", gap: "16px", padding: "14px 24px", fontSize: "14px" }}>
                {shown.page > 1 ? (
                  <Link href={href({ page: shown.page === 2 ? null : String(shown.page - 1) })} style={{ color: T.accent, fontWeight: 600, textDecoration: "none" }}>
                    Previous
                  </Link>
                ) : null}
                <span style={{ color: T.soft }}>{`Page ${shown.page} of ${shown.pages}`}</span>
                {shown.page < shown.pages ? (
                  <Link href={href({ page: String(shown.page + 1) })} style={{ color: T.accent, fontWeight: 600, textDecoration: "none" }}>
                    Next
                  </Link>
                ) : null}
              </nav>
            ) : null}
            {/* Review of P4 (13 Oct 2026): surface "ai" brings Hide and Ask back here, to this view, with their toast. */}
            {upgrade && cta ? <UpgradePrompt copy={upgrade} cta={cta} slug={p.slug} items={facts.neverNamed?.ids ?? []} keep={{ ...state, ...(p.page > 1 ? { page: String(p.page) } : {}) }} surface="ai" /> : null}
          </section>

          {cards.some((c) => c.status !== "pending") ? (
            <section aria-label="Every daily check, by cluster" className="on-dark" style={{ padding: "28px 32px", borderRadius: "18px", background: `${CLOSE_WASH}, ${D.ground}`, color: T.surface, minWidth: 0 }}>
              <ClusterHeat heatRows={cards.filter((c) => c.status !== "pending")} data={data} range={range} compareMode={p.compareMode} today={today} brand={brand} engines={engines} clustersPath={clustersPath} rangeQuery={base} detailHref />
            </section>
          ) : null}

          <Measured prompts={all.length} engines={engines} />
        </>
      )}
    </div>
  );
}
