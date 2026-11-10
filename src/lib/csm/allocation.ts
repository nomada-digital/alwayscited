/**
 * Each client's placement budget for a month (Danny, 10 Nov 2026: "$750 PER CUSTOMER PER MONTH").
 *
 * The setting (placement_budget_settings.per_customer_usd, was global_cap_usd) is what every client on a placement plan
 * gets each month. It was read as one cap for every client together, split by plan price (5 Nov 2026), which left
 * MOR with $128.88 of $750; it is per customer now, and nothing is split.
 *
 * - A client gets the amount when it is on a placement plan, paying (a plan price on its latest order), and not
 *   excluded. placement_budgets says otherwise where it has a row: `excluded`, or a weight of 0, leaves the client
 *   out; any other weight puts in a client that would otherwise be left out - an internal brand or one with no order.
 *   The agency read (agency.ts) leaves the internal brands out unless such a row puts them in.
 * - A client's override (a run of months, placement_budget_overrides) fixes its budget, deliberately: it may be more
 *   than the per-customer amount (Danny, 5 Nov 2026: front-loading is context added client by client). It is never
 *   refused; it is shown - "over the per-customer budget by $X, approved by <name>". Nobody else's budget moves.
 * - Spend is shown against each client's budget and against the month's total; any breach is a warning.
 *
 * Pure: the amounts arrive from the agency tables and are never written here. Imports are relative and carry the
 * extension, for the reason dataforseo-request.ts gives.
 */

export type ClientWeight = { clientId: string; planMonthly: number | null; planCurrency: string | null; weightOverride: number | null; excluded: boolean };

export type Allocation = {
  clientId: string;
  allocation: number;
  /** The per-customer amount when the client is eligible, else 0: its budget before any override. */
  share: number;
  overridden: boolean;
  /** Who approved the override, and how far it takes the client past the per-customer amount. */
  approvedBy: string | null;
  overShareBy: number;
  spent: number;
  remaining: number;
  breach: boolean;
};

export type MonthBudget = {
  /** The per-customer amount, the setting as it stands (null when not set). */
  cap: number | null;
  /** The month's total of per-customer budgets: the amount times every eligible client. */
  total: number;
  allocated: number;
  /** How far approved overrides take the month past that total, and who approved them. */
  overCapBy: number;
  approvals: string[];
  spent: number;
  remaining: number;
  breach: boolean;
  clients: Allocation[];
  warnings: string[];
};

export type Override = { amount: number; approvedBy: string };

/** Whether a client gets the per-customer amount: not excluded, and a weight of its own above 0 or a plan price. */
export function eligible(c: ClientWeight): boolean {
  if (c.excluded) return false;
  if (c.weightOverride !== null && c.weightOverride >= 0) return c.weightOverride > 0;
  return c.planMonthly !== null && c.planMonthly > 0;
}

const cents = (n: number) => Math.round(n * 100) / 100;

/** The month's budgets, spend against them, and every breach. An amount not yet set allocates nothing and says so. */
export function monthBudget(p: { cap: number | null; clients: readonly ClientWeight[]; overrides: ReadonlyMap<string, Override>; spent: ReadonlyMap<string, number> }): MonthBudget {
  const warnings: string[] = [];
  const spentOf = (id: string) => cents(p.spent.get(id) ?? 0);
  if (p.cap === null) warnings.push("The per-customer placement budget is not set, so only approved overrides are allocated.");
  const clients = p.clients.map((c) => {
    const o = p.overrides.get(c.clientId) ?? null;
    const share = p.cap !== null && eligible(c) ? cents(p.cap) : 0;
    const allocation = o ? cents(o.amount) : share;
    const spent = spentOf(c.clientId);
    return { clientId: c.clientId, allocation, share, overridden: o !== null, approvedBy: o?.approvedBy ?? null, overShareBy: o ? cents(Math.max(0, o.amount - share)) : 0, spent, remaining: cents(allocation - spent), breach: spent > allocation };
  });
  const total = cents(clients.reduce((a, c) => a + c.share, 0));
  const allocated = cents(clients.reduce((a, c) => a + c.allocation, 0));
  const overCapBy = cents(clients.reduce((a, c) => a + c.overShareBy, 0));
  const approvals = [...new Set(clients.filter((c) => c.overridden && c.overShareBy > 0).map((c) => c.approvedBy!))];
  for (const c of clients) if (c.overridden && c.overShareBy > 0) warnings.push(`${c.clientId}: over the per-customer budget by $${c.overShareBy}, approved by ${c.approvedBy}.`);
  for (const c of clients) if (c.breach) warnings.push(`${c.clientId}: $${c.spent} spent against a $${c.allocation} budget.`);
  const spent = cents(clients.reduce((a, c) => a + c.spent, 0));
  const limit = Math.max(total, allocated);
  if (spent > limit) warnings.push(`$${spent} spent this month, over the month's $${limit} of budgets.`);
  return { cap: p.cap, total, allocated, overCapBy, approvals, spent, remaining: cents(limit - spent), breach: spent > limit, clients, warnings };
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

/** Whether buying an item would take the client past its budget, and by how much - shown before Kev approves. */
export function wouldBreach(b: MonthBudget, clientId: string, price: number): string[] {
  const c = b.clients.find((x) => x.clientId === clientId);
  return c && c.spent + price > c.allocation ? [`takes this client to $${cents(c.spent + price)} against its $${c.allocation} budget this month`] : [];
}
