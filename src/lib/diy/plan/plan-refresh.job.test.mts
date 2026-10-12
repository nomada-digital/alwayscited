import assert from "node:assert/strict";
import { test } from "node:test";

import { fakeDb } from "../../tracking/fake-db.mts";
import { fixtureDiyClient } from "../core/client.ts";
import { type JobContext, dueFor, refuseHandlers } from "../core/jobs.ts";
import { PLAN_REFRESH, planRefreshHandler } from "./plan-refresh.job.ts";
import { trackingCandidates } from "./tracking-candidates.ts";
import type { Candidate, CandidateSource } from "./types.ts";

const client = fixtureDiyClient({ id: "me", slug: "tallyroo", brand: "Tallyroo", domain: "tallyroo.com", market: "US", tier: "tracked", started_on: "2026-06-10", question_limit: 50, keyword_limit: 10, cluster_limit: 10 }, { setupConfirmed: true }, Date.parse("2026-10-12T03:31:00Z"));
const cand = (key: string, severity: Candidate["severity"] = "slipping"): Candidate => ({ dedupeKey: key, kind: "recover_prompt", severity, clusterId: null, title: `Do ${key}`, why: [{ text: "fact" }], grade: "your_data", effort: "hour", href: "/clusters" });
const source = (name: string, out: Candidate[] | Error): CandidateSource => ({ name, gather: async () => (out instanceof Error ? Promise.reject(out) : out) });
const ctx = (db: JobContext["db"], today = "2026-10-12"): JobContext => ({ db, client, today, deadlineMs: Date.now() + 60_000, onboarding: false });

test("plan_refresh is free, daily, a well-formed kind, and due every day for every active client whatever diy_enabled says", () => {
  const h = planRefreshHandler([trackingCandidates]);
  assert.equal(h.kind, PLAN_REFRESH);
  assert.equal(h.paid, false);
  assert.equal(h.cadence, "daily");
  assert.deepEqual(refuseHandlers([h]), []);
  assert.deepEqual(dueFor(h, client, { enabled: false, today: "2026-10-12", last: null }), { kind: "plan_refresh", due_on: "2026-10-12", priority: h.priority, onboarding: false });
});

test("a run gathers every source, writes the suggestions and pins the week, and says what it did", async () => {
  const { db, tables } = fakeDb({ plan_items: [] });
  const h = planRefreshHandler([source("a", [cand("s1"), cand("b1", "blocking")]), source("b", [cand("g1", "gap")])]);
  const r = await h.run(ctx(db));
  assert.deepEqual(r, { outcome: "ok", note: "3 new; 0 no longer applying; 3 pinned for the week" });
  assert.equal(tables.plan_items!.length, 3);
  assert.ok(tables.plan_items!.every((row) => row.client_domain_id === "me" && row.week_of === "2026-10-12"));
});

test("a source that throws is named and the rest still count; nothing is dropped as stale that night", async () => {
  const { db, tables } = fakeDb({ plan_items: [{ id: "x", client_domain_id: "me", kind: "recover_prompt", severity: "slipping", status: "suggested", title: "t", dedupe_key: "old", created_by: "system", missed: 1, missed_on: "2026-10-11", week_of: "2026-10-12" }] });
  const warn = console.warn;
  console.warn = () => {};
  try {
    const r = await planRefreshHandler([source("tracking", new Error("could not read the answers")), source("b", [cand("g1", "gap")])]).run(ctx(db));
    assert.equal(r.outcome, "ok");
    assert.match(r.note!, /sources failed: tracking \(nothing counted as gone\)/);
  } finally {
    console.warn = warn;
  }
  assert.equal(tables.plan_items!.find((row) => row.id === "x")!.status, "suggested", "not dropped while a source could not answer");
});

test("every source failing fails the job; a failed read of the items throws, never swallowed", async () => {
  const { db } = fakeDb({ plan_items: [] });
  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.equal((await planRefreshHandler([source("tracking", new Error("down"))]).run(ctx(db))).outcome, "failed");
  } finally {
    console.warn = warn;
  }
  const broken = { from: () => ({ select: () => ({ eq: () => ({ order: () => ({ order: () => ({ range: () => Promise.resolve({ data: null, error: { message: "relation \"plan_items\" does not exist" } }) }) }) }) }) }) } as unknown as JobContext["db"];
  await assert.rejects(planRefreshHandler([source("a", [])]).run(ctx(broken)), /plan_items/);
});
