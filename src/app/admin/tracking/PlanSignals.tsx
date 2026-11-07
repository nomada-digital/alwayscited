import { T } from "@/config/tokens";
import { ADMIN_LIMITS } from "@/lib/tracking/decide";
import { REQUEST_NOTE_MAX, money, monthDay, upsellSignals } from "@/lib/dash/plan-change";
import { readPlanRequests } from "@/lib/dash/plan-requests";
import type { FootRow, Raw, RawClient, RawCluster, RawKeyword } from "@/lib/dash/types";
import type { SupabaseClient } from "@supabase/supabase-js";

import { ActionForm } from "./ActionForm";
import { decidePlanRequest } from "./actions";

type Row = Record<string, unknown>;

/**
 * Plan requests and upsell signals (Danny, 7 Nov 2026), at the head of /admin/tracking: every booked swap and
 * add-to-plan request, with Confirm and Decline for the requests, and for each paid client the tracking-only
 * clusters and the page-1 and close-to-page-1 searches they do not track yet - each one a cluster they could pay us
 * to work on. Read from the same rows the dashboard draws (plan-change.ts), so the two cannot disagree.
 */
export default async function PlanSignals({ db, clients, clusters, keywords }: { db: SupabaseClient; clients: Row[]; clusters: Row[]; keywords: Row[] }) {
  const paid = clients.filter((c) => c.tier !== "tracked");
  const rows = await Promise.all(
    paid.map(async (c) => {
      const id = c.id as string;
      const [requests, { data: footRows, error: footErr }] = await Promise.all([
        readPlanRequests(db, id).catch(() => ({ swap: null, upgrades: [] })),
        db.from("keyword_footprints").select("pulled_on, rows").eq("client_domain_id", id).order("pulled_on", { ascending: false }).limit(1),
      ]);
      // A failed snapshot read counts nothing rather than failing the page; the cell says it could not be read.
      if (footErr) console.warn(`[admin] footprint read failed for ${c.domain as string}: ${footErr.message}`);
      const f = (footRows ?? [])[0] as { pulled_on: string; rows: FootRow[] } | undefined;
      const raw: Pick<Raw, "client" | "clusters" | "keywords" | "footprint" | "planRequests"> = {
        client: { id, domain: c.domain as string, brand: (c.brand_name as string | null) ?? null, brand_aliases: (c.brand_aliases as string[] | null) ?? [], tier: c.tier as RawClient["tier"] } as RawClient,
        clusters: clusters.filter((x) => x.client_domain_id === id) as unknown as RawCluster[],
        keywords: keywords.filter((x) => x.client_domain_id === id) as unknown as RawKeyword[],
        footprint: f ? { pulled_on: f.pulled_on, rows: Array.isArray(f.rows) ? f.rows : [] } : null,
        planRequests: requests,
      };
      return { c, raw, s: upsellSignals(raw), footFailed: !!footErr };
    }),
  );
  const name = (raw: (typeof rows)[number]["raw"], cid: string | null) => raw.clusters.find((x) => x.id === cid)?.name ?? "a cluster";
  const cell = { padding: "6px 8px", borderBottom: `1px solid ${T.line}`, verticalAlign: "top" } as const;
  const open = rows.filter((r) => r.s.swap || r.s.upgrades.length);
  return (
    <section id="plan-requests" style={{ border: `1px solid ${T.line}`, borderRadius: "10px", padding: "16px", marginBottom: "24px" }}>
      <h2 style={{ fontSize: "16px", margin: "0 0 4px" }}>Plan requests and upsell signals</h2>
      <p style={{ color: T.soft, margin: "0 0 10px", fontSize: "13px" }}>
        Swaps apply themselves on the 1st. An add-to-plan request charges nothing: change the subscription in Stripe with the customer first, then Confirm here, which puts the cluster on their plan.
      </p>
      {open.length ? (
        open.map(({ c, raw, s }) => (
          <div key={c.id as string} style={{ marginBottom: "12px" }}>
            <b>{c.domain as string}</b>
            {s.swap ? (
              <p style={{ margin: "4px 0" }}>
                Swap booked for {monthDay(s.swap.effective_on)} by {s.swap.requested_by}: &ldquo;{name(raw, s.swap.from_cluster_id)}&rdquo; out, &ldquo;{name(raw, s.swap.to_cluster_id)}&rdquo; in.
              </p>
            ) : null}
            {s.upgrades.map((u) => (
              <div key={u.id} style={{ margin: "4px 0" }}>
                Add to plan: {u.cluster_id ? <>&ldquo;{name(raw, u.cluster_id)}&rdquo;</> : <>a cluster for &ldquo;{u.keyword}&rdquo; (not set up yet)</>}, {money(u.price_amount, u.currency) ?? "price to agree"}
                {u.price_source && u.price_source !== "call" ? ` a month (${u.price_source === "sector" ? "sector price" : "their order's per-cluster price"})` : ""} - asked {u.created_at.slice(0, 10)} by {u.requested_by}
                <ActionForm action={decidePlanRequest} submit="Save">
                  <input type="hidden" name="request" value={u.id} maxLength={ADMIN_LIMITS.id} />
                  <select name="decision" defaultValue="confirmed" style={{ padding: "6px 8px", border: `1px solid ${T.line}`, borderRadius: "6px", fontSize: "13px" }}>
                    <option value="confirmed">Confirmed: Stripe updated</option>
                    <option value="declined">Declined</option>
                  </select>
                  <input name="note" placeholder="Note (optional)" maxLength={REQUEST_NOTE_MAX} style={{ padding: "6px 8px", border: `1px solid ${T.line}`, borderRadius: "6px", fontSize: "13px" }} />
                </ActionForm>
              </div>
            ))}
          </div>
        ))
      ) : (
        <p style={{ margin: "0 0 10px", fontSize: "13px" }}>No swap booked and no add-to-plan request waiting.</p>
      )}
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", fontSize: "13px", width: "100%" }}>
          <thead>
            <tr style={{ textAlign: "left", color: T.soft }}>
              <th style={cell}>Paid client</th>
              <th style={cell}>Tracking-only clusters</th>
              <th style={cell}>Page 1, not tracked</th>
              <th style={cell}>11 to 20, not tracked</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ c, s, footFailed }) => (
              <tr key={c.id as string}>
                <td style={cell}>{c.domain as string} <span style={{ color: T.soft }}>{c.tier as string}</span></td>
                <td style={cell}>{s.trackingOnly.length ? s.trackingOnly.join(", ") : <span style={{ color: T.soft }}>none</span>}</td>
                <td style={cell}>{footFailed ? "not read" : s.page1}</td>
                <td style={cell}>{footFailed ? "not read" : s.close}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
