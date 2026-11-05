import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { monthlyUnitCap } from "./fatgrid";

/**
 * The Fatgrid unit ledger (fatgrid_usage, migration 20261106000000). On the Pro plan units are the bill, so the
 * monthly cap covers everything that reads Fatgrid: the shortlist, and the free scan's difficulty score.
 */
const monthStart = (d = new Date()) => `${d.toISOString().slice(0, 7)}-01`;

/** Units spent so far this calendar month. A ledger that cannot be read counts as the cap reached: fail closed. */
export async function unitsThisMonth(db: SupabaseClient): Promise<number> {
  const { data, error } = await db.from("fatgrid_usage").select("units").gte("used_at", monthStart());
  // Before migration 20261106000000 there is no ledger: nothing has been counted, and the scan scores as it always did.
  if (error && /fatgrid_usage/.test(error.message) && /does not exist|schema cache|could not find/i.test(error.message)) return 0;
  if (error) return monthlyUnitCap();
  return (data ?? []).reduce((a, r) => a + (Number(r.units) || 0), 0);
}

/** Units the month has left under its cap. */
export async function unitsLeft(db: SupabaseClient): Promise<number> {
  return Math.max(0, monthlyUnitCap() - (await unitsThisMonth(db)));
}

/** One line in the ledger. Never fatal: the read it records has already been paid for. */
export async function recordUnits(db: SupabaseClient, row: { source: "shortlist" | "scan_difficulty" | "manual"; units: number; clientId?: string | null; runId?: string | null }): Promise<void> {
  if (row.units <= 0) return;
  const { error } = await db.from("fatgrid_usage").insert({ source: row.source, units: row.units, client_domain_id: row.clientId ?? null, run_id: row.runId ?? null });
  if (error) console.warn(`[csm] ${row.units} Fatgrid units (${row.source}) not recorded: ${error.message}`);
}
