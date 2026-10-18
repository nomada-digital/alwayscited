import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import EngineLogo from "@/components/EngineLogo";
import { Pos, Rate } from "@/components/dash/Figures";
import GuideBox from "@/components/dash/GuideBox";
import { PageHead } from "@/components/dash/Shell";
import TierName from "@/components/TierName";
import { ROUTE_GUIDES } from "@/config/guidance";
import { MONTHLY_INSERTIONS_MIN, MONTHLY_PLACEMENTS, PLAN_ENGINES, TRACKED_PRICE, TRACKING_ENGINES } from "@/config/pricing";
import { engineLabel } from "@/components/scan/result-figures";
import { pageData } from "@/lib/dash/page-data";
import { targetLabel } from "@/lib/dash/target";
import { MANAGED_TIERS } from "@/lib/dash/types";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Your alwaystracked view", robots: { index: false, follow: false } };

/** What each paid tier delivers that alwaystracked does not, per worked cluster a month (pricing.ts's figures). */
const STOPS: Record<string, string[]> = {
  mentioned: [`${MONTHLY_PLACEMENTS} placements a month in pages the engines already cite`, "Each placement screened before it counts, and replaced if it fails"],
  cited: [`${MONTHLY_PLACEMENTS} placements a month in pages the engines already cite`, `${MONTHLY_INSERTIONS_MIN}+ link insertions a month inside existing ranking articles`, "Schema on your target page"],
  everywhere: [`${MONTHLY_PLACEMENTS} placements, ${MONTHLY_INSERTIONS_MIN}+ link insertions and schema a month`, "Brand PR for earned media, run by our senior team", "Each piece matched against the sources behind the answers"],
};

/**
 * "Your alwaystracked view" (18 Oct 2026 brief 2g): what a paid client keeps if
 * they move to alwaystracked, the DIY plan - their own figures, read-only, not
 * a mock-up. What they keep (10 clusters, 50 prompts, 10 keywords read daily,
 * four engines, with Claude shown as not included rather than hidden); what
 * they would do themselves (the opportunities as tasks, with the anchor to ask
 * for, alternating the keyword's two forms); what we would stop doing. The
 * switch is on Plan, at the end of the period, through Stripe; nothing here
 * changes the plan. Shown in the client's own dashboard and so in the hub's
 * "What the customer sees", which renders the same pages.
 */
