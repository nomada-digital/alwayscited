import type { SupabaseClient } from "@supabase/supabase-js";

import { clusterLimitFor } from "../tracking/limits.ts";

/**
 * Extra tracking packs, bought self-serve through Stripe Checkout (Danny,
 * 17 Oct 2026: "take them straight to Stripe Checkout ... then provision the
 * extra allowance automatically via the webhook").
 *
 * A pack is its own subscription on the client's existing Stripe customer,
 * marked metadata[kind]=pack on the session and on the subscription. The
 * webhook sends anything so marked here (webhook.ts handleWebhook) before the
 * signup path, so a pack can never make a client; and the main subscription's
 * own handlers never see it, because no order row names it.
 *
 * cluster_limit = 10 + 5 x (packs on the main subscription + the quantity of
 * every live pack subscription). Both writers compute the same sum: the main
 * subscription's handler (signup.ts) and this file's.
 */

export const PACK_KIND = "pack";
/** Pack subscriptions that count: Stripe is charging, or retrying a charge. */
export const LIVE_PACK = ["active", "trialing", "past_due"] as const;

const str = (v: unknown) => (typeof v === "string" ? v : "");
const meta = (o: Record<string, unknown>) => (o.metadata ?? {}) as Record<string, unknown>;

export function isPack(o: Record<string, unknown>): boolean {
  return str(meta(o).kind) === PACK_KIND;
}

/** The Checkout Session form for one pack: the client's own customer, pricing.ts's price, the pack marked. */
export function packCheckoutForm(p: { customer: string; clientId: string; slug: string; market: "us" | "uk"; unitAmount: number; name: string; returnTo: string }): URLSearchParams {
  const f = new URLSearchParams();
  f.set("mode", "subscription");
  f.set("customer", p.customer);
  f.set("success_url", `${p.returnTo}?pack=done#pack`);
  f.set("cancel_url", `${p.returnTo}#pack`);
  f.set("line_items[0][quantity]", "1");
  f.set("line_items[0][price_data][currency]", p.market === "uk" ? "gbp" : "usd");
  f.set("line_items[0][price_data][unit_amount]", String(Math.round(p.unitAmount * 100)));
  f.set("line_items[0][price_data][recurring][interval]", "month");
  f.set("line_items[0][price_data][product_data][name]", p.name);
  // VAT the way /api/checkout does it (R129): tax-exclusive prices through Stripe Tax.
  f.set("line_items[0][price_data][tax_behavior]", "exclusive");
  f.set("automatic_tax[enabled]", "true");
  f.set("customer_update[address]", "auto");
  // A VAT invoice for every pack too (22 Oct 2026, invoice.ts): the billing address required and a tax ID taken, as
  // /api/checkout takes them. With an existing customer Stripe needs customer_update[name] for the tax ID.
  f.set("billing_address_collection", "required");
  f.set("tax_id_collection[enabled]", "true");
  f.set("customer_update[name]", "auto");
  for (const [k, v] of Object.entries({ kind: PACK_KIND, client_domain_id: p.clientId, slug: p.slug, market: p.market })) {
    f.set(`metadata[${k}]`, v);
    f.set(`subscription_data[metadata][${k}]`, v);
  }
  return f;
}

/** The pack's quantity on its subscription: its one item's quantity, 1 when Stripe says nothing. */
export function packQuantity(sub: Record<string, unknown>): number {
  const items = (((sub.items ?? {}) as Record<string, unknown>).data ?? []) as Record<string, unknown>[];
  const q = items.reduce((n, it) => n + (typeof it.quantity === "number" && it.quantity > 0 ? it.quantity : 0), 0);
  return q || 1;
}

/** The table is not there yet: the 20261017010000 migration. */
function absent(e: { code?: string; message: string } | null): boolean {
  return !!e && (e.code === "42P01" || e.code === "PGRST205" || /relation .* does not exist|Could not find the table/i.test(e.message));
}

/** Live packs on a client: a number, 0 before the table exists, or an error message (the caller retries). */
export async function livePacks(db: SupabaseClient, clientId: string): Promise<number | string> {
  const { data, error } = await db.from("tracking_packs").select("quantity").eq("client_domain_id", clientId).in("status", [...LIVE_PACK]);
  if (absent(error)) return 0;
  if (error) return `could not read packs: ${error.message}`;
  return (data ?? []).reduce((n, r) => n + (Number(r.quantity) || 0), 0);
}

/** Whether packs can be sold: the table that records them exists. */
export async function packsReady(db: SupabaseClient): Promise<boolean> {
  const { error } = await db.from("tracking_packs").select("stripe_subscription_id", { head: true, count: "exact" }).limit(1);
  return !error;
}

async function setLimit(db: SupabaseClient, clientId: string): Promise<boolean> {
  const n = await livePacks(db, clientId);
  if (typeof n === "string") {
    console.error(`[stripe] ${n}`);
    return false;
  }
  // Packs on the main subscription are counted by its own handler, which no checkout sells today; this sum is the packs here.
  const { error } = await db.from("client_domains").update({ cluster_limit: clusterLimitFor(n) }).eq("id", clientId);
  if (error) {
    console.error(`[stripe] cluster_limit not set after a pack: ${error.message}`);
    return false;
  }
  return true;
}

async function record(db: SupabaseClient, row: { id: string; clientId: string; quantity: number; status: string; customer: string | null }): Promise<boolean> {
  const { error } = await db.from("tracking_packs").upsert(
    { stripe_subscription_id: row.id, client_domain_id: row.clientId, quantity: row.quantity, status: row.status, stripe_customer_id: row.customer, updated_at: new Date().toISOString() },
    { onConflict: "stripe_subscription_id" },
  );
  if (error) {
    console.error(`[stripe] pack ${row.id} not recorded: ${error.message}`);
    return false;
  }
  return true;
}

/** A pack's Checkout completed: record it live and raise the client's limit. False makes Stripe retry. */
export async function onPackCompleted(db: SupabaseClient, session: Record<string, unknown>): Promise<boolean> {
  const id = str(session.subscription);
  const clientId = str(meta(session).client_domain_id);
  if (!/^sub_[A-Za-z0-9]+$/.test(id) || !/^[0-9a-f-]{36}$/.test(clientId)) {
    console.error(`[stripe] pack session without its subscription or client: ${str(session.id)}`);
    return true;
  }
  if (!(await record(db, { id, clientId, quantity: 1, status: "active", customer: str(session.customer) || null }))) return false;
  return setLimit(db, clientId);
}

/** A pack subscription changed or ended: record its status and quantity, and set the limit again. */
export async function onPackChanged(db: SupabaseClient, sub: Record<string, unknown>, ended = false): Promise<boolean> {
  const id = str(sub.id);
  const clientId = str(meta(sub).client_domain_id);
  if (!/^sub_[A-Za-z0-9]+$/.test(id) || !/^[0-9a-f-]{36}$/.test(clientId)) return true;
  const status = ended ? "canceled" : str(sub.status) || "active";
  if (!(await record(db, { id, clientId, quantity: packQuantity(sub), status, customer: str(sub.customer) || null }))) return false;
  return setLimit(db, clientId);
}
