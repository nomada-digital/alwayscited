import { T } from "@/config/tokens";
import { ordinal } from "@/lib/diy/plan/words";

/**
 * One tracked keyword's last 28 readings (13 Oct 2026, DIY P6; spec 10
 * section 4.3 row 4, fixing Nomada's W16): one point per reading, the
 * keyword's own best at the top and worst at the bottom, so a climb from 14th
 * to 9th slopes across the cell. A reading outside the top 20 is a gap in
 * the line with a mark on the floor - measured, not missing. Static SVG: it
 * draws the same with JS off, and its label says the first and last readings
 * in words.
 */
export default function Sparkline({ points, width = 76, height = 24 }: { points: readonly (number | null)[]; width?: number; height?: number }) {
  if (points.length < 2) return <span style={{ fontSize: "12px", color: T.soft }}>-</span>;
  const pad = 3;
  const read = points.filter((p): p is number => p !== null);
  const best = read.length ? Math.min(...read) : 1;
  const worst = read.length ? Math.max(...read) : 20;
  const x = (i: number) => pad + (i * (width - pad * 2)) / (points.length - 1);
  const y = (p: number) => (worst === best ? height / 2 : pad + ((p - best) / (worst - best)) * (height - pad * 2 - 4));
  const runs: string[] = [];
  let run: string[] = [];
  points.forEach((p, i) => {
    if (p === null) {
      if (run.length) runs.push(run.join(" "));
      run = [];
      return;
    }
    run.push(`${x(i).toFixed(1)},${y(p).toFixed(1)}`);
  });
  if (run.length) runs.push(run.join(" "));
  const words = (p: number | null) => (p === null ? "not in the top 20" : ordinal(p));
  const out = points.filter((p) => p === null).length;
  const label = `Last ${points.length} readings: ${words(points[0]!)} at the first, ${words(points[points.length - 1]!)} at the latest${out ? `; not in the top 20 on ${out}` : ""}`;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} style={{ display: "block", overflow: "visible" }}>
      {runs.map((r) =>
        r.includes(" ") ? (
          <polyline key={r} points={r} fill="none" stroke={T.accent} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
        ) : (
          <circle key={r} cx={r.split(",")[0]} cy={r.split(",")[1]} r="1.6" fill={T.accent} />
        ),
      )}
      {points.map((p, i) => (p === null ? <rect key={i} x={x(i) - 1} y={height - 2} width="2" height="2" fill={T.faint} /> : null))}
      {points[points.length - 1] !== null ? <circle cx={x(points.length - 1)} cy={y(points[points.length - 1]!)} r="2.2" fill={T.accent} /> : null}
    </svg>
  );
}
