import type { ReadTrigger } from "./jobs.ts";
import type { Door } from "./prices.ts";
import type { DiySettings, MonthBudgets } from "./settings.ts";

/**
 * Whether one paid read may be reserved (13 Oct 2026, DIY P1; spec 10 section
 * 5.6). Pure: the ledger gathers the facts, this decides, and caps.test.mts
 * runs every refusal path.
 *
 * The checks, in the spec's order. Any one refuses, with a code:
 *
 * 1. `diy_enabled` is true (missing reads as false);
 * 2. today's (UTC) global DataForSEO sum plus the estimate is within
 *    `diy_daily_cost_cap_usd`, or for the model door the model sum within
 *    `diy_daily_model_cap_usd` (missing reads as 0, which refuses);
 * 3. model door only: the site's model calls in the last 24 hours, plus this
 *    one, are no more than half of `anthropic_calls_per_day`, so a heavy DIY
 *    night never spends the free scan's headroom;
 * 4. this client's count today for this door and trigger is under
 *    `DOOR_DAILY` - scheduled and on-demand counted apart, so a heavy
 *    onboarding or monthly night never uses up a member's first "Check this
 *    page now" (onboarding reads count as scheduled ones);
 * 5. this client's month sum for the trigger class plus the estimate is within
 *    its budget - scheduled, on-demand or model - on the `diy_trial_*` keys
 *    while the client is in its trial;
 * 6. on-demand only: the product allowance has room (allowances.ts).
 *
 * Before any of these, `runOnDemand` refuses while a tracking run is running,
 * and the ledger refuses when it cannot be read. Neither is a cap, so neither
 * is decided here; both have their codes in `RefusalCode`.
 */

/**
 * Paid reads per door per client per day (section 5.6, census-pinned by
 * caps.test.mts). Claude's to set. The scheduled onpage count is sized from
 * the heaviest night: 40 cited-page reads + 10 instant_pages + 30 top-3
 * structure reads + up to 20 watch fallbacks = 100, under 120. On demand,
 * only page checks, link checks, verifies and logged sites (onpage) and
 * drafted examples (model) spend; every other door is 0.
 */
export const DOOR_DAILY: { scheduled: Record<Door, number>; on_demand: Record<Door, number> } = {
  scheduled: { labs: 3, backlinks: 15, onpage: 120, content: 2, model: 4 },
  on_demand: { labs: 0, backlinks: 0, onpage: 20, content: 0, model: 6 },
};

/** The three month budgets a read is counted against. */
export type MonthClass = keyof MonthBudgets;

export function monthClass(door: Door, trigger: ReadTrigger): MonthClass {
  if (door === "model") return "model";
  return trigger === "on_demand" ? "on_demand" : "scheduled";
}

/** Everything `diy_spend` answers, as the ledger reads it. */
export type DiySpend = {
  /** All DIY clients' DataForSEO reads since the UTC day began, settled or reserved. */
  globalDfsToday: number;
  /** All DIY clients' model calls since the UTC day began. */
  globalModelToday: number;
  /** This client's reads today, keyed `trigger:door` ("scheduled:onpage"). */
  doorCounts: Record<string, number>;
  /** This client's sums since its allowance month began, by class. */
  monthSums: Record<MonthClass, number>;
};

/** The codes a cap refuses with. */
export const CAP_CODES = ["disabled", "global_daily", "model_headroom", "door_daily", "month_budget", "allowance"] as const;
export type CapCode = (typeof CAP_CODES)[number];

/**
 * Every reason a paid read is refused, caps and the rest: a tracking run in
 * progress, a ledger that could not be read, a job with no time left, and the
 * fixture (which never reaches a vendor).
 */
export type RefusalCode = CapCode | "tracking_running" | "ledger_unreadable" | "deadline" | "fixture";

/** A refusal: its code, and an internal reason for the log and `diy_reads.code`. Never shown to a member as is. */
export type Refusal = { code: RefusalCode; reason: string };

export type ReserveCheck = {
  settings: DiySettings;
  door: Door;
  trigger: ReadTrigger;
  /** The read's maximum cost (prices.ts). */
  estimate: number;
  /** In the alwaystracked trial: the `diy_trial_*` budgets apply. */
  trial: boolean;
  spend: DiySpend;
  /**
   * Model door only: the site's model calls in the last 24 hours and its
   * `anthropic_calls_per_day`. Null when they could not be read, which
   * refuses. Undefined skips check 3, which only the on-demand preflight does:
   * the model call itself always passes a reading (ledger.ts paidModelCall).
   */
  modelCalls?: { last24h: number; perDay: number } | null;
  /** On-demand only: whether this action's allowance is used up. Null when it could not be read, which refuses. */
  allowance?: { out: boolean } | null;
};

