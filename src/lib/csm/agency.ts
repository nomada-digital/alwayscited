import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { audit } from "@/lib/agency/edit";

import { type ClientWeight, type MonthBudget, type Override, type OverrideRange, checkRange, monthBudget, overrideFor, wouldBreach } from "./allocation";
import { monthlyUnitCap, runBudget } from "./fatgrid";
import { buildShortlist } from "./shortlist";
import { unitsThisMonth } from "./usage";

/**
 * The placement shortlist's agency actions (phase 1, 5 Nov 2026), reached only through /api/hub/agency - staff,
 * server to server (hub-auth.ts). AGENCY ONLY: prices, DRs, budgets and spend leave this module only in that
 * route's answer to the hub's agency view. Every change is written to agency_edits.
 */
type Client = { id: string; domain: string };
type Done = { ok: true; message: string; data?: unknown } | { ok: false; message: string };

/** Placement tiers: alwaysmentioned and the alwayscited plan. alwaystracked is data only, with no deliverables. */
const PLACEMENT_TIERS = ["mentioned", "cited"];

export const monthOf = (d = new Date()) => `${d.toISOString().slice(0, 7)}-01`;
const isMonth = (s: string) => /^\d{4}-\d{2}-01$/.test(s);
const money = (v: unknown) => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 1_000_000 ? Math.round(n * 100) / 100 : null;
};

/** The whole month: the cap, every eligible client's allocation, spend against both. */
export async function readMonthBudget(db: SupabaseClient, month = monthOf()): Promise<MonthBudget> {
  const next = new Date(`${month}T00:00:00Z`);
  next.setUTCMonth(next.getUTCMonth() + 1);
  const [
    { data: settingsRow, error: settingsErr },
    { data: clientRows, error: clientsErr },
    { data: orderRows, error: ordersErr },
    { data: weightRows, error: weightsErr },
    { data: overrideRows, error: overridesErr },
    { data: spendRows, error: spendErr },
  ] = await Promise.all([
    db.from("placement_budget_settings").select("global_cap_usd").eq("id", true).maybeSingle(),
    db.from("client_domains").select("id, domain, tier").eq("status", "active").is("archived_at", null).in("tier", PLACEMENT_TIERS),
    db.from("orders").select("client_domain_id, monthly_amount, currency, created_at").not("client_domain_id", "is", null).order("created_at", { ascending: false }),
    db.from("placement_budgets").select("client_domain_id, weight_override, excluded"),
    // Every range, filtered here: a client has a handful at most, and "covers this month" is two open-ended bounds.
    db.from("placement_budget_overrides").select("id, client_domain_id, start_month, end_month, monthly_usd, approved_by"),
    db.from("placement_spend").select("client_domain_id, amount_usd").eq("month", month),
  ]);
  const err = settingsErr ?? clientsErr ?? ordersErr ?? weightsErr ?? overridesErr ?? spendErr;
  if (err) throw new Error(`could not read the placement budget: ${err.message}`);
  const latest = new Map<string, { monthly_amount: number | null; currency: string | null }>();
  for (const o of orderRows ?? []) if (!latest.has(o.client_domain_id as string)) latest.set(o.client_domain_id as string, { monthly_amount: o.monthly_amount === null ? null : Number(o.monthly_amount) / 100, currency: (o.currency as string | null) ?? null });
  const w = new Map((weightRows ?? []).map((r) => [r.client_domain_id as string, r]));
  const list: ClientWeight[] = (clientRows ?? []).map((c) => ({
    clientId: c.id as string,
    planMonthly: latest.get(c.id as string)?.monthly_amount ?? null,
    planCurrency: latest.get(c.id as string)?.currency ?? null,
    weightOverride: w.get(c.id as string)?.weight_override === null || w.get(c.id as string)?.weight_override === undefined ? null : Number(w.get(c.id as string)!.weight_override),
    excluded: w.get(c.id as string)?.excluded === true,
  }));
  const spent = new Map<string, number>();
  for (const s of spendRows ?? []) spent.set(s.client_domain_id as string, (spent.get(s.client_domain_id as string) ?? 0) + Number(s.amount_usd));
  const cap = settingsRow?.global_cap_usd === null || settingsRow?.global_cap_usd === undefined ? null : Number(settingsRow.global_cap_usd);
  const ranges = new Map<string, OverrideRange[]>();
  for (const o of overrideRows ?? []) ranges.set(o.client_domain_id as string, [...(ranges.get(o.client_domain_id as string) ?? []), rangeOf(o)]);
  const overrides = new Map<string, Override>();
  for (const [id, rs] of ranges) {
    const r = overrideFor(month, rs);
    if (r) overrides.set(id, { amount: r.monthlyUsd, approvedBy: r.approvedBy });
  }
  const b = monthBudget({ cap, clients: list, overrides, spent });
  // Warnings name clients by domain for staff; allocation.ts only knows ids.
  const names = new Map((clientRows ?? []).map((c) => [c.id as string, c.domain as string]));
  return { ...b, warnings: b.warnings.map((w) => w.replace(/^([0-9a-f-]{36}):/, (m, id: string) => `${names.get(id) ?? id}:`)) };
}

