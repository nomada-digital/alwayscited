import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { queryRows } from "@/lib/dash/connect";
import { GA4_REQUESTS, type GoogleProvider, backfillStart, ga4Day, ga4Rows, gscDailyRows, gscQueryPageRows, lastFinalDay, monthWindows, type Ga4Report } from "@/lib/dash/google";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Search Console and GA4 through the hub (15 Nov 2026, google.ts). Every Google call goes to the hub's edge function
 * google-data, which alone holds the service account's key (GOOGLE_SA_KEY); alwayscited proves itself with its own
 * service key, which the hub already holds as AC_SERVICE_KEY, as suggest.ts does. No Google key or token is held
 * here, reaches a browser, or is logged.
 */
export const HUB_GOOGLE = "https://qpsrvmnmtozvailsyqqz.supabase.co/functions/v1/google-data";

type HubAnswer = { ok?: boolean; error?: string } & Record<string, unknown>;

export async function hubGoogle(action: string, body: Record<string, unknown> = {}, fetchImpl: typeof fetch = fetch): Promise<HubAnswer> {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return { error: "not connected to the hub" };
  const res = await fetchImpl(HUB_GOOGLE, {
    method: "POST",
    headers: { "content-type": "application/json", "x-ac-key": key },
    body: JSON.stringify({ ...body, action }),
    cache: "no-store",
    signal: AbortSignal.timeout(55_000),
  }).catch((err: unknown) => (err instanceof Error ? err.message : String(err)));
  if (typeof res === "string") return { error: `hub unreachable: ${res.slice(0, 200)}` };
  const out = (await res.json().catch(() => ({}))) as HubAnswer;
  return res.ok ? out : { error: out.error ?? `hub answered ${res.status}` };
}

export type Listed = { id: string; name: string; permission: string | null };

/** The properties the service account can see for `domain`: the edge function narrows them, never a customer. */
export async function listFor(provider: GoogleProvider, domain: string): Promise<{ listed: Listed[]; error: string | null }> {
  const a = await hubGoogle(provider === "gsc" ? "gsc_sites" : "ga4_properties", { domain });
  if (a.error) return { listed: [], error: a.error };
  if (provider === "gsc") return { listed: ((a.sites ?? []) as { site: string; permission: string }[]).map((s) => ({ id: s.site, name: s.site, permission: s.permission })), error: null };
  return { listed: ((a.properties ?? []) as { property: string; name: string; account: string }[]).map((p) => ({ id: p.property, name: p.account ? `${p.name} (${p.account})` : p.name, permission: null })), error: null };
}

const absent = (e: { code?: string; message?: string }) => e.code === "42P01" || e.code === "PGRST205" || /does not exist|schema cache/i.test(e.message ?? "");
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Rows in chunks of 1,000, the most one upsert sends. */
const chunks = <T,>(rows: T[]): T[][] => Array.from({ length: Math.ceil(rows.length / 1000) }, (_, i) => rows.slice(i * 1000, i * 1000 + 1000));
const why = (table: string, e: { code?: string; message: string }) => (absent(e) ? `${table} is not created yet (migration 20261116000000)` : `${table}: ${e.message}`);