const usd = (v: number) => `$${v.toFixed(2)}`;
const sum = (a: number, b: number) => Math.round((a + b) * 100_000) / 100_000;

/** Null when the read may be reserved, else the first check it fails. */
export function decideReservation(c: ReserveCheck): Refusal | null {
  // 1. The kill switch.
  if (!c.settings.enabled) return { code: "disabled", reason: "diy_enabled is off" };

  // 2. The global daily caps, UTC.
  if (c.door === "model") {
    const after = sum(c.spend.globalModelToday, c.estimate);
    if (after > c.settings.dailyModelCapUsd) {
      return { code: "global_daily", reason: `model calls today would reach ${usd(after)}, over the ${usd(c.settings.dailyModelCapUsd)} cap` };
    }
  } else {
    const after = sum(c.spend.globalDfsToday, c.estimate);
    if (after > c.settings.dailyDfsCapUsd) {
      return { code: "global_daily", reason: `DataForSEO reads today would reach ${usd(after)}, over the ${usd(c.settings.dailyDfsCapUsd)} cap` };
    }
  }

  // 3. The scan's half of the model-call ceiling.
  if (c.door === "model" && c.modelCalls !== undefined) {
    if (c.modelCalls === null) return { code: "model_headroom", reason: "the site's model calls in the last 24 hours could not be read" };
    const half = Math.floor(c.modelCalls.perDay / 2);
    if (c.modelCalls.last24h + 1 > half) {
      return { code: "model_headroom", reason: `${c.modelCalls.last24h} model calls in 24 hours; DIY stops at half of ${c.modelCalls.perDay}` };
    }
  }

  // 4. This client's count today for this door, scheduled and on-demand apart.
  const onDemand = c.trigger === "on_demand";
  const limit = (onDemand ? DOOR_DAILY.on_demand : DOOR_DAILY.scheduled)[c.door];
  const today = onDemand
    ? (c.spend.doorCounts[`on_demand:${c.door}`] ?? 0)
    : (c.spend.doorCounts[`scheduled:${c.door}`] ?? 0) + (c.spend.doorCounts[`onboarding:${c.door}`] ?? 0);
  if (today >= limit) {
    return { code: "door_daily", reason: `${today} ${onDemand ? "on-demand" : "scheduled"} ${c.door} reads today, the most is ${limit}` };
  }

  // 5. This client's month budget for the class.
  const klass = monthClass(c.door, c.trigger);
  const budget = (c.trial ? c.settings.trialMonth : c.settings.month)[klass];
  const after = sum(c.spend.monthSums[klass] ?? 0, c.estimate);
  if (after > budget) {
    return { code: "month_budget", reason: `this client's ${klass} reads this month would reach ${usd(after)}, over its ${usd(budget)}${c.trial ? " trial" : ""} budget` };
  }

  // 6. The product allowance, on demand.
  if (onDemand && c.allowance !== undefined) {
    if (c.allowance === null) return { code: "allowance", reason: "this month's allowance could not be counted" };
    if (c.allowance.out) return { code: "allowance", reason: "this month's allowance is used" };
  }
  return null;
}

/**
 * What a member is told when an on-demand action is refused (section 5.6,
 * "At a cap"). Counts and dates only: never dollars, never "buy more", and no
 * upgrade line on a budget message. `resets` is the allowance month's
 * reset label ("1 Nov"); `allowanceLine` is allowances.ts usedUpLine.
 */
export function refusalWords(code: RefusalCode, p: { resets: string; allowanceLine?: string | null }): string {
  switch (code) {
    case "tracking_running":
      return "Your daily check is running. Try again in a few minutes.";
    case "global_daily":
    case "model_headroom":
      return "Checks are paused until tomorrow. Everything else is up to date.";
    case "door_daily":
      return "That's today's limit for this check. More tomorrow.";
    case "month_budget":
      return `This month's research is used. It resets on ${p.resets}.`;
    case "allowance":
      return p.allowanceLine ?? `This month's research is used. It resets on ${p.resets}.`;
    case "disabled":
      return "This check isn't switched on yet.";
    case "ledger_unreadable":
    case "deadline":
      return "We couldn't start that check just now. Try again in a few minutes.";
    case "fixture":
      return "This is the fixture: no read was made.";
  }
}

/**
 * What a scheduled job does with a refusal (section 5.6, "At a cap"): a daily
 * cap defers it to tomorrow; a month budget or the switch skips it, and the
 * handler decides which refreshes give way; anything else failed and retries.
 */
export function jobOutcomeFor(code: RefusalCode): "deferred" | "skipped" | "failed" {
  if (code === "global_daily" || code === "model_headroom" || code === "door_daily") return "deferred";
  if (code === "month_budget" || code === "disabled") return "skipped";
  return "failed";
}
