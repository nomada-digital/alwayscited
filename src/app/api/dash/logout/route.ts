import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { SESSION_COOKIE, hashToken, isTokenShape } from "@/lib/tracking/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Sign out of the dashboards host: end this session and clear its cookie (17 Oct 2026). */
export async function POST(req: Request) {
  const token = (req.headers.get("cookie") ?? "")
    .split(/;\s*/)
    .find((c) => c.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);
  if (isTokenShape(token)) {
    const { error } = await supabaseAdmin().from("dashboard_sessions").update({ expires_at: new Date().toISOString() }).eq("token_hash", hashToken(token));
    if (error) console.warn(`[dash] could not end a session: ${error.message}`);
  }
  const res = NextResponse.redirect(new URL("/login?out=1", req.url), 303);
  res.cookies.set({ name: SESSION_COOKIE, value: "", path: "/", maxAge: 0, httpOnly: true, secure: true, sameSite: "lax" });
  return res;
}
