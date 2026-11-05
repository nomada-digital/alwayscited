/**
 * The placement shortlist's bounds (phase 1, 5 Nov 2026). Fatgrid bills in units - one per domain returned - on its
 * Free and Pro plans, and which plan Nomada is on is not confirmed yet, so every read is capped low by default and
 * the cap is raised in the environment once it is: FATGRID_UNIT_CAP per shortlist run, FATGRID_DAILY_UNIT_CAP across
 * all runs in a UTC day. An unparseable or non-positive value falls back to the default, never to "no cap".
 */
export const FATGRID_DEFAULTS = { unitCapPerRun: 50, dailyUnitCap: 200 } as const;

/** The DR floor when the SERP gives too little to set one: Nomada's general-inventory floor (fatgrid skill). */
export const DEFAULT_DR_FLOOR = 40;

/** How long a Fatgrid domain read is reused before it is read again: prices move, and a re-read costs a unit. */
export const LISTING_TTL_DAYS = 14;

/** Read an integer cap from the environment, or its default. */
export function capFrom(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}
