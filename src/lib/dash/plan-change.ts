/**
 * Changing what the plan works on, self-serve (Danny, 7 Nov 2026). Pure: the rules, the price and the lists; the
 * writes are plan-requests.ts, the route api/dash/[client]/plan.
 *
 * - The plan's clusters are the ones we work on (types.ts MANAGED_TIERS). A cluster added self-serve fills a paid
 *   slot first, and is otherwise tracking only (ops.ts addedClusterTier): free, within the shared allowance, and
 *   labelled so.
 * - Swapping: a tracking-only cluster takes a plan cluster's place on the 1st of next month, so the month's work in
 *   progress is finished first. One pending swap a client, cancellable until it applies (apply_plan_swaps). The plan
 *   keeps the same number of clusters, so billing does not change.
 * - Adding to the plan is a billing step: a request with the price it would add, which the customer success
 *   manager confirms. Nothing is charged automatically. The price is the sector table's for the customer's order,
 *   or their own order's per-cluster price, never a figure typed here.
 * - "Also on page 1" and "Close to page 1" (positions 11 to 20) come from the cached ranking snapshot
 *   (keyword_footprints), so they cost nothing to draw.
 */

import { MANAGED_TIERS, type Allowances, type Day, type FootRow, type PlanSwap, type PlanUpgrade, type Raw } from "./types.ts";

const live = (r: { stopped_on: string | null }) => r.stopped_on === null;
const key = (k: string) => k.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();

export const isPlanCluster = (c: { tier: string; stopped_on: string | null }) => live(c) && (MANAGED_TIERS as readonly string[]).includes(c.tier);

/** The first of the month after `today`: when a swap takes effect. */
export function nextMonthStart(today: Day): Day {
  const [y, m] = today.split("-").map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
}

/** "1 December 2026". */
export function monthDay(d: Day): string {
  return new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

/** The agency's note on a request it answers (plan_upgrade_requests.note's check). */
export const REQUEST_NOTE_MAX = 500;

/** Only the account owner changes the plan: a swap moves the month's work, an upgrade changes the bill. */
export const OWNER_ONLY = "Only the account owner can change the plan.";

/** Why this swap cannot be asked for, or null. `from` is a plan cluster; `to` a live tracking-only one. */
export function refuseSwap(raw: Pick<Raw, "client" | "clusters" | "role">, fromId: string, toId: string, pending: PlanSwap | null): string | null {
  if (raw.role !== "owner") return OWNER_ONLY;
  if (raw.client.status === "ended") return "This plan has ended, so nothing can be changed.";
  if (raw.client.tier === "tracked") return "Your plan is tracking only, so there is no plan cluster to swap.";
  if (pending) return `A swap is already booked for ${monthDay(pending.effective_on)}. Cancel it first to choose another.`;
  const from = raw.clusters.find((c) => c.id === fromId);
  if (!from || !isPlanCluster(from)) return "That cluster is not one we work on.";
  const to = raw.clusters.find((c) => c.id === toId);
  if (!to || !live(to)) return "That cluster has been removed.";
  if (isPlanCluster(to)) return "That cluster is already on your plan.";
  return null;
}

/** Why this add-to-plan request cannot be made, or null. A cluster (tracking only) or a keyword to start one. */
export function refuseUpgrade(raw: Pick<Raw, "client" | "clusters" | "role">, clusterId: string | null, keyword: string | null, open: readonly PlanUpgrade[]): string | null {
  if (raw.role !== "owner") return OWNER_ONLY;
  if (raw.client.status === "ended") return "This plan has ended, so nothing can be added to it.";
  if (raw.client.tier === "tracked") return "Adding a cluster we work on starts with a paid plan. See the plans on the Plan page.";
  if (open.length >= 3) return "You have three requests waiting already. We will be in touch about them first.";
  if (clusterId) {
    const c = raw.clusters.find((x) => x.id === clusterId);
    if (!c || !live(c)) return "That cluster has been removed.";
    if (isPlanCluster(c)) return "That cluster is already on your plan.";
    if (open.some((u) => u.cluster_id === clusterId)) return "You have already asked to add that cluster.";
    return null;
  }
  const k = keyword?.replace(/\s+/g, " ").trim() ?? "";
  if (k.length < 2 || k.length > 120) return "Name the keyword to add.";
  if (open.some((u) => u.keyword && key(u.keyword) === key(k))) return "You have already asked to add that keyword.";
  return null;
}

/** The order the plan was bought on, as plan-requests.ts reads it. */
export type PlanOrder = { sector: string | null; market: string | null; quantity: number | null; monthly_amount: number | null; currency: string | null };

export type UpgradePrice = { amount: number | null; currency: "usd" | "gbp" | null; source: "sector" | "order" | "call" };

/**
 * What one more plan cluster adds a month, in minor units. `sectorQuote` is sector-pricing.ts quoteFor for one
 * cluster in whole units (passed in, so this file runs under node --test without the config's JSON import).
 * The sector table first, then this customer's own order, divided by its clusters; otherwise a call.
 */
export function upgradePrice(order: PlanOrder | null, market: string, sectorQuote: (sector: string, market: "us" | "uk") => number | null): UpgradePrice {
  const m = (order?.market ?? market).toLowerCase() === "us" ? "us" : "uk";
  const currency = m === "us" ? "usd" : "gbp";
  if (order?.sector) {
    const whole = sectorQuote(order.sector, m);
    if (whole !== null) return { amount: whole * 100, currency, source: "sector" };
  }
  if (order && order.monthly_amount && order.quantity && order.quantity > 0) {
    const cur = order.currency === "usd" || order.currency === "gbp" ? order.currency : currency;
    return { amount: Math.round(order.monthly_amount / order.quantity), currency: cur, source: "order" };
  }
  return { amount: null, currency: null, source: "call" };
}

/** "£995", "$1,495", or null for a call. Whole units shown when the amount has no pence. */
export function money(amount: number | null, currency: "usd" | "gbp" | null): string | null {
  if (amount === null || !currency) return null;
  const sym = currency === "usd" ? "$" : "£";
  const whole = amount % 100 === 0;
  return sym + (amount / 100).toLocaleString("en-GB", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 });
}

