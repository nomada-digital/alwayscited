import type { SupabaseClient } from "@supabase/supabase-js";

import { trialCancelledAfter } from "./webhook.ts";

/**
 * A trial cancelled outside the dashboard's button, recorded where the button
 * records it (12 Oct 2026, email review H1). The help page offers a cancel by
 * email - we cancel in Stripe - and Stripe's customer portal cancels at
 * period end; both left client_domains.trial_cancelled_at empty, so the trial
 * emails, which skip only a stamped client (lifecycle-sweep.ts), told a
 * client who had cancelled that the card would be charged. The column is the
 * one the sweep, the sidebar and Settings already read, so no migration.
 *
 * customer.subscription.updated calls this (signup.ts onSubscriptionUpdated)
 * and trialCancelledAfter decides. A stamp goes only over an empty column, so
 * the first cancel's time stands - the dashboard's own, when it was the
 * button. Relative imports only, so it runs under node --test
 * (trial-cancel.test.mts). False on a failed write, so Stripe retries.
 */
export async function recordTrialCancel(db: SupabaseClient, clientId: string, sub: Record<string, unknown>, previous: Record<string, unknown>, at: number): Promise<boolean> {
  const next = trialCancelledAfter(sub, previous, at);
  if (next === undefined) return true;
  const { error } = next === null ? await clearCancel(db, clientId) : await stampCancel(db, clientId, next);
  if (error) {
    console.error(`[stripe] trial ${next === null ? "un-cancel" : "cancel"} not recorded for ${clientId}: ${error.message}`);
    return false;
  }
  console.info(`[stripe] trial on ${clientId} ${next === null ? "no longer cancelled" : "cancelled in Stripe"}: subscription ${String(sub.id)}`);
  return true;
}

/** The cancel taken back: the column cleared. */
async function clearCancel(db: SupabaseClient, clientId: string): Promise<{ error: { message: string } | null }> {
  const { error } = await db.from("client_domains").update({ trial_cancelled_at: null }).eq("id", clientId);
  return { error };
}

/** The cancel recorded, only over an empty column. */
async function stampCancel(db: SupabaseClient, clientId: string, at: string): Promise<{ error: { message: string } | null }> {
  const { error } = await db.from("client_domains").update({ trial_cancelled_at: at }).eq("id", clientId).is("trial_cancelled_at", null);
  return { error };
}