const rangeOf = (o: Record<string, unknown>): OverrideRange => ({
  id: o.id as string,
  startMonth: (o.start_month as string | null) ?? null,
  endMonth: (o.end_month as string | null) ?? null,
  monthlyUsd: Number(o.monthly_usd),
  approvedBy: o.approved_by as string,
});

export async function shortlistRead(db: SupabaseClient, client: Client): Promise<Done> {
  const [{ data: itemRows, error: itemsErr }, { data: runRows, error: runsErr }, budget, units] = await Promise.all([
    db.from("shortlist_items").select("id, cluster_id, domain, page_url, kind, queue_month, price_usd, dr, traffic, cited_by, score, client_visible, own_site, state, first_run_id, last_run_id, decided_by, decided_at, note").eq("client_domain_id", client.id).order("queue_month").order("score", { ascending: false }).limit(300),
    db.from("shortlist_runs").select("id, cluster_id, keyword, reason, dr_floor, dr_floor_source, serp_read_on, units_used, outcome, note, created_at").eq("client_domain_id", client.id).order("created_at", { ascending: false }).limit(12),
    readMonthBudget(db),
    unitsThisMonth(db),
  ]);
  if (itemsErr ?? runsErr) return { ok: false, message: `Could not read the shortlist: ${(itemsErr ?? runsErr)!.message}` };
  const lastRun = runRows?.[0]?.id ?? null;
  return {
    ok: true,
    message: "ok",
    data: {
      items: (itemRows ?? []).map((i) => ({ ...i, new_since_last_run: lastRun !== null && i.first_run_id === lastRun })),
      runs: runRows ?? [],
      budget: { month: monthOf(), mine: budget.clients.find((c) => c.clientId === client.id) ?? null, total: { cap: budget.cap, allocated: budget.allocated, spent: budget.spent, remaining: budget.remaining, breach: budget.breach }, warnings: budget.warnings },
      units: { used: units, monthlyCap: monthlyUnitCap(), perRunCap: runBudget().cap },
    },
  };
}

export async function shortlistRun(db: SupabaseClient, client: Client, by: string, clusterId: string, unitCap?: unknown): Promise<Done> {
  const cap = unitCap === undefined || unitCap === null || unitCap === "" ? undefined : Number(unitCap);
  if (cap !== undefined && !(Number.isInteger(cap) && cap >= 0)) return { ok: false, message: "A unit cap is a whole number, at most the per-run cap." };
  const { data: clusters, error } = await db.from("tracked_clusters").select("id, name").eq("client_domain_id", client.id).is("stopped_on", null);
  if (error) return { ok: false, message: `Could not read the clusters: ${error.message}` };
  const targets = (clusters ?? []).filter((c) => !clusterId || c.id === clusterId);
  if (!targets.length) return { ok: false, message: "No live cluster to build a shortlist for." };
  const lines: string[] = [];
  for (const c of targets) {
    const r = await buildShortlist(db, { clientId: client.id, clusterId: c.id as string, reason: "manual", unitCap: cap });
    lines.push(`${c.name}: ${r.outcome}, ${r.items.length} items (${r.added} new, ${r.dropped} dropped), ${r.units} units, DR floor ${r.floor.floor} from ${r.floor.source === "serp" ? "the SERP" : "the default"}`);
    if (r.outcome === "capped" || r.outcome === "no_key") break;
  }
  await audit(db, client.id, by, "shortlist_run", clusterId || null, null, lines);
  return { ok: true, message: lines.join("; ") };
}

