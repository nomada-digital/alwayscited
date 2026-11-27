import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

import { verdict } from "./check";
import { detectPlatform, isPlatform, type Platform } from "./platform";
import { type PageCheck, type Step, type TaskKind, ownPageUrl, readSteps } from "./templates";

/**
 * Your tasks, the customer side (27 Nov 2026). Reads, the auto-checks and the customer's own ticks.
 * A missing table reads as no tasks (the migration has not landed); any other read failure throws, never "none".
 */
export type TaskStatus = "todo" | "done" | "checked";
export type TaskRow = {
  id: string; kind: TaskKind; title: string; why: string; steps: Step[]; check: PageCheck | null;
  onsite: boolean; aiPrompt: string | null;
  status: TaskStatus; doneAt: string | null; checkedAt: string | null; checkNote: string | null; lastCheckAt: string | null; createdAt: string;
};

const COLS = "id, kind, title, why, steps, check_spec, onsite, ai_prompt, status, done_at, checked_at, check_note, last_check_at, created_at";
const missing = (e: { code?: string; message?: string } | null) => !!e && (e.code === "PGRST205" || e.code === "42P01" || /client_tasks/.test(e.message ?? ""));
const KINDS = new Set(["manual", "connect_gsc", "connect_ga4", "connect_bing", "page_check", "access"]);

function shape(r: Record<string, unknown>): TaskRow {
  const c = r.check_spec as Record<string, unknown> | null;
  const check = c && typeof c.url === "string" && typeof c.after === "string" ? ({ url: c.url, target: c.target === "title" ? "title" : "h1", before: String(c.before ?? ""), after: c.after } as PageCheck) : null;
  return {
    id: r.id as string, kind: (KINDS.has(r.kind as string) ? r.kind : "manual") as TaskKind, title: r.title as string, why: (r.why as string) ?? "",
    steps: readSteps(r.steps), check, onsite: r.onsite === true, aiPrompt: typeof r.ai_prompt === "string" && r.ai_prompt ? r.ai_prompt : null, status: (r.status === "done" || r.status === "checked" ? r.status : "todo") as TaskStatus,
    doneAt: (r.done_at as string | null) ?? null, checkedAt: (r.checked_at as string | null) ?? null, checkNote: (r.check_note as string | null) ?? null,
    lastCheckAt: (r.last_check_at as string | null) ?? null, createdAt: r.created_at as string,
  };
}

export async function readTasks(db: SupabaseClient, clientId: string): Promise<TaskRow[]> {
  const { data, error } = await db.from("client_tasks").select(COLS).eq("client_domain_id", clientId).is("archived_at", null).order("sort").order("created_at");
  if (missing(error)) return [];
  if (error) throw new Error(`could not read the tasks: ${error.message}`);
  return (data ?? []).map((r) => shape(r as Record<string, unknown>));
}

/** For the sidebar: how many tasks there are and how many still need the customer. A failed read is none. */
export async function taskCounts(db: SupabaseClient, clientId: string): Promise<{ total: number; open: number }> {
  const { data, error } = await db.from("client_tasks").select("status, onsite").eq("client_domain_id", clientId).is("archived_at", null);
  if (error || !data) return { total: 0, open: 0 };
  // An on-site task is ours once we have access, so it no longer needs the customer.
  const ours = (await readAccess(db, clientId)).site === "granted";
  return { total: data.length, open: data.filter((r) => r.status === "todo" && !(ours && r.onsite === true)).length };
}

export type AccessState = "none" | "requested" | "granted";
export type Access = { platform: Platform | null; site: AccessState; gsc: AccessState; ga4: AccessState };

/** The platform we think the site is on and the access we have been given. A failed read is "none", never "granted". */
export async function readAccess(db: SupabaseClient, clientId: string): Promise<Access> {
  const [{ data: a, error: aErr }, { data: c, error: cErr }] = await Promise.all([
    db.from("client_access").select("kind, status").eq("client_domain_id", clientId),
    db.from("client_domains").select("site_platform").eq("id", clientId).maybeSingle(),
  ]);
  if (aErr && aErr.code !== "PGRST205" && aErr.code !== "42P01") console.warn(`[tasks] could not read access: ${aErr.message}`);
  if (cErr) console.warn(`[tasks] could not read the platform: ${cErr.message}`);
  const st = (k: string): AccessState => { const r = (a ?? []).find((x) => x.kind === k); return r?.status === "granted" ? "granted" : r?.status === "requested" ? "requested" : "none"; };
  return { platform: isPlatform(c?.site_platform) ? c!.site_platform as Platform : null, site: st("site"), gsc: st("gsc"), ga4: st("ga4") };
}

