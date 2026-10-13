import { marketZone } from "../../tracking/check-time.ts";
import { type Day, formatDay } from "../../tracking/figures.ts";

/**
 * The DIY product allowances (13 Oct 2026, DIY P1 milestone M1; spec 10
 * section 2.5). Product gates, not spend: they are Claude's to set, they live
 * in this one file, and allowances.test.mts pins every value, so a change is
 * made there too, with its reason and date. Pure.
 *
 * A month allowance resets on the 1st in the client's own zone
 * (check-time.ts marketZone): a US client's month turns at midnight in New
 * York, not London. When one is used up the copy says so and when it resets,
 * and never offers more ("buy more" is not a line anywhere).
 *
 * Placement prompts per placed client are not here: that room is
 * `PLACEMENT_PROMPTS_PER_CLIENT` in tracking/limits.ts (P2), beside the slot
 * counts it is subtracted from.
 */

export type AllowanceKey = "page_checks" | "examples" | "link_checks" | "link_targets" | "gap_rows" | "pursuits" | "key_pages" | "won_watched";

/** `month` resets on the 1st; `at_once` is a live count; `shown` is a display limit. */
export type AllowancePeriod = "month" | "at_once" | "shown";

export type Allowance = {
  /** During the alwaystracked trial. */
  trial: number;
  /** alwaystracked and the placed tiers alike. */
  full: number;
  period: AllowancePeriod;
  /** The Settings usage row's label. */
  label: string;
  /** The noun in the used-up line, for month allowances: "You've used this month's 30 page checks." */
  noun: string | null;
};

export const ALLOWANCES: Record<AllowanceKey, Allowance> = {
  /** Counted from diy_reads rows with action 'page_check', status ok or partial. */
  page_checks: { trial: 10, full: 30, period: "month", label: "Page checks", noun: "page checks" },
  /** Counted from reopt_examples rows with status 'ready'. A failed example does not count. */
  examples: { trial: 3, full: 10, period: "month", label: "Drafted examples", noun: "examples" },
  /** "Check a link" and "Verify now": diy_reads rows with action 'link_check' or 'verify'. */
  link_checks: { trial: 10, full: 30, period: "month", label: "Link checks", noun: "link checks" },
  /** Page-level link targets revealed: opportunities rows with lens 'link_page' and revealed_at in the month. */
  link_targets: { trial: 2, full: 5, period: "month", label: "Link targets", noun: "link targets" },
  /** Domain link-gap rows shown; the rest are a count. */
  gap_rows: { trial: 10, full: 25, period: "shown", label: "Link gap rows shown", noun: null },
  /** Active pursuits at once: opportunities rows in pursuing or pitched. A focus rule, Nomada practice. */
  pursuits: { trial: 3, full: 10, period: "at_once", label: "Pursuing", noun: null },
  /** Live key_pages rows. */
  key_pages: { trial: 10, full: 10, period: "at_once", label: "Key pages", noun: null },
  /** Won pages watched monthly: the most recent won opportunities, each for WON_WATCH_MONTHS after it was won. */
  won_watched: { trial: 30, full: 30, period: "at_once", label: "Won pages watched", noun: null },
};

/** A won page is watched for this many months after its status changed, then not at all. */
export const WON_WATCH_MONTHS = 6;

/** This client's allowance: the trial's while the trial runs, else the full one. */
export function allowanceFor(key: AllowanceKey, client: { trial: boolean }): number {
  const a = ALLOWANCES[key];
  return client.trial ? a.trial : a.full;
}

export type Room = { limit: number; used: number; left: number; out: boolean };

/** How much of an allowance is left. A used count past the limit leaves 0, never a negative. */
export function room(key: AllowanceKey, used: number, client: { trial: boolean }): Room {
  const limit = allowanceFor(key, client);
  const n = Math.max(0, Math.floor(used));
  return { limit, used: n, left: Math.max(0, limit - n), out: n >= limit };
}

type Zone = ReturnType<typeof marketZone>;

/** The zone's offset from UTC at instant `t`, in ms (positive east of Greenwich). */
function offsetAt(zone: Zone, t: number): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(new Date(t))
      .map((x) => [x.type, x.value]),
  );
  return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second)) - t;
}

/** The instant midnight starts the 1st of month `m0` (0-11, may run past 11 into the next year) of year `y`, in the zone. */
function firstMidnight(zone: Zone, y: number, m0: number): number {
  const wall = Date.UTC(y, m0, 1);
  // Twice: the first guess uses the offset at UTC midnight, which is the wrong side of a change of clocks that day.
  const t = wall - offsetAt(zone, wall);
  return wall - offsetAt(zone, t);
}

export type MonthWindow = {
  /** The instant this allowance month began, ISO: compare `created_at >= start`. */
  start: string;
  /** The day it resets, the 1st of next month, YYYY-MM-DD in the client's zone. */
  resetsOn: Day;
  /** That day in words: "1 Nov". */
  resetsLabel: string;
};

/** The allowance month `now` falls in, for a client in `market`. */
export function allowanceMonth(market: string, now: number): MonthWindow {
  const zone = marketZone(market);
  const local = new Date(now + offsetAt(zone, now));
  const y = local.getUTCFullYear();
  const m0 = local.getUTCMonth();
  const next = new Date(Date.UTC(y, m0 + 1, 1)).toISOString().slice(0, 10);
  return { start: new Date(firstMidnight(zone, y, m0)).toISOString(), resetsOn: next, resetsLabel: formatDay(next) };
}

/**
 * The line shown when a month allowance is used up: "You've used this
 * month's 30 page checks. They reset on 1 Nov." Null for an allowance that
 * is not monthly, or that has room. Counts only, and never an offer.
 */
export function usedUpLine(key: AllowanceKey, used: number, client: { trial: boolean; market: string }, now: number): string | null {
  const a = ALLOWANCES[key];
  if (a.period !== "month" || !a.noun) return null;
  const r = room(key, used, client);
  if (!r.out) return null;
  return `You've used this month's ${r.limit} ${a.noun}. They reset on ${allowanceMonth(client.market, now).resetsLabel}.`;
}
