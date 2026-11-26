import assert from "node:assert/strict";
import test from "node:test";

import { copilotView } from "./copilot.ts";

test("a snapshot in the hub's shape is read", () => {
  const v = copilotView({ asOf: "2026-11-23", firstDay: "2026-05-25", total: 501, pct: -60, days: [["2026-11-22", 3, 2], ["2026-11-23", 5, 3]], pages: { from: "2026-05-25", to: "2026-11-23", n: 45, top: [["https://a.test/", 9]] } });
  assert.equal(v?.total, 501);
  assert.equal(v?.pct, -60);
  assert.deepEqual(v?.days, [{ day: "2026-11-22", c: 3 }, { day: "2026-11-23", c: 5 }]);
  assert.equal(v?.pages?.top[0]?.c, 9);
});

test("no data reads as null, so the card shows its empty state", () => {
  assert.equal(copilotView(null), null);
  assert.equal(copilotView({}), null);
  assert.equal(copilotView({ asOf: "2026-11-23", total: 0 }), null);
  assert.equal(copilotView("nope"), null);
});

test("malformed rows are dropped, not thrown", () => {
  const v = copilotView({ asOf: "2026-11-23", total: 4, pct: "x", days: [["bad", 1], ["2026-11-23", "y"], ["2026-11-23", 4]], pages: { from: "2026-05-25", to: "2026-11-23", top: [[1, 2]] } });
  assert.deepEqual(v?.days, [{ day: "2026-11-23", c: 4 }]);
  assert.equal(v?.pct, null);
  assert.equal(v?.pages, null);
});