export default async function TrackedView({ params }: { params: Promise<{ client: string }> }) {
  const { client: slug } = await params;
  const { ws, raw, base } = await pageData(slug);
  if (!(MANAGED_TIERS as readonly string[]).includes(ws.client.tier)) notFound();
  const price = ws.client.market === "UK" ? `£${TRACKED_PRICE.uk}` : `$${TRACKED_PRICE.us}`;
  const formsOf = (clusterId: string | null): string[] => {
    const c = raw.clusters.find((x) => x.id === clusterId);
    const head = c?.keyword_id ? raw.keywords.find((k) => k.id === c.keyword_id && k.stopped_on === null) : null;
    if (!head) return [];
    const pair = raw.keywords.find((k) => k.stopped_on === null && k.pair_of === head.id);
    return pair ? [head.keyword, pair.keyword] : [head.keyword];
  };
  const seen = new Map<string, number>();
  const tasks = ws.opportunities
    .filter((o) => o.status === "new" || o.status === "pursuing")
    .slice(0, 12)
    .map((o) => {
      const forms = formsOf(o.cluster_id);
      const i = seen.get(o.cluster_id ?? "") ?? 0;
      seen.set(o.cluster_id ?? "", i + 1);
      const cluster = ws.clusters.find((c) => c.id === o.cluster_id) ?? null;
      return { o, anchor: forms.length ? forms[i % forms.length] : null, cluster };
    });
  const worked = ws.clusters.filter((c) => c.managed);
  const routes = [...new Set(tasks.map((t) => t.o.route).filter((r): r is string => !!r && !!ROUTE_GUIDES[r]))];
  return (
    <>
      <PageHead
        micro={<>Your <TierName tier="tracked" /> view</>}
        title="If you moved to alwaystracked"
        intro={<>Your own figures, as <TierName tier="tracked" /> ({price} a month) would show them. A fair path once the worked clusters are where you want them. Nothing on this page changes your plan.</>}
      >
        <Link className="btn" href={`${base}/${slug}/plan#billing`}>Switch to alwaystracked</Link>
      </PageHead>

      <div className="dash-card">
        <h2>What you keep</h2>
        <p className="intro">10 keyword clusters, 50 prompts and 10 Google keywords, checked every morning. The sources the engines cite, the leaderboard, Google positions for your target pages, and your full history so far.</p>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 10, alignItems: "center" }}>
          {PLAN_ENGINES.map((e) => {
            const kept = TRACKING_ENGINES.includes(e);
            return (
              <span key={e} style={{ display: "inline-flex", alignItems: "center", gap: 6, opacity: kept ? 1 : 0.45 }} title={kept ? `${engineLabel(e)}: kept` : `${engineLabel(e)}: not included on alwaystracked`}>
                <EngineLogo engine={e} size={14} /> {engineLabel(e)}{kept ? "" : " - not included"}
              </span>
            );
          })}
        </div>
        <div className="tbl-wrap" style={{ marginTop: 12 }}>
          <table className="tbl">
            <thead><tr><th>Cluster</th><th>Target page</th><th className="r">Named in answers</th><th className="r">Google</th></tr></thead>
            <tbody>
              {ws.clusters.map((c) => (
                <tr key={c.id}>
                  <td><Link href={`${base}/${slug}/clusters/${c.id}`} style={{ fontWeight: 600 }}>{c.name}</Link>{c.headKeyword ? <div className="sub">{c.headKeyword}</div> : null}</td>
                  <td className="muted">{c.target ? targetLabel(c.target) : "-"}</td>
                  <td className="r"><Rate r={c.rate} /></td>
                  <td className="r"><Pos pos={c.headPos} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="faint" style={{ fontSize: 12.5, margin: "8px 0 0" }}>The answer rates above include Claude while you are on this plan; on alwaystracked they are read across the {TRACKING_ENGINES.length} engines kept.</p>
      </div>

      <div className="dash-card">
        <h2>What you would do yourself</h2>
        <p className="intro">The pages worth getting into, from your own readings, as tasks. For each: where, why, and the anchor to ask for, linking to the cluster&apos;s target page.</p>
        {tasks.length ? (
          <div className="tbl-wrap" style={{ marginTop: 10 }}>
            <table className="tbl">
              <thead><tr><th>Page</th><th>Why</th><th>Ask for</th></tr></thead>
              <tbody>
                {tasks.map(({ o, anchor, cluster }) => (
                  <tr key={o.id ?? o.url}>
                    <td><a href={o.url} target="_blank" rel="noopener noreferrer nofollow">{o.title ?? o.domain}</a><div className="sub">{o.domain}</div></td>
                    <td className="muted">{o.route && ROUTE_GUIDES[o.route] ? ROUTE_GUIDES[o.route]!.label : "Worth a placement"}{o.evidence?.answers ? ` · cited in ${o.evidence.answers} answers` : ""}</td>
                    <td>{anchor ? <>“{anchor}”{cluster?.target ? <div className="sub">to {targetLabel(cluster.target)}</div> : null}</> : <span className="faint">-</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="faint" style={{ margin: "8px 0 0" }}>No open opportunities yet. They appear here as the readings find pages worth getting into.</p>}
        {routes.length ? <div style={{ marginTop: 12 }}>{routes.map((r) => <GuideBox key={r} id={`at-guide-${r}`} guide={ROUTE_GUIDES[r]!} />)}</div> : null}
      </div>

      <div className="dash-card">
        <h2>What we would stop doing</h2>
        <p className="intro">On {worked.length === 1 ? "your worked cluster" : `each of your ${worked.length} worked clusters`}{worked.length ? ` (${worked.map((c) => c.name).join(", ")})` : ""}, each month:</p>
        <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>{(STOPS[ws.client.tier] ?? []).map((s) => <li key={s}>{s}</li>)}</ul>
        <p className="faint" style={{ fontSize: 12.5, margin: "10px 0 0" }}>A move to <TierName tier="tracked" /> takes effect at the end of your current period. Placements already live stay live.</p>
      </div>
    </>
  );
}
