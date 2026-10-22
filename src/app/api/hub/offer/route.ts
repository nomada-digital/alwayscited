import { timingSafeEqual } from "node:crypto";

import { TRACKED_PRICE } from "@/config/pricing";
import { TIER_PLAIN } from "@/components/TierName";
import { isPlausibleEmail } from "@/lib/email-address";
import { createCheckoutSession } from "@/lib/checkout/stripe";
import { firstChargeAt, hubOfferForm } from "@/lib/checkout/hub-offer";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ORIGIN = "https://alwayscited.com";

/**
 * The agency hub's subscription offer (22 Oct 2026, lib/checkout/hub-offer.ts): a Stripe Checkout link for an
 * existing client to keep its alwaystracked profile after a Nomada project's included period. Server to server only:
 * the hub's edge function alwayscited-admin (action project_offer) sends `x-hub-secret`, which must equal
 * HUB_OFFER_SECRET; unset, the door answers 503 and makes nothing. The amount is pricing.ts's, never the request's.
 *
 * POST {slug, email (the client's login, prefilled on Checkout), starts_on?: "YYYY-MM-DD" (the last included day), hub_project_id, plan?: "tracked"}
 * -> {url, amount, currency, first_charge}
 */
export async function POST(req: Request) {
  const secret = process.env.HUB_OFFER_SECRET;
  if (!secret) return Response.json({ error: "not_configured" }, { status: 503 });
  const given = Buffer.from(req.headers.get("x-hub-secret") ?? "");
  const want = Buffer.from(secret);
  if (given.length !== want.length || !timingSafeEqual(given, want)) return Response.json({ error: "forbidden" }, { status: 403 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }
  const slug = typeof body.slug === "string" && /^[a-z0-9-]{1,80}$/.test(body.slug) ? body.slug : null;
  const project = typeof body.hub_project_id === "string" && /^[0-9a-f-]{36}$/.test(body.hub_project_id) ? body.hub_project_id : null;
  const plan = typeof body.plan === "string" ? body.plan : "tracked";
  if (!slug || !project) return Response.json({ error: "bad_request" }, { status: 400 });
  // Only alwaystracked is offered this way: the managed plans are priced by sector and sold on a call.
  if (plan !== "tracked") return Response.json({ error: "plan_not_offered" }, { status: 400 });

  const db = supabaseAdmin();
  const { data: client, error } = await db.from("client_domains").select("id, slug, market").eq("slug", slug).maybeSingle();
  if (error) return Response.json({ error: "read_failed" }, { status: 502 });
  if (!client) return Response.json({ error: "not_found" }, { status: 404 });

  // The client's login, from the hub project; Checkout asks for one itself when it is missing.
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const market = client.market === "US" ? "us" : "uk";
  const unit = TRACKED_PRICE[market];
  const anchor = firstChargeAt(typeof body.starts_on === "string" ? body.starts_on : null);
  const form = hubOfferForm({
    clientId: client.id as string,
    slug,
    market,
    email: isPlausibleEmail(email) ? email : null,
    unitAmount: unit,
    name: TIER_PLAIN.tracked,
    anchor,
    hubProjectId: project,
    origin: ORIGIN,
  });
  const s = await createCheckoutSession(form);
  if (!s.ok) {
    console.error(`[hub-offer] Stripe did not create a Session for ${slug}: ${s.reason} ${s.status ?? ""} ${s.code ?? ""}`.trim());
    return Response.json({ error: s.reason === "no_key" ? "not_configured" : "checkout_failed" }, { status: s.reason === "no_key" ? 503 : 502 });
  }
  return Response.json({
    url: s.url,
    amount: unit,
    currency: market === "uk" ? "GBP" : "USD",
    first_charge: anchor ? new Date(anchor * 1000).toISOString().slice(0, 10) : null,
  });
}

/** Server to server only. */
export function GET() {
  return Response.json({ error: "method_not_allowed" }, { status: 405, headers: { allow: "POST" } });
}
