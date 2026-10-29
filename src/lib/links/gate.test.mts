import assert from "node:assert/strict";
import { test } from "node:test";

import { showsInsertions, showsPlacements } from "./gate.ts";

test("placements from alwaysmentioned up, insertions from the alwayscited plan up, nothing on alwaystracked", () => {
  assert.deepEqual(["tracked", "mentioned", "cited", "everywhere"].map(showsPlacements), [false, true, true, true]);
  assert.deepEqual(["tracked", "mentioned", "cited", "everywhere"].map(showsInsertions), [false, false, true, true]);
});
