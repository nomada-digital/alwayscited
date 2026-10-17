import EngineLogo from "@/components/EngineLogo";
import { ENGINE_SPECS, type Engine } from "@/lib/scan/engines";
import { fullness } from "@/lib/dash/allowance";

/**
 * The dashboards host's small figures. No hooks, so both server pages and the
 * client editor draw them. Every figure says what it is out of in its label or
 * title, as BRIEF decision 10 asks of every rate on this product.
 */

export const engineLabel = (e: string) => (ENGINE_SPECS as Record<string, { label: string }>)[e]?.label ?? e;

export function pct(r: number | null): string {
  return r === null ? "-" : `${Math.round(r * 100)}%`;
}

export function Pos({ pos }: { pos: number | null }) {
  if (pos === null) return <span className="pos none" title="Not in the top 100">-</span>;
  return <span className={`pos ${pos <= 3 ? "top3" : pos <= 10 ? "top10" : ""}`}>{pos}</span>;
}

export function Change({ n }: { n: number | null }) {
  if (n === null || n === 0) return <span className="faint num">{n === 0 ? "0" : ""}</span>;
  return <span className={`num ${n > 0 ? "up" : "down"}`} title={`${Math.abs(n)} place${Math.abs(n) === 1 ? "" : "s"} ${n > 0 ? "up" : "down"} in 7 days`}>{n > 0 ? "▲" : "▼"} {Math.abs(n)}</span>;
}

export function Rate({ r, title }: { r: number | null; title?: string }) {
  return (
    <span className="rate" title={title ?? "Answers naming you, of the answers given on the latest reading"}>
      <span className="track"><i style={{ width: `${Math.round((r ?? 0) * 100)}%` }} /></span>
      {pct(r)}
    </span>
  );
}

const VERDICT_TITLE = { named: "names you", missed: "answers without you", none: "gave no answer" } as const;

export function Cells({ engines, cells }: { engines: readonly Engine[]; cells: Partial<Record<Engine, "named" | "missed" | "none" | null>> }) {
  return (
    <span className="cells">
      {engines.map((e) => {
        const v = cells[e] ?? null;
        return (
          <span key={e} className={`cell ${v ?? ""}`} title={`${engineLabel(e)}: ${v ? VERDICT_TITLE[v] : "not read yet"}`}>
            <EngineLogo engine={e} size={12} />
          </span>
        );
      })}
    </span>
  );
}

export function EngineHeads({ engines }: { engines: readonly Engine[] }) {
  return (
    <span className="cells" aria-label="Engines">
      {engines.map((e) => (
        <span key={e} className="cell none" title={engineLabel(e)} style={{ boxShadow: "none" }}>
          <EngineLogo engine={e} size={13} />
        </span>
      ))}
    </span>
  );
}

/** A day-by-day strip for one engine: named, answered without you, no answer. */
export function Strip({ days }: { days: ("named" | "missed" | "none" | null)[] }) {
  return (
    <span className="strip" aria-hidden="true">
      {days.map((d, i) => <i key={i} className={d ?? ""} />)}
    </span>
  );
}

/** A sparkline of 0..1 rates, or of positions (lower is better) with `invert`. */
export function Spark({ values, width = 96, height = 26, invert = false, max }: { values: (number | null)[]; width?: number; height?: number; invert?: boolean; max?: number }) {
  const pts = values.map((v, i) => [i, v] as const).filter((p): p is readonly [number, number] => p[1] !== null);
  if (pts.length < 2) return <svg width={width} height={height} aria-hidden="true" />;
  const hi = max ?? (invert ? Math.max(...pts.map((p) => p[1]), 10) : 1);
  const lo = invert ? 1 : 0;
  const x = (i: number) => (i / Math.max(1, values.length - 1)) * (width - 4) + 2;
  const y = (v: number) => {
    const t = (v - lo) / Math.max(1e-9, hi - lo);
    return 2 + (invert ? t : 1 - t) * (height - 4);
  };
  const d = pts.map(([i, v], n) => `${n ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1]!;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" style={{ display: "block", overflow: "visible" }}>
      <path d={d} fill="none" stroke="var(--accent)" strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(last[0])} cy={y(last[1])} r={2.4} fill="var(--accent)" />
    </svg>
  );
}

export function Meter({ label, used, limit }: { label: string; used: number; limit: number }) {
  const f = fullness({ used, limit });
  return (
    <div className={`meter ${f}`}>
      <div className="row"><span>{label}</span><span><b>{used}</b> of {limit}</span></div>
      <div className="bar" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={limit} aria-valuenow={used}><i style={{ width: `${limit ? Math.min(100, (used / limit) * 100) : 100}%` }} /></div>
    </div>
  );
}

export function Kpi({ label, value, unit, sub, children }: { label: string; value: React.ReactNode; unit?: string; sub?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="kpi">
      <span className="l">{label}</span>
      <span className="v">{value}{unit ? <small>{unit}</small> : null}</span>
      {children}
      {sub ? <span className="s">{sub}</span> : null}
    </div>
  );
}

export function longDay(d: string | null): string {
  if (!d) return "-";
  return new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

export function fullDay(d: string | null): string {
  if (!d) return "-";
  return new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}
