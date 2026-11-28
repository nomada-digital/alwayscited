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
 * The Overview's search traffic (16 Nov 2026): Search Console clicks and impressions, the last 28 days against the
 * 28 before, with the source named - the traffic figure Danny wants in place of the DataForSEO estimates. Not
 * connected, a short prompt to connect it instead.
 */
export default function GoogleTraffic({ s, gsc, href, canConnect, beta = false }: { s: GoogleSummary; gsc: RawConnection | null; href: string; canConnect: boolean; beta?: boolean }) {
  const connected = gsc?.via === "google" && gsc.status === "connected";
  if (!connected) {
    if (!canConnect) return null;
    return (
      <div className="dash-card" style={{ marginTop: 16, display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 320px" }}>
          <h2>Connect Google Search Console</h2>
          <p className="intro">See your real clicks and searches here, next to your AI visibility. Sign in with Google, pick your site, done. It&apos;s read-only.</p>
        </div>
        <Link className="btn primary" href={href}>Connect</Link>
      </div>
    );
  }
  const g = s.gsc;
  return (
    <div className="dash-card" style={{ marginTop: 16 }}>
      <h2>Search Console, last 28 days</h2>
      {g ? (
        <div className="dash-grid k2" style={{ marginTop: 6 }}>
          <div>
            <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginTop: 6 }}>
              <div><div className="muted" style={{ fontSize: 12.5 }}>Clicks</div><b className="num" style={{ fontSize: 22 }}>{n(g.clicks)}</b><div style={{ fontSize: 12 }}>{change(g.clicks, g.prevClicks)}</div></div>
              <div><div className="muted" style={{ fontSize: 12.5 }}>Impressions</div><b className="num" style={{ fontSize: 22 }}>{n(g.impressions)}</b><div style={{ fontSize: 12 }}>{change(g.impressions, g.prevImpressions)}</div></div>
              <div><div className="muted" style={{ fontSize: 12.5 }}>Average position</div><b className="num" style={{ fontSize: 22 }}>{g.position ?? "-"}</b></div>
            </div>
            <div style={{ marginTop: 10 }}><Spark values={g.days.map((d) => d.clicks)} max={Math.max(1, ...g.days.map((d) => d.clicks))} width={260} height={32} /></div>
          </div>
          {g.queries.length ? (
            <table style={{ width: "100%", fontSize: 12.5 }}>
              <thead><tr><th style={{ textAlign: "left" }}>Top searches</th><th className="r">Clicks</th><th className="r">Impr.</th><th className="r">Pos.</th></tr></thead>
              <tbody>{g.queries.map((q) => <tr key={q.query}><td style={{ wordBreak: "break-word" }}>{q.query}</td><td className="r num">{n(q.clicks)}</td><td className="r num">{n(q.impressions)}</td><td className="r num">{q.position ?? "-"}</td></tr>)}</tbody>
            </table>
          ) : <div />}
        </div>
      ) : <p className="muted" style={{ fontSize: 13 }}>Connected. Your first numbers are on their way.</p>}
      <p className="faint" style={{ fontSize: 12, margin: "10px 0 0" }}>Source: Google Search Console{beta ? "" : gsc?.google_email ? `, connected as ${gsc.google_email}` : ""}{gsc?.last_synced_at ? `, last sync ${gsc.last_synced_at.slice(0, 10)}` : ""}.</p>
    </div>
  );
}
