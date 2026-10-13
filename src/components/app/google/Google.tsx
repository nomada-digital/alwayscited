import Link from "@/components/app/AppLink";

import PositionBands from "@/components/charts/PositionBands";
import type { TierKey } from "@/components/TierName";
import { APP_LIMITS } from "@/config/contact";
import { T } from "@/config/tokens";
import { appPath } from "@/lib/app-host";
import { vendorLabel } from "@/lib/diy/core/evidence";
import { type Dismissal, type FootprintData, type SerpDetail, firstReadOn, liveDismissal } from "@/lib/diy/keywords/data";
import { type Pull, completePull } from "@/lib/diy/keywords/footprint";
import type { IntentKey, View } from "@/lib/diy/keywords/keys";
import { losingGround } from "@/lib/diy/keywords/losing";
import { type Momentum, momentum } from "@/lib/diy/keywords/momentum";
import { type RankingSort, filterRanking, pageOf, rankingKpis, rankingRows, sortRanking } from "@/lib/diy/keywords/ranking";
import { pageOne, serpCompetitors } from "@/lib/diy/keywords/serp-competitors";
import { BAND_LABEL, BANDS, type Band, type TrackedSort, filterTracked, positionBands, readingsByKeyword, sortTracked, trackedKpis, trackedRows, urlAt } from "@/lib/diy/keywords/tracked";
import { type KeywordsDone, type KeywordsWhy, keywordsToast } from "@/lib/diy/keywords/write";
import type { Section } from "@/lib/diy/plan/data";
import { ordinal } from "@/lib/diy/plan/words";
import { formatDate } from "@/lib/format-date";
import { INTENTS, keywordForm } from "@/lib/scan/dataforseo-request";
import type { UpsellMode } from "@/lib/tracking/ask";
import { clusterCards } from "@/lib/tracking/cluster-figures";
import { rangeLabel } from "@/lib/tracking/date-range";
import { type Day, type Range, comparisonLabel, firstCheckDay, firstReadComplete, formatDay, resolveComparison } from "@/lib/tracking/figures";
import type { Compare, OverviewData } from "@/lib/tracking/overview-data";
import { lostReads, runNote, todayRun } from "@/lib/tracking/run-note";
import { offPageOneFacts } from "@/lib/tracking/upgrade-facts";
import { type Facts, type PromptCta, pickPrompt, promptCopy, rowFor } from "@/lib/tracking/upgrade-prompts";

import { ClearFilters, ClearSearch } from "../ClearLinks";
import DatePicker from "../DatePicker";
import Fig from "../Fig";
import UpgradePrompt from "../UpgradePrompt";
import GainingGround, { type GainingState } from "./GainingGround";
import PackPrompt from "./PackPrompt";
import RankingTable from "./RankingTable";
import TrackedTable from "./TrackedTable";

/**
 * Google (13 Oct 2026, DIY P6; spec 10 section 4.3): where do I rank for the
 * keywords that sell, what is rising, and who holds page 1? Answers Danny's
 * questions (a) and (b).
 *
 * Two kinds of data, labelled two ways (spec 2.6). The Tracked view is ours:
 * the tracked keywords read on Google every day (tracking_serp), with their
 * pages and Google's top 10. Gaining ground and the All view are DataForSEO's
 * estimates from the weekly footprint, each with its read date, never counted
 * in the daily figures. While diy_enabled is off both are hidden and the view
 * switch shows Tracked only (the dark rule, section 4).
 *
 * Every filter, sort, page and expander is in the URL and every control a
 * link, a GET form or a POST form answered by a 303, so the page reads and
 * works the same with JS off. The only writes are Dismiss and Restore, to
 * the keywords route; Track as a cluster is a link to Clusters' add panel.
 */

const n = (x: number) => x.toLocaleString("en-GB");
const CARD: React.CSSProperties = { background: T.surface, border: `1px solid ${T.line}`, borderRadius: "18px", minWidth: 0 };
const H2: React.CSSProperties = { margin: 0, fontSize: "19px", fontWeight: 700, letterSpacing: "-0.022em", color: T.ink };
const PILL = (on: boolean) =>
  ({ display: "inline-flex", alignItems: "center", gap: "6px", height: "36px", padding: "0 14px", boxSizing: "border-box", borderRadius: "999px", border: `1px solid ${on ? T.washLine : T.line}`, background: on ? T.wash : T.surface, color: T.ink, fontSize: "13px", fontWeight: 600, textDecoration: "none", whiteSpace: "nowrap" }) as const;
const SECTION_ERROR = "We couldn't read this part just now. The rest of the page is up to date.";
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The page's own layout rules: tables become cards below 860px, with a 16px gutter. Hoisted once by React, beside globals.css. */
const CSS = `
.gk-sub-sm { display: none; }
@media (max-width: 860px) {
  .gk-grid { grid-template-columns: minmax(0, 1fr) auto !important; }
  .gk-col { display: none !important; }
  .gk-head > :not(:first-child):not(:nth-child(2)), .gr-head > :not(:first-child):not(:nth-child(2)) { display: none !important; }
  .gk-sub-sm { display: block; }
  .gk-grid, .gk-pad, .gg-pad { padding-left: 16px !important; padding-right: 16px !important; }
  .gg-pad { margin-left: 0 !important; margin-right: 0 !important; }
}
`;

