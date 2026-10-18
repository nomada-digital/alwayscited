import assert from "node:assert/strict";
import { test } from "node:test";

import { RETENTION_DAYS, keptUntil, purgeDue } from "./retention.ts";

test("data is kept for 90 days after the plan ends (Danny, 18 Oct 2026)", () => {
  assert.equal(RETENTION_DAYS, 90);
  assert.equal(keptUntil("2026-10-18T14:00:00Z"), "2027-01-16");
  assert.equal(keptUntil(null), null);
  assert.equal(keptUntil("not a date"), null);
});

test("the purge is due only the day after the last kept day, and only for an ended client", () => {
  const ended = { status: "ended", ended_at: "2026-10-18T14:00:00Z" };
  assert.ok(!purgeDue(ended, Date.parse("2027-01-16T23:59:00Z")), "the last kept day is still kept");
  assert.ok(purgeDue(ended, Date.parse("2027-01-17T00:00:00Z")));
  assert.ok(!purgeDue({ status: "active", ended_at: "2026-01-01T00:00:00Z" }, Date.parse("2027-06-01T00:00:00Z")), "an active client is never purged");
  assert.ok(!purgeDue({ status: "ended", ended_at: null }, Date.parse("2030-01-01T00:00:00Z")), "an end we do not know is never purged");
});
