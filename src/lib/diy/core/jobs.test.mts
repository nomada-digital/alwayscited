import assert from "node:assert/strict";
import { test } from "node:test";

import type { DiyClient } from "./client.ts";
import {
  MAX_ATTEMPTS,
  MONTHLY_CLAMP,
  STALE_CLAIM_MS,
  WORKER_BUDGET_MS,
  WORKER_POOL,
  WORKERS_PER_PASS,
  type JobSpec,
  type LastJob,
  byClaimOrder,
  claimable,
  diyDay,
  dueFor,
  dueJobs,
  refuseHandlers,
  slotOn,
  unclaimedOrStale,
  weekdayOf,
} from "./jobs.ts";

/**
 * The DIY job system's due computation (13 Oct 2026, DIY P1 milestone M1;
 * spec 10 section 5.7): the start-weekday anchor, the monthly clamp to 28,
 * onboarding, and what a waiting or failed row does to the next queue.
 *
 * Tallyroo's start day, 10 Jun 2026, is a Wednesday; 12 Oct 2026 is a Monday.
 */

const ANCHOR = "2026-06-10";

const spec = (over: Partial<JobSpec> = {}): JobSpec => ({ kind: "kind_a", paid: false, cadence: "daily", priority: 5, onboarding: false, ...over });
const confirmedAt = "2026-06-09T12:00:00Z";
const client = (over: Partial<Pick<DiyClient, "status" | "startedOn" | "setupConfirmedAt">> = {}) => ({ status: "active" as const, startedOn: ANCHOR, setupConfirmedAt: confirmedAt, ...over });
const last = (due_on: string, created_at = `${due_on}T03:30:00Z`): LastJob => ({ due_on, created_at });

test("the pinned numbers: a 270 s budget, 15 minutes to a stale claim, 3 attempts, 2 workers of 4 reads, monthly clamp 28", () => {
  assert.equal(WORKER_BUDGET_MS, 270_000);
  assert.equal(STALE_CLAIM_MS, 15 * 60 * 1000);
  assert.equal(MAX_ATTEMPTS, 3);
  assert.equal(WORKER_POOL * WORKERS_PER_PASS, 8, "at most 8 DIY DataForSEO calls in flight (spec 5.6 item 8)");
  assert.equal(MONTHLY_CLAMP, 28);
});

test("the DIY day is UTC's, whatever London's clock says", () => {
  assert.equal(diyDay(Date.parse("2026-10-12T23:30:00Z")), "2026-10-12", "00:30 on the 13th in London (BST) is still the 12th in UTC");
  assert.equal(diyDay(Date.parse("2026-10-13T03:30:00Z")), "2026-10-13");
  assert.equal(weekdayOf("2026-10-12"), 1);
  assert.equal(weekdayOf(ANCHOR), 3);
});

test("daily: every day from the anchor on, and any day with no anchor", () => {
  assert.equal(slotOn("daily", ANCHOR, "2026-10-12"), "2026-10-12");
  assert.equal(slotOn("daily", null, "2026-10-12"), "2026-10-12");
  assert.equal(slotOn("daily", "2026-10-13", "2026-10-12"), null, "a client whose tracking starts tomorrow has nothing due today");
});

test("weekly: the latest day with the start weekday, so load spreads across the week", () => {
  assert.equal(slotOn("weekly", ANCHOR, "2026-10-12"), "2026-10-07", "Monday's latest Wednesday");
  assert.equal(slotOn("weekly", ANCHOR, "2026-10-14"), "2026-10-14", "on the weekday itself, today");
  assert.equal(slotOn("weekly", ANCHOR, "2026-10-13"), "2026-10-07");
  assert.equal(slotOn("weekly", ANCHOR, ANCHOR), ANCHOR, "the start day is the first slot");
  assert.equal(slotOn("weekly", "2026-10-09", "2026-10-12"), "2026-10-09", "a Friday start, read on Monday");
  assert.equal(slotOn("weekly", "2026-10-14", "2026-10-12"), null, "not before the anchor");
  assert.equal(slotOn("weekly", null, "2026-10-12"), null, "no anchor, no weekday");
});

