import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { CONNECTOR, type ConnectProvider, candidates, queryRows, staleLine, windsorVisible, windsorWhy } from "@/lib/dash/connect";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * The live half of connect.ts (2 Nov 2026, sg-37): Windsor's REST API with
 * WINDSOR_API_KEY, the check behind "Check connection", the daily pull for
 * connected properties (run by the 05:00 track cron) and the 24 hour line for
 * the run-health mail. Windsor is read only and on a flat subscription, so
 * nothing here spends per call. Never throws to its callers.
 */

const WINDSOR = "https://connectors.windsor.ai/";

type Answer = { visible: boolean; rows: unknown[]; why: string | null };

async function windsor(connector: string, params: Record<string, string>): Promise<Answer> {
  const key = process.env.WINDSOR_API_KEY ?? "";
  if (!key) return { visible: false, rows: [], why: "WINDSOR_API_KEY is not set" };
  const url = `${WINDSOR}${connector}?${new URLSearchParams({ api_key: key, ...params })}`;
  try {
    const r = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(45_000) });
    const body = (await r.json().catch(() => null)) as unknown;
    const visible = r.ok && windsorVisible(body);
    return { visible, rows: visible ? ((body as { data: unknown[] }).data ?? []) : [], why: visible ? null : windsorWhy(body, key) };
  } catch (err) {
    return { visible: false, rows: [], why: (err instanceof Error ? err.message : String(err)).split(key).join("***").slice(0, 200) };
  }
}

export const windsorReady = (): boolean => Boolean(process.env.WINDSOR_API_KEY);

/** The first candidate Windsor can read, or null with the last reason. */
export async function findProperty(provider: ConnectProvider, domain: string, gaId?: string | null): Promise<{ found: string | null; why: string | null }> {
  let why: string | null = null;
  for (const id of candidates(provider, domain, gaId)) {
    const a = await windsor(CONNECTOR[provider], { fields: "account_name", date_preset: "last_7d", select_accounts: id });
    if (a.visible) return { found: id, why: null };
    why = a.why;
    if (why === "WINDSOR_API_KEY is not set") break;
  }
  return { found: null, why };
}

const day = (t: number) => new Date(t).toISOString().slice(0, 10);
const absent = (e: { code?: string; message?: string }) => e.code === "42P01" || e.code === "PGRST205" || /does not exist|schema cache/i.test(e.message ?? "");

/**
 * One connection's last 28 days into the dashboard's tables: Search Console
 * (query and page) and Bing (query) into search_console_queries, GA4 sessions
 * and conversions by day, source and medium into ga4_daily. Returns an error
 * line, or null and stamps last_synced_at.
 */
export async function pullConnection(db: SupabaseClient, c: { client_domain_id: string; provider: ConnectProvider; property: string }, now: number = Date.now()): Promise<string | null> {
  // Search Console settles about two days behind; the same window for all three keeps them comparable.
  const to = day(now - 2 * 86400000);
  const from = day(now - 29 * 86400000);
  const fields = c.provider === "gsc" ? "query,page,clicks,impressions,position" : c.provider === "bing" ? "query,clicks,impressions" : "date,source,medium,sessions,conversions";
  const a = await windsor(CONNECTOR[c.provider], { fields, date_from: from, date_to: to, select_accounts: c.property });
  if (!a.visible) return `${c.provider} ${c.property}: ${a.why}`;
  if (c.provider === "ga4") {
    const rows = a.rows
      .map((r) => r as Record<string, unknown>)
      .filter((r) => r.date)
      .map((r) => ({ client_domain_id: c.client_domain_id, day: String(r.date).slice(0, 10), source: String(r.source ?? "(none)").slice(0, 200), medium: String(r.medium ?? "(none)").slice(0, 200), sessions: Math.round(Number(r.sessions) || 0), conversions: Number(r.conversions) || 0 }));
    if (rows.length) {
      const { error } = await db.from("ga4_daily").upsert(rows, { onConflict: "client_domain_id,day,source,medium" });
      if (error) return absent(error) ? "ga4_daily is not created yet (pending migration), GA4 rows not stored" : `ga4_daily: ${error.message}`;
    }
  } else {
    const rows = queryRows({ clientId: c.client_domain_id, provider: c.provider, from, to, rows: a.rows });
    if (rows.length) {
      const { error } = await db.from("search_console_queries").upsert(rows, { onConflict: "client_domain_id,provider,period_end,query,page" });
      if (error) return `search_console_queries: ${error.message}`;
    }
  }
  const { error } = await db.from("integration_connections").update({ last_synced_at: new Date(now).toISOString(), error: null, updated_at: new Date(now).toISOString() }).eq("client_domain_id", c.client_domain_id).eq("provider", c.provider);
  return error ? `integration_connections: ${error.message}` : null;
}

/** The daily pull for every connected property, after the 05:00 dispatch. */
export async function pullConnectionsSafely(now: number = Date.now()): Promise<{ pulled: number; failed: string[] } | { error: string }> {
  try {
    if (!windsorReady()) return { pulled: 0, failed: ["WINDSOR_API_KEY is not set"] };
    const db = supabaseAdmin();
    const { data, error } = await db.from("integration_connections").select("client_domain_id, provider, property").eq("status", "connected").not("property", "is", null);
    if (error) return { error: error.message };
    const failed: string[] = [];
    let pulled = 0;
    for (const c of (data ?? []) as { client_domain_id: string; provider: ConnectProvider; property: string }[]) {
      const e = await pullConnection(db, c, now);
      if (e) {
        failed.push(e);
        await db.from("integration_connections").update({ error: e.slice(0, 500) }).eq("client_domain_id", c.client_domain_id).eq("provider", c.provider);
      } else pulled++;
    }
    if (failed.length) console.warn(`[connect] daily pull: ${failed.join("; ")}`);
    return { pulled, failed };
  } catch (err) {
    return { error: (err instanceof Error ? err.message : String(err)).slice(0, 300) };
  }
}

/** The run-health mail's 24 hour line (connect.ts staleLine), or "" when nobody is stuck. Never throws. */
export async function connectionsLineFor(db: SupabaseClient | (() => SupabaseClient), now: number = Date.now()): Promise<string> {
  try {
    const d = typeof db === "function" ? db() : db;
    const { data, error } = await d.from("integration_connections").select("provider, status, property, requested_at, client_domains(domain)").neq("status", "connected").not("requested_at", "is", null);
    if (error) return absent(error) ? "" : `Data connections: could not be read (${error.message.slice(0, 200)})`;
    const rows = ((data ?? []) as unknown as { provider: ConnectProvider; status: string; property: string | null; requested_at: string | null; client_domains: { domain: string } | { domain: string }[] | null }[]).map((r) => ({
      ...r,
      domain: (Array.isArray(r.client_domains) ? r.client_domains[0]?.domain : r.client_domains?.domain) ?? "?",
    }));
    return staleLine(rows, now) ?? "";
  } catch (err) {
    return `Data connections: could not be read (${(err instanceof Error ? err.message : String(err)).slice(0, 200)})`;
  }
}
