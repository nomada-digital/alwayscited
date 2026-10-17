import type { Metadata } from "next";

import TierName from "@/components/TierName";
import { Meter } from "@/components/dash/Figures";
import { Delivery } from "@/components/dash/PlanCard";
import { PageHead } from "@/components/dash/Shell";
import { SITE_ORIGIN } from "@/lib/app-host";
import { pageData } from "@/lib/dash/page-data";
import { TIER_ORDER, packLine, tierInfo } from "@/lib/dash/plan";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Plan", robots: { index: false, follow: false } };

export default async function Plan({ params }: { params: Promise<{ client: string }> }) {
  const { client: slug } = await params;
  const { ws } = await pageData(slug);
  const a = ws.allowances;
  const at = TIER_ORDER.indexOf(ws.client.tier);
  return (
    <>
      <PageHead micro="Plan" title={<TierName tier={ws.client.tier} />} intro={tierInfo(ws.client.tier).positioning} />
      <div className="dash-grid k2">
        <div className="dash-card">
          <h2>Allowances</h2>
          <p className="intro">Shared across your clusters: split them into as many groups as you like.</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 16 }}>
            <Meter label="Clusters" used={a.clusters.used} limit={a.clusters.limit} />
            <Meter label="Keywords, checked on Google daily" used={a.keywords.used} limit={a.keywords.limit} />
            <Meter label="Prompts, asked of every engine daily" used={a.prompts.used} limit={a.prompts.limit} />
          </div>
        </div>
        <div className="dash-card">
          <h2>Need more room?</h2>
          <p className="intro">An extra tracking pack: {packLine(ws.client.market)}, with their keywords and prompts. Ask us and we add it to your subscription.</p>
          <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
            <a className="btn primary" href={`${SITE_ORIGIN}/contact?tier=${encodeURIComponent("alwaystracked")}`}>Ask for a pack</a>
            <a className="btn" href={`${SITE_ORIGIN}/help`}>How allowances work</a>
          </div>
        </div>
      </div>
      <div className="dash-card">
        <h2>The four plans</h2>
        <p className="intro">Each one does everything the one before it does. Tracking tells you where you stand; the rest is us getting you named.</p>
        <div className="ladder" style={{ marginTop: 14 }}>
          {TIER_ORDER.map((t, i) => {
            const info = tierInfo(t);
            return (
              <div key={t} className={`rung${t === ws.client.tier ? " on" : ""}`}>
                <TierName tier={t} />
                <span className="p">{info.priceLabel}</span>
                <ul>{info.includes.slice(0, 3).map((x) => <li key={x}>{x}</li>)}</ul>
                {t === ws.client.tier ? <span className="pill accent" style={{ alignSelf: "flex-start", marginTop: 8 }}>Your plan</span> : i > at ? <a className="btn sm" style={{ marginTop: 8, alignSelf: "flex-start" }} href={`${SITE_ORIGIN}${info.href}`}>See what it adds</a> : null}
              </div>
            );
          })}
        </div>
      </div>
      {ws.clusters.map((c) => <div key={c.id} style={{ marginTop: 16 }}><div className="dash-micro" style={{ marginBottom: 6 }}>{c.name}</div><Delivery ws={ws} cluster={c} /></div>)}
    </>
  );
}
