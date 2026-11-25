import type { Metadata } from "next";
import { notFound } from "next/navigation";

import "@/app/dashboards/dash.css";
import DeliverableCard from "@/components/dash/DeliverableCard";
import { readPreview } from "@/lib/deliverables/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const metadata: Metadata = { title: "Deliverable preview", robots: { index: false, follow: false } };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * A deliverable exactly as its customer will see it, drafts included (25 Nov 2026), so it can be read before it is
 * published. Behind the /admin Basic auth. The card is drawn as a demo: the tick shows but nothing is saved.
 */
export default async function Preview({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const d = await readPreview(id);
  if (!d) notFound();
  return (
    <div className="dash">
      <div className="dash-main">
        <div className="dash-inner">
          <div className="banner warn" style={{ marginBottom: 16 }} role="note"><span><b>Preview.</b> This is how the customer sees it once it is published. Nothing you do here is saved. <a href="/admin/deliverables">Back to deliverables</a></span></div>
          <DeliverableCard d={d} slug="preview" mayTick demo />
        </div>
      </div>
    </div>
  );
}
