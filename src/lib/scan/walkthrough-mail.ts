import "server-only";
import { Resend } from "resend";
import { CONTACT_EMAIL } from "@/config/contact";
import { mailFrom } from "@/config/mail-from";
import { headerSafe } from "@/lib/email-header";
import { siteUrl } from "@/lib/scan/verify-email";
import { categoryLabel, marketLabel, type WalkthroughAsk } from "@/lib/scan/walkthrough-fields";

/**
 * The alert to Danny when somebody asks for a walkthrough. Internal only - it
 * goes to our own inbox, never to the visitor. Plain text on purpose: it is a
 * task, and the one thing in it that matters is the report link.
 *
 * Two callers since 28 September 2026: the result page (a scan, so `scan` is
 * set and the report link is the point) and the tier pages (no scan, so
 * `from` says which page asked).
 *
 * Returns false rather than throwing. The request is already stored, so a
 * failed alert is recoverable from `walkthrough_requests.notified_at is null`.
 *
 * 13 Oct 2026 (Danny): the ask carries the person's name, business category
 * and market, all three required, and they lead the alert - the alert is
 * where Luke and Danny read them, and the only place they are while
 * 20261014000000_walkthrough_fields.sql is not applied (walkthrough-store.ts).
 * The scan's own category, which is the topic it was run on rather than the
 * one the person picked, is "Scan category" so the two are not confused.
 */
export async function sendWalkthroughAlert(input: {
  kind: "video" | "demo";
  email: string;
  ask: WalkthroughAsk;
  scan: { domain: string; brand: string | null; topic: string | null; token: string } | null;
  from?: string;
}): Promise<boolean> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.error("[walkthrough] RESEND_API_KEY is not set, alert not sent");
    return false;
  }
  // The toggle's own labels (R176), so the subject says who picks it up.
  const what = input.kind === "video" ? "Loom with Luke" : "Demo with Danny";
  const scan = input.scan;
  const context = scan
    ? [
        `Scanned: ${scan.domain}${scan.brand ? " (" + scan.brand + ")" : ""}`,
        `Scan category: ${scan.topic ?? "not confirmed"}`,
        `Their report: ${siteUrl()}/scan/${scan.token}`,
      ]
    : [`Asked from: ${siteUrl()}${input.from ?? ""}`, "No scan yet."];
  const text = [
    `${input.ask.name} (${input.email}) asked for a ${input.kind === "video" ? "Loom walkthrough" : "demo call"} of alwaystracked (${what}).`,
    "",
    `Name: ${input.ask.name}`,
    `Email: ${input.email}`,
    `Category: ${categoryLabel(input.ask.category)}`,
    `Market: ${marketLabel(input.ask.market)}`,
    "",
    ...context,
    "",
    input.kind === "video"
      ? scan
        ? "Record the walkthrough against their report and reply to them with the link."
        : "Record a walkthrough of the platform and reply to them with the link."
      : "Reply to them to find a time.",
  ].join("\n");
  try {
    const { error } = await new Resend(key).emails.send({
      from: mailFrom(),
      // The contact form's destination, so it lands where contact mail already
      // does. Never an address a caller supplied - theirs is the reply-to.
      to: process.env.CONTACT_EMAIL_DESTINATION ?? CONTACT_EMAIL,
      replyTo: input.email,
      subject: headerSafe(`Walkthrough request: ${what} for ${scan ? scan.domain : input.email}`),
      text,
    });
    if (error) {
      console.error("[walkthrough] alert rejected", error);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[walkthrough] alert failed", err);
    return false;
  }
}
