import type { Metadata } from "next";

import TierName from "@/components/TierName";
import { Meter } from "@/components/dash/Figures";
import { Delivery } from "@/components/dash/PlanCard";
import { PageHead } from "@/components/dash/Shell";
import { PACK_CLUSTERS, PACK_KEYWORDS, PACK_PROMPTS, trackingPackPrice } from "@/config/pricing";
import { SITE_ORIGIN } from "@/lib/app-host";
import { pageData } from "@/lib/dash/page-data";
import { TIER_ORDER, packLine, planCopy, tierInfo } from "@/lib/dash/plan";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Plan", robots: { index: false, follow: false } };

const PACK_WHY: Record<string, string> = {
  done: "Thank you - your pack is being added. The new allowance shows here within a minute.",
  owner: "Only the account owner can add a pack.",
  ended: "This plan has ended, so nothing can be added to it.",
  none: "This plan is not billed by card here, so a pack cannot be added online yet.",
  soon: "Adding packs online switches on shortly. Try again later today.",
  failed: "Stripe did not open just now. Nothing was charged. Try again in a minute.",
};

const BILLING_WHY: Record<string, string> = {
  owner: "Only the account owner can open billing.",
  none: "There is no card subscription on this site yet. Email us and we will sort it.",
  failed: "Billing did not open just now. Try again in a minute, or email us.",
};

export default async function Plan({ params, searchParams }: { params: Promise<{ client: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { client: slug } = await params;
  const sp = await searchParams;
  const { ws, demo } = await pageData(slug);
  const billingWhy = typeof sp.billing === "string" ? (BILLING_WHY[sp.billing] ?? null) : null;
  const packWhy = typeof sp.pack === "string" ? (PACK_WHY[sp.pack] ?? null) : null;
  const a = ws.allowances;
  const at = TIER_ORDER.indexOf(ws.client.tier);
  return (
    <>
      <PageHead micro="Plan" title={<TierName tier={ws.client.tier} />} intro={planCopy(ws.client.tier).positioning} />
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
        <div className="dash-card" id="pack">
          <h2>Track more</h2>
          <p className="intro">An extra tracking pack: {packLine(ws.client.market)}, with their {PACK_KEYWORDS} keywords and {PACK_PROMPTS} prompts. Paid monthly by card through Stripe; add as many as you need.</p>
          <div style={{ marginTop: 16 }}>
            {demo ? (
              <span className="muted" style={{ fontSize: 13 }}>Adding a pack is not available on a demo.</span>
            ) : ws.role === "owner" ? (
              <form action={`/api/dash/${slug}/pack`} method="post">
                <button type="submit" className="btn primary">Add {PACK_CLUSTERS} clusters - {trackingPackPrice(ws.client.market)} a month</button>
              </form>
            ) : (
              <span className="muted" style={{ fontSize: 13 }}>The account owner can add a pack.</span>
            )}
            {packWhy ? <div className={sp.pack === "done" ? "banner" : "field-err"} role="status" style={{ marginTop: 10 }}>{packWhy}</div> : null}
          </div>
        </div>
      </div>
      <div className="dash-card" id="billing">
        <div className="dash-card-head">
          <div>
            <h2>Billing</h2>
            <p className="intro">Invoices, your card, and cancelling are on Stripe&rsquo;s secure billing page. Cancelling stops at the end of the period you have paid for.</p>
          </div>
          {ws.role === "owner" && !demo ? (
            <form action={`/api/dash/${slug}/billing`} method="post">
              <button type="submit" className="btn">Open billing</button>
            </form>
          ) : (
            <span className="muted" style={{ fontSize: 12.5 }}>{demo ? "Billing is not available on a demo." : "The account owner manages billing."}</span>
          )}
        </div>
        {billingWhy ? <div className="field-err" role="alert">{billingWhy}</div> : null}
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
                <ul>{planCopy(t).includes.slice(0, 3).map((x) => <li key={x}>{x}</li>)}</ul>
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
