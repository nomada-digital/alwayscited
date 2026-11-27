import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

import { verdict } from "./check";
import { type PageCheck, type Step, type TaskKind, ownPageUrl, readSteps } from "./templates";

/**
 * Your tasks, the customer side (27 Nov 2026). Reads, the auto-checks and the customer's own ticks.
 * A missing table reads as no tasks (the migration has not landed); any other read failure throws, never "none".
 */
export type TaskStatus = "todo" | "done" | "checked";
export type TaskRow = {
  id: string; kind: TaskKind; title: string; why: string; steps: Step[]; check: PageCheck | null;
  status: TaskStatus; doneAt: string | null; checkedAt: string | null; checkNote: string | null; lastCheckAt: string | null; createdAt: string;
};

const COLS = "id, kind, title, why, steps, check_spec, status, done_at, checked_at, check_note, last_check_at, created_at";
const missing = (e: { code?: string; message?: string } | null) => !!e && (e.code === "PGRST205" || e.code === "42P01" || /client_tasks/.test(e.message ?? ""));
const KINDS = new Set(["manual", "connect_gsc", "connect_ga4", "connect_bing", "page_check"]);

function shape(r: Record<string, unknown>): TaskRow {
  const c = r.check_spec as Record<string, unknown> | null;
  const check = c && typeof c.url === "string" && typeof c.after === "string" ? ({ url: c.url, target: c.target === "title" ? "title" : "h1", before: String(c.before ?? ""), after: c.after } as PageCheck) : null;
  return {
    id: r.id as string, kind: (KINDS.has(r.kind as string) ? r.kind : "manual") as TaskKind, title: r.title as string, why: (r.why as string) ?? "",
    steps: readSteps(r.steps), check, status: (r.status === "done" || r.status === "checked" ? r.status : "todo") as TaskStatus,
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
  const { data, error } = await db.from("client_tasks").select("status").eq("client_domain_id", clientId).is("archived_at", null);
  if (error || !data) return { total: 0, open: 0 };
  return { total: data.length, open: data.filter((r) => r.status === "todo").length };
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
