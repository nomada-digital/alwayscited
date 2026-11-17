import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";

import { dashFixturePath } from "./fixture";

/**
 * The customer's ticks on Local listings (config/local-listings.ts), saved per customer as dashboard_events rows -
 * event LISTING_EVENT, props {item, done} - so no new table: the latest row for an item is its state, and the rows
 * are the history of who ticked what and when.
 */
export const LISTING_EVENT = "local_listing_status";

export async function listingTicks(clientId: string): Promise<Record<string, boolean>> {
  if (dashFixturePath()) return {};
  const { data, error } = await supabaseAdmin()
    .from("dashboard_events")
    .select("props, created_at")
    .eq("client_domain_id", clientId)
    .eq("event", LISTING_EVENT)
    .order("created_at", { ascending: true })
    .limit(1000);
  if (error) {
    console.warn(`[dash] local listings read failed: ${error.message}`);
    return {};
  }
  const out: Record<string, boolean> = {};
  for (const r of data ?? []) {
    const p = r.props as { item?: unknown; done?: unknown } | null;
    if (typeof p?.item === "string" && typeof p.done === "boolean") out[p.item] = p.done;
  }
  return out;
}

export async function saveListingTick(clientId: string, email: string, item: string, done: boolean): Promise<boolean> {
  const { error } = await supabaseAdmin().from("dashboard_events").insert({ client_domain_id: clientId, member_email: email, event: LISTING_EVENT, path: "/listings", props: { item, done } });
  if (error) console.warn(`[dash] local listing tick not saved: ${error.message}`);
  return !error;
}
