import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { REDIRECT_URI, REVOKE_URL, TOKEN_URL, open, seal, tokenKey } from "@/lib/dash/gsc-oauth";

/**
 * The server half of one-click Search Console (gsc-oauth.ts). The refresh token lives only in gsc_tokens, sealed
 * with GSC_TOKEN_KEY; it is never selected by anything that answers a browser, never logged, and an access token is
 * held in memory for its hour and no longer. Google's errors are reported by code and description only.
 */
export type OAuthEnv = { clientId: string; clientSecret: string; key: Buffer };

/** The three env values, or what is missing (by name only). */
export function oauthEnv(): OAuthEnv | { missing: string[] } {
  const clientId = process.env.GSC_OAUTH_CLIENT_ID ?? "";
  const clientSecret = process.env.GSC_OAUTH_CLIENT_SECRET ?? "";
  const key = tokenKey(process.env.GSC_TOKEN_KEY);
  const missing = [!clientId && "GSC_OAUTH_CLIENT_ID", !clientSecret && "GSC_OAUTH_CLIENT_SECRET", !key && "GSC_TOKEN_KEY"].filter(Boolean) as string[];
  return missing.length ? { missing } : { clientId, clientSecret, key: key! };
}

const googleWhy = (j: Record<string, unknown>, status: number) => `${String(j.error ?? status)}${j.error_description ? ` (${String(j.error_description).slice(0, 160)})` : ""}`;

/** The code Google sent back, for tokens. */
export async function exchange(env: OAuthEnv, code: string): Promise<{ refresh: string | null; access: string; idToken: unknown; scope: string } | { error: string }> {
  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: env.clientId, client_secret: env.clientSecret, redirect_uri: REDIRECT_URI, grant_type: "authorization_code" }),
    signal: AbortSignal.timeout(20_000),
  }).catch((e: unknown) => (e instanceof Error ? e.message : String(e)));
  if (typeof r === "string") return { error: `Google unreachable: ${r.slice(0, 120)}` };
  const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok || !j.access_token) return { error: googleWhy(j, r.status) };
  return { refresh: typeof j.refresh_token === "string" ? j.refresh_token : null, access: String(j.access_token), idToken: j.id_token, scope: String(j.scope ?? "") };
}

export async function storeToken(db: SupabaseClient, env: OAuthEnv, p: { clientId: string; refresh: string; email: string | null; scope: string; by: string }): Promise<string | null> {
  const now = new Date().toISOString();
  const { error } = await db
    .from("gsc_tokens")
    .upsert({ client_domain_id: p.clientId, token_enc: seal(p.refresh, env.key), google_email: p.email, scope: p.scope.slice(0, 500), created_by: p.by, created_at: now, updated_at: now }, { onConflict: "client_domain_id" });
  return error ? error.message : null;
}

const cache = new Map<string, { token: string; exp: number }>();

/** An access token for this client's stored grant, from memory while it has a minute left. */
export async function accessToken(db: SupabaseClient, env: OAuthEnv, clientId: string): Promise<{ token: string; email: string | null } | { error: string }> {
  const { data, error } = await db.from("gsc_tokens").select("token_enc, google_email").eq("client_domain_id", clientId).maybeSingle();
  if (error) return { error: `gsc_tokens: ${error.message}` };
  if (!data) return { error: "not connected" };
  const hit = cache.get(clientId);
  if (hit && hit.exp - 60_000 > Date.now()) return { token: hit.token, email: (data.google_email as string | null) ?? null };
  const refresh = open(data.token_enc as string, env.key);
  if (!refresh) return { error: "the stored grant could not be opened (GSC_TOKEN_KEY changed?)" };
  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env.clientId, client_secret: env.clientSecret, refresh_token: refresh, grant_type: "refresh_token" }),
    signal: AbortSignal.timeout(20_000),
  }).catch((e: unknown) => (e instanceof Error ? e.message : String(e)));
  if (typeof r === "string") return { error: `Google unreachable: ${r.slice(0, 120)}` };
  const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  // invalid_grant: the customer removed our access at Google, or the grant lapsed. They connect again.
  if (!r.ok || !j.access_token) return { error: j.error === "invalid_grant" ? "access was removed at Google: connect again" : googleWhy(j, r.status) };
  cache.set(clientId, { token: String(j.access_token), exp: Date.now() + Number(j.expires_in ?? 3600) * 1000 });
  return { token: String(j.access_token), email: (data.google_email as string | null) ?? null };
}

/** Revokes the grant at Google (best effort) and deletes it here. */
export async function forget(db: SupabaseClient, env: OAuthEnv, clientId: string): Promise<string | null> {
  const { data, error: readErr } = await db.from("gsc_tokens").select("token_enc").eq("client_domain_id", clientId).maybeSingle();
  if (readErr) return `gsc_tokens: ${readErr.message}`;
  const refresh = data ? open(data.token_enc as string, env.key) : null;
  if (refresh) await fetch(`${REVOKE_URL}?${new URLSearchParams({ token: refresh })}`, { method: "POST", signal: AbortSignal.timeout(10_000) }).catch(() => null);
  cache.delete(clientId);
  const { error } = await db.from("gsc_tokens").delete().eq("client_domain_id", clientId);
  return error ? `gsc_tokens: ${error.message}` : null;
}

const enc = encodeURIComponent;

async function gsc(token: string, url: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  const r = await fetch(url, { ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}`, "content-type": "application/json" }, cache: "no-store", signal: AbortSignal.timeout(50_000) });
  const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok) {
    const e = (j.error ?? {}) as { message?: string; status?: string };
    return { error: `${r.status} ${e.status ?? ""} ${String(e.message ?? "").slice(0, 200)}`.trim() };
  }
  return j;
}

/** sites.list as the signed-in Google account: every property it can see. */
export async function sitesAs(token: string): Promise<{ site: string; permission: string }[] | { error: string }> {
  const j = await gsc(token, "https://www.googleapis.com/webmasters/v3/sites");
  if (j.error) return { error: String(j.error) };
  return ((j.siteEntry ?? []) as { siteUrl: string; permissionLevel: string }[]).map((s) => ({ site: s.siteUrl, permission: s.permissionLevel }));
}

/** searchAnalytics.query, in the shape google-io's pull reads ({rows} or {error}). */
export async function queryAs(token: string, site: string, body: { start: string; end: string; dimensions: string[]; rowLimit: number }): Promise<{ rows?: unknown[]; error?: string }> {
  const j = await gsc(token, `https://www.googleapis.com/webmasters/v3/sites/${enc(site)}/searchAnalytics/query`, {
    method: "POST",
    body: JSON.stringify({ startDate: body.start, endDate: body.end, dimensions: body.dimensions, rowLimit: body.rowLimit, type: "web", dataState: "final" }),
  });
  return j.error ? { error: String(j.error) } : { rows: (j.rows ?? []) as unknown[] };
}

/** URL Inspection (read-only scope is enough). */
export async function inspectAs(token: string, site: string, url: string): Promise<Record<string, unknown>> {
  const j = await gsc(token, "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect", { method: "POST", body: JSON.stringify({ inspectionUrl: url, siteUrl: site, languageCode: "en-GB" }) });
  if (j.error) return { error: j.error };
  const x = ((j.inspectionResult ?? {}) as { indexStatusResult?: Record<string, unknown> }).indexStatusResult ?? {};
  return { verdict: x.verdict ?? null, coverage: x.coverageState ?? null, lastCrawl: x.lastCrawlTime ?? null };
}
