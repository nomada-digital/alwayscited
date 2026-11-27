import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

import { ACCESS_EMAIL } from "@/lib/dash/connect";
import { type Client, type Done, audit } from "@/lib/agency/edit";
import { TEMPLATES, buildCustom, buildFromTemplate } from "@/lib/tasks/templates";

/**
 * Your tasks, the agency side (27 Nov 2026, Danny). Staff add a task from the template library or write a custom one; it appears on
 * the customer's dashboard at /<slug>/tasks and, in the next daily batch, in one "We've added N tasks" email (lib/tasks/notify.ts).
 * Staff can also confirm a manual task ("Checked by us"), reopen or archive one, and set how the email goes out per customer:
 * 'draft' (default, the owner approves it in the hub) or 'auto'. Every change is an agency_edits line.
 */
const WAITING = "Your tasks switch on once 20261127000000_client_tasks.sql is applied.";
const missing = (e: { code?: string; message?: string } | null) => !!e && (e.code === "PGRST205" || e.code === "42P01" || /client_task/.test(e.message ?? ""));
const UUID = /^[0-9a-f-]{36}$/;
const dashboard = (slug: string) => `https://dashboards.alwayscited.com/${slug}`;

export async function tasksRead(db: SupabaseClient, client: Client): Promise<Done> {
  const [{ data: tData, error: tErr }, { data: eData, error: eErr }, { data: sData, error: sErr }] = await Promise.all([
    db.from("client_tasks").select("id, template, kind, title, why, steps, check_spec, status, done_at, done_by, checked_at, check_note, last_check_at, created_by, created_at, notified_at").eq("client_domain_id", client.id).is("archived_at", null).order("sort").order("created_at"),
    db.from("client_task_emails").select("id, status, subject, html, body_text, to_emails, from_name, task_ids, hub_draft_id, created_at, sent_at, error").eq("client_domain_id", client.id).order("created_at", { ascending: false }).limit(10),
    db.from("client_domains").select("task_email_mode, account_lead").eq("id", client.id).maybeSingle(),
  ]);
  if (missing(tErr)) return { ok: true, message: WAITING, data: { ready: false, rows: [], emails: [], templates: [] } };
  if (tErr) return { ok: false, message: `Could not read the tasks: ${tErr.message}` };
  if (eErr && !missing(eErr)) return { ok: false, message: `Could not read the task emails: ${eErr.message}` };
  if (sErr) return { ok: false, message: `Could not read the email settings: ${sErr.message}` };
  return {
    ok: true, message: `${(tData ?? []).length} task${(tData ?? []).length === 1 ? "" : "s"}.`,
    data: {
      ready: true, rows: tData ?? [], emails: eData ?? [], dashboard: `${dashboard(client.slug)}/tasks`,
      mode: (sData?.task_email_mode as string | undefined) === "auto" ? "auto" : "draft", lead: (sData?.account_lead as string | null | undefined) ?? "",
      templates: TEMPLATES.map((x) => ({ id: x.id, label: x.label, fields: x.fields })),
    },
  };
}

export async function tasksAdd(db: SupabaseClient, client: Client, by: string, p: { template: string; params: Record<string, string>; custom: { title?: unknown; why?: unknown; steps?: unknown } | null }): Promise<Done> {
  const ctx = { slug: client.slug, domain: client.domain, dashboard: dashboard(client.slug), accessEmail: ACCESS_EMAIL };
  const draft = p.template ? buildFromTemplate(p.template, p.params, ctx) : buildCustom(p.custom ?? {});
  if (typeof draft === "string") return { ok: false, message: draft };
  const { count, error: cErr } = await db.from("client_tasks").select("id", { count: "exact", head: true }).eq("client_domain_id", client.id).is("archived_at", null);
  if (missing(cErr)) return { ok: false, message: WAITING };
  if (cErr) return { ok: false, message: `Could not count the tasks: ${cErr.message}` };
  const { data, error } = await db.from("client_tasks").insert({
    client_domain_id: client.id, template: draft.template, kind: draft.kind, title: draft.title, why: draft.why, steps: draft.steps,
    check_spec: draft.check, sort: (count ?? 0) + 1, created_by: by,
  }).select("id").single();
  if (missing(error)) return { ok: false, message: WAITING };
  if (error || !data) return { ok: false, message: `Not saved: ${error?.message ?? "no row"}` };
  await audit(db, client.id, by, "task_add", data.id as string, null, { title: draft.title, kind: draft.kind, template: draft.template });
  return { ok: true, message: `Added "${draft.title}". The customer sees it now; it goes in the next daily "we've added tasks" email.`, data: { id: data.id, url: `${dashboard(client.slug)}/tasks` } };
}

