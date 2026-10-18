import { MAX_CLUSTERS, type Market, quoteFor } from "../../config/sector-pricing.ts";
import { CHECKOUT_LIMITS } from "../../config/contact.ts";
import { TRIAL, type TrialRepeat, noTrialLine, trialApplies } from "../../config/trial.ts";
import { isPlausibleEmail } from "../email-address.ts";
import { isPlausibleDomain, normalizeDomain } from "../scan/domain.ts";

/**
 * The Stripe Checkout Session a live order asks for - section 5 of
 * docs/pricing-spec-2026-09-27.md (R91, Danny, 29 Sep 2026; danny.md 91).
 *
 * Pure, so the rules are tested without Stripe: the amount is always read
 * from the price config here, never from anything the browser sent; every
 * Session allows promotion codes; success and cancel land on alwayscited.com.
 * Anything the spec sells by call - alwayseverywhere, the "other" sector,
 * more than ten clusters - is refused as `call`, so the caller shows
 * "Book a call" instead of a checkout.
 *
 * Returns the form body for `POST /v1/checkout/sessions`. The caller holds
 * the key (process.env only) and makes the request.
 */

export const CHECKOUT_TIERS = ["tracked", "mentioned", "cited"] as const;
export type CheckoutTier = (typeof CHECKOUT_TIERS)[number];

export type Order = { tier: string; sector: string; quantity: number; market: string; email: string; keyword: string; scan?: string; website?: string; /** The GA client id from the _ga cookie, after consent; anything else is dropped. */ gaClientId?: string; /** Extra tracking packs. No checkout sells one yet, so 0. */ packs?: number };

export type CheckoutContext = {
  /** alwaystracked's monthly price per market, from pricing.ts. */
  trackedPrice: Record<Market, number>;
  /** Each tier's plain name (TIER_PLAIN), for the line item Stripe shows. */
  names: Record<CheckoutTier, string>;
  /** Where Stripe returns the buyer. Always the production origin. */
  origin: "https://alwayscited.com";
  /**
   * The alwaystracked trial (config/trial.ts): whether it is on, and whether
   * the order's email or domain has been through before - read by the route,
   * which holds the database. Absent means off.
   */
  trial?: { enabled: boolean; repeat: TrialRepeat };
};

export type CheckoutRequest = { kind: "session"; form: URLSearchParams; amount: number; currency: "usd" | "gbp"; trial: boolean } | { kind: "call" } | { kind: "invalid"; message: string };

