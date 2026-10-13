"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

import Link from "@/components/app/AppLink";
import EngineLogo from "@/components/EngineLogo";
import { T } from "@/config/tokens";
import { ENGINE_SPECS, type Engine } from "@/lib/scan/engines";

import ChartMarks, { MarkLegend, MarkList } from "./ChartMarks";
import { type ChartMark, H, READOUT_W, W, X0, X1, Y0, Y1, boardDayAt, dayStrip, placeMarks, readoutAt } from "./chart-board";

/**
 * The overview's chart (T4, 29 Sep 2026), hand-built SVG as
 * boards/Main.dc.html draws it - no chart library. The engine chips, the
 * previous-period dashed line and like-for-like are client state; the server
 * render is the settled default (all engines, previous period on), so the
 * page reads the same with JS off. Each day is a button, so the readout is
 * reachable by keyboard as well as by hover: one Tab stop (the last day),
 * then the arrow keys, Home and End.
 *
 * Engine lines take each engine's own colour from ENGINE_SPECS, not the
 * board's placeholder blues and inks.
 *
 * 8 Oct 2026 (audit mobile-2): on a phone the 1056-wide board scaled into
 * 232-302px, so its axis type drew at 2.6-3.4px, and the 220px readout, placed
 * by percentage and flipped only past x=780, ran off the card - each tap on a
 * later day widened the page (390 became 480). Wherever the plot is under
 * 880px (globals.css, .app-ovc) the chart is Compact: its type is HTML at
 * 11px, the lines stretch to the width, and the day's detail is a row above
 * the plot that always shows a day (the latest until one is picked). A tap or
 * a slide along the plot picks the day. The board's readout is placed in
 * pixels from the measured width and kept inside it (chart-board.ts), and the
 * card clips sideways as a backstop.
 *
 * On a touch screen the lede says "Tap a day, or slide along the chart", and
 * a touch screen can be wide enough for the board - a large tablet, a touch
 * laptop - so the board takes the same slide as Compact (review, 8 Oct 2026:
 * at 1280 and 1366 a finger along the board picked nothing).
 */

export type Point = { pct: number | null; num: number; den: number };
export type ChartDay = { label: string; all: Point; by: Record<string, Point> };
export type ChartData = {
  engines: Engine[];
  now: ChartDay[];
  before: ChartDay[] | null;
  lflNow: ChartDay[] | null;
  lflBefore: ChartDay[] | null;
  beforeLabel: string | null;
  lflNote: string | null;
  notes: { index: number; text: string }[];
  brand: string;
  questions: number;
  /** 13 Oct 2026, DIY P4: the ISO day of each point in `now`, so work markers can be placed by date. */
  isoDays?: string[];
  /** Work markers (chart-board.ts ChartMark): prompts added, placements live, Actions items done. None draws none. */
  marks?: ChartMark[];
  /**
   * The AI visibility page holds the engine and like-for-like in its URL
   * (`?eng=`, `?lfl=1`; spec 10 section 4.2 row 3): the chips and the switch
   * are then links to those URLs, the picked view comes from the page, and it
   * reads the same with JS off. Without it they are client state, as on the
   * Overview.
   */
  view?: { engine: "all" | Engine; lfl: boolean; hrefs: { all: string; engines: Record<string, string>; lfl: string } };
};

function path(days: ChartDay[], pick: (d: ChartDay) => Point, max: number): string {
  const step = days.length > 1 ? (X1 - X0) / (days.length - 1) : 0;
  let d = "";
  let pen = false;
  days.forEach((day, i) => {
    const p = pick(day).pct;
    if (p === null) {
      pen = false;
      return;
    }
    const x = X0 + i * step;
    const y = Y0 - (Math.min(p, max) / max) * (Y0 - Y1);
    d += `${pen ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)} `;
    pen = true;
  });
  return d.trim();
}

