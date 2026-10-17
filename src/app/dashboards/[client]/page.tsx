import type { Metadata } from "next";
import Link from "next/link";

import { Change, EngineHeads, Kpi, Pos, Rate, Spark, longDay, pct } from "@/components/dash/Figures";
import PlanCard from "@/components/dash/PlanCard";
import { PageHead } from "@/components/dash/Shell";
import { fullness } from "@/lib/dash/allowance";
import { clusterKeywords } from "@/lib/dash/model";
import { pageData } from "@/lib/dash/page-data";
import { checkTime, nextCheckAt } from "@/lib/tracking/check-time";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Overview", robots: { index: false, follow: false } };

/** The next daily check, in the client's zone. Read off the clock, so kept out of the component's render. */
function nextCheckLabel(market: string): string {
  return checkTime(new Date(nextCheckAt(Date.now())).toISOString().slice(0, 10), market);
}

export default async function Overview({ params }: { params: Promise<{ client: string }> }) {
  const { client: slug } = await params;
  const { ws, base } = await pageData(slug);
  const tracked = ws.clusters.flatMap((c) => clusterKeywords(c)).filter((k) => k.src === "tracked");
  const ranked = tracked.filter((k) => k.pos !== null);
  const top10 = ranked.filter((k) => (k.pos ?? 99) <= 10).length;
  const cites = ws.sources.find((s) => s.you);
  const full = (["clusters", "keywords", "prompts"] as const).filter((k) => fullness(ws.allowances[k]) !== "calm");
  const first = ws.rateTrend.find((r) => r !== null) ?? null;
  const delta = ws.rate !== null && first !== null ? Math.round((ws.rate - first) * 100) : null;
  // When the next reading lands, in the client's own zone - so an edit made now has a time it shows up by.
  const tracking = ws.clusters.some((c) => c.prompts > 0) || ws.loose.prompts.length > 0;
  const next = tracking ? nextCheckLabel(ws.client.market) : null;
  return (
    <>
      <PageHead
        micro={<>Overview{ws.lastRun ? <> · last check {longDay(ws.lastRun.run_date)}</> : null}{next ? <> · next {next}</> : null}<EngineHeads engines={ws.engines} /></>}
        title={ws.client.brand ?? ws.client.domain}
        intro="Whether AI names you when buyers ask, and where you rank on Google for the same searches - checked every morning."
      />
      {full.length ? (
        <div className="banner" style={{ marginBottom: 16 }}>
          <span><b>{full.map((k) => `${ws.allowances[k].used} of ${ws.allowances[k].limit} ${k}`).join(", ")}</b> in use. Add a tracking pack, or move up a plan, before you run out.</span>
          <Link className="btn sm primary" href={`${base}/${slug}/plan`}>See options</Link>
        </div>
      ) : null}
      <div className="dash-grid k4">
        <Kpi label="AI names you" value={pct(ws.rate)} sub={delta !== null && ws.dates.length > 1 ? <span className={delta > 0 ? "up" : delta < 0 ? "down" : ""}>{delta > 0 ? "+" : ""}{delta} pts over {ws.dates.length} readings</span> : "Answers naming you, latest reading"}>
          <Spark values={ws.rateTrend} width={120} />
        </Kpi>
        <Kpi label="Keywords on page 1" value={top10} unit={`of ${tracked.length}`} sub={ranked.length ? `${ranked.length} ranking in the top 100` : "Tracked keywords, Google, today"} />
        <Kpi label="Clusters" value={ws.allowances.clusters.used} unit={`of ${ws.allowances.clusters.limit}`} sub={`${ws.clusters.reduce((n, c) => n + c.groups.length, 0)} keyword groups`} />
        <Kpi label="AI cites your site" value={cites ? cites.answers : 0} unit="answers" sub="Last 7 readings, any engine" />
      </div>
      <div className="dash-grid side" style={{ marginTop: 16 }}>
        <div className="dash-card">
          <div className="dash-card-head">
            <div><h2>Clusters</h2><p className="intro">Each keyword you are working on, and how it is doing in both places.</p></div>
            <Link className="btn" href={`${base}/${slug}/clusters`}>Manage</Link>
          </div>
          {ws.clusters.length ? (
            <div className="tbl-wrap">
              <table className="tbl">
                <thead><tr><th>Cluster</th><th className="r">Google</th><th className="r">7 days</th><th>AI names you</th><th aria-label="Trend" /></tr></thead>
                <tbody>
                  {ws.clusters.map((c) => (
                    <tr key={c.id}>
                      <td><Link href={`${base}/${slug}/clusters/${c.id}`}>{c.name}</Link><div className="sub">{c.groups.length ? `${c.groups.length} groups · ` : ""}{c.trackedKeywords} keywords · {c.prompts} prompts</div></td>
                      <td className="r"><Pos pos={c.headPos} /></td>
                      <td className="r"><Change n={c.headChange} /></td>
                      <td><Rate r={c.rate} /></td>
                      <td><Spark values={c.rateTrend} width={72} height={22} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty"><b>No clusters yet</b><Link className="btn primary" href={`${base}/${slug}/clusters`}>Add your first</Link></div>
          )}
        </div>
        <div className="dash-stack">
          <PlanCard ws={ws} slug={slug} base={base} />
          <div className="dash-card">
            <h2>Named instead of you</h2>
            <p className="intro">Brands the engines recommend most, last 7 readings.</p>
            <ol style={{ margin: "12px 0 0", padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 6 }}>
              {ws.brands.slice(0, 6).map((b, i) => (
                <li key={b.name} style={{ display: "flex", gap: 10, fontSize: 13.5, fontWeight: b.you ? 700 : 500, color: b.you ? "var(--accent)" : undefined }}>
                  <span className="faint num" style={{ width: 16 }}>{i + 1}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>{b.name}{b.you ? " (you)" : ""}</span>
                  <span className="muted num">{b.answers}</span>
                </li>
              ))}
              {!ws.brands.length ? <li className="faint">No answers read yet.</li> : null}
            </ol>
            <Link className="btn ghost sm" style={{ marginTop: 10, marginLeft: -8 }} href={`${base}/${slug}/ai`}>All AI answers →</Link>
          </div>
        </div>
      </div>
    </>
  );
}
