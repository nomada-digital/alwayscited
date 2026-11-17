import type { Metadata } from "next";
import { notFound } from "next/navigation";

import ListingsChecklist from "@/components/dash/ListingsChecklist";
import { PageHead } from "@/components/dash/Shell";
import { localListingsFor } from "@/config/local-listings";
import { listingTicks } from "@/lib/dash/listings";
import { pageData } from "@/lib/dash/page-data";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Local listings", robots: { index: false, follow: false } };

/**
 * Local listings (Danny, 17 Nov 2026): why consistent directory listings matter, the details to use on every one,
 * and the checklist in order, for the customer to work through - or to ask us to. Only for a customer with a list
 * (config/local-listings.ts). No prices.
 */
export default async function Listings({ params }: { params: Promise<{ client: string }> }) {
  const { client: slug } = await params;
  const list = localListingsFor(slug);
  if (!list) notFound();
  const { raw, demo } = await pageData(slug);
  const ticks = await listingTicks(raw.client.id);
  const d = list.details;
  const rows: [string, React.ReactNode][] = [
    ["Business name", d.name],
    ["Location", d.location],
    ["Phone", d.phone],
    ["Website", <a key="w" href={d.website} target="_blank" rel="noopener noreferrer">{d.website}</a>],
    ["Category", d.category],
    ["Area you serve", d.serves],
  ];
  return (
    <>
      <PageHead micro={<>Local listings · {list.area}</>} title="Get listed in the right places" intro={`Google and AI assistants check that your business name, area, phone and website match across the directories they trust. When your listings agree, it helps you rank in the ${list.area} map results and get named in AI answers.`} />
      <div className="dash-card" id="details">
        <div className="dash-card-head"><div><h2>Use these details everywhere</h2><p className="intro">Copy them exactly, on every listing, so they all match.</p></div></div>
        <div className="tbl-wrap">
          <table className="tbl">
            <tbody>{rows.map(([k, v]) => <tr key={k}><td className="muted" style={{ width: 180 }}>{k}</td><td style={{ fontWeight: 600 }}>{v}</td></tr>)}</tbody>
          </table>
        </div>
      </div>
      <div className="dash-card" id="checklist">
        <div className="dash-card-head"><div><h2>Your listings checklist</h2><p className="intro">In order: the quickest wins first. Each link goes to the place to add or manage your listing.</p></div></div>
        <ListingsChecklist slug={slug} items={list.items} ticks={ticks} canTick={!demo && (raw.role === "owner" || raw.role === "editor")} />
      </div>
      <div className="dash-card">
        <p style={{ margin: 0 }}><strong>Prefer us to do it?</strong> This is a service we provide - reply to {list.contact}.</p>
      </div>
    </>
  );
}
