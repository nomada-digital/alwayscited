
/**
 * R151 (3 Oct 2026): the waiting screen's "email me the report" form posted
 * without script comes back by a 303 carrying only an outcome code - never the
 * address - as `?mail=`. The route's sentences live here once, so the code and
 * the JSON reply say the same thing.
 */
export const MAIL_OUTCOMES = {
  queued: { ok: true, message: "We will email it to you the moment it is ready. You can close this tab." },
  sent: { ok: true, message: "Sent - it is in your inbox." },
  already: { ok: true, message: "That is already on its way to you." },
  long: { ok: false, message: "That email address is longer than an address can be." },
  bad: { ok: false, message: "That email does not look right." },
  // 4 Nov 2026: a personal address is accepted and flagged, as at the report gate (Danny); these two are refused.
  disposable: { ok: false, message: "That looks like a disposable inbox. Use an address we can reach." },
  nomail: { ok: false, message: "We can't find a mail server for that address. Check it and try again." },
  unfinished: { ok: false, message: "That check did not finish, so there is no report to send yet." },
  soon: { ok: false, message: "We could not send that just now. Please try again later." },
  failed: { ok: false, message: "We could not send that just now. Please try again." },
} as const;

export type MailOutcome = keyof typeof MAIL_OUTCOMES;

export function readMailOutcome(raw: string | string[] | undefined): MailOutcome | null {
  return typeof raw === "string" && Object.hasOwn(MAIL_OUTCOMES, raw) ? (raw as MailOutcome) : null;
}
