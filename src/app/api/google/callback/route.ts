import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { NONCE_COOKIE, grantedSearchConsole, idTokenEmail, readState } from "@/lib/dash/gsc-oauth";
import { exchange, oauthEnv, storeToken } from "@/lib/dash/gsc-oauth-io";
import { googleWho } from "@/lib/dash/google-who";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Connect Search Console, step 2: Google's redirect (https://dashboards.alwayscited.com/api/google/callback, the
 * Web client's registered URI). The state must carry our signature, be in date and match this browser's nonce; the
 * person is checked again (google-who.ts). The code becomes a refresh token, sealed into gsc_tokens, and the
 * connection waits for its property: the page lists what the account can see and the customer picks one.
 * Every outcome goes back to the page as ?gsc=<word>; no token or error text from Google reaches the URL.
 */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const jar = await cookies();
  const nonce = jar.get(NONCE_COOKIE)?.value;
  const env = oauthEnv();
  if ("missing" in env) return NextResponse.redirect(new URL("/", req.url), 303);
  const s = readState(u.searchParams.get("state") ?? "", env.key, nonce, Date.now());
  if (!s) return NextResponse.redirect(new URL("/", req.url), 303);
  const go = (word: string) => {
    const res = NextResponse.redirect(new URL(`${s.back}?gsc=${word}`, req.url), 303);
    res.cookies.delete({ name: NONCE_COOKIE, path: "/api/google" });
    return res;
  };
  if (u.searchParams.get("error")) return go("cancelled");
  const w = await googleWho(s.slug, s.back);
  if ("status" in w || w.by !== s.by) return go("refused");
  const t = await exchange(env, (u.searchParams.get("code") ?? "").slice(0, 2000));
  if ("error" in t) {
    console.warn(`[gsc-oauth] ${s.slug}: token exchange failed: ${t.error}`);
    return go("failed");
  }
  if (!grantedSearchConsole(t.scope)) return go("noscope");
  if (!t.refresh) return go("failed");
  const db = supabaseAdmin();
  const email = idTokenEmail(t.idToken);
  const stored = await storeToken(db, env, { clientId: w.id, refresh: t.refresh, email, scope: t.scope, by: w.by });
  if (stored) {
    console.error(`[gsc-oauth] ${s.slug}: grant not stored: ${stored}`);
    return go("failed");
  }
  const now = new Date().toISOString();
  const { error } = await db.from("integration_connections").upsert(
    { client_domain_id: w.id, provider: "gsc", status: "pending", via: "google", auth: "oauth", google_email: email, account_email: email, property: null, property_name: null, permission: null, requested_by: w.by, requested_at: now, error: null, backfilled_at: null, updated_at: now },
    { onConflict: "client_domain_id,provider" },
  );
  if (error) {
    console.error(`[gsc-oauth] ${s.slug}: connection not recorded: ${error.message}`);
    return go("failed");
  }
  return go("pick");
}
