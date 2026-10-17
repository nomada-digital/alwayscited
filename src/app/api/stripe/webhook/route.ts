import { supabaseAdmin } from "@/lib/supabase/admin";
import { onCheckoutCompleted, onSubscriptionDeleted, onSubscriptionUpdated, onTrialWillEnd } from "@/lib/checkout/signup";
import { onInvoicePaymentFailed } from "@/lib/checkout/subscription-events";
import { sendGa4Purchase } from "@/lib/checkout/ga4";
import { handleWebhook } from "@/lib/checkout/webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Stripe's webhook (BRIEF-3 C4, R92/R110/R117, 30 Sep 2026). Registered in
 * Stripe for checkout.session.completed, customer.subscription.updated and
 * customer.subscription.deleted; customer.subscription.trial_will_end is
 * handled from 8 Oct 2026 (trial_ending's fallback) and invoice.payment_failed
 * from 9 Oct 2026 (BL-2, the owner's past-due banner), and each is acted on
 * once the endpoint is subscribed to it in the Stripe Dashboard. The raw body is verified against
 * STRIPE_WEBHOOK_SECRET before it is parsed; unset, the door answers 503 and
 * acts on nothing. The event id goes into stripe_events first, so a replay is
 * a 200 that does nothing. The rules are in lib/checkout/webhook.ts, the
 * writes in lib/checkout/signup.ts and, for a failed invoice and which client
 * a subscription is, lib/checkout/subscription-events.ts.
 */
export async function POST(req: Request) {
  const raw = await req.text();
  const answer = await handleWebhook(raw, req.headers.get("stripe-signature"), process.env.STRIPE_WEBHOOK_SECRET, {
    record: async (id, type) => {
      const { error } = await supabaseAdmin().from("stripe_events").insert({ id, type });
      if (!error) return "new";
      if (error.code === "23505") return "duplicate";
      console.error(`[stripe] could not record ${id}: ${error.message}`);
      return "failed";
    },
    forget: async (id) => {
      // Only the row this request wrote, so Stripe's retry is acted on rather than read as a replay.
      const { error } = await supabaseAdmin().from("stripe_events").delete().eq("id", id);
      if (error) console.error(`[stripe] could not forget ${id}: ${error.message}`);
    },
    // GA4's purchase (or start_trial) after the order is set up, once per
    // event: a replay is answered as a duplicate before this runs. Never fatal
    // and bounded by a 3s timeout (lib/checkout/ga4.ts, 15 Oct 2026).
    completed: async (order, eventId) => {
      const done = await onCheckoutCompleted(supabaseAdmin(), order, eventId);
      if (done) await sendGa4Purchase(order);
      return done;
    },
    updated: (sub, previous, at) => onSubscriptionUpdated(supabaseAdmin(), sub, previous, at),
    deleted: (sub, at) => onSubscriptionDeleted(supabaseAdmin(), sub, at),
    trialWillEnd: (sub) => onTrialWillEnd(supabaseAdmin(), sub),
    paymentFailed: (invoice, at) => onInvoicePaymentFailed(supabaseAdmin(), invoice, at),
  });
  return Response.json(answer.body, { status: answer.status });
}

/** Stripe only posts. Anything else is told so, never a 500. */
export function GET() {
  return Response.json({ error: "method_not_allowed" }, { status: 405, headers: { allow: "POST" } });
}