export async function tasksUpdate(db: SupabaseClient, client: Client, by: string, p: { id: string; status: string; archive: boolean }): Promise<Done> {
  if (!UUID.test(p.id)) return { ok: false, message: "Which task?" };
  const now = new Date().toISOString();
  let patch: Record<string, unknown>;
  if (p.archive) patch = { archived_at: now };
  else if (p.status === "checked") patch = { status: "checked", checked_at: now, check_note: `Confirmed by ${by}.` };
  else if (p.status === "todo") patch = { status: "todo", done_at: null, done_by: null, checked_at: null, check_note: null };
  else return { ok: false, message: "Choose archive, Checked by us, or reopen." };
  const { data, error } = await db.from("client_tasks").update(patch).eq("id", p.id).eq("client_domain_id", client.id).select("title").maybeSingle();
  if (missing(error)) return { ok: false, message: WAITING };
  if (error) return { ok: false, message: `Not saved: ${error.message}` };
  if (!data) return { ok: false, message: "That task is not this customer's." };
  await audit(db, client.id, by, p.archive ? "task_archive" : "task_status", p.id, null, p.archive ? { archived: true } : { status: p.status });
  return { ok: true, message: p.archive ? `Removed "${data.title}".` : p.status === "checked" ? `Marked "${data.title}" as checked by us.` : `Reopened "${data.title}".` };
}

export async function tasksSettings(db: SupabaseClient, client: Client, by: string, p: { mode: string; lead: string }): Promise<Done> {
  if (p.mode !== "draft" && p.mode !== "auto") return { ok: false, message: "Choose draft for owner approval, or send automatically." };
  const lead = p.lead.trim().slice(0, 40);
  const { error } = await db.from("client_domains").update({ task_email_mode: p.mode, account_lead: lead || null }).eq("id", client.id);
  if (error) return { ok: false, message: /task_email_mode|account_lead/.test(error.message) ? WAITING : `Not saved: ${error.message}` };
  await audit(db, client.id, by, "task_email_settings", null, null, { mode: p.mode, lead: lead || null });
  return { ok: true, message: p.mode === "auto" ? "The task email will be sent automatically." : "The task email will wait as a draft for the owner to approve." };
}

/** The hub took a drafted email into Ready to send (hub_draft_id), or the owner dismissed it. */
export async function taskEmailMark(db: SupabaseClient, client: Client, by: string, p: { id: string; hubDraftId: string; dismiss: boolean }): Promise<Done> {
  if (!UUID.test(p.id)) return { ok: false, message: "Which email?" };
  const patch = p.dismiss ? { status: "dismissed" } : { hub_draft_id: p.hubDraftId.slice(0, 80) || null };
  const { data, error } = await db.from("client_task_emails").update(patch).eq("id", p.id).eq("client_domain_id", client.id).select("id").maybeSingle();
  if (missing(error)) return { ok: false, message: WAITING };
  if (error) return { ok: false, message: `Not saved: ${error.message}` };
  if (!data) return { ok: false, message: "That email is not this customer's." };
  await audit(db, client.id, by, "task_email_mark", p.id, null, patch);
  return { ok: true, message: p.dismiss ? "Dismissed." : "Recorded." };
}
