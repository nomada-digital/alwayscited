import type { SupabaseClient } from "@supabase/supabase-js";

import { askForNames, type SubscriptionRead } from "./stripe.ts";

/**
 * Contract offers (Danny, 31 Oct 2026): a private checkout link for a client on a signed agreement, so they sign up
 * through alwayscited.com at the agreed monthly price, for the agreed number of payments, and the normal signup builds
 * their client, dashboard and login. The terms are a row in public.contract_offers (migration
 * 20261031000000_contract_offers.sql), never the code: this repository is public and an agreement's price is not.
 *
 * /checkout/offer/<token> shows the terms; /api/checkout/offer/<token> opens Stripe Checkout with contractOfferForm.
 * The Session and its subscription carry metadata[kind]=contract_offer. Unlike a pack or the hub's offer, a completed
 * one does run the signup path (webhook.ts handleWebhook): first onContractOfferCompleted sets the subscription's
 * cancel_at after the agreed number of payments and marks the row used, then signup makes the client as for any order.
 */

export const CONTRACT_OFFER_KIND = "contract_offer";

export type ContractOffer = {
  id: string;
  client_name: string;
  agreement_date: string;
  tier: "tracked" | "mentioned" | "cited";
  market: "uk" | "us";
  website: string;
  keyword: string | null;
  email: string | null;
  monthly_amount: number;
  charges: number;
  first_charge_on: string | null;
  expires_at: string;
  used_at: string | null;
};

export const OFFER_COLUMNS = "id, client_name, agreement_date, tier, market, website, keyword, email, monthly_amount, charges, first_charge_on, expires_at, used_at";

/** The token in the link: 32 random bytes as hex, as a login token. Only its sha256 is stored. */
export function isOfferToken(t: string): boolean {
  return /^[0-9a-f]{64}$/.test(t);
}

export function offerState(o: Pick<ContractOffer, "expires_at" | "used_at">, nowMs: number = Date.now()): "open" | "used" | "expired" {
  if (o.used_at) return "used";
  const ends = Date.parse(o.expires_at);
  return Number.isFinite(ends) && ends > nowMs ? "open" : "expired";
}

/**
 * The first payment's moment: midnight UTC on `day`, when that is at least an hour away (Stripe refuses an anchor in
 * the past); otherwise null, and the first payment is taken at checkout.
 */
export function firstChargeOf(day: string | null, nowMs: number = Date.now()): number | null {
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const t = Date.parse(`${day}T00:00:00Z`);
  return Number.isFinite(t) && t - nowMs >= 3_600_000 ? Math.floor(t / 1000) : null;
}

/** `months` calendar months after `sec`, in UTC, the day clamped to the month's last as Stripe bills a 31st. */
export function addMonthsUtc(sec: number, months: number): number {
  const d = new Date(sec * 1000);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + months;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const out = Date.UTC(y, m, Math.min(d.getUTCDate(), last), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds());
  return Math.floor(out / 1000);
}

/**
 * When the subscription ends: `charges` months after its billing anchor - the first payment, whether taken at
 * checkout or on first_charge_on - so exactly `charges` payments are taken and the one after is never invoiced.
 */
export function cancelAtFor(anchorSec: number, charges: number): number {
  return addMonthsUtc(anchorSec, charges);
}

const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];

function longDate(day: string): string {
  const t = Date.parse(`${day}T12:00:00Z`);
  return Number.isFinite(t) ? new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) : day;
}

export function offerMoney(o: Pick<ContractOffer, "monthly_amount" | "market">): string {
  const amount = o.monthly_amount / 100;
  const text = amount.toLocaleString("en-GB", { minimumFractionDigits: Number.isInteger(amount) ? 0 : 2, maximumFractionDigits: 2 });
  return o.market === "uk" ? `£${text} + VAT` : `$${text}`;
}

/** What the offer page and Stripe's form both say, so the two cannot drift. */
export function offerTerms(o: Pick<ContractOffer, "monthly_amount" | "market" | "charges" | "agreement_date" | "first_charge_on">): { price: string; payments: string; agreement: string; first: string | null } {
  const n = o.charges <= 12 ? WORDS[o.charges] : String(o.charges);
  return {
    price: `${offerMoney(o)} a month`,
    payments: o.charges === 1 ? "One payment" : `${n![0]!.toUpperCase()}${n!.slice(1)} monthly payments, then the plan ends`,
    agreement: `Billed under the agreement signed on ${longDate(o.agreement_date)}. Its terms apply in place of alwayscited.com's standard terms.`,
    first: o.first_charge_on ? `First payment on ${longDate(o.first_charge_on)}.` : null,
  };
}

