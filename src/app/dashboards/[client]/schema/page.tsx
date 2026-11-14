import type { Metadata } from "next";

import SchemaTabs, { CheckAgain } from "@/components/dash/SchemaTabs";
import { PageHead } from "@/components/dash/Shell";
import { pageData } from "@/lib/dash/page-data";
import { PLATFORM_NAME, aiPrompt, buildSchema, developerText, gtmText, liveStatus, short, whereText } from "@/lib/dash/schema-build";
import { readPage } from "@/lib/dash/schema-read";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Schema", robots: { index: false, follow: false } };

/**
 * Schema for your site (Danny, 14 Nov 2026): JSON-LD built from the customer's own pages (schema-build.ts), three ways
 * to add it, and whether it is on the site now - read each time this page opens, and again on Check again.
 */
export default async function Schema({ params }: { params: Promise<{ client: string }> }) {
  const { client: slug } = await params;
  const { ws, raw } = await pageData(slug);
  const domain = ws.client.domain;
  const live = ws.clusters.filter((c) => c.managed || ws.client.tier === "tracked");
  const targets = [...new Set(live.map((c) => c.target).filter((t): t is string => !!t))].slice(0, 6);
  const [home, ...pages] = await Promise.all([readPage(`https://${domain}/`), ...targets.map((t) => readPage(t))]);
  const pageOf = new Map(targets.map((t, i) => [t, pages[i]?.facts ?? null]));
  const plan = buildSchema({
    domain,
    brand: raw.client.brand,
    market: raw.client.market,
    local: !!raw.localGrids,
    home: home?.facts ?? null,
    clusters: live.map((c) => ({ name: c.name, keyword: c.headKeyword, target: c.target, page: c.target ? (pageOf.get(c.target) ?? null) : null })),
  });
  const status = liveStatus(plan, [home?.facts ?? null, ...pages.map((p) => p?.facts ?? null)]);
  const onSite = status.filter((s) => s.live).length;
  const platform = home?.platform ?? null;
  return (
    <>
      <PageHead micro="Schema" title="Schema for your site" intro="Schema is a short piece of code that tells search engines and AI tools, in a form they read reliably, who you are and what you offer. We've written it for you from what your pages already say. Add it one of three ways below." />
      <div className="dash-card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <h2 style={{ margin: 0 }}>On your site now</h2>
          <CheckAgain />
        </div>
        <p className="intro">{home ? `We checked ${short(`https://${domain}/`)}${targets.length ? ` and ${targets.length} target page${targets.length === 1 ? "" : "s"}` : ""} just now. ${onSite} of ${plan.blocks.length} ${plan.blocks.length === 1 ? "block is" : "blocks are"} live.` : "We couldn't reach your site just now. Press Check again in a minute."}</p>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Schema</th><th>Goes on</th><th>Status</th></tr></thead>
            <tbody>
              {plan.blocks.map((b) => {
                const on = status.find((s) => s.id === b.id)?.live;
                return (
                  <tr key={b.id}>
                    <td>{b.label}</td>
                    <td className="muted">{whereText(b)}</td>
                    <td><span className={`pill${on ? " good" : ""}`}>{on ? "Live on your site" : "Not added yet"}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {plan.notes.length ? (
          <ul className="muted" style={{ fontSize: 13, margin: "12px 0 0", paddingLeft: 18 }}>
            {plan.notes.map((n) => <li key={n}>{n}</li>)}
          </ul>
        ) : null}
      </div>
      <SchemaTabs developer={developerText(plan, platform)} ai={aiPrompt(plan, { domain, platform })} gtm={gtmText(plan)} platform={platform ? PLATFORM_NAME[platform] : null} />
      <p className="faint" style={{ fontSize: 12.5, marginTop: 12 }}>We only use details your own pages show. If something is missing, add it to your site and press Check again; the code here updates to match.</p>
    </>
  );
}
