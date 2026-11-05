/**
 * Splitting the global placement cap across clients (Danny, 5 Nov 2026: "we collectively don't want to spend more
 * than $750 per month on links" - one cap for every alwayscited client together, in USD).
 *
 * - Each client's share is weighted by its plan price (orders.monthly_amount, GBP put on the USD scale with
 *   GBP_TO_USD_WEIGHT), or by placement_budgets.weight_override; an excluded client, or one with no weight, gets none.
 * - A month's override fixes one client's allocation to front-load placements. Everyone else shares what is left of
 *   the cap by weight. Overrides may never add up past the cap: `checkOverride` refuses one that would.
 * - Spend is shown against the allocation per client and against the cap in total; any breach is a warning.
 *
 * Pure: the amounts arrive from the agency tables and are never written here. Imports are relative and carry the
 * extension, for the reason dataforseo-request.ts gives.
 */

import { GBP_TO_USD_WEIGHT } from "../../config/csm.ts";

export type ClientWeight = { clientId: string; planMonthly: number | null; planCurrency: string | null; weightOverride: number | null; excluded: boolean };

export type Allocation = {
  clientId: string;
  allocation: number;
  overridden: boolean;
  spent: number;
  remaining: number;
  breach: boolean;
};

export type MonthBudget = { cap: number | null; allocated: number; spent: number; remaining: number; breach: boolean; clients: Allocation[]; warnings: string[] };

/** A client's weight on one scale: its override, else its plan price in USD terms; 0 when excluded or unknown. */
export function weightOf(c: ClientWeight): number {
  if (c.excluded) return 0;
  if (c.weightOverride !== null && c.weightOverride >= 0) return c.weightOverride;
  if (c.planMonthly === null || !(c.planMonthly > 0)) return 0;
  return (c.planCurrency ?? "").toLowerCase() === "gbp" ? c.planMonthly * GBP_TO_USD_WEIGHT : c.planMonthly;
}

const cents = (n: number) => Math.round(n * 100) / 100;

/** The month's split, spend against it, and every breach. A cap not yet set allocates nothing and says so. */
export function monthBudget(p: { cap: number | null; clients: readonly ClientWeight[]; overrides: ReadonlyMap<string, number>; spent: ReadonlyMap<string, number> }): MonthBudget {
  const warnings: string[] = [];
  const spentOf = (id: string) => p.spent.get(id) ?? 0;
  if (p.cap === null) {
    warnings.push("The global placement cap is not set, so nothing is allocated.");
    const clients = p.clients.map((c) => ({ clientId: c.clientId, allocation: 0, overridden: false, spent: spentOf(c.clientId), remaining: 0, breach: spentOf(c.clientId) > 0 }));
    const spent = cents(clients.reduce((a, c) => a + c.spent, 0));
    return { cap: null, allocated: 0, spent, remaining: 0, breach: spent > 0, clients, warnings };
  }
  const fixed = [...p.overrides].filter(([id]) => p.clients.some((c) => c.clientId === id));
  const fixedTotal = fixed.reduce((a, [, v]) => a + v, 0);
  if (fixedTotal > p.cap) warnings.push(`This month's overrides add up to $${cents(fixedTotal)}, over the $${p.cap} cap.`);
  const pool = Math.max(0, p.cap - fixedTotal);
  const shared = p.clients.filter((c) => !p.overrides.has(c.clientId));
  const totalWeight = shared.reduce((a, c) => a + weightOf(c), 0);
  const clients = p.clients.map((c) => {
    const overridden = p.overrides.has(c.clientId);
    const allocation = cents(overridden ? p.overrides.get(c.clientId)! : totalWeight > 0 ? (pool * weightOf(c)) / totalWeight : 0);
    const spent = cents(spentOf(c.clientId));
    return { clientId: c.clientId, allocation, overridden, spent, remaining: cents(allocation - spent), breach: spent > allocation };
  });
  for (const c of clients) if (c.breach) warnings.push(`${c.clientId}: $${c.spent} spent against a $${c.allocation} allocation.`);
  const spent = cents(clients.reduce((a, c) => a + c.spent, 0));
  const allocated = cents(clients.reduce((a, c) => a + c.allocation, 0));
  if (spent > p.cap) warnings.push(`$${spent} spent this month, over the $${p.cap} cap.`);
  return { cap: p.cap, allocated, spent, remaining: cents(p.cap - spent), breach: spent > p.cap, clients, warnings };
}

/** Whether a front-loading override fits: with the month's other overrides it may not pass the cap. */
export function checkOverride(p: { cap: number | null; clientId: string; amount: number; overrides: ReadonlyMap<string, number> }): { ok: true } | { ok: false; message: string } {
  if (p.cap === null) return { ok: false, message: "Set the global placement cap first." };
  if (!(p.amount >= 0)) return { ok: false, message: "An allocation is zero or more." };
  const others = [...p.overrides].filter(([id]) => id !== p.clientId).reduce((a, [, v]) => a + v, 0);
  if (others + p.amount > p.cap) return { ok: false, message: `With this month's other overrides ($${cents(others)}) that is $${cents(others + p.amount)}, over the $${p.cap} cap.` };
  return { ok: true };
}

/** Whether buying an item would breach the client's allocation or the cap, and by how much - shown before Kev approves. */
export function wouldBreach(b: MonthBudget, clientId: string, price: number): string[] {
  const c = b.clients.find((x) => x.clientId === clientId);
  const out: string[] = [];
  if (c && c.spent + price > c.allocation) out.push(`takes this client to $${cents(c.spent + price)} against a $${c.allocation} allocation`);
  if (b.cap !== null && b.spent + price > b.cap) out.push(`takes the month to $${cents(b.spent + price)} against the $${b.cap} cap`);
  return out;
}
