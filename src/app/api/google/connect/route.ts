import { NextResponse } from "next/server";

import { NONCE_COOKIE, STATE_TTL_MS, authUrl, newNonce, safeBack, signState } from "@/lib/dash/gsc-oauth";
import { oauthEnv } from "@/lib/dash/gsc-oauth-io";
import { googleWho } from "@/lib/dash/google-who";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Connect Search Console, step 1 (16 Nov 2026, lib/dash/gsc-oauth.ts): GET ?client=<slug>&back=<this page's path>.
 * Checks who is asking (google-who.ts), signs a state naming the client, who and where to come back to, sets the
 * nonce cookie and sends the browser to Google's consent page. Nothing is stored until Google sends it back.
 */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const slug = (u.searchParams.get("client") ?? "").slice(0, 80);
  const back = safeBack(u.searchParams.get("back"), slug);
  const w = await googleWho(slug, back);
  if ("status" in w) return NextResponse.redirect(new URL(`${back}?gsc=refused`, req.url), 303);
  const env = oauthEnv();
  if ("missing" in env) {
    console.error(`[gsc-oauth] not configured: ${env.missing.join(", ")}`);
    return NextResponse.redirect(new URL(`${back}?gsc=unavailable`, req.url), 303);
  }
  const nonce = newNonce();
  const state = signState({ slug, by: w.by, staff: w.staff, back, nonce, exp: Date.now() + STATE_TTL_MS }, env.key);
  const res = NextResponse.redirect(authUrl(env.clientId, state, w.staff ? undefined : w.by), 303);
  res.cookies.set(NONCE_COOKIE, nonce, { httpOnly: true, secure: true, sameSite: "lax", path: "/api/google", maxAge: STATE_TTL_MS / 1000 });
  return res;
}
