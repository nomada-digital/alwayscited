"use client";

import Link from "@/components/app/AppLink";
import { useRef, useState, type KeyboardEvent } from "react";

import { T } from "@/config/tokens";
import type { PlacementKind } from "@/lib/tracking/placements";

import ChartMarks, { MarkLegend, MarkList } from "./ChartMarks";
import { type ChartMark, placeMarks } from "./chart-board";
import { KIND_DOT } from "./PlacementsChart";

/**
 * The cluster chart (T4b part 5b, 30 Sep 2026; BRIEF-3 T4b step 4 against
 * boards-3/Main.dc.html): two panels on one time axis - the share of the
 * cluster's answers naming the client, 0-100%, above its keyword's Google
 * position, #1 to #30+ inverted with a Page 1 line at 10.5. The previous
 * period is dashed behind both, under a toggle. A day with no reading is a
 * gap in the line, never a zero. Hand-built SVG at the board's geometry; the
 * series come from clusterChart() in cluster-figures.ts, so the top panel
 * counts the same answers as the card and the heat row.
 *
 * On mentioned and above, "Show placements" (R97 part 5, BRIEF-2 T13) draws
 * a line down both panels for each live placement, with its type dot between
 * them - off by default, so the JS-off render has none.
 *
 * The server render is the settled default (previous period on, no hover),
 * so the page reads the same with JS off. Each day is a button, so the
 * readout is reachable by keyboard as well as by hover: one Tab stop (the
 * last day), then the arrow keys, Home and End.
 */

export type ClusterPoint = { pct: number | null; num: number; den: number } | null;
export type ClusterChartData = {
  keyword: string;
  /** The card's heading; the keyword by default. The one-cluster page, whose H1 is the keyword, uses the board's "AI answers and Google, day by day". */
  title?: string;
  /** Where the ranking page lives, as the board's "where {url} ranks". */
  site: string;
  brand: string;
  days: string[];
  /** Hover labels, one per day. */
  dayLabels: string[];
  named: ClusterPoint[];
  google: (number | null)[];
  prevLabels: string[] | null;
  namedBefore: ClusterPoint[] | null;
  googleBefore: (number | null)[] | null;
  beforeLabel: string | null;
  answersPerDay: number;
  pending: boolean;
  /** Tomorrow's check time in the client's zone, "06:00 UK time" or "1:00am ET" (check-time.ts), for the pending overlay. */
  firstCheckAt: string;
  /** "Tracked from 22 Sep. No earlier period to compare yet." when a live cluster has no previous period. */
  note: string | null;
  /** The phone card's one line (R124, boards-3/Mobile.dc.html): "42% named, #4 on Google. Dashed: 5 Aug - 1 Sep". */
  phoneLine: string;
  /** R97 part 5: live placements on this cluster by day index; null on tiers without placements (no switch). */
  placements?: { id: string; i: number; kind: PlacementKind; label: string }[] | null;
  /** The one-cluster page: "Open cluster" in the desktop header, "Open this cluster" under the phone card. */
  openHref: string | null;
  /** 13 Oct 2026, DIY P4: the ISO day of each point, so work markers can be placed by date. */
  isoDays?: string[];
  /**
   * Work markers (spec 10 section 4.1 row 8): Actions items started (T.warnFg)
   * and done (T.goodFg), placements live (T.accent), drawn under the plot and
   * always on - unlike "Show placements", whose lines run through both panels.
   * None draws none.
   */
  marks?: ChartMark[];
};

const W = 1056;
/** The board's height with no markers; a strip of WORK_STRIP under the date labels holds them when there are some. */
const H_PLAIN = 428;
const WORK_STRIP = 30;
const X0 = 44;
const X1 = 1040;
const A_TOP = 26;
const A_BOT = 186;
const B_TOP = 236;
const B_BOT = 396;

const ya = (v: number) => A_BOT - (Math.min(v, 100) * (A_BOT - A_TOP)) / 100;
const yb = (p: number) => B_TOP + ((Math.min(p, 30) - 1) * (B_BOT - B_TOP)) / 29;