test("monthly: the start day of the month, clamped to 28, never before the start", () => {
  assert.equal(slotOn("monthly", ANCHOR, "2026-10-12"), "2026-10-10");
  assert.equal(slotOn("monthly", ANCHOR, "2026-10-10"), "2026-10-10");
  assert.equal(slotOn("monthly", ANCHOR, "2026-10-09"), "2026-09-10", "before this month's day, last month's");
  assert.equal(slotOn("monthly", "2026-01-31", "2026-03-01"), "2026-02-28", "a 31st start runs on the 28th, which February has");
  assert.equal(slotOn("monthly", "2026-01-31", "2026-04-29"), "2026-04-28");
  assert.equal(slotOn("monthly", "2026-01-31", "2026-02-27"), null, "28 Jan is before a 31 Jan start");
  assert.equal(slotOn("monthly", "2025-12-20", "2026-01-05"), "2025-12-20", "across the new year");
  assert.equal(slotOn("monthly", "2025-11-29", "2026-01-27"), "2025-12-28", "clamped, across the new year");
  assert.equal(slotOn("monthly", null, "2026-10-12"), null);
});

test("event kinds are never due by the calendar", () => {
  assert.equal(slotOn("event", ANCHOR, "2026-10-12"), null);
  assert.equal(dueFor(spec({ cadence: "event" }), client(), { enabled: true, today: "2026-10-12", last: null }), null);
});

test("a malformed day throws rather than reading as some other date", () => {
  assert.throws(() => slotOn("daily", ANCHOR, "12 Oct 2026"), /not a day/);
  assert.throws(() => slotOn("weekly", "2026-13-01", "2026-10-12"), /not a day/);
});

test("paid kinds wait for the switch and for setup; free kinds do not", () => {
  const paid = spec({ paid: true });
  const today = "2026-10-12";
  assert.equal(dueFor(paid, client(), { enabled: false, today, last: null }), null, "dark: no paid kind is queued");
  assert.equal(dueFor(paid, client({ setupConfirmedAt: null }), { enabled: true, today, last: null }), null, "unconfirmed: no paid kind is queued");
  assert.deepEqual(dueFor(paid, client(), { enabled: true, today, last: null }), { kind: "kind_a", due_on: today, priority: 5, onboarding: false });
  assert.deepEqual(dueFor(spec(), client({ setupConfirmedAt: null }), { enabled: false, today, last: null })?.due_on, today, "a free kind runs dark and before setup");
});

test("by the calendar: due on the latest slot once the newest row is older than it", () => {
  const weekly = spec({ cadence: "weekly" });
  const p = (l: LastJob | null) => dueFor(weekly, client(), { enabled: true, today: "2026-10-12", last: l });
  assert.deepEqual(p(last("2026-09-30")), { kind: "kind_a", due_on: "2026-10-07", priority: 5, onboarding: false }, "a missed Wednesday is queued late, dated its slot, so it is claimed first");
  assert.equal(p(last("2026-10-07")), null, "the slot's row exists - done, waiting, or out of attempts - so nothing new");
  assert.equal(p(last("2026-10-08")), null, "a row deferred past the slot covers it");
  const daily = spec();
  assert.equal(dueFor(daily, client(), { enabled: true, today: "2026-10-12", last: last("2026-10-12") }), null, "once a day");
  assert.equal(dueFor(daily, client(), { enabled: true, today: "2026-10-12", last: last("2026-10-11") })?.due_on, "2026-10-12");
});

