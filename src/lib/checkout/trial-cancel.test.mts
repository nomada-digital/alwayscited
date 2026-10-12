import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";

import { recordTrialCancel } from "./trial-cancel.ts";
import { trialCancelPending, trialCancelledAfter } from "./webhook.ts";

/**
 * Email review H1 (12 Oct 2026): a trial cancelled outside the dashboard's
 * Cancel trial button - by email to us, which we do in Stripe, or in Stripe's
 * customer portal, set to cancel at period end - left trial_cancelled_at
 * empty, so trial_ending and trial_midpoint told that client "From then it is
 * $129 a month, charged to the card". customer.subscription.updated now
 * records it in the same column, and trial_will_end checks its own payload.
 * Nothing here reaches Stripe or Supabase.
 */

const T0 = 1_790_000_000;
const END = T0 + 5 * 86_400;
const trialing = { id: "sub_t", status: "trialing", trial_end: END, cancel_at_period_end: false, cancel_at: null };

test("a running trial is cancelled by cancel_at_period_end, or by a cancel_at no later than its end", () => {
  assert.equal(trialCancelPending(trialing), false);
  assert.equal(trialCancelPending({ ...trialing, cancel_at_period_end: true }), true, "the portal, and the dashboard's own button");
  assert.equal(trialCancelPending({ ...trialing, cancel_at: END }), true, "a scheduled cancel at the trial's end");
  assert.equal(trialCancelPending({ ...trialing, cancel_at: END - 86_400 }), true, "a scheduled cancel inside the trial");
  assert.equal(trialCancelPending({ ...trialing, cancel_at: END + 1800 }), true, "within the hour's grace");
  assert.equal(trialCancelPending({ ...trialing, cancel_at: END + 30 * 86_400 }), false, "a cancel after the first charge is a charge first");
  assert.equal(trialCancelPending({ ...trialing, status: "active", cancel_at_period_end: true }), false, "a paid plan's notice is not a trial's cancel");
});

test("what trial_cancelled_at becomes: stamped when a trial is set to end, cleared when that is taken back, else left", () => {
  const iso = new Date(T0 * 1000).toISOString();
  assert.equal(trialCancelledAfter({ ...trialing, cancel_at_period_end: true }, { cancel_at_period_end: false }, T0), iso);
  assert.equal(trialCancelledAfter({ ...trialing, cancel_at: END }, { cancel_at: null }, T0), iso);
  // Stamped even when this event is not the one that cancelled: an earlier one may have been missed.
  assert.equal(trialCancelledAfter({ ...trialing, cancel_at_period_end: true }, { items: {} }, T0), iso);
  // Renewal turned back on in the portal: the client will be charged, and the emails say so again.
  assert.equal(trialCancelledAfter(trialing, { cancel_at_period_end: true }, T0), null);
  assert.equal(trialCancelledAfter(trialing, { cancel_at: END }, T0), null);
  // Neither cancel field moved (a pack bought), or the subscription is out of its trial: left alone.
  assert.equal(trialCancelledAfter(trialing, { items: {} }, T0), undefined);
  assert.equal(trialCancelledAfter({ ...trialing, status: "active" }, { status: "trialing" }, T0), undefined);
  assert.equal(trialCancelledAfter({ ...trialing, status: "canceled", cancel_at_period_end: true }, {}, T0), undefined);
});

type Row = Record<string, unknown>;

/** update().eq().is() over rows in memory, the only chain recordTrialCancel builds. */
function fakeDb(rows: Row[], fail = false) {
  const from = (table: string) => {
    assert.equal(table, "client_domains");
    const filters: ((r: Row) => boolean)[] = [];
    let patch: Row = {};
    const b = {
      update: (p: Row) => ((patch = p), b),
      eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), b),
      is: (c: string, v: unknown) => (filters.push((r) => (r[c] ?? null) === v), b),
      then(resolve: (v: { error: { message: string } | null }) => void) {
        if (fail) return resolve({ error: { message: "refused by the test" } });
        for (const r of rows.filter((x) => filters.every((f) => f(x)))) Object.assign(r, patch);
        resolve({ error: null });
      },
    };
    return b;
  };
  return { from } as unknown as SupabaseClient;
}

test("recordTrialCancel writes the stamp only over an empty column, clears it on a take-back, and is false on a failed write", async () => {
  const dashboard = "2026-10-11T09:00:00.000Z";
  const rows: Row[] = [
    { id: "a", trial_cancelled_at: null },
    { id: "b", trial_cancelled_at: dashboard },
  ];
  const db = fakeDb(rows);
  const cancelled = { ...trialing, cancel_at_period_end: true };
  assert.equal(await recordTrialCancel(db, "a", cancelled, { cancel_at_period_end: false }, T0), true);
  assert.equal(rows[0]!.trial_cancelled_at, new Date(T0 * 1000).toISOString(), "cancelled in the portal: stamped");
  assert.equal(await recordTrialCancel(db, "b", cancelled, { cancel_at_period_end: false }, T0), true);
  assert.equal(rows[1]!.trial_cancelled_at, dashboard, "the dashboard's own stamp stands");
  assert.equal(await recordTrialCancel(db, "a", trialing, { cancel_at_period_end: true }, T0 + 60), true);
  assert.equal(rows[0]!.trial_cancelled_at, null, "renewal turned back on: cleared");
  assert.equal(await recordTrialCancel(db, "b", trialing, { items: {} }, T0), true);
  assert.equal(rows[1]!.trial_cancelled_at, dashboard, "an update that is not about cancelling leaves it");
  assert.equal(await recordTrialCancel(fakeDb([{ id: "a", trial_cancelled_at: null }], true), "a", cancelled, {}, T0), false, "Stripe retries a failed write");
});

test("census: customer.subscription.updated records the trial's cancel, and trial_will_end skips a cancelled trial", () => {
  const signup = readFileSync(new URL("./signup.ts", import.meta.url), "utf8");
  const updated = signup.slice(signup.indexOf("export async function onSubscriptionUpdated("), signup.indexOf("export async function onSubscriptionDeleted("));
  assert.ok(updated.length > 200, "onSubscriptionUpdated is gone from signup.ts");
  assert.match(updated, /if \(!\(await recordTrialCancel\(db, client\.id, sub, previous, at\)\)\) return false;/, "the cancel is not recorded, or its failure not retried");
  assert.ok(updated.indexOf("recordTrialCancel(") < updated.indexOf("return recordPayment("), "recorded before the payment step, which can end the client");
  const willEnd = signup.slice(signup.indexOf("export async function onTrialWillEnd("));
  assert.match(willEnd, /if \(!trialStillRunning\(sub\) \|\| trialCancelPending\(sub\)\) return true;/, "trial_will_end would mail a cancelled trial");
  // The sweep reads only clients with no stamp, so the column is the whole of its rule.
  const sweep = readFileSync(new URL("../email/lifecycle-sweep.ts", import.meta.url), "utf8");
  assert.match(sweep, /\.not\("trial_ends_at", "is", null\)\s*\.is\("trial_cancelled_at", null\)/, "the trial sweep no longer skips a cancelled trial");
});
