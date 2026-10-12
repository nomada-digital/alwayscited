import SubmitButton from "@/components/app/SubmitButton";
import Link from "@/components/app/AppLink";
import { rangeLabel } from "@/lib/tracking/date-range";

import DatePicker from "./DatePicker";

import EngineLogo from "@/components/EngineLogo";
import { APP_LIMITS } from "@/config/contact";
import { T } from "@/config/tokens";
import { type Inline, parseAnswer } from "@/components/scan/answer-markdown";
import { ENGINE_SPECS, type Engine } from "@/lib/scan/engines";
import { type ClusterDetail, type ClusterInput, clusterChart, daysOfLine, positionMove, promptBrands, promptStrip } from "@/lib/tracking/cluster-figures";
import { checkTime } from "@/lib/tracking/check-time";
import { type Day, type Range, type Rate, addDays, basis as basisLine, brandGaps, comparisonLabel, daysIn, firstCheckDay, formatDay, periodPair, pointsDelta, firstReadComplete, resolveComparison } from "@/lib/tracking/figures";
import { type AnswerTab, type LatestAnswers, answerTabs, brandRuns, pickedDayLine } from "@/lib/tracking/latest-answers";
import { NOTE_SAID, type NoteState } from "@/lib/tracking/note";
import type { ClusterNote, Compare, OverviewData } from "@/lib/tracking/overview-data";
import { askedOnFor, latestAnswersNote, lostReads, runNote, todayRun } from "@/lib/tracking/run-note";
import { answerAnchor, answerHref } from "@/lib/tracking/evidence";
import { type PromptOrigin, isPlacementPrompt } from "@/lib/diy/prompts/origins";
import type { UpsellMode } from "@/lib/tracking/ask";

import AnswerFocus from "./AnswerFocus";
import ClusterChart from "./ClusterChart";
import GridKeys from "./GridKeys";
import Fig from "./Fig";
import ScrollCue from "./ScrollCue";
import { PagePath } from "./PagePath";
import { Chip, PositionChip, noChange } from "./Overview";
import OriginChip from "./prompts/OriginChip";

/**
 * One cluster (T7 part 2b, 30 Sep 2026; BRIEF-3 T7 against
 * boards-3/QuestionDetail.dc.html): breadcrumb, the keyword as the H1 with
 * its intent and volume, the four summary figures, the cluster chart as the
 * overview draws it, the 5 prompts joined to the keyword card, and for the
 * prompt `?prompt=` picks, every check day by day, then what each engine
 * said at the latest check (`?engine=`, T7 part 3b). Each prompt row and
 * engine tab is a link, so picking works with JS off. Notes follow.
 *
 * DB-2 (9 Oct 2026): every square of the day grid is a link to that day's
 * answer from that engine (`?day=&engine=`, ending on the answer's anchor,
 * evidence.ts), and so are Who is named's, Cited pages' and the Overview's
 * heat map's. With `?day=` the panel shows that check, says so, and links
 * back to the latest.
 */

const CARD: React.CSSProperties = { background: T.surface, border: `1px solid ${T.line}`, borderRadius: "18px" };
const H2: React.CSSProperties = { margin: 0, fontSize: "19px", fontWeight: 700, letterSpacing: "-0.022em", color: T.ink };
const LEDE: React.CSSProperties = { margin: 0, fontSize: "14px", color: T.soft };
const PILL: React.CSSProperties = { padding: "3px 9px", borderRadius: "999px", fontSize: "12px", fontWeight: 600 };
const ROW_H = 64;
const PITCH = ROW_H + 4;
const CONN_W = 64;
const WORDS = ["no", "one", "two", "three", "four", "five"];
/** The board's tab labels; the full name stays in the tab's title and the answer's line. */
const SHORT: Partial<Record<Engine, string>> = { google_aio: "Google AIO" };

const NO_ORIGINS: ReadonlyMap<string, PromptOrigin> = new Map();
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const pct = (r: Rate) => (r.pct === null ? "-" : `${r.pct}%`);
const span = (r: Range) => `${formatDay(r.from)} - ${formatDay(r.to)}`;

