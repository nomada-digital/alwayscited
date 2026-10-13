import { TRIAL } from "../../config/trial.ts";
import { zoneDay } from "../tracking/check-time.ts";
import { type AnswerRow, type Day, brandBoard, formatDay, namedRate } from "../tracking/figures.ts";
import type { TrialRecap } from "./lifecycle.ts";

/**
 * When the daily cron sends a lifecycle email (8 Oct 2026, audit activation-1):
 * pure, so every day offset is a test rather than a wait. lifecycle-sweep.ts
 * reads the rows and sends; this decides.
 *
 * Each send is recorded in dashboard_events under the event names below, one
 * row per client per email, and a recorded one is never picked again. A send
 * that reached nobody renames its row `unsent_<event>`, so the next morning
 * tries again. The unique index in 20261008040000_trial_lifecycle_emails.sql
 * makes the claim exact when two runs race; before it lands, the read of the
 * sent set is the only guard.
 */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export const TRIAL_MAILS = ["trial_midpoint", "trial_ending"] as const;
export type TrialMail = (typeof TRIAL_MAILS)[number];

/** The dashboard_events row each one writes when it goes. */
export const TRIAL_MAIL_EVENT: Record<TrialMail, string> = { trial_midpoint: "trial_mail_midpoint", trial_ending: "trial_mail_ending" };

/** The two setup reminders, 24 and 72 hours after signup. */
export const SETUP_MAIL_EVENTS = ["setup_mail_24h", "setup_mail_72h"] as const;
export type SetupMailEvent = (typeof SETUP_MAIL_EVENTS)[number];

/** What a claimed row becomes when no owner was mailed: out of the sent set and out of the unique index. */
export const unsentEvent = (event: string) => `unsent_${event}`;

/** trial_midpoint goes once the trial is this far in. */
export const MIDPOINT_AFTER_MS = 7 * DAY;
/** trial_ending goes in this window before the end - Stripe's trial_will_end is sent three days before too. */
export const ENDING_BEFORE_MS = 3 * DAY;
/** A setup reminder is only for a client this new, so turning the flag on never mails the clients set up by hand before it. */
export const SETUP_WINDOW_MS = 7 * DAY;

/**
 * The trial email due for one client now, or null. Nothing for a client that
 * is not active, has no trial, cancelled it, or whose trial is over. Within
 * three days of the end it is trial_ending; before that, from a week in,
 * trial_midpoint. At most one a run, and a client past the ending window
 * when the flag goes on is never sent the midpoint late.
 *
 * Day 0 is nothing here: trial_started goes with the signup, carrying the
 * sign-in link only the webhook can mint.
 */
export function trialMailDue(p: { status: string | null; trialEndsAt: string | null; cancelledAt: string | null; sent: ReadonlySet<string>; now: number; days?: number }): TrialMail | null {
  if (p.status !== "active" || !p.trialEndsAt || p.cancelledAt) return null;
  const end = Date.parse(p.trialEndsAt);
  if (!Number.isFinite(end) || end <= p.now) return null;
  if (end - p.now <= ENDING_BEFORE_MS) return p.sent.has(TRIAL_MAIL_EVENT.trial_ending) ? null : "trial_ending";
  const start = end - (p.days ?? TRIAL.days) * DAY;
  if (p.now - start >= MIDPOINT_AFTER_MS) return p.sent.has(TRIAL_MAIL_EVENT.trial_midpoint) ? null : "trial_midpoint";
  return null;
}

/**
 * Stripe's trial_will_end, the fallback trigger for trial_ending: the same
 * rules, but the window is Stripe's to judge - its three days and ours can
 * differ by the seconds between them - so only "still running, not
 * cancelled, not sent" is asked.
 */
export function trialEndingOnStripe(p: { status: string | null; trialEndsAt: string | null; cancelledAt: string | null; sent: ReadonlySet<string>; now: number }): boolean {
  if (p.status !== "active" || !p.trialEndsAt || p.cancelledAt) return false;
  const end = Date.parse(p.trialEndsAt);
  return Number.isFinite(end) && end > p.now && !p.sent.has(TRIAL_MAIL_EVENT.trial_ending);
}

/**
 * The setup reminder due for one client now, or null: 24 hours after signup,
 * then 72, while setup is unconfirmed, and only in the first week. Past 72
 * hours the first is skipped rather than sent late, so a run never sends two.
 */
export function setupReminderDue(p: { status: string | null; signedUpAt: string; confirmed: boolean; sent: ReadonlySet<string>; now: number }): SetupMailEvent | null {
  if (p.status !== "active" || p.confirmed) return null;
  const age = p.now - Date.parse(p.signedUpAt);
  if (!Number.isFinite(age) || age < 0 || age > SETUP_WINDOW_MS) return null;
  if (age >= 72 * HOUR) return p.sent.has("setup_mail_72h") ? null : "setup_mail_72h";
  if (age >= 24 * HOUR) return p.sent.has("setup_mail_24h") ? null : "setup_mail_24h";
  return null;
}

/**
 * A due setup reminder goes only while a cluster is still empty (8 Oct 2026,
 * review of 7e133a7). The reminder says how many are empty, and a client who
 * filled every cluster from the Clusters page but never pressed Confirm on
 * /setup was told "0 of your 10 clusters are still empty" under "Your
 * clusters aren't set up yet". Their prompts are already read every morning -
 * shouldTrack does not ask for the confirmation - so there is nothing left to
 * remind them of, and nothing is sent.
 */
