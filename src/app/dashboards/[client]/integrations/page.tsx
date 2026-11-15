import type { Metadata } from "next";

import GoogleConnect from "@/components/dash/GoogleConnect";
import IntegrationCard from "@/components/dash/Integrations";
import { PageHead } from "@/components/dash/Shell";
import { googleSummary } from "@/lib/dash/google-io";
import { pageData } from "@/lib/dash/page-data";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Integrations", robots: { index: false, follow: false } };

export default async function Integrations({ params }: { params: Promise<{ client: string }> }) {
  const { client: slug } = await params;
  const { ws, raw, demo, viewAs } = await pageData(slug);
  // 15 Nov 2026: Search Console and GA4 connect direct (GoogleConnect); Bing stays on the 2 Nov route.
  const staff = !!viewAs;
  const s = staff ? await googleSummary(supabaseAdmin(), ws.client.id, ws.today) : null;
  const keyPages = (raw.keyPages ?? []).map((k) => k.url);
  return (
    <>
      <PageHead micro="Integrations" title="Connect your data" intro="Add our address to each tool, then press Check connection. Search Console and Bing fill your keyword groups with real clicks and impressions; Analytics shows your visits and where they come from. About two minutes each." />
      <div className="dash-grid k3">
        {(["gsc", "ga4"] as const).map((p) => <GoogleConnect key={p} slug={slug} domain={ws.client.domain} provider={p} conn={ws.connections[p] ?? null} canWrite={ws.canWrite} demo={demo} staff={staff} keyPages={keyPages} inspections={s?.inspections ?? []} />)}
        <IntegrationCard slug={slug} domain={ws.client.domain} provider="bing" conn={ws.connections.bing ?? null} canWrite={ws.canWrite} demo={demo} />
      </div>
      <p className="faint" style={{ fontSize: 12.5, marginTop: 16 }}>We only ever ask for view access, and you can remove our address from your Google or Microsoft account at any time.</p>
    </>
  );
}
