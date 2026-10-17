import assert from "node:assert/strict";
import { test } from "node:test";

import { type DiySpend, type ReserveCheck, DOOR_DAILY, decideReservation, jobOutcomeFor, monthClass, refusalWords } from "./caps.ts";
import { DIY_SETTINGS_CLOSED, parseDiySettings } from "./settings.ts";
import { settingsRows } from "./fake-diy.mts";

/**
 * Every refusal path of the DIY reservation check (13 Oct 2026, DIY P1; spec
 * 10 section 5.6), and the per-door daily counts it holds, pinned.
 */

const ON = parseDiySettings(settingsRows() as { key: string; value: unknown }[]);
const NOTHING: DiySpend = { globalDfsToday: 0, globalModelToday: 0, doorCounts: {}, monthSums: { scheduled: 0, on_demand: 0, model: 0 } };

const check = (over: Partial<ReserveCheck> = {}): ReserveCheck => ({
  settings: ON,
  door: "labs",
  trigger: "scheduled",
  estimate: 0.132,
  trial: false,
  spend: NOTHING,
  ...over,
});

test("DOOR_DAILY is the spec's table: scheduled and on-demand counted apart", () => {
  assert.deepEqual(DOOR_DAILY, {
    scheduled: { labs: 3, backlinks: 15, onpage: 120, content: 2, model: 4 },
    // 17 Oct 2026: labs 0 -> 30 on demand, the dashboards host's keyword research (lib/dash/research.ts).
    on_demand: { labs: 30, backlinks: 0, onpage: 20, content: 0, model: 6 },
  });
  // The heaviest night's onpage reads, sized in the spec: 40 + 10 + 30 + 20 = 100, under 120.
  assert.ok(40 + 10 + 30 + 20 < DOOR_DAILY.scheduled.onpage);
});

test("a read with room passes every check", () => {
  assert.equal(decideReservation(check()), null);
});

test("1. the kill switch: off, and missing, both refuse", () => {
  assert.equal(decideReservation(check({ settings: { ...ON, enabled: false } }))?.code, "disabled");
  assert.equal(decideReservation(check({ settings: DIY_SETTINGS_CLOSED }))?.code, "disabled");
  const typedWrong = parseDiySettings(settingsRows({ diy_enabled: "true" }) as { key: string; value: unknown }[]);
  assert.equal(typedWrong.enabled, false, '"true" as a string reads as off');
  assert.equal(typedWrong.problems.length, 1);
});

test("missing settings read as 0, which refuses at the first cap", () => {
  const noCaps = parseDiySettings([{ key: "diy_enabled", value: true }]);
  assert.equal(noCaps.dailyDfsCapUsd, 0);
  assert.equal(decideReservation(check({ settings: noCaps }))?.code, "global_daily");
  const stringCap = parseDiySettings(settingsRows({ diy_daily_cost_cap_usd: "10" }) as { key: string; value: unknown }[]);
  assert.equal(stringCap.dailyDfsCapUsd, 0, '"10" is refused, not coerced');
});

test("2. the global daily cap: DataForSEO and model counted apart, the estimate included", () => {
  assert.equal(decideReservation(check({ spend: { ...NOTHING, globalDfsToday: 9.868 } })), null, "9.868 + 0.132 = 10 is within the cap");
  assert.equal(decideReservation(check({ spend: { ...NOTHING, globalDfsToday: 9.9 } }))?.code, "global_daily");
  assert.equal(decideReservation(check({ door: "model", estimate: 0.36, spend: { ...NOTHING, globalDfsToday: 50 }, modelCalls: { last24h: 0, perDay: 2500 } })), null, "DataForSEO spend does not touch the model cap");
  assert.equal(decideReservation(check({ door: "model", estimate: 0.36, spend: { ...NOTHING, globalModelToday: 4.8 }, modelCalls: { last24h: 0, perDay: 2500 } }))?.code, "global_daily");
});

test("3. the model door keeps half the scan's call ceiling, and an unread count refuses", () => {
  const model = (last24h: number | null) =>
    decideReservation(check({ door: "model", estimate: 0.36, modelCalls: last24h === null ? null : { last24h, perDay: 2500 } }));
  assert.equal(model(1249), null, "1249 + 1 is half of 2500: no more than half");
  assert.equal(model(1250)?.code, "model_headroom", "1250 + 1 is more than half");
  assert.equal(model(null)?.code, "model_headroom");
  assert.equal(decideReservation(check({ door: "labs", modelCalls: null })), null, "not a model read: not checked");
});

test("4. door daily: scheduled and onboarding share the scheduled count; on-demand has its own", () => {
  const spend = (counts: Record<string, number>): DiySpend => ({ ...NOTHING, doorCounts: counts });
  assert.equal(decideReservation(check({ spend: spend({ "scheduled:labs": 2 }) })), null);
  assert.equal(decideReservation(check({ spend: spend({ "scheduled:labs": 3 }) }))?.code, "door_daily");
  assert.equal(decideReservation(check({ spend: spend({ "scheduled:labs": 1, "onboarding:labs": 2 }) }))?.code, "door_daily", "an onboarding night counts as a scheduled one");
  const heavyNight = spend({ "scheduled:onpage": 120 });
  assert.equal(decideReservation(check({ door: "onpage", estimate: 0.0015, spend: heavyNight }))?.code, "door_daily");
  assert.equal(
    decideReservation(check({ door: "onpage", trigger: "on_demand", estimate: 0.0015, spend: heavyNight, allowance: { out: false } })),
    null,
    "a heavy night never uses up a member's first Check this page now",
  );
  assert.equal(decideReservation(check({ door: "onpage", trigger: "on_demand", estimate: 0.0015, spend: spend({ "on_demand:onpage": 20 }) }))?.code, "door_daily");
  // 17 Oct 2026: on-demand Labs reads are keyword research, 30 a client a day; the 31st is refused.
  assert.equal(decideReservation(check({ door: "labs", trigger: "on_demand", allowance: { out: false }, spend: spend({ "on_demand:labs": 29 }) })), null, "the 30th search of the day goes");
  assert.equal(decideReservation(check({ door: "labs", trigger: "on_demand", allowance: { out: false }, spend: spend({ "on_demand:labs": 30 }) }))?.code, "door_daily", "the 31st is refused");
});