export function setupStillEmpty(p: { withPrompts: number; clusterLimit: number }): boolean {
  return p.withPrompts < p.clusterLimit;
}

/**
 * The trial so far, in the Overview's own figures: namedRate from the first
 * finished check to today, and the other brand brandBoard ranks first. Before
 * any check finished, `since` is null and the email says so.
 */
export function trialRecap(p: { rows: AnswerRow[]; firstDay: Day | null; today: Day; you: string; clustersInUse: number; clusterLimit: number; livePrompts: number; firstAsk?: string | null }): TrialRecap {
  const base = { clustersInUse: p.clustersInUse, clusterLimit: p.clusterLimit, livePrompts: p.livePrompts, firstAsk: p.firstAsk ?? null };
  if (!p.firstDay) return { named: 0, answers: 0, since: null, topOther: null, ...base };
  const range = { from: p.firstDay, to: p.today };
  const named = namedRate(p.rows, range);
  const top = brandBoard(p.rows, range, null, p.you).find((b) => !b.you);
  return { named: named.num, answers: named.den, since: formatDay(p.firstDay), topOther: top ? { name: top.name, answers: top.share.num } : null, ...base };
}

/**
 * Did this subscription end inside its trial, so nothing was ever charged?
 * True when it ended by the trial's end - a cancelled trial ends exactly
 * then (cancel_at_period_end). `endedAt` is Stripe's ended_at, else
 * canceled_at, in ms; null reads as now. An hour's grace for Stripe's clock.
 */
export function endedInTrial(p: { trialEndsAt: string | null; endedAt: number | null; now: number }): boolean {
  if (!p.trialEndsAt) return false;
  const end = Date.parse(p.trialEndsAt);
  return Number.isFinite(end) && (p.endedAt ?? p.now) <= end + HOUR;
}

/** A Stripe timestamp (seconds) in ms, or null. */
const secs = (v: unknown) => (typeof v === "number" ? v * 1000 : null);

/**
 * Which plan_ended a customer.subscription.deleted (or, from 9 Oct 2026,
 * an .updated saying canceled: BL-2) gets: the trial's when
 * the subscription ended inside its trial. The trial's end is Stripe's own
 * trial_end on the deleted subscription, else client_domains.trial_ends_at
 * (8 Oct 2026, review of 7e133a7). The column alone was not enough: signup
 * writes it after the client is made and only logs a failed write, and with
 * it missing a trial that was never charged got the paid copy, which then
 * promised a receipt (removed 12 Oct 2026, H2). Stripe's comes first because the column is a copy of
 * it - or, when signup could not read the subscription, an estimate.
 */
export function planEndedInTrial(p: { trialEndsAt: string | null; sub: Record<string, unknown>; now: number }): boolean {
  const stripeEnd = secs(p.sub.trial_end);
  const inTrial = endedInTrial({
    trialEndsAt: stripeEnd !== null ? new Date(stripeEnd).toISOString() : p.trialEndsAt,
    endedAt: secs(p.sub.ended_at) ?? secs(p.sub.canceled_at),
    now: p.now,
  });
  return inTrial || firstChargeFailed(p.sub);
}

/** The start of the period a subscription is in: its own current_period_start before API 2025-03-31, its first item's from then. */
function periodStart(sub: Record<string, unknown>): number | null {
  const own = secs(sub.current_period_start);
  if (own !== null) return own;
  const items = sub.items as { data?: unknown } | null | undefined;
  const first = Array.isArray(items?.data) ? (items.data[0] as Record<string, unknown> | undefined) : undefined;
  return first ? secs(first.current_period_start) : null;
}

/**
 * A trial whose first charge failed, and which Stripe cancelled after its
 * retries (12 Oct 2026, email review H2). It ends after trial_end, so
 * endedInTrial is false, and the client - never charged - got the paid copy.
 * Stripe says so on the subscription: cancellation_details.reason
 * payment_failed, in the period the trial's end began. A later period means
 * a charge went through first, so the paid copy stands; with no period on the
 * payload nothing is assumed, because the trial copy says "You were not
 * charged".
 */
export function firstChargeFailed(sub: Record<string, unknown>): boolean {
  const trialEnd = secs(sub.trial_end);
  const details = sub.cancellation_details as { reason?: unknown } | null | undefined;
  if (trialEnd === null || details?.reason !== "payment_failed") return false;
  const start = periodStart(sub);
  return start !== null && Math.abs(start - trialEnd) <= HOUR;
}

/**
 * The Monday "This week" email (13 Oct 2026, DIY P9; spec 10 section 7.10):
 * once a week, on the Monday of the client's own zone. The daily cron runs
 * at 05:00 UTC, which is Monday morning in London and the first hour of
 * Monday in New York, so each client's Monday is its own. The claim is one
 * dashboard_events row per client per Monday, named for the day, so a week's
 * email is never sent twice and next Monday's is a new row
 * (20261014200000_this_week_email_flag.sql makes the claim exact).
 */
export const THIS_WEEK_EVENT_PREFIX = "this_week_mail_";
export const thisWeekEvent = (monday: Day) => `${THIS_WEEK_EVENT_PREFIX}${monday}`;

/** The claim's event when today is a Monday in the client's zone and this week's has not gone, else null. */
export function thisWeekDue(p: { status: string | null; market: string; sent: ReadonlySet<string>; now: number }): string | null {
  if (p.status !== "active") return null;
  const day = zoneDay(p.now, p.market);
  if (new Date(`${day}T00:00:00Z`).getUTCDay() !== 1) return null;
  const event = thisWeekEvent(day);
  return p.sent.has(event) ? null : event;
}