export type GoogleProps = {
  brand: string;
  domain: string;
  slug: string;
  tier: TierKey;
  mode: UpsellMode;
  hidden: ReadonlySet<PromptCta>;
  today: Day;
  range: Range;
  compareMode: Compare;
  startedOn: Day | null;
  /** loadOverview with no answers: the structure, the keyword positions and the runs. */
  data: OverviewData;
  view: View;
  gaining: boolean;
  cluster: string | null;
  band: Band | null;
  intent: IntentKey | null;
  q: string;
  sort: string | null;
  dir: "asc" | "desc" | null;
  page: number;
  row: string | null;
  canWrite: boolean;
  /** Why a member who cannot write cannot (write.ts readOnlyReason): a viewer's, or an ended client's. */
  readOnly: string;
  clusterLimit: number;
  /** trackingPackLine(trackingPackPrice(market)), from pricing.ts. */
  packLine: string;
  footprint: FootprintData;
  serp: SerpDetail;
  others: Section<Set<string>>;
  /** Live placements by cluster, for the row chip; empty when unread. */
  placed: ReadonlyMap<string, number>;
  pursuing: ReadonlyMap<string, number>;
  aliases: readonly string[];
  notice: { done: KeywordsDone | null; why: KeywordsWhy | null };
};

export default function Google(p: GoogleProps) {
  const { data, range, today } = p;
  const firstCheck = firstCheckDay(p.startedOn, data.questions);
  const firstComplete = firstReadComplete(data.runs, firstCheck);
  const cmp = resolveComparison(range, p.compareMode, p.startedOn, firstCheck, firstComplete);
  const clusters = data.clusters ?? [];
  const clusterOf = new Map(clusters.filter((c) => c.keyword_id).map((c) => [c.keyword_id!, c.id]));
  const clusterLabel = new Map(clusters.map((c) => [c.id, c.name]));
  const urls = p.serp.urls.ok ? p.serp.urls.value : new Map<string, string | null>();
  const readings = readingsByKeyword(data.serp, urls);
  const rows = trackedRows({ keywords: data.keywords, clusterOf, readings, range });
  const kpis = trackedKpis({ rows, keywords: data.keywords, readings, range, compare: cmp.range, runs: data.runs ?? [] });
  const liveClusters = clusters.filter((c) => c.stopped_on === null);
  // The cluster filter offers the clusters whose keyword has a row in this range: a cluster still to start would filter to nothing.
  const withRows = clusters.filter((c) => rows.some((r) => r.clusterId === c.id));
  const others = p.others.ok ? p.others.value : new Set<string>();

  const clientPath = appPath(`/${encodeURIComponent(p.slug)}`);

  // ---- the footprint: gaining ground and the All view (hidden while dark) ----
  const pulls = p.footprint.pulls;
  const latest = pulls?.ok ? pulls.value.latest : null;
  const previous = pulls?.ok ? pulls.value.previous : null;
  const dismissals: Dismissal[] = p.footprint.dismissals?.ok ? p.footprint.dismissals.value : [];
  const liveDismissed = dismissals.filter((d) => liveDismissal(d, today));
  const subject = { brand: p.brand, domain: p.domain, aliases: [...p.aliases] };
  const m: Momentum | null = latest && latest.rows.length ? momentum({ latest, previous, tracked: data.keywords, dismissed: new Set(liveDismissed.map((d) => d.key)), subject, showAll: p.intent === "all", today }) : null;
  // The dark rule (spec 10 section 4): with no pull yet, "First read <date>" only when a footprint job is actually
  // queued; with none queued nothing is promised, and the footprint's sections are hidden as when the switch is off.
  const job = p.footprint.job?.ok ? p.footprint.job.value : null;
  const promised = p.footprint.enabled && pulls?.ok && !latest ? firstReadOn(job, today) : null;
  const footprintShown = p.footprint.enabled && !(pulls?.ok && !latest && !promised);
  // Track as a cluster carries src=gaining - the Momentum origin - only from a keyword gaining ground (spec 10 section 6.6).
  const gainingKeys = new Set((m?.rows ?? []).map((g) => keywordForm(g.keyword)));
  const trackHref = (keyword: string) => `${clientPath}/clusters?${new URLSearchParams({ add: "1", kw: keyword, ...(gainingKeys.has(keywordForm(keyword)) ? { src: "gaining" } : {}) })}`;
  const gainingState: GainingState | null = !footprintShown
    ? null
    : !pulls?.ok
      ? { kind: "error", text: SECTION_ERROR }
      : !latest
        ? { kind: "pending", firstReadOn: promised! }
        : !latest.rows.length
          ? { kind: "none", readOn: latest.pulledOn, domain: p.domain }
          : { kind: "ok", m: m! };
  // "They retry tonight" only while the failed job is still queued to retry.
  const jobFailed = p.footprint.enabled && !!job?.failed && job.queued;

  // ---- URL state ----
  const base: Record<string, string> = { from: range.from, to: range.to, ...(p.compareMode === "prev" ? {} : { compare: p.compareMode }) };
  // While the footprint is hidden, ?view=all is the Tracked view: the view switch shows Tracked only.
  const view: View = footprintShown ? p.view : "tracked";
  const state: Record<string, string> = {
    ...base,
    ...(view === "all" ? { view: "all" } : {}),
    ...(p.gaining ? { gaining: "1" } : {}),
    ...(p.cluster ? { cluster: p.cluster } : {}),
    ...(p.band ? { band: p.band } : {}),
    ...(p.intent ? { intent: p.intent } : {}),
    ...(p.q.trim() ? { q: p.q } : {}),
    ...(p.sort ? { sort: p.sort } : {}),
    ...(p.dir ? { dir: p.dir } : {}),
  };
  const href = (over: Record<string, string | null>, keepPage = false) => {
    const q: Record<string, string> = { ...state, ...(keepPage && p.page > 1 ? { page: String(p.page) } : {}), ...(p.row && !("row" in over) ? { row: p.row } : {}) };
    for (const [k, v] of Object.entries(over)) if (v === null) delete q[k];
    else q[k] = v;
    return `?${new URLSearchParams(q)}`;
  };
  const newest = liveDismissed.length ? [...liveDismissed].sort((a, b) => b.at.localeCompare(a.at))[0]! : null;
  const toast = keywordsToast(p.notice.done, p.notice.why, p.notice.done === "dismissed" ? newest : null);
  const notice = toast ? { text: toast, ok: p.notice.done !== "refused", undo: p.notice.done === "dismissed" && newest ? newest.key : null } : null;

  // ---- the upgrade slot: U2 (just off page 1) or U7 (a gaining keyword, every cluster in use) ----
  const cards = clusterCards({ clusters, questions: data.questions, keywords: data.keywords, answers: data.answers, serp: data.serp, range, before: cmp.range, today, engines: [] });
  const empty = !rows.some((r) => r.to !== null);
  const screen: Facts["state"] = empty ? "empty" : lostReads(data.lastRun) || todayRun(data.runs, today)?.status === "failed" ? "partial" : "ok";
  const atLimit = liveClusters.length >= p.clusterLimit;
  const topGaining = m?.rows[0] ?? null;
  const facts: Facts = {
    tier: p.tier,
    mode: p.mode,
    hidden: new Set(p.hidden),
    startedOn: p.startedOn ?? today,
    today,
    state: screen,
    offPageOne: offPageOneFacts(cards),
    ...(atLimit && topGaining ? { atLimit: true, gaining: { keyword: topGaining.keyword, clusters: p.clusterLimit, packLine: p.packLine } } : {}),
  };
  const cta = pickPrompt(facts);
  const row7 = cta === "pack" ? rowFor("pack", facts) : null;
  const copy = cta === "cited" || row7 === "U7" ? promptCopy(cta!, facts) : null;

  const partial = runNote(data, range, today);
  const sortT: TrackedSort = (["keyword", "position", "change", "volume", "best"] as const).find((s) => s === p.sort) ?? "position";
  const dirT = p.dir ?? (sortT === "keyword" || sortT === "position" || sortT === "best" ? "asc" : "desc");

  return (
    <div className="app-col" style={{ display: "flex", flexDirection: "column", gap: "20px", minWidth: 0 }}>
      <style href="diy-p6-google" precedence="medium">
        {CSS}
      </style>
      <header style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: "24px", flexWrap: "wrap" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "6px", minWidth: 0, flex: "1 1 320px" }}>
          <h1 style={{ margin: 0, fontSize: "28px", fontWeight: 700, letterSpacing: "-0.03em", color: T.ink }}>Google</h1>
          <p style={{ margin: 0, fontSize: "14px", lineHeight: 1.5, color: T.soft, maxWidth: "680px" }}>Where {p.brand} ranks on Google for the keywords you track, which keywords are gaining ground, and who holds page 1.</p>
          {partial ? <p style={{ margin: 0, fontSize: "14px", lineHeight: 1.5, color: T.soft, maxWidth: "680px" }}>{partial}</p> : null}
          {jobFailed ? <p style={{ margin: 0, fontSize: "14px", lineHeight: 1.5, color: T.warnFg, maxWidth: "680px" }}>Some checks didn&apos;t finish last night; they retry tonight.</p> : null}
        </div>
        {view === "tracked" ? (
          <DatePicker range={range} compare={p.compareMode} today={today} startedOn={p.startedOn} firstCheck={firstCheck} firstComplete={firstComplete} grow={false}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={T.ink} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="5" width="18" height="16" rx="2" />
              <path d="M3 10h18M8 3v4M16 3v4" />
            </svg>
            <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.25 }}>
              <span style={{ fontSize: "14px", fontWeight: 700 }}>{rangeLabel(range, today, p.startedOn)}</span>
              <span style={{ fontSize: "12px", color: T.soft }}>
                {formatDay(range.from)} - {formatDay(range.to, true)}
                {cmp.range ? `, ${comparisonLabel(cmp.range, cmp.kind)}` : ""}
              </span>
            </span>
          </DatePicker>
        ) : null}
      </header>

      <nav aria-label="Which keywords" style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
        <Link href={href({ view: null, page: null, sort: null, dir: null, band: null, q: null, intent: p.intent === "all" ? "all" : null })} aria-current={view === "tracked" ? "page" : undefined} style={PILL(view === "tracked")}>
          Tracked keywords
        </Link>
        {!footprintShown ? null : (
          <Link href={href({ view: "all", page: null, sort: null, dir: null, cluster: null, row: null, intent: p.intent === "all" ? null : p.intent })} aria-current={view === "all" ? "page" : undefined} style={PILL(view === "all")}>
            All ranking keywords
          </Link>
        )}
      </nav>

      {view === "tracked" ? (
        <>
          {!rows.length ? (
            <section aria-label="No keywords yet" style={{ ...CARD, padding: "28px", display: "flex", flexDirection: "column", gap: "10px", alignItems: "flex-start" }}>
              <h2 style={H2}>No tracked keywords in this range</h2>
              <p style={{ margin: 0, fontSize: "14px", lineHeight: 1.5, color: T.soft }}>Each cluster tracks one Google keyword, read every day. Add a cluster to start, or pick a longer range at the top of the page.</p>
              <Link href={`${clientPath}/clusters`} style={{ fontSize: "14px", fontWeight: 600, color: T.accent, textDecoration: "none" }}>
                Go to Clusters
              </Link>
            </section>
          ) : (
            <section aria-label="Key figures" className="app-figures" style={{ ...CARD, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", overflow: "hidden" }}>
              {[
                {
                  id: "g-top3",
                  label: "In the top 3",
                  value: `${kpis.top3.n} of ${kpis.top3.of}`,
                  def: `${kpis.top3.n} of ${kpis.top3.of} keywords at their latest reading`,
                  foot: kpis.was ? wasLine(kpis.was.top3.n, kpis.was.keywords, kpis.was.top3Now, kpis.top3, kpis.was.on) : "At each keyword's latest reading in this range.",
                  to: `${href({ band: "top3", page: null, row: null })}#kw-h`,
                  more: "See them",
                },
                {
                  id: "g-p1",
                  label: "On page 1",
                  value: `${kpis.page1.n} of ${kpis.page1.of}`,
                  def: `${kpis.page1.n} of ${kpis.page1.of} keywords at their latest reading`,
                  foot: kpis.was ? wasLine(kpis.was.page1.n, kpis.was.keywords, kpis.was.page1Now, kpis.page1, kpis.was.on) : "At each keyword's latest reading in this range.",
                  to: `${href({ band: "p1", page: null, row: null })}#kw-h`,
                  more: "See them",
                },
                {
                  id: "g-moved",
                  label: "Up and down",
                  value: `${kpis.improved} up · ${kpis.slipped} down`,
                  def: "From each keyword's first reading in this range to its latest",
                  foot: `${kpis.entered} entered the top 20 and ${kpis.left} left it: a move, not a measurable one.`,
                  to: `${href({ sort: "change", dir: "desc", band: null, page: null, row: null })}#kw-h`,
                  more: "Sort by change",
                },
                {
                  id: "g-window",
                  label: "Readings in this range",
                  value: n(kpis.readings),
                  def: `${kpis.readings} days with a Google reading in this range`,
                  foot: [
                    kpis.partial ? `${kpis.partial} partial or failed ${kpis.partial === 1 ? "check" : "checks"}: a keyword not read that day shows as not measured.` : "No partial or failed check in this range.",
                    kpis.late ? `${kpis.late} ${kpis.late === 1 ? "keyword was" : "keywords were"} added in this range, each compared from its own first reading.` : null,
                  ]
                    .filter(Boolean)
                    .join(" "),
                  to: null,
                  more: "",
                },
              ].map((f, i) => (
                <div key={f.id} data-figure={f.id} style={{ display: "flex", flexDirection: "column", gap: "8px", padding: "20px 22px", minWidth: 0, borderLeft: i ? `1px solid ${T.line}` : undefined, marginLeft: i ? "-1px" : undefined }}>
                  <span style={{ fontSize: "13px", fontWeight: 600, color: T.soft }}>{f.label}</span>
                  <span style={{ color: T.ink, fontVariantNumeric: "tabular-nums" }}>
                    <Fig def={f.def} style={{ fontSize: f.id === "g-moved" ? "22px" : "28px", fontWeight: 700, letterSpacing: "-0.03em", whiteSpace: "nowrap" }}>
                      {f.value}
                    </Fig>
                  </span>
                  <span style={{ fontSize: "13px", lineHeight: 1.45, color: T.soft }}>{f.foot}</span>
                  {f.to ? (
                    <Link href={f.to} scroll={false} style={{ fontSize: "13px", fontWeight: 600, color: T.accent, textDecoration: "none", width: "fit-content" }}>
                      {f.more}
                      <span className="sr-only">{`: ${f.label}`}</span>
                    </Link>
                  ) : null}
                </div>
              ))}
              <p style={{ gridColumn: "1 / -1", margin: 0, padding: "12px 22px 14px", borderTop: `1px solid ${T.line}`, fontSize: "13px", lineHeight: 1.5, color: T.soft }}>
                Positions are our own daily reads of Google&apos;s top 20 for each keyword you track. A keyword outside the top 20 is a reading, not a gap; a day it was not read is not counted.
              </p>
            </section>
          )}

          <BandsCard readings={readings} rows={rows} range={range} />

          {gainingState ? (
            <GainingGround
              state={gainingState}
              slug={p.slug}
              open={p.gaining}
              showAll={p.intent === "all"}
              canWrite={p.canWrite}
              reason={p.readOnly}
              dismissed={liveDismissed}
              keep={state}
              toggle={`${href({ gaining: p.gaining ? null : "1" })}#gaining`}
              intentHref={(all) => `${href({ intent: all ? "all" : null, gaining: "1" })}#gaining`}
              trackHref={trackHref}
              notice={notice}
            />
          ) : null}

          {rows.length ? (
            <section aria-labelledby="kw-h" style={{ ...CARD, overflow: "hidden" }}>
              <div className="gk-pad" style={{ display: "flex", flexDirection: "column", gap: "10px", padding: "20px 24px 14px" }}>
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "8px 16px", flexWrap: "wrap" }}>
                  <h2 id="kw-h" style={{ ...H2, scrollMarginTop: "24px" }}>
                    {(() => {
                      const shown = filterTracked(rows, { band: p.band, cluster: p.cluster, q: p.q }).length;
                      return `${shown} tracked ${shown === 1 ? "keyword" : "keywords"}${p.band ? `: ${BAND_LABEL[p.band].toLowerCase()}` : ""}`;
                    })()}
                  </h2>
                  {p.band || p.cluster || p.q.trim() ? <ClearFilters href={`?${new URLSearchParams(base)}#kw-h`} /> : null}
                </div>
                <p style={{ margin: 0, fontSize: "13px", lineHeight: 1.5, color: T.soft }}>Position at the latest reading in this range, against the first. A keyword opens who holds Google&apos;s page 1 for it.</p>
                <nav aria-label="Filter by position" style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                  <Link href={`${href({ band: null, page: null })}#kw-h`} scroll={false} aria-current={!p.band ? "true" : undefined} style={PILL(!p.band)}>
                    Every position
                  </Link>
                  {BANDS.map((b) => (
                    <Link key={b} href={`${href({ band: b, page: null })}#kw-h`} scroll={false} aria-current={p.band === b ? "true" : undefined} style={PILL(p.band === b)}>
                      {BAND_LABEL[b]}
                    </Link>
                  ))}
                </nav>
                {withRows.length > 1 ? (
                  <nav aria-label="Filter by cluster" className="app-nm-filters" style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                    <Link href={`${href({ cluster: null })}#kw-h`} scroll={false} aria-current={!p.cluster ? "true" : undefined} style={PILL(!p.cluster)}>
                      All clusters
                    </Link>
                    {withRows
                      .map((c) => (
                        <Link key={c.id} href={`${href({ cluster: c.id })}#kw-h`} scroll={false} aria-current={p.cluster === c.id ? "true" : undefined} style={PILL(p.cluster === c.id)}>
                          {c.name}
                        </Link>
                      ))}
                  </nav>
                ) : null}
                <SearchBox state={state} q={p.q} clear={`${href({ q: null })}#kw-h`} label="Search tracked keywords" />
              </div>
              <TrackedTable
                rows={sortTracked(filterTracked(rows, { band: p.band, cluster: p.cluster, q: p.q }), sortT, dirT)}
                clusterLabel={clusterLabel}
                link={(s) => {
                  const on = sortT === s;
                  const dir = on ? (dirT === "asc" ? "desc" : "asc") : s === "keyword" || s === "position" || s === "best" ? "asc" : "desc";
                  return { href: `${href({ sort: s === "position" ? null : s, dir: s === "position" && dir === "asc" ? null : dir })}#kw-h`, dir: on ? dirT : null };
                }}
                rowHref={(id) => `${href({ row: p.row === id ? null : id })}#kw-h`}
                open={p.row}
                top={p.row ? (p.serp.tops.ok ? (() => { const t = p.serp.tops.value.get(p.row!); return t ? { day: t.day, hits: pageOne(t.top, others) } : "none"; })() : "error") : null}
                placed={p.placed}
                pursuing={p.pursuing}
                placementsHref={`${clientPath}/placements`}
                pursuingHref={(c) => `${clientPath}/opportunities?${new URLSearchParams({ view: "pursuing", cluster: c })}`}
                own={p.domain}
              />
              {!p.serp.urls.ok ? <p className="gk-pad" style={{ margin: 0, padding: "12px 24px", fontSize: "13px", color: T.soft }}>{`Ranking pages: ${SECTION_ERROR}`}</p> : null}
              {copy && cta === "cited" ? <UpgradePrompt copy={copy} cta="cited" slug={p.slug} items={facts.offPageOne?.ids ?? []} keep={state} surface="google" /> : null}
              {copy && row7 === "U7" ? <PackPrompt copy={copy} slug={p.slug} tier={p.tier} agency={p.mode === "agency"} keep={state} surface="google" /> : null}
            </section>
          ) : null}

          {rows.length ? <LosingCard p={p} clusterOf={clusterOf} urls={urls} clientPath={clientPath} /> : null}
          {rows.length ? <CompetitorsCard tops={p.serp.tops} rows={rows} others={others} domain={p.domain} /> : null}
        </>
      ) : (
        <AllView p={p} latest={latest} previous={previous} pullsOk={!!pulls?.ok} firstReadOn={promised} href={href} state={state} trackHref={trackHref} gaining={gainingKeys} />
      )}
    </div>
  );
}