/** One series as an SVG path over any geometry; a day with no reading lifts the pen. */
function linePath(vals: (number | null)[], x: (i: number) => number, y: (v: number) => number): string {
  let d = "";
  let pen = false;
  vals.forEach((v, i) => {
    if (v === null) {
      pen = false;
      return;
    }
    d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)} `;
    pen = true;
  });
  return d.trim();
}

/** What a day reads, engine by engine: the desktop's hover box and the phone's row above the plot. */
function ReadoutBody({ day, engines, lfl, before, beforePct, note }: { day: ChartDay; engines: Engine[]; lfl: boolean; before: ChartDay | null; beforePct: number | null; note: string | null }) {
  return (
    <>
      <div style={{ fontWeight: 700, gridColumn: "1 / -1" }}>
        {day.label}
        {lfl ? ", like-for-like" : ""}
      </div>
      {engines.map((e) => {
        const p = day.by[e];
        return (
          <div key={e} style={{ display: "flex", justifyContent: "space-between", gap: "8px" }}>
            <span>{ENGINE_SPECS[e].label}</span>
            <span style={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{p && p.pct !== null ? `${p.pct}% (${p.num} of ${p.den})` : "no check"}</span>
          </div>
        );
      })}
      {before ? (
        <div style={{ color: T.faint, fontSize: "12px", gridColumn: "1 / -1" }}>
          Same day last period ({before.label}): {beforePct === null ? "no check" : `${beforePct}%`}
        </div>
      ) : null}
      {note ? <div style={{ color: T.faint, fontSize: "12px", gridColumn: "1 / -1" }}>{note}</div> : null}
    </>
  );
}

function Switch({ on, label, onToggle, disabled }: { on: boolean; label: string; onToggle: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      data-usage="compare_change"
      onClick={onToggle}
      disabled={disabled}
      style={{ display: "inline-flex", alignItems: "center", gap: "10px", height: "36px", padding: "0 4px", border: 0, background: "transparent", color: T.ink, fontSize: "13px", fontWeight: 600, cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.5 : 1 }}
    >
      <span style={{ position: "relative", width: "34px", height: "20px", borderRadius: "999px", background: on ? T.accent : T.line, transition: "background .15s" }}>
        <span style={{ position: "absolute", top: "2px", left: on ? "16px" : "2px", width: "16px", height: "16px", borderRadius: "50%", background: T.surface, boxShadow: `0 1px 2px color-mix(in srgb, ${T.ink} 25%, transparent)`, transition: "left .15s" }} />
      </span>
      {label}
    </button>
  );
}

export default function OverviewChart({ data }: { data: ChartData }) {
  const [prev, setPrev] = useState(true);
  const [lflState, setLfl] = useState(false);
  const [shownState, setShown] = useState<"all" | Engine>("all");
  // A view held in the URL is the page's to say; otherwise each switch is this chart's own state.
  const lfl = data.view ? data.view.lfl : lflState;
  const shown = data.view ? data.view.engine : shownState;
  const [hover, setHover] = useState<number | null>(null);
  const [picked, setCursor] = useState(data.now.length - 1);
  const dayRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const smRefs = useRef<(HTMLButtonElement | null)[]>([]);
  // The desktop plot's drawn width, so the readout is placed and kept inside it in pixels.
  const plot = useRef<HTMLDivElement>(null);
  const [plotW, setPlotW] = useState<number | null>(null);
  useEffect(() => {
    const el = plot.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setPlotW(el.clientWidth || null));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const now = lfl && data.lflNow ? data.lflNow : data.now;
  const before = lfl && data.lflBefore ? data.lflBefore : data.before;
  const pick = (d: ChartDay) => (shown === "all" ? d.all : (d.by[shown] ?? { pct: null, num: 0, den: 0 }));
  const colour = shown === "all" ? T.accent : ENGINE_SPECS[shown].colour;

  const peak = Math.max(0, ...now.map((d) => pick(d).pct ?? 0), ...(prev && before ? before.map((d) => pick(d).pct ?? 0) : []));
  const max = Math.max(60, Math.ceil(peak / 20) * 20);
  const ticks = [0, max / 3, (2 * max) / 3, max].map((v) => Math.round(v));
  const step = now.length > 1 ? (X1 - X0) / (now.length - 1) : 0;
  // One Tab stop for the days, not one per day (R173 pass 3, DS33): the arrow keys, Home and End move between them.
  const lastDay = now.length - 1;
  const cursor = Math.min(picked, lastDay);
  const onDayKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const to = { ArrowLeft: cursor - 1, ArrowDown: cursor - 1, ArrowRight: cursor + 1, ArrowUp: cursor + 1, Home: 0, End: lastDay }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    // Whichever set of day buttons is on screen: the desktop's or Compact's.
    const refs = smRefs.current.includes(e.currentTarget) ? smRefs : dayRefs;
    refs.current[Math.max(0, Math.min(lastDay, to))]?.focus();
  };
  const xAt = (i: number) => X0 + i * step;
  const strip = dayStrip(now.length);
  const slideTo = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return boardDayAt(r.width ? (e.clientX - r.left) / r.width : 0, now.length);
  };
  const line = path(now, pick, max);
  const lastX = (() => {
    for (let i = now.length - 1; i >= 0; i--) if (pick(now[i]!).pct !== null) return xAt(i);
    return null;
  })();
  const firstX = now.findIndex((d) => pick(d).pct !== null);
  const area = line && lastX !== null ? `${line} L${lastX.toFixed(1)},${Y0} L${xAt(firstX).toFixed(1)},${Y0} Z` : "";
  const labelEvery = Math.max(1, Math.round((now.length - 1) / 4));
  const read = hover !== null ? now[hover] : null;
  const readBefore = hover !== null && prev && before ? before[hover] : null;
  const withData = now.filter((d) => pick(d).pct !== null);
  const first = withData[0] ? pick(withData[0]).pct : null;
  const last = withData.length ? pick(withData[withData.length - 1]!).pct : null;
  const summary =
    first === null
      ? `No daily checks in this range yet`
      : `Daily share of answers naming ${data.brand}, ${now[0]!.label} to ${now[now.length - 1]!.label}, from ${first}% to ${last}%`;
  // Work markers sit in a strip under the date labels; the board grows by its height only when there are some.
  const marks = data.isoDays && data.marks ? placeMarks(data.isoDays, data.marks) : [];
  const boardH = marks.length ? H + 30 : H;
  const dayLabels = now.map((d) => d.label);

  return (
    <section aria-labelledby="chart-h" className="app-chart-card app-ovc" style={{ background: T.surface, border: `1px solid ${T.line}`, borderRadius: "18px", padding: "24px 27px 20px", display: "flex", flexDirection: "column", gap: "18px", minWidth: 0, overflowX: "clip" }}>
      <div className="app-chart-head" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "24px", flexWrap: "wrap" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          <h2 id="chart-h" style={{ margin: 0, fontSize: "19px", fontWeight: 700, letterSpacing: "-0.022em", color: T.ink }}>
            Share of answers naming you
          </h2>
          <p style={{ margin: 0, fontSize: "14px", color: T.soft }}>
            Each day, the share of your {data.questions} prompts where an engine named {data.brand}.{" "}
            <span className="app-fine">Hover or tab to a day for the detail.</span>
            <span className="app-coarse">Tap a day, or slide along the chart, for the detail.</span>
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "16px", flexWrap: "wrap" }}>
          <Switch on={prev && !!data.before} label="Previous period" onToggle={() => setPrev((v) => !v)} disabled={!data.before} />
          {data.view && data.lflNow ? (
            <Link href={data.view.hrefs.lfl} aria-current={lfl ? "true" : undefined} data-usage="compare_change" style={{ display: "inline-flex", alignItems: "center", gap: "10px", height: "36px", padding: "0 4px", color: T.ink, fontSize: "13px", fontWeight: 600, textDecoration: "none" }}>
              <span style={{ position: "relative", width: "34px", height: "20px", borderRadius: "999px", background: lfl ? T.accent : T.line }}>
                <span style={{ position: "absolute", top: "2px", left: lfl ? "16px" : "2px", width: "16px", height: "16px", borderRadius: "50%", background: T.surface, boxShadow: `0 1px 2px color-mix(in srgb, ${T.ink} 25%, transparent)` }} />
              </span>
              Like-for-like only
            </Link>
          ) : (
            <Switch on={lfl && !!data.lflNow} label="Like-for-like only" onToggle={() => setLfl((v) => !v)} disabled={!data.lflNow} />
          )}
        </div>
      </div>

      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
        {(["all", ...data.engines] as const).map((e) => {
          const on = shown === e;
          if (data.view) {
            const href = e === "all" ? data.view.hrefs.all : data.view.hrefs.engines[e];
            if (href)
              return (
                <Link
                  key={e}
                  href={href}
                  aria-current={on ? "true" : undefined}
                  data-usage="engine_toggle"
                  data-usage-engine={e}
                  style={{ display: "inline-flex", alignItems: "center", gap: "8px", height: "36px", padding: "0 14px", boxSizing: "border-box", borderRadius: "999px", border: `1px solid ${on ? T.washLine : T.line}`, background: on ? T.wash : T.surface, color: T.ink, fontSize: "13px", fontWeight: 600, textDecoration: "none" }}
                >
                  {e === "all" ? <span style={{ width: "10px", height: "10px", borderRadius: "50%", background: T.accent }} /> : <EngineLogo engine={e} size={14} />}
                  {e === "all" ? "All engines" : ENGINE_SPECS[e].label}
                </Link>
              );
          }
          return (
            <button
              key={e}
              type="button"
              aria-pressed={on}
              data-usage="engine_toggle"
              data-usage-engine={e}
              onClick={() => setShown(e)}
              style={{ display: "inline-flex", alignItems: "center", gap: "8px", height: "36px", padding: "0 14px", borderRadius: "999px", border: `1px solid ${on ? T.washLine : T.line}`, background: on ? T.wash : T.surface, color: T.ink, fontSize: "13px", fontWeight: 600, cursor: "pointer" }}
            >
              {e === "all" ? <span style={{ width: "10px", height: "10px", borderRadius: "50%", background: T.accent }} /> : <EngineLogo engine={e} size={14} />}
              {e === "all" ? "All engines" : ENGINE_SPECS[e].label}
            </button>
          );
        })}
      </div>

      <Compact now={now} before={prev ? before : null} pick={pick} max={max} ticks={ticks} colour={colour} notes={data.notes} engines={shown === "all" ? data.engines : [shown]} lfl={lfl} hover={hover} setHover={setHover} cursor={cursor} setCursor={setCursor} refs={smRefs} onDayKey={onDayKey} summary={summary}>
        <MarkList marks={marks} dayLabels={dayLabels} />
      </Compact>

      <div
        ref={plot}
        className="app-ovc-lg"
        style={{ position: "relative", width: "100%", maxWidth: `${W}px`, touchAction: "pan-y" }}
        onMouseLeave={() => setHover(null)}
        // A touch or a pen: a slide along the board picks the day under it, as on Compact. The mouse has the day buttons' hover.
        onPointerDown={(e) => {
          if (e.pointerType !== "mouse") setHover(slideTo(e));
        }}
        onPointerMove={(e) => {
          if (e.pointerType !== "mouse" && e.buttons) setHover(slideTo(e));
        }}
      >
        <svg width="100%" viewBox={`0 0 ${W} ${boardH}`} role="img" aria-label={summary} style={{ display: "block", overflow: "visible" }}>
          {area ? <path d={area} fill={colour} fillOpacity={0.07} /> : null}
          {ticks.map((v, i) => {
            const y = Y0 - (v / max) * (Y0 - Y1);
            return (
              <g key={v}>
                <line x1={X0} x2={X1} y1={y} y2={y} stroke={i === 0 ? T.line : T.hair} strokeWidth={1} />
                <text x={30} y={y + 4} textAnchor="end" fontSize={12} fill={T.soft}>
                  {v}%
                </text>
              </g>
            );
          })}
          {now.map((d, i) =>
            i % labelEvery === 0 || i === now.length - 1 ? (
              <text key={i} x={xAt(i)} y={290} textAnchor="middle" fontSize={12} fill={T.soft}>
                {d.label}
              </text>
            ) : null,
          )}
          {data.notes.map((n) => (
            <g key={`${n.index}-${n.text}`}>
              <line x1={xAt(n.index)} x2={xAt(n.index)} y1={Y1} y2={Y0} stroke={T.faint} strokeWidth={1} strokeDasharray="2 4" />
              <circle cx={xAt(n.index)} cy={Y0} r={4} fill={T.surface} stroke={T.ink} strokeWidth={1.5} />
            </g>
          ))}
          {prev && before ? <path d={path(before, pick, max)} fill="none" stroke={colour} strokeWidth={1.6} strokeDasharray="4 5" strokeLinecap="round" /> : null}
          {line ? <path d={line} fill="none" stroke={colour} strokeWidth={3} strokeLinejoin="round" strokeLinecap="round" /> : null}
          {hover !== null && pick(now[hover]!).pct !== null ? (
            <g>
              <line x1={xAt(hover)} x2={xAt(hover)} y1={Y1} y2={Y0} stroke={T.line} strokeWidth={1} />
              <circle cx={xAt(hover)} cy={Y0 - (Math.min(pick(now[hover]!).pct!, max) / max) * (Y0 - Y1)} r={5} fill={colour} stroke={T.surface} strokeWidth={2} />
            </g>
          ) : null}
        </svg>

        {data.notes.map((n) => (
          <span
            key={`label-${n.index}-${n.text}`}
            style={{ position: "absolute", top: 0, left: `${(xAt(n.index) / W) * 100}%`, transform: "translateX(6px)", fontSize: "12px", fontWeight: 600, color: T.ink, background: T.surface, padding: "0 4px", whiteSpace: "nowrap" }}
          >
            {n.text}
          </span>
        ))}

        {/* One button per day, each centred on its day's line (chart-board.ts, dayStrip). */}
        <div style={{ position: "absolute", inset: `0 ${((W - strip.right) / W) * 100}% ${((boardH - 0.88 * H) / boardH) * 100}% ${(strip.left / W) * 100}%`, display: "flex" }}>
          {now.map((d, i) => {
            const p = pick(d);
            return (
              <button
                key={i}
                type="button"
                ref={(el) => {
                  dayRefs.current[i] = el;
                }}
                className="app-chart-day"
                tabIndex={i === cursor ? 0 : -1}
                aria-label={`${d.label}: ${p.pct === null ? "no check" : `${p.pct}%, ${p.num} of ${p.den} answers`}`}
                onKeyDown={onDayKey}
                onMouseEnter={() => setHover(i)}
                onClick={() => setHover(i)}
                onFocus={() => {
                  setHover(i);
                  setCursor(i);
                }}
                onBlur={() => setHover(null)}
                style={{ flex: "1 1 0", minWidth: 0, background: "transparent", border: 0, padding: 0, cursor: "default" }}
              />
            );
          })}
        </div>

        {read ? (
          <div role="status" style={{ position: "absolute", top: "24px", ...readoutAt(xAt(hover!), plotW), width: `${READOUT_W}px`, boxSizing: "border-box", background: T.ink, color: T.surface, borderRadius: "12px", padding: "12px 14px", fontSize: "13px", pointerEvents: "none", display: "grid", gap: "6px" }}>
            <ReadoutBody day={read} engines={shown === "all" ? data.engines : [shown]} lfl={lfl} before={readBefore} beforePct={readBefore ? pick(readBefore).pct : null} note={null} />
          </div>
        ) : null}
        <ChartMarks marks={marks} n={now.length} x0={X0} x1={X1} w={W} h={boardH} y={H + 15} dayLabels={dayLabels} />
      </div>

      <div style={{ display: "flex", gap: "20px", fontSize: "12px", color: T.soft, flexWrap: "wrap" }}>
        <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <span style={{ width: "18px", borderTop: `3px solid ${colour}` }} />
          This period
        </span>
        {data.beforeLabel ? (
          <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span style={{ width: "18px", borderTop: `2px dashed ${colour}` }} />
            {data.beforeLabel}
          </span>
        ) : null}
        <MarkLegend marks={marks} />
        {data.lflNote ? <span>{data.lflNote}</span> : null}
      </div>
    </section>
  );
}

/**
 * The narrow chart (8 Oct 2026, audit mobile-2), drawn in place of the board
 * wherever the plot is under 880px - every phone, and a tablet or a small
 * window beside the sidebar. Every word is HTML at 11-13px rather than SVG
 * text scaled with the plot; the plot's lines stretch to its width
 * (preserveAspectRatio none, strokes kept at their CSS width), and each day
 * is a button over its own slice of it. The row above the plot always reads a
 * day - the latest with a reading until a day is tapped, focused or slid to -
 * so the detail never needs a hover and never sits over the edge of the card.
 */
function Compact({
  now,
  before,
  pick,
  max,
  ticks,
  colour,
  notes,
  engines,
  lfl,
  hover,
  setHover,
  cursor,
  setCursor,
  refs,
  onDayKey,
  summary,
  children,
}: {
  children?: React.ReactNode;
  now: ChartDay[];
  before: ChartDay[] | null;
  pick: (d: ChartDay) => Point;
  max: number;
  ticks: number[];
  colour: string;
  notes: { index: number; text: string }[];
  engines: Engine[];
  lfl: boolean;
  hover: number | null;
  setHover: (i: number | null) => void;
  cursor: number;
  setCursor: (i: number) => void;
  refs: React.RefObject<(HTMLButtonElement | null)[]>;
  onDayKey: (e: KeyboardEvent<HTMLButtonElement>) => void;
  summary: string;
}) {
  const n = now.length;
  // Each day is the middle of its own slice, so a tap anywhere in the slice is that day.
  const xAt = (i: number) => ((i + 0.5) / Math.max(1, n)) * 1000;
  const yAt = (v: number) => 1000 - (Math.min(v, max) / max) * 1000;
  const vals = now.map((d) => pick(d).pct);
  const line = linePath(vals, xAt, yAt);
  const firstI = vals.findIndex((v) => v !== null);
  let lastI = -1;
  for (let i = n - 1; i >= 0; i--) {
    if (vals[i] !== null) {
      lastI = i;
      break;
    }
  }
  const area = line && lastI >= 0 ? `${line} L${xAt(lastI).toFixed(1)},1000 L${xAt(firstI).toFixed(1)},1000 Z` : "";
  const prevLine = before ? linePath(before.slice(0, n).map((d) => pick(d).pct), xAt, yAt) : "";
  const at = hover ?? (lastI >= 0 ? lastI : n - 1);
  const day = now[at];
  const dayBefore = before ? (before[at] ?? null) : null;
  const note = notes.filter((x) => x.index === at).map((x) => x.text).join(". ") || null;
  const atVal = hover !== null ? (vals[hover] ?? null) : null;
  const mid = Math.floor((n - 1) / 2);
  const fromX = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return Math.max(0, Math.min(n - 1, Math.floor(((e.clientX - r.left) / r.width) * n)));
  };
  const PH = "clamp(160px, 36vw, 240px)";
  return (
    <div className="app-ovc-sm" role="group" aria-label={summary} style={{ gap: "10px", minWidth: 0 }}>
      {day ? (
        <div role="status" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: "4px 20px", padding: "10px 12px", borderRadius: "12px", background: T.ink, color: T.surface, fontSize: "13px", lineHeight: 1.4 }}>
          <ReadoutBody day={day} engines={engines} lfl={lfl} before={dayBefore} beforePct={dayBefore ? pick(dayBefore).pct : null} note={note} />
        </div>
      ) : null}
      <div style={{ display: "grid", gridTemplateColumns: "auto minmax(0, 1fr)", columnGap: "8px", rowGap: "6px" }}>
        <div aria-hidden="true" style={{ position: "relative", height: PH, minWidth: "28px" }}>
          {ticks.map((v) => (
            <span key={v} data-axis="" style={{ position: "absolute", right: 0, top: `${100 - (v / max) * 100}%`, transform: "translateY(-50%)", fontSize: "11px", lineHeight: 1, color: T.soft, whiteSpace: "nowrap" }}>
              {v}%
            </span>
          ))}
        </div>
        <div
          style={{ position: "relative", height: PH, touchAction: "pan-y" }}
          onPointerDown={(e) => setHover(fromX(e))}
          onPointerMove={(e) => {
            if (e.pointerType === "mouse" || e.buttons) setHover(fromX(e));
          }}
          onMouseLeave={() => setHover(null)}
        >
          <svg width="100%" height="100%" viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true" style={{ display: "block", overflow: "visible" }}>
            {ticks.map((v, i) => (
              <line key={v} x1={0} x2={1000} y1={yAt(v)} y2={yAt(v)} stroke={i === 0 ? T.line : T.hair} strokeWidth={1} vectorEffect="non-scaling-stroke" />
            ))}
            {notes.map((x) => (
              <line key={`${x.index}-${x.text}`} x1={xAt(x.index)} x2={xAt(x.index)} y1={0} y2={1000} stroke={T.faint} strokeWidth={1} strokeDasharray="2 4" vectorEffect="non-scaling-stroke" />
            ))}
            {area ? <path d={area} fill={colour} fillOpacity={0.07} /> : null}
            {prevLine ? <path d={prevLine} fill="none" stroke={colour} strokeWidth={1.6} strokeDasharray="4 5" strokeLinecap="round" vectorEffect="non-scaling-stroke" /> : null}
            {line ? <path d={line} fill="none" stroke={colour} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" /> : null}
            {hover !== null ? <line x1={xAt(hover)} x2={xAt(hover)} y1={0} y2={1000} stroke={T.line} strokeWidth={1} vectorEffect="non-scaling-stroke" /> : null}
          </svg>
          {hover !== null && atVal !== null ? (
            <span aria-hidden="true" style={{ position: "absolute", left: `${xAt(hover) / 10}%`, top: `${yAt(atVal) / 10}%`, width: "10px", height: "10px", margin: "-5px 0 0 -5px", borderRadius: "50%", background: colour, boxShadow: `0 0 0 2px ${T.surface}`, pointerEvents: "none" }} />
          ) : null}
          <div style={{ position: "absolute", inset: 0, display: "flex" }}>
            {now.map((d, i) => {
              const p = pick(d);
              return (
                <button
                  key={i}
                  type="button"
                  ref={(el) => {
                    refs.current[i] = el;
                  }}
                  className="app-chart-day"
                  tabIndex={i === cursor ? 0 : -1}
                  aria-label={`${d.label}: ${p.pct === null ? "no check" : `${p.pct}%, ${p.num} of ${p.den} answers`}`}
                  onKeyDown={onDayKey}
                  onFocus={() => {
                    setHover(i);
                    setCursor(i);
                  }}
                  style={{ flex: "1 1 0", minWidth: 0, background: "transparent", border: 0, padding: 0, cursor: "default" }}
                />
              );
            })}
          </div>
        </div>
        <span />
        <div aria-hidden="true" style={{ display: "flex", justifyContent: "space-between", gap: "8px", fontSize: "11px", color: T.soft }}>
          <span data-axis="">{now[0]?.label}</span>
          {n > 2 ? <span data-axis="">{now[mid]!.label}</span> : null}
          <span data-axis="">{now[n - 1]?.label}</span>
        </div>
      </div>
      {children}
    </div>
  );
}