export async function shortlistDecide(db: SupabaseClient, client: Client, by: string, p: { id: string; decision: unknown; note: string }): Promise<Done> {
  const decision = p.decision === "approve" ? "approved" : p.decision === "reject" ? "rejected" : null;
  if (!decision || !p.id) return { ok: false, message: "Approve or reject one item." };
  const { data: item, error } = await db.from("shortlist_items").select("id, domain, kind, price_usd, state").eq("id", p.id).eq("client_domain_id", client.id).maybeSingle();
  if (error || !item) return { ok: false, message: error ? `Could not read the item: ${error.message}` : "No such item on this client." };
  const { error: wErr } = await db.from("shortlist_items").update({ state: decision, decided_by: by, decided_at: new Date().toISOString(), note: p.note.slice(0, 500) || undefined, updated_at: new Date().toISOString() }).eq("id", p.id);
  if (wErr) return { ok: false, message: `Not saved: ${wErr.message}` };
  await audit(db, client.id, by, `shortlist_${decision}`, item.domain as string, item.state, decision);
  const warn = decision === "approved" && item.price_usd !== null ? wouldBreach(await readMonthBudget(db), client.id, Number(item.price_usd)) : [];
  return { ok: true, message: `${item.domain} ${decision}.${warn.length ? ` Buying it ${warn.join(" and ")}.` : ""}`, data: { warnings: warn } };
}

export async function spendRecord(db: SupabaseClient, client: Client, by: string, p: { itemId: string; amount: unknown; description: string; month: string }): Promise<Done> {
  const amount = money(p.amount);
  const month = p.month && isMonth(p.month) ? p.month : monthOf();
  if (amount === null || p.description.trim().length < 2) return { ok: false, message: "An amount in USD and a description." };
  const { error } = await db.from("placement_spend").insert({ client_domain_id: client.id, month, shortlist_item_id: p.itemId || null, amount_usd: amount, description: p.description.trim().slice(0, 300), recorded_by: by });
  if (error) return { ok: false, message: `Not saved: ${error.message}` };
  if (p.itemId) {
    const { error: iErr } = await db.from("shortlist_items").update({ state: "bought", updated_at: new Date().toISOString() }).eq("id", p.itemId).eq("client_domain_id", client.id);
    if (iErr) console.warn(`[csm] spend recorded but item ${p.itemId} not marked bought: ${iErr.message}`);
  }
  await audit(db, client.id, by, "placement_spend", p.itemId || null, null, { month, amount });
  const b = await readMonthBudget(db, month);
  return { ok: true, message: `Recorded.${b.warnings.length ? ` ${b.warnings.join(" ")}` : ""}`, data: { warnings: b.warnings } };
}

/**
 * The client's commercial context (Danny, 5 Nov 2026): notes on the deal, and its placement budget overrides - each a
 * monthly amount over an optional start and end month. An override may deliberately exceed the client's share and the
 * global cap; it is never refused, only shown, "over cap by $X, approved by <name>". A month has one override at most.
 */
export async function contextRead(db: SupabaseClient, client: Client): Promise<Done> {
  const [{ data: note, error: nErr }, { data: rows, error: oErr }, budget] = await Promise.all([
    db.from("client_commercial_context").select("notes, updated_by, updated_at").eq("client_domain_id", client.id).maybeSingle(),
    db.from("placement_budget_overrides").select("id, start_month, end_month, monthly_usd, reason, approved_by, created_at, updated_at").eq("client_domain_id", client.id).order("start_month", { ascending: true, nullsFirst: true }),
    readMonthBudget(db),
  ]);
  if (nErr ?? oErr) return { ok: false, message: `Could not read the commercial context: ${(nErr ?? oErr)!.message}` };
  const mine = budget.clients.find((c) => c.clientId === client.id) ?? null;
  return {
    ok: true,
    message: "ok",
    data: {
      notes: note?.notes ?? "",
      notesUpdatedBy: note?.updated_by ?? null,
      notesUpdatedAt: note?.updated_at ?? null,
      overrides: rows ?? [],
      month: { month: monthOf(), mine, cap: budget.cap, allocated: budget.allocated, overCapBy: budget.overCapBy, approvals: budget.approvals, warnings: budget.warnings },
    },
  };
}

export async function contextSave(db: SupabaseClient, client: Client, by: string, notes: string): Promise<Done> {
  const text = notes.trim();
  if (text.length > 4000) return { ok: false, message: "Notes are 4,000 characters at most." };
  const { data: before, error: bErr } = await db.from("client_commercial_context").select("notes").eq("client_domain_id", client.id).maybeSingle();
  if (bErr) return { ok: false, message: `Could not read the notes: ${bErr.message}` };
  const { error } = await db.from("client_commercial_context").upsert({ client_domain_id: client.id, notes: text, updated_by: by, updated_at: new Date().toISOString() }, { onConflict: "client_domain_id" });
  if (error) return { ok: false, message: `Not saved: ${error.message}` };
  await audit(db, client.id, by, "commercial_context", null, before?.notes ?? null, text);
  return { ok: true, message: "Saved." };
}