/** Runs of consecutive readings; a null day ends a run, so it draws as a gap. */
function runs(vals: (number | null)[], xAt: (i: number) => number, y: (v: number) => number): [number, number][][] {
  const out: [number, number][][] = [];
  let run: [number, number][] = [];
  vals.forEach((v, i) => {
    if (v === null) {
      if (run.length) out.push(run);
      run = [];
      return;
    }
    run.push([xAt(i), y(v)]);
  });
  if (run.length) out.push(run);
  return out;
}

const line = (rs: [number, number][][]) => rs.map((r) => "M" + r.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" L")).join(" ");
const area = (rs: [number, number][][]) =>
  rs.map((r) => `M${r[0]![0].toFixed(1)},${A_BOT} ` + r.map(([x, y]) => `L${x.toFixed(1)},${y.toFixed(1)}`).join(" ") + ` L${r[r.length - 1]![0].toFixed(1)},${A_BOT} Z`).join(" ");

export default function ClusterChart({ data }: { data: ClusterChartData }) {
  const work = data.isoDays && data.marks ? placeMarks(data.isoDays, data.marks) : [];
  const H = work.length ? H_PLAIN + WORK_STRIP : H_PLAIN;
  const [prev, setPrev] = useState(true);
  const [hover, setHover] = useState<number | null>(null);
  const [placed, setPlaced] = useState(false);
  const marks = data.placements ?? [];
  const showPlaced = placed && marks.length > 0;

  const n = data.days.length;
  // One Tab stop for the days, not one per day (R173 pass 3, DS33): the arrow keys, Home and End move between them.
  const [picked, setCursor] = useState(n - 1);
  const cursor = Math.min(picked, n - 1);
  const dayRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const onDayKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const to = { ArrowLeft: cursor - 1, ArrowDown: cursor - 1, ArrowRight: cursor + 1, ArrowUp: cursor + 1, Home: 0, End: n - 1 }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    dayRefs.current[Math.max(0, Math.min(n - 1, to))]?.focus();
  };
  const step = n > 1 ? (X1 - X0) / (n - 1) : 0;
  const xAt = (i: number) => X0 + i * step;
  const hasPrev = !!data.namedBefore && data.namedBefore.some((p) => p !== null);
  const showPrev = prev && hasPrev;
  const named = data.named.map((p) => (p ? p.pct : null));
  const namedBefore = (data.namedBefore ?? []).slice(0, n).map((p) => (p ? p.pct : null));
  const googleBefore = (data.googleBefore ?? []).slice(0, n);
  const aiRuns = runs(named, xAt, ya);
  // A label a week, as the board's 2, 9, 16, 23 Sep and Today; the last day always, the one before it dropped if too close.
  const ticks = [...Array.from({ length: Math.ceil(n / 7) }, (_, k) => k * 7).filter((i) => i < n - 3), n - 1];

  const pct = (p: ClusterPoint) => (p && p.pct !== null ? `${p.pct}%` : "-");
  const readNamed = (p: ClusterPoint) => (p && p.pct !== null ? `${p.pct}% (${p.num} of ${p.den})` : "Not tracked yet");
  const readG = (g: number | null) => (g === null ? "-" : `#${g}`);
  const firstNamed = data.named.find((p) => p && p.pct !== null);
  const lastNamed = [...data.named].reverse().find((p) => p && p.pct !== null);
  const summary = data.pending || !firstNamed
    ? `No readings yet for ${data.keyword}`
    : `Daily share of answers naming ${data.brand} for ${data.keyword}, above its Google position, ${data.dayLabels[0]} to ${data.dayLabels[n - 1]}: from ${pct(firstNamed)} to ${pct(lastNamed!)}`;

  return (
    <section id="cluster-chart" aria-labelledby="ch-h" className="app-chart-card" style={{ background: T.surface, border: `1px solid ${T.line}`, borderRadius: "18px", padding: "24px 27px 20px", display: "flex", flexDirection: "column", gap: "16px", minWidth: 0 }}>
      <div className="app-chart-head" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "24px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "4px", flex: "1 1 0", minWidth: 0 }}>
          <h2 id="ch-h" className="app-chart-h" style={{ margin: 0, fontSize: "19px", fontWeight: 700, letterSpacing: "-0.022em", color: T.ink }}>
            {data.title ?? data.keyword}
          </h2>
          <p className="app-show-sm" style={{ margin: 0, fontSize: "12px", color: T.soft }}>
            {data.phoneLine}
          </p>
          <p className="app-hide-sm" style={{ margin: 0, fontSize: "14px", color: T.soft }}>
            {`Top: the share of this cluster's ${data.answersPerDay} answers a day that named ${data.brand}. Below: where ${data.site} ranks for the keyword. One date range for both.`}
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "16px", flexShrink: 0 }}>
        <button
          type="button"
          aria-pressed={showPrev}
          data-usage="compare_change"
          onClick={() => setPrev((v) => !v)}
          disabled={!hasPrev}
          style={{ display: "inline-flex", alignItems: "center", gap: "10px", height: "36px", padding: "0 4px", border: 0, background: "transparent", color: T.ink, fontSize: "13px", fontWeight: 600, cursor: hasPrev ? "pointer" : "default", opacity: hasPrev ? 1 : 0.5, flexShrink: 0 }}
        >
          <span style={{ position: "relative", width: "34px", height: "20px", borderRadius: "999px", background: showPrev ? T.accent : T.line, transition: "background .15s" }}>
            <span style={{ position: "absolute", top: "2px", left: showPrev ? "16px" : "2px", width: "16px", height: "16px", borderRadius: "50%", background: T.surface, boxShadow: `0 1px 2px color-mix(in srgb, ${T.ink} 25%, transparent)`, transition: "left .15s" }} />
          </span>
          Previous period
        </button>
        {data.placements ? (
          <button
            type="button"
            className="app-hide-sm"
            aria-pressed={showPlaced}
            onClick={() => setPlaced((v) => !v)}
            disabled={!marks.length}
            style={{ display: "inline-flex", alignItems: "center", gap: "10px", height: "36px", padding: "0 4px", border: 0, background: "transparent", color: T.ink, fontSize: "13px", fontWeight: 600, cursor: marks.length ? "pointer" : "default", opacity: marks.length ? 1 : 0.5, flexShrink: 0 }}
          >
            <span style={{ position: "relative", width: "34px", height: "20px", borderRadius: "999px", background: showPlaced ? T.accent : T.line, transition: "background .15s" }}>
              <span style={{ position: "absolute", top: "2px", left: showPlaced ? "16px" : "2px", width: "16px", height: "16px", borderRadius: "50%", background: T.surface, boxShadow: `0 1px 2px color-mix(in srgb, ${T.ink} 25%, transparent)`, transition: "left .15s" }} />
            </span>
            Show placements
          </button>
        ) : null}
        {data.openHref ? (
          <Link href={data.openHref} className="app-hide-sm" data-usage="detail_open" style={{ display: "inline-flex", alignItems: "center", gap: "6px", height: "36px", padding: "0 12px", border: `1px solid ${T.line}`, borderRadius: "10px", color: T.ink, fontSize: "13px", fontWeight: 600, textDecoration: "none" }}>
            Open cluster
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={T.ink} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M9 6l6 6-6 6" />
            </svg>
          </Link>
        ) : null}
        </div>
      </div>

      <Compact data={data} showPrev={showPrev} />

      <div className="app-hide-sm" style={{ position: "relative", width: "100%", maxWidth: `${W}px` }} onMouseLeave={() => setHover(null)}>
        <svg width="100%" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={summary} style={{ display: "block", overflow: "visible" }}>
          {[0, 50, 100].map((v) => (
            <g key={`a${v}`}>
              <line x1={X0} x2={X1} y1={ya(v)} y2={ya(v)} stroke={v === 0 ? T.line : T.hair} />
              <text x={X0 - 8} y={ya(v) + 4} textAnchor="end" fontSize={12} fill={T.soft}>
                {v}%
              </text>
            </g>
          ))}
          {[1, 10, 20, 30].map((p) => (
            <g key={`b${p}`}>
              <line x1={X0} x2={X1} y1={yb(p)} y2={yb(p)} stroke={T.hair} />
              <text x={X0 - 8} y={yb(p) + 4} textAnchor="end" fontSize={12} fill={T.soft}>
                {`#${p}${p === 30 ? "+" : ""}`}
              </text>
            </g>
          ))}
          <line x1={X0} x2={X1} y1={yb(10.5)} y2={yb(10.5)} stroke={T.soft} strokeDasharray="3 4" opacity={0.5} />
          <text x={X1} y={yb(10.5) - 6} textAnchor="end" fontSize={11} fill={T.soft}>
            Page 1
          </text>
          {ticks.map((i) => (
            <text key={`d${i}`} x={xAt(i)} y={H_PLAIN - 6} textAnchor="middle" fontSize={12} fill={T.soft}>
              {data.days[i]}
            </text>
          ))}
          <text x={X0} y={12} fontSize={12} fontWeight={700} fill={T.ink}>
            AI answers naming you
          </text>
          <text x={X0} y={B_TOP - 14} fontSize={12} fontWeight={700} fill={T.ink}>
            Google position for the keyword
          </text>
          {aiRuns.length ? <path d={area(aiRuns)} fill={T.accent} fillOpacity={0.07} /> : null}
          {showPrev ? <path d={line(runs(namedBefore, xAt, ya))} fill="none" stroke={T.accent} strokeWidth={1.6} strokeDasharray="4 5" strokeLinecap="round" opacity={0.5} /> : null}
          {aiRuns.length ? <path d={line(aiRuns)} fill="none" stroke={T.accent} strokeWidth={3} strokeLinejoin="round" strokeLinecap="round" /> : null}
          {showPrev ? <path d={line(runs(googleBefore, xAt, yb))} fill="none" stroke={T.ink} strokeWidth={1.6} strokeDasharray="4 5" strokeLinecap="round" opacity={0.4} /> : null}
          <path d={line(runs(data.google, xAt, yb))} fill="none" stroke={T.ink} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
          {hover !== null ? <line x1={xAt(hover)} x2={xAt(hover)} y1={A_TOP} y2={B_BOT} stroke={T.ink} opacity={0.25} /> : null}
          {showPlaced
            ? marks.map((m) => (
                <g key={m.id}>
                  <title>{m.label}</title>
                  <line x1={xAt(m.i)} x2={xAt(m.i)} y1={A_TOP} y2={B_BOT} stroke={T.faint} strokeWidth={2} opacity={0.5} />
                  <circle cx={xAt(m.i)} cy={(A_BOT + B_TOP) / 2} r={6} fill={KIND_DOT[m.kind]} stroke={T.surface} strokeWidth={3} />
                </g>
              ))
            : null}
        </svg>

        {data.pending ? null : (
          <div style={{ position: "absolute", left: `${((X0 - step / 2) / W) * 100}%`, width: `${((X1 - X0 + step) / W) * 100}%`, top: `${(A_TOP / H) * 100}%`, height: `${((B_BOT - A_TOP) / H) * 100}%`, display: "flex" }}>
            {data.days.map((d, i) => (
              <button
                key={d + i}
                ref={(el) => {
                  dayRefs.current[i] = el;
                }}
                type="button"
                className="app-chart-day"
                tabIndex={i === cursor ? 0 : -1}
                aria-label={`${data.dayLabels[i]}: answers naming you ${readNamed(data.named[i] ?? null)}, Google position ${readG(data.google[i] ?? null)}`}
                onKeyDown={onDayKey}
                onMouseEnter={() => setHover(i)}
                onFocus={() => {
                  setHover(i);
                  setCursor(i);
                }}
                onBlur={() => setHover(null)}
                style={{ flex: "1 1 0", minWidth: 0, background: "transparent", border: 0, padding: 0, cursor: "default" }}
              />
            ))}
          </div>
        )}

        {hover !== null ? (
          <div
            role="status"
            style={{ position: "absolute", top: `${(48 / H) * 100}%`, left: `${(xAt(hover) / W) * 100}%`, transform: xAt(hover) > 760 ? "translateX(calc(-100% - 12px))" : "translateX(12px)", width: "236px", boxSizing: "border-box", padding: "12px 14px", borderRadius: "12px", background: T.ink, color: T.surface, pointerEvents: "none", display: "flex", flexDirection: "column", gap: "6px" }}
          >
            <div style={{ fontSize: "13px", fontWeight: 700 }}>{data.dayLabels[hover]}</div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px" }}>
              <span style={{ width: "8px", height: "8px", flexShrink: 0, borderRadius: "50%", background: T.accent }} />
              <span style={{ flexGrow: 1, whiteSpace: "nowrap" }}>Answers naming you</span>
              <span style={{ fontWeight: 700, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{readNamed(data.named[hover] ?? null)}</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px" }}>
              <span style={{ width: "8px", height: "8px", flexShrink: 0, borderRadius: "50%", background: T.surface }} />
              <span style={{ flexGrow: 1, whiteSpace: "nowrap" }}>Google position</span>
              <span style={{ fontWeight: 700, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{readG(data.google[hover] ?? null)}</span>
            </div>
            {showPrev && data.prevLabels ? (
              <div style={{ fontSize: "12px", color: T.faint }}>
                {`Same day last period (${data.prevLabels[hover] ?? "-"}): ${pct(data.namedBefore?.[hover] ?? null)}, ${readG(googleBefore[hover] ?? null)}`}
              </div>
            ) : null}
          </div>
        ) : null}

        <ChartMarks marks={work} n={n} x0={X0} x1={X1} w={W} h={H} y={H_PLAIN + WORK_STRIP / 2} dayLabels={data.dayLabels} />

        {data.pending ? (
          <div style={{ position: "absolute", left: `${(X0 / W) * 100}%`, width: `${((X1 - X0) / W) * 100}%`, top: 0, height: `${(B_BOT / H) * 100}%`, display: "flex", alignItems: "center", justifyContent: "center", background: `color-mix(in srgb, ${T.surface} 86%, transparent)` }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "6px", textAlign: "center", padding: "0 16px" }}>
              <span style={{ fontSize: "16px", fontWeight: 700, color: T.ink }}>No readings yet</span>
              <span style={{ fontSize: "14px", color: T.soft }}>{`This cluster's first check is tomorrow at ${data.firstCheckAt}. The chart fills in from there.`}</span>
            </div>
          </div>
        ) : null}
      </div>

      <div className="app-hide-sm" style={{ display: "flex", gap: "20px", flexWrap: "wrap", fontSize: "12px", color: T.soft }}>
        <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <span style={{ width: "18px", borderTop: `3px solid ${T.accent}` }} />
          Answers naming you
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <span style={{ width: "18px", borderTop: `3px solid ${T.ink}` }} />
          Google position
        </span>
        {hasPrev && data.beforeLabel ? (
          <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span style={{ width: "18px", borderTop: `2px dashed ${T.soft}` }} />
            {data.beforeLabel}
          </span>
        ) : null}
        <MarkLegend marks={work} />
        {data.note ? <span>{data.note}</span> : null}
      </div>
      {work.length ? (
        <div className="app-show-sm">
          <MarkList marks={work} dayLabels={data.dayLabels} />
        </div>
      ) : null}
      {data.openHref ? (
        <Link href={data.openHref} className="app-show-sm" data-usage="detail_open" style={{ fontSize: "14px", fontWeight: 600, color: T.accent, textDecoration: "none" }}>
          Open this cluster
        </Link>
      ) : null}
    </section>
  );
}

/**
 * The phone's chart (T4b mobile, 30 Sep 2026): boards-3/Mobile.dc.html draws
 * its own 326x222 compact version - no Page 1 line, #1/#10/#20, three date
 * labels - rather than the desktop chart scaled to unreadable type. Swapped in
 * by CSS below 560px, so it stands with JS off. Still, no hover: the day
 * readout is the desktop's.
 */
function Compact({ data, showPrev }: { data: ClusterChartData; showPrev: boolean }) {
  const CW = 326;
  const x0 = 30;
  const x1 = 320;
  const n = data.days.length;
  const step = n > 1 ? (x1 - x0) / (n - 1) : 0;
  const xAt = (i: number) => x0 + i * step;
  const ya2 = (v: number) => 86 - Math.min(v, 100) * 0.7;
  const yb2 = (p: number) => 132 + ((Math.min(p, 30) - 1) * 70) / 29;
  const named = data.named.map((p) => (p ? p.pct : null));
  const namedBefore = (data.namedBefore ?? []).slice(0, n).map((p) => (p ? p.pct : null));
  const googleBefore = (data.googleBefore ?? []).slice(0, n);
  const mid = Math.round((n - 1) / 2);
  return (
    <div className="app-show-sm" style={{ position: "relative" }}>
      <svg width="100%" viewBox={`0 0 ${CW} 222`} role="img" aria-label={`Answers naming ${data.brand} for ${data.keyword}, above its Google position, ${data.dayLabels[0]} to ${data.dayLabels[n - 1]}`} style={{ display: "block" }}>
        <text x={x0} y={10} fontSize={11} fontWeight={700} fill={T.ink}>
          AI answers naming you
        </text>
        <text x={x0} y={118} fontSize={11} fontWeight={700} fill={T.ink}>
          Google position
        </text>
        {[0, 50, 100].map((v) => (
          <g key={`a${v}`}>
            <line x1={x0} x2={x1} y1={ya2(v)} y2={ya2(v)} stroke={T.hair} />
            <text x={x0 - 5} y={ya2(v) + 4} textAnchor="end" fontSize={10} fill={T.soft}>
              {v}%
            </text>
          </g>
        ))}
        {[1, 10, 20].map((p) => (
          <g key={`b${p}`}>
            <line x1={x0} x2={x1} y1={yb2(p)} y2={yb2(p)} stroke={T.hair} />
            <text x={x0 - 5} y={yb2(p) + 4} textAnchor="end" fontSize={10} fill={T.soft}>
              {`#${p}`}
            </text>
          </g>
        ))}
        {showPrev ? <path d={line(runs(namedBefore, xAt, ya2))} fill="none" stroke={T.accent} strokeWidth={1.4} strokeDasharray="3 4" opacity={0.5} /> : null}
        <path d={line(runs(named, xAt, ya2))} fill="none" stroke={T.accent} strokeWidth={2.4} strokeLinejoin="round" strokeLinecap="round" />
        {showPrev ? <path d={line(runs(googleBefore, xAt, yb2))} fill="none" stroke={T.ink} strokeWidth={1.4} strokeDasharray="3 4" opacity={0.4} /> : null}
        <path d={line(runs(data.google, xAt, yb2))} fill="none" stroke={T.ink} strokeWidth={2.2} strokeLinejoin="round" strokeLinecap="round" />
        <text x={x0} y={218} textAnchor="middle" fontSize={10} fill={T.soft}>
          {data.days[0]}
        </text>
        {n > 2 ? (
          <text x={xAt(mid)} y={218} textAnchor="middle" fontSize={10} fill={T.soft}>
            {data.days[mid]}
          </text>
        ) : null}
        <text x={x1} y={218} textAnchor="end" fontSize={10} fill={T.soft}>
          {data.days[n - 1]}
        </text>
      </svg>
      {data.pending ? (
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "6px", textAlign: "center", background: `color-mix(in srgb, ${T.surface} 86%, transparent)` }}>
          <span style={{ fontSize: "15px", fontWeight: 700, color: T.ink }}>No readings yet</span>
          <span style={{ fontSize: "13px", color: T.soft }}>{`First check tomorrow at ${data.firstCheckAt}.`}</span>
        </div>
      ) : null}
    </div>
  );
}
