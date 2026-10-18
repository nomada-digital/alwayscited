import "server-only";
import { Resend } from "resend";
import { MAIL_REPLY_TO, mailFrom } from "@/config/mail-from";
import { headerSafe } from "@/lib/email-header";
import { loginLink } from "@/lib/email/lifecycle";

/**
 * The dashboard login link (T3, 29 Sep 2026). Since 18 Oct 2026 (brief 2e)
 * the approved design #1, HTML and plain text from lifecycle.ts loginLink,
 * always on - it has no flag. Sent only to an address already in `dashboard_members` - the
 * caller looks the member up first and passes the stored address, never the
 * one typed into the form - so this cannot mail a stranger.
 *
 * Returns false rather than throwing; the login page says the same sentence
 * either way, so a failed send is logged, not shown.
 */
export async function sendLoginLink(input: { memberEmail: string; link: string }): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.error("[app] RESEND_API_KEY is not set, login link not sent");
    return false;
  }
  const mail = loginLink({ link: input.link });
  try {
    const { error } = await new Resend(key).emails.send({
      from: mailFrom(),
      to: input.memberEmail,
      replyTo: MAIL_REPLY_TO,
      subject: headerSafe(mail.subject),
      html: mail.html,
      text: mail.text,
    });
    if (error) {
      console.error("[app] login link rejected", error);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[app] login link failed", err);
    return false;
  }
}
