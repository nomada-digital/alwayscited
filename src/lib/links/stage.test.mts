import assert from "node:assert/strict";
import { test } from "node:test";

import { stageOf, stageOfStatus } from "./stage.ts";

test("our state wins over the sheet's free-text status (26 Nov 2026)", () => {
  assert.equal(stageOf({ state: "live", status: "Submitted" }), "live");
  assert.equal(stageOf({ state: "live", status: null }), "live");
  assert.equal(stageOf({ state: "removed", status: "Live" }), "off");
  assert.equal(stageOf({ state: "in_review", status: "Live" }), "progress");
  assert.equal(stageOf({ state: "in_progress", status: "Live" }), "progress");
});

test("with no state the sheet's status decides, as it did before", () => {
  assert.equal(stageOf({ state: null, status: "Live" }), "live");
  assert.equal(stageOf({ status: "Published" }), "live");
  assert.equal(stageOf({ state: null, status: "Submitted" }), "progress");
  assert.equal(stageOf({ state: null, status: "Declined by publisher" }), "off");
  assert.equal(stageOf({ state: null, status: null }), null);
  assert.equal(stageOfStatus("outreach"), "progress");
});
