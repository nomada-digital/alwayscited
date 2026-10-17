import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import TierName from "@/components/TierName";
import { Change, Pos, Rate, Spark, fullDay, pct } from "@/components/dash/Figures";
import { PageHead } from "@/components/dash/Shell";
import { CONTACT_EMAIL } from "@/config/contact";
import { pageData } from "@/lib/dash/page-data";
import { deliverables, delivered, tierInfo } from "@/lib/dash/plan";
import type { ClusterView, Workspace } from "@/lib/dash/types";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Your plan's clusters", robots: { index: false, follow: false } };

/**
 * The clusters we work on (17 Oct 2026; Danny: "a dedicated tab: alwayscited,
 * then Cluster 1, Cluster 2"). Paid plans only. Each managed cluster says
 * what the plan delivers on it each month, what has been delivered this
 * month, and what has moved since we started; the clusters the client only
 * tracks are listed apart, so which is which is never a question.
 */
export default async function Managed({ params }: { params: Promise<{ client: string }> }) {
  const { client: slug } = await params;
  const { ws, base } = await pageData(slug);
  // A tracking plan has no clusters we work on: its plan page says what does.
  if (ws.client.tier === "tracked") redirect(`${base}/${slug}/plan`);
  const managed = ws.clusters.filter((c) => c.managed);
  const trackedOnly = ws.clusters.filter((c) => !c.managed);
  const sample = managed.some((c) => c.placements.some((p) => p.sample));
  return (
    <>
      <PageHead
        micro={<>Your plan · <TierName tier={ws.client.tier} /></>}
        title={<>The clusters we work on</>}
        intro={<>{tierInfo(ws.client.tier).positioning}. Each cluster below is one we work on every month; this page shows what the plan delivers on it, what we have delivered so far this month, and what has moved since we started.</>}
      />
      {sample ? <div className="banner warn" style={{ marginBottom: 16 }}><span><b>Demo:</b> the placements on this page are sample rows, to show how delivery is reported. They are not real work.</span></div> : null}
      {!managed.length ? (
        <div className="dash-card empty">
          <b>No cluster is set up for us to work on yet</b>
          We set your plan&rsquo;s cluster up with you at the start. If that has not happened, email us and we will do it this week.
          <div><a className="btn primary" style={{ marginTop: 14 }} href={`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(`Set up my managed cluster - ${ws.client.domain}`)}`}>Email us</a></div>
        </div>
      ) : (
        managed.map((c, i) => <ManagedCluster key={c.id} ws={ws} c={c} n={i + 1} href={`${base}/${slug}/clusters/${c.id}`} />)
      )}
      <div className="dash-card">
        <h2>Changing a cluster we work on</h2>
        <p className="intro" style={{ maxWidth: 720 }}>
          Each month&rsquo;s placements are built around the cluster keyword, so the keyword itself changes on request and takes effect from your next billing date - the month&rsquo;s work in progress is finished first. Inside the cluster you can change groups, keywords and prompts whenever you like; they are read from the next morning. Clusters you only track can be added, swapped and removed freely, within your allowance.
        </p>
      </div>
      {trackedOnly.length ? (
        <div className="dash-card">
          <h2>Tracked only</h2>
          <p className="intro">Measured every day, and yours to change at any time. We do not place for these.</p>
          <div className="tbl-wrap" style={{ marginTop: 10 }}>
            <table className="tbl">
              <thead><tr><th>Cluster</th><th className="r">Google</th><th>AI names you</th></tr></thead>
              <tbody>
                {trackedOnly.map((c) => (
                  <tr key={c.id}><td><Link href={`${base}/${slug}/clusters/${c.id}`}>{c.name}</Link></td><td className="r"><Pos pos={c.headPos} /></td><td><Rate r={c.rate} /></td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </>
  );
}

function ManagedCluster({ ws, c, n, href }: { ws: Workspace; c: ClusterView; n: number; href: string }) {
  const monthStart = `${ws.today.slice(0, 7)}-01`;
  const list = deliverables(ws.client.tier);
  const moved = c.startPos !== null && c.headPos !== null ? c.startPos - c.headPos : null;
  const swap = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(`Swap cluster ${n} (${c.name}) - ${ws.client.domain}`)}`;
  return (
    <section className="dash-card" aria-label={`Cluster ${n}: ${c.name}`}>
      <div className="dash-card-head">
        <div>
          <div className="dash-micro">Cluster {n} · <span className="pill accent">Managed by us</span></div>
          <h2 style={{ marginTop: 6 }}><Link href={href} style={{ color: "inherit", textDecoration: "none" }}>{c.name}</Link></h2>
          <p className="intro">Since {fullDay(c.startedOn)}{c.headKeyword ? <> · keyword <b>{c.headKeyword}</b></> : null}</p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link className="btn" href={href}>Groups, keywords and prompts</Link>
          <a className="btn ghost" href={swap}>Ask to swap</a>
        </div>
      </div>
      <h3 className="dash-micro" style={{ margin: "4px 0 8px" }}>This month</h3>
      <div className="deliv">
        {list.map((d) => {
          const got = delivered(d, c.placements, monthStart);
          const share = got && d.target ? Math.min(1, got.live / d.target) : null;
          return (
            <div key={d.key}>
              <div className="l">{d.label}</div>
              {got ? (
                <>
                  <div className="v">{got.live}{d.target ? <span className="muted" style={{ fontSize: 14, fontWeight: 600 }}> of {d.target}{d.unit.startsWith("or more") ? "+" : ""}</span> : <span className="muted" style={{ fontSize: 14, fontWeight: 600 }}> done</span>}</div>
                  {share !== null ? <div className="meter" style={{ marginTop: 6 }}><div className="bar"><i style={{ width: `${share * 100}%` }} /></div></div> : null}
                  <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{got.inFlight ? `${got.inFlight} in progress` : got.live ? "live this month" : "starts this month"}</div>
                </>
              ) : (
                <div style={{ fontSize: 13, marginTop: 4 }}>Included each month</div>
              )}
            </div>
          );
        })}
      </div>
      <h3 className="dash-micro" style={{ margin: "18px 0 8px" }}>Since we started</h3>
      <div className="cl-stats" style={{ marginTop: 0 }}>
        <div><span className="l">Google, cluster keyword</span><span className="v" style={{ display: "flex", gap: 6, alignItems: "center" }}>{c.startPos !== null ? <><span className="muted" style={{ fontSize: 13 }}>{c.startPos} →</span></> : null}<Pos pos={c.headPos} />{moved ? <Change n={moved} /> : null}</span></div>
        <div><span className="l">AI names you</span><span className="v" style={{ fontSize: 16 }}>{pct(c.startRate)} → {pct(c.rate)}</span></div>
        <div><span className="l">Placements live</span><span className="v">{c.placements.filter((p) => p.status === "live").length}</span></div>
        <div><span className="l">AI answers citing them, 7 days</span><span className="v">{c.placementCitations}</span></div>
        <div style={{ marginLeft: "auto" }}><Spark values={c.rateTrend} width={120} /></div>
      </div>
      {c.placements.length ? (
        <div className="tbl-wrap" style={{ marginTop: 14 }}>
          <table className="tbl">
            <thead><tr><th>Placement</th><th>Kind</th><th>Status</th><th className="r">Live</th></tr></thead>
            <tbody>
              {c.placements.map((p) => (
                <tr key={p.id}>
                  <td>{p.sample ? <span>{p.domain} <span className="pill sample">Sample</span></span> : <a href={p.url} target="_blank" rel="noopener noreferrer">{p.domain}</a>}{p.anchor_text ? <div className="sub">Anchor: {p.anchor_text}</div> : null}</td>
                  <td>{p.kind.replace("_", " ")}</td>
                  <td><span className={`pill${p.status === "live" ? " good" : ""}`}>{p.status}</span></td>
                  <td className="r num">{p.live_on ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="muted" style={{ margin: "12px 0 0", fontSize: 12.5 }}>Placements show here from the day each is pitched.</p>}
    </section>
  );
}