test("5. the month budgets by trigger class, on the trial keys in the trial", () => {
  const month = (sums: Partial<DiySpend["monthSums"]>): DiySpend => ({ ...NOTHING, monthSums: { scheduled: 0, on_demand: 0, model: 0, ...sums } });
  assert.equal(decideReservation(check({ spend: month({ scheduled: 2.4 }) }))?.code, "month_budget");
  assert.equal(decideReservation(check({ spend: month({ on_demand: 2.99, model: 1.99 }) })), null, "other classes do not count against scheduled");
  assert.equal(decideReservation(check({ trial: true, spend: month({ scheduled: 0.9 }) }))?.code, "month_budget", "a trial client's scheduled budget is $1");
  assert.equal(decideReservation(check({ trial: false, spend: month({ scheduled: 0.9 }) })), null);
  const onDemand = check({ door: "onpage", trigger: "on_demand", estimate: 0.0015, allowance: { out: false } });
  assert.equal(decideReservation({ ...onDemand, spend: month({ on_demand: 3 }) })?.code, "month_budget");
  const model = check({ door: "model", estimate: 0.36, modelCalls: { last24h: 0, perDay: 2500 } });
  assert.equal(decideReservation({ ...model, spend: month({ model: 1.7 }) })?.code, "month_budget");
  assert.equal(decideReservation({ ...model, trial: true, spend: month({ model: 0.7 }) })?.code, "month_budget");
  assert.equal(monthClass("model", "on_demand"), "model");
  assert.equal(monthClass("onpage", "onboarding"), "scheduled");
});

test("6. the product allowance, on demand only, and an uncounted one refuses", () => {
  const onDemand = check({ door: "onpage", trigger: "on_demand", estimate: 0.0015 });
  assert.equal(decideReservation({ ...onDemand, allowance: { out: true } })?.code, "allowance");
  assert.equal(decideReservation({ ...onDemand, allowance: null })?.code, "allowance");
  assert.equal(decideReservation({ ...onDemand, allowance: { out: false } }), null);
  assert.equal(decideReservation({ ...check(), allowance: { out: true } }), null, "a scheduled read has no allowance");
});

test("the checks run in the spec's order: the first failing one is the code", () => {
  const everything: ReserveCheck = check({
    settings: { ...ON, enabled: false },
    spend: { globalDfsToday: 100, globalModelToday: 100, doorCounts: { "scheduled:labs": 9 }, monthSums: { scheduled: 9, on_demand: 9, model: 9 } },
  });
  assert.equal(decideReservation(everything)?.code, "disabled");
  assert.equal(decideReservation({ ...everything, settings: ON })?.code, "global_daily");
  assert.equal(decideReservation({ ...everything, settings: ON, spend: { ...everything.spend, globalDfsToday: 0 } })?.code, "door_daily");
});

test("the words a member sees: counts and dates, never dollars, never an offer", () => {
  const p = { resets: "1 Nov", allowanceLine: "You've used this month's 30 page checks. They reset on 1 Nov." };
  assert.equal(refusalWords("tracking_running", p), "Your daily check is running. Try again in a few minutes.");
  assert.equal(refusalWords("global_daily", p), "Checks are paused until tomorrow. Everything else is up to date.");
  assert.equal(refusalWords("model_headroom", p), "Checks are paused until tomorrow. Everything else is up to date.");
  assert.equal(refusalWords("door_daily", p), "That's today's limit for this check. More tomorrow.");
  assert.equal(refusalWords("month_budget", p), "This month's research is used. It resets on 1 Nov.");
  assert.equal(refusalWords("allowance", p), p.allowanceLine);
  assert.equal(refusalWords("client_inactive", p), "Checks are off while this account isn't active.");
  for (const code of ["tracking_running", "global_daily", "model_headroom", "door_daily", "month_budget", "allowance", "disabled", "ledger_unreadable", "deadline", "fixture", "client_inactive"] as const) {
    const words = refusalWords(code, p);
    assert.doesNotMatch(words, /[$£€]\s?\d|buy|upgrade|more (rows|checks)/i, `${code}: ${words}`);
  }
});

test("a job defers on a daily cap, skips on a month budget or the switch, and fails on the rest", () => {
  assert.equal(jobOutcomeFor("global_daily"), "deferred");
  assert.equal(jobOutcomeFor("model_headroom"), "deferred");
  assert.equal(jobOutcomeFor("door_daily"), "deferred");
  assert.equal(jobOutcomeFor("month_budget"), "skipped");
  assert.equal(jobOutcomeFor("disabled"), "skipped");
  assert.equal(jobOutcomeFor("client_inactive"), "skipped");
  assert.equal(jobOutcomeFor("ledger_unreadable"), "failed");
});