/** Look at the live homepage once and remember the platform it points at. Own site only; a failed fetch leaves it unset. */
export async function detectSitePlatform(db: SupabaseClient, client: { id: string; domain: string }): Promise<Platform | null> {
  const url = ownPageUrl(`https://www.${client.domain.replace(/^www\./, "")}/`, client.domain) ?? ownPageUrl(`https://${client.domain}/`, client.domain);
  if (!url) return null;
  try {
    const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(8000), headers: { "user-agent": "alwayscited-task-check/1.0 (+https://alwayscited.com)", accept: "text/html" }, cache: "no-store" });
    if (!ownPageUrl(res.url, client.domain)) return null;
    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => { headers[k] = v; });
    const p = detectPlatform((await res.text()).slice(0, 400_000), headers);
    const { error } = await db.from("client_domains").update({ site_platform: p, site_platform_at: new Date().toISOString() }).eq("id", client.id);
    if (error) console.warn(`[tasks] could not save the platform: ${error.message}`);
    return p;
  } catch {
    return null;
  }
}

const CHECK_GAP_MS = 30_000;

/** Fetch the live page and compare. Own https pages only (ownPageUrl); redirects are followed but must stay on the site. */
export async function checkPage(spec: PageCheck, domain: string): Promise<{ ok: boolean; note: string }> {
  const url = ownPageUrl(spec.url, domain);
  if (!url) return { ok: false, note: "The page address is not on your site." };
  try {
    const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(8000), headers: { "user-agent": "alwayscited-task-check/1.0 (+https://alwayscited.com)", accept: "text/html" }, cache: "no-store" });
    if (!ownPageUrl(res.url, domain)) return { ok: false, note: "The page redirects away from your site." };
    if (!res.ok) return { ok: false, note: `The page answered ${res.status}.` };
    const html = (await res.text()).slice(0, 1_500_000);
    const v = verdict(html, spec.target, spec.after);
    return { ok: v.ok, note: v.note };
  } catch {
    return { ok: false, note: "We couldn't read the page just now." };
  }
}

type Client = { id: string; domain: string };

/**
 * Settle the tasks that check themselves: an integration that is connected completes its connect task; a page check that matches
 * completes a heading task. Returns the tasks as they now stand. `force` skips the 30 second gap between page checks (the daily run).
 */
