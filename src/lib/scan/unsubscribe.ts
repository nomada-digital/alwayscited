import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { missingColumn } from "@/lib/tracking/limits";

/**
 * Unsubscribe from report emails and follow-ups (Danny, 3 Nov 2026). Every report email carries
 * `/scan/<report token>/unsubscribe` and a List-Unsubscribe one-click header onto `/api/unsubscribe/<report token>`; the
 * hub's follow-ups use the same link, because scan_leads already holds each scan's report_token - no shared secret.
 * The token names the scan, the scan names the address, and the address goes into email_suppressions (migration
 * 20261104010000), which dashboard_scan_leads() reads as `suppressed` and `follow_up_ok`.
 *
 * Holding the token is holding the report link, so it can only ever unsubscribe that report's own address.
 */
export const TOKEN = /^[0-9a-f]{32}$/;

export function unsubscribeLinks(siteUrl: string, publicToken: string): { page: string; oneClick: string } {
  return { page: `${siteUrl}/scan/${publicToken}/unsubscribe`, oneClick: `${siteUrl}/api/unsubscribe/${publicToken}` };
}

/** The scan's address for a token, or null. */
export async function addressFor(token: string): Promise<{ scanId: string; email: string } | null> {
  if (!TOKEN.test(token)) return null;
  const { data, error } = await supabaseAdmin().from("scans").select("id, report_email").eq("public_token", token).maybeSingle();
  if (error) throw new Error("could not read the scan: " + error.message);
  const email = typeof data?.report_email === "string" ? data.report_email.trim().toLowerCase() : "";
  return data && email ? { scanId: data.id as string, email } : null;
}

/** Whether the address is already suppressed. False before the migration. */
export async function isSuppressed(email: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin().from("email_suppressions").select("email").eq("email", email).maybeSingle();
  if (error) {
    if (!missingColumn(error) && !/email_suppressions/.test(error.message)) console.warn("[unsubscribe] could not read: " + error.message);
    return false;
  }
  return Boolean(data);
}

/** Records the unsubscribe. Idempotent: a second press keeps the first row. */
export async function suppress(token: string, source: "unsubscribe_link" | "one_click"): Promise<"done" | "no_address" | "failed"> {
  let found: { scanId: string; email: string } | null;
  try {
    found = await addressFor(token);
  } catch (err) {
    console.warn("[unsubscribe] " + (err instanceof Error ? err.message : String(err)));
    return "failed";
  }
  if (!found) return "no_address";
  const { error } = await supabaseAdmin()
    .from("email_suppressions")
    .upsert({ email: found.email, source, scan_id: found.scanId }, { onConflict: "email", ignoreDuplicates: true });
  if (error) {
    console.warn("[unsubscribe] could not record: " + error.message);
    return "failed";
  }
  return "done";
}

/** "jo@example.com" -> "j•@example.com": enough to recognise, not enough to harvest from a forwarded link. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  return at < 1 ? email : email[0] + "•".repeat(Math.min(6, at - 1)) + email.slice(at);
}
