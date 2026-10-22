import { NextResponse } from "next/server";

import { dashNext } from "@/lib/dash/host";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { SESSION_TTL_MS, hashToken, isTokenShape, newToken, sessionCookie } from "@/lib/tracking/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Consume a login link on the dashboards host and start a session there
 * (17 Oct 2026). The same claim as /api/app/auth - a POST from the page's
 * button, never the link's GET, so a mail scanner cannot spend it; a
 * compare-and-swap on `used_at` so it works once - with the cookie set on this
 * host, which is why this host has its own route rather than /app's.
 */
export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  const token = form?.get("token");
  const back = (path: string) => NextResponse.redirect(new URL(path, req.url), 303);
  if (!isTokenShape(token)) return back("/login?link=expired");
  // where the link was asked from (an old /app link's next too), checked again here (dashNext)
  const next = dashNext(form?.get("next"));
  const failed = back(`/auth?token=${token}&failed=1${next ? `&next=${encodeURIComponent(next)}` : ""}`);

  const db = supabaseAdmin();
  const { data: claimed, error } = await db
    .from("dashboard_login_tokens")
    .update({ used_at: new Date().toISOString() })
    .eq("token_hash", hashToken(token))
    .is("used_at", null)
    .gt("expires_at", new Date().toISOString())
    .select("email");
  if (error) {
    console.warn(`[dash] could not claim a login token: ${error.message}`);
    return failed;
  }
  const email = claimed?.[0]?.email as string | undefined;
  if (!email) return back("/login?link=expired");

  const session = newToken();
  const { error: sErr } = await db.from("dashboard_sessions").insert({ token_hash: hashToken(session), email, expires_at: new Date(Date.now() + SESSION_TTL_MS).toISOString() });
  if (sErr) {
    console.warn(`[dash] could not start a session: ${sErr.message}`);
    return failed;
  }
  const { error: lErr } = await db.from("dashboard_members").update({ last_login_at: new Date().toISOString() }).eq("email", email).is("removed_at", null);
  if (lErr) console.warn(`[dash] could not record the sign-in: ${lErr.message}`);

  const res = back(next ?? "/");
  res.cookies.set(sessionCookie(session));
  return res;
}
