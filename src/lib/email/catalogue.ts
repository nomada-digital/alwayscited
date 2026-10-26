import { flagFor, LIFECYCLE_EMAILS, previewSets, TRANSACTIONAL_EMAILS, transactionalPreviews, type LifecycleEmail, type TransactionalEmail } from "./lifecycle.ts";

/**
 * Every email the agency hub's Emails tab shows (26 Oct 2026): the alwayscited workspace in nomada-dashboards
 * (generators/ac_views.py) reads this through /api/hub/emails, so the tab and /admin/emails draw the same previews from
 * the same templates. Pure, so node --test reads it; nothing here reads a flag or sends.
 *
 * One entry per app_settings switch, email_<name>_enabled: the ten lifecycle emails (off until Danny turns one on, a
 * missing row is off) and the transactional ones (on unless set off, a missing row is on - lifecycle-flag.ts). Each
 * carries what sends it, in plain words, and every case its flag covers, on made-up data.
 *
 * NOT_WRITTEN is a switch with no email behind it. payment_failed has had its row since 18 Oct
 * (20261018030000_cluster_forms_and_targets.sql, seeded false), but nothing on this branch writes or sends it:
 * subscription-events.ts onInvoicePaymentFailed records the past-due state and leaves the customer to Stripe's own
 * failed-payment emails. The hub shows it as not written yet, with no switch, rather than a switch that does nothing.
 */

export const NOT_WRITTEN = ["payment_failed"] as const;
export type UnwrittenEmail = (typeof NOT_WRITTEN)[number];
export type CatalogueName = LifecycleEmail | TransactionalEmail | UnwrittenEmail;

export type CatalogueCase = { label: string; subject: string; html: string; text: string };
export type CatalogueEntry = {
  name: CatalogueName;
  kind: "lifecycle" | "transactional";
  /** The app_settings key that switches it. */
  flag: string;
  /** What a missing row means: false for a lifecycle email, true for a transactional one. */
  missingIs: boolean;
  /** What sends it, in plain words. */
  trigger: string;
  written: boolean;
  /** Why it is not written, for an entry with written false. */
  note?: string;
  cases: CatalogueCase[];
};

/** What sends each one, from the send sites lifecycle-mail.ts lists. */
export const TRIGGERS: Record<CatalogueName, string> = {
  welcome: "Stripe checkout completes for a paid order with no trial. Goes to the new owner, with their sign-in link.",
  trial_started: "Stripe checkout completes for an alwaystracked free-trial order. Goes to the new owner in place of the welcome.",
  setup_reminder: "The daily cron, 24 and 72 hours after signup, while the client has not confirmed setup. Only for clients under a week old.",
  setup_confirmed: "An owner or editor confirms setup on the dashboard.",
  first_reading: "The tracking run finishes the client's first daily check.",
  trial_midpoint: "The daily cron, a week into a free trial that is still running.",
  trial_ending: "Three days before a free trial ends: Stripe's trial_will_end, or the daily cron if that never arrives.",
  invite: "An owner invites a teammate to the dashboard as an editor or viewer.",
  plan_ended: "A Stripe subscription is cancelled. Goes to the client's live owners, once.",
  this_week: "The daily cron on Monday morning in the client's time zone, to owners and editors. Never in agency mode.",
  payment_received: "Stripe invoice.paid that took money: the first payment, a trial converting, each renewal, a pack.",
  payment_failed: "Stripe invoice.payment_failed on a renewal, while Stripe retries the card.",
};

/** Every switch, in the order the hub lists them: lifecycle, then transactional, then the ones not written yet. */
export function emailCatalogue(price: { us: number; uk: number }): CatalogueEntry[] {
  const life = previewSets(price);
  const money = transactionalPreviews();
  const cases = (list: { label: string; mail: { subject: string; html: string; text: string } }[]) =>
    list.map(({ label, mail }) => ({ label, subject: mail.subject, html: mail.html, text: mail.text }));
  return [
    ...LIFECYCLE_EMAILS.map((name) => ({ name, kind: "lifecycle" as const, flag: flagFor(name), missingIs: false, trigger: TRIGGERS[name], written: true, cases: cases(life[name]) })),
    ...TRANSACTIONAL_EMAILS.map((name) => ({ name, kind: "transactional" as const, flag: flagFor(name), missingIs: true, trigger: TRIGGERS[name], written: true, cases: cases(money[name]) })),
    ...NOT_WRITTEN.map((name) => ({
      name,
      kind: "lifecycle" as const,
      flag: `email_${name}_enabled`,
      missingIs: false,
      trigger: TRIGGERS[name],
      written: false,
      note: "The switch exists (seeded off) but there is no email behind it: a failed renewal is recorded on the client and Stripe's own failed-payment emails go to the customer.",
      cases: [],
    })),
  ];
}

/** A test send's subject: marked, so nobody mistakes it for a real one. */
export const testSubject = (subject: string) => `[Test] ${subject}`;

/** Only a Nomada address is ever sent a test. */
export const isTestRecipient = (to: unknown): to is string => typeof to === "string" && /^[a-z0-9._%+-]{1,64}@nomadadigital\.co\.uk$/.test(to);
