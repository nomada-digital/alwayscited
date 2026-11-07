import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { mention } from "@/config/team";
import { quoteFor, type SectorTier } from "@/config/sector-pricing";
import { SITE_ORIGIN } from "@/lib/app-host";
import { postToChannel, type SlackResult } from "@/lib/slack";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { TIER_PLAIN } from "@/lib/tier-text";

import { dashFixturePath, fixtureRaw } from "./fixture";
import { absent } from "./load";
import { type PlanOrder, money, monthDay, nextMonthStart, refuseSwap, refuseUpgrade, upgradePrice } from "./plan-change";
import { MANAGED_TIERS, type Day, type PlanRequests, type PlanSwap, type PlanUpgrade, type Raw, type TierKey } from "./types";

/**
 * Swaps and add-to-plan requests, written (7 Nov 2026; the rules are plan-change.ts). Service role, every write
 * scoped to the client. Each request is posted to #alwayscited with the customer success manager named, so it is
 * seen the day it is made; a Slack failure never fails the request, which the agency view lists either way.
 */

const SWAP_COLS = "id, from_cluster_id, to_cluster_id, effective_on, status, requested_by, created_at";
const UPGRADE_COLS = "id, cluster_id, keyword, price_amount, currency, price_source, status, requested_by, created_at";

/** The pending swap and the add-to-plan requests still waiting. Empty before 20261108000000 is applied. */
export async function readPlanRequests(db: SupabaseClient, clientId: string): Promise<PlanRequests> {
  const [{ data: s, error: sErr }, { data: u, error: uErr }] = await Promise.all([
    db.from("plan_swap_requests").select(SWAP_COLS).eq("client_domain_id", clientId).eq("status", "pending").limit(1),
    db.from("plan_upgrade_requests").select(UPGRADE_COLS).eq("client_domain_id", clientId).eq("status", "requested").order("created_at"),
  ]);
  if (sErr && !absent(sErr)) throw new Error(`could not read the plan swap: ${sErr.message}`);
  if (uErr && !absent(uErr)) throw new Error(`could not read the plan requests: ${uErr.message}`);
  return { swap: ((s ?? [])[0] as PlanSwap | undefined) ?? null, upgrades: (u ?? []) as PlanUpgrade[] };
}

/** The order the paid plan was bought on, newest first; null with none (an invoiced client). */
export async function planOrder(db: SupabaseClient, clientId: string): Promise<PlanOrder | null> {
  // A local run: the snapshot's own order, when it states one.
  if (dashFixturePath()) return ((fixtureRaw().client as { order?: PlanOrder }).order ?? null);
  const { data, error } = await db
    .from("orders")
    .select("sector, market, quantity, monthly_amount, currency")
    .eq("client_domain_id", clientId)
    .in("tier", MANAGED_TIERS as unknown as string[])
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(`could not read the order: ${error.message}`);
  return ((data ?? [])[0] as PlanOrder | undefined) ?? null;
}

/** The plan's paid clusters (types.ts RawClient.plan_slots): the order's quantity, or null without one. */
export async function planSlots(db: SupabaseClient, clientId: string, tier: string): Promise<number | null> {
  if (tier === "tracked") return null;
  const o = await planOrder(db, clientId).catch(() => null);
  return o?.quantity && o.quantity > 0 ? o.quantity : null;
}

/**
 * Applies every swap due by `today` (apply_plan_swaps): the old cluster becomes tracking only and the new one takes
 * the plan's tier. Called by the daily check, and by a dashboard read so a swap shows on the 1st whatever the cron
 * did. The count applied, or the error's words; never thrown.
 */
export async function applyDueSwaps(db: SupabaseClient, today: Day): Promise<number | string> {
  const { data, error } = await db.rpc("apply_plan_swaps", { p_today: today });
  if (error) return absent(error) ? 0 : `could not apply plan swaps: ${error.message}`;
  return typeof data === "number" ? data : 0;
}

/** The daily check's call (api/cron/track): every client's swaps due today, applied; never thrown. */
export async function applyDueSwapsSafely(today: Day): Promise<number | string> {
  try {
    return await applyDueSwaps(supabaseAdmin(), today);
  } catch (err) {
    return `could not apply plan swaps: ${err instanceof Error ? err.message : String(err)}`;
  }
}

const name = (raw: Pick<Raw, "clusters">, id: string | null) => raw.clusters.find((c) => c.id === id)?.name ?? "a cluster";
const plain = (t: TierKey) => TIER_PLAIN[t];
const adminLink = `${SITE_ORIGIN}/admin/tracking#plan-requests`;

