import type { SupabaseClient } from "@supabase/supabase-js";

import { askForNames } from "./stripe.ts";
import { completedOrder, orderRow } from "./webhook.ts";

/**
 * The agency hub's subscription offer (22 Oct 2026, Danny: "projects section"). A one-off Nomada project includes an
 * alwaystracked profile for a set period; afterwards the client may keep it. The hub (nomada-dashboards, edge
 * function alwayscited-admin, action project_offer) asks /api/hub/offer for a Checkout link for that existing client,
 * and this file builds the Session and handles its completion.
 *
 * Like a pack (packs.ts), the offer is marked metadata[kind]=hub_offer on the Session and its subscription, and the
 * webhook sends a completed one here before the signup path (webhook.ts handleWebhook), so it never makes a client:
 * it writes the order on the client it names. The subscription is then the client's own - no kind on later events
 * is needed, because the order row names it and the subscription handlers find the client by that (signup.ts).
 *
 * The first charge waits for the included period: billing_cycle_anchor at the start of the day after it ends, with
 * no proration, so nothing is charged before then and there is no trial (and so none of the trial emails).
 */

export const HUB_OFFER_KIND = "hub_offer";

const str = (v: unknown) => (typeof v === "string" ? v : "");
const meta = (o: Record<string, unknown>) => (o.metadata ?? {}) as Record<string, unknown>;

export function isHubOffer(o: Record<string, unknown>): boolean {
  return str(meta(o).kind) === HUB_OFFER_KIND;
}

/**
 * When the first charge falls: midnight UTC on the day after `includedUntil`, if that is at least an hour away
 * (Stripe refuses an anchor in the past); otherwise null, and the subscription starts and charges now.
 */
export function firstChargeAt(includedUntil: string | null, nowMs: number = Date.now()): number | null {
  if (!includedUntil || !/^\d{4}-\d{2}-\d{2}$/.test(includedUntil)) return null;
  const t = Date.parse(`${includedUntil}T00:00:00Z`) + 86_400_000;
  return Number.isFinite(t) && t - nowMs >= 3_600_000 ? Math.floor(t / 1000) : null;
}

/** The Checkout Session form: the client's own plan at pricing.ts's price, VAT as /api/checkout charges it, the offer marked. */
export function hubOfferForm(p: {
  clientId: string;
  slug: string;
  market: "uk" | "us";
  email: string | null;
  unitAmount: number;
  name: string;
  anchor: number | null;
  hubProjectId: string;
  origin: string;
}): URLSearchParams {
  const f = new URLSearchParams();
  f.set("mode", "subscription");
  if (p.email) f.set("customer_email", p.email);
  f.set("success_url", `${p.origin}/checkout/done?session={CHECKOUT_SESSION_ID}&plan=tracked&from=offer`);
  f.set("cancel_url", `${p.origin}/alwaystracked`);
  f.set("line_items[0][quantity]", "1");
  f.set("line_items[0][price_data][currency]", p.market === "uk" ? "gbp" : "usd");
  f.set("line_items[0][price_data][unit_amount]", String(Math.round(p.unitAmount * 100)));
  f.set("line_items[0][price_data][recurring][interval]", "month");
  f.set("line_items[0][price_data][product_data][name]", p.name);
  f.set("line_items[0][price_data][tax_behavior]", "exclusive");
  f.set("automatic_tax[enabled]", "true");
  f.set("tax_id_collection[enabled]", "true");
  f.set("billing_address_collection", "required");
  // The buyer's name on its own field, not read off the billing form (askForNames, 23 Oct 2026).
  askForNames(f);
  if (p.anchor) {
    f.set("subscription_data[billing_cycle_anchor]", String(p.anchor));
    f.set("subscription_data[proration_behavior]", "none");
  }
  const m = { kind: HUB_OFFER_KIND, tier: "tracked", quantity: "1", market: p.market, client_domain_id: p.clientId, slug: p.slug, hub_project_id: p.hubProjectId };
  for (const [k, v] of Object.entries(m)) {
    f.set(`metadata[${k}]`, v);
    f.set(`subscription_data[metadata][${k}]`, v);
  }
  return f;
}

/**
 * checkout.session.completed for an offer: the order, on the client the Session names. A client ended at the close
 * of its included period (and still inside the 90 days) is active again. False on a failed write, so Stripe retries.
 */
export async function onHubOfferCompleted(db: SupabaseClient, session: Record<string, unknown>): Promise<boolean> {
  const m = meta(session);
  const clientId = str(m.client_domain_id);
  if (!/^[0-9a-f-]{36}$/.test(clientId)) {
    console.error(`[stripe] hub offer ${str(session.id)} names no client; nothing written`);
    return true;
  }
  const { data: client, error: cErr } = await db.from("client_domains").select("id, status").eq("id", clientId).maybeSingle();
  if (cErr) {
    console.error(`[stripe] hub offer ${str(session.id)}: could not read the client: ${cErr.message}`);
    return false;
  }
  if (!client) {
    console.error(`[stripe] hub offer ${str(session.id)}: client ${clientId} is gone; nothing written`);
    return true;
  }
  const built = orderRow(completedOrder(session), clientId, null);
  if (!built.row) {
    console.error(`[stripe] hub offer ${str(session.id)}: order not written (${built.reason})`);
    return true;
  }
  const { error } = await db.from("orders").upsert(built.row, { onConflict: "stripe_session_id", ignoreDuplicates: true });
  if (error) {
    console.error(`[stripe] hub offer ${str(session.id)}: order not written: ${error.message}`);
    return false;
  }
  if (client.status === "ended") {
    const { error: uErr } = await db.from("client_domains").update({ status: "active" }).eq("id", clientId).eq("status", "ended");
    if (uErr) {
      console.error(`[stripe] hub offer ${str(session.id)}: client not reactivated: ${uErr.message}`);
      return false;
    }
  }
  console.log(`[stripe] hub offer taken for ${str(m.slug) || clientId} (hub project ${str(m.hub_project_id)})`);
  return true;
}
