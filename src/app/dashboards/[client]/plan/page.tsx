import type { Metadata } from "next";

import TierName from "@/components/TierName";
import { Meter, TargetPage } from "@/components/dash/Figures";
import Nudges from "@/components/dash/Nudges";
import { Delivery } from "@/components/dash/PlanCard";
import { PageHead } from "@/components/dash/Shell";
import { PACK_CLUSTERS, PACK_KEYWORDS, PACK_PROMPTS, trackingPackPrice } from "@/config/pricing";
import { SITE_ORIGIN } from "@/lib/app-host";
import { readInvoices } from "@/lib/dash/invoices";
import { pageData } from "@/lib/dash/page-data";
import { RETENTION_DAYS } from "@/lib/tracking/retention";
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

const TRIAL_DONE = {
  cancelled: "Your trial is cancelled. Nothing will be charged, and the dashboard stays open until the trial ends.",
  refused: "The trial was not cancelled - it may already be cancelled or over. Email us and we will sort it.",
};

const BILLING_WHY: Record<string, string> = {
  owner: "Only the account owner can open billing.",
  none: "There is no card subscription on this site yet. Email us and we will sort it.",
  failed: "Billing did not open just now. Try again in a minute, or email us.",
};

export default async function Plan({ params, searchParams }: { params: Promise<{ client: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { client: slug } = await params;
  const sp = await searchParams;
  const { ws, demo, base, nudge, raw, viewAs } = await pageData(slug);
  // the invoice history (22 Oct 2026): the owner's, read live from Stripe; never in a demo or a team member's view-as
  const inv = ws.role === "owner" && !demo && !viewAs ? await readInvoices(raw.client.id) : null;
  const invDay = (s: number | null) => (s ? new Date(s * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "-");
  const billingWhy = typeof sp.billing === "string" ? (BILLING_WHY[sp.billing] ?? null) : null;
  const trialWhy = sp.trial === "cancelled" ? TRIAL_DONE.cancelled : sp.trial === "refused" ? TRIAL_DONE.refused : null;
  // a running card trial: the owner can cancel it here (api/dash/[client]/trial), as /app's Settings > Billing did
  const trialEnds = ws.client.trial_ends_at && !ws.client.payment_status && Date.parse(ws.client.trial_ends_at) > Date.now() ? ws.client.trial_ends_at : null;
  const packWhy = typeof sp.pack === "string" ? (PACK_WHY[sp.pack] ?? null) : null;
  const a = ws.allowances;
  const at = TIER_ORDER.indexOf(ws.client.tier);
  return (
    <>
      <PageHead micro="Plan" title={<TierName tier={ws.client.tier} />} intro={planCopy(ws.client.tier).positioning} />
      <Nudges ws={ws} base={base} ctx={nudge} only={["to-mentioned", "to-cited", "to-everywhere"]} />
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
              <span className="muted" style={{ fontSize: 13 }}>Adding a pack is not available in a read-only view.</span>
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
            <p className="intro">Invoices, your card, and cancelling are on Stripe&rsquo;s secure billing page. Cancelling stops at the end of the period you have paid for. After that, this dashboard and everything in it stay open, read-only, for {RETENTION_DAYS} days, and then your data is deleted.</p>
          </div>
          {ws.role === "owner" && !demo ? (
            <form action={`/api/dash/${slug}/billing`} method="post">
              <button type="submit" className="btn">Open billing</button>
            </form>
          ) : (
            <span className="muted" style={{ fontSize: 12.5 }}>{demo ? "Billing is not available in a read-only view." : "The account owner manages billing."}</span>
          )}
        </div>
        {billingWhy ? <div className="field-err" role="alert">{billingWhy}</div> : null}
        {inv ? (
          <div id="invoices" style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid var(--line)" }}>
            <h3 style={{ margin: "0 0 4px", fontSize: 15 }}>Invoices</h3>
            <p className="intro">A VAT invoice from Nomada Digital Ltd for every payment. Each is emailed to you when it is paid.</p>
            {inv.rows && inv.rows.length ? (
              <div style={{ overflowX: "auto", marginTop: 10 }}>
                <table className="tbl">
                  <thead><tr><th>Date</th><th>Invoice</th><th className="num">Amount</th><th>Status</th><th>PDF</th></tr></thead>
                  <tbody>
                    {inv.rows.map((r) => (
                      <tr key={r.id}>
                        <td>{invDay(r.date)}</td>
                        <td>{r.hostedUrl ? <a href={r.hostedUrl} target="_blank" rel="noopener noreferrer">{r.number ?? "View"}</a> : (r.number ?? "-")}</td>
                        <td className="num">{r.amount}</td>
                        <td>{r.status}</td>
                        <td>{r.pdfUrl ? <a href={r.pdfUrl} target="_blank" rel="noopener noreferrer">Download</a> : "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="muted" style={{ fontSize: 13, margin: "8px 0 0" }}>{inv.why ?? "No invoices yet. The first one appears here when your first payment is taken."}</p>
            )}
          </div>
        ) : null}
        {trialEnds ? (
          <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid var(--line)" }} id="trial">
            <h3 style={{ margin: "0 0 4px", fontSize: 15 }}>Your free trial</h3>
            <p className="intro">It ends on {new Date(trialEnds).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })}. Cancel before then and you pay nothing; tracking stops when the trial ends.</p>
            {ws.role === "owner" && !demo ? (
              <form action={`/api/dash/${slug}/trial`} method="post" style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", marginTop: 10 }}>
                <label style={{ fontSize: 13 }}><input type="checkbox" id="trial-confirm" name="confirm" value="1" required /> Yes, cancel the trial</label>
                <button type="submit" className="btn">Cancel trial</button>
              </form>
            ) : (
              <span className="muted" style={{ fontSize: 12.5 }}>{demo ? "Not available in a read-only view." : "The account owner can cancel the trial."}</span>
            )}
          </div>
        ) : null}
        {trialWhy ? <div className={sp.trial === "cancelled" ? "banner" : "field-err"} role="status" style={{ marginTop: 10 }}>{trialWhy}</div> : null}
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
      {ws.clusters.map((c) => <div key={c.id} style={{ marginTop: 16 }}><div className="dash-micro" style={{ marginBottom: 2 }}>{c.name}</div><p className="muted" style={{ margin: "0 0 6px", fontSize: 13 }}><TargetPage url={c.target} /></p><Delivery ws={ws} cluster={c} /></div>)}
    </>
  );
}
