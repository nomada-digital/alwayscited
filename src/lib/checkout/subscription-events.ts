import type { SupabaseClient } from "@supabase/supabase-js";

import { missingColumn } from "../tracking/decide.ts";
import { PAYMENT_READ, afterFailedInvoice, invoiceSubscription, newerThanRecorded, type PaymentRow, type PaymentStep } from "./payment.ts";
import { subscriptionScanToken } from "./webhook.ts";

/**
 * Which client a Stripe subscription's event is about, and the payment step
 * it writes (BL-2, 9 Oct 2026). Moved out of signup.ts on review of 2c6dc99,
 * with relative imports only, so the handler itself runs under node --test
 * against a stand-in database (subscription-events.test.mts).
 *
 * The review found the subscription's client was taken from its scan token
 * first: the newest client_domains row made from that scan, whoever's it
 * was. Nothing stops two accounts buying one scan, and Nomada makes clients
 * from scans by hand (admin/tracking/actions.ts) with no subscription at all.
 * So a failed renewal on one account's subscription put its Stripe invoice
 * page - the buyer's name, email, address and amount - on another account's
 * banner, and an unpaid one ended a client someone else was paying for.
 * Before BL-2 the same mix-up moved only cluster_limit and a cancellation.
 *
 * Now the order row decides. orders.stripe_subscription_id is written by the
 * Checkout Session that made the subscription, with the client that Session
 * made (signup.ts writeOrder). Only a subscription no order row names falls
 * back to its scan, and then only to the one client from that scan that no
 * other subscription's order bought; anything less certain is no client. A
 * client found that way is `exact: false`: it keeps what it had before BL-2
 * (packs, a trial's end, a cancellation's end), and gets no payment step and
 * no trial email. Payment state, invoice links and payment ends are written
 * only to a client an order row ties to the subscription.
 */

/** A client for a subscription; `exact` when an orders row names both. */
export type SubscriptionClient = { id: string; exact: boolean };

/** What the reads found, for subscriptionClient to decide on. */
export type SubscriptionEvidence = {
  subscriptionId: string;
  /** client_domain_id of every orders row naming this subscription; null where that row has no client. */
  ordered: (string | null)[];
  /** The clients made from the subscription's scan, any account's, newest first. Empty with no token or scan. */
  fromScan: string[];
  /** fromScan stopped at its read limit, so a client may be missing from it. */
  truncated: boolean;
  /** Every orders row on one of those clients, with the subscription it bought. */
  bought: { client: string; subscription: string | null }[];
};

/** How many clients one scan's read takes before it is too many to tell apart. */
export const SCAN_CLIENTS_READ = 50;

export function subscriptionClient(e: SubscriptionEvidence): { client: SubscriptionClient | null; why: string } {
  const named = e.ordered.find((c): c is string => typeof c === "string" && c.length > 0);
  if (named) return { client: { id: named, exact: true }, why: "its order row" };
  // The order row is there and made no client (the scan was missing, or the
  // signup has not finished): the scan would only find someone else's.
  if (e.ordered.length) return { client: null, why: "its order row has no client" };
  if (!e.fromScan.length) return { client: null, why: "no order row names it and no client came from its scan" };
  if (e.truncated) return { client: null, why: `its scan made ${SCAN_CLIENTS_READ} or more clients: not guessed` };
  const others = new Set(e.bought.filter((b) => b.subscription !== null && b.subscription !== e.subscriptionId).map((b) => b.client));
  const left = e.fromScan.filter((c) => !others.has(c));
  if (left.length === 1) return { client: { id: left[0]!, exact: false }, why: "the one client from its scan that no other subscription bought" };
  return { client: null, why: left.length ? `${left.length} clients from its scan and nothing says which: not guessed` : "every client from its scan was bought by another subscription" };
}

/** false only on a failed read, so Stripe retries; null when the subscription is no client of ours, or not certainly one. */
export async function clientOfSubscription(db: SupabaseClient, sub: Record<string, unknown>): Promise<SubscriptionClient | null | false> {
  const id = typeof sub.id === "string" ? sub.id : "";
  const e: SubscriptionEvidence = { subscriptionId: id, ordered: [], fromScan: [], truncated: false, bought: [] };
  if (id) {
    const { data, error } = await db.from("orders").select("client_domain_id").eq("stripe_subscription_id", id).limit(10);
    if (error) return false;
    e.ordered = (data ?? []).map((r) => (typeof r.client_domain_id === "string" ? r.client_domain_id : null));
  }
  // An order with no scan (R158) carries no token; its order row is the only way in.
  const token = e.ordered.length ? null : subscriptionScanToken(sub);
  if (token) {
    const { data: scan, error } = await db.from("scans").select("id").eq("public_token", token).maybeSingle();
    if (error) return false;
    if (scan) {
      const { data: made, error: cErr } = await db.from("client_domains").select("id").eq("source_scan_id", scan.id).order("created_at", { ascending: false }).limit(SCAN_CLIENTS_READ);
      if (cErr) return false;
      e.fromScan = (made ?? []).map((c) => String(c.id));
      e.truncated = e.fromScan.length >= SCAN_CLIENTS_READ;
      if (e.fromScan.length) {
        const { data: orders, error: oErr } = await db.from("orders").select("client_domain_id, stripe_subscription_id").in("client_domain_id", e.fromScan);
        if (oErr) return false;
        e.bought = (orders ?? []).map((o) => ({ client: String(o.client_domain_id), subscription: typeof o.stripe_subscription_id === "string" ? o.stripe_subscription_id : null }));
      }
    }
  }
  const r = subscriptionClient(e);
  if (!r.client && (e.ordered.length || e.fromScan.length)) console.warn(`[stripe] no client for subscription ${id || "(no id)"}: ${r.why}`);
  if (r.client && !r.client.exact) console.warn(`[stripe] subscription ${id || "(no id)"} has no order row; client ${r.client.id} is ${r.why}, so no payment step`);
  return r.client;
}

