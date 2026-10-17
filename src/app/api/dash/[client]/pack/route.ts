import { TRACKING_PACK_PRICE } from "@/config/pricing";
import { addPack } from "@/lib/checkout/stripe";
import { dashEmail } from "@/lib/dash/access";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { clientsFor } from "@/lib/tracking/member";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Buy one extra tracking pack, self-serve (17 Oct 2026). The owner confirms
 * on Plan (`{ confirm: true }`, the price shown beside the button); the pack
 * goes onto the client's own Stripe subscription at pricing.ts's price, and
 * the webhook raises cluster_limit when Stripe confirms. Nothing here takes a
 * price from the request.
 */
export async function POST(req: Request, { params }: { params: Promise<{ client: string }> }) {
  const { client: slug } = await params;
  const email = await dashEmail();
  if (!email) return Response.json({ ok: false, message: "Your session has ended. Sign in again." }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { confirm?: unknown } | null;
  if (body?.confirm !== true) return Response.json({ ok: false, message: "Confirm the pack first." }, { status: 400 });
  const clients = await clientsFor(email).catch(() => null);
  const c = clients?.find((x) => x.slug === slug);
  if (!c) return Response.json({ ok: false, message: "Not found." }, { status: 404 });
  if (c.role !== "owner") return Response.json({ ok: false, message: "Only the account owner can add to the plan." }, { status: 403 });
  if (c.status === "ended") return Response.json({ ok: false, message: "This plan has ended, so nothing can be added to it." }, { status: 409 });

  const { data, error } = await supabaseAdmin()
    .from("orders")
    .select("stripe_subscription_id")
    .eq("client_domain_id", c.id)
    .not("stripe_subscription_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) {
    console.warn(`[dash] could not read the order for a pack: ${error.message}`);
    return Response.json({ ok: false, message: "That did not go through. Nothing was charged. Try again in a minute." }, { status: 502 });
  }
  const sub = data?.[0]?.stripe_subscription_id as string | undefined;
  if (!sub) return Response.json({ ok: false, ask: true, message: "Your plan is not billed by card here, so we add packs for you. Email us and it is done the same day." }, { status: 409 });
  const uk = c.market === "UK";
  const r = await addPack(sub, uk ? { currency: "gbp", amount: TRACKING_PACK_PRICE.uk } : { currency: "usd", amount: TRACKING_PACK_PRICE.us });
  if (!r.ok) {
    console.warn(`[dash] pack refused: ${r.reason} ${r.status ?? ""} ${r.code ?? ""}`);
    if (r.reason === "no_product") return Response.json({ ok: false, ask: true, message: "Packs are added by us for now. Email us and it is done the same day." }, { status: 409 });
    return Response.json({ ok: false, message: "That did not go through. Nothing was charged. Try again in a minute." }, { status: 502 });
  }
  return Response.json({ ok: true, packs: r.packs, message: "Pack added. Your allowance goes up within a minute; the cost is on your next invoice." });
}
