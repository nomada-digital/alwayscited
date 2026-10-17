/**
 * The one request this site makes to Stripe: create a Checkout Session
 * (R91, Danny, 29 Sep 2026; danny.md 91).
 *
 * The key is read from `process.env` at call time and goes nowhere but the
 * Authorization header - never logged, never returned. Creating a Session
 * bills nobody: Stripe charges when a buyer pays, on its own form, so this is
 * not on the vendor list in `spenders.mts` (which lists what bills us per
 * request). `fetchImpl` is there so the tests never reach Stripe.
 */

export type SessionResult = { ok: true; url: string } | { ok: false; reason: "no_key" | "refused" | "unreachable"; status?: number; code?: string };

export async function createCheckoutSession(form: URLSearchParams, fetchImpl: typeof fetch = fetch): Promise<SessionResult> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return { ok: false, reason: "no_key" };
  let res: Response;
  try {
    res = await fetchImpl("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/x-www-form-urlencoded" },
      body: form.toString(),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return { ok: false, reason: "unreachable" };
  }
  const body = (await res.json().catch(() => null)) as { url?: unknown; error?: { code?: unknown; type?: unknown } } | null;
  if (!res.ok || typeof body?.url !== "string" || !body.url.startsWith("https://checkout.stripe.com/")) {
    const code = body?.error?.code ?? body?.error?.type;
    return { ok: false, reason: "refused", status: res.status, code: typeof code === "string" ? code : undefined };
  }
  return { ok: true, url: body.url };
}

/**
 * The two subscription calls the alwaystracked trial needs (Danny, 8 Oct
 * 2026): read a subscription's status and trial end, so the webhook records
 * the real first-charge date; and set cancel_at_period_end, the owner's
 * "Cancel trial" - the subscription ends when the trial does and nothing is
 * charged. Neither bills anybody.
 */
export type SubscriptionRead = { ok: true; status: string; trialEnd: number | null; cancelAtPeriodEnd: boolean } | { ok: false; reason: "no_key" | "refused" | "unreachable"; status?: number };

async function subscriptionCall(id: string, form: URLSearchParams | null, fetchImpl: typeof fetch): Promise<SubscriptionRead> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return { ok: false, reason: "no_key" };
  if (!/^sub_[A-Za-z0-9]{1,200}$/.test(id)) return { ok: false, reason: "refused" };
  let res: Response;
  try {
    res = await fetchImpl(`https://api.stripe.com/v1/subscriptions/${id}`, {
      method: form ? "POST" : "GET",
      headers: { authorization: `Bearer ${key}`, ...(form ? { "content-type": "application/x-www-form-urlencoded" } : {}) },
      body: form ? form.toString() : undefined,
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return { ok: false, reason: "unreachable" };
  }
  const body = (await res.json().catch(() => null)) as { status?: unknown; trial_end?: unknown; cancel_at_period_end?: unknown } | null;
  if (!res.ok || typeof body?.status !== "string") return { ok: false, reason: "refused", status: res.status };
  return { ok: true, status: body.status, trialEnd: typeof body.trial_end === "number" ? body.trial_end : null, cancelAtPeriodEnd: body.cancel_at_period_end === true };
}

export function readSubscription(id: string, fetchImpl: typeof fetch = fetch): Promise<SubscriptionRead> {
  return subscriptionCall(id, null, fetchImpl);
}

export function cancelAtPeriodEnd(id: string, fetchImpl: typeof fetch = fetch): Promise<SubscriptionRead> {
  return subscriptionCall(id, new URLSearchParams({ cancel_at_period_end: "true" }), fetchImpl);
}

/**
 * A Stripe customer portal session (17 Oct 2026, the dashboards host's
 * Billing): invoices, the card, and cancelling at the end of the period, as
 * the portal is configured in Stripe. It charges nothing; the portal itself
 * is where any change is made, on Stripe's page. Same refusal shape as a
 * checkout session, and the same rule: only a Stripe URL is followed.
 */
export async function createPortalSession(customer: string, returnUrl: string, fetchImpl: typeof fetch = fetch): Promise<SessionResult> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return { ok: false, reason: "no_key" };
  if (!/^cus_[A-Za-z0-9]{1,200}$/.test(customer)) return { ok: false, reason: "refused" };
  let res: Response;
  try {
    res = await fetchImpl("https://api.stripe.com/v1/billing_portal/sessions", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ customer, return_url: returnUrl }).toString(),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return { ok: false, reason: "unreachable" };
  }
  const body = (await res.json().catch(() => null)) as { url?: unknown; error?: { code?: unknown; type?: unknown } } | null;
  if (!res.ok || typeof body?.url !== "string" || !body.url.startsWith("https://billing.stripe.com/")) {
    const code = body?.error?.code ?? body?.error?.type;
    return { ok: false, reason: "refused", status: res.status, code: typeof code === "string" ? code : undefined };
  }
  return { ok: true, url: body.url };
}

