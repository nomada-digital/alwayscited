import { NextResponse } from "next/server";

import { appPath } from "@/lib/app-host";
import { cancelAtPeriodEnd } from "@/lib/checkout/stripe";
import { dashEmail } from "@/lib/dash/access";
import { dashBase, isDashHost } from "@/lib/dash/host";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { fixtureMode } from "@/lib/tracking/fixture-mode";
import { cancelTrial } from "@/lib/tracking/limits";
import { clientsFor } from "@/lib/tracking/member";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * "Cancel trial" on the dashboards host (cut-over, 22 Oct 2026): the same rule as /app's Settings > Billing had
 * (limits.ts cancelTrial - owner only, a running trial not already cancelled, the Stripe call, the event), posted
 * by Plan's confirm form so it works with JS off. The answer is a 303 back to Plan, `?trial=cancelled` or
 * `?trial=refused`, at #billing. The fixture has no subscription, so it refuses.
 */
export async function POST(req: Request, { params }: { params: Promise<{ client: string }> }) {
  const { client: slug } = await params;
  if (!/^[A-Za-z0-9-]{1,64}$/.test(slug)) return new NextResponse(null, { status: 404 });
  const base = dashBase(req.headers.get("host"));
  const back = (done: "cancelled" | "refused") => NextResponse.redirect(new URL(`${base}/${slug}/plan?trial=${done}#billing`, req.url), 303);
  const form = await req.formData().catch(() => null);
  if (form?.get("confirm") !== "1") return back("refused");
  if (fixtureMode()) return back("refused");

  const email = await dashEmail();
  if (!email) return NextResponse.redirect(new URL(isDashHost(req.headers.get("host")) ? "/login" : appPath("/login"), req.url), 303);
  const client = (await clientsFor(email).catch(() => null))?.find((c) => c.slug === slug);
  if (!client) return new NextResponse(null, { status: 404 });

  const r = await cancelTrial(supabaseAdmin(), {
    clientId: client.id,
    role: client.role,
    by: email,
    now: Date.now(),
    cancel: async (id) => {
      const s = await cancelAtPeriodEnd(id);
      if (!s.ok) console.error(`[dash] trial cancel refused by Stripe: ${s.reason} ${s.status ?? ""}`.trim());
      return s.ok && s.cancelAtPeriodEnd;
    },
  });
  if (!r.ok) {
    console.warn(`[dash] trial cancel refused: ${r.message}`);
    return back("refused");
  }
  return back("cancelled");
}
