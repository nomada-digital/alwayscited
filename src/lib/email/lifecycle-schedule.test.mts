import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";

import type { AnswerRow } from "../tracking/figures.ts";
import { ENDING_BEFORE_MS, SETUP_MAIL_EVENTS, TRIAL_MAIL_EVENT, endedInTrial, firstChargeFailed, planEndedInTrial, setupReminderDue, setupStillEmpty, trialEndingOnStripe, trialMailDue, trialRecap, unsentEvent, thisWeekDue, thisWeekEvent } from "./lifecycle-schedule.ts";

/**
 * When the daily cron sends a trial or setup email (8 Oct 2026, audit
 * activation-1): the day-offset picker on a 14-day trial, day by day, and the
 * once-per-client record it reads. Nothing is read or sent here.
 */

const DAY = 86_400_000;
const START = Date.parse("2026-10-08T19:30:00Z");
const END = new Date(START + 14 * DAY).toISOString();
const none = new Set<string>();
const due = (day: number, over: Partial<Parameters<typeof trialMailDue>[0]> = {}) =>
  trialMailDue({ status: "active", trialEndsAt: END, cancelledAt: null, sent: none, now: START + day * DAY, ...over });

test("day 0 sends nothing from the cron - trial_started went with the signup", () => {
  assert.equal(due(0), null);
  assert.equal(due(6.9), null);
});

test("day 7 sends trial_midpoint, once", () => {
  assert.equal(due(7), "trial_midpoint");
  assert.equal(due(8), "trial_midpoint", "a missed morning is caught up the next");
  assert.equal(due(7, { sent: new Set([TRIAL_MAIL_EVENT.trial_midpoint]) }), null);
});

test("day 11 - three days before the end - sends trial_ending, once, and never the midpoint late", () => {
  assert.equal(due(11), "trial_ending");
  assert.equal(due(13.9), "trial_ending");
  assert.equal(due(11, { sent: new Set([TRIAL_MAIL_EVENT.trial_ending]) }), null);
  assert.equal(due(10.9), "trial_midpoint", "just before the window it is still the midpoint");
  assert.equal(due(10.9, { sent: new Set([TRIAL_MAIL_EVENT.trial_midpoint]) }), null);
  assert.equal(ENDING_BEFORE_MS, 3 * DAY);
});

test("day 14 - the trial is over - sends nothing", () => {
  assert.equal(due(14), null);
  assert.equal(due(15), null);
});

test("a cancelled trial, an ended client or no trial sends nothing", () => {
  for (const day of [0, 7, 11, 13]) {
    assert.equal(due(day, { cancelledAt: new Date(START + DAY).toISOString() }), null, `cancelled, day ${day}`);
    assert.equal(due(day, { status: "ended" }), null, `ended, day ${day}`);
    assert.equal(due(day, { trialEndsAt: null }), null, `no trial, day ${day}`);
  }
});

test("an unsent claim does not count as sent, so the next morning tries again", () => {
  assert.equal(unsentEvent(TRIAL_MAIL_EVENT.trial_ending), "unsent_trial_mail_ending");
  assert.equal(due(12, { sent: new Set([unsentEvent(TRIAL_MAIL_EVENT.trial_ending)]) }), "trial_ending");
});

test("Stripe's trial_will_end sends trial_ending whenever the trial is still running and it has not gone", () => {
  const p = { status: "active", trialEndsAt: END, cancelledAt: null, sent: none, now: START + 10.99 * DAY };
  assert.equal(trialEndingOnStripe(p), true, "Stripe's three days and ours can differ by seconds");
  assert.equal(trialEndingOnStripe({ ...p, sent: new Set([TRIAL_MAIL_EVENT.trial_ending]) }), false);
  assert.equal(trialEndingOnStripe({ ...p, cancelledAt: END }), false);
  assert.equal(trialEndingOnStripe({ ...p, now: START + 14 * DAY }), false);
});

test("setup reminders: 24 and 72 hours after signup, while unconfirmed, in the first week only", () => {
  const at = (hours: number, over: Partial<Parameters<typeof setupReminderDue>[0]> = {}) =>
    setupReminderDue({ status: "active", signedUpAt: new Date(START).toISOString(), confirmed: false, sent: none, now: START + hours * 3_600_000, ...over });
  assert.equal(at(23), null);
  assert.equal(at(24), "setup_mail_24h");
  assert.equal(at(30, { sent: new Set(["setup_mail_24h"]) }), null);
  assert.equal(at(72, { sent: new Set(["setup_mail_24h"]) }), "setup_mail_72h");
  assert.equal(at(100), "setup_mail_72h", "past 72 hours the first is skipped, not sent late");
  assert.equal(at(80, { sent: new Set(["setup_mail_72h"]) }), null);
  assert.equal(at(48, { confirmed: true }), null, "a confirmed setup is never reminded");
  assert.equal(at(48, { status: "ended" }), null);
  assert.equal(at(7 * 24 + 1), null, "a client older than a week - the ones set up by hand before this - is never mailed");
});

