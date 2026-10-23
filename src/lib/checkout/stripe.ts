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

/**
 * Name fields of their own on Stripe's form (23 Oct 2026). With none, Stripe took the Customer's name from its
 * billing form, and the goodtrip order's customer was saved as "11 Heworth Hall Drive" - the address line in the
 * name field. `name_collection` adds a required full name and an optional business name at the top of the form, and
 * Stripe sets Customer.name to the business name when one is given, else the full name. Optional for the business
 * because a required one moves Apple Pay and the other one-click buttons down the form or turns them off.
 */
export function askForNames(f: URLSearchParams): void {
  f.set("name_collection[individual][enabled]", "true");
  f.set("name_collection[business][enabled]", "true");
  f.set("name_collection[business][optional]", "true");
}

/**
 * `name_collection` arrived in API version 2025-09-30.clover, and these requests send no Stripe-Version, so an
 * account on an older default refuses it as an unknown parameter - which would refuse every Session. A refusal that
 * names it is tried once more without the name fields, and logged, so checkout never stops over a name field.
 */
function namesRefused(form: URLSearchParams, s: SessionResult, param: unknown): boolean {
  if (s.ok || s.reason !== "refused" || ![...form.keys()].some((k) => k.startsWith("name_collection["))) return false;
  return typeof param === "string" && param.startsWith("name_collection");
}

export async function createCheckoutSession(form: URLSearchParams, fetchImpl: typeof fetch = fetch): Promise<SessionResult> {
  const first = await sessionCall(form, fetchImpl);
  if (!namesRefused(form, first.result, first.param)) return first.result;
  console.warn("[stripe] name_collection refused by the account's API version; the Session is created without name fields");
  const plain = new URLSearchParams([...form.entries()].filter(([k]) => !k.startsWith("name_collection[")));
  return (await sessionCall(plain, fetchImpl)).result;
}

async function sessionCall(form: URLSearchParams, fetchImpl: typeof fetch): Promise<{ result: SessionResult; param?: unknown }> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return { result: { ok: false, reason: "no_key" } };
  let res: Response;
  try {
    res = await fetchImpl("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/x-www-form-urlencoded" },
      body: form.toString(),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return { result: { ok: false, reason: "unreachable" } };
  }
  const body = (await res.json().catch(() => null)) as { url?: unknown; error?: { code?: unknown; type?: unknown; param?: unknown } } | null;
  if (!res.ok || typeof body?.url !== "string" || !body.url.startsWith("https://checkout.stripe.com/")) {
    const code = body?.error?.code ?? body?.error?.type;
    return { result: { ok: false, reason: "refused", status: res.status, code: typeof code === "string" ? code : undefined }, param: body?.error?.param };
  }
  return { result: { ok: true, url: body.url } };
}

/**
 * The two subscription calls the alwaystracked trial needs (Danny, 8 Oct
 * 2026): read a subscription's status and trial end, so the webhook records
 * the real first-charge date; and set cancel_at_period_end, the owner's
 * "Cancel trial" - the subscription ends when the trial does and nothing is
 * charged. Neither bills anybody.
 */
export type SubscriptionRead = { ok: true; status: string; trialEnd: number | null; cancelAtPeriodEnd: boolean; currentPeriodEnd: number | null } | { ok: false; reason: "no_key" | "refused" | "unreachable"; status?: number };

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
  const body = (await res.json().catch(() => null)) as { status?: unknown; trial_end?: unknown; cancel_at_period_end?: unknown; current_period_end?: unknown; items?: { data?: { current_period_end?: unknown }[] } } | null;
  if (!res.ok || typeof body?.status !== "string") return { ok: false, reason: "refused", status: res.status };
  // The period end is on the subscription in older API versions and on its items from 2025-03-31 on; either is read.
  const periodEnd = body.current_period_end ?? body.items?.data?.[0]?.current_period_end;
  return {
    ok: true,
    status: body.status,
    trialEnd: typeof body.trial_end === "number" ? body.trial_end : null,
    cancelAtPeriodEnd: body.cancel_at_period_end === true,
    currentPeriodEnd: typeof periodEnd === "number" ? periodEnd : null,
  };
}

export function readSubscription(id: string, fetchImpl: typeof fetch = fetch): Promise<SubscriptionRead> {
  return subscriptionCall(id, null, fetchImpl);
}

export function cancelAtPeriodEnd(id: string, fetchImpl: typeof fetch = fetch): Promise<SubscriptionRead> {
  return subscriptionCall(id, new URLSearchParams({ cancel_at_period_end: "true" }), fetchImpl);
}

