import assert from "node:assert/strict";
import { test } from "node:test";

import { refuseHandlers } from "./core/jobs.ts";
import { CANDIDATE_SOURCES, JOB_HANDLERS } from "./wiring.ts";

/**
 * The DIY registry as wave 2 leaves it (13 Oct 2026, DIY P5 for wave 1; DIY
 * P9 for wave 2; spec 10 sections 5.7, 6.1, 7.6 and 7.10). The shell's wiring
 * test: JOB_HANDLERS passes the rule the dispatcher refuses a badly wired list
 * by (jobs.ts refuseHandlers), and the recorded facts of what runs each night
 * are held here, so a registration that moves them moves this file with its
 * reason and date.
 */

test("JOB_HANDLERS passes refuseHandlers, so the dispatcher queues it", () => {
  assert.deepEqual(refuseHandlers(JOB_HANDLERS), []);
});

/**
 * 13 Oct 2026, DIY P5: wave 1 ran one job, plan_refresh (P3), free and daily.
 * 13 Oct 2026, DIY P9: the fact moved - wave 2's seven join it, with the
 * cadence, priority and onboarding flag each package built (spec 10 section
 * 5.7's job kinds table). `watch` is registered daily and picks what is due
 * itself (pursuing and pitched weekly, won monthly), and free: it reads with
 * our own fetch only, so a page it cannot read waits for the next due day.
 */
test("wave 2 runs eight jobs: their kinds, paid or free, cadence, priority and onboarding", () => {
  assert.deepEqual(
    JOB_HANDLERS.map((h) => ({ kind: h.kind, paid: h.paid, cadence: h.cadence, priority: h.priority, onboarding: h.onboarding })),
    [
      { kind: "plan_refresh", paid: false, cadence: "daily", priority: 1, onboarding: false },
      { kind: "footprint", paid: true, cadence: "weekly", priority: 0, onboarding: true },
      { kind: "opportunity_refresh", paid: false, cadence: "daily", priority: 3, onboarding: false },
      { kind: "page_reads", paid: true, cadence: "daily", priority: 4, onboarding: true },
      { kind: "classify", paid: true, cadence: "daily", priority: 6, onboarding: false },
      { kind: "watch", paid: false, cadence: "daily", priority: 5, onboarding: false },
      { kind: "key_pages_weekly", paid: false, cadence: "weekly", priority: 3, onboarding: true },
      { kind: "key_pages_monthly", paid: true, cadence: "monthly", priority: 6, onboarding: true },
    ],
  );
  for (const h of JOB_HANDLERS) assert.equal(typeof h.run, "function", `${h.kind} has no run`);
});

/**
 * 13 Oct 2026, DIY P5: no paid job in wave 1. 13 Oct 2026, DIY P9: the fact
 * moved - wave 2 registers its four paid kinds. Each is queued only for a
 * confirmed client while diy_enabled is on (dispatch.ts), and each read goes
 * through P1's doors and the ledger (spend-gates.test.mts).
 */
test("the paid kinds are exactly wave 2's four: footprint, page_reads, classify, key_pages_monthly", () => {
  assert.deepEqual(
    JOB_HANDLERS.filter((h) => h.paid).map((h) => h.kind),
    ["footprint", "page_reads", "classify", "key_pages_monthly"],
  );
});

/** 13 Oct 2026, DIY P9 (spec 10 section 6.1): tracking + keywords + opportunities + pages, in that order. */
test("the Plan's candidates come from the four wave 2 sources, in the spec's order", () => {
  assert.deepEqual(
    CANDIDATE_SOURCES.map((s) => s.name),
    ["tracking", "keywords", "opportunities", "pages"],
  );
  for (const s of CANDIDATE_SOURCES) assert.equal(typeof s.gather, "function", `${s.name} has no gather`);
  assert.equal(new Set(CANDIDATE_SOURCES.map((s) => s.name)).size, CANDIDATE_SOURCES.length, "a candidate source is registered twice");
});

test("the rule still refuses what it is for: a kind registered twice", () => {
  assert.match(refuseHandlers([...JOB_HANDLERS, ...JOB_HANDLERS]).join(), /registered twice/);
});