test("a row that used its attempts stops the kind until its next due date, then the next slot is queued", () => {
  const weekly = spec({ cadence: "weekly" });
  const stuck = last("2026-10-07");
  assert.equal(dueFor(weekly, client(), { enabled: true, today: "2026-10-13", last: stuck }), null);
  assert.equal(dueFor(weekly, client(), { enabled: true, today: "2026-10-14", last: stuck })?.due_on, "2026-10-14");
});

test("onboarding: due today on the first dispatch after setup confirm, then by the calendar", () => {
  const ob = spec({ cadence: "monthly", onboarding: true, paid: true });
  const fresh = client({ startedOn: "2026-10-12", setupConfirmedAt: "2026-10-11T15:00:00Z" });
  assert.deepEqual(dueFor(ob, fresh, { enabled: true, today: "2026-10-12", last: null }), { kind: "kind_a", due_on: "2026-10-12", priority: 5, onboarding: true });
  assert.equal(dueFor(ob, fresh, { enabled: true, today: "2026-10-13", last: last("2026-10-12") }), null, "queued since the confirm, so not again; the next is 12 Nov");
  assert.equal(dueFor(ob, fresh, { enabled: true, today: "2026-11-12", last: last("2026-10-12") })?.onboarding, false);
});

test("onboarding: a client confirmed before DIY was switched on onboards on the first dispatch after it is", () => {
  const ob = spec({ cadence: "weekly", onboarding: true, paid: true });
  assert.equal(dueFor(ob, client(), { enabled: false, today: "2026-10-12", last: null }), null, "dark");
  const on = dueFor(ob, client(), { enabled: true, today: "2026-10-12", last: null });
  assert.deepEqual(on, { kind: "kind_a", due_on: "2026-10-12", priority: 5, onboarding: true }, "today, not the Wednesday slot already past");
});

test("onboarding: a free kind that ran before setup still onboards once setup is confirmed", () => {
  const ob = spec({ cadence: "weekly", onboarding: true });
  const confirmed = client({ setupConfirmedAt: "2026-10-12T10:00:00Z" });
  assert.equal(dueFor(ob, confirmed, { enabled: false, today: "2026-10-13", last: last("2026-10-07") })?.onboarding, true, "a row queued before the confirm does not count");
  assert.deepEqual(
    dueFor(ob, confirmed, { enabled: false, today: "2026-10-13", last: last("2026-10-12", "2026-10-12T03:30:00Z") }),
    { kind: "kind_a", due_on: "2026-10-13", priority: 5, onboarding: true },
    "nor does one queued earlier on the day of the confirm: the next night onboards",
  );
  assert.equal(dueFor(ob, confirmed, { enabled: false, today: "2026-10-13", last: last("2026-10-12", "2026-10-12T10:00:05Z") }), null, "enqueueOnboarding at the confirm counts");
});

test("13 Oct 2026: a row still waiting holds its kind back - a daily kind's carried row is tonight's row, not one more", () => {
  const daily = spec();
  const waiting: LastJob = { due_on: "2026-10-13", created_at: "2026-10-13T03:30:00Z", done_at: null };
  assert.equal(dueFor(daily, client(), { enabled: true, today: "2026-10-14", last: waiting }), null, "carried from a full night: no second row tonight");
  assert.equal(dueFor(daily, client(), { enabled: true, today: "2026-10-14", last: { ...waiting, done_at: "2026-10-13T03:40:00Z" } })?.due_on, "2026-10-14", "done: tonight's row");
  const weekly = spec({ cadence: "weekly" });
  assert.equal(dueFor(weekly, client(), { enabled: true, today: "2026-10-14", last: { due_on: "2026-10-07", created_at: "2026-10-07T03:30:00Z", done_at: null } }), null, "the same for every cadence");
});