export async function syncTasks(db: SupabaseClient, client: Client, rows: TaskRow[], opts: { force?: boolean; only?: string } = {}): Promise<TaskRow[]> {
  const open = rows.filter((t) => t.status !== "checked" && (!opts.only || t.id === opts.only));
  if (!open.length) return rows;
  const now = new Date();
  const stamp = now.toISOString();
  const changed = new Map<string, Partial<TaskRow>>();

  if (open.some((t) => t.kind === "connect_gsc" || t.kind === "connect_ga4" || t.kind === "connect_bing")) {
    const { data, error } = await db.from("integration_connections").select("provider, status").eq("client_domain_id", client.id).in("provider", ["gsc", "ga4", "bing"]);
    if (error) console.warn(`[tasks] could not read connections: ${error.message}`);
    const on = new Set((data ?? []).filter((c) => c.status === "connected").map((c) => c.provider as string));
    for (const t of open) {
      const p = t.kind === "connect_gsc" ? "gsc" : t.kind === "connect_ga4" ? "ga4" : t.kind === "connect_bing" ? "bing" : null;
      if (p && on.has(p)) changed.set(t.id, { status: "checked", checkedAt: stamp, checkNote: p === "gsc" ? "Search Console is connected." : p === "ga4" ? "Google Analytics is connected." : "Bing Webmaster Tools is connected." });
    }
  }
  if (open.some((t) => t.kind === "access")) {
    if ((await readAccess(db, client.id)).site === "granted") for (const t of open) if (t.kind === "access") changed.set(t.id, { status: "checked", checkedAt: stamp, checkNote: "Access confirmed." });
  }
  for (const t of open) {
    if (t.kind !== "page_check" || !t.check || changed.has(t.id)) continue;
    if (!opts.force && t.lastCheckAt && now.getTime() - Date.parse(t.lastCheckAt) < CHECK_GAP_MS) continue;
    const r = await checkPage(t.check, client.domain);
    changed.set(t.id, r.ok ? { status: "checked", checkedAt: stamp, checkNote: r.note, lastCheckAt: stamp } : { checkNote: r.note, lastCheckAt: stamp });
  }
  for (const [id, c] of changed) {
    const patch: Record<string, unknown> = {};
    if (c.status) patch.status = c.status;
    if (c.checkedAt) patch.checked_at = c.checkedAt;
    if (c.checkNote !== undefined) patch.check_note = c.checkNote;
    if (c.lastCheckAt) patch.last_check_at = c.lastCheckAt;
    const { error } = await db.from("client_tasks").update(patch).eq("id", id).eq("client_domain_id", client.id).neq("status", "checked");
    if (error) console.warn(`[tasks] could not save a check: ${error.message}`);
  }
  return rows.map((t) => (changed.has(t.id) ? { ...t, ...changed.get(t.id)! } : t));
}

/** The customer's own action on a task: tick it done, undo that, or ask for a check now. A string is the refusal. */
export async function customerAction(db: SupabaseClient, client: Client, email: string, id: string, op: "done" | "undo" | "check"): Promise<TaskRow[] | string> {
  const rows = await readTasks(db, client.id);
  const t = rows.find((r) => r.id === id);
  if (!t) return "That task is not on your dashboard.";
  if (op === "done" && t.status === "todo") {
    const { error } = await db.from("client_tasks").update({ status: "done", done_at: new Date().toISOString(), done_by: email }).eq("id", id).eq("client_domain_id", client.id).eq("status", "todo");
    if (error) return "We couldn't save that. Try again in a minute.";
  } else if (op === "undo" && t.status === "done") {
    const { error } = await db.from("client_tasks").update({ status: "todo", done_at: null, done_by: null }).eq("id", id).eq("client_domain_id", client.id).eq("status", "done");
    if (error) return "We couldn't save that. Try again in a minute.";
  } else if (op !== "check") {
    return t.status === "checked" ? "We've already checked that one." : "Nothing to change.";
  }
  const fresh = await readTasks(db, client.id);
  return syncTasks(db, client, fresh, { only: id });
}


/** "I've given you access" (27 Nov 2026): record the request for staff to confirm, and tick the access task. A string is the refusal. */
export async function customerAccess(db: SupabaseClient, client: Client, email: string, platform: string): Promise<TaskRow[] | string> {
  if (!isPlatform(platform)) return "Pick your platform first.";
  const now = new Date().toISOString();
  const { error } = await db.from("client_access").upsert({ client_domain_id: client.id, kind: "site", platform, status: "requested", requested_at: now, recorded_by: email }, { onConflict: "client_domain_id,kind", ignoreDuplicates: false });
  if (error) return "We couldn't save that. Try again in a minute.";
  await db.from("client_domains").update({ site_platform: platform, site_platform_at: now }).eq("id", client.id);
  const { error: tErr } = await db.from("client_tasks").update({ status: "done", done_at: now, done_by: email }).eq("client_domain_id", client.id).eq("kind", "access").eq("status", "todo").is("archived_at", null);
  if (tErr) console.warn(`[tasks] could not tick the access task: ${tErr.message}`);
  return readTasks(db, client.id);
}

/** The customer corrects the platform we guessed. */
export async function customerPlatform(db: SupabaseClient, client: Client, platform: string): Promise<string | null> {
  if (!isPlatform(platform)) return "Pick a platform from the list.";
  const { error } = await db.from("client_domains").update({ site_platform: platform, site_platform_at: new Date().toISOString() }).eq("id", client.id);
  return error ? "We couldn't save that. Try again in a minute." : null;
}
