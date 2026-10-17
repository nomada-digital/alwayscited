import type { Metadata } from "next";

import IntegrationCard from "@/components/dash/Integrations";
import { PageHead } from "@/components/dash/Shell";
import { pageData } from "@/lib/dash/page-data";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Integrations", robots: { index: false, follow: false } };

export default async function Integrations({ params }: { params: Promise<{ client: string }> }) {
  const { client: slug } = await params;
  const { ws, base } = await pageData(slug);
  return (
    <>
      <PageHead micro="Integrations" title="Connect your data" intro="Read-only connections. Search Console and Bing fill your keyword groups with real clicks and impressions; Analytics shows the visits AI sends you." />
      <div className="dash-grid k3">
        {(["gsc", "bing", "ga4"] as const).map((p) => <IntegrationCard key={p} slug={slug} provider={p} conn={ws.connections[p] ?? null} canWrite={ws.canWrite} />)}
      </div>
      <p className="faint" style={{ fontSize: 12.5, marginTop: 16 }}>We only ever ask for read access, and you can remove it from your Google or Microsoft account at any time.</p>
    </>
  );
}
