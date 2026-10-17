import { NextResponse } from "next/server";

import { appPath } from "@/lib/app-host";
import { createPortalSession } from "@/lib/checkout/stripe";
import { dashEmail } from "@/lib/dash/access";
import { dashBase, isDashHost } from "@/lib/dash/host";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { clientsFor } from "@/lib/tracking/member";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Billing on the dashboards host (17 Oct 2026): the owner is sent to Stripe's
 * customer portal for this client's subscription - invoices, card, cancel at
 * period end - and comes back to Plan. A plain form post from Plan; anyone but
 * the owner, or a client with no Stripe customer, is sent back with a reason.
 */
export async function POST(req: Request, { params }: { params: Promise<{ client: string }> }) {
  const { client: slug } = await params;
  const base = dashBase(req.headers.get("host"));
  const back = (why: string) => NextResponse.redirect(new URL(`${base}/${slug}/plan?billing=${why}#billing`, req.url), 303);
  const email = await dashEmail();
  if (!email) return NextResponse.redirect(new URL(isDashHost(req.headers.get("host")) ? "/login" : appPath("/login"), req.url), 303);
  const clients = await clientsFor(email).catch(() => null);
  const c = clients?.find((x) => x.slug === slug);
  if (!c) return new NextResponse(null, { status: 404 });
  if (c.role !== "owner") return back("owner");

  const { data, error } = await supabaseAdmin()
    .from("orders")
    .select("stripe_customer_id")
    .eq("client_domain_id", c.id)
    .not("stripe_customer_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) {
    console.warn(`[dash] could not read the order for billing: ${error.message}`);
    return back("failed");
  }
  const customer = data?.[0]?.stripe_customer_id as string | undefined;
  if (!customer) return back("none");
  const session = await createPortalSession(customer, new URL(`${base}/${slug}/plan`, req.url).toString());
  if (!session.ok) {
    console.warn(`[dash] billing portal refused: ${session.reason} ${session.status ?? ""} ${session.code ?? ""}`);
    return back("failed");
  }
  return NextResponse.redirect(session.url, 303);
}
