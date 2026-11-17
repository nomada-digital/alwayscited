"use client";

import { useState } from "react";

import type { ListingItem } from "@/config/local-listings";

const STATUS = { listed: ["Listed", "good"], not_listed: ["Not listed", "bad"], check: ["Check", "warn"] } as const;
const COST = { free: "Free", paid: "Paid", free_or_paid: "Free, paid extras" } as const;

/**
 * Local listings' checklist (17 Nov 2026): each directory in order, where it stands, free or paid, the link to add or
 * manage the listing, and a tick the customer sets themselves, saved per customer (/api/dash/[client]/listings).
 * Read-only for a viewer, a demo and a view-as link.
 */
export default function ListingsChecklist({ slug, items, ticks, canTick }: { slug: string; items: ListingItem[]; ticks: Record<string, boolean>; canTick: boolean }) {
  const [done, setDone] = useState(ticks);
  const [err, setErr] = useState<string | null>(null);
  const tick = async (key: string, on: boolean) => {
    setErr(null);
    setDone((d) => ({ ...d, [key]: on }));
    const r = await fetch(`/api/dash/${slug}/listings`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ item: key, done: on }) }).catch(() => null);
    const j = (await r?.json().catch(() => null)) as { ok?: boolean; message?: string } | null;
    if (!j?.ok) {
      setDone((d) => ({ ...d, [key]: !on }));
      setErr(j?.message ?? "That did not save. Try again.");
    }
  };
  const count = items.filter((i) => done[i.key]).length;
  return (
    <>
      <p className="muted" style={{ margin: "0 0 10px", fontSize: 13 }}>{count} of {items.length} done{canTick ? ". Tick each one off as you go." : "."}</p>
      {err ? <p className="pill bad" role="alert" style={{ marginBottom: 10 }}>{err}</p> : null}
      <div className="tbl-wrap">
        <table className="tbl">
          <thead><tr><th aria-label="Done" /><th>#</th><th>Listing</th><th>What to do</th><th>Status</th><th>Free or paid</th><th>Link</th></tr></thead>
          <tbody>
            {items.map((i, n) => {
              const on = !!done[i.key];
              const [label, tone] = on ? (["Done", "good"] as const) : STATUS[i.status];
              return (
                <tr key={i.key} style={on ? { opacity: 0.65 } : undefined}>
                  <td><input id={`listing-${i.key}`} type="checkbox" aria-label={`${i.name}: done`} checked={on} disabled={!canTick} onChange={(e) => tick(i.key, e.target.checked)} /></td>
                  <td className="faint num">{n + 1}</td>
                  <td style={{ fontWeight: 600 }}>{i.name}</td>
                  <td className="muted" style={{ fontSize: 13 }}>{i.action}</td>
                  <td><span className={`pill ${tone}`}>{label}</span></td>
                  <td className="muted" style={{ fontSize: 13, whiteSpace: "nowrap" }}>{COST[i.cost]}</td>
                  <td style={{ fontSize: 13 }}>{i.links.map((l, k) => <span key={l.url}>{k ? ", " : ""}<a href={l.url} target="_blank" rel="noopener noreferrer">{l.label}</a></span>)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
