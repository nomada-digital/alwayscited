import assert from "node:assert/strict";
import test from "node:test";

import { CONSOLE_FALLBACK_MIN_IMPRESSIONS, consoleFallback } from "./console-fallback.ts";

test("Search Console stands in only when the live read is doubtful and the figure has enough impressions behind it", () => {
  const gsc = { pos: 58.4, impr: 87 };
  assert.equal(consoleFallback({ pos: null, read: true, gsc }), 58);
  assert.equal(consoleFallback({ pos: 12, read: true, gsc }), null, "a live read that stands is shown as it is");
  assert.equal(consoleFallback({ pos: 12, read: true, varies: true, gsc }), 58, "sources that disagree: Search Console, labelled");
  assert.equal(consoleFallback({ pos: null, read: false, gsc }), 58);
  assert.equal(consoleFallback({ pos: null, read: true, gsc: { pos: 84, impr: 1 } }), null, "84 from a single impression is not shown (Common, yorkshire)");
  assert.equal(consoleFallback({ pos: null, read: true, gsc: { pos: 84, impr: CONSOLE_FALLBACK_MIN_IMPRESSIONS } }), 84);
  assert.equal(consoleFallback({ pos: null, read: true, gsc: null }), null);
});