/**
 * The payment columns for one client (BL-2). null while
 * 20261009030000_payment_state.sql is not applied - logged, and the payment
 * step is skipped, so the webhook behaves as it did before - and false on any
 * other failed read, so Stripe retries.
 */
export async function paymentRow(db: SupabaseClient, clientId: string): Promise<PaymentRow | null | false> {
  const { data, error } = await db.from("client_domains").select(PAYMENT_READ).eq("id", clientId).maybeSingle();
  if (error) {
    if (missingColumn(error, "payment_")) {
      console.warn(`[stripe] payment state not recorded for ${clientId}: 20261009030000_payment_state.sql is not applied`);
      return null;
    }
    console.error(`[stripe] could not read the payment state of ${clientId}: ${error.message}`);
    return false;
  }
  if (!data) return null;
  const r = data as Record<string, unknown>;
  const s = (k: string) => (typeof r[k] === "string" ? (r[k] as string) : null);
  return { status: s("status"), payment_status: s("payment_status"), payment_status_at: s("payment_status_at"), payment_ended_at: s("payment_ended_at") };
}

/**
 * One event's payment step, written in one update and only over an older
 * event (newerThanRecorded), and only to a client an order row ties to the
 * subscription. `end` is how a cancelled subscription ends the client:
 * signup.ts hands it endClient, so plan_ended goes as it does on deletion,
 * once and behind its flag. It is null where the event cannot cancel (an
 * invoice) or the caller has already ended the client (deletion).
 */
export async function recordPayment(
  db: SupabaseClient,
  client: SubscriptionClient,
  subId: string,
  at: number,
  decide: (row: PaymentRow) => PaymentStep,
  end: (() => Promise<boolean>) | null,
): Promise<boolean> {
  if (!client.exact) return true;
  const row = await paymentRow(db, client.id);
  if (row === false) return false;
  if (row === null) return true;
  const step = decide(row);
  if (step.cancel && end && !(await end())) return false;
  if (!step.write) return true;
  const { error } = await db.from("client_domains").update(step.write).eq("id", client.id).or(newerThanRecorded(at));
  if (error) {
    if (missingColumn(error, "payment_")) return true;
    console.error(`[stripe] payment state ${step.write.payment_status} not recorded for ${client.id}: ${error.message}`);
    return false;
  }
  if (step.end) console.info(`[stripe] client ${client.id} ended: subscription ${subId} is ${step.write.payment_status}`);
  if (step.restore) console.info(`[stripe] client ${client.id} restored: subscription ${subId} is ${step.write.payment_status} again`);
  return true;
}

/**
 * invoice.payment_failed (BL-2, 9 Oct 2026): the subscription's client is
 * past due, with the date Stripe tries again and the invoice's page for the
 * owner's banner (afterFailedInvoice). An invoice with no subscription, or
 * none of ours, is nothing to do.
 *
 * 18 Oct 2026 (brief 2e): and #11, the payment_failed email, through `mail` -
 * the webhook hands in payment-failed-mail.ts mailPaymentFailed, which asks
 * its own flag (email_payment_failed_enabled, false until Danny turns it on)
 * and sends once per invoice. It is called only when this invoice wrote the
 * past-due state to a client an order row ties to the subscription
 * (afterFailedInvoice returned a write and recordPayment succeeded), so a
 * first invoice, a stale event or a client already ended mails nobody.
 * Until then this said "No email to the client: Stripe's own failed-payment
 * emails are Danny's setting (LB4)".
 */
export async function onInvoicePaymentFailed(
  db: SupabaseClient,
  invoice: Record<string, unknown>,
  at: number = Math.floor(Date.now() / 1000),
  mailFailed?: (db: SupabaseClient, clientId: string, invoice: Record<string, unknown>, at: number) => Promise<void>,
): Promise<boolean> {
  const owner = invoiceSubscription(invoice);
  if (!owner) return true;
  const client = await clientOfSubscription(db, owner);
  if (client === false) return false;
  if (!client) return true;
  let wrote = false;
  const decide = (row: PaymentRow): PaymentStep => {
    const step = afterFailedInvoice(row, invoice, at);
    wrote = step.write !== null;
    return step;
  };
  const ok = await recordPayment(db, client, owner.id, at, decide, null);
  if (ok && wrote && client.exact && mailFailed) await mailFailed(db, client.id, invoice, at);
  return ok;
}
