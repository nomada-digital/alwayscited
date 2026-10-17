import TierName from "@/components/TierName";
import { SITE_ORIGIN } from "@/lib/app-host";
import { deliverables, delivered, nextTier, tierInfo } from "@/lib/dash/plan";
import type { ClusterView, Workspace } from "@/lib/dash/types";

/** The plan the client is on and what it delivers, from pricing.ts (17 Oct 2026). */
export default function PlanCard({ ws, slug, base }: { ws: Workspace; slug: string; base: string }) {
  const t = ws.client.tier;
  const info = tierInfo(t);
  const up = nextTier(t);
  const trial = ws.client.trial_ends_at && !ws.client.payment_status ? ws.client.trial_ends_at.slice(0, 10) : null;
  return (
    <div className="dash-card">
      <div className="dash-micro">Your plan</div>
      <div style={{ fontSize: 22, letterSpacing: "-0.025em", marginTop: 4 }}><TierName tier={t} /></div>
      <p className="intro" style={{ marginTop: 2 }}>{info.positioning}{trial ? ` · trial until ${new Date(`${trial}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long" })}` : ""}</p>
      <ul style={{ margin: "12px 0 0", padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 5, fontSize: 13 }}>
        {info.includes.map((x) => <li key={x}><span style={{ color: "var(--accent)", fontWeight: 700, marginRight: 6 }}>✓</span>{x}</li>)}
      </ul>
      <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
        <a className="btn" href={`${base}/${slug}/plan`}>Plan and allowances</a>
      </div>
      {up ? (
        <p className="intro" style={{ marginTop: 14 }}>
          Next up: <TierName tier={up} /> - {tierInfo(up).positioning.toLowerCase()}. <a href={`${SITE_ORIGIN}${tierInfo(up).href}`} style={{ color: "var(--accent)", fontWeight: 600 }}>See what it adds</a>
        </p>
      ) : null}
    </div>
  );
}

/** This month's delivery on one cluster, for the paid tiers; tracking-only says so and offers the next step. */
export function Delivery({ ws, cluster }: { ws: Workspace; cluster: ClusterView }) {
  const list = deliverables(ws.client.tier);
  const monthStart = `${ws.today.slice(0, 7)}-01`;
  if (!list.length) {
    return (
      <div className="dash-card">
        <div className="dash-card-head">
          <div>
            <h2>What your plan does on this cluster</h2>
            <p className="intro"><TierName tier="tracked" /> measures it every day: Google positions and whether AI names you. Placements and link insertions start on <TierName tier="mentioned" />.</p>
          </div>
          <a className="btn" href={`${SITE_ORIGIN}${tierInfo("mentioned").href}`}>How placements work</a>
        </div>
      </div>
    );
  }
  return (
    <div className="dash-card">
      <div className="dash-card-head">
        <div>
          <h2>This month on this cluster</h2>
          <p className="intro">What <TierName tier={ws.client.tier} /> delivers each month on a worked cluster, and where it stands.</p>
        </div>
      </div>
      <div className="deliv">
        {list.map((d) => {
          const got = delivered(d, cluster.placements, monthStart);
          return (
            <div key={d.key}>
              <div className="l">{d.label}</div>
              {got ? (
                <>
                  <div className="v">{got.live}<span className="muted" style={{ fontSize: 14, fontWeight: 600 }}> of {d.target}{d.unit.startsWith("or more") ? "+" : ""}</span></div>
                  <div className="faint" style={{ fontSize: 12 }}>{got.inFlight ? `${got.inFlight} in progress` : "live this month"}</div>
                </>
              ) : (
                <div style={{ fontSize: 13, marginTop: 4 }}>Included</div>
              )}
            </div>
          );
        })}
      </div>
      {cluster.placements.length ? (
        <div className="tbl-wrap" style={{ marginTop: 14 }}>
          <table className="tbl">
            <thead><tr><th>Placement</th><th>Kind</th><th>Status</th><th className="r">Live</th></tr></thead>
            <tbody>
              {cluster.placements.map((p) => (
                <tr key={p.id}>
                  <td><a href={p.url} target="_blank" rel="noopener noreferrer">{p.domain}</a>{p.anchor_text ? <div className="sub">Anchor: {p.anchor_text}</div> : null}</td>
                  <td>{p.kind.replace("_", " ")}</td>
                  <td><span className={`pill${p.status === "live" ? " good" : ""}`}>{p.status}</span></td>
                  <td className="r num">{p.live_on ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="faint" style={{ margin: "12px 0 0", fontSize: 12.5 }}>No placements on this cluster yet. Each one shows here from the day it is pitched.</p>}
    </div>
  );
}
