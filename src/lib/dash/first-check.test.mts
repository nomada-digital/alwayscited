import assert from "node:assert/strict";
import { test } from "node:test";

import { firstCheckLine } from "./first-check.ts";

// 18 Oct 2026, 14:30 UTC: the reset's comped profiles start 19 Oct; the check runs 05:00 UTC.
const NOW = Date.UTC(2026, 9, 18, 14, 30);

test("day zero: the first check is named in the client's zone, tomorrow when the start day is tomorrow", () => {
  assert.equal(
    firstCheckLine({ market: "US", started_on: "2026-10-19" }, { hasRun: false, tracking: true }, NOW),
    "No readings yet. The first check runs tomorrow at 1:00am ET; AI answers and Google positions show here after it.",
  );
  assert.match(firstCheckLine({ market: "UK", started_on: "2026-10-19" }, { hasRun: false, tracking: true }, NOW) ?? "", /runs tomorrow at 06:00 UK time/);
});

test("day zero: a later start day is waited for, by date", () => {
  assert.match(firstCheckLine({ market: "UK", started_on: "2026-10-22" }, { hasRun: false, tracking: true }, NOW) ?? "", /runs on 22 Oct at 06:00 UK time/);
});

test("day zero: nothing once there is a reading, and nothing promised while no prompt is tracked", () => {
  assert.equal(firstCheckLine({ market: "US", started_on: "2026-10-19" }, { hasRun: true, tracking: true }, NOW), null);
  assert.equal(firstCheckLine({ market: "US", started_on: "2026-10-19" }, { hasRun: false, tracking: false }, NOW), null);
});
