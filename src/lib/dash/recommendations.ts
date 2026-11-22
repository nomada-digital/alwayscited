/**
 * The weekly recommendations on the dashboards host (22 Nov 2026, migration 20261122000000).
 *
 * The Nomada hub writes customer_recommendations rows each week; this file only reads them. A row reaches a
 * customer only once `released_at` is set (the account manager approved that week's email), and that rule is applied
 * twice on purpose: in the query, and again over whatever came back, so a read that forgot the filter still shows
 * nothing unreleased.
 *
 * Pure (a client is passed in, nothing imported from the app), so `node --test` runs it (recommendations.test.mts).
 * The server read that picks the client is recommendations-read.ts.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { isEngine, type Engine } from "../scan/engines.ts";

export const KINDS = ["schema", "content", "profile", "on_page_answer", "listing", "upgrade"] as const;
export type RecKind = (typeof KINDS)[number];
export type RecStatus = "new" | "done" | "dismissed";
export type OfferTier = "cited" | "mentioned" | "everywhere";
const OFFER_TIERS: readonly string[] = ["cited", "mentioned", "everywhere"];

/** At most this many recommendations in the main list, and this many upgrade cards. */
export const MAX_SHOWN = 5;
export const MAX_UPGRADES = 2;

export type RecEvidence = {
  answers?: number;
  engines?: Engine[];
  prompts?: string[];
  url?: string;
  domain?: string;
  competitors?: string[];
  since?: string;
};

export type Recommendation = {
  id: string;
  week_of: string;
  position: number;
  kind: RecKind;
  title: string;
  why: string;
  evidence: RecEvidence;
  how: string[];
  href: string | null;
  offer: { tier: OfferTier; what: string } | null;
  status: RecStatus;
  released_at: string | null;
};

/** What a kind is called on the page. */
export const KIND_LABEL: Record<RecKind, string> = {
  schema: "Schema fix",
  content: "Content to add",
  profile: "Review profile",
  on_page_answer: "Answer on your page",
  listing: "Directory listing",
  upgrade: "We could build this for you",
};

const COLUMNS = "id, week_of, position, kind, title, why, evidence, how, href, offer, status, released_at";

const strings = (v: unknown, max = 12): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim()).slice(0, max) : []);

