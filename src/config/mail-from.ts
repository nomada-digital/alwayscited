import { CONTACT_EMAIL } from "./contact.ts";

/**
 * The address every message this product sends comes from, decided once.
 *
 * It was decided four times. `process.env.SCAN_FROM_EMAIL ?? "alwayscited
 * <onboarding@resend.dev>"` was typed verbatim in `app/contact/actions.ts`,
 * `app/actions/waitlist.ts` and twice in `lib/scan/verify-email.ts` - the
 * verification mail and the report mail - with no constant anywhere. That is
 * the species this tree keeps paying for: the date formatter existed twice and
 * the untested copy was the one missing a guard, the honeypot existed twice
 * and the untested copy was the one missing the field, the contact address was
 * typed thirteen times before `CONTACT_EMAIL` (`349dcda`).
 *
 * **What was watching it, and why that is not the same as reading it.**
 * `readiness.test.mts` asserts `senders.length >= 3` over files containing the
 * string `SCAN_FROM_EMAIL`, which justifies the variable's place on the
 * readiness list. A count floor cannot notice one whole sender dropping off -
 * the same shape `input-bounds.test.mts` records about `TAGS` - and it says
 * nothing at all about what the four fall back TO. `email-header.test.mts`
 * does walk every `emails.send` in the tree, and reads one field of the five:
 * the subject. The address on the envelope was read by nothing.
 *
 * **The rename this exists for is not hypothetical.** blocked.md 20 is open
 * because `resend.dev` is a domain this project does not own, and closing it
 * means editing the fallback. Four sites in three files is the size at which
 * `CONTACT_EMAIL`'s own note says a grep-driven rename leaves copies behind -
 * and the two that read least like copy are the two in `verify-email.ts`, one
 * of which is the unlock mail that blocked.md 20 names as the thing a
 * visitor's address is traded for.
 *
 * `mail-from.test.mts` holds both directions: nothing else types the literal
 * or reads the variable, and every send in the tree takes its `from` from
 * here.
 */

/**
 * Where mail comes from when the deployment has not said.
 *
 * `resend.dev` is Resend's own sandbox domain and not one this project owns,
 * which is blocked.md 20 and is Danny's to answer. It is a fallback rather
 * than a hard failure on purpose: a deployment with `RESEND_API_KEY` set and
 * this unset should still deliver the unlock mail somebody traded an address
 * for, and `readiness-spec.ts` names the variable so `/admin/scans` says out
 * loud that it is missing.
 */
export const MAIL_FROM_FALLBACK = "alwayscited <onboarding@resend.dev>";

/**
 * The From header, read at call time because it is a deployment value.
 *
 * `||` rather than the `??` the four call sites used. They are not the same
 * here and the difference is observable: `SCAN_FROM_EMAIL=""` is an ordinary
 * deployment state - an env var created and left blank stores an empty string,
 * not an absent one - and `??` passes that straight through, so all four sends
 * go out with an empty From and Resend refuses every one of them. Three of the
 * four paths log that and return, so the visible result is mail that silently
 * stops. An empty string is not an address, and the fallback exists for
 * exactly the case where the variable cannot be used.
 */
export function mailFrom(sender: MailSender = "team"): string {
  const from = process.env.SCAN_FROM_EMAIL || MAIL_FROM_FALLBACK;
  return sender === "danny" ? `${DANNY_NAME} <${addressOf(from)}>` : from;
}

/**
 * Who a customer email is from (brief item 2e, 18 Oct 2026). Every email is
 * from the deployment's address as SCAN_FROM_EMAIL sets it - production is to
 * set it to "alwayscited <hello@alwayscited.com>" - and #3 welcome and #12 plan
 * ended carry Danny's name on that same address, so no second address is
 * configured, typed or verified: "Danny at alwayscited <hello@alwayscited.com>".
 */
export type MailSender = "team" | "danny";

export const DANNY_NAME = "Danny at alwayscited";

/** The bare address inside a From value: "a <b@c>" is b@c, and a value with no angle brackets is itself. */
export function addressOf(from: string): string {
  const m = /<([^<>\s]+@[^<>\s]+)>\s*$/.exec(from);
  return (m ? m[1]! : from).trim();
}

/**
 * Where a reply to a customer email goes (brief 2e): our own inbox, the one
 * address the site publishes, never a deployment value or a caller's string.
 */
export const MAIL_REPLY_TO = CONTACT_EMAIL;
