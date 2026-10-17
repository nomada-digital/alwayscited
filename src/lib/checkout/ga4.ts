import { GA_MEASUREMENT_ID, gaIdValid } from "../../config/analytics.ts";
import { TIER_PLAIN, type TierKey } from "../tier-text.ts";
import type { CompletedOrder } from "./webhook.ts";

/**
 * The purchase, sent to GA4 from the server (15 Oct 2026, Danny approved GA4
 * with a consent banner in chat).
 *
 * /checkout/done cannot send it: the page is reached by a redirect Stripe
 * makes, it does not confirm payment, and a reload or a shared link would
 * count the sale twice. checkout.session.completed is the one signed,
 * de-duplicated statement that an order exists - the webhook records the
 * event id first, so a replay never reaches here - so the event is sent from
 * the webhook through the Measurement Protocol, once.
 *
 * `client_id` is the visitor's own GA id when they said yes to analytics
 * before paying (CheckoutOrder reads it from the _ga cookie and it rides on the
 * Session's metadata). Without one - a no, or a blocked cookie - the purchase
 * still counts, against a random id that joins no visit: the money is real
 * whether or not the visit was measured.
 *
 * What it sends: the session id as the transaction, the amount and currency
 * Stripe charged, the plan's plain name, the market. No email, no domain, no
 * keyword.
 *
 * Never fatal and never slow: no secret or no real measurement id is a silent
 * skip, and any failure is a log line. The webhook answers Stripe exactly as
 * it did before this existed.
 */

export const MP_ENDPOINT = "https://www.google-analytics.com/mp/collect";

/** How long the webhook waits for Google before giving up on the event. */
export const MP_TIMEOUT_MS = 3000;

export type Ga4Purchase = { url: string; body: Record<string, unknown> };

/** A client id that joins no visit, in GA's own "<random>.<seconds>" shape. */
function randomClientId(nowMs: number): string {
  return `${Math.floor(Math.random() * 2_147_483_647)}.${Math.floor(nowMs / 1000)}`;
}

/**
 * The Measurement Protocol request for one completed order, or null when there
 * is nothing to send it with. Pure, so the shape is tested without a network.
 */
export function ga4Purchase(
  o: CompletedOrder,
  secret: string | undefined,
  id: string = GA_MEASUREMENT_ID,
  nowMs: number = Date.now(),
): Ga4Purchase | null {
  if (!secret || !secret.trim() || !gaIdValid(id) || !o.sessionId) return null;
  const plan = (TIER_PLAIN as Record<string, string>)[o.tier as TierKey] ?? o.tier;
  const currency = (o.currency ?? "").toUpperCase();
  const trial = (o.trialDays ?? 0) > 0;
  const value = trial ? 0 : o.amountTotal !== null && o.amountTotal >= 0 ? o.amountTotal / 100 : 0;
  const params: Record<string, unknown> = {
    transaction_id: o.sessionId,
    value,
    items: [{ item_id: o.tier, item_name: plan, quantity: o.quantity }],
    plan,
    market: o.market,
  };
  if (currency) params.currency = currency;
  const q = new URLSearchParams({ measurement_id: id, api_secret: secret.trim() });
  return {
    url: `${MP_ENDPOINT}?${q}`,
    body: {
      client_id: o.gaClientId ?? randomClientId(nowMs),
      events: [{ name: trial ? "start_trial" : "purchase", params }],
    },
  };
}

/** Send it. Resolves whatever happens; a failure is logged, never thrown. */
export async function sendGa4Purchase(
  o: CompletedOrder,
  secret: string | undefined = process.env.GA4_API_SECRET,
  fetcher: typeof fetch = fetch,
): Promise<"sent" | "skipped" | "failed"> {
  try {
    const req = ga4Purchase(o, secret);
    if (!req) return "skipped";
    const res = await fetcher(req.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(req.body),
      signal: AbortSignal.timeout(MP_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.warn(`[ga4] the purchase for ${o.sessionId} was refused: ${res.status}`);
      return "failed";
    }
    return "sent";
  } catch (e) {
    console.warn(`[ga4] could not send the purchase for ${o.sessionId}: ${e instanceof Error ? e.message : String(e)}`);
    return "failed";
  }
}