export default function OneCluster({
  brand,
  domain,
  market,
  engines,
  today,
  range,
  compareMode,
  startedOn,
  data,
  detail,
  index,
  total,
  prompt,
  latest,
  day,
  engine,
  notes,
  canWrite,
  noteState,
  noteAction,
  clustersPath,
  origins = NO_ORIGINS,
  mode = "off",
  slug = "",
  placementsPath = null,
}: {
  brand: string;
  domain: string;
  market: string;
  engines: readonly Engine[];
  today: Day;
  range: Range;
  compareMode: Compare;
  /** The client's started_on, the date picker's first pickable day (T5). */
  startedOn?: string | null;
  data: OverviewData;
  detail: ClusterDetail;
  /** 1-based place among the client's clusters, for "Cluster 1 of 10". */
  index: number;
  total: number;
  /** The picked prompt, 0-based, already clamped to the cluster's prompts. */
  prompt: number;
  /** The picked prompt's latest check (T7 part 3b), or the `day`'s, and the engine tab `?engine=` picks. */
  latest: LatestAnswers | null;
  /** DB-2: the check `?day=` picks (latest-answers.ts pickedDay), whose answers `latest` then holds; null for the latest. */
  day: Day | null;
  engine: string;
  /** Notes on the cluster's prompts, newest first (T7 part 4a). */
  notes: ClusterNote[];
  /** Owners and editors see "Add a note" (T7 part 4b); viewers see the notes only. */
  canWrite: boolean;
  /** `?note=` after the form returns. */
  noteState: NoteState | null;
  /** POST /api/app/[client]/note for this client. */
  noteAction: string;
  clustersPath: string;
  /** 13 Oct 2026, DIY P2: each prompt's origin (loadPromptOrigins), for its chip and the "From placements" sub-list. */
  origins?: ReadonlyMap<string, PromptOrigin>;
  /** accounts.upsell_mode: the chips name Nomada only in nomada mode. */
  mode?: UpsellMode;
  slug?: string;
  /** The client's /placements, which the "From placements" sub-list links to. */
  placementsPath?: string | null;
}) {
  const c = detail.card;
  // 8 Oct 2026 (audit data-10): the comparison the Overview reads - the first week for a young client.
  // The first week's first day, from started_on and the prompts - the date picker is handed the same day.
  const firstCheck = firstCheckDay(startedOn ?? null, data.questions);
  // ON-3 review (9 Oct 2026): a first reading only when its check was complete.
  const firstComplete = firstReadComplete(data.runs, firstCheck);
  const cmp = resolveComparison(range, compareMode, startedOn ?? null, firstCheck, firstComplete);
  const before = cmp.range;
  // Audit data-3 (8 Oct 2026): every partial or failed check in the range, not only the last.
  // Merge of audit packages B and C (8 Oct 2026): this page reads its own prompts' answers only (perf-9), which
  // say whether a failed check stored answers only on a day one of them was asked (run-note.ts runNote). The
  // days are the runner's (run-note.ts askedOnFor, on decide.ts liveOn), not a copy of its rule.
  const askedOn = askedOnFor(data.questions, c.id);
  const partial = runNote(data, range, today, { askedOn });
  const input: ClusterInput = { clusters: data.clusters ?? [], questions: data.questions, keywords: data.keywords, answers: data.answers, serp: data.serp, range, before, today, engines };
  // A first week drawn dashed over the range's first days would read as a period it is not.
  const drawn = clusterChart(input, c.id);
  // ON-3 (9 Oct 2026): nor a first reading, one day laid over the range.
  const oneDay = cmp.kind === "start" || cmp.kind === "first";
  const chart = drawn && oneDay ? { ...drawn, namedBefore: null, googleBefore: null } : drawn;
  const chartBefore = oneDay ? null : before;
  // ON-3: what every change is against, on each chip (Overview.tsx Chip's `vs`).
  const vs = before ? comparisonLabel(before, cmp.kind) : null;
  const hasPrev = !!chart?.namedBefore?.some((p) => p !== null);
  const pending = c.status === "pending";
  // 9 Oct 2026 (audit copy-2): tomorrow's check time in the client's zone, from the cron (check-time.ts).
  const next = checkTime(addDays(today, 1), market);
  const rangeQuery = { from: range.from, to: range.to, ...(compareMode === "prev" ? {} : { compare: compareMode }) };
  const promptHref = (i: number) => `?${new URLSearchParams({ ...rangeQuery, prompt: String(i), ...(engine === engines[0] ? {} : { engine }) })}`;
  // DB-2: a picked day stays picked across the engine tabs; picking another prompt goes back to its latest.
  const engineHref = (e: string) => `?${new URLSearchParams({ ...rangeQuery, prompt: String(prompt), ...(day ? { day, engine: e } : e === engines[0] ? {} : { engine: e }) })}`;
  const latestHref = `?${new URLSearchParams({ ...rangeQuery, prompt: String(prompt), ...(engine === engines[0] ? {} : { engine }) })}#${answerAnchor(engine)}`;
  const dayHref = (d: Day, e: string) => answerHref("", { ...rangeQuery, prompt: String(prompt) }, { day: d, engine: e });
  const back = `${clustersPath}?${new URLSearchParams(rangeQuery)}`;
  const where = market === "UK" ? "the United Kingdom" : "the United States";
  const days = daysIn(range);
  // The day grid's row widths read the day count; globals.css turns it into 8px squares above the phone, 22px on it.
  const stripDays = { "--days": days.length } as React.CSSProperties;
  const P = c.prompts[prompt] ?? null;
  const strip = P ? promptStrip({ answers: data.answers, range, engines }, P.id) : [];
  // DB-2: a day some engine answered this prompt; its squares open that check, an engine that did not answer included.
  const checked = new Set(days.filter((_, k) => strip.some((r) => r.cells[k] !== null)));
  const brands = P ? promptBrands({ answers: data.answers, range }, P.id, brand) : null;
  // 8 Oct 2026 (audit data-6): promptBrands leaves out answers whose other brands were not read.
  const brandsUnread = P ? brandGaps(data.answers.filter((a) => a.question_id === P.id), range).reduce((s, g) => s + g.answers, 0) : 0;
  const top = Math.max(1, ...(brands?.rows.map((b) => b.n) ?? []));
  const tabs = latest?.day ? answerTabs(latest.rows, engines, brand, market) : [];
  const tab = tabs.find((t) => t.engine === engine) ?? tabs[0] ?? null;
  const latestNote = latest?.day && !day ? latestAnswersNote(data.runs, latest.day, range, today) : null;
  // DB-2: a picked day with no row stored for this prompt - no tabs' verdicts to give, only that.
  const noCheck = !!day && !!latest && latest.rows.length === 0;
  const kw = c.keyword ?? c.name;
  // DS66 (2 Oct 2026, R173 pass 7): a pending cluster read "Not in the top 20" before its first check; the prompt rows' words.
  // Audit data-7 (8 Oct 2026): "Not in the top 20" only for a keyword read and unranked, not one with no reading in the range.
  const posLine = c.position === null ? (!c.keyword ? "No keyword yet" : pending ? "Not checked yet" : c.positionRead ? "Not in the top 20" : "No Google reading in this range") : domain;
  // 8 Oct 2026 (audit data-7): never "same as" for a keyword that left or entered the top 20 (cluster-figures.ts positionMove).
  const upFrom = positionMove(c, detail.positionBeforeOn);
  // 13 Oct 2026, DIY P2: the angle prompts beside the keyword, the placement prompts under them (spec 4.10). Each keeps its
  // index in c.prompts, which `?prompt=` picks by, so a placement prompt opens its checks as any prompt does.
  const indexed = c.prompts.map((p, i) => ({ p, i }));
  const angle = indexed.filter(({ p }) => !isPlacementPrompt(origins, p.id));
  const placed = indexed.filter(({ p }) => isPlacementPrompt(origins, p.id));
  const mid = (angle.length * PITCH - 4) / 2;

  const fig = (label: string, figure: string, big: React.ReactNode, extra: React.ReactNode, sub: string, first = false) => (
    <div style={{ flex: "1 1 0", padding: "22px 24px", display: "flex", flexDirection: "column", gap: "8px", minWidth: 0, borderLeft: first ? undefined : `1px solid ${T.line}` }}>
      <span style={{ fontSize: "13px", fontWeight: 600, color: T.soft }}>{label}</span>
      <span style={{ display: "flex", alignItems: "baseline", gap: "10px", flexWrap: "wrap" }}>
        <span data-figure={figure} style={{ display: "contents" }}>
          {big}
        </span>
        {extra}
      </span>
      <span style={{ fontSize: "13px", color: T.soft }}>{sub}</span>
    </div>
  );
  const big = (t: string) => <span style={{ fontSize: "30px", fontWeight: 700, letterSpacing: "-0.03em", fontVariantNumeric: "tabular-nums" }}>{t}</span>;
  const rel = detail.reliable;
  /** One prompt's row, a link that picks it (`?prompt=`), with its origin chip as text: an anchor cannot hold another. */
  const promptRow = (p: (typeof c.prompts)[number], i: number) => {
    const on = i === prompt;
    return (
      <Link
        key={p.id}
        href={promptHref(i)}
        scroll={false}
        aria-current={on ? "true" : undefined}
        className="app-cl-prow"
        style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 52px 80px", alignItems: "center", gap: "12px", height: `${ROW_H}px`, boxSizing: "border-box", padding: "0 14px", borderRadius: "12px", border: `1px solid ${on ? T.accent : T.hair}`, background: on ? T.surface : T.bg, boxShadow: on ? `0 0 0 3px ${T.wash}` : "none", color: T.ink, textDecoration: "none" }}
      >
        <span style={{ display: "flex", flexDirection: "column", gap: "7px", minWidth: 0 }}>
          <span style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
            {p.angle || !isPlacementPrompt(origins, p.id) ? <span style={{ flexShrink: 0, padding: "2px 8px", borderRadius: "6px", background: on ? T.wash : T.chip, color: on ? T.accent : T.soft, fontSize: "11px", fontWeight: 700, letterSpacing: ".02em", textTransform: "uppercase" }}>{p.angle ?? "prompt"}</span> : null}
            <OriginChip origin={origins.get(p.id)} slug={slug} mode={mode} plain />
            {/* DS42 (2 Oct 2026): the prompt is cut at the row, as on Clusters, so hover reads it whole. */}
            <span title={p.text} style={{ fontSize: "14px", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.text}</span>
          </span>
          {p.stoppedOn !== null && c.stoppedOn === null ? (
            <span style={{ fontSize: "12px", color: T.soft, fontWeight: 600 }}>{`Stopped from ${formatDay(p.stoppedOn)}. Its history stays in your reports.`}</span>
          ) : (
          <span style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            {p.daysNamed.map((e) => (
              <span key={e.engine} title={`${ENGINE_SPECS[e.engine as Engine].label}: named on ${e.days} of ${e.of} days`} style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                <span style={{ display: "inline-flex", opacity: e.days ? 1 : 0.25 }}>
                  <EngineLogo engine={e.engine as Engine} size={16} />
                </span>
                {p.daysChecked ? <span style={{ fontSize: "12px", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{e.days}</span> : null}
              </span>
            ))}
            <span style={{ fontSize: "12px", color: T.soft }}>{p.daysChecked ? daysOfLine(p) : "Not checked yet"}</span>
          </span>
          )}
        </span>
        <span style={{ fontSize: "16px", fontWeight: 700, textAlign: "right", fontVariantNumeric: "tabular-nums" }} title={basisLine(p.now, "answers")}>
          {pct(p.now)}
        </span>
        <span style={{ display: "flex", justifyContent: "flex-end" }}>
          <Chip value={pointsDelta(p.now, p.before)} unit=" pts" none={pending ? "Tomorrow" : before ? "New" : ""} vs={vs} />
        </span>
      </Link>
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px", color: T.ink }}>
      <nav aria-label="Breadcrumb" style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "14px" }}>
        <Link href={back} style={{ display: "flex", alignItems: "center", gap: "4px", fontWeight: 600, color: T.accent, textDecoration: "none" }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={T.accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          Clusters
        </Link>
        <span style={{ color: T.soft }}>{`/ Cluster ${index} of ${total}`}</span>
      </nav>

      <header style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "32px", flexWrap: "wrap" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "10px", minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
            <span style={{ ...PILL, background: T.chip, color: T.ink }}>Google keyword</span>
            {c.intent ? <span style={{ ...PILL, background: T.wash, color: T.accent }}>{cap(c.intent)}</span> : null}
            {c.volume !== null ? <span style={{ fontSize: "13px", color: T.soft }}>{`${c.volume.toLocaleString("en-GB")} searches a month in ${where}`}</span> : null}
          </div>
          <h1 style={{ margin: 0, fontSize: "32px", lineHeight: 1.15, fontWeight: 700, letterSpacing: "-0.03em" }}>{kw}</h1>
          <p style={LEDE}>
            {`${c.prompts.length} prompt${c.prompts.length === 1 ? "" : "s"} asked every morning on ${WORDS[engines.length] ?? engines.length} engines${c.keyword === null ? ". It has no Google keyword yet" : ", and the keyword checked on Google"}. `}
            {pending ? `First check tomorrow at ${next}.` : `Tracked since ${formatDay(c.started_on, true)}.`}
            {/* DS64 (2 Oct 2026, R173 pass 7): Clusters marked a stop and this page did not; the same words as Clusters. */}
            {c.stoppedOn !== null ? ` Stopped from ${formatDay(c.stoppedOn)}. Its history stays in your reports.` : null}
          </p>
          {/* R151 (1 Oct 2026): the list screens' partial note, one sentence in run-note.ts. */}
          {partial ? <p style={{ margin: 0, fontSize: "14px", lineHeight: 1.5, color: T.soft, maxWidth: "680px" }}>{partial}</p> : null}
        </div>
        {/* T5 (30 Sep 2026): the server-drawn face opens boards/DatePicker.dc.html; JS off still shows the range. */}
        <DatePicker range={range} compare={compareMode} today={today} startedOn={startedOn ?? null} firstCheck={firstCheck} firstComplete={firstComplete} grow={false}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={T.ink} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="5" width="18" height="16" rx="2" />
            <path d="M3 10h18M8 3v4M16 3v4" />
          </svg>
          <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.25 }}>
            <span style={{ fontSize: "14px", fontWeight: 700 }}>{rangeLabel(range, today, startedOn ?? null)}</span>
            <span style={{ fontSize: "12px", color: T.soft }}>{`${formatDay(range.from)} - ${formatDay(range.to, true)}${before ? `, ${comparisonLabel(before, cmp.kind)}` : ""}`}</span>
          </span>
        </DatePicker>
      </header>

      <section aria-label="Summary" className="app-cl-sum" style={{ ...CARD, display: "flex", flexWrap: "wrap" }}>
        {/* R148 pass 7 (1 Oct 2026): before the first answer there is no count to give - "-", not "0 of 0" or "0 of 5". */}
        {fig("Answers naming you", "cl-named", big(c.now.den ? `${c.now.num} of ${c.now.den}` : "-"), <Chip value={c.delta} unit=" pts" none={noChange(c)} vs={vs} />, !c.now.den ? "No answers yet" : periodPair(c.now, c.before, cmp.kind), true)}
        {fig("Google position", "cl-google", big(c.position === null ? "-" : `#${c.position}`), <PositionChip c={c} vs={vs} />, `${posLine}${upFrom}`)}
        {fig("Prompts naming you", "cl-prompts", big(c.now.den ? `${c.promptsNamed.num} of ${c.promptsNamed.den}` : "-"), null, c.now.den ? "Each named you on at least one engine" : `${c.promptsNamed.den} prompts, none checked yet`)}
        {fig(
          "Most reliable engine",
          "cl-reliable",
          rel ? (
            <span style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <EngineLogo engine={rel.engine as Engine} size={24} />
              <span style={{ fontSize: "22px", fontWeight: 700 }}>{ENGINE_SPECS[rel.engine as Engine].label}</span>
            </span>
          ) : (
            big("-")
          ),
          null,
          rel ? `Named you in ${rel.rate.num} of ${rel.rate.den} answers` : pending ? "No answers yet" : "No engine named you this period",
        )}
      </section>

      {chart ? (
        <ClusterChart
          data={{
            keyword: kw,
            title: "AI answers and Google, day by day",
            site: domain,
            brand,
            days: chart.days.map((d, i) => (i === chart.days.length - 1 && d === today ? "Today" : formatDay(d))),
            dayLabels: chart.days.map((d) => formatDay(d, true)),
            named: chart.named,
            google: chart.google,
            prevLabels: chartBefore ? daysIn(chartBefore).map((d) => formatDay(d)) : null,
            namedBefore: chart.namedBefore,
            googleBefore: chart.googleBefore,
            beforeLabel: chartBefore ? span(chartBefore) : null,
            answersPerDay: c.prompts.length * engines.length,
            pending,
            firstCheckAt: next,
            note: !pending && !hasPrev ? (cmp.kind === "start" && before ? `Tracked from ${formatDay(c.started_on)}. Its changes are against your first week, ${span(before)}.` : cmp.kind === "first" && before ? `Tracked from ${formatDay(c.started_on)}. Its changes are against your first reading, ${formatDay(before.from)}.` : `Tracked from ${formatDay(c.started_on)}. No earlier period to compare yet.`) : null,
            phoneLine: pending
              ? `First check tomorrow at ${next}.`
              : `${pct(c.now)} named, ${c.position === null ? (c.keyword ? "no Google position" : "no keyword yet") : `#${c.position} on Google`}.` + (hasPrev && chartBefore ? ` Dashed: ${span(chartBefore)}` : ` Tracked from ${formatDay(c.started_on)}.`),
            openHref: null,
          }}
        />
      ) : null}

      <section aria-labelledby="lk-h" style={{ ...CARD, padding: "24px", display: "flex", flexDirection: "column", gap: "16px" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "16px", flexWrap: "wrap" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <h2 id="lk-h" style={H2}>
              {`The ${angle.length} prompts behind this keyword`}
            </h2>
            <p style={LEDE}>One per angle, each asking for a recommendation. Pick one to see every check and what each engine said.</p>
          </div>
          <Link href={`${clustersPath}?${new URLSearchParams({ ...rangeQuery, open: c.id })}`} style={{ fontSize: "14px", fontWeight: 600, color: T.accent, textDecoration: "none", flexShrink: 0 }}>
            {/* DS69 (2 Oct 2026, R173 pass 8): a viewer was offered "Manage prompts" and could manage nothing there. */}
            {canWrite ? "Manage prompts" : "See them on Clusters"}
          </Link>
        </div>
        <div className="app-pair" style={{ display: "flex", alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "4px", flex: "1 1 360px", minWidth: 0 }}>
            {angle.map(({ p, i }) => promptRow(p, i))}
          </div>
          <svg className="app-hide-sm" width={CONN_W} height={angle.length * PITCH - 4} viewBox={`0 0 ${CONN_W} ${angle.length * PITCH - 4}`} aria-hidden="true" style={{ flexShrink: 0 }}>
            {angle.map(({ p, i }, k) => {
              const y = ROW_H / 2 + k * PITCH;
              const on = i === prompt;
              return <path key={p.id} d={`M0,${y} C${CONN_W * 0.55},${y} ${CONN_W * 0.45},${mid} ${CONN_W},${mid}`} fill="none" stroke={on ? T.accent : p.now.num ? T.washLine : T.line} strokeWidth={on ? 2.6 : 1.6} strokeLinecap="round" />;
            })}
            <circle cx={CONN_W - 3} cy={mid} r={4} fill={T.accent} />
          </svg>
          {/* minWidth 0: with 1.4.12 spacing its min-content (327px) ran 48px past 320 (R151, 3 Oct 2026). */}
          <div className="app-cl-kw" style={{ width: "256px", flexShrink: 0, minWidth: 0, boxSizing: "border-box", padding: "18px", borderRadius: "14px", border: `1px solid ${T.washLine}`, background: T.surface, display: "flex", flexDirection: "column", gap: "10px" }}>
            <span style={{ fontSize: "12px", fontWeight: 600, color: T.soft }}>Google keyword</span>
            <span style={{ fontSize: "16px", fontWeight: 700, lineHeight: 1.3 }}>{kw}</span>
            <span style={{ display: "flex", alignItems: "baseline", gap: "10px", flexWrap: "wrap" }}>
              <span style={{ fontSize: "36px", fontWeight: 700, letterSpacing: "-0.03em", fontVariantNumeric: "tabular-nums" }}>{c.position === null ? "-" : `#${c.position}`}</span>
              <PositionChip c={c} vs={vs} />
            </span>
            {c.positionBefore !== null && detail.positionBeforeOn ? <span style={{ fontSize: "13px", color: T.soft }}>{`was #${c.positionBefore} on ${formatDay(detail.positionBeforeOn)}`}</span> : null}
            <span style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
              {c.intent ? <span style={{ ...PILL, background: T.wash, color: T.accent }}>{cap(c.intent)}</span> : null}
              {c.volume !== null ? <span style={{ ...PILL, background: T.chip, color: T.ink }}>{`${c.volume.toLocaleString("en-GB")} a month`}</span> : null}
            </span>
            <span style={{ display: "flex", flexDirection: "column", gap: "2px", borderTop: `1px solid ${T.line}` }}>
              <span style={{ fontSize: "12px", color: T.soft, paddingTop: "10px" }}>Your ranking page</span>
              {/* R148 pass 10 (1 Oct 2026): with no keyword nothing was checked, so "None in the top 20" was a reading that never happened. */}
              <span style={{ fontSize: "13px", fontWeight: 500 }}>{c.keyword === null ? "Once its keyword is added" : pending && c.position === null ? "From the first check" : c.position === null ? "None in the top 20" : domain}</span>
            </span>
          </div>
        </div>
        {placed.length ? (
          <div aria-labelledby="fp-h" role="group" style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "10px 16px", flexWrap: "wrap" }}>
              <span style={{ display: "flex", alignItems: "baseline", gap: "10px", flexWrap: "wrap" }}>
                <span id="fp-h" style={{ fontSize: "14px", fontWeight: 700 }}>
                  From placements
                </span>
                <span style={{ fontSize: "12px", color: T.soft }}>These don&apos;t use your 5 prompt slots.</span>
              </span>
              {placementsPath ? (
                <Link href={placementsPath} style={{ fontSize: "14px", fontWeight: 600, color: T.accent, textDecoration: "none", flexShrink: 0 }}>
                  See placements
                </Link>
              ) : null}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>{placed.map(({ p, i }) => promptRow(p, i))}</div>
          </div>
        ) : null}
      </section>

      {P ? (
        // R151 (3 Oct 2026): at 390 this card scrolls 356 of 1,058px with nothing to say so - the later
        // days and each engine's "N of 28" sat out of sight. It takes the keyboard, and the phone line
        // under the grid says what is to the right. At 1280 the board's fixed 22px squares (sized for
        // 1440) still pushed the "N of 28" column 108px out of the card with no cue, so above the phone
        // the squares narrow to fit (8-22px, .app-strip-cell) and the phone keeps 22px and the swipe.
        // ScrollCue shows the line, and keeps the tab stop, whenever the grid still overflows.
        // Audit mobile-3 (8 Oct 2026): the whole card was the scroller, so it opened on the oldest
        // days (3 of 28 at 320) and a swipe to Today took the heading, the prompt, the legend and
        // the engine names with it, leaving "8 of 28" with nothing to say whose. Now only the grid
        // scrolls; the engine mark and the count stay put at each side (.app-strip-lab, .app-strip-n)
        // and the grid opens on its latest day (.app-strip-scroll, with JS or without).
        <section aria-labelledby="strip-h" style={{ ...CARD, padding: "24px", display: "flex", flexDirection: "column", gap: "14px", minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "24px", flexWrap: "wrap" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: "4px", minWidth: 0 }}>
              <h2 id="strip-h" style={H2}>
                Every check, day by day
              </h2>
              <p style={{ margin: 0, fontSize: "14px", color: T.ink }}>{`${P.angle ? `${cap(P.angle)}: ` : ""}${P.text}`}</p>
              {/* DS63 (2 Oct 2026, R173 pass 7): a pending cluster drew 28 empty squares and four "-" with nothing saying when they fill. */}
              {strip.every((r) => !r.answered) ? <p style={{ margin: 0, fontSize: "13px", color: T.soft }}>{pending ? `First check tomorrow at ${next}. A square fills in for each engine every day from then.` : "No check of this prompt in this range. Pick another range to see its days."}</p> : <p style={{ margin: 0, fontSize: "13px", color: T.soft }}>Pick a square to read what that engine said that day.<span className="sr-only"> The arrow keys move between the squares.</span></p>}
            </div>
            <span style={{ display: "flex", alignItems: "center", gap: "16px", fontSize: "13px", color: T.soft, flexShrink: 0 }}>
              <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <span style={{ width: "12px", height: "12px", borderRadius: "3px", background: T.accent }} />
                Named you
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <span style={{ width: "12px", height: "12px", borderRadius: "3px", background: T.hair, border: `1px solid ${T.line}`, boxSizing: "border-box" }} />
                {"Didn't name you"}
              </span>
            </span>
          </div>
          {/* DB-2 (9 Oct 2026): 4px above and below, so a square's focus ring and the picked square's ring are not cut by the scroller. */}
          <div id="strip-scroll" className="app-strip-scroll" role="group" aria-labelledby="strip-h" tabIndex={0} style={{ display: "flex", flexDirection: "column", gap: "14px", overflowX: "auto", minWidth: 0, padding: "4px 0" }}>
          {strip.map((r, ri) => (
            <div key={r.engine} className="app-strip-row" style={{ display: "grid", gridTemplateColumns: "170px minmax(0, 1fr) 92px", alignItems: "center", gap: "16px", ...stripDays }}>
              <span className="app-strip-lab" style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "14px", fontWeight: 600 }}>
                <EngineLogo engine={r.engine as Engine} size={20} />
                <span className="app-strip-name">{ENGINE_SPECS[r.engine as Engine].label}</span>
              </span>
              <span style={{ display: "flex", gap: "4px" }}>
                {r.cells.map((x, k) => {
                  const d = days[k]!;
                  // DB-2 (9 Oct 2026): the day, the engine and the outcome in words, never the colour alone. Each square is
                  // 24px wide (globals.css .app-strip-cell); on a phone .app-tap keeps it 28 tall and takes the tap 44px
                  // tall, where a 44px link would stretch the grid.
                  const said = `${formatDay(d, true)}, ${ENGINE_SPECS[r.engine as Engine].label}: ${x === null ? "no answer" : x ? "named you" : "didn't name you"}`;
                  const look: React.CSSProperties = { flex: "1 1 0", maxWidth: "24px", height: "28px", borderRadius: "5px", boxSizing: "border-box", background: x ? T.accent : x === false ? T.hair : T.surface, border: x === null ? `1px dashed ${T.line}` : undefined };
                  if (!checked.has(d)) return <span key={d} title={said} className="app-strip-cell" style={look} />;
                  const on = day === d && r.engine === engine;
                  return (
                    <Link
                      key={d}
                      href={dayHref(d, r.engine)}
                      data-row={ri}
                      data-col={k}
                      aria-label={`${said}. Open this answer.`}
                      aria-current={on ? "true" : undefined}
                      title={said}
                      className="app-strip-cell app-strip-a app-tap"
                      style={{ ...look, display: "block", boxShadow: on ? `0 0 0 2px ${T.surface}, 0 0 0 4px ${T.ink}` : undefined }}
                    />
                  );
                })}
              </span>
              <span className="app-strip-n" style={{ fontSize: "14px", fontWeight: 700, textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{r.answered ? `${r.named} of ${r.answered}` : "-"}</span>
            </div>
          ))}
          <div aria-hidden="true" className="app-strip-row" style={{ display: "grid", gridTemplateColumns: "170px minmax(0, 1fr) 92px", gap: "16px", ...stripDays }}>
            <span className="app-strip-lab" />
            <span style={{ display: "flex", gap: "4px" }}>
              {days.map((d, i) => (
                // The last label ends at its square, so "Today" runs left rather than under the count.
                <span key={d} className="app-strip-cell" style={{ flex: "1 1 0", maxWidth: "24px", display: "flex", justifyContent: i === days.length - 1 && i > 0 ? "flex-end" : "flex-start", fontSize: "12px", color: T.soft, whiteSpace: "nowrap" }}>
                  {i === days.length - 1 && d === today ? "Today" : i % 7 === 0 || i === days.length - 1 ? formatDay(d) : ""}
                </span>
              ))}
            </span>
            <span className="app-strip-n" />
          </div>
          </div>
          <ScrollCue target="strip-scroll">{`Swipe for the earlier days, back to ${days.length ? formatDay(days[0]!) : "the start of the range"}.`}</ScrollCue>
          {/* DB-2: the squares are one tab stop with script, the arrow keys moving between days and engines. */}
          <GridKeys target="strip-scroll" version={`${P.id} ${day ?? ""} ${engine} ${range.from} ${range.to}`} />
        </section>
      ) : null}

      {P && tab && latest?.day ? (
        // DB-2 (9 Oct 2026): the anchor a day's link ends on names the engine, and takes focus when a link lands on it.
        <section id={answerAnchor(tab.engine)} tabIndex={-1} aria-labelledby="ans-h" className="app-answer" style={{ ...CARD, padding: "24px", display: "flex", flexDirection: "column", gap: "20px" }}>
          <AnswerFocus id={answerAnchor(tab.engine)} at={`${latest.day} ${tab.engine}`} />
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px", flexWrap: "wrap" }}>
            <h2 id="ans-h" style={H2}>
              {day ? `Answers on ${formatDay(day, true)}` : "Latest answers"}
            </h2>
            {noCheck ? null : (
            <nav aria-label="Engines" style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              {tabs.map((t) => {
                const on = t.engine === tab.engine;
                const label = ENGINE_SPECS[t.engine as Engine].label;
                return (
                  <Link
                    key={t.engine}
                    href={engineHref(t.engine)}
                    scroll={false}
                    aria-current={on ? "true" : undefined}
                    title={`${label}: ${t.named === null ? "no answer" : t.named ? `names ${brand}` : `doesn't name ${brand}`}`}
                    style={{ display: "flex", alignItems: "center", gap: "8px", height: "44px", boxSizing: "border-box", padding: "0 14px", border: `1px solid ${on ? T.washLine : T.line}`, borderRadius: "12px", background: on ? T.wash : T.surface, color: T.ink, fontSize: "14px", fontWeight: 600, textDecoration: "none" }}
                  >
                    <EngineLogo engine={t.engine as Engine} size={18} />
                    {SHORT[t.engine as Engine] ?? label}
                    <span aria-hidden="true" style={{ width: "8px", height: "8px", borderRadius: "50%", background: t.named === null ? T.faint : t.named ? T.goodFg : T.badFg }} />
                  </Link>
                );
              })}
            </nav>
            )}
          </div>
          {day ? (
            // DB-2: which check this is, in words, and the way back to the latest.
            <p style={{ margin: 0, fontSize: "14px", lineHeight: 1.5, color: T.ink }}>
              {`${pickedDayLine({ day, today, market, stored: !noCheck, run: todayRun(data.runs, today), label: ENGINE_SPECS[tab.engine as Engine].label, answered: tab.named !== null })} `}
              <Link href={latestHref} style={{ fontWeight: 600, color: T.accent, textDecoration: "none", whiteSpace: "nowrap" }}>
                See the latest answers
              </Link>
            </p>
          ) : latestNote ? (
            <p style={{ margin: 0, fontSize: "14px", lineHeight: 1.5, color: T.ink }}>{latestNote}</p>
          ) : null}
          {noCheck ? null : (
            <>
              <Answer tab={tab} brand={brand} day={latest.day} today={today} unsure={!data.lastRun || data.lastRun.run_date !== latest.day || lostReads(data.lastRun)} />
              <p style={{ margin: 0, fontSize: "13px", color: T.soft }}>{`What each engine said at ${latest.day === today ? "today's" : `the ${formatDay(latest.day)}`} check, with link addresses taken out of the text.`}</p>
            </>
          )}
        </section>
      ) : null}

      <div className="app-pair" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: "24px" }}>
      {P && brands && brands.answers ? (
        <section aria-labelledby="al-h" style={{ ...CARD, padding: "24px", display: "flex", flexDirection: "column", gap: "14px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <h2 id="al-h" style={H2}>
              Named in answers to this prompt
            </h2>
            <p style={LEDE}>{`Out of ${brands.answers} answers this period${brandsUnread ? `. ${brandsUnread} more ${brandsUnread === 1 ? "is" : "are"} left out: the other brands in ${brandsUnread === 1 ? "it were" : "them were"} not read` : ""}.`}</p>
          </div>
          {brands.rows.map((b) => (
            <div key={b.name} style={{ display: "grid", gridTemplateColumns: "100px minmax(0, 1fr) 40px", alignItems: "center", gap: "12px" }}>
              <span title={b.name} style={{ fontSize: "14px", fontWeight: b.you ? 700 : 500, color: b.you ? T.accent : T.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.name}</span>
              <span aria-hidden="true" style={{ height: "8px", borderRadius: "4px", background: T.hair }}>
                <span style={{ display: "block", height: "100%", width: `${Math.round((96 * b.n) / top)}%`, borderRadius: "4px", background: b.you ? T.accent : T.faint }} />
              </span>
              <Fig style={{ fontSize: "14px", fontWeight: 700, textAlign: "right", fontVariantNumeric: "tabular-nums" }} def={basisLine({ num: b.n, den: brands.answers }, "answers")}>
                {b.n}
              </Fig>
            </div>
          ))}
        </section>
      ) : null}
        <section aria-labelledby="log-h" style={{ ...CARD, padding: "24px", display: "flex", flexDirection: "column", gap: "12px", gridColumn: P && brands && brands.answers ? undefined : "1 / -1" }}>
          <h2 id="log-h" style={H2}>
            Notes on this cluster
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: "10px", fontSize: "14px" }}>
            {[...notes.map((n) => ({ day: n.note_date, text: n.text })), ...(pending ? [] : [{ day: c.started_on, text: `Tracking began: the keyword and its ${c.prompts.length} prompts.` }])].map((n, i) => (
              <div key={i} style={{ display: "flex", gap: "12px" }}>
                <span style={{ width: "56px", flexShrink: 0, color: T.soft }}>{formatDay(n.day)}</span>
                <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>{n.text}</span>
              </div>
            ))}
            {pending ? <span style={{ color: T.soft }}>{`No notes yet. The first check is tomorrow at ${next}.`}</span> : null}
          </div>
          {noteState ? (
            <p id="note-said" role="status" style={{ margin: 0, fontSize: "13px", color: noteState === "saved" ? T.goodFg : T.badFg }}>
              {NOTE_SAID[noteState]}
            </p>
          ) : null}
          {canWrite && P ? (
            // R151 (3 Oct 2026): a refused note reopens the form, so the next try is one step, not two.
            <details open={noteState !== null && noteState !== "saved"}>
              <summary style={{ listStyle: "none", display: "inline-flex", alignItems: "center", gap: "6px", height: "40px", boxSizing: "border-box", padding: "0 14px", border: `1px solid ${T.line}`, borderRadius: "10px", background: T.surface, fontSize: "14px", fontWeight: 600, cursor: "pointer" }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={T.ink} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
                </svg>
                Add a note
              </summary>
              <form method="post" action={`${noteAction}?${new URLSearchParams({ ...rangeQuery, cluster: c.id, q: P.id, prompt: String(prompt), ...(day ? { day } : {}), ...(engine === engines[0] ? {} : { engine }) })}`} style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "12px" }}>
                <label htmlFor="note-text" style={{ fontSize: "13px", color: T.soft }}>{`Dated today, on this prompt. Up to ${APP_LIMITS.note} characters.`}</label>
                <textarea id="note-text" name="text" autoFocus={noteState !== null && noteState !== "saved"} aria-describedby={noteState !== null && noteState !== "saved" ? "note-said" : undefined} required maxLength={APP_LIMITS.note} rows={2} style={{ font: "inherit", fontSize: "14px", padding: "10px 12px", border: `1px solid ${T.line}`, borderRadius: "10px", resize: "vertical" }} />
                <SubmitButton busy="Saving..." style={{ alignSelf: "flex-start", height: "40px", padding: "0 16px", border: 0, borderRadius: "10px", background: T.accent, color: T.surface, fontFamily: "inherit", fontSize: "14px", fontWeight: 600 }}>
                  Save note
                </SubmitButton>
              </form>
            </details>
          ) : P ? (
            // DS65 (2 Oct 2026, R173 pass 7): a viewer lost "Add a note" with no reason, as Clusters' DS61 line.
            <p style={{ margin: 0, fontSize: "13px", lineHeight: 1.5, color: T.soft }}>Only owners and editors can add a note - ask one of them to add one.</p>
          ) : null}
        </section>
      </div>
    </div>
  );
}

/** One engine's answer (T7 part 3b): the verdict, the words with the brand in accent, pages cited, brands named. */
// R151 (1 Oct 2026): unless the day's run is the last one shown and it completed, an unanswered
// read may be a failed one (a partial run's, or a failed run's, whose rows are still stored), not
// the engine's silence - so "gave no answer" would say something the engine may not have done.
// 8 Oct 2026 (audit reliability-1 / data-6): a run partial only for a brand gap lost no read, so
// it counts as completed here - it asks lostReads, as the Overview's partial line does.
function Answer({ tab, brand, day, today, unsure }: { tab: AnswerTab; brand: string; day: Day; today: Day; unsure: boolean }) {
  const label = ENGINE_SPECS[tab.engine as Engine].label;
  const when = `${day === today ? "Today" : formatDay(day, true)}${tab.time ? `, ${tab.time}` : ""}`;
  const pill =
    tab.named === null
      ? { text: "No answer", bg: T.chip, fg: T.soft }
      : tab.named
        ? { text: `Names ${brand}`, bg: T.goodBg, fg: T.goodFg }
        : { text: `Doesn’t name ${brand}`, bg: T.badBg, fg: T.badFg };
  const H3: React.CSSProperties = { margin: 0, fontSize: "14px", fontWeight: 700 };
  return (
    <div className="app-pair" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 340px", gap: "32px" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: "14px", minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
          <span style={{ padding: "3px 10px", borderRadius: "999px", background: pill.bg, color: pill.fg, fontSize: "12px", fontWeight: 700 }}>{pill.text}</span>
          <span style={{ fontSize: "13px", color: T.soft }}>{tab.named === null ? (unsure ? `No answer came back from ${label} at this check.` : `${label} gave no answer at this check.`) : `What ${label} said. ${when}.`}</span>
        </div>
        {tab.text ? <AnswerText source={tab.text} brand={brand} /> : tab.named !== null ? <p style={{ margin: 0, fontSize: "14px", color: T.soft }}>The words were not kept for this check.</p> : null}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "16px", minWidth: 0 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          <h3 style={H3}>Pages it cited</h3>
          {tab.pages.length ? (
            <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
              {tab.pages.map((pg) => (
                <li key={pg} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", padding: "10px 0", borderTop: `1px solid ${T.hair}` }}>
                  <span style={{ fontSize: "14px", color: T.ink, minWidth: 0, overflowWrap: "anywhere" }}><PagePath page={pg} /></span>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={T.soft} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
                    <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
                  </svg>
                </li>
              ))}
            </ul>
          ) : (
            <span style={{ fontSize: "14px", color: T.soft }}>{tab.named === null ? "-" : "None at this check"}</span>
          )}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <h3 style={H3}>Brands it named</h3>
          {tab.brands.length ? (
            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
              {tab.brands.map((b) => (
                <span key={b.name} style={{ padding: "4px 10px", borderRadius: "999px", background: b.you ? T.wash : T.chip, color: b.you ? T.accent : T.ink, fontSize: "13px", fontWeight: 600 }}>
                  {b.name}
                </span>
              ))}
            </div>
          ) : (
            <span style={{ fontSize: "14px", color: T.soft }}>{tab.named === null ? "-" : tab.othersRead ? "None" : "Not read at this check"}</span>
          )}
          {/* 8 Oct 2026 (audit data-6): brand extraction failed for this answer, so the list may be short - never "None". */}
          {tab.brands.length && !tab.othersRead ? <span style={{ fontSize: "13px", color: T.soft }}>Other brands were not read at this check, so this list may be short.</span> : null}
        </div>
      </div>
    </div>
  );
}

/** The stored answer as markdown (answer-markdown.ts), every string a React text node; the client's name in accent, `[3]` markers dropped with the links. */
function AnswerText({ source, brand }: { source: string; brand: string }) {
  const text: React.CSSProperties = { margin: 0, fontSize: "15px", lineHeight: 1.6, color: T.ink };
  const cell: React.CSSProperties = { padding: "6px 8px", borderBottom: `1px solid ${T.hair}`, verticalAlign: "top", textAlign: "left" };
  const runs = (xs: Inline[]) =>
    xs
      .filter((x) => !x.cite)
      .flatMap((x, i) =>
        brandRuns(x.text, brand).map((r, j) =>
          r.brand || x.bold ? (
            <strong key={`${i}-${j}`} style={{ color: r.brand ? T.accent : undefined, fontWeight: 700 }}>
              {r.text}
            </strong>
          ) : (
            <span key={`${i}-${j}`}>{r.text}</span>
          ),
        ),
      );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px", maxWidth: "620px" }}>
      {parseAnswer(source).map((b, i) => {
        if (b.kind === "table") {
          return (
            <div key={i} style={{ overflowX: "auto" }}>
              <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "13px", lineHeight: 1.5, color: T.ink }}>
                <thead>
                  <tr>
                    {b.head.map((c, j) => (
                      <th key={j} style={{ ...cell, fontWeight: 600, borderBottom: `1px solid ${T.line}` }}>
                        {runs(c)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {b.rows.map((r, j) => (
                    <tr key={j}>
                      {r.map((c, k) => (
                        <td key={k} style={cell}>
                          {runs(c)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        if (b.kind === "ul" || b.kind === "ol") {
          const items = b.items.map((it, j) => <li key={j}>{runs(it)}</li>);
          const style: React.CSSProperties = { ...text, paddingLeft: "20px", display: "flex", flexDirection: "column", gap: "6px" };
          return b.kind === "ol" ? (
            <ol key={i} style={{ ...style, listStyle: "decimal" }}>
              {items}
            </ol>
          ) : (
            <ul key={i} style={{ ...style, listStyle: "disc" }}>
              {items}
            </ul>
          );
        }
        if (b.kind === "h") {
          return (
            <p key={i} style={{ ...text, fontWeight: 700 }}>
              {runs(b.text)}
            </p>
          );
        }
        if (b.kind !== "p") return null;
        return (
          <p key={i} style={text}>
            {b.lines.map((l, j) => (
              <span key={j}>
                {j ? " " : null}
                {runs(l)}
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
}
