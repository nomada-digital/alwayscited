/**
 * /admin/funnel's counts - R152 (Danny, 1 Oct 2026, danny.md line 152). Built
 * only from tables that already exist; nothing new is tracked. Pure, so the
 * rules run under node --test, and the page (part 2) only reads rows and draws.
 *
 * Counts only: a row in carries a timestamp, a market and a status, never an
 * email, a domain or a name, and what comes out is numbers keyed by step, day
 * and market. A step no table records is `null`, which the page shows as
 * "not logged" rather than a zero that would read as a real figure.
 */

export type Market = "US" | "UK";

/** The funnel's steps, in order. */
export const FUNNEL_STEPS = [
  { key: "started", label: "Scans started", source: "scans.created_at" },
  { key: "confirmed", label: "Scans confirmed", source: "scans.queued_at set" },
  { key: "completed", label: "Scans completed", source: "scans.status = complete" },
  { key: "opened", label: "Results opened", source: null },
  { key: "walkthrough", label: "Walkthroughs requested", source: "walkthrough_requests, market from its scan" },
  { key: "checkout", label: "Checkouts reached", source: null },
  { key: "paid", label: "Orders paid", source: "orders" },
] as const;

/**
 * The columns the page's three reads ask for: a timestamp, a market and a
 * status, never an email, a domain or a name, so nothing personal reaches the
 * page even before the rows are reduced to numbers. The test holds them to it.
 */
export const FUNNEL_SELECTS = {
  scans: "created_at, queued_at, status, market",
  walkthroughs: "created_at, scans(market)",
  orders: "created_at, market",
} as const;

export type FunnelStep = (typeof FUNNEL_STEPS)[number]["key"];

export type ScanRow = { created_at: string; queued_at: string | null; status: string; market: string | null };
export type WalkthroughRow = { created_at: string; market: string | null };
export type OrderRow = { created_at: string; market: string };

/** One day's counts by step and market; `null` where the step is not logged. */
export type FunnelDay = { day: string; counts: Record<FunnelStep, Record<Market, number> | null> };

/** orders store `uk`/`us`, scans `UK`/`US`; anything else counts under neither market. */
export function marketOf(v: string | null): Market | null {
  const m = (v ?? "").toUpperCase();
  return m === "US" || m === "UK" ? m : null;
}

const dayOf = (iso: string) => iso.slice(0, 10);

/**
 * Counts per UTC day, newest first, from `from` (a YYYY-MM-DD) on. Every step
 * is dated by the row's own `created_at`, so a scan started on Monday and
 * confirmed on Tuesday counts as Monday's in both rows.
 */
export function funnelDays(rows: { scans: ScanRow[]; walkthroughs: WalkthroughRow[]; orders: OrderRow[] }, from: string): FunnelDay[] {
  const days = new Map<string, FunnelDay>();
  const at = (iso: string) => {
    const d = dayOf(iso);
    if (d < from) return null;
    let row = days.get(d);
    if (!row) {
      const zero = () => ({ US: 0, UK: 0 });
      row = { day: d, counts: { started: zero(), confirmed: zero(), completed: zero(), opened: null, walkthrough: zero(), checkout: null, paid: zero() } };
      days.set(d, row);
    }
    return row;
  };
  const add = (row: FunnelDay | null, step: FunnelStep, m: Market | null) => {
    const c = row && m ? row.counts[step] : null;
    if (c && m) c[m] += 1;
  };
  for (const s of rows.scans) {
    const row = at(s.created_at);
    const m = marketOf(s.market);
    add(row, "started", m);
    if (s.queued_at) add(row, "confirmed", m);
    if (s.status === "complete") add(row, "completed", m);
  }
  for (const w of rows.walkthroughs) add(at(w.created_at), "walkthrough", marketOf(w.market));
  for (const o of rows.orders) add(at(o.created_at), "paid", marketOf(o.market));
  return [...days.values()].sort((a, b) => (a.day < b.day ? 1 : -1));
}

/** The whole range per step and market, for the page's top row; `null` stays `null`. */
export function funnelTotals(days: FunnelDay[]): Record<FunnelStep, Record<Market, number> | null> {
  const out = {} as Record<FunnelStep, Record<Market, number> | null>;
  for (const { key, source } of FUNNEL_STEPS) {
    if (source === null) {
      out[key] = null;
      continue;
    }
    const t = { US: 0, UK: 0 };
    for (const d of days) {
      const c = d.counts[key];
      if (c) (t.US += c.US), (t.UK += c.UK);
    }
    out[key] = t;
  }
  return out;
}