/** The Checkout Session form. Everything priced comes from the offer row, nothing from the request but the email. */
export function contractOfferForm(o: ContractOffer, p: { email: string; planName: string; origin: string; backUrl: string; anchor: number | null }): URLSearchParams {
  const t = offerTerms(o);
  const f = new URLSearchParams();
  f.set("mode", "subscription");
  f.set("customer_email", p.email);
  f.set("success_url", `${p.origin}/checkout/done?session={CHECKOUT_SESSION_ID}&plan=${o.tier}&from=site`);
  f.set("cancel_url", p.backUrl);
  f.set("line_items[0][quantity]", "1");
  f.set("line_items[0][price_data][currency]", o.market === "uk" ? "gbp" : "usd");
  f.set("line_items[0][price_data][unit_amount]", String(o.monthly_amount));
  f.set("line_items[0][price_data][recurring][interval]", "month");
  f.set("line_items[0][price_data][product_data][name]", p.planName);
  f.set("line_items[0][price_data][product_data][description]", `${t.payments}. ${o.website}.`);
  // VAT as /api/checkout charges it (session.ts, R129).
  f.set("line_items[0][price_data][tax_behavior]", "exclusive");
  f.set("automatic_tax[enabled]", "true");
  f.set("tax_id_collection[enabled]", "true");
  f.set("billing_address_collection", "required");
  askForNames(f);
  if (p.anchor) {
    f.set("subscription_data[billing_cycle_anchor]", String(p.anchor));
    f.set("subscription_data[proration_behavior]", "none");
  }
  f.set("custom_text[submit][message]", t.agreement);
  const m = {
    kind: CONTRACT_OFFER_KIND,
    offer_id: o.id,
    tier: o.tier,
    sector: "",
    quantity: "1",
    market: o.market,
    keyword: o.keyword ?? "",
    website: o.website,
    monthly_amount: String(o.monthly_amount),
    charges: String(o.charges),
  };
  for (const [k, v] of Object.entries(m)) {
    f.set(`metadata[${k}]`, v);
    f.set(`subscription_data[metadata][${k}]`, v);
  }
  return f;
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

/** The offer row a completed Session names, when it is a contract offer; else null. */
export function contractOfferId(session: Record<string, unknown>): string | null {
  const m = (session.metadata ?? {}) as Record<string, unknown>;
  if (str(m.kind) !== CONTRACT_OFFER_KIND) return null;
  const id = str(m.offer_id);
  return /^[0-9a-f-]{36}$/.test(id) ? id : null;
}

export type ContractStripe = {
  read: (subscriptionId: string) => Promise<SubscriptionRead>;
  setCancelAt: (subscriptionId: string, at: number) => Promise<SubscriptionRead>;
};

/**
 * checkout.session.completed for a contract offer, before signup: the subscription ends after the agreed payments
 * (cancel_at at its billing anchor plus `charges` months, no proration), and the row is marked used with the
 * subscription and the end date. Safe to repeat: a retry sets the same cancel_at and keeps the first used_at.
 * False when Stripe or the database refused, so Stripe retries and signup has not run yet.
 */
export async function onContractOfferCompleted(db: SupabaseClient, session: Record<string, unknown>, stripe: ContractStripe): Promise<boolean> {
  const id = contractOfferId(session);
  const sid = str(session.id);
  if (!id) {
    console.error(`[stripe] contract offer ${sid} names no offer; signup goes ahead without an end date`);
    return true;
  }
  const { data: offer, error } = await db.from("contract_offers").select("id, charges, used_at, stripe_subscription_id").eq("id", id).maybeSingle();
  if (error) {
    console.error(`[stripe] contract offer ${sid}: could not read offer ${id}: ${error.message}`);
    return false;
  }
  if (!offer) {
    console.error(`[stripe] contract offer ${sid}: offer ${id} is gone; signup goes ahead without an end date`);
    return true;
  }
  const subId = str(session.subscription);
  if (!subId) {
    console.error(`[stripe] contract offer ${sid}: no subscription on the Session; nothing to end`);
    return true;
  }
  if (offer.stripe_subscription_id && offer.stripe_subscription_id !== subId) {
    // A second Session paid from the same link before the first completed: both run, and Danny is told in the logs.
    console.error(`[stripe] contract offer ${id} was already taken by ${offer.stripe_subscription_id}; ${subId} is a second subscription - cancel one in Stripe`);
  }
  const sub = await stripe.read(subId);
  if (!sub.ok || !sub.billingCycleAnchor) {
    console.error(`[stripe] contract offer ${sid}: subscription ${subId} not read (${sub.ok ? "no billing anchor" : sub.reason})`);
    return false;
  }
  const cancelAt = cancelAtFor(sub.billingCycleAnchor, Number(offer.charges));
  const set = await stripe.setCancelAt(subId, cancelAt);
  if (!set.ok) {
    console.error(`[stripe] contract offer ${sid}: cancel_at not set on ${subId} (${set.reason} ${set.status ?? ""})`);
    return false;
  }
  const { error: uErr } = await db
    .from("contract_offers")
    .update({
      used_at: offer.used_at ?? new Date().toISOString(),
      stripe_session_id: sid || null,
      stripe_subscription_id: offer.stripe_subscription_id ?? subId,
      cancel_at: new Date(cancelAt * 1000).toISOString(),
    })
    .eq("id", id);
  if (uErr) {
    console.error(`[stripe] contract offer ${sid}: offer ${id} not marked used: ${uErr.message}`);
    return false;
  }
  console.log(`[stripe] contract offer ${id} taken: ${subId} ends ${new Date(cancelAt * 1000).toISOString()} after ${offer.charges} payments`);
  return true;
}
