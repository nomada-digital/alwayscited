import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Resend } from "resend";

import { mailFrom } from "@/config/mail-from";
import { headerSafe } from "@/lib/email-header";
import { weekRecipientsNamed } from "@/lib/email/week-recipients";
import { taskEmail, type Missing } from "./email";
import { decideEmail } from "./cadence";
import { syncTasks, readTasks } from "./store";

/**
 * The daily pass for Your tasks (27 Nov 2026, Danny), run from the 05:00 cron after the tracking dispatch. Never fatal.
 *  1. Settle the tasks that check themselves (integrations, live page checks), for every client with an open task.
 *  2. Batch: each client with tasks no email has announced yet gets ONE email, at most one a day:
 *     "Draft for owner approval" (the default) stores it in client_task_emails for the hub's Ready to send;
 *     "Send automatically" sends it from hello@alwayscited.com, signed by the account lead.
 *     Either way the tasks are marked notified, so they are announced once.
 */
const WEEK_MS = 7 * 86_400_000;
const FORTNIGHT_MS = 14 * 86_400_000;

export async function taskDailyPass(db: SupabaseClient): Promise<{ checked: number; drafted: number; sent: number; failed: number }> {
  const out = { checked: 0, drafted: 0, sent: 0, failed: 0 };
  const { data: open, error } = await db.from("client_tasks").select("client_domain_id").is("archived_at", null).neq("status", "checked");
  if (error) { if (error.code !== "PGRST205" && error.code !== "42P01") console.warn(`[tasks] daily pass: ${error.message}`); return out; }
  const withOpen = new Set((open ?? []).map((r) => r.client_domain_id as string));
  // Every active customer except our own sites: the connection reminder reaches customers with no task too.
  const { data: clients, error: cErr } = await db.from("client_domains").select("id, slug, domain, account_id, status, archived_at, task_email_mode, account_lead").eq("status", "active").is("archived_at", null).not("slug", "in", "(alwayscited-com,nomadadigital-co-uk)");
  if (cErr) { console.warn(`[tasks] could not read the clients: ${cErr.message}`); return out; }
  for (const c of clients ?? []) {
    if (!withOpen.has(c.id as string)) continue;
    try {
      const rows = await readTasks(db, c.id as string);
      await syncTasks(db, { id: c.id as string, domain: c.domain as string }, rows, { force: true });
      out.checked += 1;
    } catch (e) { console.warn(`[tasks] check ${c.slug}: ${(e as Error).message}`); }
  }
  for (const c of clients ?? []) {
    if (c.archived_at || c.status === "ended") continue;
    try {
      const { data: fresh, error: fErr } = await db.from("client_tasks").select("id, kind").eq("client_domain_id", c.id).is("archived_at", null).eq("status", "todo").is("notified_at", null);
      if (fErr) { out.failed += 1; console.warn(`[tasks] could not read ${c.slug}'s new tasks: ${fErr.message}`); continue; }
      const plan = await emailPlan(db, c.id as string, (fresh ?? []).length);
      if (plan === "failed") { out.failed += 1; continue; }
      if (!plan) continue;
      const people = await weekRecipientsNamed(db, c.account_id as string, c.id as string);
      const owners = people.map((m) => m.email.toLowerCase());
      // No owner or editor on the dashboard (Laver and Propelo have only Kev as a viewer): a draft for the hub with no To, to be
      // given the client's contact there. Never sent automatically, since there is nobody to send it to.
      if (!owners.length && c.task_email_mode === "auto") { console.warn(`[tasks] ${c.slug}: nobody to email (auto mode), skipped`); continue; }
      const firstName = people.length === 1 ? people[0]!.firstName : null;
      // A connection that is one of the new tasks is already in the email as a task, so the reminder does not list it twice.
      const asTask = new Set((fresh ?? []).map((t) => String(t.kind).replace("connect_", "")));
      const missing = plan.missing.filter((m) => !asTask.has(m));
      const mail = taskEmail({ n: plan.n, slug: c.slug as string, firstName, lead: (c.account_lead as string | null) ?? null, missing });
      const ids2 = (fresh ?? []).map((t) => t.id as string);
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
      const { error: insErr } = await db.from("client_task_emails").insert({ client_domain_id: c.id, status, subject: mail.subject, html: mail.html, body_text: mail.text, to_emails: owners, from_name: mail.fromName, task_ids: ids2, error: err, sent_at: status === "sent" ? new Date().toISOString() : null, includes_reminder: missing.length > 0, reminder_for: missing });
      if (insErr) { out.failed += 1; console.warn(`[tasks] could not record the email for ${c.slug}: ${insErr.message}`); continue; }
      if (status === "failed") { out.failed += 1; continue; }
      if (ids2.length) await db.from("client_tasks").update({ notified_at: new Date().toISOString() }).in("id", ids2);
      if (status === "sent") out.sent += 1; else out.drafted += 1;
    } catch (e) { out.failed += 1; console.warn(`[tasks] email ${c.slug}: ${(e as Error).message}`); }
  }
  return out;
}

/**
 * What this client's next email holds, or null for nothing today ("failed" when a read failed, so it is never treated as quiet).
 * One rule for both kinds of email (27 Nov 2026, Danny): a client never gets two in the same week, so anything within the last 7
 * days holds the next one back; new tasks and the fortnightly connection reminder go in ONE email; the reminder lists only what is
 * not connected, comes at most every 14 days, and stops once all three are connected. Dismissed drafts count: a draft the owner
 * dismissed is not asked for again the next morning.
 */
async function emailPlan(db: SupabaseClient, clientId: string, freshTasks: number): Promise<{ n: number; missing: Missing[] } | null | "failed"> {
  const { data: prior, error: pErr } = await db.from("client_task_emails").select("created_at, includes_reminder").eq("client_domain_id", clientId).neq("status", "failed").order("created_at", { ascending: false }).limit(20);
  if (pErr) { console.warn(`[tasks] could not read the earlier emails: ${pErr.message}`); return "failed"; }
  const { data: conns, error: cErr } = await db.from("integration_connections").select("provider, status").eq("client_domain_id", clientId).in("provider", ["gsc", "ga4", "bing"]);
  if (cErr) { console.warn(`[tasks] could not read the connections: ${cErr.message}`); return "failed"; }
  const on = new Set((conns ?? []).filter((r) => r.status === "connected").map((r) => r.provider as string));
  const missing = (["gsc", "ga4", "bing"] as Missing[]).filter((m) => !on.has(m));
  const last = (prior ?? [])[0]?.created_at as string | undefined;
  const lastReminder = (prior ?? []).find((r) => r.includes_reminder === true)?.created_at as string | undefined;
  return decideEmail({ now: Date.now(), lastEmail: last ? Date.parse(last) : null, lastReminder: lastReminder ? Date.parse(lastReminder) : null, freshTasks, missing, weekMs: WEEK_MS, fortnightMs: FORTNIGHT_MS });
}

/** Wrapped for the cron route: a failure here is logged and never changes the cron's answer. */
export async function taskDailyPassSafely(db: SupabaseClient): Promise<string> {
  try { const r = await taskDailyPass(db); return `tasks: ${r.checked} checked, ${r.drafted} drafted, ${r.sent} sent, ${r.failed} failed`; }
  catch (e) { console.warn(`[tasks] daily pass failed: ${(e as Error).message}`); return "tasks: failed"; }
}
