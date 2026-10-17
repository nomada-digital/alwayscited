import type { Metadata } from "next";

import GuideBox from "@/components/dash/GuideBox";
import { PageHead } from "@/components/dash/Shell";
import { ROUTE_GUIDES } from "@/config/guidance";
import { pageData } from "@/lib/dash/page-data";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Opportunities", robots: { index: false, follow: false } };

const ROUTES: Record<string, [string, string]> = {
  ask_added: ["Ask to be added", "An independent list the engines read that leaves you out."],
  offer_resource: ["Offer a resource", "A page the engines cite where a useful addition from you fits."],
  get_listed: ["Get listed", "A directory or review profile the engines read."],
  answer_thread: ["Answer the thread", "A forum or community thread the engines cite."],
  publish_own: ["Publish on your own site", "A question nobody answers well yet."],
};

export default async function Opportunities({ params }: { params: Promise<{ client: string }> }) {
  const { client: slug } = await params;
  const { ws } = await pageData(slug);
  const groups = new Map<string, typeof ws.opportunities>();
  for (const o of ws.opportunities) {
    const k = o.route ?? "other";
    groups.set(k, [...(groups.get(k) ?? []), o]);
  }
  const order = [...groups.keys()].sort((a, b) => (groups.get(b)!.length - groups.get(a)!.length));
  const cluster = (id: string | null) => ws.clusters.find((c) => c.id === id)?.name ?? null;
  return (
    <>
      <PageHead micro="Opportunities" title="Where to get named" intro="Pages the engines cite for your prompts that leave you out, sorted by what to do about each. Read from your own answers, refreshed nightly." />
      {!ws.opportunities.length ? <div className="dash-card empty"><b>Nothing here yet</b>Opportunities appear once a week of readings shows which pages the engines rely on.</div> : null}
      {order.map((k) => {
        const [title, why] = ROUTES[k] ?? ["Other", ""];
        const list = groups.get(k)!.sort((a, b) => (b.evidence?.answers ?? 0) - (a.evidence?.answers ?? 0));
        return (
          <div key={k} className="dash-card">
            <div className="dash-card-head"><div><h2>{title} <span className="pill" style={{ marginLeft: 6 }}>{list.length}</span></h2><p className="intro">{why}</p></div></div>
            {ROUTE_GUIDES[k] ? <div style={{ marginBottom: 12 }}><GuideBox guide={{ ...ROUTE_GUIDES[k]!, title: "How to do this yourself" }} /></div> : null}
            <div className="tbl-wrap">
              <table className="tbl">
                <thead><tr><th>Page</th><th className="r">Answers citing it</th><th>Names instead</th></tr></thead>
                <tbody>
                  {list.slice(0, 15).map((o) => (
                    <tr key={o.url}>
                      <td style={{ maxWidth: 420 }}><a href={o.url} target="_blank" rel="noopener noreferrer">{o.title ?? o.domain}</a><div className="sub">{o.domain}{cluster(o.cluster_id) ? ` · ${cluster(o.cluster_id)}` : ""}</div></td>
                      <td className="r num">{o.evidence?.answers ?? "-"}</td>
                      <td className="muted" style={{ fontSize: 12.5 }}>{(o.evidence?.competitors ?? []).slice(0, 3).join(", ") || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {list.length > 15 ? <p className="faint" style={{ margin: "8px 0 0", fontSize: 12.5 }}>And {list.length - 15} more.</p> : null}
          </div>
        );
      })}
    </>
  );
}
