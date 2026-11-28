import Link from "next/link";

import EngineLogo from "@/components/EngineLogo";
import { ENGINE_SPECS, type Engine } from "@/lib/scan/engines";
import { fullness } from "@/lib/dash/allowance";
import { targetLabel } from "@/lib/dash/target";
import { consoleFallback } from "@/lib/dash/console-fallback";

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
  // Never a bare "-" (Danny, 15 Nov 2026): a missing position says what it means.
  if (pos === null) return <span className="pos none" style={{ fontSize: 12 }} title="Google was read and your site is not in its top 100 for this search">Not in top 100</span>;
  return <span className={`pos ${pos <= 3 ? "top3" : pos <= 10 ? "top10" : ""}`}>{pos}</span>;
}

/** The note under a position our two ranking sources read differently (lib/tracking/crosscheck.ts). */
export const VARIES_NOTE = "Google results vary by day";
export function VariesNote() {
  return <div className="faint" style={{ fontSize: 11.5 }} title="Our two ranking sources read this search differently. This is the position the evidence supports best.">{VARIES_NOTE}</div>;
}

/** The days a Search Console figure averages, "30 Oct to 26 Nov", or null when the figure carries none. */
export function consoleRange(g: { from?: string; to?: string } | null | undefined): string | null {
  return g?.from && g?.to ? `${longDay(g.from)} to ${longDay(g.to)}` : null;
}

/** Search Console's average position, labelled as such with the days it covers (27 Nov 2026, Danny: keep the label, add the date range). */
export function ConsolePos({ pos, range }: { pos: number; range?: string | null }) {
  return (
    <>
      <span className={`pos ${pos <= 3 ? "top3" : pos <= 10 ? "top10" : ""}`}>{pos}</span>
      <div className="faint" style={{ fontSize: 11.5 }} title={`Google's average position for this search and page${range ? `, ${range}` : " over the last 28 days"}, from your Search Console. Shown because today's live reading failed or disagreed.`}>Search Console average{range ? `, ${range}` : ""}</div>
    </>
  );
}

/**
 * What a keyword's latest reading says about the client beyond its own site's position (27 Nov 2026, Danny): named in the AI Overview,
 * or listed on a third-party page in the top 10 (the craftcms.com partner page for COMMON). Kept apart from the position, which is
 * only ever the client's own domain, so the numbers stay honest and the visibility is still visible.
 */