/** One property's pull: 16 months on the first (no backfilled_at yet), then the last two months each morning. */
export async function pullGoogle(db: SupabaseClient, c: { client_domain_id: string; provider: GoogleProvider; property: string; backfilled_at: string | null }, now: number = Date.now()): Promise<string | null> {
  const end = lastFinalDay(now);
  const months = monthWindows(end, c.backfilled_at ? 2 : 16);
  const start = c.backfilled_at ? months[0].start : backfillStart(end);
  const id = c.client_domain_id;
  const errors: string[] = [];
  if (c.provider === "gsc") {
    const daily = await hubGoogle("gsc_query", { site: c.property, start, end, dimensions: ["date"], rowLimit: 25000 });
    if (daily.error) return `gsc ${c.property}: ${daily.error}`;
    for (const r of chunks(gscDailyRows(id, (daily.rows ?? []) as unknown[]))) {
      const { error } = await db.from("gsc_daily").upsert(r, { onConflict: "client_domain_id,day" });
      if (error) { errors.push(why("gsc_daily", error)); break; }
    }
    // Query x page per calendar month, and the last 28 days, which the keyword groups read (model.ts consoleFor).
    const windows = [...months, { start: iso(new Date(Date.parse(end) - 27 * 86400000)), end }];
    // Four windows at a time: a 16-month first pull has to fit the route's 60 seconds.
    for (let i = 0; i < windows.length; i += 4) {
      await Promise.all(windows.slice(i, i + 4).map(async (w) => {
        const q = await hubGoogle("gsc_query", { site: c.property, start: w.start, end: w.end, dimensions: ["query", "page"], rowLimit: 5000 });
        if (q.error) { errors.push(`gsc ${w.start}: ${q.error}`); return; }
        const rows = queryRows({ clientId: id, provider: "gsc", from: w.start, to: w.end, rows: gscQueryPageRows((q.rows ?? []) as unknown[]) });
        for (const r of chunks(rows)) {
          const { error } = await db.from("search_console_queries").upsert(r, { onConflict: "client_domain_id,provider,period_end,query,page" });
          if (error) { errors.push(why("search_console_queries", error)); break; }
        }
      }));
    }
  } else {
    const ch = await hubGoogle("ga4_report", { property: c.property, request: GA4_REQUESTS.channels(start, end) });
    if (ch.error) return `ga4 ${c.property}: ${ch.error}`;
    const chRows = ga4Rows(ch.report as Ga4Report).flatMap((r) => {
      const day = ga4Day(String(r.date));
      return day ? [{ client_domain_id: id, day, channel: String(r.sessionDefaultChannelGroup || "(other)").slice(0, 100), sessions: Math.round(Number(r.sessions)), key_events: Number(r.keyEvents) || 0 }] : [];
    });
    for (const r of chunks(chRows)) {
      const { error } = await db.from("ga4_channel_days").upsert(r, { onConflict: "client_domain_id,day,channel" });
      if (error) { errors.push(why("ga4_channel_days", error)); break; }
    }
    for (let i = 0; i < months.length; i += 4) await Promise.all(months.slice(i, i + 4).map(async (w) => {
      const [pg, ev] = await Promise.all([hubGoogle("ga4_report", { property: c.property, request: GA4_REQUESTS.pages(w.start, w.end) }), hubGoogle("ga4_report", { property: c.property, request: GA4_REQUESTS.events(w.start, w.end) })]);
      if (pg.error ?? ev.error) { errors.push(`ga4 ${w.start}: ${pg.error ?? ev.error}`); return; }
      const pages = ga4Rows(pg.report as Ga4Report).map((r) => ({ client_domain_id: id, period_start: w.start, period_end: w.end, page: String(r.landingPagePlusQueryString || "(not set)").slice(0, 500), sessions: Math.round(Number(r.sessions)), key_events: Number(r.keyEvents) || 0 }));
      const events = ga4Rows(ev.report as Ga4Report).filter((r) => Number(r.keyEvents) > 0).map((r) => ({ client_domain_id: id, period_start: w.start, period_end: w.end, event_name: String(r.eventName).slice(0, 100), count: Number(r.keyEvents) || 0 }));
      if (pages.length) {
        const { error } = await db.from("ga4_pages").upsert(pages, { onConflict: "client_domain_id,period_end,page" });
        if (error) errors.push(why("ga4_pages", error));
      }
      if (events.length) {
        const { error } = await db.from("ga4_events").upsert(events, { onConflict: "client_domain_id,period_end,event_name" });
        if (error) errors.push(why("ga4_events", error));
      }
    }));
  }
  const at = new Date(now).toISOString();
  const { error } = await db
    .from("integration_connections")
    .update({ last_synced_at: at, updated_at: at, error: errors.length ? errors.join("; ").slice(0, 500) : null, ...(c.backfilled_at || errors.length ? {} : { backfilled_at: at }) })
    .eq("client_domain_id", id)
    .eq("provider", c.provider);
  if (error) errors.push(`integration_connections: ${error.message}`);
  return errors.length ? errors.join("; ") : null;
}

