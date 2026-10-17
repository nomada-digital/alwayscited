import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import ClusterEditor from "@/components/dash/ClusterEditor";
import ClusterTitle from "@/components/dash/ClusterTitle";
import { Change, Kpi, Pos, Spark, fullDay, pct } from "@/components/dash/Figures";
import { Delivery } from "@/components/dash/PlanCard";
import { PageHead } from "@/components/dash/Shell";
import { trimRaw } from "@/lib/dash/model";
import { pageData } from "@/lib/dash/page-data";
import { planShape } from "@/lib/dash/plan";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Cluster", robots: { index: false, follow: false } };

export default async function Cluster({ params }: { params: Promise<{ client: string; cluster: string }> }) {
  const { client: slug, cluster: id } = await params;
  const { raw, ws, base } = await pageData(slug);
  const c = ws.clusters.find((x) => x.id === id);
  if (!c) notFound();
  const tracked = [...c.groups.flatMap((g) => g.keywords), ...c.own.keywords].filter((k) => k.src === "tracked");
  const top10 = tracked.filter((k) => k.pos !== null && k.pos <= 10).length;
  return (
    <>
      <PageHead
        micro={<><Link href={`${base}/${slug}/clusters`}>Clusters</Link><span>/</span><span>{c.headKeyword ?? "cluster"}</span></>}
        title={<ClusterTitle slug={slug} id={c.id} name={c.name} canWrite={ws.canWrite} />}
        intro={c.headKeyword ? <>Started {fullDay(c.startedOn)}. Its keyword is <b>{c.headKeyword}</b>{c.headVolume ? `, ${c.headVolume.toLocaleString("en-GB")} searches a month` : ""}.</> : `Started ${fullDay(c.startedOn)}.`}
      />
      <div className="dash-grid k4" style={{ marginBottom: 16 }}>
        <Kpi label="Google, cluster keyword" value={<span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}><Pos pos={c.headPos} /><Change n={c.headChange} /></span>} sub="Today, against 7 days ago" />
        <Kpi label="AI names you" value={pct(c.rate)} sub="This cluster's prompts, latest reading"><Spark values={c.rateTrend} width={120} /></Kpi>
        <Kpi label="Tracked keywords on page 1" value={top10} unit={`of ${tracked.length}`} />
        <Kpi label="Groups" value={c.groups.length} sub={`${c.prompts} prompts across them`} />
      </div>
      <ClusterEditor slug={slug} base={base} clusterId={c.id} initial={trimRaw(raw)} plan={planShape()} consoleLive={ws.consoleLive} integrationsHref={`${base}/${slug}/integrations`} />
      <div style={{ marginTop: 16 }}><Delivery ws={ws} cluster={c} /></div>
    </>
  );
}
