import { NextResponse } from "next/server";

import { dashEmail } from "@/lib/dash/access";
import { dashBase } from "@/lib/dash/host";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { dashUrl } from "@/lib/tracking/app-redirect";
import { missingColumn } from "@/lib/tracking/limits";
import { clientsFor } from "@/lib/tracking/member";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Email settings on the dashboards host (18 Oct 2026 brief 2e): a signed-in member switches their own Monday
 * "This week" email (#7) on or off - dashboard_members.this_week_opt_out, the column the one-click unsubscribe
 * writes (20261018040000). A plain form post from Settings; it changes only the member's own row on this
 * client's account and comes back to Settings with a word for the toast.
 */
export async function POST(req: Request, { params }: { params: Promise<{ client: string }> }) {
  const { client: slug } = await params;
  const back = (word: string) => NextResponse.redirect(dashUrl(req, `${dashBase(req.headers.get("host"))}/${encodeURIComponent(slug)}/settings?email=${word}#email`), 303);
  const email = await dashEmail();
  if (!email) return NextResponse.redirect(dashUrl(req, "/login"), 303);
  const form = await req.formData().catch(() => null);
  const want = form?.get("this_week");
  if (want !== "on" && want !== "off") return back("failed");
  const clients = await clientsFor(email).catch(() => null);
  const c = clients?.find((x) => x.slug === slug);
  if (!c) return new NextResponse(null, { status: 404 });
  const db = supabaseAdmin();
  const { data: row, error: rErr } = await db.from("client_domains").select("account_id").eq("id", c.id).maybeSingle();
  if (rErr || !row) return back("failed");
  const { error } = await db.from("dashboard_members").update({ this_week_opt_out: want === "off" }).eq("account_id", row.account_id as string).eq("email", email).is("removed_at", null);
  if (error) {
    console.warn(`[dash] email setting not saved: ${missingColumn(error) ? "this_week_opt_out is not there yet" : error.message}`);
    return back(missingColumn(error) ? "soon" : "failed");
  }
  return back(want === "off" ? "off" : "on");
}
