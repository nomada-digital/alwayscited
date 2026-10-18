"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { TRACKED_PRICE } from "@/config/pricing";
import { constantTimeEqual, decodeBasicAuth } from "@/lib/constant-time";
import { CUSTOMER_EMAILS, type CustomerEmail, previews } from "@/lib/email/lifecycle";
import { sendLifecycle } from "@/lib/email/lifecycle-mail";
import { customerEmailsFor } from "@/lib/email/preview-source";

/**
 * /admin/emails' "Send test to me" (brief item 2e, 18 Oct 2026): one email,
 * rendered exactly as the page shows it - on the chosen client's rows, or on
 * the fixture - sent through the lifecycle sender (Resend) to TEST_RECIPIENT
 * and to nobody else. The address is this constant, never a form field, so
 * the action cannot mail anyone else whatever is posted to it.
 *
 * A server action is answered on any path by its id, so it checks the
 * /admin Basic auth itself before anything, as admin/tracking/actions.ts does.
 * It writes nothing and flips no flag.
 */
const TEST_RECIPIENT = "danny@nomadadigital.co.uk";

async function isAdmin(): Promise<boolean> {
  const user = process.env.ADMIN_USER;
  const password = process.env.ADMIN_PASSWORD;
  if (!user || !password) return false;
  const creds = decodeBasicAuth((await headers()).get("authorization") ?? "");
  if (!creds) return false;
  const userOk = constantTimeEqual(creds.user, user);
  const passwordOk = constantTimeEqual(creds.password, password);
  return userOk && passwordOk;
}

export async function sendTestEmail(form: FormData): Promise<void> {
  if (!(await isAdmin())) redirect("/admin/emails?sent=refused");
  const name = String(form.get("email") ?? "");
  const client = String(form.get("client") ?? "").trim().slice(0, 253);
  if (!(CUSTOMER_EMAILS as readonly string[]).includes(name)) redirect("/admin/emails?sent=refused");
  const which = name as CustomerEmail;
  const real = client ? await customerEmailsFor(client) : null;
  const mail = real ? real.mails[which] : previews(TRACKED_PRICE)[which];
  const ok = await sendLifecycle({ memberEmail: TEST_RECIPIENT, mail: { ...mail, subject: `[test] ${mail.subject}` } });
  const q = new URLSearchParams({ ...(real ? { client: real.slug } : {}), sent: ok ? which : "failed" });
  redirect(`/admin/emails?${q}#${which}`);
}