/** An external link is shown only when it is a plain web address; nothing else from a stored row becomes an href. */
export function safeHref(v: unknown): string | null {
  if (typeof v !== "string") return null;
  try {
    const u = new URL(v.trim());
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

function evidenceOf(v: unknown): RecEvidence {
  const e = (v && typeof v === "object" && !Array.isArray(v) ? v : {}) as Record<string, unknown>;
  const out: RecEvidence = {};
  if (typeof e.answers === "number" && Number.isFinite(e.answers) && e.answers >= 0) out.answers = Math.floor(e.answers);
  const engines = [...new Set(strings(e.engines, 10).filter(isEngine))];
  if (engines.length) out.engines = engines;
  const prompts = strings(e.prompts, 5);
  if (prompts.length) out.prompts = prompts;
  const url = safeHref(e.url);
  if (url) out.url = url;
  if (typeof e.domain === "string" && e.domain.trim()) out.domain = e.domain.trim();
  const competitors = strings(e.competitors, 6);
  if (competitors.length) out.competitors = competitors;
  if (typeof e.since === "string" && /^\d{4}-\d{2}-\d{2}/.test(e.since)) out.since = e.since.slice(0, 10);
  return out;
}

/** One stored row, checked and shaped; null when it cannot be drawn (not a row, an unknown kind or status, no title). */
export function shape(r: unknown): Recommendation | null {
  if (!r || typeof r !== "object") return null;
  const x = r as Record<string, unknown>;
  const kind = x.kind;
  if (typeof kind !== "string" || !(KINDS as readonly string[]).includes(kind)) return null;
  const status = x.status === "done" || x.status === "dismissed" ? x.status : x.status === "new" ? "new" : null;
  if (!status) return null;
  if (typeof x.id !== "string" || typeof x.week_of !== "string" || typeof x.title !== "string" || !x.title.trim() || typeof x.why !== "string") return null;
  const o = x.offer && typeof x.offer === "object" ? (x.offer as Record<string, unknown>) : null;
  const offer = o && typeof o.tier === "string" && OFFER_TIERS.includes(o.tier) && typeof o.what === "string" && o.what.trim() ? { tier: o.tier as OfferTier, what: o.what.trim() } : null;
  return {
    id: x.id,
    week_of: x.week_of.slice(0, 10),
    position: typeof x.position === "number" ? x.position : 99,
    kind: kind as RecKind,
    title: x.title.trim(),
    why: x.why.trim(),
    evidence: evidenceOf(x.evidence),
    how: strings(x.how, 10),
    href: safeHref(x.href),
    offer,
    status,
    released_at: typeof x.released_at === "string" ? x.released_at : null,
  };
}

export type Picked = {
  /** The Monday of the newest released week, or null when nothing has been released. */
  week: string | null;
  /** The main list, at most MAX_SHOWN: this week's, then older ones still new. Never an upgrade row. */
  items: Recommendation[];
  /** Upgrade rows from the newest released week, at most MAX_UPGRADES. Whether a customer sees them is the page's call (tier). */
  upgrades: Recommendation[];
};

const byWeekThenPosition = (a: Recommendation, b: Recommendation) => (a.week_of === b.week_of ? a.position - b.position : b.week_of.localeCompare(a.week_of));

/**
 * What to show from a client's rows. Only released rows count. The newest released week's rows lead, in position
 * order, except a dismissed one; rows from earlier released weeks follow only while still 'new'. The list is capped
 * at MAX_SHOWN. Upgrade rows are kept out of the list and offered separately from the newest week alone.
 */
export function pick(rows: readonly unknown[]): Picked {
  const released = rows.map(shape).filter((r): r is Recommendation => r !== null && r.released_at !== null);
  if (!released.length) return { week: null, items: [], upgrades: [] };
  const week = released.reduce((w, r) => (r.week_of > w ? r.week_of : w), released[0]!.week_of);
  const main = released.filter((r) => r.kind !== "upgrade").sort(byWeekThenPosition);
  const current = main.filter((r) => r.week_of === week && r.status !== "dismissed");
  const carried = main.filter((r) => r.week_of < week && r.status === "new");
  const upgrades = released.filter((r) => r.kind === "upgrade" && r.week_of === week && r.status !== "dismissed" && r.offer).sort(byWeekThenPosition);
  return { week, items: [...current, ...carried].slice(0, MAX_SHOWN), upgrades: upgrades.slice(0, MAX_UPGRADES) };
}

/** How many of the shown recommendations are still new: the nav's count. */
export const newCount = (items: readonly Recommendation[]): number => items.filter((r) => r.status === "new").length;

export type RecsResult = ({ ok: true } & Picked) | { ok: false };

/**
 * A client's recommendations, read with the service role and scoped to the client. A missing table or a failed read
 * is `{ ok: false }`, which the page says outright ("could not be read"): an unreadable section is never drawn as
 * an empty one. The read is bounded to the newest rows, so a long history costs nothing.
 */
export async function loadRecommendations(db: SupabaseClient, clientId: string): Promise<RecsResult> {
  try {
    const { data, error } = await db
      .from("customer_recommendations")
      .select(COLUMNS)
      .eq("client_domain_id", clientId)
      .not("released_at", "is", null)
      .order("week_of", { ascending: false })
      .order("position", { ascending: true })
      .limit(60);
    if (error) {
      console.warn(`[dash] recommendations read failed: ${error.message}`);
      return { ok: false };
    }
    return { ok: true, ...pick(data ?? []) };
  } catch (e) {
    console.warn(`[dash] recommendations read failed: ${e instanceof Error ? e.message : String(e)}`);
    return { ok: false };
  }
}

/** The price and link an upgrade card shows, supplied by the page from config/pricing.ts - never typed here. */
export type Pricing = { priceLabel: (tier: OfferTier) => string; href: (tier: OfferTier) => string };

export type UpgradeCard = { id: string; what: string; why: string; priceLabel: string; href: string };

/**
 * The "We could build this for you" cards: only for a customer on alwaystracked (tier 'tracked'), at most
 * MAX_UPGRADES, each with the price label and link the supplied pricing gives for the offer's tier. Any other tier
 * gets none.
 */
export function upgradeCards(upgrades: readonly Recommendation[], clientTier: string, pricing: Pricing): UpgradeCard[] {
  if (clientTier !== "tracked") return [];
  return upgrades
    .filter((u) => u.kind === "upgrade" && u.offer)
    .slice(0, MAX_UPGRADES)
    .map((u) => ({ id: u.id, what: u.offer!.what, why: u.why, priceLabel: pricing.priceLabel(u.offer!.tier), href: pricing.href(u.offer!.tier) }));
}