/** The morning pull for every property connected direct. Never throws: the cron reports what failed. */
export async function pullGoogleSafely(now: number = Date.now()): Promise<{ pulled: number; failed: string[] } | { error: string }> {
  try {
    const db = supabaseAdmin();
    const { data, error } = await db.from("integration_connections").select("client_domain_id, provider, property, backfilled_at").eq("status", "connected").eq("via", "google").not("property", "is", null);
    if (error) return absent(error) || /via|backfilled_at/.test(error.message) ? { pulled: 0, failed: [] } : { error: error.message };
    const failed: string[] = [];
    let pulled = 0;
    for (const c of (data ?? []) as { client_domain_id: string; provider: GoogleProvider; property: string; backfilled_at: string | null }[]) {
      const e = await pullGoogle(db, c, now).catch((err: unknown) => (err instanceof Error ? err.message : String(err)));
      if (e) failed.push(e.slice(0, 300));
      else pulled++;
    }
    if (failed.length) console.warn(`[google] daily pull: ${failed.join("; ")}`);
    return { pulled, failed };
  } catch (err) {
    return { error: (err instanceof Error ? err.message : String(err)).slice(0, 300) };
  }
}

export type GoogleSummary = {
  gsc: { days: { day: string; clicks: number; impressions: number }[]; clicks: number; impressions: number; position: number | null; prevClicks: number; prevImpressions: number; queries: { query: string; clicks: number; impressions: number; position: number | null }[]; window: { start: string; end: string } | null } | null;
  ga4: { sessions: number; prevSessions: number; channels: { channel: string; sessions: number }[]; pages: { page: string; sessions: number; keyEvents: number }[]; events: { name: string; count: number }[]; month: string | null } | null;
  inspections: { url: string; verdict: string | null; coverage: string | null; last_crawl: string | null; inspected_at: string }[];
};

