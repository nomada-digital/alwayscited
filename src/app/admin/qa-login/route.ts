import { NextResponse } from "next/server";

import { refuseUnlessAdmin } from "@/app/admin/admin-auth";
import { isStaffEmail } from "@/lib/dash/staff";
import { isPreviewDeploy } from "@/lib/dash/host";
import { normalizeEmail } from "@/lib/email-address";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { hashToken, newToken, sessionCookie } from "@/lib/tracking/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Staff QA sign-in for Vercel previews only (27 Nov 2026, Danny). A preview cannot use the emailed link - the link
 * points at production - so a reviewer signs in here instead, with no password of its own and no new credential:
 *
 *   - VERCEL_ENV must be "preview"; anywhere else this is a 404, as if the route did not exist
 *   - the /admin Basic auth (ADMIN_USER / ADMIN_PASSWORD, the same values) must pass, in the proxy and again here
 *   - the address must be a @nomadadigital.co.uk member of the dashboard (an active dashboard_members row)
 *
 * The session it starts is the ordinary one (dashboard_sessions, same cookie) but lasts eight hours, not thirty days.
 * Nothing is sent to anyone. GET shows the form; POST signs in.
 */
const QA_SESSION_MS = 8 * 60 * 60 * 1000;
const gone = () => new NextResponse(null, { status: 404 });

export async function GET(): Promise<Response> {
  if (!isPreviewDeploy()) return gone();
  const refused = await refuseUnlessAdmin();
  if (refused) return new NextResponse(refused.message, { status: 401 });
  const html = `<!doctype html><meta charset="utf-8"><meta name="robots" content="noindex"><title>QA sign-in</title>
<body style="font:16px system-ui;max-width:28rem;margin:4rem auto;padding:0 1rem">
<h1 style="font-size:20px">QA sign-in (preview only)</h1>
<p>Starts a dashboard session for a Nomada staff address that is a member of the dashboard. Lasts eight hours. Sends nothing.</p>
<form method="post"><label>Staff email<br><input name="email" type="email" required autocomplete="email" style="width:100%;padding:8px;margin:6px 0 14px"></label>
<button style="padding:8px 14px">Sign in</button></form></body>`;
  return new NextResponse(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex, nofollow" } });
}

export async function POST(req: Request): Promise<Response> {
  if (!isPreviewDeploy()) return gone();
  const refused = await refuseUnlessAdmin();
  if (refused) return new NextResponse(refused.message, { status: 401 });
  const form = await req.formData().catch(() => null);
  const email = normalizeEmail(String(form?.get("email") ?? ""));
  if (!isStaffEmail(email)) return new NextResponse("Staff addresses only.", { status: 403 });

  const db = supabaseAdmin();
  const { data: member, error: mErr } = await db.from("dashboard_members").select("email").eq("email", email).is("removed_at", null).limit(1);
  if (mErr) return new NextResponse("Could not check the address.", { status: 502 });
  if (!member?.length) return new NextResponse("That address is not a member of the dashboard.", { status: 403 });

  const session = newToken();
  const { error } = await db.from("dashboard_sessions").insert({ token_hash: hashToken(session), email, expires_at: new Date(Date.now() + QA_SESSION_MS).toISOString() });
  if (error) return new NextResponse("Could not start a session.", { status: 502 });

  const res = NextResponse.redirect(new URL("/dashboards", req.url), 303);
  res.cookies.set({ ...sessionCookie(session), maxAge: Math.floor(QA_SESSION_MS / 1000) });
  return res;
}
