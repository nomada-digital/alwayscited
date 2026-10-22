import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

import { invoiceFacts, money, paymentKind, worthTelling } from "@/lib/checkout/invoice";
import { billingUrl, paymentReceived } from "@/lib/email/lifecycle";
import { transactionalOn } from "@/lib/email/lifecycle-flag";
import { sendLifecycle } from "@/lib/email/lifecycle-mail";
import type { TierKey } from "@/lib/tier-text";

/**
 * invoice.paid (22 Oct 2026): our own "Payment received - your invoice" email, beside whatever Stripe sends under
 * its Customer emails settings. One per invoice that took money (worthTelling): the first payment, a trial's
 * conversion, each renewal, a pack. To the invoice's own customer_email - the address that paid - with the client's
 * domain and Plan > Billing when the subscription is a client's (an order row) or one of its packs.
 *
 * Behind email_payment_received_enabled, which ships on (transactionalOn). Once per invoice: the webhook records
 * each event id before acting (route.ts), and Stripe sends invoice.paid once per invoice. Never asks Stripe to retry
 * for the email's sake: a send that fails is logged and the event still answers true, so a retry cannot send twice.
 * A failed read of our own tables is the one false - the client lookup is retried, the email has not gone yet.
 */
const TIERS: TierKey[] = ["tracked", "mentioned", "cited"];
const day = (s: number) => new Date(s * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

export async function onInvoicePaid(db: SupabaseClient, invoice: Record<string, unknown>): Promise<boolean> {
  const f = invoiceFacts(invoice);
  if (!f || !worthTelling(f)) return true;
  if (!f.customerEmail || !f.hostedUrl) {
    console.warn(`[invoice] ${f.id} paid with no ${f.customerEmail ? "invoice page" : "customer email"}; no email sent`);
    return true;
  }
  if (!(await transactionalOn(db, "payment_received"))) return true;

  // whose it is: the client's order row, else one of its packs
  type Client = { id: string; slug: string; domain: string; tier: string };
  let client: Client | null = null;
  if (f.subscriptionId) {
    const { data: o, error } = await db.from("orders").select("client_domain_id").eq("stripe_subscription_id", f.subscriptionId).not("client_domain_id", "is", null).limit(1);
    if (error) return false;
    let cid = (o?.[0]?.client_domain_id as string | undefined) ?? null;
    if (!cid) {
      const { data: p, error: pErr } = await db.from("tracking_packs").select("client_domain_id").eq("stripe_subscription_id", f.subscriptionId).maybeSingle();
      if (pErr) return false;
      cid = (p?.client_domain_id as string | undefined) ?? null;
    }
    if (cid) {
      const { data: c, error: cErr } = await db.from("client_domains").select("id, slug, domain, tier").eq("id", cid).maybeSingle();
      if (cErr) return false;
      if (c) client = c as Client;
    }
  }

  const mail = paymentReceived({
    tier: (TIERS.includes(client?.tier as TierKey) ? client!.tier : "tracked") as TierKey,
    domain: client?.domain ?? null,
    amount: money(f.amountPaid, f.currency),
    tax: f.tax > 0 ? money(f.tax, f.currency) : null,
    number: f.number,
    paidOn: day(f.paidAt ?? f.created ?? Math.floor(Date.now() / 1000)),
    kind: paymentKind(f),
    period: f.periodStart && f.periodEnd && f.periodEnd > f.periodStart ? `${day(f.periodStart)} to ${day(f.periodEnd)}` : null,
    hostedUrl: f.hostedUrl,
    pdfUrl: f.pdfUrl,
    billing: client ? billingUrl(client.slug) : null,
  });
  const sent = await sendLifecycle({ memberEmail: f.customerEmail, mail });
  if (!sent) console.error(`[invoice] payment_received for ${f.id} NOT sent`);
  if (client) {
    const { error } = await db.from("dashboard_events").insert({ client_domain_id: client.id, member_email: f.customerEmail, event: sent ? "payment_received_sent" : "payment_received_failed", path: "/plan", props: { invoice: f.id } });
    if (error) console.warn(`[invoice] event not recorded for ${f.id}: ${error.message}`);
  }
  return true;
}
