import "server-only";
import { Resend } from "resend";
import { mailFrom } from "@/config/mail-from";
import { headerSafe } from "@/lib/email-header";
import type { Rendered } from "@/lib/email/lifecycle";
import { visibilityCc } from "@/lib/email/visibility-cc";

/**
 * The lifecycle emails' one sender (R159 part 3, 1 Oct 2026). Each call site
 * asks lifecycleOn first; every flag is false until Danny approves that
 * preview at /admin/emails, so nothing here sends until he does.
 *
 * Who calls sendLifecycle, each behind a signature, the cron secret or a
 * dashboard session (8 Oct 2026, review of 7e133a7: this said "only from the
 * signed Stripe webhook", wrong since first_reading and setup_confirmed
 * joined, and plainly wrong once the cron's sweep did):
 *
 * - the signed Stripe webhook (checkout/signup.ts): the welcome, or
 *   trial_started for a trial order, to the owner signup just stored;
 *   plan_ended to the ended client's live owners, on
 *   customer.subscription.deleted or (9 Oct 2026, BL-2) an .updated whose
 *   status is canceled, once whichever lands first; and trial_ending on
 *   customer.subscription.trial_will_end, through lifecycle-sweep.ts;
 * - the tracking runner (tracking/runner.ts), started only by the cron's
 *   signed dispatch: first_reading, after the client's first finished run;
 * - the setup route, for a signed-in owner or editor (tracking/setup-mail.ts):
 *   setup_confirmed, after the route writes the one setup_confirmed row;
 * - the daily cron, /api/cron/track behind CRON_SECRET (lifecycle-cron.ts
 *   hands this function to lifecycle-sweep.ts): trial_midpoint,
 *   trial_ending and setup_reminder, each once per client.
 *
 * The invite asks lifecycleOn too, but goes through invite-mail.ts and its
 * owner caps. lifecycleOn lives in lifecycle-flag.ts, so the sweep can load
 * it under node --test, and is re-exported here for every send site.
 *
 * Every customer update here copies AC_VISIBILITY_CC (visibility-cc.ts, Danny, 10 Nov 2026); a transactional one
 * (invoice-mail.ts's payment received) says so and copies nobody.
 *
 * Returns false rather than throwing, as the other senders do.
 */
export { lifecycleOn } from "./lifecycle-flag.ts";

export async function sendLifecycle(input: { memberEmail: string; mail: Rendered; transactional?: boolean }): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.error("[mail] RESEND_API_KEY is not set, lifecycle email not sent");
    return false;
  }
  const cc = input.transactional ? [] : visibilityCc(input.memberEmail);
  try {
    const { error } = await new Resend(key).emails.send({
      from: mailFrom(),
      to: input.memberEmail,
      ...(cc.length ? { cc } : {}),
      subject: headerSafe(input.mail.subject),
      html: input.mail.html,
      text: input.mail.text,
    });
    if (error) {
      console.error("[mail] lifecycle email rejected", error);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[mail] lifecycle email failed", err);
    return false;
  }
}
