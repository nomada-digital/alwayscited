"use client";

import Link from "@/components/app/AppLink";
import { useState } from "react";

import { T } from "@/config/tokens";

import { MARK_BOX, MARK_READOUT_W, MARK_WORDS, type MarkKind, type PlacedMark, markLeftCss } from "./chart-board";

/**
 * Work markers under a chart's plot (13 Oct 2026, DIY P4; spec 10 section 4.1
 * row 8): a dated tick per Actions item started or done, placement gone live
 * or prompt added, drawn in tokens - started T.warnFg, done T.goodFg, a
 * placement T.accent, a prompt T.soft - and each with its own shape, so the
 * colour is never the only way to tell them apart.
 *
 * Each day with work is one 24px control at its line, placed in CSS and held
 * inside the plot at every width (chart-board.ts markLeftCss, whose census is
 * chart-board.test.mts). Hover or focus reads it out above the strip, inside
 * the plot too; a keyboard reaches each in turn after the day buttons. With JS
 * off each is still a link (or a labelled button) with its words in its name
 * and title. On the phone charts the same marks are a list under the plot.
 */

export const MARK_COLOUR: Record<MarkKind, string> = { started: T.warnFg, done: T.goodFg, placement: T.accent, prompt: T.soft };

/** One mark's shape, centred on (cx, cy): started an open ring, done a dot, a placement a diamond, a prompt a square. */
export function MarkShape({ kind, cx, cy, r = 4 }: { kind: MarkKind; cx: number; cy: number; r?: number }) {
  const c = MARK_COLOUR[kind];
  if (kind === "started") return <circle cx={cx} cy={cy} r={r - 0.75} fill={T.surface} stroke={c} strokeWidth={1.5} />;
  if (kind === "done") return <circle cx={cx} cy={cy} r={r} fill={c} />;
  if (kind === "placement") return <path d={`M${cx},${cy - r - 0.5} L${cx + r + 0.5},${cy} L${cx},${cy + r + 0.5} L${cx - r - 0.5},${cy} Z`} fill={c} />;
  return <rect x={cx - r + 0.5} y={cy - r + 0.5} width={2 * r - 1} height={2 * r - 1} rx={1} fill={c} />;
}

/** The marks grouped by day: one control a day, its words every mark's. */
function byDay(marks: readonly PlacedMark[]): { i: number; marks: PlacedMark[] }[] {
  const out: { i: number; marks: PlacedMark[] }[] = [];
  for (const m of marks) {
    const last = out[out.length - 1];
    if (last && last.i === m.i) last.marks.push(m);
    else out.push({ i: m.i, marks: [m] });
  }
  return out;
}

const words = (ms: readonly PlacedMark[], day: string) => `${ms.map((m) => `${MARK_WORDS[m.kind]}: ${m.label}`).join("; ")}, ${day}`;

/**
 * The board's markers: an HTML strip laid over the plot at viewBox height `y`
 * of a `w` by `h` board whose days run from x0 to x1.
 */