export type PackResult = { ok: true; packs: number } | { ok: false; reason: "no_key" | "no_product" | "refused" | "unreachable"; status?: number; code?: string };

/**
 * Add one extra tracking pack to a subscription (17 Oct 2026, the dashboards
 * host's self-serve pack). The pack is a subscription item marked
 * metadata[kind]=pack, which webhook.ts packsOn already counts, so Stripe's
 * customer.subscription.updated raises cluster_limit with no new path. An
 * existing pack item has its quantity raised instead of a second item added.
 * The price is pricing.ts's, passed in; the product is STRIPE_PACK_PRODUCT.
 * Prorations go on the next invoice (Stripe's default), so nothing is charged
 * here and a trial is charged nothing until it ends.
 */
export async function addPack(subscription: string, price: { currency: "usd" | "gbp"; amount: number }, fetchImpl: typeof fetch = fetch): Promise<PackResult> {
  const key = process.env.STRIPE_SECRET_KEY;
  const product = process.env.STRIPE_PACK_PRODUCT;
  if (!key) return { ok: false, reason: "no_key" };
  if (!product || !/^prod_[A-Za-z0-9]{1,200}$/.test(product)) return { ok: false, reason: "no_product" };
  if (!/^sub_[A-Za-z0-9]{1,200}$/.test(subscription)) return { ok: false, reason: "refused" };
  const call = async (path: string, form: URLSearchParams | null) => {
    const res = await fetchImpl(`https://api.stripe.com/v1/${path}`, {
      method: form ? "POST" : "GET",
      headers: { authorization: `Bearer ${key}`, ...(form ? { "content-type": "application/x-www-form-urlencoded" } : {}) },
      body: form ? form.toString() : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    return { res, body: (await res.json().catch(() => null)) as Record<string, unknown> | null };
  };
  try {
    const items = await call(`subscription_items?subscription=${subscription}&limit=20`, null);
    if (!items.res.ok) return { ok: false, reason: "refused", status: items.res.status };
    const data = ((items.body?.data ?? []) as { id: string; quantity?: number; metadata?: Record<string, string> }[]);
    const pack = data.find((i) => i.metadata?.kind === "pack");
    const done = pack
      ? await call(`subscription_items/${pack.id}`, new URLSearchParams({ quantity: String((pack.quantity ?? 1) + 1), proration_behavior: "create_prorations" }))
      : await call(
          "subscription_items",
          new URLSearchParams({
            subscription,
            quantity: "1",
            proration_behavior: "create_prorations",
            "metadata[kind]": "pack",
            "price_data[currency]": price.currency,
            "price_data[product]": product,
            "price_data[unit_amount]": String(Math.round(price.amount * 100)),
            "price_data[recurring][interval]": "month",
          }),
        );
    if (!done.res.ok) {
      const err = (done.body?.error ?? {}) as { code?: string; type?: string };
      return { ok: false, reason: "refused", status: done.res.status, code: err.code ?? err.type };
    }
    return { ok: true, packs: Number(done.body?.quantity ?? 1) };
  } catch {
    return { ok: false, reason: "unreachable" };
  }
}
