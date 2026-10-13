import assert from "node:assert/strict";
import { test } from "node:test";

import { pickRow, rowCopy } from "../../tracking/upgrade-prompts.ts";

import { stalledOpportunities } from "./stalled.ts";

/** U4's gatherer (13 Oct 2026, DIY P9; spec 10 section 2.7): three or more opportunity items in Doing, unchanged for 21 days. */

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const item = (over: Record<string, unknown>) => ({ kind: "get_onto_page", status: "doing", statusAt: "2026-09-20T10:00:00Z", refTable: "opportunities", refId: id(1), ...over }) as Parameters<typeof stalledOpportunities>[0][number];

test("three opportunity items in Doing for 21 days or more fire; since is the latest of their days", () => {
  const s = stalledOpportunities([item({ refId: id(1) }), item({ refId: id(2), statusAt: "2026-09-22T09:00:00Z" }), item({ kind: "answer_thread", refId: id(3), statusAt: "2026-09-21T09:00:00Z" })], "2026-10-13");
  assert.deepEqual(s, { items: 3, since: "2026-09-22", ids: [id(1), id(2), id(3)] });
});

test("not for fewer than three, a younger one, another status, or a page item", () => {
  const today = "2026-10-13";
  assert.equal(stalledOpportunities([item({}), item({ refId: id(2) })], today), null);
  assert.equal(stalledOpportunities([item({}), item({ refId: id(2) }), item({ refId: id(3), statusAt: "2026-09-23T09:00:00Z" })], today), null, "22 Sep is the last day 21 days back from 13 Oct");
  assert.equal(stalledOpportunities([item({}), item({ refId: id(2) }), item({ refId: id(3), status: "todo" })], today), null);
  assert.equal(stalledOpportunities([item({}), item({ refId: id(2) }), item({ kind: "add_schema", refTable: "key_pages", refId: "kp-1" })], today), null);
});

test("the fact drives P4's U4 row and copy, unchanged", () => {
  const stalled = stalledOpportunities([item({ refId: id(1) }), item({ refId: id(2) }), item({ refId: id(3) })], "2026-10-13")!;
  const facts = { tier: "tracked" as const, mode: "nomada" as const, state: "ok" as const, startedOn: "2026-08-01", today: "2026-10-13", hidden: new Set<never>(), stalled };
  assert.equal(pickRow(facts), "U4");
  const copy = rowCopy("U4", facts)!;
  assert.equal(copy.title, "3 items have been in Doing for 3 weeks");
  assert.equal(copy.why, "Shown because 3 opportunity items have been in Doing since 20 Sep with no change.");
  assert.equal(pickRow({ ...facts, tier: "mentioned" }), null, "none for a tier already held");
});