export function Visibility({ aio, listed }: { aio?: { shown: boolean; named: boolean } | null; listed?: { rank: number; domain: string; url: string | null }[] }) {
  const l = listed?.[0];
  if (!aio?.named && !l) return null;
  return (
    <div style={{ display: "flex", gap: 4, flexWrap: "wrap", justifyContent: "flex-end", marginTop: 4 }}>
      {aio?.named ? <span className="pill good" style={{ fontSize: 11 }} title="Google's AI Overview for this search names you or cites your site. This is not a position.">Named in AI Overview</span> : null}
      {l ? <span className="pill accent" style={{ fontSize: 11 }} title={`A page on ${l.domain} that names you is #${l.rank} in Google for this search. It is not your own site's position.${l.url ? ` ${l.url}` : ""}`}>Listed via {l.domain} (#{l.rank})</span> : null}
    </div>
  );
}

/**
 * A tracked keyword's Google figure. A read that failed today says so ("Couldn't read today", with the last reading beneath) rather
 * than showing yesterday's position or "Not in top 100"; "Not in top 100" is only ever a read that worked and did not find the site.
 */
export function PositionCell(p: { pos: number | null; read: boolean; varies?: boolean; stale?: boolean; readOn?: string | null; place?: string | null; gsc?: { pos: number | null; impr: number; from?: string; to?: string } | null; aio?: { shown: boolean; named: boolean } | null; listed?: { rank: number; domain: string; url: string | null }[] }) {
  const fb = consoleFallback({ pos: p.pos, read: p.read, varies: p.varies || p.stale, gsc: p.gsc });
  const range = consoleRange(p.gsc);
  let main: React.ReactNode;
  if (p.stale) {
    main = (
      <>
        <span className="muted" style={{ fontSize: 12.5 }} title="Google could not be read for this search on the latest check, so no position is shown for today.">Couldn&apos;t read today</span>
        {p.readOn ? <div className="faint" style={{ fontSize: 11.5 }}>Last read {longDay(p.readOn)}: {p.pos === null ? "not in top 100" : `#${p.pos}`}</div> : null}
        {fb !== null ? <div style={{ marginTop: 4 }}><ConsolePos pos={fb} range={range} /></div> : null}
      </>
    );
  } else if (fb !== null) main = <ConsolePos pos={fb} range={range} />;
  else if (p.pos !== null) main = <><Pos pos={p.pos} />{p.varies ? <VariesNote /> : null}</>;
  else if (p.read) main = <span className="muted" style={{ fontSize: 12.5 }} title="Google was read and your site is not in its top 100 for this search">Not in top 100</span>;
  else main = <span className="faint" style={{ fontSize: 12.5 }}>Not read yet</span>;
  return (
    <>
      {main}
      {p.place && p.read ? <div className="faint" style={{ fontSize: 11.5 }} title={`Read as a searcher in ${p.place}, because the search names it.`}>Read for {p.place}</div> : null}
      <Visibility aio={p.aio} listed={p.listed} />
    </>
  );
}

/** A tracked keyword's Google slot: its position (with the note when the sources disagreed), else what is known. */
export function GooglePos({ pos, read, varies, gsc }: { pos: number | null; read: boolean; varies?: boolean; gsc?: { pos: number | null; impr: number; from?: string; to?: string } | null }) {
  const fb = consoleFallback({ pos, read, varies, gsc });
  if (fb !== null) return <ConsolePos pos={fb} range={consoleRange(gsc)} />;
  if (pos !== null) return <><Pos pos={pos} />{varies ? <VariesNote /> : null}</>;
  if (read) return <Pos pos={null} />;
  return <span className="faint" style={{ fontSize: 12 }}>Not read yet</span>;
}

/** A cluster's target page (target.ts): the page placements point at, or a plain "not chosen yet". */
export function TargetPage({ url, prefix = "Target page" }: { url: string | null; prefix?: string }) {
  if (!url) return <span className="faint">{prefix}: not chosen yet</span>;
  return <span>{prefix}: <a href={url} target="_blank" rel="noopener noreferrer">{targetLabel(url)}</a></span>;
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
export function Spark({ values, width = 96, height = 26, invert = false, max, fluid = false }: { values: (number | null)[]; width?: number; height?: number; invert?: boolean; max?: number; fluid?: boolean }) {
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
    <svg width={fluid ? "100%" : width} height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio={fluid ? "none" : undefined} aria-hidden="true" style={{ display: "block", overflow: "visible" }}>
      <path d={d} fill="none" stroke="var(--accent)" strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
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

/** A headline figure. With `href` the whole tile opens the page behind the figure (7 Nov 2026). */
export function Kpi({ label, value, unit, sub, children, href }: { label: string; value: React.ReactNode; unit?: string; sub?: React.ReactNode; children?: React.ReactNode; href?: string }) {
  const body = (
    <>
      <span className="l">{label}</span>
      <span className="v">{value}{unit ? <small>{unit}</small> : null}</span>
      {children}
      {sub ? <span className="s">{sub}</span> : null}
    </>
  );
  return href ? <Link className="kpi" href={href}>{body}</Link> : <div className="kpi">{body}</div>;
}

/** The plan's shared allowance in one line (Danny, 7 Nov 2026): "5 of 50 prompts · 1 of 10 clusters". */
export function LimitsLine({ a }: { a: { prompts: { used: number; limit: number }; clusters: { used: number; limit: number } } }) {
  return (
    <span className="limits" title="Your plan's allowance, shared across every cluster">
      <b>{a.prompts.used}</b> of {a.prompts.limit} prompts · <b>{a.clusters.used}</b> of {a.clusters.limit} clusters
    </span>
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
