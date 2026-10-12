import type { SupabaseClient } from "@supabase/supabase-js";

import { fixtureDiyEnabled } from "./fixture.ts";

/**
 * The DIY switch and caps, read from `app_settings` and failing closed
 * (13 Oct 2026, DIY P1; spec 10 sections 5.6 and 5.8). The rows are seeded by
 * 20261013000000_diy_core.sql: `diy_enabled` false, the caps at the proposed
 * values. Every value is Danny's to set (section 8.3 Q1).
 *
 * Fail closed, three ways:
 *
 * - a missing row reads as false or 0, and a cap of 0 refuses every read;
 * - a value of the wrong type is refused rather than coerced - `"true"` is a
 *   string in a jsonb cell and reads as off, `"10"` reads as 0 - because the
 *   row is edited by hand in the table editor, where the two look the same
 *   (the lesson settings-merge.ts records for `scans_enabled`);
 * - a read that fails throws, and every caller turns that into a refusal.
 *
 * Loadable by node --test: relative imports, the database passed in.
 */

export const DIY_SETTING_KEYS = [
  "diy_enabled",
  "diy_daily_cost_cap_usd",
  "diy_daily_model_cap_usd",
  "diy_client_month_scheduled_usd",
  "diy_client_month_ondemand_usd",
  "diy_client_month_model_usd",
  "diy_trial_month_scheduled_usd",
  "diy_trial_month_ondemand_usd",
  "diy_trial_month_model_usd",
] as const;
export type DiySettingKey = (typeof DIY_SETTING_KEYS)[number];

/** The month budgets per trigger class, for a full client or a trial one. */
export type MonthBudgets = { scheduled: number; on_demand: number; model: number };

export type DiySettings = {
  /** The kill switch. Paid kinds are queued and paid reads made only while it is true. */
  enabled: boolean;
  /** DataForSEO, all DIY clients together, per UTC day (separate from tracking's own cap). */
  dailyDfsCapUsd: number;
  /** Model calls, all DIY clients together, per UTC day. */
  dailyModelCapUsd: number;
  month: MonthBudgets;
  trialMonth: MonthBudgets;
  /** Each refused value, one line each, for the log: a hand-edited cell of the wrong type. */
  problems: string[];
};

/** Every value off or zero: what a missing table reads as. */
export const DIY_SETTINGS_CLOSED: DiySettings = {
  enabled: false,
  dailyDfsCapUsd: 0,
  dailyModelCapUsd: 0,
  month: { scheduled: 0, on_demand: 0, model: 0 },
  trialMonth: { scheduled: 0, on_demand: 0, model: 0 },
  problems: [],
};

/** A cap is a finite number from 0; anything else is 0 and a problem. The upper bound is settings-merge.ts's, for the same overflow reason. */
const CAP_MAX = 1_000_000;

/** The rows as `select key, value` answers them, parsed. Pure. */
export function parseDiySettings(rows: readonly { key: string; value: unknown }[]): DiySettings {
  const problems: string[] = [];
  const get = (k: DiySettingKey) => rows.find((r) => r.key === k)?.value;
  const flag = (k: DiySettingKey): boolean => {
    const v = get(k);
    if (v === undefined || v === null) return false;
    if (typeof v !== "boolean") {
      problems.push(`${k} is ${JSON.stringify(v)}, not true or false; read as false`);
      return false;
    }
    return v;
  };
  const cap = (k: DiySettingKey): number => {
    const v = get(k);
    if (v === undefined || v === null) return 0;
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > CAP_MAX) {
      problems.push(`${k} is ${JSON.stringify(v)}, not a number from 0 to ${CAP_MAX}; read as 0`);
      return 0;
    }
    return v;
  };
  return {
    enabled: flag("diy_enabled"),
    dailyDfsCapUsd: cap("diy_daily_cost_cap_usd"),
    dailyModelCapUsd: cap("diy_daily_model_cap_usd"),
    month: {
      scheduled: cap("diy_client_month_scheduled_usd"),
      on_demand: cap("diy_client_month_ondemand_usd"),
      model: cap("diy_client_month_model_usd"),
    },
    trialMonth: {
      scheduled: cap("diy_trial_month_scheduled_usd"),
      on_demand: cap("diy_trial_month_ondemand_usd"),
      model: cap("diy_trial_month_model_usd"),
    },
    problems,
  };
}

/**
 * The settings, or a throw. A refused value is logged once per read, so a cell
 * typed wrong shows up in the log next to the refusals it causes.
 */
export async function readDiySettings(db: SupabaseClient): Promise<DiySettings> {
  const { data, error } = await db.from("app_settings").select("key, value").in("key", [...DIY_SETTING_KEYS]);
  if (error) throw new Error(`could not read the DIY settings: ${error.message}`);
  const out = parseDiySettings((data ?? []) as { key: string; value: unknown }[]);
  for (const p of out.problems) console.warn(`[diy] settings: ${p}`);
  return out;
}

/**
 * Whether DIY is switched on, for a page deciding what to show (the dark rule,
 * section 4: a section that exists only because of a paid read is hidden while
 * this is false). The fixture answers from DIY_FIXTURE_STATE. A failed read
 * answers false and logs: hiding a paid section is the safe side of a doubt.
 */
export async function loadDiyEnabled(db: SupabaseClient | null): Promise<boolean> {
  const fixture = fixtureDiyEnabled();
  if (fixture !== null) return fixture;
  if (!db) return false;
  try {
    return (await readDiySettings(db)).enabled;
  } catch (err) {
    console.warn(`[diy] settings: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}
