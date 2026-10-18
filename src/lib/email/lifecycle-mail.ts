import "server-only";
import { Resend } from "resend";
import { MAIL_REPLY_TO, mailFrom } from "@/config/mail-from";
import { headerSafe } from "@/lib/email-header";
import type { Rendered } from "@/lib/email/lifecycle";

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
 * - the signed Stripe webhook again (18 Oct 2026, brief 2e): payment_failed,
 *   on invoice.payment_failed for a renewal, to the live owners, once per
 *   invoice (payment-failed-mail.ts);
 * - /admin/emails' "Send test to me", behind the admin's Basic auth, to the
 *   one fixed test address TEST_RECIPIENT and nobody else (18 Oct 2026).
 *
 * From the deployment's address, or Danny's name on it for #3 and #12
 * (mail-from.ts), with replies to our own inbox.
 *
 * The invite asks lifecycleOn too, but goes through invite-mail.ts and its
 * owner caps. lifecycleOn lives in lifecycle-flag.ts, so the sweep can load
 * it under node --test, and is re-exported here for every send site.
 *
 * Returns false rather than throwing, as the other senders do.
 */
export { lifecycleOn } from "./lifecycle-flag.ts";

export async function sendLifecycle(input: { memberEmail: string; mail: Rendered }): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.error("[mail] RESEND_API_KEY is not set, lifecycle email not sent");
    return false;
  }
  try {
    const { error } = await new Resend(key).emails.send({
      from: mailFrom(input.mail.sender),
      to: input.memberEmail,
      replyTo: MAIL_REPLY_TO,
      subject: headerSafe(input.mail.subject),
      html: input.mail.html,
      text: input.mail.text,
      // #7's List-Unsubscribe and List-Unsubscribe-Post (brief 2e, 18 Oct 2026); no other email carries any.
      ...(input.mail.headers ? { headers: input.mail.headers } : {}),
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