export function checkoutRequest(order: Order, ctx: CheckoutContext): CheckoutRequest {
  const market = order.market === "uk" ? "uk" : order.market === "us" ? "us" : null;
  if (!market) return { kind: "invalid", message: "Unknown market." };
  if (!(CHECKOUT_TIERS as readonly string[]).includes(order.tier)) return { kind: "call" };
  const tier = order.tier as CheckoutTier;
  const email = order.email.trim().toLowerCase();
  if (email.length > CHECKOUT_LIMITS.email || !isPlausibleEmail(email)) return { kind: "invalid", message: "An email address is needed." };
  const keyword = order.keyword.trim();
  if (tier !== "tracked" && (keyword.length < CHECKOUT_LIMITS.keyword.min || keyword.length > CHECKOUT_LIMITS.keyword.max)) return { kind: "invalid", message: "A keyword target is needed." };
  // The free scan the order came from, when it did (BRIEF-3 C4): the webhook
  // builds the client and its first cluster from it. Anything not a token is dropped.
  const scan = /^[0-9a-f]{32}$/i.test(order.scan ?? "") ? order.scan!.toLowerCase() : "";
  // Without a scan the webhook has no domain to build the client from, so the
  // order carries the buyer's website (R158, Danny, 1 Oct 2026, danny.md 168).
  const website = scan ? "" : normalizeDomain(order.website ?? "");
  if (!scan && (website.length > CHECKOUT_LIMITS.website || !isPlausibleDomain(website))) return { kind: "invalid", message: "Your website is needed." };
  if (!Number.isInteger(order.quantity) || order.quantity < 1) return { kind: "invalid", message: "Pick a quantity." };
  if (order.quantity > MAX_CLUSTERS) return { kind: "call" };

  let unit: number;
  let quantity: number;
  if (tier === "tracked") {
    unit = ctx.trackedPrice[market];
    quantity = 1;
  } else {
    const one = quoteFor(order.sector, market, tier, 1);
    if (one.kind === "call") return { kind: "call" };
    unit = one.amount;
    quantity = order.quantity;
  }

  const currency = market === "uk" ? "gbp" : "usd";
  const f = new URLSearchParams();
  f.set("mode", "subscription");
  f.set("allow_promotion_codes", "true");
  f.set("customer_email", email);
  // plan and from tell /checkout/done which next step to name: every order
  // gets a dashboard and a sign-in link, from the scan or the website (R148
  // pass 8; R158, 1 Oct 2026).
  f.set("success_url", `${ctx.origin}/checkout/done?session={CHECKOUT_SESSION_ID}&plan=${tier}&from=${scan ? "scan" : "site"}`);
  // Stripe's back link returns to the order form with the picks still in it,
  // the same query /api/checkout's refusals carry (R151, 1 Oct 2026). It was
  // /packages, which dropped the tier, sector, clusters, keyword and website
  // the buyer had just entered - backing out of payment meant starting again.
  // The email stays out: an address in a URL lands in request logs.
  const back = new URLSearchParams({ tier: ctx.names[tier], market });
  if (tier !== "tracked" && order.sector) back.set("sector", order.sector);
  if (quantity > 1) back.set("clusters", String(quantity));
  if (keyword) back.set("keyword", keyword);
  back.set(scan ? "scan" : "website", scan || website);
  f.set("cancel_url", `${ctx.origin}/checkout?${back}`);
  f.set("line_items[0][quantity]", String(quantity));
  f.set("line_items[0][price_data][currency]", currency);
  f.set("line_items[0][price_data][unit_amount]", String(Math.round(unit * 100)));
  f.set("line_items[0][price_data][recurring][interval]", "month");
  f.set("line_items[0][price_data][product_data][name]", ctx.names[tier]);
  for (const [k, v] of Object.entries({ tier, sector: tier === "tracked" ? "" : order.sector, quantity: String(quantity), market, keyword, ...(scan ? { scan_token: scan } : { website }) })) {
    f.set(`metadata[${k}]`, v);
    f.set(`subscription_data[metadata][${k}]`, v);
  }
  // The GA client id (15 Oct 2026), on the Session only - the webhook reads it
  // from checkout.session.completed to send the purchase to GA4 against the
  // visit that made it. Only the cookie's own shape gets through.
  const ga = (order.gaClientId ?? "").trim();
  if (/^\d{1,12}\.\d{1,12}$/.test(ga)) f.set("metadata[ga_client_id]", ga);
  // VAT through Stripe Tax (R129, Danny, 30 Sep 2026, danny.md 116-117): live
  // on the account, UK VAT registered since Nov 2025, prices tax-exclusive.
  // tax_behavior is set on the price itself: left unset, Stripe falls back to
  // the account default, which can read a GBP price as VAT-inclusive. Stripe
  // needs the billing address to place the tax; a business may add a VAT id.
  f.set("line_items[0][price_data][tax_behavior]", "exclusive");
  f.set("automatic_tax[enabled]", "true");
  f.set("tax_id_collection[enabled]", "true");
  f.set("billing_address_collection", "required");

  // The free trial (Danny, 8 Oct 2026): alwaystracked with no packs, a first
  // time through. The card is taken now and the first charge is on day 15; a
  // trial that ends with no card on file cancels rather than invoicing.
  const packs = Math.max(0, Math.floor(order.packs ?? 0));
  const t = { tier, packs, repeat: ctx.trial?.repeat ?? null };
  const on = ctx.trial?.enabled ?? false;
  const trial = trialApplies(t, on);
  if (trial) {
    f.set("subscription_data[trial_period_days]", String(TRIAL.days));
    f.set("payment_method_collection", "always");
    f.set("subscription_data[trial_settings][end_behavior][missing_payment_method]", "cancel");
    f.set("metadata[trial_days]", String(TRIAL.days));
    f.set("subscription_data[metadata][trial_days]", String(TRIAL.days));
  }
  const why = noTrialLine(t, on);
  if (why) f.set("custom_text[submit][message]", why);
  return { kind: "session", form: f, amount: unit * quantity, currency, trial };
}