/** "was 3 of 8 on 1 Sep": like for like, and when the like-for-like set is not every keyword now, what it is now on that set. */
function wasLine(before: number, keywords: number, nowOnSet: number, now: { n: number; of: number }, on: Day): string {
  const same = keywords === now.of && nowOnSet === now.n;
  return same ? `was ${before} of ${keywords} on ${formatDay(on)}` : `On the ${keywords} keywords tracked all of both periods: ${nowOnSet}, was ${before} on ${formatDay(on)}.`;
}

function SearchBox({ state, q, clear, label }: { state: Record<string, string>; q: string; clear: string; label: string }) {
  return (
    <form method="get" role="search" className="app-search" style={{ display: "flex", alignItems: "center", gap: "8px", width: "300px", maxWidth: "100%", height: "44px", boxSizing: "border-box", padding: "0 12px", border: `1px solid ${T.line}`, borderRadius: "12px", background: T.surface }}>
      {Object.entries(state)
        .filter(([k]) => k !== "q" && k !== "page")
        .map(([k, v]) => (
          <input key={k} id={`g-${k}`} type="hidden" name={k} value={v} />
        ))}
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={T.soft} strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
        <circle cx="11" cy="11" r="7" />
        <path d="M20 20l-4-4" />
      </svg>
      <label htmlFor="g-search" className="sr-only">
        {label}
      </label>
      <input id="g-search" type="search" name="q" defaultValue={q} maxLength={APP_LIMITS.search} placeholder="Search keywords" enterKeyHint="search" autoCapitalize="none" autoCorrect="off" spellCheck={false} style={{ flexGrow: 1, minWidth: 0, border: 0, outline: 0, fontFamily: "inherit", fontSize: "16px", color: T.ink, background: "transparent" }} />
      {q.trim() ? <ClearSearch href={clear} /> : null}
    </form>
  );
}

