import "server-only";

import { TRACKED_PRICE } from "@/config/pricing";
import { sendLifecycle } from "@/lib/email/lifecycle-mail";
import { type SweepIo, type SweepResult, sweepLifecycleMail } from "@/lib/email/lifecycle-sweep";
import { clientMail } from "@/lib/email/merge-source";
import { thisWeekContent } from "@/lib/email/this-week-source";
import { signUnsubscribe, unsubscribeLink } from "@/lib/email/unsubscribe";
import { dashOrigin } from "@/lib/dash/host";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * The live wiring of lifecycle-sweep.ts (8 Oct 2026, review of 7e133a7): the
 * sweep takes its sender, origin and price as an argument so node --test can
 * run it against a fake database (lifecycle-sweep.test.mts), and this is the
 * one place the real ones are handed in - Resend through sendLifecycle, the
 * canonical origin, TRACKED_PRICE. The Stripe webhook's trial_will_end uses
 * lifecycleIo too, so the cron and the webhook cannot word a trial_ending
 * differently.
 *
 * 13 Oct 2026, DIY P9: and the This week email's content source, read on the
 * server through the app's own readers (this-week-source.ts); the sweep asks
 * its flag, email_this_week_enabled, before reading any of it.
 *
 * 18 Oct 2026 (brief 2e): links are built on the dashboards host (dashOrigin),
 * where the customer dashboard is moving; each email's figures come from the
 * dashboard's own rows (merge-source.ts clientMail); and #7 carries a one-click
 * unsubscribe signed with CRON_SECRET (unsubscribe.ts), read here and never
 * printed.
 */
export function lifecycleIo(): SweepIo {
  return { send: sendLifecycle, origin: dashOrigin(), price: TRACKED_PRICE, thisWeek: thisWeekContent, client: (id) => clientMail(id), unsubscribe: unsubscribeFor };
}

/** A member's signed unsubscribe link for one client's Monday email, or null with no secret set. */
export function unsubscribeFor(email: string, clientId: string): string | null {
  const token = signUnsubscribe(process.env.CRON_SECRET ?? "", { email, clientId });
  return token ? unsubscribeLink(dashOrigin(), token) : null;
}

/** The cron's call: its own admin client, and nothing it does can fail the dispatch's answer. */
export async function sweepLifecycleMailSafely(): Promise<SweepResult | { error: string }> {
  try {
    const out = await sweepLifecycleMail(supabaseAdmin(), lifecycleIo());
    for (const e of out.errors) console.warn(`[mail] lifecycle sweep: ${e}`);
    return out;
  } catch (err) {
    const error = (err instanceof Error ? err.message : String(err)).slice(0, 300);
    console.warn(`[mail] lifecycle sweep failed: ${error}`);
    return { error };
  }
}