async function tell(text: string): Promise<SlackResult> {
  return postToChannel(`${mention("kev")} ${text}\n${adminLink}`);
}

export type RequestResult = { ok: true; id: string; slack: SlackResult["posted"] } | { ok: false; message: string; status?: number };

export async function requestSwap(db: SupabaseClient, raw: Raw, p: { from: string; to: string; by: string }): Promise<RequestResult> {
  const pending = raw.planRequests?.swap ?? null;
  const no = refuseSwap(raw, p.from, p.to, pending);
  if (no) return { ok: false, message: no, status: raw.role === "owner" ? 422 : 403 };
  const effective = nextMonthStart(raw.today);
  const { data, error } = await db
    .from("plan_swap_requests")
    .insert({ client_domain_id: raw.client.id, from_cluster_id: p.from, to_cluster_id: p.to, effective_on: effective, requested_by: p.by })
    .select("id")
    .single();
  if (error?.code === "23505") return { ok: false, message: "A swap is already booked. Cancel it first to choose another." };
  if (error) return { ok: false, message: `Could not book the swap: ${error.message}`, status: 502 };
  const s = await tell(`Plan swap booked for *${raw.client.domain}* by ${p.by}: "${name(raw, p.from)}" makes way for "${name(raw, p.to)}" from ${monthDay(effective)}. The work in progress on "${name(raw, p.from)}" finishes first. No billing change.`);
  return { ok: true, id: data.id as string, slack: s.posted };
}

export async function cancelSwap(db: SupabaseClient, raw: Raw, p: { id: string; by: string }): Promise<RequestResult> {
  if (raw.role !== "owner") return { ok: false, message: "Only the account owner can change the plan.", status: 403 };
  const swap = raw.planRequests?.swap;
  if (!swap || swap.id !== p.id) return { ok: false, message: "That swap is not booked any more." };
  const { data, error } = await db
    .from("plan_swap_requests")
    .update({ status: "cancelled", cancelled_at: new Date().toISOString(), cancelled_by: p.by })
    .eq("id", p.id)
    .eq("client_domain_id", raw.client.id)
    .eq("status", "pending")
    .select("id");
  if (error) return { ok: false, message: `Could not cancel the swap: ${error.message}`, status: 502 };
  if (!(data ?? []).length) return { ok: false, message: "That swap has already applied or been cancelled." };
  const s = await tell(`Plan swap for *${raw.client.domain}* cancelled by ${p.by}: "${name(raw, swap.from_cluster_id)}" stays on the plan.`);
  return { ok: true, id: p.id, slack: s.posted };
}

/** What one more plan cluster adds for this client, from the sector table or their own order. */
export async function priceFor(db: SupabaseClient, raw: Pick<Raw, "client">) {
  const order = await planOrder(db, raw.client.id);
  const tier = raw.client.tier as SectorTier;
  return upgradePrice(order, raw.client.market, (sector, market) => {
    const q = tier === "mentioned" || tier === "cited" ? quoteFor(sector, market, tier, 1) : { kind: "call" as const };
    return q.kind === "price" ? q.amount : null;
  });
}

export async function requestUpgrade(db: SupabaseClient, raw: Raw, p: { clusterId: string | null; keyword: string | null; by: string }): Promise<RequestResult> {
  const open = raw.planRequests?.upgrades ?? [];
  const no = refuseUpgrade(raw, p.clusterId, p.keyword, open);
  if (no) return { ok: false, message: no, status: raw.role === "owner" ? 422 : 403 };
  const price = await priceFor(db, raw).catch(() => ({ amount: null, currency: null, source: "call" as const }));
  const keyword = p.clusterId ? null : (p.keyword ?? "").replace(/\s+/g, " ").trim();
  const { data, error } = await db
    .from("plan_upgrade_requests")
    .insert({ client_domain_id: raw.client.id, cluster_id: p.clusterId, keyword, price_amount: price.amount, currency: price.currency, price_source: price.source, requested_by: p.by })
    .select("id")
    .single();
  if (error) return { ok: false, message: `Could not send the request: ${error.message}`, status: 502 };
  const what = p.clusterId ? `"${name(raw, p.clusterId)}"` : `a cluster for "${keyword}"`;
  const at = money(price.amount, price.currency);
  const s = await tell(
    `Add-to-plan request from *${raw.client.domain}* (${p.by}): ${what} on the ${plain(raw.client.tier)} plan, ${at ? `${at} a month more (${price.source === "sector" ? "sector price" : "their order's per-cluster price"})` : "price to agree on a call"}. Nothing has been charged: update the subscription in Stripe, then confirm it in admin.`,
  );
  return { ok: true, id: data.id as string, slack: s.posted };
}