/** Review of 7e133a7 (8 Oct 2026): "0 of your 10 clusters are still empty" under "Your clusters aren't set up yet". */
test("a setup reminder goes only while a cluster is still empty", () => {
  assert.equal(setupStillEmpty({ withPrompts: 0, clusterLimit: 10 }), true);
  assert.equal(setupStillEmpty({ withPrompts: 9, clusterLimit: 10 }), true);
  assert.equal(setupStillEmpty({ withPrompts: 10, clusterLimit: 10 }), false, "every cluster filled from the Clusters page, setup never confirmed");
  assert.equal(setupStillEmpty({ withPrompts: 11, clusterLimit: 10 }), false, "a pack dropped below what is in use");
});

test("the recap is the Overview's figures, from the first finished check", () => {
  const row = (run_date: string, named: boolean, brands: string[], answered = true): AnswerRow => ({ run_date, question_id: "q1", engine: "chatgpt", answered, named, brands });
  const rows = [row("2026-10-09", true, ["Xero"]), row("2026-10-10", false, ["Xero", "QuickBooks"]), row("2026-10-10", false, ["QuickBooks"]), row("2026-10-11", false, ["Xero"], false), row("2026-10-08", true, [])];
  const r = trialRecap({ rows, firstDay: "2026-10-09", today: "2026-10-15", you: "Tallyroo", clustersInUse: 2, clusterLimit: 10, livePrompts: 7 });
  // firstAsk joined 12 Oct 2026 (email review L3): null unless the sweep passes when new prompts are first asked.
  assert.deepEqual(r, { named: 1, answers: 3, since: "9 Oct", topOther: { name: "Xero", answers: 2 }, clustersInUse: 2, clusterLimit: 10, livePrompts: 7, firstAsk: null });
  const before = trialRecap({ rows: [], firstDay: null, today: "2026-10-15", you: "Tallyroo", clustersInUse: 1, clusterLimit: 10, livePrompts: 0 });
  assert.equal(before.since, null);
  assert.equal(before.answers, 0);
});

test("a subscription that ended by its trial's end was never charged", () => {
  const ends = "2026-10-22T19:30:00Z";
  const t = Date.parse(ends);
  assert.equal(endedInTrial({ trialEndsAt: ends, endedAt: t, now: t }), true, "a cancelled trial ends exactly at trial_end");
  assert.equal(endedInTrial({ trialEndsAt: ends, endedAt: t - 5 * DAY, now: t }), true, "ended early, inside the trial");
  assert.equal(endedInTrial({ trialEndsAt: ends, endedAt: t + 30 * DAY, now: t + 30 * DAY }), false, "a paying plan cancelled later");
  assert.equal(endedInTrial({ trialEndsAt: null, endedAt: t, now: t }), false, "no trial");
  assert.equal(endedInTrial({ trialEndsAt: ends, endedAt: null, now: t + 30 * DAY }), false, "no ended_at: now stands in");
});

/**
 * Review of 7e133a7 (8 Oct 2026): plan_ended chose the trial copy from
 * client_domains.trial_ends_at alone. Signup writes that after the client is
 * made and only logs a failed write, so an uncharged trial with the column
 * missing got "Stripe sends the final receipt". Stripe's own trial_end on the
 * deleted subscription decides first.
 */
test("plan_ended's trial copy is Stripe's trial_end first, the column only when the payload has none", () => {
  const end = Date.parse("2026-10-22T19:30:00Z") / 1000;
  const now = end * 1000;
  const cancelledInTrial = { status: "canceled", trial_end: end, ended_at: end, canceled_at: end - 5 * 86_400 };
  assert.equal(planEndedInTrial({ trialEndsAt: null, sub: cancelledInTrial, now }), true, "the column never written: Stripe's trial_end still says trial");
  assert.equal(planEndedInTrial({ trialEndsAt: "2026-10-22T19:30:00Z", sub: cancelledInTrial, now }), true);
  const paidThenCancelled = { status: "canceled", trial_end: end, ended_at: end + 40 * 86_400 };
  assert.equal(planEndedInTrial({ trialEndsAt: null, sub: paidThenCancelled, now: now + 40 * DAY }), false, "a trial that converted and was cancelled weeks later was charged");
  const neverATrial = { status: "canceled", trial_end: null, ended_at: end };
  assert.equal(planEndedInTrial({ trialEndsAt: null, sub: neverATrial, now }), false);
  assert.equal(planEndedInTrial({ trialEndsAt: "2026-10-22T19:30:00Z", sub: { ended_at: end - 86_400 }, now }), true, "no trial_end on the payload: the column stands in");
  assert.equal(planEndedInTrial({ trialEndsAt: null, sub: { trial_end: end }, now: now + 2 * DAY }), false, "no ended_at or canceled_at: now stands in, and now is past the trial");
});

/**
 * Email review H2 (12 Oct 2026): a trial whose first charge failed, and which
 * Stripe cancelled after its retries, ends after trial_end, so endedInTrial
 * gave a client who was never charged the paid copy. Stripe's
 * cancellation_details and the period the subscription is in tell the two
 * apart; anything less certain keeps the paid copy, because the trial copy
 * says "You were not charged".
 */
