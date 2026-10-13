import assert from "node:assert/strict";
import { test } from "node:test";

import { refuseHandlers } from "./core/jobs.ts";
import { CANDIDATE_SOURCES, JOB_HANDLERS } from "./wiring.ts";

/**
 * The DIY registry as wave 1 leaves it (13 Oct 2026, DIY P5; spec 10 sections
 * 5.7, 6.1 and 7.6). The shell's wiring test: JOB_HANDLERS passes the rule the
 * dispatcher refuses a badly wired list by (jobs.ts refuseHandlers), and the
 * recorded facts of what runs each night are held here, so a registration
 * that moves them moves this file with its reason and date.
 */

test("JOB_HANDLERS passes refuseHandlers, so the dispatcher queues it", () => {
  assert.deepEqual(refuseHandlers(JOB_HANDLERS), []);
});

test("wave 1 runs one job, plan_refresh: free and daily (P3)", () => {
  assert.deepEqual(
    JOB_HANDLERS.map((h) => ({ kind: h.kind, paid: h.paid, cadence: h.cadence, onboarding: h.onboarding })),
    [{ kind: "plan_refresh", paid: false, cadence: "daily", onboarding: false }],
  );
});

test("no paid job is registered in wave 1: the paid rails are dark until wave 2 registers its kinds", () => {
  assert.deepEqual(
    JOB_HANDLERS.filter((h) => h.paid).map((h) => h.kind),
    [],
  );
});

test("the Plan's candidates come from the tracking data alone in wave 1", () => {
  assert.deepEqual(
    CANDIDATE_SOURCES.map((s) => s.name),
    ["tracking"],
  );
  for (const s of CANDIDATE_SOURCES) assert.equal(typeof s.gather, "function", `${s.name} has no gather`);
});

test("the rule still refuses what it is for: a kind registered twice", () => {
  assert.match(refuseHandlers([...JOB_HANDLERS, ...JOB_HANDLERS]).join(), /registered twice/);
});
