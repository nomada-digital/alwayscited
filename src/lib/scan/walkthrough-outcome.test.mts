import assert from "node:assert/strict";
import { test } from "node:test";

import { readWalkthroughOutcome, refusedOutcome, walkthroughBack } from "./walkthrough-outcome.ts";

// 13 Oct 2026: eight words, not four - "personal" (the work-email refusal) was
// already read and not listed here, and name, category and market joined when
// Danny made the three required.
test("the walkthrough outcome is one of eight words, else nothing", () => {
  for (const w of ["video", "demo", "bad", "personal", "name", "category", "market", "failed"]) assert.equal(readWalkthroughOutcome(w), w);
  for (const w of [undefined, "", "sent", "VIDEO", ["video"], "constructor", "toString"]) assert.equal(readWalkthroughOutcome(w), null);
});

test("a route refusal comes back as the word for its field, anything else as failed", () => {
  assert.equal(refusedOutcome("bad_email"), "bad");
  assert.equal(refusedOutcome("personal_email"), "personal");
  assert.equal(refusedOutcome("bad_name"), "name");
  assert.equal(refusedOutcome("bad_category"), "category");
  assert.equal(refusedOutcome("bad_market"), "market");
  for (const e of [undefined, "", "write_failed", "read_failed", "not_found", "constructor", "__proto__"]) assert.equal(refusedOutcome(e), "failed", String(e));
});

test("a walkthrough form post goes back only to a scan or a reading on this site", () => {
  assert.equal(walkthroughBack("/coverage-check/abc_DEF-123", "t1"), "/coverage-check/abc_DEF-123");
  assert.equal(walkthroughBack("/scan/0123abcd", "t1"), "/scan/0123abcd");
  for (const bad of [undefined, "", "//evil.example/scan/x", "https://evil.example/scan/x", "/scan/x?y=1", "/scan/../app", "/app/acme", "/scan/" + "a".repeat(81)]) {
    assert.equal(walkthroughBack(bad, "t1"), "/scan/t1", String(bad));
  }
});
