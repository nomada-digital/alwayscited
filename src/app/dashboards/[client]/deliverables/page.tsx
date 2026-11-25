import type { Metadata } from "next";

import DeliverableCard from "@/components/dash/DeliverableCard";
import { PageHead } from "@/components/dash/Shell";
import { pageData } from "@/lib/dash/page-data";
import { type CustomerDeliverable, groupOf } from "@/lib/deliverables/core";
import { readCustomerDeliverables } from "@/lib/deliverables/store";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Deliverables", robots: { index: false, follow: false } };

const GROUPS = [
  { key: "you", title: "For you to do", intro: "Changes to your site that only you can make. Copy the file, make the change, then tick it off." },
  { key: "us", title: "We are making these", intro: "Changes we make ourselves. They show as completed here, with our evidence, when they are done." },
  { key: "done", title: "Completed", intro: null },
] as const;

export default async function Deliverables({ params }: { params: Promise<{ client: string }> }) {
  const { client: slug } = await params;
  const { ws, demo } = await pageData(slug);
  const read = await readCustomerDeliverables(ws.client.id);
  const items: CustomerDeliverable[] = read.ok ? read.items : [];
  return (
    <>
      <PageHead micro="Deliverables" title="Changes for your site" intro="What we recommend changing on your site, with everything you need to do it. We do not have access to your site, so these are yours to make; each one comes with the findings behind it and a file you can copy or download." />
      {!read.ok ? (
        <div className="banner warn" role="alert"><span>Your deliverables could not be read just now. Nothing has been lost; try again in a minute.</span></div>
      ) : items.length === 0 ? (
        <div className="dash-card">
          <div className="empty">
            <b>Nothing to do yet</b>
            When we find a change to make on your site, it appears here with the findings and a file to copy.
          </div>
        </div>
      ) : (
        GROUPS.map((g) => {
          const list = items.filter((d) => groupOf(d) === g.key);
          if (!list.length) return null;
          return (
            <section key={g.key} className="dlv-group" aria-label={g.title}>
              <h2 className="dlv-group-title">{g.title}<span className="faint">{list.length}</span></h2>
              {g.intro ? <p className="muted dlv-group-intro">{g.intro}</p> : null}
              {list.map((d) => <DeliverableCard key={d.id} d={d} slug={slug} mayTick={ws.canWrite} demo={demo} />)}
            </section>
          );
        })
      )}
    </>
  );
}
