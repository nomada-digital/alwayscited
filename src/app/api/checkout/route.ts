import { CHECKOUT_LIMITS } from "@/config/contact";
import { contactUrlFor, TRACKED_PRICE } from "@/config/pricing";
import { TIER_PLAIN } from "@/components/TierName";
import { TRIAL, type TrialRepeat } from "@/config/trial";
import { isPlausibleEmail } from "@/lib/email-address";
import { CHECKOUT_TIERS, checkoutRequest, type CheckoutTier } from "@/lib/checkout/session";
import { createCheckoutSession } from "@/lib/checkout/stripe";
import { readTrialRepeat } from "@/lib/checkout/trial-repeat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ORIGIN = "https://alwayscited.com";

/**
 * Start a live Stripe Checkout (R91 part 2, Danny, 29 Sep 2026; pricing spec
 * section 5). Takes the order - tier, sector, quantity, market, email,
 * keyword - as a plain form post or JSON, builds the Session with
 * `checkoutRequest` (the amount always from the price config, never from this
 * request) and sends the buyer to Stripe's own form with a 303.
 *
 * Anything sold by call, and any request made before the key exists, goes to
 * the contact page for that tier - the spec's "Book a call" fallback. A
 * refused Session is logged by status and Stripe's error code only; if the
 * code names a missing permission it goes to docs/blocked.md, not round it.
 *
 * The order form at /checkout posts here as plain HTML (R91 part 3); an
 * invalid or refused form post goes back to it with its picks and a reason.
 */
export async function POST(req: Request) {
  const isForm = (req.headers.get("content-type") ?? "").includes("application/x-www-form-urlencoded");
  let raw: Record<string, unknown>;
  try {
    raw = isForm ? Object.fromEntries(new URLSearchParams(await req.text())) : await req.json();
  } catch {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }
  if (!raw || typeof raw !== "object") return Response.json({ error: "bad_request" }, { status: 400 });
  const field = (k: string, max: number) => (typeof raw[k] === "string" ? (raw[k] as string).slice(0, max) : typeof raw[k] === "number" ? String(raw[k]) : "");

  const tier = field("tier", CHECKOUT_LIMITS.tier);
  // Email and keyword are cut one past their bound, so checkoutRequest refuses
  // an over-long one rather than this silently shortening it.
  const order = {
    tier,
    sector: field("sector", CHECKOUT_LIMITS.sector),
    quantity: Number(field("quantity", CHECKOUT_LIMITS.clusters) || "1"),
    market: field("market", CHECKOUT_LIMITS.market),
    email: field("email", CHECKOUT_LIMITS.email + 1),
    keyword: field("keyword", CHECKOUT_LIMITS.keyword.max + 1),
    scan: field("scan", CHECKOUT_LIMITS.scan),
    website: field("website", CHECKOUT_LIMITS.website),
    // The GA client id (15 Oct 2026), only ever present after a yes to analytics.
    gaClientId: field("ga_client_id", CHECKOUT_LIMITS.gaClientId),
  };

  // The trial's one-per-domain-and-email read, only while the trial is on and
  // only for the tier it applies to; dark, checkout reads nothing new.
  let repeat: TrialRepeat = null;
  let repeatFailed = false;
  if (TRIAL.enabled && tier === "tracked") {
    try {
      repeat = await readTrialRepeat({ email: order.email, website: order.website, scan: order.scan });
    } catch (e) {
      console.error("[checkout] trial repeat read failed: " + (e instanceof Error ? e.message : String(e)));
      repeatFailed = true;
    }
  }

  const r = checkoutRequest(order, {
    trackedPrice: { us: TRACKED_PRICE.us, uk: TRACKED_PRICE.uk },
    names: { tracked: TIER_PLAIN.tracked, mentioned: TIER_PLAIN.mentioned, cited: TIER_PLAIN.cited },
    origin: ORIGIN,
    trial: { enabled: TRIAL.enabled, repeat },
  });

  const known = (CHECKOUT_TIERS as readonly string[]).includes(tier) || tier === "everywhere";
  const call = ORIGIN + (known ? contactUrlFor(tier as CheckoutTier | "everywhere") : "/contact");
  const go = (url: string) => (isForm ? Response.redirect(url, 303) : Response.json({ url }));

  // A plain form post goes back to the order form with its picks and a reason.
  const back = (error: string) => {
    const b = new URLSearchParams({ tier: TIER_PLAIN[(CHECKOUT_TIERS as readonly string[]).includes(tier) ? (tier as CheckoutTier) : "tracked"], market: order.market, error });
    if (order.sector) b.set("sector", order.sector);
    if (order.quantity > 1) b.set("clusters", String(order.quantity));
    if (/^[0-9a-f]{32}$/i.test(order.scan)) b.set("scan", order.scan);
    // The typed keyword comes back so a refused form keeps it (R151, 1 Oct 2026).
    // The email does not: an address in a URL lands in request logs.
    const keyword = order.keyword.trim().slice(0, CHECKOUT_LIMITS.keyword.max);
    if (keyword) b.set("keyword", keyword);
    // So does the website (R158): a domain the buyer is buying for, not personal data.
    const website = order.website.trim();
    if (website && !/^[0-9a-f]{32}$/i.test(order.scan)) b.set("website", website);
    return Response.redirect(`${ORIGIN}/checkout?${b}`, 303);
  };

  // checkoutRequest checks the address too; this door checks it itself, as every door that takes one does.
  if (r.kind === "session" && !isPlausibleEmail(order.email.trim().toLowerCase())) {
    return isForm ? back("email") : Response.json({ error: "invalid", message: "An email address is needed." }, { status: 400 });
  }
  if (r.kind === "invalid") {
    if (isForm) return back(r.message.includes("email") ? "email" : r.message.includes("keyword") ? "keyword" : r.message.includes("website") ? "website" : "failed");
    return Response.json({ error: "invalid", message: r.message }, { status: 400 });
  }
  if (r.kind === "call") return go(call);
  if (repeatFailed) {
    if (isForm) return back("failed");
    return Response.json({ error: "checkout_failed", message: "The checkout did not open. Please try again, or book a call." }, { status: 502 });
  }

  const s = await createCheckoutSession(r.form);
  if (s.ok) return go(s.url);
  if (s.reason === "no_key") return go(call);
  console.error(`[checkout] Stripe did not create a Session: ${s.reason} ${s.status ?? ""} ${s.code ?? ""}`.trim());
  if (isForm) return back("failed");
  return Response.json({ error: "checkout_failed", message: "The checkout did not open. Please try again, or book a call." }, { status: 502 });
}
