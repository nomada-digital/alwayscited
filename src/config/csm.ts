/**
 * The placement shortlist's bounds (phase 1, 5 Nov 2026). Fatgrid bills in units - one per domain returned - on its
 * Pro plan, which is Nomada's (Danny, 5 Nov 2026), so every read is capped: FATGRID_UNIT_CAP per shortlist run and
 * FATGRID_MONTHLY_UNIT_CAP across everything that spends units in a calendar month (the shortlist and the free scan's
 * difficulty score, both written to fatgrid_usage). Defaults are deliberately low; set the monthly one to the plan's
 * allowance. An unparseable or non-positive value falls back to the default, never to "no cap". Nothing refreshes on
 * its own past either cap.
 *
 * No money is written here. The per-customer placement budget is our cost and this repository is public, so it lives in the
 * placement_budget_settings row, set in the database.
 */
export const FATGRID_DEFAULTS = { unitCapPerRun: 60, monthlyUnitCap: 1000 } as const;

/** The DR floor when the SERP gives too little to set one: Nomada's general-inventory floor (fatgrid skill). */
export const DEFAULT_DR_FLOOR = 40;

/** How long a Fatgrid domain read is reused before it is read again: prices move, and a re-read costs a unit. */
export const LISTING_TTL_DAYS = 14;

/**
 * Nomada's own brands on alwayscited (10 Nov 2026, Danny: the per-customer placement budget is for customers). They get
 * none unless a placement_budgets row puts them in (allocation.ts eligible). Slugs, as client_domains has them.
 */
export const INTERNAL_BRAND_SLUGS: readonly string[] = ["alwayscited-com", "nomadadigital-co-uk"];

/** Read an integer cap from the environment, or its default. */
export function capFrom(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}
