import { NextResponse } from "next/server";

import { TIER_PLAIN } from "@/components/TierName";
import { PACK_CLUSTERS, TRACKING_PACK_PRICE } from "@/config/pricing";
import { appPath } from "@/lib/app-host";
import { packCheckoutForm, packsReady } from "@/lib/checkout/packs";
import { createCheckoutSession } from "@/lib/checkout/stripe";
import { dashEmail } from "@/lib/dash/access";
import { dashBase, isDashHost } from "@/lib/dash/host";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { clientsFor } from "@/lib/tracking/member";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Buy an extra tracking pack (17 Oct 2026): a plain form post from Plan that
 * answers with Stripe Checkout, on the client's own Stripe customer, at
 * pricing.ts's price. The webhook raises cluster_limit when Stripe confirms
 * (lib/checkout/packs.ts). Owners only; nothing here reads a price from the
 * request. Every refusal comes back to Plan with its reason.
 */
export async function POST(req: Request, { params }: { params: Promise<{ client: string }> }) {
  const { client: slug } = await params;
  const base = dashBase(req.headers.get("host"));
  const plan = new URL(`${base}/${slug}/plan`, req.url);
  const back = (why: string) => NextResponse.redirect(new URL(`${plan.pathname}?pack=${why}#pack`, req.url), 303);
  const email = await dashEmail();
  if (!email) return NextResponse.redirect(new URL(isDashHost(req.headers.get("host")) ? "/login" : appPath("/login"), req.url), 303);
  const clients = await clientsFor(email).catch(() => null);
  const c = clients?.find((x) => x.slug === slug);
  if (!c) return new NextResponse(null, { status: 404 });
  if (c.role !== "owner") return back("owner");
  if (c.status === "ended") return back("ended");

  const db = supabaseAdmin();
  if (!(await packsReady(db))) return back("soon");
  const { data, error } = await db
    .from("orders")
    .select("stripe_customer_id")
    .eq("client_domain_id", c.id)
    .not("stripe_customer_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) {
    console.warn(`[dash] could not read the order for a pack: ${error.message}`);
    return back("failed");
  }
  const customer = data?.[0]?.stripe_customer_id as string | undefined;
  if (!customer) return back("none");
  const market = c.market === "UK" ? "uk" : "us";
  const session = await createCheckoutSession(
    packCheckoutForm({ customer, clientId: c.id, slug, market, unitAmount: TRACKING_PACK_PRICE[market], name: `${TIER_PLAIN.tracked} extra tracking pack (+${PACK_CLUSTERS} clusters)`, returnTo: plan.toString() }),
  );
  if (!session.ok) {
    console.warn(`[dash] pack checkout refused: ${session.reason} ${session.status ?? ""} ${session.code ?? ""}`);
    return back("failed");
  }
  return NextResponse.redirect(session.url, 303);
}
