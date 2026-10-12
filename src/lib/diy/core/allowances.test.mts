import assert from "node:assert/strict";
import { test } from "node:test";

import { ALLOWANCES, WON_WATCH_MONTHS, allowanceFor, allowanceMonth, room, usedUpLine } from "./allowances.ts";

/**
 * The DIY product allowances, pinned (13 Oct 2026, DIY P1 milestone M1; spec
 * 10 section 2.5). These are product gates Claude sets. Changing one is a
 * change to this table too, with the reason and the date beside it.
 */

test("the table: trial and full counts, per period, as section 2.5 sets them", () => {
  const table = Object.fromEntries(Object.entries(ALLOWANCES).map(([k, a]) => [k, [a.trial, a.full, a.period]]));
  assert.deepEqual(table, {
    page_checks: [10, 30, "month"],
    examples: [3, 10, "month"],
    link_checks: [10, 30, "month"],
    link_targets: [2, 5, "month"],
    gap_rows: [10, 25, "shown"],
    pursuits: [3, 10, "at_once"],
    key_pages: [10, 10, "at_once"],
    won_watched: [30, 30, "at_once"],
  });
  assert.equal(WON_WATCH_MONTHS, 6);
});

test("Settings' labels, and a used-up noun for every month allowance only", () => {
  assert.deepEqual(
    Object.values(ALLOWANCES).map((a) => a.label),
    ["Page checks", "Drafted examples", "Link checks", "Link targets", "Link gap rows shown", "Pursuing", "Key pages", "Won pages watched"],
  );
  for (const [k, a] of Object.entries(ALLOWANCES)) assert.equal(a.noun !== null, a.period === "month", k);
});

test("a trial client gets the trial's count; every paid tier the full one", () => {
  assert.equal(allowanceFor("page_checks", { trial: true }), 10);
  assert.equal(allowanceFor("page_checks", { trial: false }), 30);
  assert.equal(allowanceFor("link_targets", { trial: true }), 2);
  assert.equal(allowanceFor("pursuits", { trial: false }), 10);
});

test("room: what is left, never below nothing", () => {
  assert.deepEqual(room("examples", 2, { trial: false }), { limit: 10, used: 2, left: 8, out: false });
  assert.deepEqual(room("examples", 10, { trial: false }), { limit: 10, used: 10, left: 0, out: true });
  assert.deepEqual(room("examples", 12, { trial: false }), { limit: 10, used: 12, left: 0, out: true }, "concurrent requests may overshoot by one; the meter says 0 left");
  assert.deepEqual(room("examples", -1, { trial: true }), { limit: 3, used: 0, left: 3, out: false });
});

test("the month resets on the 1st in the market's own zone", () => {
  // 23:30 UTC on 31 Oct: 19:30 in New York (still October), 23:30 in London (GMT since 25 Oct, still October).
  const lateOct = Date.parse("2026-10-31T23:30:00Z");
  assert.deepEqual(allowanceMonth("US", lateOct), { start: "2026-10-01T04:00:00.000Z", resetsOn: "2026-11-01", resetsLabel: "1 Nov" });
  assert.deepEqual(allowanceMonth("UK", lateOct), { start: "2026-09-30T23:00:00.000Z", resetsOn: "2026-11-01", resetsLabel: "1 Nov" }, "1 Oct began at 23:00 UTC, under British Summer Time");
  // 00:30 UTC on 1 Nov: London has reset, New York has not.
  const earlyNov = Date.parse("2026-11-01T00:30:00Z");
  assert.equal(allowanceMonth("UK", earlyNov).start, "2026-11-01T00:00:00.000Z");
  assert.equal(allowanceMonth("UK", earlyNov).resetsOn, "2026-12-01");
  assert.equal(allowanceMonth("US", earlyNov).start, "2026-10-01T04:00:00.000Z", "20:30 on 31 Oct in New York");
  // 1 Nov 2026 is the day New York's clocks go back, at 2am: its midnight is still EDT.
  assert.equal(allowanceMonth("US", Date.parse("2026-11-01T05:00:00Z")).start, "2026-11-01T04:00:00.000Z");
  // December runs into January.
  assert.deepEqual(allowanceMonth("US", Date.parse("2026-12-15T12:00:00Z")), { start: "2026-12-01T05:00:00.000Z", resetsOn: "2027-01-01", resetsLabel: "1 Jan" });
});

test("the used-up line: counts and the reset date, never an offer, and only for a month allowance that is used", () => {
  const now = Date.parse("2026-10-12T12:00:00Z");
  const us = { trial: false, market: "US" };
  assert.equal(usedUpLine("page_checks", 30, us, now), "You've used this month's 30 page checks. They reset on 1 Nov.");
  assert.equal(usedUpLine("examples", 10, us, now), "You've used this month's 10 examples. They reset on 1 Nov.");
  assert.equal(usedUpLine("link_targets", 2, { trial: true, market: "UK" }, now), "You've used this month's 2 link targets. They reset on 1 Nov.");
  assert.equal(usedUpLine("page_checks", 29, us, now), null, "one left");
  assert.equal(usedUpLine("pursuits", 10, us, now), null, "not a month allowance");
  for (const k of Object.keys(ALLOWANCES) as (keyof typeof ALLOWANCES)[]) {
    const line = usedUpLine(k, 99, us, now);
    if (line) assert.doesNotMatch(line, /\b(buy|more|upgrade)\b|[$£€]/i, k);
  }
});
