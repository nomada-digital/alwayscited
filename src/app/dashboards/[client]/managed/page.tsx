import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import TierName from "@/components/TierName";
import { Change, Pos, Rate, Spark, TargetPage, fullDay, pct } from "@/components/dash/Figures";
import { PageHead } from "@/components/dash/Shell";
import WorkCompleted from "@/components/dash/WorkCompleted";
import PlanControls from "@/components/dash/PlanControls";
import { CONTACT_EMAIL } from "@/config/contact";
import { pageData } from "@/lib/dash/page-data";
import { deliverables, delivered, tierInfo } from "@/lib/dash/plan";
import { money, monthDay, nextMonthStart } from "@/lib/dash/plan-change";
import { priceFor } from "@/lib/dash/plan-requests";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { readWork } from "@/lib/dash/work";
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
const one = (v: string | string[] | undefined, max = 120) => (typeof v === "string" && v.length <= max ? v : undefined);

export default async function Managed({ params, searchParams }: { params: Promise<{ client: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { client: slug } = await params;
  const sp = await searchParams;
  const { ws, base, raw, demo, viewAs } = await pageData(slug);
  // A tracking plan has no clusters we work on: its plan page says what does.
  if (ws.client.tier === "tracked") redirect(`${base}/${slug}/plan`);
  // sg-35: the hub's record of work done, for the customer and the hub's view-as; never on a demo link (work.ts).
  const work = demo && !viewAs ? [] : await readWork(raw.client.id);
  const managed = ws.clusters.filter((c) => c.managed);
  const trackedOnly = ws.clusters.filter((c) => !c.managed);
  const sample = managed.some((c) => c.placements.some((p) => p.sample));
  // 7 Nov 2026: what one more plan cluster adds, from the sector table or the customer's own order; never on a demo.
  const price = demo ? null : await priceFor(supabaseAdmin(), raw).catch(() => null);
  const nameOf = (id: string) => raw.clusters.find((c) => c.id === id)?.name ?? "a cluster";
  const req = raw.planRequests;
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
      <WorkCompleted items={work} base={base} slug={slug} />
      <PlanControls
        slug={slug}
        owner={ws.role === "owner"}
        readOnly={demo || !!viewAs}
        plan={ws.client.tier}
        managed={managed.map((c) => ({ id: c.id, name: c.name }))}
        trackingOnly={trackedOnly.map((c) => ({ id: c.id, name: c.name }))}
        effective={monthDay(nextMonthStart(ws.today))}
        price={price ? money(price.amount, price.currency) : null}
        swap={req?.swap ? { id: req.swap.id, from: nameOf(req.swap.from_cluster_id), to: nameOf(req.swap.to_cluster_id), on: monthDay(req.swap.effective_on) } : null}
        upgrades={(req?.upgrades ?? []).map((u) => ({ id: u.id, what: u.cluster_id ? nameOf(u.cluster_id) : (u.keyword ?? "a cluster"), price: money(u.price_amount, u.currency), on: monthDay(u.created_at.slice(0, 10)) }))}
        start={{ swap: one(sp.swap, 64), swapKeyword: one(sp.swapKeyword), add: one(sp.add, 64), addKeyword: one(sp.addKeyword) }}
      />
      <div className="dash-card">
        <h2>Changing a cluster we work on</h2>
        <p className="intro" style={{ maxWidth: 720 }}>
          Inside a cluster we work on you can change groups, keywords and prompts whenever you like; they are read from the next morning. The cluster keyword itself is what each month&rsquo;s placements are built around, so it changes by a swap, above, from the 1st of next month. Clusters you only track can be added and removed freely, within your allowance.
        </p>
      </div>
      {trackedOnly.length ? (
        <div className="dash-card">
          <h2>Tracking only</h2>
          <p className="intro">Not part of your <TierName tier={ws.client.tier} /> plan: measured every day, free within your allowance, and yours to change at any time. We do not place for these. Swap one in, or add it to your plan, above.</p>
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
  const list = deliverables(ws.client.tier, ws.client.excluded_deliverables);
  const moved = c.startPos !== null && c.headPos !== null ? c.startPos - c.headPos : null;
  return (
    <section className="dash-card" aria-label={`Cluster ${n}: ${c.name}`}>
      <div className="dash-card-head">
        <div>
          <div className="dash-micro">Cluster {n} · <span className="pill accent">Managed by us</span></div>
          <h2 style={{ marginTop: 6 }}><Link href={href} style={{ color: "inherit", textDecoration: "none" }}>{c.name}</Link></h2>
          <p className="intro">Since {fullDay(c.startedOn)}{c.headKeyword ? <> · keyword <b>{c.headKeyword}</b></> : null}</p>
          {/* 18 Oct 2026: the page this cluster's placements point at (target.ts). */}
          <p className="intro" style={{ marginTop: 2 }}><TargetPage url={c.target} /></p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link className="btn" href={href}>Groups, keywords and prompts</Link>
          <a className="btn ghost" href="#swap">Swap it</a>
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