export async function cancelUpgrade(db: SupabaseClient, raw: Raw, p: { id: string; by: string }): Promise<RequestResult> {
  if (raw.role !== "owner") return { ok: false, message: "Only the account owner can change the plan.", status: 403 };
  const u = (raw.planRequests?.upgrades ?? []).find((x) => x.id === p.id);
  if (!u) return { ok: false, message: "That request is not waiting any more." };
  const { data, error } = await db
    .from("plan_upgrade_requests")
    .update({ status: "cancelled", decided_at: new Date().toISOString(), decided_by: p.by })
    .eq("id", p.id)
    .eq("client_domain_id", raw.client.id)
    .eq("status", "requested")
    .select("id");
  if (error) return { ok: false, message: `Could not cancel the request: ${error.message}`, status: 502 };
  if (!(data ?? []).length) return { ok: false, message: "That request has already been dealt with." };
  const s = await tell(`Add-to-plan request from *${raw.client.domain}* cancelled by ${p.by}: ${u.cluster_id ? `"${name(raw, u.cluster_id)}"` : `"${u.keyword}"`}.`);
  return { ok: true, id: p.id, slack: s.posted };
}

/**
 * The agency's answer to an add-to-plan request (admin only). Confirmed: the subscription has been changed in
 * Stripe by hand, and the cluster becomes a plan cluster now. Declined: nothing changes. A keyword-only request's
 * cluster is set up by the agency, so confirming it records the decision only.
 */
export async function decideUpgrade(db: SupabaseClient, p: { id: string; decision: "confirmed" | "declined"; by: string; note: string | null }): Promise<string | null> {
  const { data: row, error } = await db.from("plan_upgrade_requests").select("id, client_domain_id, cluster_id, status").eq("id", p.id).maybeSingle();
  if (error) return error.message;
  if (!row || row.status !== "requested") return "That request has already been dealt with.";
  if (p.decision === "confirmed" && row.cluster_id) {
    const { data: c, error: cErr } = await db.from("client_domains").select("tier").eq("id", row.client_domain_id).maybeSingle();
    if (cErr || !c) return cErr?.message ?? "client not found";
    if (!(MANAGED_TIERS as readonly string[]).includes(c.tier as string)) return "The client is not on a paid plan.";
    const { error: tErr } = await db.from("tracked_clusters").update({ tier: c.tier }).eq("id", row.cluster_id).eq("client_domain_id", row.client_domain_id).is("stopped_on", null);
    if (tErr) return tErr.message;
  }
  const { error: uErr } = await db
    .from("plan_upgrade_requests")
    .update({ status: p.decision, decided_at: new Date().toISOString(), decided_by: p.by, note: p.note })
    .eq("id", p.id)
    .eq("status", "requested");
  return uErr ? uErr.message : null;
}


/**
 * Before a dashboard read: any swap of this client's due today is applied (one cheap read when none is), so the
 * page on the 1st shows the new plan cluster even if the daily check has not run. Never thrown.
 */
export async function settleSwaps(db: SupabaseClient, clientId: string, today: Day): Promise<void> {
  const { count, error } = await db.from("plan_swap_requests").select("id", { count: "exact", head: true }).eq("client_domain_id", clientId).eq("status", "pending").lte("effective_on", today);
  if (error || !count) return;
  const n = await applyDueSwaps(db, today);
  if (typeof n === "string") console.warn(`[dash] ${n}`);
}

/** The rows with the plan's paid slots and its open requests on them. A failed read leaves them off, as on a snapshot. */
export async function withPlan(db: SupabaseClient, raw: Raw): Promise<Raw> {
  if (raw.client.tier === "tracked") return raw;
  const [slots, requests] = await Promise.all([
    planSlots(db, raw.client.id, raw.client.tier),
    readPlanRequests(db, raw.client.id).catch((err: unknown) => {
      console.warn(`[dash] ${err instanceof Error ? err.message : String(err)}`);
      return undefined;
    }),
  ]);
  return { ...raw, client: { ...raw.client, plan_slots: slots }, ...(requests ? { planRequests: requests } : {}) };
}
