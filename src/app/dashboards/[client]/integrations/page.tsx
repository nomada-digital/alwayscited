import type { Metadata } from "next";

import GoogleConnect from "@/components/dash/GoogleConnect";
import IntegrationCard from "@/components/dash/Integrations";
import { PageHead } from "@/components/dash/Shell";
import { betaOn } from "@/lib/dash/beta";
import { googleSummary } from "@/lib/dash/google-io";
import { pageData } from "@/lib/dash/page-data";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Integrations", robots: { index: false, follow: false } };

export default async function Integrations({ params }: { params: Promise<{ client: string }> }) {
  const { client: slug } = await params;
  const { ws, raw, demo, viewAs } = await pageData(slug);
  // 16 Nov 2026: Search Console connects by signing in with Google (GoogleConnect); Bing stays on the 2 Nov route.
  // 27 Nov 2026 (Danny, Common's live page had no GA4 card): GA4 has its card again on every client's page, the manual route (add our address as a
  // Viewer, paste the property ID) until Google sign-in carries Analytics. Three cards, one grid, one height.
  const beta = await betaOn();
  const staff = !!viewAs;
  const s = staff ? await googleSummary(supabaseAdmin(), ws.client.id, ws.today) : null;
  const keyPages = (raw.keyPages ?? []).map((k) => k.url);
  // Behind the dashboards beta switch (28 Nov 2026, dash/beta-flag.ts): off, the page is exactly what production served before.
  if (!beta) {
    return (
      <>
        <PageHead micro="Integrations" title="Connect your data" intro="Search Console and Bing fill your keyword groups with real clicks and impressions, and back up your Google positions on days a reading fails. About a minute each." />
        <div className="dash-grid k3">
          <GoogleConnect slug={slug} domain={ws.client.domain} conn={ws.connections.gsc ?? null} canWrite={ws.canWrite} demo={demo} staff={staff} keyPages={keyPages} inspections={s?.inspections ?? []} />
          <IntegrationCard slug={slug} domain={ws.client.domain} provider="bing" conn={ws.connections.bing ?? null} canWrite={ws.canWrite} demo={demo} />
        </div>
        <p className="faint" style={{ fontSize: 12.5, marginTop: 16 }}>We only ever ask for view access, and you can remove our address from your Google or Microsoft account at any time.</p>
      </>
    );
  }
  return (
    <>
      <PageHead micro="Integrations" title="Connect your data" intro="Search Console and Bing fill your keyword groups with real clicks and impressions, and back up your Google positions on days a reading fails. Google Analytics shows the visits that follow. About a minute each." />
      <div className="dash-grid k3 beta-ac28">
        <div id="connect-gsc" className="connect-wrap" style={{ scrollMarginTop: 16 }}><GoogleConnect slug={slug} domain={ws.client.domain} conn={ws.connections.gsc ?? null} canWrite={ws.canWrite} demo={demo} staff={staff} keyPages={keyPages} inspections={s?.inspections ?? []} beta /></div>
        <div id="connect-ga4" className="connect-wrap" style={{ scrollMarginTop: 16 }}><IntegrationCard slug={slug} domain={ws.client.domain} provider="ga4" conn={ws.connections.ga4 ?? null} canWrite={ws.canWrite} demo={demo} beta /></div>
        <div id="connect-bing" className="connect-wrap" style={{ scrollMarginTop: 16 }}><IntegrationCard slug={slug} domain={ws.client.domain} provider="bing" conn={ws.connections.bing ?? null} canWrite={ws.canWrite} demo={demo} beta /></div>
      </div>
      <p className="faint" style={{ fontSize: 12.5, marginTop: 16 }}>We only ever ask for view access, and you can remove our address from your Google or Microsoft account at any time.</p>
    </>
  );
}