/** The shared allowance in one line: "5 of 50 prompts · 1 of 10 clusters". */
export function limitsLine(a: Pick<Allowances, "prompts" | "clusters">): string {
  return `${a.prompts.used} of ${a.prompts.limit} prompts · ${a.clusters.used} of ${a.clusters.limit} clusters`;
}

export type SerpChance = { keyword: string; pos: number; volume: number | null; url: string | null };

/** Rows shown in each list. */
export const CHANCES_MAX = 25;

/**
 * The keywords the site already ranks for on page 1, and those just off it (11 to 20), from the ranking snapshot,
 * that are not tracked yet: the cheapest wins there are. Branded searches are left out - the brand's own name is
 * not a cluster to work on.
 */
export function serpChances(raw: Pick<Raw, "footprint" | "keywords" | "client">): { page1: SerpChance[]; close: SerpChance[] } {
  const tracked = new Set(raw.keywords.filter(live).map((k) => key(k.keyword)));
  const brand = [raw.client.brand, ...(raw.client.brand_aliases ?? []), raw.client.domain.replace(/^www\./, "").split(".")[0]]
    .filter((b): b is string => !!b && b.trim().length >= 3)
    .map((b) => key(b));
  const rows = (raw.footprint?.rows ?? []).filter((r: FootRow) => r.p !== null && r.k && !tracked.has(key(r.k)) && !brand.some((b) => key(r.k).includes(b)) && !(r as { n?: boolean }).n);
  const pick = (lo: number, hi: number) =>
    rows
      .filter((r) => r.p! >= lo && r.p! <= hi)
      .sort((a, b) => (b.v ?? 0) - (a.v ?? 0) || a.p! - b.p!)
      .slice(0, CHANCES_MAX)
      .map((r) => ({ keyword: r.k, pos: r.p!, volume: r.v, url: r.u }));
  return { page1: pick(1, 10), close: pick(11, 20) };
}

/**
 * What the agency should know about a client's plan (7 Nov 2026): a booked swap, add-to-plan requests waiting,
 * tracking-only clusters (each a cluster they could pay us to work on), and the page-1 and close-to-page-1
 * keywords they are not tracking yet. For the agency view only.
 */
export type UpsellSignals = { swap: PlanSwap | null; upgrades: PlanUpgrade[]; trackingOnly: string[]; page1: number; close: number };
export function upsellSignals(raw: Pick<Raw, "client" | "clusters" | "keywords" | "footprint" | "planRequests">): UpsellSignals {
  const chances = serpChances(raw);
  return {
    swap: raw.planRequests?.swap ?? null,
    upgrades: raw.planRequests?.upgrades ?? [],
    trackingOnly: raw.client.tier === "tracked" ? [] : raw.clusters.filter((c) => live(c) && !isPlanCluster(c)).map((c) => c.name),
    page1: chances.page1.length,
    close: chances.close.length,
  };
}

/**
 * What a client's package leaves out of its tier (Danny, 8 Nov 2026): its excluded_deliverables, and link insertions
 * when it has no ranking-target KPI (ranking_kpi false) - insertions are only for a client with one.
 */
export function packageExcludes(row: { excluded_deliverables?: readonly string[] | null; ranking_kpi?: boolean | null } | null): string[] {
  const out = [...(row?.excluded_deliverables ?? [])];
  if (row?.ranking_kpi === false && !out.includes("insertions")) out.push("insertions");
  return out;
}
