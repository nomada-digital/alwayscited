import { after } from "next/server";

import { canSubmit, sitemapFor } from "@/lib/dash/google";
import { hubGoogle, pullGoogle } from "@/lib/dash/google-io";
import { googleWho } from "@/lib/dash/google-who";
import { forget, inspectAs, accessToken, oauthEnv, sitesAs } from "@/lib/dash/gsc-oauth-io";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Search Console, connected by signing in with Google (16 Nov 2026, lib/dash/gsc-oauth.ts; the sign-in itself is
 * /api/google/connect and /api/google/callback). POST {op, ...}:
 *
 *   list                 the properties the signed-in Google account can see for this client's domain
 *   pick   {property}    connect one of them; the 16-month first pull runs after the answer
 *   disconnect           revoke the grant at Google and delete it; reading stops
 *   setup / help         no property for the site: the steps to set one up, and a task for the account owner in the hub
 *   inspect {url}        staff only: URL Inspection for a key page (read-only scope is enough)
 *   submit               staff only: a sitemap submit, which needs write access - only through the hub's service
 *                        account on a property that gave it Full, never through a one-click grant (read-only)
 *
 * Who may: google-who.ts. GA4 is not connected here for now (Danny, 16 Nov 2026: by hand until the OAuth app
 * carries Analytics).
 */
/** The hub's google-oauth, server to server with this project's service key (as google-io.ts reaches google-data). */
async function hubOAuth(action: string, body: Record<string, unknown>): Promise<Record<string, unknown> & { error?: string }> {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return { error: "not connected to the hub" };
  const r = await fetch("https://qpsrvmnmtozvailsyqqz.supabase.co/functions/v1/google-oauth", { method: "POST", headers: { "content-type": "application/json", "x-ac-key": key }, body: JSON.stringify({ ...body, action }), cache: "no-store", signal: AbortSignal.timeout(20_000) }).catch((e: unknown) => String(e));
  if (typeof r === "string") return { error: r.slice(0, 160) };
  const j = (await r.json().catch(() => ({}))) as Record<string, unknown> & { error?: string };
  return r.ok ? j : { error: j.error ?? `hub answered ${r.status}` };
}