/** What the dashboard shows from a direct connection: the last 28 days against the 28 before. Absent tables read as nothing. */
export async function googleSummary(db: SupabaseClient, clientId: string, today: string): Promise<GoogleSummary> {
  const since = iso(new Date(Date.parse(today) - 60 * 86400000));
  const [{ data: days, error: daysErr }, { data: chans, error: chansErr }, { data: q, error: qErr }, { data: pages, error: pagesErr }, { data: events, error: eventsErr }, { data: insp, error: inspErr }] = await Promise.all([
    db.from("gsc_daily").select("day, clicks, impressions, position").eq("client_domain_id", clientId).gte("day", since).order("day"),
    db.from("ga4_channel_days").select("day, channel, sessions").eq("client_domain_id", clientId).gte("day", since).limit(5000),
    db.from("search_console_queries").select("query, clicks, impressions, position, period_start, period_end").eq("client_domain_id", clientId).eq("provider", "gsc").gte("period_end", since).order("period_end", { ascending: false }).limit(5000),
    db.from("ga4_pages").select("page, sessions, key_events, period_end").eq("client_domain_id", clientId).order("period_end", { ascending: false }).limit(200),
    db.from("ga4_events").select("event_name, count, period_end").eq("client_domain_id", clientId).order("period_end", { ascending: false }).limit(100),
    db.from("gsc_inspections").select("url, verdict, coverage, last_crawl, inspected_at").eq("client_domain_id", clientId).limit(50),
  ]);
  // Before 20261116000000 the tables do not exist: nothing to show, said once in the log only if it is anything else.
  for (const e of [daysErr, chansErr, qErr, pagesErr, eventsErr, inspErr]) if (e && !absent(e)) console.warn(`[google] summary read failed: ${e.message}`);
  const d = (days ?? []) as { day: string; clicks: number; impressions: number; position: number | null }[];
  let gsc: GoogleSummary["gsc"] = null;
  if (d.length) {
    const last = d.at(-1)!.day;
    const cut = iso(new Date(Date.parse(last) - 27 * 86400000));
    const prevCut = iso(new Date(Date.parse(cut) - 28 * 86400000));
    const cur = d.filter((x) => x.day >= cut);
    const prev = d.filter((x) => x.day >= prevCut && x.day < cut);
    const sum = (a: typeof d, k: "clicks" | "impressions") => a.reduce((n, x) => n + Number(x[k]), 0);
    const imp = sum(cur, "impressions");
    const pw = cur.reduce((n, x) => n + (x.position == null ? 0 : Number(x.position) * Number(x.impressions)), 0);
    // The 28-day window google-io writes ends on the last final day; calendar months do not span exactly 28 days.
    const rows = (q ?? []) as { query: string; clicks: number; impressions: number; position: number | null; period_start: string; period_end: string }[];
    const win = rows.find((r) => Date.parse(r.period_end) - Date.parse(r.period_start) === 27 * 86400000);
    const byQ = new Map<string, { query: string; clicks: number; impressions: number; pw: number }>();
    for (const r of rows.filter((x) => win && x.period_start === win.period_start && x.period_end === win.period_end)) {
      const v = byQ.get(r.query) ?? { query: r.query, clicks: 0, impressions: 0, pw: 0 };
      v.clicks += r.clicks; v.impressions += r.impressions; v.pw += (Number(r.position) || 0) * r.impressions;
      byQ.set(r.query, v);
    }
    const queries = [...byQ.values()].sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions).slice(0, 10).map((v) => ({ query: v.query, clicks: v.clicks, impressions: v.impressions, position: v.impressions ? Math.round((v.pw / v.impressions) * 10) / 10 : null }));
    gsc = { days: cur.map((x) => ({ day: x.day, clicks: x.clicks, impressions: x.impressions })), clicks: sum(cur, "clicks"), impressions: imp, position: imp ? Math.round((pw / imp) * 10) / 10 : null, prevClicks: sum(prev, "clicks"), prevImpressions: sum(prev, "impressions"), queries, window: win ? { start: win.period_start, end: win.period_end } : null };
  }
  const c = (chans ?? []) as { day: string; channel: string; sessions: number }[];
  let ga4: GoogleSummary["ga4"] = null;
  if (c.length) {
    const last = c.reduce((m, x) => (x.day > m ? x.day : m), "");
    const cut = iso(new Date(Date.parse(last) - 27 * 86400000));
    const prevCut = iso(new Date(Date.parse(cut) - 28 * 86400000));
    const by = new Map<string, number>();
    for (const x of c.filter((x) => x.day >= cut)) by.set(x.channel, (by.get(x.channel) ?? 0) + x.sessions);
    const p = (pages ?? []) as { page: string; sessions: number; key_events: number; period_end: string }[];
    const e = (events ?? []) as { event_name: string; count: number; period_end: string }[];
    const month = p[0]?.period_end ?? e[0]?.period_end ?? null;
    ga4 = {
      sessions: [...by.values()].reduce((n, x) => n + x, 0),
      prevSessions: c.filter((x) => x.day >= prevCut && x.day < cut).reduce((n, x) => n + x.sessions, 0),
      channels: [...by].map(([channel, sessions]) => ({ channel, sessions })).sort((a, b) => b.sessions - a.sessions),
      pages: p.filter((x) => x.period_end === month).slice(0, 10).map((x) => ({ page: x.page, sessions: x.sessions, keyEvents: Number(x.key_events) })),
      events: e.filter((x) => x.period_end === month).map((x) => ({ name: x.event_name, count: Number(x.count) })).sort((a, b) => b.count - a.count),
      month,
    };
  }
  return { gsc, ga4, inspections: (insp ?? []) as GoogleSummary["inspections"] };
}