/**
 * The promotion code a Checkout Session used, and its coupon (22 Oct 2026): for the order email's line naming the
 * code, the discount and when full price starts, so a test order on a 100% code reads as one. Read only; it bills
 * nobody. The coupon is on the code in older API versions and under `promotion` from 2025-09-30 on, where it can be
 * an id - then it is read too.
 */
export type CouponTerms = { percentOff: number | null; amountOff: number | null; currency: string | null; duration: "once" | "repeating" | "forever" | null; months: number | null };
export type PromotionRead = ({ ok: true; code: string } & CouponTerms) | { ok: false; reason: "no_key" | "refused" | "unreachable"; status?: number };

async function stripeGet(path: string, fetchImpl: typeof fetch): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; reason: "no_key" | "refused" | "unreachable"; status?: number }> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return { ok: false, reason: "no_key" };
  let res: Response;
  try {
    res = await fetchImpl(`https://api.stripe.com/v1/${path}`, { method: "GET", headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15_000) });
  } catch {
    return { ok: false, reason: "unreachable" };
  }
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok || !body) return { ok: false, reason: "refused", status: res.status };
  return { ok: true, body };
}

function couponTerms(c: Record<string, unknown>): CouponTerms {
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const d = c.duration;
  return {
    percentOff: num(c.percent_off),
    amountOff: num(c.amount_off),
    currency: typeof c.currency === "string" ? c.currency : null,
    duration: d === "once" || d === "repeating" || d === "forever" ? d : null,
    months: num(c.duration_in_months),
  };
}

export async function readPromotionCode(id: string, fetchImpl: typeof fetch = fetch): Promise<PromotionRead> {
  if (!/^promo_[A-Za-z0-9]{1,200}$/.test(id)) return { ok: false, reason: "refused" };
  const r = await stripeGet(`promotion_codes/${id}`, fetchImpl);
  if (!r.ok) return r;
  const code = typeof r.body.code === "string" ? r.body.code : "";
  const promotion = (r.body.promotion ?? {}) as Record<string, unknown>;
  let coupon = (r.body.coupon ?? promotion.coupon) as Record<string, unknown> | string | undefined;
  if (typeof coupon === "string") {
    if (!/^[A-Za-z0-9_-]{1,200}$/.test(coupon)) return { ok: false, reason: "refused" };
    const c = await stripeGet(`coupons/${coupon}`, fetchImpl);
    if (!c.ok) return c;
    coupon = c.body;
  }
  if (!code || !coupon || typeof coupon !== "object") return { ok: false, reason: "refused" };
  return { ok: true, code, ...couponTerms(coupon) };
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

/**
 * A customer's invoices, newest first, for Plan > Billing (22 Oct 2026, invoice.ts invoiceRows). Read only; at most
 * `limit` (Stripe's own cap is 100). The customer id comes from the client's order row, never from a request.
 */
export async function listInvoices(customer: string, limit = 24, fetchImpl: typeof fetch = fetch): Promise<{ ok: true; data: Record<string, unknown>[] } | { ok: false; reason: "no_key" | "refused" | "unreachable"; status?: number }> {
  if (!/^cus_[A-Za-z0-9]{1,200}$/.test(customer)) return { ok: false, reason: "refused" };
  const r = await stripeGet(`invoices?customer=${encodeURIComponent(customer)}&limit=${Math.max(1, Math.min(100, Math.round(limit)))}`, fetchImpl);
  if (!r.ok) return r;
  return { ok: true, data: Array.isArray(r.body.data) ? (r.body.data as Record<string, unknown>[]) : [] };
}

/**
 * The read-only Stripe audit (22 Oct 2026, /api/cron/stripe-audit): the account's recent invoices, its tax settings,
 * its active tax rates and its webhook endpoints' events. GETs only; each answers on its own, so a read the restricted
 * key may not make is reported as refused rather than failing the rest.
 */
export async function stripeAuditReads(fetchImpl: typeof fetch = fetch) {
  const [invoices, tax, rates, hooks] = await Promise.all([
    stripeGet("invoices?limit=100", fetchImpl),
    stripeGet("tax/settings", fetchImpl),
    stripeGet("tax_rates?active=true&limit=20", fetchImpl),
    stripeGet("webhook_endpoints?limit=20", fetchImpl),
  ]);
  return { invoices, tax, rates, hooks };
}
