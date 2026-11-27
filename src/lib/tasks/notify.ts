import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Resend } from "resend";

import { mailFrom } from "@/config/mail-from";
import { headerSafe } from "@/lib/email-header";
import { weekRecipientsNamed } from "@/lib/email/week-recipients";
import { taskEmail } from "./email";
import { syncTasks, readTasks } from "./store";

/**
 * The daily pass for Your tasks (27 Nov 2026, Danny), run from the 05:00 cron after the tracking dispatch. Never fatal.
 *  1. Settle the tasks that check themselves (integrations, live page checks), for every client with an open task.
 *  2. Batch: each client with tasks no email has announced yet gets ONE email, at most one a day:
 *     "Draft for owner approval" (the default) stores it in client_task_emails for the hub's Ready to send;
 *     "Send automatically" sends it from hello@alwayscited.com, signed by the account lead.
 *     Either way the tasks are marked notified, so they are announced once.
 */
const DAY_MS = 20 * 3_600_000;

export async function taskDailyPass(db: SupabaseClient): Promise<{ checked: number; drafted: number; sent: number; failed: number }> {
  const out = { checked: 0, drafted: 0, sent: 0, failed: 0 };
  const { data: open, error } = await db.from("client_tasks").select("client_domain_id").is("archived_at", null).neq("status", "checked");
  if (error) { if (error.code !== "PGRST205" && error.code !== "42P01") console.warn(`[tasks] daily pass: ${error.message}`); return out; }
  const ids = [...new Set((open ?? []).map((r) => r.client_domain_id as string))];
  if (!ids.length) return out;
  const { data: clients, error: cErr } = await db.from("client_domains").select("id, slug, domain, account_id, status, archived_at, task_email_mode, account_lead").in("id", ids);
  if (cErr) { console.warn(`[tasks] could not read the clients: ${cErr.message}`); return out; }
  for (const c of clients ?? []) {
    if (c.archived_at || c.status === "ended") continue;
    try {
      const rows = await readTasks(db, c.id as string);
      await syncTasks(db, { id: c.id as string, domain: c.domain as string }, rows, { force: true });
      out.checked += 1;
    } catch (e) { console.warn(`[tasks] check ${c.slug}: ${(e as Error).message}`); }
  }
  for (const c of clients ?? []) {
    if (c.archived_at || c.status === "ended") continue;
    try {
      const { data: fresh, error: fErr } = await db.from("client_tasks").select("id").eq("client_domain_id", c.id).is("archived_at", null).eq("status", "todo").is("notified_at", null);
      if (fErr) { out.failed += 1; console.warn(`[tasks] could not read ${c.slug}'s new tasks: ${fErr.message}`); continue; }
      if (!fresh?.length) continue;
      const { data: recent, error: rErr } = await db.from("client_task_emails").select("id").eq("client_domain_id", c.id).gt("created_at", new Date(Date.now() - DAY_MS).toISOString()).limit(1);
      if (rErr) { out.failed += 1; console.warn(`[tasks] could not read ${c.slug}'s recent emails: ${rErr.message}`); continue; }
      if (recent?.length) continue;
      const people = await weekRecipientsNamed(db, c.account_id as string, c.id as string);
      const owners = people.map((m) => m.email.toLowerCase());
      if (!owners.length) continue;
      const firstName = people.length === 1 ? people[0]!.firstName : null;
      const mail = taskEmail({ n: fresh.length, slug: c.slug as string, firstName, lead: (c.account_lead as string | null) ?? null });
      const ids2 = fresh.map((t) => t.id as string);
      const auto = c.task_email_mode === "auto";
      let status: "draft" | "sent" | "failed" = "draft", err: string | null = null;
      if (auto) {
        const key = process.env.RESEND_API_KEY;
        if (!key) { status = "failed"; err = "RESEND_API_KEY is not set."; }
        else {
          const r = await new Resend(key).emails.send({
            from: mailFrom(),
            to: owners,
            subject: headerSafe(mail.subject),
            html: mail.html,
            text: mail.text,
          });
          if (r.error) { status = "failed"; err = r.error.message; } else status = "sent";
        }
      }
      const { error: insErr } = await db.from("client_task_emails").insert({ client_domain_id: c.id, status, subject: mail.subject, html: mail.html, body_text: mail.text, to_emails: owners, from_name: mail.fromName, task_ids: ids2, error: err, sent_at: status === "sent" ? new Date().toISOString() : null });
      if (insErr) { out.failed += 1; console.warn(`[tasks] could not record the email for ${c.slug}: ${insErr.message}`); continue; }
      if (status === "failed") { out.failed += 1; continue; }
      await db.from("client_tasks").update({ notified_at: new Date().toISOString() }).in("id", ids2);
      if (status === "sent") out.sent += 1; else out.drafted += 1;
    } catch (e) { out.failed += 1; console.warn(`[tasks] email ${c.slug}: ${(e as Error).message}`); }
  }
  return out;
}

/** Wrapped for the cron route: a failure here is logged and never changes the cron's answer. */
export async function taskDailyPassSafely(db: SupabaseClient): Promise<string> {
  try { const r = await taskDailyPass(db); return `tasks: ${r.checked} checked, ${r.drafted} drafted, ${r.sent} sent, ${r.failed} failed`; }
  catch (e) { console.warn(`[tasks] daily pass failed: ${(e as Error).message}`); return "tasks: failed"; }
}