test("H2: a trial whose first charge failed and was cancelled by Stripe gets the trial copy; a renewal that failed does not", () => {
  const end = Date.parse("2026-10-22T19:30:00Z") / 1000;
  const failed = { status: "canceled", trial_end: end, ended_at: end + 15 * 86_400, cancellation_details: { reason: "payment_failed" } };
  const at = (sub: Record<string, unknown>) => planEndedInTrial({ trialEndsAt: null, sub, now: (end + 15 * 86_400) * 1000 });
  // API 2025-03-31 on: the period is on the subscription's items.
  assert.equal(at({ ...failed, items: { data: [{ current_period_start: end, current_period_end: end + 31 * 86_400 }] } }), true, "first period after the trial, cancelled for payment");
  // Before it: on the subscription itself.
  assert.equal(at({ ...failed, current_period_start: end }), true);
  assert.equal(firstChargeFailed({ ...failed, current_period_start: end }), true);
  // A trial that converted, paid its first month, then failed a renewal: a later period, so the paid copy.
  assert.equal(at({ ...failed, ended_at: end + 45 * 86_400, current_period_start: end + 31 * 86_400 }), false);
  // Cancelled at the client's request after the trial: not a failed charge.
  assert.equal(at({ ...failed, cancellation_details: { reason: "cancellation_requested" }, current_period_start: end }), false);
  // No period on the payload, or no trial: nothing assumed.
  assert.equal(at(failed), false);
  assert.equal(firstChargeFailed({ ...failed, trial_end: null, current_period_start: end }), false);
  assert.equal(firstChargeFailed({ ...failed, cancellation_details: null, current_period_start: end }), false);
});

test("the migration's unique index names exactly the events the sweep claims", () => {
  const sql = fs.readFileSync(new URL("../../../supabase/migrations/20261008040000_trial_lifecycle_emails.sql", import.meta.url), "utf8");
  const listed = /where event in \(([^)]*)\)/.exec(sql)?.[1]?.match(/'([a-z0-9_]+)'/g)?.map((s) => s.slice(1, -1)) ?? [];
  assert.deepEqual(listed.sort(), [...Object.values(TRIAL_MAIL_EVENT), ...SETUP_MAIL_EVENTS].sort());
  for (const e of listed) assert.ok(!listed.includes(unsentEvent(e)), "a released claim must fall outside the index");
});

// 13 Oct 2026, DIY P9 (spec 10 section 7.10): the Monday "This week" email.
test("This week: once a Monday in the client's own zone, never for a client that is not active", () => {
  const sent = new Set<string>();
  // Monday 19 Oct 2026 at the cron's 05:00 UTC: Monday in London (06:00) and in New York (01:00).
  const monday = Date.parse("2026-10-19T05:00:00Z");
  assert.equal(thisWeekDue({ status: "active", market: "UK", sent, now: monday }), "this_week_mail_2026-10-19");
  assert.equal(thisWeekDue({ status: "active", market: "US", sent, now: monday }), "this_week_mail_2026-10-19");
  assert.equal(thisWeekDue({ status: "active", market: "UK", sent: new Set(["this_week_mail_2026-10-19"]), now: monday }), null, "once a Monday");
  assert.equal(thisWeekDue({ status: "active", market: "UK", sent: new Set(["unsent_this_week_mail_2026-10-19"]), now: monday }), "this_week_mail_2026-10-19", "a released claim tries again");
  assert.equal(thisWeekDue({ status: "active", market: "UK", sent, now: monday + 86_400_000 }), null, "not on a Tuesday");
  assert.equal(thisWeekDue({ status: "ended", market: "UK", sent, now: monday }), null);
  // Sunday 18 Oct at 23:30 in New York is already Monday in London: each client's own Monday.
  const late = Date.parse("2026-10-19T03:30:00Z");
  assert.equal(thisWeekDue({ status: "active", market: "UK", sent, now: late }), "this_week_mail_2026-10-19");
  assert.equal(thisWeekDue({ status: "active", market: "US", sent, now: late }), null);
  assert.equal(thisWeekEvent("2026-10-26"), "this_week_mail_2026-10-26");
});

test("This week's claim is outside the trial index and inside its own, and its released claim outside both", () => {
  const sql = fs.readFileSync(new URL("../../../supabase/migrations/20261014200000_this_week_email_flag.sql", import.meta.url), "utf8");
  assert.match(sql, /insert into app_settings \(key, value\) values \('email_this_week_enabled', 'false'::jsonb\)\s*on conflict \(key\) do nothing;/);
  assert.match(sql, /create unique index if not exists dashboard_events_this_week_mail_once\s+on public\.dashboard_events \(client_domain_id, event\)\s+where event like 'this\\_week\\_mail\\_%';/);
  assert.ok(thisWeekEvent("2026-10-19").startsWith("this_week_mail_"));
  assert.ok(!unsentEvent(thisWeekEvent("2026-10-19")).startsWith("this_week_mail_"), "a released claim falls outside the index");
});
