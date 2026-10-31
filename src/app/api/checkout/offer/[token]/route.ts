import { CHECKOUT_LIMITS } from "@/config/contact";
import { TIER_PLAIN } from "@/components/TierName";
import { isPlausibleEmail } from "@/lib/email-address";
import { contractOfferForm, firstChargeOf, offerState } from "@/lib/checkout/contract-offer";
import { readContractOffer } from "@/lib/checkout/contract-offer-read";
import { createCheckoutSession } from "@/lib/checkout/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ORIGIN = "https://alwayscited.com";

/**
 * A contract offer's checkout (31 Oct 2026, lib/checkout/contract-offer.ts): the form at /checkout/offer/<token>
 * posts the buyer's email here, and this opens Stripe Checkout at the offer row's price. Only the email comes from
 * the request; the amount, payments, plan and website are the row's. A used, expired or unknown offer opens nothing
 * and goes back to the page, which says why.
 */
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const page = `${ORIGIN}/checkout/offer/${token}`;
  const back = (error: string) => Response.redirect(`${page}?error=${error}`, 303);

  let email = "";
  try {
    email = (new URLSearchParams(await req.text()).get("email") ?? "").trim().toLowerCase();
  } catch {
    return back("failed");
  }

  let offer;
  try {
    offer = await readContractOffer(token);
  } catch (e) {
    console.error("[offer] could not read the offer: " + (e instanceof Error ? e.message : String(e)));
    return back("failed");
  }
  if (!offer || offerState(offer) !== "open") return Response.redirect(page, 303);
  if (email.length > CHECKOUT_LIMITS.email || !isPlausibleEmail(email)) return back("email");

  const form = contractOfferForm(offer, { email, planName: TIER_PLAIN[offer.tier], origin: ORIGIN, backUrl: page, anchor: firstChargeOf(offer.first_charge_on) });
  const s = await createCheckoutSession(form);
  if (s.ok) return Response.redirect(s.url, 303);
  console.error(`[offer] Stripe did not create a Session: ${s.reason} ${s.status ?? ""} ${s.code ?? ""}`.trim());
  return back("failed");
}
