import type { Metadata } from "next";
import Link from "next/link";

import { GooglePos, Pos, longDay } from "@/components/dash/Figures";
import GuideBox from "@/components/dash/GuideBox";
import KeywordManager from "@/components/dash/KeywordManager";
import { updateRolling } from "@/lib/tracking/google-updates";
import Nudges from "@/components/dash/Nudges";
import SerpChances from "@/components/dash/SerpChances";
import { KEYWORD_GUIDES } from "@/config/guidance";
import { keywordSituation } from "@/lib/dash/guidance";
import { PageHead } from "@/components/dash/Shell";
import { dashFixturePath } from "@/lib/dash/fixture";
import { planShape } from "@/lib/dash/plan";
import { defaultAudience } from "@/lib/dash/audience";
import { knownMetrics } from "@/lib/dash/research";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { clusterKeywords, trimRaw } from "@/lib/dash/model";
import { pageData } from "@/lib/dash/page-data";
import { placeholdersFor } from "@/lib/dash/placeholder-io";
import type { Placeholders } from "@/lib/dash/placeholder";
import type { Audience } from "@/config/keyword-audience";
import type { Market } from "@/lib/scan/domain";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Search positions", robots: { index: false, follow: false } };

export default async function Google({ params }: { params: Promise<{ client: string }> }) {
  const { client: slug } = await params;
  const { raw, ws, base, demo, nudge } = await pageData(slug);
  // What the shared research cache already knows about the tracked keywords: free, no paid read on page view.
  const tracked = raw.keywords.filter((k) => k.stopped_on === null);
  const metrics = Object.fromEntries([...(await knownMetricsSafe(raw.client.market, [...new Set([...tracked.map((k) => k.keyword), ...raw.clusters.map((c) => c.name)])], raw.today))]);
  // 27 Nov 2026 (Danny): Find keywords' example comes from this client's own keywords and follows the toggle; it opens on the client's own side.
  const { audience, placeholders } = await findKeywordsSetup(raw.client, tracked, ws.clusters.map((c) => c.name), metrics);
  const rows = ws.clusters.flatMap((c) => clusterKeywords(c).map((k) => ({ ...k, cluster: c })));
  const situations = [...new Set(rows.filter((r) => r.src === "tracked").map((k) => keywordSituation(k)))];
  const rolling = updateRolling(raw.today);
  const also = rows.filter((r) => r.src === "footprint").sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0)).slice(0, 40);
  return (
    <>
      <PageHead micro={<>Search positions · Google, {ws.client.market}</>} title="Where you rank" intro="Tracked keywords are checked on Google every morning. The rest come from your monthly ranking snapshot, sorted into your keyword groups." />
      <Nudges ws={ws} base={base} ctx={nudge} only={["to-cited"]} />
      {rolling ? <p className="muted" style={{ fontSize: 13, margin: "0 0 12px" }}><span className="pill warn">{longDay(rolling.from)} to {longDay(rolling.to)}</span> {rolling.note}.</p> : null}
      <KeywordManager slug={slug} base={base} initial={trimRaw(raw)} plan={planShape()} demo={demo} metrics={metrics} audience={audience} placeholders={placeholders} />
      <SerpChances slug={slug} base={base} initial={trimRaw(raw)} plan={planShape()} demo={demo} />
      {situations.length ? (
        <div className="dash-card">
          <h2>Doing it yourself</h2>
          <p className="intro">The next step for each keyword, from its own figures.</p>
          <div style={{ marginTop: 10 }}>{situations.map((s) => <GuideBox key={s} id={`guide-${s}`} guide={KEYWORD_GUIDES[s]} />)}</div>
        </div>
      ) : null}
      <div className="dash-card">
        <div className="dash-card-head"><div><h2>Also ranking, in your groups</h2><p className="intro">From the ranking snapshot of {longDay(ws.footprintOn)}. Track any of them from its cluster.</p></div></div>
        {also.length ? (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>Keyword</th><th>Group</th><th className="r">Volume</th><th className="r">Position</th></tr></thead>
              <tbody>
                {also.map((k) => (
                  <tr key={`${k.cluster.id}-${k.keyword}`}><td>{k.keyword}</td><td className="muted"><Link href={`${base}/${slug}/clusters/${k.cluster.id}`}>{k.group || k.cluster.name}</Link></td><td className="r num">{k.volume?.toLocaleString("en-GB") ?? "-"}</td><td className="r"><GooglePos pos={k.pos} read={k.read ?? true} varies={k.varies} gsc={k.console.gsc} /></td></tr>
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

/** The B2B / B2C toggle's starting side and the example text for each state, for one client. A client with no database to read gets the old defaults. */
async function findKeywordsSetup(client: { id: string; domain: string; brand: string | null; market: string }, tracked: { keyword: string; search_volume: number | null }[], clusterNames: string[], metrics: Record<string, { volume?: number | null } | undefined>) {
  if (dashFixturePath()) return { audience: defaultAudience(null) as Audience, placeholders: {} as Placeholders };
  const db = supabaseAdmin();
  const { data: row, error } = await db.from("client_domains").select("topic, brand_aliases, business_type").eq("id", client.id).maybeSingle();
  // Before 20261127050000 the column is absent: the order's sector decides, as it did.
  const bt = !error && (row?.business_type === "b2b" || row?.business_type === "b2c") ? (row.business_type as Audience) : null;
  const audience = bt ?? defaultAudience(await orderSector(client.id));
  const volume = (k: string, own: number | null) => own ?? metrics[k]?.volume ?? null;
  const candidates = [...tracked.map((k) => ({ keyword: k.keyword, volume: volume(k.keyword, k.search_volume) })), ...clusterNames.map((n) => ({ keyword: n, volume: volume(n, null) }))];
  const placeholders = await placeholdersFor(db, { id: client.id, domain: client.domain, brand: client.brand, aliases: ((row?.brand_aliases as string[] | null) ?? []).filter(Boolean), market: (client.market === "US" || client.market === "JM" ? client.market : "UK") as Market, topic: (row?.topic as string | null) ?? null, clusters: clusterNames, keywords: tracked.map((k) => k.keyword) }, candidates).catch(() => ({}) as Placeholders);
  return { audience, placeholders };
}
