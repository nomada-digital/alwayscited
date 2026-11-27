import "server-only";
import { Resend } from "resend";
import { mailFrom } from "@/config/mail-from";
import { headerSafe } from "@/lib/email-header";

/**
 * The dashboard login link (T3, 29 Sep 2026). Plain text: one sentence and
 * the link. Sent only to an address already in `dashboard_members` - the
 * caller looks the member up first and passes the stored address, never the
 * one typed into the form - so this cannot mail a stranger.
 *
 * Returns false rather than throwing; the login page says the same sentence
 * either way, so a failed send is logged, not shown.
 */
export async function sendLoginLink(input: { memberEmail: string; link: string; product?: string }): Promise<boolean> {
  const product = input.product ?? "alwayscited";
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.error("[app] RESEND_API_KEY is not set, login link not sent");
    return false;
  }
  const text = [
    `Here is your link to the ${product} dashboard. It works once, for 15 minutes.`,
    "",
    input.link,
    "",
    "If you did not ask for it, ignore this email - nothing happens until the link is opened.",
  ].join("\n");
  try {
    const { error } = await new Resend(key).emails.send({
      from: mailFrom(),
      to: input.memberEmail,
      subject: headerSafe(`Your ${product} login link`),
      text,
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
