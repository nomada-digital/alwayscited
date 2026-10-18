import type { Metadata } from "next";
import Link from "next/link";

import { Pos, longDay } from "@/components/dash/Figures";
import KeywordManager from "@/components/dash/KeywordManager";
import { PageHead } from "@/components/dash/Shell";
import { dashFixturePath } from "@/lib/dash/fixture";
import { planShape } from "@/lib/dash/plan";
import { defaultAudience } from "@/lib/dash/audience";
import { knownMetrics } from "@/lib/dash/research";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { clusterKeywords, trimRaw } from "@/lib/dash/model";
import { pageData } from "@/lib/dash/page-data";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Search positions", robots: { index: false, follow: false } };

export default async function Google({ params }: { params: Promise<{ client: string }> }) {
  const { client: slug } = await params;
  const { raw, ws, base, demo } = await pageData(slug);
  // What the shared research cache already knows about the tracked keywords: free, no paid read on page view.
  const metrics = Object.fromEntries([...(await knownMetricsSafe(raw.client.market, raw.keywords.filter((k) => k.stopped_on === null).map((k) => k.keyword), raw.today))]);
  const rows = ws.clusters.flatMap((c) => clusterKeywords(c).map((k) => ({ ...k, cluster: c })));
  const also = rows.filter((r) => r.src === "footprint").sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0)).slice(0, 40);
  return (
    <>
      <PageHead micro={<>Search positions · Google, {ws.client.market}</>} title="Where you rank" intro="Tracked keywords are checked on Google every morning. The rest come from your monthly ranking snapshot, sorted into your keyword groups." />
      <KeywordManager slug={slug} base={base} initial={trimRaw(raw)} plan={planShape()} demo={demo} metrics={metrics} audience={defaultAudience(await orderSector(raw.client.id))} />
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

/** The research cache's figures for these keywords; nothing on a local snapshot. */
async function knownMetricsSafe(market: string, keywords: string[], today: string) {
  if (dashFixturePath()) return new Map();
  return knownMetrics(supabaseAdmin(), market, keywords, today).catch(() => new Map());
}

/** The sector the client chose at checkout, which sets the B2B / B2C toggle's default; null when unknown. */
async function orderSector(clientId: string): Promise<string | null> {
  if (dashFixturePath()) return null;
  const { data, error } = await supabaseAdmin().from("orders").select("sector").eq("client_domain_id", clientId).not("sector", "is", null).order("created_at", { ascending: false }).limit(1);
  if (error) return null;
  return (data?.[0]?.sector as string | undefined) ?? null;
}