const bare = (s: string) => s.toLowerCase().replace(/^sc-domain:/, "").replace(/^[a-z]+:\/\//, "").replace(/^www\./, "").split(/[/?#:]/)[0];
const forDomain = (site: string, domain: string) => { const p = bare(site), d = bare(domain); return !!d && (p === d || p.endsWith(`.${d}`)); };

export async function POST(req: Request, { params }: { params: Promise<{ client: string }> }) {
  const { client: slug } = await params;
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const op = typeof b?.op === "string" ? b.op : "";
  const w = await googleWho(slug, typeof b?.path === "string" ? b.path.slice(0, 600) : "");
  if ("status" in w) return Response.json({ ok: false, message: w.message }, { status: w.status });
  const db = supabaseAdmin();
  const env = oauthEnv();
  if ("missing" in env) {
    console.error(`[gsc-oauth] not configured: ${env.missing.join(", ")}`);
    return Response.json({ ok: false, message: "Connecting Search Console isn't switched on yet. Try again later today." }, { status: 503 });
  }
  const { data: conn, error: connErr } = await db.from("integration_connections").select("property, via, auth, permission, google_email").eq("client_domain_id", w.id).eq("provider", "gsc").maybeSingle();
  if (connErr) return Response.json({ ok: false, message: "We couldn't read the connection. Try again in a minute." }, { status: 502 });
  const c = (conn ?? {}) as { property?: string | null; via?: string; auth?: string | null; permission?: string | null; google_email?: string | null };

  if (op === "list" || op === "pick") {
    const t = await accessToken(db, env, w.id);
    if ("error" in t) return Response.json({ ok: false, message: t.error === "not connected" ? "Sign in with Google first." : "Google didn't let us in with that sign-in. Connect again." }, { status: 400 });
    const all = await sitesAs(t.token);
    if ("error" in all) {
      console.warn(`[gsc-oauth] ${slug}: sites.list failed: ${all.error}`);
      return Response.json({ ok: false, message: "We couldn't read your Search Console just now. Try again in a minute." }, { status: 502 });
    }
    // Only this site's properties: staff signing in with their own account see every client's.
    const listed = all.filter((s) => forDomain(s.site, w.domain) && s.permission !== "siteUnverifiedUser").map((s) => ({ id: s.site, name: s.site, permission: s.permission }));
    if (op === "list") {
      return Response.json(listed.length ? { ok: true, email: t.email, listed } : { ok: true, email: t.email, listed: [], message: `${t.email ?? "That Google account"} can't see a Search Console property for ${w.domain}. Sign in with the account that owns it, or ask its owner to add you.` });
    }
    const property = typeof b?.property === "string" ? b.property.slice(0, 300) : "";
    const hit = listed.find((p) => p.id === property);
    if (!hit) return Response.json({ ok: false, message: "That property isn't one this Google account can see for your site." }, { status: 400 });
    const now = new Date().toISOString();
    const { error } = await db
      .from("integration_connections")
      .update({ status: "connected", property, property_name: hit.name, permission: hit.permission, via: "google", auth: "oauth", connected_by: w.by, connected_at: now, error: null, backfilled_at: null, updated_at: now })
      .eq("client_domain_id", w.id)
      .eq("provider", "gsc");
    if (error) {
      console.warn(`[gsc-oauth] ${slug}: could not save the property: ${error.message}`);
      return Response.json({ ok: false, message: "That did not save. Try again in a minute." }, { status: 502 });
    }
    // The 16-month first pull runs after the answer; the morning run picks up anything it missed.
    after(async () => {
      const e = await pullGoogle(db, { client_domain_id: w.id, provider: "gsc", property, backfilled_at: null, auth: "oauth" }).catch((err: unknown) => String(err));
      if (e) console.warn(`[gsc-oauth] first pull ${slug}: ${e}`);
    });
    return Response.json({ ok: true, connected: true, property, name: hit.name, permission: hit.permission, email: t.email });
  }

  // Signed in, but the account has no property for the site (16 Nov 2026): the steps to set one up, read for the site's
  // platform by the hub's google-oauth, and "Stuck? We'll do it for you", a task for the account owner in the hub.
  if (op === "setup" || op === "help") {
    const a = await hubOAuth(op === "setup" ? "ac_setup_hint" : "ac_help", { domain: w.domain, ac_slug: slug, by: w.by });
    if (a.error) {
      console.warn(`[gsc-oauth] ${slug}: ${op} failed: ${a.error}`);
      return Response.json({ ok: false, message: op === "help" ? "That didn't go through. Try again in a minute." : "We couldn't load the steps just now." }, { status: 502 });
    }
    return Response.json({ ok: true, ...a });
  }

  if (op === "disconnect") {
    const e = await forget(db, env, w.id);
    if (e) {
      console.error(`[gsc-oauth] ${slug}: disconnect failed: ${e}`);
      return Response.json({ ok: false, message: "That didn't disconnect. Try again in a minute." }, { status: 502 });
    }
    const now = new Date().toISOString();
    const { error } = await db.from("integration_connections").update({ status: "disconnected", property: null, property_name: null, permission: null, google_email: null, error: null, updated_at: now }).eq("client_domain_id", w.id).eq("provider", "gsc");
    if (error) console.warn(`[gsc-oauth] ${slug}: connection not marked disconnected: ${error.message}`);
    // The rows already pulled stay until they are deleted by hand within the 30 days the privacy section promises:
    // a bulk delete of live rows is not something code here does on its own (CLAUDE.md).
    console.warn(`[gsc-oauth] ${slug}: disconnected by ${w.by}; Search Console rows to delete within 30 days`);
    return Response.json({ ok: true, message: "Disconnected. We've removed our access and stopped reading your Search Console." });
  }

  // The indexing helpers, staff only at first (Danny, 15 Nov 2026).
  if (!w.staff) return Response.json({ ok: false, message: "Not available yet." }, { status: 403 });
  const site = c.via === "google" ? (c.property ?? "") : "";
  if (!site) return Response.json({ ok: false, message: "Connect Search Console first." }, { status: 400 });
  if (op === "inspect") {
    const url = typeof b?.url === "string" && /^https?:\/\//.test(b.url) ? b.url.slice(0, 600) : "";
    if (!url) return Response.json({ ok: false, message: "Which page?" }, { status: 400 });
    let a: Record<string, unknown>;
    if (c.auth === "oauth") {
      const t = await accessToken(db, env, w.id);
      a = "error" in t ? { error: t.error } : await inspectAs(t.token, site, url);
    } else a = await hubGoogle("gsc_inspect", { site, url });
    if (a.error) return Response.json({ ok: false, message: String(a.error) });
    const row = { client_domain_id: w.id, url, verdict: (a.verdict as string | null) ?? null, coverage: (a.coverage as string | null) ?? null, last_crawl: (a.lastCrawl as string | null) ?? null, inspected_at: new Date().toISOString() };
    const { error } = await db.from("gsc_inspections").upsert(row, { onConflict: "client_domain_id,url" });
    if (error) console.warn(`[gsc-oauth] inspection not stored: ${error.message}`);
    return Response.json({ ok: true, ...row });
  }
  if (op === "submit") {
    if (c.auth === "oauth" || !canSubmit(c.permission)) return Response.json({ ok: false, message: "Submitting a sitemap is a change, and this connection is read-only. Submit it in Search Console, under Sitemaps." });
    const a = await hubGoogle("gsc_submit", { site, feedpath: sitemapFor(site) });
    return Response.json(a.error ? { ok: false, message: String(a.error) } : { ok: true, message: `Submitted ${sitemapFor(site)}.` });
  }
  return Response.json({ ok: false, message: "Unknown request." }, { status: 400 });
}
