import Link from "next/link";

import { Spark } from "@/components/dash/Figures";
import type { GoogleSummary } from "@/lib/dash/google-io";
import type { RawConnection } from "@/lib/dash/types";

const n = (v: number) => Math.round(v).toLocaleString("en-GB");
function change(cur: number, prev: number) {
  if (!prev) return null;
  const p = Math.round(((cur - prev) / prev) * 100);
  return <span className={p > 0 ? "up" : p < 0 ? "down" : ""}>{p > 0 ? "+" : ""}{p}% on the 28 days before</span>;
}

/**
 * The Overview's search traffic (15 Nov 2026): from Search Console and GA4 connected direct (google-io.ts), the last
 * 28 days against the 28 before, with the source named. Not connected, it is a short prompt to connect instead.
 */
export default function GoogleTraffic({ s, gsc, ga4, href, canConnect }: { s: GoogleSummary; gsc: RawConnection | null; ga4: RawConnection | null; href: string; canConnect: boolean }) {
  const direct = (c: RawConnection | null) => c?.via === "google" && c.status === "connected";
  if (!direct(gsc) && !direct(ga4)) {
    if (!canConnect) return null;
    return (
      <div className="dash-card" style={{ marginTop: 16, display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 320px" }}>
          <h2>Connect Search Console and Analytics</h2>
          <p className="intro">See your real clicks, searches and visits here, next to your AI visibility. It takes about two minutes, and it&apos;s read-only.</p>
        </div>
        <Link className="btn primary" href={href}>Connect</Link>
      </div>
    );
  }
  const g = s.gsc, a = s.ga4;
  return (
    <div className="dash-grid k2" style={{ marginTop: 16 }}>
      <div className="dash-card">
        <h2>Search Console, last 28 days</h2>
        {g ? (
          <>
            <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginTop: 10 }}>
              <div><div className="muted" style={{ fontSize: 12.5 }}>Clicks</div><b className="num" style={{ fontSize: 22 }}>{n(g.clicks)}</b><div style={{ fontSize: 12 }}>{change(g.clicks, g.prevClicks)}</div></div>
              <div><div className="muted" style={{ fontSize: 12.5 }}>Impressions</div><b className="num" style={{ fontSize: 22 }}>{n(g.impressions)}</b><div style={{ fontSize: 12 }}>{change(g.impressions, g.prevImpressions)}</div></div>
              <div><div className="muted" style={{ fontSize: 12.5 }}>Average position</div><b className="num" style={{ fontSize: 22 }}>{g.position ?? "-"}</b></div>
            </div>
            <div style={{ marginTop: 10 }}><Spark values={g.days.map((d) => d.clicks)} max={Math.max(1, ...g.days.map((d) => d.clicks))} width={260} height={32} /></div>
            {g.queries.length ? (
              <table style={{ width: "100%", fontSize: 12.5, marginTop: 12 }}>
                <thead><tr><th style={{ textAlign: "left" }}>Top searches</th><th className="r">Clicks</th><th className="r">Impr.</th><th className="r">Pos.</th></tr></thead>
                <tbody>{g.queries.map((q) => <tr key={q.query}><td style={{ wordBreak: "break-word" }}>{q.query}</td><td className="r num">{n(q.clicks)}</td><td className="r num">{n(q.impressions)}</td><td className="r num">{q.position ?? "-"}</td></tr>)}</tbody>
              </table>
            ) : null}
          </>
        ) : <p className="muted" style={{ fontSize: 13 }}>{direct(gsc) ? "Connected. Your first numbers are on their way." : "Not connected."}</p>}
        <p className="faint" style={{ fontSize: 12, margin: "10px 0 0" }}>Source: Google Search Console, read direct{gsc?.last_synced_at ? `, ${gsc.last_synced_at.slice(0, 10)}` : ""}.</p>
      </div>
      <div className="dash-card">
        <h2>Visits, last 28 days</h2>
        {a ? (
          <>
            <div style={{ marginTop: 10 }}><div className="muted" style={{ fontSize: 12.5 }}>Sessions</div><b className="num" style={{ fontSize: 22 }}>{n(a.sessions)}</b><div style={{ fontSize: 12 }}>{change(a.sessions, a.prevSessions)}</div></div>
            <table style={{ width: "100%", fontSize: 12.5, marginTop: 12 }}>
              <thead><tr><th style={{ textAlign: "left" }}>Channel</th><th className="r">Sessions</th></tr></thead>
              <tbody>{a.channels.slice(0, 6).map((c) => <tr key={c.channel}><td>{c.channel}</td><td className="r num">{n(c.sessions)}</td></tr>)}</tbody>
            </table>
            {a.pages.length ? (
              <table style={{ width: "100%", fontSize: 12.5, marginTop: 12 }}>
                <thead><tr><th style={{ textAlign: "left" }}>Top pages from search{a.month ? `, ${a.month.slice(0, 7)}` : ""}</th><th className="r">Sessions</th><th className="r">Key events</th></tr></thead>
                <tbody>{a.pages.slice(0, 6).map((p) => <tr key={p.page}><td style={{ wordBreak: "break-all" }}>{p.page}</td><td className="r num">{n(p.sessions)}</td><td className="r num">{n(p.keyEvents)}</td></tr>)}</tbody>
              </table>
            ) : null}
            {a.events.length ? <p className="muted" style={{ fontSize: 12.5, margin: "10px 0 0" }}>Key events{a.month ? ` in ${a.month.slice(0, 7)}` : ""}: {a.events.slice(0, 4).map((e) => `${e.name} ${n(e.count)}`).join(", ")}</p> : null}
          </>
        ) : <p className="muted" style={{ fontSize: 13 }}>{direct(ga4) ? "Connected. Your first numbers are on their way." : <>Not connected. <Link href={href}>Connect GA4</Link></>}</p>}
        <p className="faint" style={{ fontSize: 12, margin: "10px 0 0" }}>Source: Google Analytics 4, read direct{ga4?.last_synced_at ? `, ${ga4.last_synced_at.slice(0, 10)}` : ""}.</p>
      </div>
    </div>
  );
}