export default function ChartMarks({ marks, n, x0, x1, w, h, y, dayLabels }: { marks: readonly PlacedMark[]; n: number; x0: number; x1: number; w: number; h: number; y: number; dayLabels: readonly string[] }) {
  const [on, setOn] = useState<number | null>(null);
  if (!marks.length) return null;
  const step = n > 1 ? (x1 - x0) / (n - 1) : 0;
  const xAt = (i: number) => x0 + i * step;
  const days = byDay(marks);
  const open = on === null ? null : days[on];
  return (
    <div data-marks="" style={{ position: "absolute", left: 0, right: 0, top: `${(y / h) * 100}%`, height: 0 }}>
      {days.map((d, k) => {
        const label = words(d.marks, dayLabels[d.i] ?? "");
        const href = d.marks.find((m) => m.href)?.href;
        const style: React.CSSProperties = { position: "absolute", left: markLeftCss(xAt(d.i), w, MARK_BOX), top: `${-MARK_BOX / 2}px`, width: `${MARK_BOX}px`, height: `${MARK_BOX}px`, padding: 0, border: 0, borderRadius: "6px", background: "transparent", display: "flex", alignItems: "center", justifyContent: "center", cursor: href ? "pointer" : "default" };
        const glyph = (
          <svg width={MARK_BOX} height={MARK_BOX} viewBox={`0 0 ${MARK_BOX} ${MARK_BOX}`} aria-hidden="true">
            <line x1={12} x2={12} y1={0} y2={6} stroke={MARK_COLOUR[d.marks[0]!.kind]} strokeWidth={2} />
            {d.marks.slice(0, 2).map((m, j) => (
              <MarkShape key={j} kind={m.kind} cx={12} cy={11 + j * 8} r={d.marks.length > 1 ? 3.5 : 4.5} />
            ))}
          </svg>
        );
        const events = { onMouseEnter: () => setOn(k), onMouseLeave: () => setOn(null), onFocus: () => setOn(k), onBlur: () => setOn(null) };
        return href ? (
          <Link key={d.i} href={href} aria-label={label} title={label} className="app-tap" data-mark={d.marks.map((m) => m.kind).join(" ")} style={{ ...style, textDecoration: "none" }} {...events}>
            {glyph}
          </Link>
        ) : (
          <button key={d.i} type="button" aria-label={label} title={label} className="app-chart-day" data-mark={d.marks.map((m) => m.kind).join(" ")} style={style} {...events}>
            {glyph}
          </button>
        );
      })}
      {open ? (
        <div role="status" style={{ position: "absolute", left: markLeftCss(xAt(open.i), w, MARK_READOUT_W), bottom: `${MARK_BOX / 2 + 6}px`, width: `${MARK_READOUT_W}px`, boxSizing: "border-box", padding: "10px 12px", borderRadius: "12px", background: T.ink, color: T.surface, fontSize: "13px", lineHeight: 1.4, pointerEvents: "none", display: "grid", gap: "4px" }}>
          <span style={{ fontWeight: 700 }}>{dayLabels[open.i]}</span>
          {open.marks.map((m, j) => (
            <span key={j}>{`${MARK_WORDS[m.kind]}: ${m.label}`}</span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** The kinds drawn, as a legend under the chart: each shape with its word. */
export function MarkLegend({ marks }: { marks: readonly PlacedMark[] }) {
  const kinds = (["started", "done", "placement", "prompt"] as const).filter((k) => marks.some((m) => m.kind === k));
  if (!kinds.length) return null;
  return (
    <>
      {kinds.map((k) => (
        <span key={k} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <MarkShape kind={k} cx={6} cy={6} />
          </svg>
          {MARK_WORDS[k]}
        </span>
      ))}
    </>
  );
}

/** The phone's marks: a list under the compact plot, newest first, each linked where it has a link. */
export function MarkList({ marks, dayLabels }: { marks: readonly PlacedMark[]; dayLabels: readonly string[] }) {
  if (!marks.length) return null;
  return (
    <ul aria-label="Work on this chart" style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "6px" }}>
      {[...marks].reverse().map((m, k) => (
        <li key={k} style={{ display: "flex", alignItems: "baseline", gap: "8px", fontSize: "13px", lineHeight: 1.4, color: T.ink }}>
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" style={{ flexShrink: 0, alignSelf: "center" }}>
            <MarkShape kind={m.kind} cx={6} cy={6} />
          </svg>
          <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>
            {m.href ? (
              <Link href={m.href} style={{ color: T.ink, fontWeight: 600 }}>
                {`${MARK_WORDS[m.kind]}: ${m.label}`}
              </Link>
            ) : (
              `${MARK_WORDS[m.kind]}: ${m.label}`
            )}
            <span style={{ color: T.soft }}>{`, ${dayLabels[m.i] ?? ""}`}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
