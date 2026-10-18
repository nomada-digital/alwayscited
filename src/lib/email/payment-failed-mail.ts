import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { dashOrigin } from "@/lib/dash/host";
import { hostedInvoiceUrl } from "@/lib/checkout/payment";
import { paymentAmount, paymentFailed, planUrl } from "@/lib/email/lifecycle";
import { lifecycleOn, sendLifecycle } from "@/lib/email/lifecycle-mail";
import { upsellMode } from "@/lib/tracking/ask";
import { formatDay } from "@/lib/tracking/figures";

/**
 * #11 payment_failed (brief item 2e, 18 Oct 2026): the client's live owners
 * hear that a renewal's card failed, while Stripe retries and tracking
 * carries on. Called by subscription-events.ts onInvoicePaymentFailed only
 * after afterFailedInvoice wrote the past-due state to a client an order row
 * ties to the subscription - never for a subscription's first invoice, which
 * Checkout shows on its own form.
 *
 * Bounded three ways: its own flag, email_payment_failed_enabled, false until
 * Danny turns it on; once per invoice - a dashboard_events row
 * payment_failed_mail with the invoice id is looked for and written before the
 * send, so Stripe's later attempts on the same invoice send nothing more; and
 * live owners only, never in agency mode, as the other lifecycle emails.
 * Never throws: the payment state is already recorded.
 */
export const PAYMENT_FAILED_EVENT = "payment_failed_mail";

const day = (s: number) => formatDay(new Date(s * 1000).toISOString().slice(0, 10), true);

export async function mailPaymentFailed(db: SupabaseClient, clientId: string, invoice: Record<string, unknown>, at: number): Promise<void> {
  try {
    if (!(await lifecycleOn(db, "payment_failed"))) return;
    const invoiceId = typeof invoice.id === "string" && /^in_[A-Za-z0-9]{1,200}$/.test(invoice.id) ? invoice.id : null;
    if (!invoiceId) return;
    const { data: c, error: cErr } = await db.from("client_domains").select("account_id, domain, slug").eq("id", clientId).maybeSingle();
    if (cErr || !c) throw new Error(cErr?.message ?? "no client");
    const { data: account, error: aErr } = await db.from("accounts").select("upsell_mode").eq("id", c.account_id).maybeSingle();
    if (aErr || !account) throw new Error(aErr?.message ?? "no account");
    if (upsellMode(account.upsell_mode) === "agency") return;
    const { data: sent, error: sErr } = await db.from("dashboard_events").select("id").eq("client_domain_id", clientId).eq("event", PAYMENT_FAILED_EVENT).eq("props->>invoice", invoiceId).limit(1);
    if (sErr) throw new Error(sErr.message);
    if (sent?.length) return;
    const { data: owners, error: oErr } = await db.from("dashboard_members").select("email").eq("account_id", c.account_id).eq("role", "owner").is("removed_at", null);
    if (oErr) throw new Error(oErr.message);
    if (!owners?.length) return;
    const { error: claimErr } = await db.from("dashboard_events").insert({ client_domain_id: clientId, member_email: null, event: PAYMENT_FAILED_EVENT, path: null, props: { invoice: invoiceId } });
    if (claimErr) {
      // Another delivery of the same event claimed it first (20261018040000's unique index).
      if (claimErr.code === "23505") return;
      throw new Error(`claim: ${claimErr.message}`);
    }
    const mail = paymentFailed({
      domain: c.domain as string,
      amount: paymentAmount(invoice.amount_due, invoice.currency),
      failedOn: day(at),
      retryOn: typeof invoice.next_payment_attempt === "number" ? day(invoice.next_payment_attempt) : null,
      invoice: hostedInvoiceUrl(invoice),
      plan: planUrl(c.slug as string, dashOrigin()),
    });
    for (const m of owners) {
      if (!(await sendLifecycle({ memberEmail: m.email as string, mail }))) console.warn(`[stripe] payment_failed not sent for ${clientId}`);
    }
  } catch (err) {
    console.warn(`[stripe] payment_failed for ${clientId} skipped: ${err instanceof Error ? err.message : String(err)}`);
  }
}
