import type { Metadata } from "next";

import SchemaTabs, { CheckAgain } from "@/components/dash/SchemaTabs";
import { PageHead } from "@/components/dash/Shell";
import { pageData } from "@/lib/dash/page-data";
import { PLATFORM_NAME, type PageFacts, aiPrompt, buildSchema, developerText, gtmText, short, whereText } from "@/lib/dash/schema-build";
import { readDelivered, readPage, renderedSchema } from "@/lib/dash/schema-read";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { urlKey } from "@/lib/tracking/placements";

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
  // Schema Nomada delivered (schema_delivered) is read first: its pages are read live too, and it overrides the advice.
  const delivered = await readDelivered(supabaseAdmin(), raw.client.id);
  const homeUrl = `https://${domain}/`;
  const sameUrl = (a: string, b: string) => (urlKey(a) ?? a) === (urlKey(b) ?? b);
  const targets = [...new Set([...live.map((c) => c.target), ...delivered.map((d) => d.where_url)].filter((t): t is string => !!t && t !== "sitewide" && !sameUrl(t, homeUrl)))].slice(0, 8);
  // Live first: every page is read now, and what a rendered read found (app- and plugin-injected schema) joins it.
  const [home, rendered, ...pages] = await Promise.all([readPage(homeUrl), renderedSchema(supabaseAdmin(), raw.client.id).catch(() => new Map()), ...targets.map((t) => readPage(t))]);
  const withRendered = (f: PageFacts | null, url: string): PageFacts | null => (f ? { ...f, rendered: rendered.get(urlKey(url) ?? "") ?? [] } : null);
  const homeFacts = withRendered(home?.facts ?? null, `https://${domain}/`);
  const pageOf = new Map(targets.map((t, i) => [t, withRendered(pages[i]?.facts ?? null, t)]));
  const plan = buildSchema({
    domain,
    brand: raw.client.brand,
    market: raw.client.market,
    local: !!raw.localGrids,
    home: homeFacts,
    delivered,
    clusters: [
      ...live.map((c) => ({ name: c.name, keyword: c.headKeyword, target: c.target, page: c.target ? (pageOf.get(c.target) ?? null) : null })),
      // the pages only Nomada's delivered schema names: read, so its status is judged on them, never recommended for
      ...targets.filter((t) => !live.some((c) => c.target === t)).map((t) => ({ name: "", keyword: null, target: null, page: pageOf.get(t) ?? null })),
    ].filter((c) => c.name || c.page),
  });
  const onSite = plan.blocks.filter((b) => b.status === "already").length;
  const STATUS = { already: "Already on your site", partly: "Partly there - add these fields", missing: "Missing" } as const;
  const platform = home?.platform ?? null;
  return (
    <>
      <PageHead micro="Schema" title="Schema for your site" intro="Schema is a short piece of code that tells search engines and AI tools, in a form they read reliably, who you are and what you offer. We've written it for you from what your pages already say. Add it one of three ways below." />
      {plan.delivered.length ? (
        <div className="dash-card" style={{ marginBottom: 16 }}>
          <h2>Schema from Nomada</h2>
          <p className="intro">Schema we've written for your site. We check your live pages each time this opens.</p>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>Schema</th><th>Goes on</th><th>Status</th></tr></thead>
              <tbody>
                {plan.delivered.map((d) => (
                  <tr key={d.key}>
                    <td>{d.label}{d.how ? <div className="sub">{d.how}</div> : null}</td>
                    <td className="muted">{d.where === "sitewide" ? "Every page" : whereText({ where: d.where } as Parameters<typeof whereText>[0])}</td>
                    <td><span className={`pill${d.status === "added" ? " good" : ""}`}>{d.text}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
      <div className="dash-card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <h2 style={{ margin: 0 }}>{plan.delivered.length ? "Anything else to add" : "On your site now"}</h2>
          <CheckAgain />
        </div>
        {plan.delivered.length && !plan.blocks.length ? <p className="intro">Nothing else to add: Nomada's schema covers it.</p> : null}
        {plan.blocks.length || !plan.delivered.length ? <p className="intro">{home ? `We checked ${short(`https://${domain}/`)}${targets.length ? ` and ${targets.length} target page${targets.length === 1 ? "" : "s"}` : ""} just now. ${onSite} of ${plan.blocks.length} ${plan.blocks.length === 1 ? "is" : "are"} already on your site; the code below covers only what's missing.` : "We couldn't reach your site just now. Press Check again in a minute."}</p> : null}
        {plan.blocks.length ? (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Schema</th><th>Goes on</th><th>Status</th></tr></thead>
            <tbody>
              {plan.blocks.map((b) => (
                <tr key={b.id}>
                  <td>{b.label}{b.status === "partly" ? <div className="sub">Add: {b.missing.join(", ")}</div> : null}</td>
                  <td className="muted">{whereText(b)}</td>
                  <td><span className={`pill${b.status === "already" ? " good" : ""}`}>{STATUS[b.status]}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        ) : null}
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