function BandsCard({ readings, rows, range }: { readings: ReturnType<typeof readingsByKeyword>; rows: ReturnType<typeof trackedRows>; range: Range }) {
  const ids = new Set(rows.filter((r) => r.to !== null).map((r) => r.id));
  const series = positionBands({ readings, ids, range });
  if (series.length < 2) return null;
  const last = series[series.length - 1]!;
  return (
    <section aria-labelledby="g-bands-h" style={{ ...CARD, padding: "22px 24px", display: "flex", flexDirection: "column", gap: "12px" }} className="gk-pad">
      <h2 id="g-bands-h" style={H2}>
        Position bands over time
      </h2>
      <PositionBands
        series={series.map((s) => ({ d: s.d, b3: s.b3, b10: s.b10, b20: s.b20 }))}
        caption={`A point a week: each keyword's median position that week, a reading outside the top 20 counted below it. The last point is each keyword's latest reading, as the figures above.${last.out ? ` ${last.out} not in the top 20 at the last point.` : ""}`}
      />
    </section>
  );
}

function LosingCard({ p, clusterOf, urls, clientPath }: { p: GoogleProps; clusterOf: ReadonlyMap<string, string>; urls: ReadonlyMap<string, string | null>; clientPath: string }) {
  const serp = p.data.serp.map((s) => ({ ...s, url: urls.get(urlAt(s.keyword_id, s.run_date)) ?? null }));
  const losing = losingGround({ keywords: p.data.keywords, clusterOf, serp, to: p.range.to });
  return (
    <section aria-labelledby="g-losing-h" style={{ ...CARD, padding: "22px 24px", display: "flex", flexDirection: "column", gap: "10px" }} className="gk-pad">
      <h2 id="g-losing-h" style={H2}>
        Losing ground
      </h2>
      {losing.length ? (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "8px" }}>
          {losing.map((l) => (
            <li key={l.keywordId} data-losing={l.keywordId} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px 16px", flexWrap: "wrap", fontSize: "14px", lineHeight: 1.5, color: T.ink }}>
              <span style={{ minWidth: 0, flex: "1 1 280px" }}>{`'${l.keyword}' was ${ordinal(l.was.position)} on ${formatDate(l.was.day)}; outside the top 20 on ${l.out} of its last 3 readings.`}</span>
              {l.pageKey ? (
                <Link href={`${clientPath}/pages?${new URLSearchParams({ url: l.pageKey })}`} style={{ display: "inline-flex", alignItems: "center", minHeight: "44px", fontSize: "13px", fontWeight: 600, color: T.accent, textDecoration: "none" }}>
                  Check its page in Your pages
                </Link>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p style={{ margin: 0, fontSize: "14px", lineHeight: 1.5, color: T.soft }}>No tracked keyword has fallen out of the top 20 from 16th or better over its last readings.</p>
      )}
      <p style={{ margin: 0, fontSize: "12px", lineHeight: 1.5, color: T.soft }}>Listed when a keyword that held 16th or better is outside the top 20 on 2 of its last 3 readings, the latest among them.</p>
    </section>
  );
}

function CompetitorsCard({ tops, rows, others, domain }: { tops: SerpDetail["tops"]; rows: ReturnType<typeof trackedRows>; others: ReadonlySet<string>; domain: string }) {
  const live = new Set(rows.filter((r) => r.to !== null).map((r) => r.id));
  const comp = tops.ok ? serpCompetitors([...tops.value].filter(([k]) => live.has(k)).map(([keywordId, t]) => ({ keywordId, day: t.day, top: t.top })), domain, others) : null;
  return (
    <section aria-labelledby="g-comp-h" style={{ ...CARD, padding: "22px 24px", display: "flex", flexDirection: "column", gap: "10px" }} className="gk-pad">
      <h2 id="g-comp-h" style={H2}>
        On Google for your keywords
      </h2>
      {!comp ? (
        <p style={{ margin: 0, fontSize: "14px", color: T.soft }}>{SECTION_ERROR}</p>
      ) : !comp.read ? (
        <p style={{ margin: 0, fontSize: "14px", lineHeight: 1.5, color: T.soft }}>Google&apos;s top 10 is kept from each daily reading since 13 Oct 2026. The sites holding page 1 for your keywords show here once a reading has stored it.</p>
      ) : (
        <>
          <p style={{ margin: 0, fontSize: "13px", lineHeight: 1.5, color: T.soft }}>{`Sites by how many of your ${comp.read} keywords they hold a page-1 place for, with their average position there. Derived from Google's top 10 for your keywords ${comp.mixed ? "at each keyword's latest reading, to" : "on"} ${formatDate(comp.latest!)}.`}</p>
          <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column" }}>
            {comp.rows.map((c) => (
              <li key={c.domain} data-site={c.domain} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: "4px 16px", alignItems: "baseline", padding: "8px 0", borderTop: `1px solid ${T.hair}`, fontSize: "14px" }}>
                <span style={{ fontWeight: 600, color: T.ink, overflowWrap: "anywhere" }}>{c.domain}</span>
                <span style={{ color: T.ink, fontVariantNumeric: "tabular-nums", textAlign: "right" }}>
                  {`${c.keywords} of ${comp.read}`}
                  <span style={{ color: T.soft }}>{` · average ${c.avg.toLocaleString("en-GB", { maximumFractionDigits: 1 })}`}</span>
                </span>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}

function AllView({
  p,
  latest,
  previous,
  pullsOk,
  firstReadOn,
  href,
  state,
  trackHref,
  gaining,
}: {
  p: GoogleProps;
  latest: Pull | null;
  previous: Pull | null;
  pullsOk: boolean;
  firstReadOn: Day | null;
  href: (over: Record<string, string | null>, keepPage?: boolean) => string;
  state: Record<string, string>;
  trackHref: (keyword: string) => string;
  gaining: ReadonlySet<string>;
}) {
  if (!pullsOk) return <p style={{ ...CARD, margin: 0, padding: "22px 24px", fontSize: "14px", color: T.soft }}>{SECTION_ERROR}</p>;
  if (!latest)
    // Reached only with a footprint job queued (the page hides the All view otherwise): the date is that job's.
    return (
      <section aria-label="Every keyword you rank for" style={{ ...CARD, padding: "22px 24px" }}>
        <p style={{ margin: 0, fontSize: "14px", lineHeight: 1.5, color: T.ink }}>{firstReadOn ? `Your Google footprint is read weekly. First read ${formatDate(firstReadOn)}.` : SECTION_ERROR}</p>
      </section>
    );
  if (!latest.rows.length)
    return (
      <section aria-label="Every keyword you rank for" style={{ ...CARD, padding: "22px 24px" }}>
        <p style={{ margin: 0, fontSize: "14px", lineHeight: 1.5, color: T.ink }}>{`DataForSEO's index has no Google rankings for ${p.domain} yet (read ${formatDate(latest.pulledOn)}).`}</p>
      </section>
    );
  const tracked = new Set(p.data.keywords.filter((k) => k.stopped_on === null).map((k) => keywordForm(k.keyword)));
  const all = rankingRows(latest, previous, tracked);
  const intent = p.intent && p.intent !== "all" ? p.intent : null;
  const filtered = filterRanking(all, { q: p.q, intent, band: p.band });
  const sort: RankingSort = (["keyword", "position", "change", "volume", "etv"] as const).find((s) => s === p.sort) ?? "etv";
  const dir = p.dir ?? (sort === "keyword" || sort === "position" ? "asc" : "desc");
  const shown = pageOf(sortRanking(filtered, sort, dir), p.page);
  const k = rankingKpis(latest);
  const read = vendorLabel(latest.pulledOn);
  const basis = previous ? "ours" : "dataforseo";
  const cut = k.total > k.read;
  const filteredBy = !!(p.q.trim() || intent || p.band);
  const cells = [
    { id: "a-total", label: "Ranking keywords", value: n(k.total), foot: cut ? `The top ${n(k.read)} read, by estimated traffic. ${read}` : read },
    { id: "a-p1", label: "On page 1", value: `${n(k.page1)} of ${n(k.read)}`, foot: read },
    { id: "a-comm", label: "Buying intent", value: k.commercial.of ? `${Math.round((100 * k.commercial.n) / k.commercial.of)}%` : "-", foot: `${n(k.commercial.n)} of ${n(k.commercial.of)} with an intent are commercial or transactional. ${read}` },
    { id: "a-etv", label: "Estimated monthly traffic", value: k.etv === null ? "-" : n(Math.round(k.etv)), foot: read },
  ];
  return (
    <>
      <section aria-label="Key figures, DataForSEO estimates" className="app-figures" style={{ ...CARD, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", overflow: "hidden" }}>
        {cells.map((f, i) => (
          <div key={f.id} data-figure={f.id} style={{ display: "flex", flexDirection: "column", gap: "8px", padding: "20px 22px", minWidth: 0, borderLeft: i ? `1px solid ${T.line}` : undefined, marginLeft: i ? "-1px" : undefined }}>
            <span style={{ fontSize: "13px", fontWeight: 600, color: T.soft }}>{f.label}</span>
            <span style={{ fontSize: "28px", fontWeight: 700, letterSpacing: "-0.03em", color: T.ink, fontVariantNumeric: "tabular-nums" }}>{f.value}</span>
            <span style={{ fontSize: "13px", lineHeight: 1.45, color: T.soft }}>{f.foot}</span>
          </div>
        ))}
        <p style={{ gridColumn: "1 / -1", margin: 0, padding: "12px 22px 14px", borderTop: `1px solid ${T.line}`, fontSize: "13px", lineHeight: 1.5, color: T.soft }}>
          {cut
            ? `The top ${n(k.read)} of the ${n(k.total)} keywords DataForSEO's index has your site ranking for in Google's top 100, by estimated traffic, read weekly at most. Positions are among Google's organic results. These are estimates, not our daily reads, and are never counted in the Tracked figures.`
            : "Every keyword DataForSEO's index has your site ranking for in Google's top 100, read weekly at most. Positions are among Google's organic results. These are estimates, not our daily reads, and are never counted in the Tracked figures."}
        </p>
      </section>
      <section aria-labelledby="all-h" style={{ ...CARD, overflow: "hidden" }}>
        <div className="gk-pad" style={{ display: "flex", flexDirection: "column", gap: "10px", padding: "20px 24px 14px" }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "8px 16px", flexWrap: "wrap" }}>
            <h2 id="all-h" style={{ ...H2, scrollMarginTop: "24px" }}>{allHeading(filtered.length, k.read, k.total, filteredBy)}</h2>
            {p.q.trim() || intent || p.band ? <ClearFilters href={`?${new URLSearchParams({ view: "all" })}#all-h`} /> : null}
          </div>
          <nav aria-label="Filter by intent" className="app-nm-filters" style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            <Link href={`${href({ intent: null, page: null })}#all-h`} scroll={false} aria-current={!intent ? "true" : undefined} style={PILL(!intent)}>
              Every intent
            </Link>
            {INTENTS.map((i) => (
              <Link key={i} href={`${href({ intent: i, page: null })}#all-h`} scroll={false} aria-current={intent === i ? "true" : undefined} style={PILL(intent === i)}>
                {cap(i)}
              </Link>
            ))}
          </nav>
          <nav aria-label="Filter by position" className="app-nm-filters" style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            <Link href={`${href({ band: null, page: null })}#all-h`} scroll={false} aria-current={!p.band ? "true" : undefined} style={PILL(!p.band)}>
              Every position
            </Link>
            {BANDS.map((b) => (
              <Link key={b} href={`${href({ band: b, page: null })}#all-h`} scroll={false} aria-current={p.band === b ? "true" : undefined} style={PILL(p.band === b)}>
                {b === "out" ? "21st or lower" : BAND_LABEL[b]}
              </Link>
            ))}
          </nav>
          <SearchBox state={state} q={p.q} clear={`${href({ q: null, page: null })}#all-h`} label="Search ranking keywords" />
        </div>
        {shown.rows.length ? (
          <RankingTable
            rows={shown.rows}
            basis={basis}
            gaining={gaining}
            canWrite={p.canWrite}
            trackHref={trackHref}
            link={(s) => {
              const on = sort === s;
              const d = on ? (dir === "asc" ? "desc" : "asc") : s === "keyword" || s === "position" ? "asc" : "desc";
              return { href: `${href({ sort: s === "etv" ? null : s, dir: s === "etv" && d === "desc" ? null : d, page: null })}#all-h`, dir: on ? dir : null };
            }}
          />
        ) : (
          <p className="gk-pad" style={{ margin: 0, padding: "4px 24px 22px", fontSize: "14px", color: T.soft }}>No ranking keyword matches these filters.</p>
        )}
        {shown.pages > 1 ? (
          <nav aria-label="Pages of keywords" className="gk-pad" style={{ display: "flex", alignItems: "center", gap: "16px", padding: "14px 24px", fontSize: "14px" }}>
            {shown.page > 1 ? (
              <Link href={`${href({ page: shown.page === 2 ? null : String(shown.page - 1) })}#all-h`} style={{ display: "inline-flex", alignItems: "center", minHeight: "44px", color: T.accent, fontWeight: 600, textDecoration: "none" }}>
                Previous
              </Link>
            ) : null}
            <span style={{ color: T.soft }}>{`Page ${shown.page} of ${shown.pages}`}</span>
            {shown.page < shown.pages ? (
              <Link href={`${href({ page: String(shown.page + 1) })}#all-h`} style={{ display: "inline-flex", alignItems: "center", minHeight: "44px", color: T.accent, fontWeight: 600, textDecoration: "none" }}>
                Next
              </Link>
            ) : null}
          </nav>
        ) : null}
        <p className="gk-pad" style={{ margin: 0, padding: "12px 24px 18px", borderTop: `1px solid ${T.line}`, fontSize: "12px", lineHeight: 1.5, color: T.soft }}>
          {previous
            ? `Change is against our previous pull, read ${formatDate(previous.pulledOn)}${completePull(previous) ? "" : `, which held the top ${n(previous.rows.length)} by estimated traffic: a keyword below that has no change shown`}. `
            : "* With one pull so far, change is against DataForSEO's own previous reading of each keyword, in places on the results page. "}
          {`DataForSEO estimate, read ${formatDate(latest.pulledOn)}.`}
        </p>
      </section>
    </>
  );
}

/** "300 of 1,342 ranking keywords, by estimated traffic"; with a filter, "42 ranking keywords match, of the top 300 by estimated traffic". */
export function allHeading(shown: number, read: number, total: number, filtered: boolean): string {
  const kw = (x: number) => `${n(x)} ranking ${x === 1 ? "keyword" : "keywords"}`;
  const cut = total > read;
  if (!filtered) return cut ? `${n(read)} of ${kw(total)}, by estimated traffic` : kw(read);
  return `${kw(shown)} ${shown === 1 ? "matches" : "match"}${cut ? `, of the top ${n(read)} by estimated traffic` : ""}`;
}