test("13 Oct 2026: onboarding is read from the newest onboarding row, whatever its age, so an event kind is not onboarded twice", () => {
  const ob = spec({ cadence: "event", onboarding: true });
  const p = { enabled: true, today: "2026-12-14", last: null };
  assert.deepEqual(dueFor(ob, client(), { ...p, onboardedAt: null }), { kind: "kind_a", due_on: "2026-12-14", priority: 5, onboarding: true }, "never onboarded");
  assert.equal(dueFor(ob, client(), { ...p, onboardedAt: "2026-06-10T03:30:00Z" }), null, "onboarded in June, its row long out of the 62-day window");
  assert.equal(dueFor(ob, client(), { ...p, onboardedAt: "2026-06-01T03:30:00Z" })?.onboarding, true, "a row from before the confirm does not count");
  assert.equal(dueFor(ob, client(), { ...p, last: last("2026-10-12") }), null, "no onboardedAt: the newest row stands in, as before");
});

test("13 Oct 2026: the claim condition in SQL is claimable's - unclaimed, or claimed before the stale line, quoted", () => {
  assert.equal(unclaimedOrStale(Date.parse("2026-10-14T03:31:00Z")), 'claimed_at.is.null,claimed_at.lt."2026-10-14T03:16:00.000Z"');
});

test("only active clients have anything due, and rows come oldest slot first, then by priority", () => {
  const specs = [spec({ kind: "late", priority: 1 }), spec({ kind: "weekly_b", cadence: "weekly", priority: 9 }), spec({ kind: "early", priority: 0 })];
  const p = { enabled: true, today: "2026-10-12", last: new Map<string, LastJob>() };
  assert.deepEqual(dueJobs(specs, client({ status: "ended" }), p), []);
  assert.deepEqual(dueJobs(specs, client({ status: "paused" }), p), []);
  assert.deepEqual(dueJobs(specs, client(), p).map((d) => `${d.due_on} ${d.kind}`), ["2026-10-07 weekly_b", "2026-10-12 early", "2026-10-12 late"]);
  assert.equal(byClaimOrder({ due_on: "2026-10-12", priority: 5, kind: "b" }, { due_on: "2026-10-12", priority: 5, kind: "a" }), 1, "ties break on kind, so the order is total");
});

test("a row is claimable when due, not done, under 3 attempts, and unclaimed or claimed 15+ minutes ago", () => {
  const now = Date.parse("2026-10-13T03:40:00Z");
  const row = { due_on: "2026-10-13", claimed_at: null, done_at: null, attempts: 0 };
  assert.equal(claimable(row, "2026-10-13", now), true);
  assert.equal(claimable({ ...row, due_on: "2026-10-12" }, "2026-10-13", now), true, "a carried row");
  assert.equal(claimable({ ...row, due_on: "2026-10-14" }, "2026-10-13", now), false, "a deferred row waits for its day");
  assert.equal(claimable({ ...row, done_at: "2026-10-13T03:31:00Z" }, "2026-10-13", now), false);
  assert.equal(claimable({ ...row, attempts: 3 }, "2026-10-13", now), false);
  assert.equal(claimable({ ...row, attempts: 2, claimed_at: "2026-10-13T03:31:00Z" }, "2026-10-13", now), false, "claimed 9 minutes ago");
  assert.equal(claimable({ ...row, attempts: 2, claimed_at: "2026-10-13T03:24:00Z" }, "2026-10-13", now), true, "claimed 16 minutes ago: stale, taken again");
});

test("handlers: kinds unique and well formed, priorities fit a smallint", () => {
  assert.deepEqual(refuseHandlers([spec({ kind: "plan_refresh" }), spec({ kind: "footprint" })]), []);
  assert.equal(refuseHandlers([spec({ kind: "footprint" }), spec({ kind: "footprint" })]).length, 1);
  assert.equal(refuseHandlers([spec({ kind: "Footprint" })]).length, 1);
  assert.equal(refuseHandlers([spec({ kind: "x" })]).length, 1, "one letter is not a kind");
  assert.equal(refuseHandlers([spec({ priority: 1.5 })]).length, 1);
  assert.equal(refuseHandlers([spec({ priority: -1 })]).length, 1);
});
