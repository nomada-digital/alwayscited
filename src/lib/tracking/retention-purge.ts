import type { SupabaseClient } from "@supabase/supabase-js";

import { RETENTION_DAYS, keptUntil, purgeDue } from "./retention.ts";

/**
 * The nightly retention pass (Danny, 18 Oct 2026: "customer data should be kept for 90 days" after a plan ends).
 * Run from /api/cron/purge-responses at 03:30 UTC, in its own try.
 *
 * Finds every ended client whose kept period (retention.ts) is over. **It deletes nothing unless
 * app_settings.retention_purge_enabled holds jsonb true** - a missing, false or unreadable switch is a dry run that
 * only reports who is due. Switching it on is Danny's, not a deploy's: a purge cannot be undone.
 *
 * When on, for each due client (at most PURGE_CAP a night), in order, stopping that client at the first error:
 *  1. a retention_purges row, so what was purged and when outlives the data;
 *  2. its dashboard_member_clients scope rows (the one foreign key with no on-delete rule);
 *  3. its diy_reads (on-delete set null, so they would otherwise outlive the client);
 *  4. the client_domains row, still ended - which cascades to every tracking, DIY, dashboard and plan row under it;
 *  5. if the account now has no client left: its members' sessions and login tokens, then the account (which
 *     cascades its dashboard_members).
 * Kept, as the policy says: leads, scans (their links go null), and the orders and stripe_events rows needed for
 * accounting (on-delete set null).
 */
export const PURGE_CAP = 25;
const ENABLED_KEY = "retention_purge_enabled";
const DAYS_KEY = "retention_days";

export type RetentionReport = {
  enabled: boolean;
  days: number;
  due: { slug: string; domain: string; ended_at: string; kept_until: string | null }[];
  purged: string[];
  errors: string[];
};

type Due = { id: string; slug: string; domain: string; account_id: string; status: string; ended_at: string };

export async function retentionPass(db: SupabaseClient, now: number = Date.now()): Promise<RetentionReport> {
  const errors: string[] = [];
  const { data: rows, error: sErr } = await db.from("app_settings").select("key, value").in("key", [ENABLED_KEY, DAYS_KEY]);
  if (sErr) errors.push(`settings not read, so this is a dry run: ${sErr.message}`);
  const setting = (k: string) => (rows ?? []).find((r) => r.key === k)?.value;
  const enabled = !sErr && setting(ENABLED_KEY) === true;
  const rawDays = Number(setting(DAYS_KEY));
  // Never shorter than the policy: a mistyped row cannot purge early.
  const days = Number.isInteger(rawDays) && rawDays >= RETENTION_DAYS ? rawDays : RETENTION_DAYS;

  const cutoff = new Date(now - days * 86_400_000).toISOString();
  const { data, error } = await db
    .from("client_domains")
    .select("id, slug, domain, account_id, status, ended_at")
    .eq("status", "ended")
    .not("ended_at", "is", null)
    .lt("ended_at", cutoff)
    .order("ended_at", { ascending: true })
    .limit(PURGE_CAP);
  if (error) {
    errors.push(`ended clients not read: ${error.message}`);
    return { enabled, days, due: [], purged: [], errors };
  }
  const due = ((data ?? []) as Due[]).filter((c) => purgeDue(c, now, days));
  const report: RetentionReport = { enabled, days, due: due.map((c) => ({ slug: c.slug, domain: c.domain, ended_at: c.ended_at, kept_until: keptUntil(c.ended_at, days) })), purged: [], errors };
  if (!enabled) return report;

  for (const c of due) {
    const why = await purgeClient(db, c);
    if (why) errors.push(`${c.slug}: ${why}`);
    else report.purged.push(c.slug);
  }
  return report;
}

/** One client, in the order above. Returns why it stopped, or null when it is gone. */
async function purgeClient(db: SupabaseClient, c: Due): Promise<string | null> {
  const { count: others, error: oErr } = await db.from("client_domains").select("id", { count: "exact", head: true }).eq("account_id", c.account_id).neq("id", c.id);
  if (oErr) return `could not count the account's other clients: ${oErr.message}`;
  const lastOne = (others ?? 0) === 0;

  const { error: logErr } = await db.from("retention_purges").insert({ client_domain_id: c.id, slug: c.slug, domain: c.domain, ended_at: c.ended_at, account_removed: lastOne });
  if (logErr) return `not purged - the purge log could not be written: ${logErr.message}`;

  const { error: scopeErr } = await db.from("dashboard_member_clients").delete().eq("client_domain_id", c.id);
  if (scopeErr) return `member scope not removed: ${scopeErr.message}`;
  const { error: readsErr } = await db.from("diy_reads").delete().eq("client_domain_id", c.id);
  if (readsErr) return `DIY reads not removed: ${readsErr.message}`;
  const { data: gone, error: clientErr } = await db.from("client_domains").delete().eq("id", c.id).eq("status", "ended").select("id");
  if (clientErr) return `client not removed: ${clientErr.message}`;
  if (!gone?.length) return "client was no longer ended, so nothing was removed";
  if (!lastOne) return null;

  const { data: members, error: mErr } = await db.from("dashboard_members").select("email").eq("account_id", c.account_id).is("removed_at", null);
  if (mErr) return `client removed; the account's members not read, so the account stays: ${mErr.message}`;
  const mine = (members ?? []).map((m) => String(m.email).toLowerCase());
  // Someone who is also a member of another account keeps their sign-in: it opens that account too.
  const { data: elsewhere, error: eErr } = mine.length
    ? await db.from("dashboard_members").select("email").in("email", mine).neq("account_id", c.account_id).is("removed_at", null)
    : { data: [], error: null };
  if (eErr) return `client removed; other memberships not read, so the account stays: ${eErr.message}`;
  const shared = new Set((elsewhere ?? []).map((m) => String(m.email).toLowerCase()));
  const emails = mine.filter((e) => !shared.has(e));
  if (emails.length) {
    const { error: sessErr } = await db.from("dashboard_sessions").delete().in("email", emails);
    if (sessErr) return `client removed; sessions not removed, so the account stays: ${sessErr.message}`;
    const { error: tokErr } = await db.from("dashboard_login_tokens").delete().in("email", emails);
    if (tokErr) return `client removed; login tokens not removed, so the account stays: ${tokErr.message}`;
  }
  const { error: acctErr } = await db.from("accounts").delete().eq("id", c.account_id);
  if (acctErr) return `client removed; account not removed: ${acctErr.message}`;
  return null;
}