export async function overrideSet(db: SupabaseClient, client: Client, by: string, p: { id: string; start: string; end: string; amount: unknown; reason: string }): Promise<Done> {
  const startMonth = p.start || null;
  const endMonth = p.end || null;
  if ((startMonth && !isMonth(startMonth)) || (endMonth && !isMonth(endMonth))) return { ok: false, message: "Months as their first day (YYYY-MM-01), or empty for open-ended." };
  const amount = money(p.amount);
  const reason = p.reason.trim();
  if (amount === null || reason.length < 3) return { ok: false, message: "A monthly amount in USD and a reason." };
  const { data: rows, error: oErr } = await db.from("placement_budget_overrides").select("id, client_domain_id, start_month, end_month, monthly_usd, approved_by").eq("client_domain_id", client.id);
  if (oErr) return { ok: false, message: `Could not read the overrides: ${oErr.message}` };
  const fit = checkRange({ id: p.id || undefined, startMonth, endMonth }, (rows ?? []).map(rangeOf));
  if (!fit.ok) return fit;
  const row = { client_domain_id: client.id, start_month: startMonth, end_month: endMonth, monthly_usd: amount, reason: reason.slice(0, 300), approved_by: by, updated_at: new Date().toISOString() };
  const before = p.id ? (rows ?? []).find((r) => r.id === p.id) ?? null : null;
  if (p.id && !before) return { ok: false, message: "That override is not this client's." };
  const { error } = p.id ? await db.from("placement_budget_overrides").update(row).eq("id", p.id).eq("client_domain_id", client.id) : await db.from("placement_budget_overrides").insert(row);
  if (error) return { ok: false, message: `Not saved: ${error.message}` };
  await audit(db, client.id, by, "budget_override", p.id || null, before, row);
  const b = await readMonthBudget(db);
  const mine = b.clients.find((c) => c.clientId === client.id);
  const over = mine && mine.overridden && mine.overShareBy > 0 ? ` This month it is $${mine.overShareBy} over the client's share${b.overCapBy > 0 ? `; the month is over cap by $${b.overCapBy}, approved by ${b.approvals.join(", ")}` : ""}.` : "";
  return { ok: true, message: `Override saved.${over}`, data: { warnings: b.warnings } };
}

export async function overrideClear(db: SupabaseClient, client: Client, by: string, id: string): Promise<Done> {
  if (!id) return { ok: false, message: "Which override?" };
  const { data: before, error } = await db.from("placement_budget_overrides").delete().eq("id", id).eq("client_domain_id", client.id).select("start_month, end_month, monthly_usd, reason, approved_by").maybeSingle();
  if (error) return { ok: false, message: `Not cleared: ${error.message}` };
  if (!before) return { ok: false, message: "That override is not this client's." };
  await audit(db, client.id, by, "budget_override_cleared", id, before, null);
  return { ok: true, message: "Override cleared: this client's share is by plan price again for those months." };
}

export async function budgetWeight(db: SupabaseClient, client: Client, by: string, p: { weight: unknown; excluded: unknown }): Promise<Done> {
  const weight = p.weight === null || p.weight === "" || p.weight === undefined ? null : money(p.weight);
  if (p.weight !== null && p.weight !== "" && p.weight !== undefined && weight === null) return { ok: false, message: "A weight is a number, or empty for the plan price." };
  const { error } = await db.from("placement_budgets").upsert({ client_domain_id: client.id, weight_override: weight, excluded: p.excluded === true, updated_by: by, updated_at: new Date().toISOString() }, { onConflict: "client_domain_id" });
  if (error) return { ok: false, message: `Not saved: ${error.message}` };
  await audit(db, client.id, by, "budget_weight", null, null, { weight, excluded: p.excluded === true });
  return { ok: true, message: "Saved." };
}

/** The global cap. Staff only, through the hub; the amount lives in the database, never in this repository. */
export async function budgetCap(db: SupabaseClient, client: Client, by: string, amount: unknown): Promise<Done> {
  const cap = money(amount);
  if (cap === null) return { ok: false, message: "The cap is an amount in USD." };
  const { error } = await db.from("placement_budget_settings").upsert({ id: true, global_cap_usd: cap, updated_by: by, updated_at: new Date().toISOString() }, { onConflict: "id" });
  if (error) return { ok: false, message: `Not saved: ${error.message}` };
  await audit(db, client.id, by, "budget_cap", null, null, cap);
  return { ok: true, message: "The global placement cap is saved." };
}
