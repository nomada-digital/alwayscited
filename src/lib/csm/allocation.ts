/**
 * Splitting the global placement cap across clients (Danny, 5 Nov 2026: "we collectively don't want to spend more
 * than $750 per month on links" - one cap for every alwayscited client together, in USD).
 *
 * - Each client's share is weighted by its plan price (orders.monthly_amount, GBP put on the USD scale with
 *   GBP_TO_USD_WEIGHT), or by placement_budgets.weight_override; an excluded client, or one with no weight, gets none.
 * - A client's override (a run of months, placement_budget_overrides) fixes its allocation, deliberately: it may
 *   exceed the client's share and the cap (Danny, 5 Nov 2026: front-loading is context added client by client). It
 *   is never refused; it is shown - "over cap by $X, approved by <name>". Everyone else shares what is left of the
 *   cap by weight.
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
  /** The client's share of the cap by weight alone, before any override. */
  share: number;
  overridden: boolean;
  /** Who approved the override, and how far it takes the client past its share. */
  approvedBy: string | null;
  overShareBy: number;
  spent: number;
  remaining: number;
  breach: boolean;
};

export type MonthBudget = {
  cap: number | null;
  allocated: number;
  /** How far the month's allocations exceed the cap - only ever by an approved override - and who approved them. */
  overCapBy: number;
  approvals: string[];
  spent: number;
  remaining: number;
  breach: boolean;
  clients: Allocation[];
  warnings: string[];
};

export type Override = { amount: number; approvedBy: string };

/** A client's weight on one scale: its override, else its plan price in USD terms; 0 when excluded or unknown. */
export function weightOf(c: ClientWeight): number {
  if (c.excluded) return 0;
  if (c.weightOverride !== null && c.weightOverride >= 0) return c.weightOverride;
  if (c.planMonthly === null || !(c.planMonthly > 0)) return 0;
  return (c.planCurrency ?? "").toLowerCase() === "gbp" ? c.planMonthly * GBP_TO_USD_WEIGHT : c.planMonthly;
}

const cents = (n: number) => Math.round(n * 100) / 100;

/** The month's split, spend against it, and every breach. A cap not yet set allocates nothing and says so. */
export function monthBudget(p: { cap: number | null; clients: readonly ClientWeight[]; overrides: ReadonlyMap<string, Override>; spent: ReadonlyMap<string, number> }): MonthBudget {
  const warnings: string[] = [];
  const spentOf = (id: string) => cents(p.spent.get(id) ?? 0);
  const allWeight = p.clients.reduce((a, c) => a + weightOf(c), 0);
  const shareOf = (c: ClientWeight) => (p.cap !== null && allWeight > 0 ? Math.floor((p.cap * weightOf(c) * 100) / allWeight) / 100 : 0);
  const known = new Set(p.clients.map((c) => c.clientId));
  const fixed = [...p.overrides].filter(([id]) => known.has(id));
  const fixedTotal = fixed.reduce((a, [, o]) => a + o.amount, 0);
  if (p.cap === null) warnings.push("The global placement cap is not set, so only approved overrides are allocated.");
  const pool = p.cap === null ? 0 : Math.max(0, p.cap - fixedTotal);
  const shared = p.clients.filter((c) => !p.overrides.has(c.clientId));
  const sharedWeight = shared.reduce((a, c) => a + weightOf(c), 0);
  const clients = p.clients.map((c) => {
    const o = p.overrides.get(c.clientId) ?? null;
    const share = shareOf(c);
    // Shares round down to the cent so they never add up past the pool (6 Nov 2026: rounding showed $750.01 of $750).
    const allocation = o ? cents(o.amount) : sharedWeight > 0 ? Math.floor((pool * weightOf(c) * 100) / sharedWeight) / 100 : 0;
    const spent = spentOf(c.clientId);
    return { clientId: c.clientId, allocation, share, overridden: o !== null, approvedBy: o?.approvedBy ?? null, overShareBy: o ? cents(Math.max(0, o.amount - share)) : 0, spent, remaining: cents(allocation - spent), breach: spent > allocation };
  });
  const allocated = cents(clients.reduce((a, c) => a + c.allocation, 0));
  // Only an approved override can take the month past the cap; the shared pool never does.
  const overCapBy = p.cap === null ? 0 : cents(Math.max(0, fixedTotal - p.cap));
  const approvals = [...new Set(clients.filter((c) => c.overridden && c.overShareBy > 0).map((c) => c.approvedBy!))];
  for (const c of clients) if (c.overridden && c.overShareBy > 0) warnings.push(`${c.clientId}: over its share by $${c.overShareBy}, approved by ${c.approvedBy}.`);
  if (overCapBy > 0) warnings.push(`Allocations are over the $${p.cap} cap by $${overCapBy}, approved by ${approvals.join(", ")}.`);
  for (const c of clients) if (c.breach) warnings.push(`${c.clientId}: $${c.spent} spent against a $${c.allocation} allocation.`);
  const spent = cents(clients.reduce((a, c) => a + c.spent, 0));
  const limit = p.cap === null ? allocated : Math.max(p.cap, allocated);
  if (p.cap !== null && spent > p.cap) warnings.push(`$${spent} spent this month, over the $${p.cap} cap${spent <= limit ? " (within approved overrides)" : ""}.`);
  return { cap: p.cap, allocated, overCapBy, approvals, spent, remaining: cents(limit - spent), breach: spent > limit, clients, warnings };
}

export type OverrideRange = { id: string; startMonth: string | null; endMonth: string | null; monthlyUsd: number; approvedBy: string };

/** The override covering a month, if any: its start (or no start) on or before, its end (or no end) on or after. */
export function overrideFor(month: string, ranges: readonly OverrideRange[]): OverrideRange | null {
  return ranges.find((r) => (r.startMonth === null || r.startMonth <= month) && (r.endMonth === null || r.endMonth >= month)) ?? null;
}

/** Whether a new range would overlap one of the client's others: a month may have one override, so it is refused. */
export function checkRange(next: { id?: string; startMonth: string | null; endMonth: string | null }, others: readonly OverrideRange[]): { ok: true } | { ok: false; message: string } {
  if (next.startMonth && next.endMonth && next.endMonth < next.startMonth) return { ok: false, message: "The end month is before the start month." };
  const lo = (m: string | null) => m ?? "0000-00-01";
  const hi = (m: string | null) => m ?? "9999-12-01";
  const clash = others.find((o) => o.id !== next.id && lo(o.startMonth) <= hi(next.endMonth) && lo(next.startMonth) <= hi(o.endMonth));
  return clash ? { ok: false, message: `That overlaps the $${clash.monthlyUsd}/month override ${clash.startMonth ?? "from the start"} to ${clash.endMonth ?? "open-ended"}; end or change that one first.` } : { ok: true };
}

/** Whether buying an item would breach the client's allocation or the cap, and by how much - shown before Kev approves. */
export function wouldBreach(b: MonthBudget, clientId: string, price: number): string[] {
  const c = b.clients.find((x) => x.clientId === clientId);
  const out: string[] = [];
  if (c && c.spent + price > c.allocation) out.push(`takes this client to $${cents(c.spent + price)} against a $${c.allocation} allocation`);
  if (b.cap !== null && b.spent + price > b.cap) out.push(`takes the month to $${cents(b.spent + price)} against the $${b.cap} cap`);
  return out;
}
