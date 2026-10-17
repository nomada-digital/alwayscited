import type { Metadata } from "next";
import Link from "next/link";

import { Change, Pos, Spark, longDay } from "@/components/dash/Figures";
import { PageHead } from "@/components/dash/Shell";
import { clusterKeywords } from "@/lib/dash/model";
import { pageData } from "@/lib/dash/page-data";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Search positions", robots: { index: false, follow: false } };

export default async function Google({ params }: { params: Promise<{ client: string }> }) {
  const { client: slug } = await params;
  const { ws, base } = await pageData(slug);
  const rows = ws.clusters.flatMap((c) => clusterKeywords(c).map((k) => ({ ...k, cluster: c })));
  const tracked = rows.filter((r) => r.src === "tracked").sort((a, b) => (a.pos ?? 999) - (b.pos ?? 999));
  const also = rows.filter((r) => r.src === "footprint").sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0)).slice(0, 40);
  const host = (u: string | null) => (u ? u.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "") || "/" : "-");
  return (
    <>
      <PageHead micro={<>Search positions · Google, {ws.client.market}</>} title="Where you rank" intro="Tracked keywords are checked on Google every morning. The rest come from your monthly ranking snapshot, sorted into your keyword groups." />
      <div className="dash-card">
        <div className="dash-card-head"><div><h2>Tracked daily</h2><p className="intro">{tracked.length} keywords. Change is against 7 days ago. When Google switches which of your pages it ranks, the position can jump with it - those are marked, so a move is not mistaken for a gain or a loss.</p></div></div>
        {tracked.length ? (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>Keyword</th><th className="r">Volume</th><th className="r">Position</th><th className="r">7 days</th><th>Trend</th><th>Ranking page</th></tr></thead>
              <tbody>
                {tracked.map((k) => (
                  <tr key={k.id ?? k.keyword}>
                    <td>{k.keyword}<div className="sub"><Link href={`${base}/${slug}/clusters/${k.cluster.id}`}>{k.cluster.name}</Link>{k.group ? ` · ${k.group}` : ""}</div></td>
                    <td className="r num">{k.volume?.toLocaleString("en-GB") ?? "-"}</td>
                    <td className="r"><Pos pos={k.pos} /></td>
                    <td className="r"><Change n={k.change} /></td>
                    <td><Spark values={k.hist.map(([, p]) => p)} invert width={80} height={22} /></td>
                    <td className="muted" style={{ fontSize: 12.5, maxWidth: 260, overflowWrap: "anywhere" }}>
                      {host(k.url)}
                      {k.pageChange ? <div className="sub"><span className="pill warn" title="Google ranked a different page of your site for this keyword. The position moved with the page, not only the ranking.">Page changed {longDay(k.pageChange.on)}</span> from {k.pageChange.from}</div> : null}
                      {k.homepage && !k.pageChange ? <div className="sub">Your homepage ranks for this</div> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <div className="empty"><b>No keywords tracked</b>Add one to a cluster and it is checked from tomorrow.</div>}
      </div>
      <div className="dash-card">
        <div className="dash-card-head"><div><h2>Also ranking, in your groups</h2><p className="intro">From the ranking snapshot of {longDay(ws.footprintOn)}. Track any of them from its cluster.</p></div></div>
        {also.length ? (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>Keyword</th><th>Group</th><th className="r">Volume</th><th className="r">Position</th></tr></thead>
              <tbody>
                {also.map((k) => (
                  <tr key={`${k.cluster.id}-${k.keyword}`}><td>{k.keyword}</td><td className="muted"><Link href={`${base}/${slug}/clusters/${k.cluster.id}`}>{k.group || k.cluster.name}</Link></td><td className="r num">{k.volume?.toLocaleString("en-GB") ?? "-"}</td><td className="r"><Pos pos={k.pos} /></td></tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="faint" style={{ margin: 0 }}>Add keyword groups with words to match, and the keywords you rank for that contain them show here.</p>}
      </div>
    </>
  );
}
