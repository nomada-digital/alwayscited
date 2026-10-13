import type { Metadata } from "next";

import { T } from "@/config/tokens";
import { FUNNEL_SELECTS, FUNNEL_STEPS, funnelDays, funnelTotals, type FunnelDay, type Market } from "@/lib/admin/funnel";
import { supabaseAdmin, supabaseConfigured } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "Funnel",
  robots: { index: false, follow: false },
};

/** Days shown, newest first. */
const DAYS = 30;

const MARKETS: Market[] = ["US", "UK"];

/**
 * /admin/funnel - R152 (Danny, 1 Oct 2026, danny.md line 152). Behind the
 * /admin Basic auth in proxy.ts. Built only from tables that already exist;
 * a step no table records reads "not logged", never zero.
 */
export default async function FunnelAdmin() {
  if (!supabaseConfigured()) return <div style={{ padding: "40px" }}>Database not configured.</div>;
  const db = supabaseAdmin();
  // force-dynamic, and the whole job is "the last N days", so the clock read is deliberate.
  // eslint-disable-next-line react-hooks/purity
  const from = new Date(Date.now() - (DAYS - 1) * 86_400_000).toISOString().slice(0, 10);
  const [{ data: scans, error: sErr }, { data: walks, error: wErr }, { data: orders, error: oErr }] = await Promise.all([
    db.from("scans").select(FUNNEL_SELECTS.scans).gte("created_at", from).limit(50_000),
    db.from("walkthrough_requests").select(FUNNEL_SELECTS.walkthroughs).gte("created_at", from).limit(50_000),
    db.from("orders").select(FUNNEL_SELECTS.orders).gte("created_at", from).limit(50_000),
  ]);
  // A failed read must not print as a quiet day.
  if (sErr) throw new Error(`could not read scans: ${sErr.message}`);
  if (wErr) throw new Error(`could not read walkthrough_requests: ${wErr.message}`);
  if (oErr) throw new Error(`could not read orders: ${oErr.message}`);

  const walkRows = (walks ?? []).map((w) => {
    const s = (w as { scans: { market: string | null } | { market: string | null }[] | null }).scans;
    const market = Array.isArray(s) ? (s[0]?.market ?? null) : (s?.market ?? null);
    return { created_at: (w as { created_at: string }).created_at, market };
  });
  const days = funnelDays(
    {
      scans: (scans ?? []) as { created_at: string; queued_at: string | null; status: string; market: string | null }[],
      walkthroughs: walkRows,
      orders: (orders ?? []) as { created_at: string; market: string }[],
    },
    from,
  );
  const totals = funnelTotals(days);

  const cell = { padding: "6px 8px", borderBottom: `1px solid ${T.hair}`, textAlign: "right", fontVariantNumeric: "tabular-nums" } as const;
  const head = { ...cell, fontWeight: 600, whiteSpace: "nowrap" } as const;
  const counts = (c: FunnelDay["counts"][keyof FunnelDay["counts"]], key: string) =>
    c === null ? (
      <td key={key} colSpan={2} style={{ ...cell, textAlign: "center", color: T.faint }}>
        not logged
      </td>
    ) : (
      MARKETS.map((m) => (
        <td key={`${key}-${m}`} style={{ ...cell, color: c[m] ? T.ink : T.faint }}>
          {c[m]}
        </td>
      ))
    );

  return (
    <div style={{ maxWidth: "1400px", margin: "0 auto", padding: "32px 24px", color: T.ink, fontSize: "14px" }}>
      <h1 style={{ fontSize: "24px", margin: "0 0 4px" }}>Funnel</h1>
      <p style={{ color: T.soft, margin: "0 0 24px" }}>
        Counts per UTC day, the last {DAYS} days, US and UK. Every step is dated by its own row&apos;s created time. Counts only,
        nothing personal. &ldquo;Not logged&rdquo; is a step no table records yet, not a zero.
      </p>
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", fontSize: "13px", minWidth: "100%" }}>
          <thead>
            <tr>
              <th style={{ ...head, textAlign: "left" }} rowSpan={2}>
                Day
              </th>
              {FUNNEL_STEPS.map((s) => (
                <th key={s.key} colSpan={2} style={{ ...head, textAlign: "center" }} title={s.source ?? "not logged"}>
                  {s.label}
                </th>
              ))}
            </tr>
            <tr>
              {FUNNEL_STEPS.flatMap((s) =>
                MARKETS.map((m) => (
                  <th key={`${s.key}-${m}`} style={head}>
                    {m}
                  </th>
                )),
              )}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={{ ...cell, textAlign: "left", fontWeight: 700 }}>All {DAYS} days</td>
              {FUNNEL_STEPS.map((s) => counts(totals[s.key], s.key))}
            </tr>
            {days.length === 0 ? (
              <tr>
                <td style={{ ...cell, textAlign: "left", color: T.soft }} colSpan={1 + FUNNEL_STEPS.length * 2}>
                  Nothing recorded in the last {DAYS} days.
                </td>
              </tr>
            ) : (
              days.map((d) => (
                <tr key={d.day}>
                  <td style={{ ...cell, textAlign: "left", whiteSpace: "nowrap" }}>{d.day}</td>
                  {FUNNEL_STEPS.map((s) => counts(d.counts[s.key], s.key))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
