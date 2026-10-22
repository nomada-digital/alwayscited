import type { SupabaseClient } from "@supabase/supabase-js";

import { flagFor, flagOn, type LifecycleEmail, type TransactionalEmail } from "./lifecycle.ts";

/**
 * Is one lifecycle email switched on: its app_settings row
 * email_<name>_enabled holds jsonb true. A failed read is off. Every flag
 * ships false and only Danny turns one on, after approving its preview at
 * /admin/emails.
 *
 * Here rather than in lifecycle-mail.ts since 8 Oct 2026 (review of
 * 7e133a7): lifecycle-sweep.ts runs under node --test with a fake database,
 * and lifecycle-mail.ts is server-only with the Resend SDK, so the sweep
 * could not load the one flag read and would have needed a copy of it.
 * lifecycle-mail.ts re-exports it, so every send site still imports it from
 * there.
 */
export async function lifecycleOn(db: SupabaseClient, name: LifecycleEmail): Promise<boolean> {
  const { data, error } = await db.from("app_settings").select("value").eq("key", flagFor(name)).maybeSingle();
  if (error) {
    console.error(`[mail] ${flagFor(name)} not read, treated as off: ${error.message}`);
    return false;
  }
  return flagOn(data?.value);
}

/**
 * A transactional email's flag (22 Oct 2026, lifecycle.ts TRANSACTIONAL_EMAILS): on unless Danny has set it off - a
 * missing row is on, only jsonb false is off. A failed read is on too: a receipt the customer is owed outweighs a
 * flag we could not read.
 */
export async function transactionalOn(db: SupabaseClient, name: TransactionalEmail): Promise<boolean> {
  const { data, error } = await db.from("app_settings").select("value").eq("key", flagFor(name)).maybeSingle();
  if (error) console.error(`[mail] ${flagFor(name)} not read, treated as on: ${error.message}`);
  return data?.value !== false;
}
