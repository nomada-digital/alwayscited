import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

import { enginesFor } from "@/config/pricing";
import type { TierKey } from "@/components/TierName";
import { cancelNow, readSubscription } from "@/lib/checkout/stripe";
import { draftBuyingPrompts } from "@/lib/scan/anthropic";
import { readSite } from "@/lib/scan/crawl";
import { readKeywordIntents, readKeywordVolumes } from "@/lib/scan/dataforseo";
import type { Market } from "@/lib/scan/domain";
import { sheetRef } from "@/lib/links/sheet-parse";
import { precheckKeyword } from "@/lib/tracking/add-cluster";
import { adminEdit, adminStop } from "@/lib/tracking/admin-edit";
import { dayAfter, liveOn, trackingDay } from "@/lib/tracking/decide";
import { ANGLES, type Angle, insertCluster, insertKeyword, insertPrompts, readingsFor } from "@/lib/tracking/limits";
import { refuseSlotText } from "@/lib/tracking/prompt-text";
import { dispatchTrackingRun, requestRerun } from "@/lib/tracking/runner";
import { marketDrafts } from "@/lib/tracking/starter-pick";

/**
 * The agency view's edits (Danny, 29 Oct 2026). Nomada staff change a customer from the hub's alwayscited customer
 * page (nomada-dashboards generators/build_ac_view.py), through its edge function alwayscited-admin (staff only:
 * is_agency and a @nomadadigital.co.uk login), which posts here by /api/hub/agency with the staff member's email.
 * Customers never see these controls: nothing on the dashboards host calls this file.
 *
 * Every write is logged in agency_edits - who, when, what, the value before and the value after - and nothing is
 * deleted:
 *
 * - a prompt edited after it has readings is stopped from tomorrow and a new prompt with the new text starts then,
 *   so one prompt's history never mixes two questions (the rule /admin/tracking's edit keeps, admin-edit.ts);
 * - a cluster's keyword is never rewritten in place. changeKeyword stops the cluster from tomorrow with its keyword
 *   and prompts, marks it superseded_by the cluster it makes for the new keyword, and moves the cluster's placements
 *   and target page to the new one. Every reading stays on the old cluster, under the old keyword.
 * - Archive takes a customer off the books (a test signup): it ends the plan, cancels any live Stripe subscription
 *   on its orders now, and leaves every row in place; hub_overview, the daily check, the DIY nights, the lifecycle
 *   sweep and the retention purge all leave an archived customer out.
 */

export type Done = { ok: true; message: string; data?: unknown } | { ok: false; message: string };
export type Client = { id: string; slug: string; domain: string; brand_name: string | null; brand_aliases: string[]; brand_case_sensitive?: boolean; market: string; tier: string; status: string; archived_at: string | null; insertions_sheet_url: string | null; placements_sheet_url: string | null };

const AGENCY_COLUMNS = "id, slug, domain, brand_name, brand_aliases, brand_case_sensitive, market, tier, status, archived_at, archived_by, archived_reason, insertions_sheet_url, placements_sheet_url, cluster_limit, started_on";
export const TIERS = ["tracked", "mentioned", "cited", "everywhere"] as const;
export const STATUSES = ["active", "paused", "ended"] as const;
/** Who wrote a prompt or keyword staff added here, as /admin/tracking writes it. */
const BY = "nomada";

export async function readClient(db: SupabaseClient, slug: string): Promise<Client | string | null> {
  const { data, error } = await db.from("client_domains").select(AGENCY_COLUMNS).eq("slug", slug).maybeSingle();
  if (error) return `Could not read the customer: ${error.message}`;
  return (data as Client | null) ?? null;
}

/** One line of the audit log. Never fatal to the edit it records, but loud: a missing line is a defect. */
export async function audit(db: SupabaseClient, clientId: string, by: string, action: string, target: string | null, oldValue: unknown, newValue: unknown): Promise<void> {
  const { error } = await db.from("agency_edits").insert({ client_domain_id: clientId, actor_email: by, action, target, old_value: oldValue ?? null, new_value: newValue ?? null });
  if (error) console.error(`[agency] audit line not written (${action} on ${clientId} by ${by}): ${error.message}`);
}

type Row = Record<string, unknown>;

/** Everything the agency view's edit panel shows: clusters live and superseded, their prompts, the sheets and the log. */
export async function readAgency(db: SupabaseClient, client: Client): Promise<Done> {
  const [{ data: clRows, error: e1 }, { data: kwRows, error: e2 }, { data: qRows, error: e3 }, { data: syncRows, error: e4 }, { data: linkRows, error: e5 }, { data: editRows, error: e6 }] = await Promise.all([
    db.from("tracked_clusters").select("id, name, tier, keyword_id, started_on, stopped_on, superseded_by, superseded_on, created_at").eq("client_domain_id", client.id).order("created_at", { ascending: true }),
    db.from("tracked_keywords").select("id, keyword, search_volume, intent, cluster_id, added_on, stopped_on").eq("client_domain_id", client.id),
    db.from("tracked_questions").select("id, cluster_id, text, angle, added_on, stopped_on, allowance").eq("client_domain_id", client.id).order("created_at", { ascending: true }),
    db.from("sheet_syncs").select("kind, sheet_url, attempted_at, synced_at, source, read_on, rows_kept, rows_skipped, columns, error").eq("client_domain_id", client.id),
    db.from("sheet_links").select("kind, on_sheet").eq("client_domain_id", client.id),
    db.from("agency_edits").select("id, actor_email, action, target, old_value, new_value, created_at").eq("client_domain_id", client.id).order("created_at", { ascending: false }).limit(60),
  ]);
  const failed = e1 ?? e2 ?? e3 ?? e4 ?? e5 ?? e6;
  if (failed) return { ok: false, message: `Could not read the customer's setup: ${failed.message}` };
  const today = trackingDay();
  const keywords = (kwRows ?? []) as Row[];
  const kwText = new Map(keywords.map((k) => [k.id as string, k]));
  const clusters = ((clRows ?? []) as Row[]).map((c) => {
    const own = (c.keyword_id ? kwText.get(c.keyword_id as string) : null) ?? keywords.find((k) => k.cluster_id === c.id) ?? null;
    return {
      ...c,
      live: c.stopped_on === null || String(c.stopped_on) > today,
      keyword: own ? String(own.keyword) : null,
      keyword_volume: own ? ((own.search_volume as number | null) ?? null) : null,
      prompts: ((qRows ?? []) as Row[]).filter((q) => q.cluster_id === c.id).map((q) => ({ ...q, live: liveOn({ added_on: String(q.added_on), stopped_on: (q.stopped_on as string | null) ?? null }, today) || String(q.added_on) > today })),
    };
  });
  const count = (kind: string) => ((linkRows ?? []) as Row[]).filter((l) => l.kind === kind && l.on_sheet).length;
  return {
    ok: true,
    message: "read",
    data: {
      client,
      today,
      tiers: TIERS,
      statuses: STATUSES,
      clusters,
      syncs: syncRows ?? [],
      links: { insertion: count("insertion"), placement: count("placement") },
      edits: editRows ?? [],
    },
  };
}

const sheetOrNull = (raw: unknown): string | null | false => {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  return sheetRef(s) ? s : false;
};

export async function setSheets(db: SupabaseClient, client: Client, by: string, p: { insertions?: unknown; placements?: unknown }): Promise<Done> {
  const next: Record<string, string | null> = {};
  for (const [field, raw] of [["insertions_sheet_url", p.insertions], ["placements_sheet_url", p.placements]] as const) {
    if (raw === undefined) continue;
    const v = sheetOrNull(raw);
    if (v === false) return { ok: false, message: "That is not a Google Sheets link. Paste the address from the browser: https://docs.google.com/spreadsheets/d/..." };
    if (v !== client[field]) next[field] = v;
  }
  if (!Object.keys(next).length) return { ok: true, message: "Nothing changed." };
  const { error } = await db.from("client_domains").update(next).eq("id", client.id);
  if (error) return { ok: false, message: `Could not save the sheets: ${error.message}` };
  for (const [field, v] of Object.entries(next)) await audit(db, client.id, by, "set_sheet", field, client[field as keyof Client] ?? null, v);
  return { ok: true, message: "Sheets saved. Sync now reads them." };
}

/** The names an answer is read for: the brand, its aliases, and whether the brand counts only as written (namesExactly). */
export async function setBrand(db: SupabaseClient, client: Client, by: string, p: { brand: unknown; aliases: unknown; exactCase: unknown }): Promise<Done> {
  const brand = String(p.brand ?? "").replace(/\s+/g, " ").trim();
  if (brand && (brand.length < 2 || brand.length > 80)) return { ok: false, message: "A brand name is 2 to 80 characters." };
  const raw = Array.isArray(p.aliases) ? p.aliases : String(p.aliases ?? "").split(",");
  const aliases = [...new Set(raw.map((a) => String(a).replace(/\s+/g, " ").trim()).filter(Boolean))];
  if (aliases.length > 10 || aliases.some((a) => a.length < 2 || a.length > 80)) return { ok: false, message: "Up to ten aliases, each 2 to 80 characters." };
  const exact = p.exactCase === true && !!brand;
  const next = { brand_name: brand || null, brand_aliases: aliases, brand_case_sensitive: exact };
  const before = { brand_name: client.brand_name, brand_aliases: client.brand_aliases ?? [], brand_case_sensitive: client.brand_case_sensitive === true };
  if (JSON.stringify(before) === JSON.stringify(next)) return { ok: true, message: "Nothing changed." };
  const { error } = await db.from("client_domains").update(next).eq("id", client.id);
  if (error) return { ok: false, message: `Could not save the brand: ${error.message}` };
  await audit(db, client.id, by, "set_brand", null, before, next);
  return { ok: true, message: `Brand saved; answers are read for it from the next check${exact ? ", counted only where written exactly as typed" : ""}. Readings already taken are not re-scored.` };
}

export async function setTier(db: SupabaseClient, client: Client, by: string, tier: string): Promise<Done> {
  if (!(TIERS as readonly string[]).includes(tier)) return { ok: false, message: "Unknown plan." };
  if (tier === client.tier) return { ok: true, message: "Nothing changed." };
  const { error } = await db.from("client_domains").update({ tier }).eq("id", client.id);
  if (error) return { ok: false, message: `Could not change the plan: ${error.message}` };
  // The clusters the plan works on move with it; a cluster set to another tier by hand keeps its own.
  const { data: moved, error: cErr } = await db.from("tracked_clusters").update({ tier }).eq("client_domain_id", client.id).eq("tier", client.tier).is("stopped_on", null).select("id");
  await audit(db, client.id, by, "set_tier", null, client.tier, tier);
  if (cErr) return { ok: false, message: `Plan changed, but its clusters were not: ${cErr.message}` };
  return { ok: true, message: `Plan changed to ${tier}; ${(moved ?? []).length} cluster${(moved ?? []).length === 1 ? "" : "s"} moved with it. Engines change from the next daily check.` };
}

export async function setStatus(db: SupabaseClient, client: Client, by: string, status: string): Promise<Done> {
  if (!(STATUSES as readonly string[]).includes(status)) return { ok: false, message: "Unknown status." };
  if (status === client.status) return { ok: true, message: "Nothing changed." };
  if (client.archived_at && status !== "ended") return { ok: false, message: "This customer is archived. Restore it first." };
  const { error } = await db.from("client_domains").update({ status }).eq("id", client.id);
  if (error) return { ok: false, message: `Could not change the status: ${error.message}` };
  await audit(db, client.id, by, "set_status", null, client.status, status);
  return { ok: true, message: `Status is now ${status}.` };
}

/** Take a customer off the books: plan ended, any live Stripe subscription cancelled now, every row kept. */
export async function archive(db: SupabaseClient, client: Client, by: string, reason: string): Promise<Done> {
  const why = reason.trim().slice(0, 300);
  if (why.length < 3) return { ok: false, message: "Say why it is archived (a few words)." };
  const { data: orders, error: oErr } = await db.from("orders").select("stripe_subscription_id").eq("client_domain_id", client.id).not("stripe_subscription_id", "is", null);
  if (oErr) return { ok: false, message: `Could not read its orders: ${oErr.message}` };
  const stripe: { id: string; before: string; after: string }[] = [];
  for (const sub of new Set(((orders ?? []) as Row[]).map((o) => String(o.stripe_subscription_id)))) {
    const now = await readSubscription(sub);
    if (!now.ok) return { ok: false, message: `Could not read Stripe subscription ${sub} (${now.reason}${now.status ? ` ${now.status}` : ""}). Nothing was changed.` };
    if (now.status === "canceled" || now.status === "incomplete_expired") {
      stripe.push({ id: sub, before: now.status, after: now.status });
      continue;
    }
    const done = await cancelNow(sub);
    if (!done.ok) return { ok: false, message: `Stripe did not cancel ${sub} (${done.reason}${done.status ? ` ${done.status}` : ""}). Nothing else was changed.` };
    stripe.push({ id: sub, before: now.status, after: done.status });
  }
  const at = new Date().toISOString();
  const { error } = await db.from("client_domains").update({ archived_at: at, archived_by: by, archived_reason: why, status: "ended" }).eq("id", client.id);
  if (error) return { ok: false, message: `Could not archive it: ${error.message}${stripe.length ? ` (Stripe: ${stripe.map((s) => `${s.id} ${s.after}`).join(", ")})` : ""}` };
  await audit(db, client.id, by, "archive", null, { status: client.status, archived_at: null }, { status: "ended", archived_at: at, reason: why, stripe });
  const subs = stripe.length ? ` Stripe: ${stripe.map((s) => `${s.id} ${s.before} -> ${s.after}`).join("; ")}.` : " No Stripe subscription on it.";
  return { ok: true, message: `Archived: left out of the hub, its counts and the daily checks. Nothing was deleted.${subs}` };
}

export async function restore(db: SupabaseClient, client: Client, by: string): Promise<Done> {
  if (!client.archived_at) return { ok: true, message: "It is not archived." };
  const { error } = await db.from("client_domains").update({ archived_at: null, archived_by: null, archived_reason: null }).eq("id", client.id);
  if (error) return { ok: false, message: `Could not restore it: ${error.message}` };
  await audit(db, client.id, by, "restore", null, { archived_at: client.archived_at }, { archived_at: null, status: client.status });
  return { ok: true, message: "Restored to the hub. Its plan is still ended: set the status to active to track it again." };
}

async function liveTexts(db: SupabaseClient, clientId: string): Promise<string[] | string> {
  const { data, error } = await db.from("tracked_questions").select("text").eq("client_domain_id", clientId).is("stopped_on", null);
  return error ? `Could not read the prompts: ${error.message}` : ((data ?? []) as Row[]).map((r) => String(r.text));
}

async function liveCluster(db: SupabaseClient, client: Client, clusterId: string): Promise<Row | string> {
  const { data, error } = await db.from("tracked_clusters").select("id, name, tier, keyword_id, started_on, stopped_on").eq("id", clusterId).eq("client_domain_id", client.id).maybeSingle();
  if (error) return `Could not read the cluster: ${error.message}`;
  if (!data) return "That cluster is not on this customer.";
  if (data.stopped_on !== null) return "That cluster is stopped.";
  return data as Row;
}

const angleOf = (a: unknown): Angle | null => ((ANGLES as readonly string[]).includes(String(a)) ? (String(a) as Angle) : null);

export async function addPrompt(db: SupabaseClient, client: Client, by: string, p: { clusterId: string; text: string; angle?: unknown }): Promise<Done> {
  const c = await liveCluster(db, client, p.clusterId);
  if (typeof c === "string") return { ok: false, message: c };
  const live = await liveTexts(db, client.id);
  if (typeof live === "string") return { ok: false, message: live };
  const text = p.text.trim();
  const bad = refuseSlotText(text, live);
  if (bad) return { ok: false, message: bad };
  const startOn = dayAfter(trackingDay());
  const w = await insertPrompts(db, client.id, p.clusterId, [{ text, angle: angleOf(p.angle), source: BY, origin_kind: "nomada", added_on: startOn, added_by: BY }], { pooled: true });
  if (!w.ok) return { ok: false, message: w.message };
  await audit(db, client.id, by, "add_prompt", w.ids[0]!, null, { cluster_id: p.clusterId, text, angle: angleOf(p.angle) });
  return { ok: true, message: `Added; first read at the ${startOn} daily check.` };
}

export async function editPrompt(db: SupabaseClient, client: Client, by: string, p: { id: string; text: string }): Promise<Done> {
  const { data: q, error } = await db.from("tracked_questions").select("id, cluster_id, text, angle, stopped_on").eq("id", p.id).eq("client_domain_id", client.id).maybeSingle();
  if (error) return { ok: false, message: `Could not read the prompt: ${error.message}` };
  if (!q || q.stopped_on !== null) return { ok: false, message: "That prompt is not live on this customer." };
  const text = p.text.trim();
  if (text === q.text) return { ok: true, message: "Nothing changed." };
  const n = await readingsFor(db, "prompt", p.id);
  if (typeof n === "string") return { ok: false, message: n };
  if (n === 0) {
    const done = await adminEdit(db, { kind: "prompt", clientId: client.id, id: p.id, text });
    if (done.ok) await audit(db, client.id, by, "edit_prompt", p.id, q.text, text);
    return done;
  }
  // Read already: the old one stops, the new one starts, both tomorrow. Refused before either is written.
  const live = await liveTexts(db, client.id);
  if (typeof live === "string") return { ok: false, message: live };
  const bad = refuseSlotText(text, live.filter((t) => t !== q.text));
  if (bad) return { ok: false, message: bad };
  const today = trackingDay();
  const stopped = await adminStop(db, { kind: "prompt", clientId: client.id, id: p.id, today });
  if (!stopped.ok) return stopped;
  const w = await insertPrompts(db, client.id, q.cluster_id as string | null, [{ text, angle: angleOf(q.angle), source: BY, origin_kind: "nomada", added_on: dayAfter(today), added_by: BY }], { pooled: true });
  if (!w.ok) {
    const { error: uErr } = await db.from("tracked_questions").update({ stopped_on: null, stopped_by: null }).eq("id", p.id);
    return { ok: false, message: `Not changed: ${w.message}${uErr ? `. The old prompt is stopped from tomorrow and could not be put back (${uErr.message})` : ""}` };
  }
  await audit(db, client.id, by, "edit_prompt", p.id, q.text, { text, replaced_by: w.ids[0], readings_kept: n });
  return { ok: true, message: `It had ${n} reading${n === 1 ? "" : "s"}, so those stay on the old prompt and the new text starts tomorrow.` };
}

export async function removePrompt(db: SupabaseClient, client: Client, by: string, id: string): Promise<Done> {
  const { data: q, error } = await db.from("tracked_questions").select("text").eq("id", id).eq("client_domain_id", client.id).maybeSingle();
  if (error) return { ok: false, message: `Could not read the prompt: ${error.message}` };
  if (!q) return { ok: false, message: "That prompt is not on this customer." };
  const done = await adminStop(db, { kind: "prompt", clientId: client.id, id, today: trackingDay() });
  if (done.ok) await audit(db, client.id, by, "remove_prompt", id, q.text, null);
  return done;
}

/** Five buying prompts for a keyword, from the customer's site. Nothing is saved: staff read and edit them first. */
export async function draftPrompts(client: Client, keyword: string): Promise<Done> {
  const kw = keyword.trim().toLowerCase();
  if (kw.length < 2) return { ok: false, message: "A keyword is needed to draft prompts." };
  const market = (client.market === "US" ? "US" : "UK") as Market;
  try {
    const siteText = await readSite(client.domain);
    const drafts = await draftBuyingPrompts({ keyword: kw, market, brand: client.brand_name, domain: client.domain, siteText }, { calls: 0 });
    const byAngle = ANGLES.map((a) => drafts.find((d) => d.angle === a) ?? null);
    if (byAngle.some((d) => !d)) throw new Error("not one prompt per angle");
    return { ok: true, message: "Drafted from the site. Edit them, then save.", data: { keyword: kw, drafted_by: "model", prompts: byAngle } };
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    console.warn(`[agency] prompt draft failed for ${client.domain}: ${why}`);
    const prompts = marketDrafts(kw, market).slice(0, ANGLES.length).map((text, i) => ({ angle: ANGLES[i]!, text }));
    return { ok: true, message: `The site could not be read for drafts (${why.slice(0, 120)}), so these are the plain templates. Rewrite them as buying questions before saving.`, data: { keyword: kw, drafted_by: "template", prompts } };
  }
}

type Draft = { text: string; angle: Angle | null };
function readDrafts(raw: unknown, live: readonly string[]): Draft[] | string {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 10) return "Send one to ten prompts.";
  const out: Draft[] = [];
  for (const r of raw) {
    const text = String((r as Row)?.text ?? r ?? "").replace(/\s+/g, " ").trim();
    const bad = refuseSlotText(text, [...live, ...out.map((o) => o.text)]);
    if (bad) return `"${text.slice(0, 60)}": ${bad}`;
    out.push({ text, angle: angleOf((r as Row)?.angle) });
  }
  return out;
}

/** Replace every live prompt in a cluster with these: the old stop tomorrow (their readings stay), the new start then. */
export async function replacePrompts(db: SupabaseClient, client: Client, by: string, p: { clusterId: string; prompts: unknown }): Promise<Done> {
  const c = await liveCluster(db, client, p.clusterId);
  if (typeof c === "string") return { ok: false, message: c };
  const { data: old, error } = await db.from("tracked_questions").select("id, text, angle").eq("client_domain_id", client.id).eq("cluster_id", p.clusterId).is("stopped_on", null).is("allowance", null);
  if (error) return { ok: false, message: `Could not read the cluster's prompts: ${error.message}` };
  const live = await liveTexts(db, client.id);
  if (typeof live === "string") return { ok: false, message: live };
  const oldTexts = new Set(((old ?? []) as Row[]).map((o) => String(o.text)));
  const drafts = readDrafts(p.prompts, live.filter((t) => !oldTexts.has(t)));
  if (typeof drafts === "string") return { ok: false, message: drafts };
  const today = trackingDay();
  const ids = ((old ?? []) as Row[]).map((o) => o.id as string);
  if (ids.length) {
    const { error: sErr } = await db.from("tracked_questions").update({ stopped_on: dayAfter(today), stopped_by: BY }).in("id", ids).is("stopped_on", null);
    if (sErr) return { ok: false, message: `Could not stop the old prompts: ${sErr.message}` };
  }
  const w = await insertPrompts(db, client.id, p.clusterId, drafts.map((d) => ({ ...d, source: BY, origin_kind: "nomada" as const, added_on: dayAfter(today), added_by: BY })), { pooled: true });
  if (!w.ok) {
    const { error: uErr } = ids.length ? await db.from("tracked_questions").update({ stopped_on: null, stopped_by: null }).in("id", ids) : { error: null };
    return { ok: false, message: `Not changed: ${w.message}${uErr ? `. The old prompts are stopped from tomorrow and could not be put back (${uErr.message})` : ""}` };
  }
  await audit(db, client.id, by, "replace_prompts", p.clusterId, (old ?? []).map((o) => ({ id: o.id, text: o.text, angle: o.angle })), drafts);
  return { ok: true, message: `${drafts.length} prompts saved; they start at tomorrow's daily check, and the old ones keep their readings.` };
}

async function measure(keyword: string, market: Market): Promise<{ volume: number | null; intent: string | null; note: string }> {
  try {
    const [v, i] = await Promise.all([readKeywordVolumes([keyword], market, 15_000), readKeywordIntents([keyword], 15_000)]);
    return { volume: v.volumes.get(keyword) ?? null, intent: i.intents.get(keyword) ?? null, note: "" };
  } catch (err) {
    return { volume: null, intent: null, note: ` (volume not read: ${(err instanceof Error ? err.message : String(err)).slice(0, 80)})` };
  }
}

/**
 * Change a cluster's keyword. The old cluster stops from tomorrow with its keyword and prompts, superseded by a new
 * cluster for the new keyword with the prompts given (or drafted from the site when none are). With `rerun`, the new
 * cluster starts today and today's check reads it now; without, it starts at tomorrow's check.
 */
export async function changeKeyword(db: SupabaseClient, client: Client, by: string, p: { clusterId: string; keyword: string; prompts?: unknown; rerun: boolean }): Promise<Done> {
  const old = await liveCluster(db, client, p.clusterId);
  if (typeof old === "string") return { ok: false, message: old };
  const { data: kws, error: kErr } = await db.from("tracked_keywords").select("id, keyword, cluster_id, stopped_on").eq("client_domain_id", client.id).is("stopped_on", null);
  if (kErr) return { ok: false, message: `Could not read the keywords: ${kErr.message}` };
  const oldKws = ((kws ?? []) as Row[]).filter((k) => k.id === old.keyword_id || k.cluster_id === old.id);
  const pre = precheckKeyword(p.keyword, { tracked: ((kws ?? []) as Row[]).filter((k) => !oldKws.includes(k)).map((k) => String(k.keyword)), brands: [client.brand_name ?? "", client.domain].filter(Boolean) });
  if (!pre.ok) return { ok: false, message: pre.message };
  const keyword = pre.keyword;
  if (oldKws.some((k) => String(k.keyword).toLowerCase() === keyword)) return { ok: false, message: "That is already this cluster's keyword." };

  const market = (client.market === "US" ? "US" : "UK") as Market;
  let drafted: Draft[];
  let draftNote = "";
  if (p.prompts !== undefined) {
    const live = await liveTexts(db, client.id);
    if (typeof live === "string") return { ok: false, message: live };
    const { data: oq, error: oqErr } = await db.from("tracked_questions").select("text").eq("cluster_id", old.id as string).is("stopped_on", null);
    if (oqErr) return { ok: false, message: `Could not read the cluster's prompts: ${oqErr.message}` };
    const leaving = new Set(((oq ?? []) as Row[]).map((r) => String(r.text)));
    const d = readDrafts(p.prompts, live.filter((t) => !leaving.has(t)));
    if (typeof d === "string") return { ok: false, message: d };
    drafted = d;
  } else {
    const d = await draftPrompts(client, keyword);
    if (!d.ok) return d;
    const data = d.data as { prompts: Draft[]; drafted_by: string };
    drafted = data.prompts;
    if (data.drafted_by !== "model") draftNote = " The site could not be read, so the prompts are templates: rewrite them.";
  }
  const m = await measure(keyword, market);

  const today = trackingDay();
  const tomorrow = dayAfter(today);
  const start = p.rerun ? today : tomorrow;
  const { data: oldPrompts, error: opErr } = await db.from("tracked_questions").select("id, text, angle").eq("client_domain_id", client.id).eq("cluster_id", old.id as string).is("stopped_on", null);
  if (opErr) return { ok: false, message: `Could not read the cluster's prompts: ${opErr.message}` };
  const stopIds = { cluster: [old.id as string], keywords: oldKws.map((k) => k.id as string), prompts: ((oldPrompts ?? []) as Row[]).map((q) => q.id as string) };
  const stop = { stopped_on: tomorrow };
  /** Put the old cluster back as it was. Says what could not be put back, so a half-done change is never silent. */
  const undo = async (): Promise<string> => {
    const { error: u1 } = await db.from("tracked_clusters").update({ stopped_on: null }).in("id", stopIds.cluster);
    const { error: u2 } = stopIds.keywords.length ? await db.from("tracked_keywords").update({ stopped_on: null, stopped_by: null }).in("id", stopIds.keywords) : { error: null };
    const { error: u3 } = stopIds.prompts.length ? await db.from("tracked_questions").update({ stopped_on: null, stopped_by: null }).in("id", stopIds.prompts) : { error: null };
    const left = u1 ?? u2 ?? u3;
    if (left) console.error(`[agency] change_keyword on ${client.slug}: the old cluster ${String(old.id)} was not fully put back: ${left.message}`);
    return left ? ` The old cluster could not be fully put back (${left.message}); check it in /admin/tracking.` : "";
  };
  // Stopped first, so the new cluster fits the plan's allowance; put back if anything after fails.
  const { error: s1 } = await db.from("tracked_clusters").update(stop).in("id", stopIds.cluster).is("stopped_on", null);
  const { error: s2 } = stopIds.keywords.length ? await db.from("tracked_keywords").update({ ...stop, stopped_by: BY }).in("id", stopIds.keywords) : { error: null };
  const { error: s3 } = stopIds.prompts.length ? await db.from("tracked_questions").update({ ...stop, stopped_by: BY }).in("id", stopIds.prompts) : { error: null };
  const sErr = s1 ?? s2 ?? s3;
  if (sErr) return { ok: false, message: `Could not stop the old cluster: ${sErr.message}.${await undo()}` };
  const made = await insertCluster(db, client.id, { name: keyword, tier: String(old.tier), started_on: start });
  if (!made.ok) return { ok: false, message: `Not changed: ${made.message}.${await undo()}` };
  const newId = made.ids[0]!;
  const kw = await insertKeyword(db, client.id, newId, { keyword, added_on: start, added_by: BY, search_volume: m.volume, intent: m.intent }, { pooled: true });
  const pr = kw.ok ? await insertPrompts(db, client.id, newId, drafted.map((d) => ({ ...d, source: BY, origin_kind: "nomada" as const, added_on: start, added_by: BY })), { pooled: true }) : kw;
  if (!kw.ok || !pr.ok) {
    // The new cluster stops on its start day, so it is never read; the old one is put back. Nothing is deleted.
    const { error: n1 } = await db.from("tracked_clusters").update({ stopped_on: start }).eq("id", newId);
    const { error: n2 } = kw.ok ? await db.from("tracked_keywords").update({ stopped_on: start, stopped_by: BY }).eq("id", kw.ids[0]!) : { error: null };
    const stuck = n1 ?? n2 ? ` The new cluster ${newId} could not be stopped (${(n1 ?? n2)!.message}).` : "";
    return { ok: false, message: `Not changed: ${(pr as { message: string }).message}.${stuck}${await undo()}` };
  }
  const notes: string[] = [];
  const { error: supErr } = await db.from("tracked_clusters").update({ superseded_by: newId, superseded_on: today }).eq("id", old.id as string);
  if (supErr) notes.push(`old cluster not marked superseded (${supErr.message})`);
  const { data: moved, error: pErr } = await db.from("placements").update({ cluster_id: newId, updated_at: new Date().toISOString() }).eq("cluster_id", old.id as string).select("id");
  if (pErr) notes.push(`placements not moved (${pErr.message})`);
  const { data: pages, error: kpErr } = await db.from("key_pages").select("id, cluster_ids").eq("client_domain_id", client.id).contains("cluster_ids", [old.id as string]);
  if (kpErr) notes.push(`target page not moved (${kpErr.message})`);
  for (const pg of (pages ?? []) as Row[]) {
    const ids = [...new Set([...((pg.cluster_ids as string[] | null) ?? []), newId])];
    const { error: e } = await db.from("key_pages").update({ cluster_ids: ids }).eq("id", pg.id as string);
    if (e) notes.push(`target page ${pg.id} not moved (${e.message})`);
  }
  await audit(db, client.id, by, "change_keyword", old.id as string,
    { cluster_id: old.id, name: old.name, keywords: oldKws.map((k) => k.keyword), prompts: ((oldPrompts ?? []) as Row[]).map((q) => ({ text: q.text, angle: q.angle })) },
    { cluster_id: newId, keyword, search_volume: m.volume, intent: m.intent, prompts: drafted, starts: start, placements_moved: (moved ?? []).length, target_pages_moved: (pages ?? []).length });

  let rerunLine = "";
  if (p.rerun) {
    const r = await runChecksNow(db, client, by);
    rerunLine = ` ${r.message}`;
  }
  const vol = m.volume !== null ? ` (${m.volume.toLocaleString("en-GB")}/mo in ${market}${m.intent ? `, ${m.intent}` : ""})` : m.note;
  return {
    ok: true,
    message: `Keyword changed to "${keyword}"${vol}. The old cluster stops tomorrow and keeps its readings, marked superseded.${notes.length ? ` Warning: ${notes.join("; ")}.` : ""}${draftNote}${rerunLine}`,
    data: { cluster_id: newId },
  };
}

/** Today's check for this customer now: a first run if today has none, else a re-run that reads only what has no row yet. */
export async function runChecksNow(db: SupabaseClient, client: Client, by: string): Promise<Done> {
  const day = trackingDay();
  if (client.archived_at || client.status === "ended") return { ok: false, message: "Not re-run: the plan has ended." };
  const { data: qs, error: qErr } = await db.from("tracked_questions").select("added_on, stopped_on").eq("client_domain_id", client.id);
  if (qErr) return { ok: false, message: `Not re-run: could not read the prompts (${qErr.message}).` };
  if (!((qs ?? []) as { added_on: string; stopped_on: string | null }[]).some((q) => liveOn(q, day))) return { ok: false, message: "Not re-run: no prompt is live today." };
  const engines = [...enginesFor((client.tier as TierKey) ?? "tracked")];
  const { error: iErr } = await db.from("tracking_runs").upsert({ client_domain_id: client.id, run_date: day, engines }, { onConflict: "client_domain_id,run_date", ignoreDuplicates: true });
  if (iErr) return { ok: false, message: `Not re-run: could not open today's run (${iErr.message}).` };
  const { data: run, error: rErr } = await db.from("tracking_runs").select("id, run_date, status, error, started_at, step_ms").eq("client_domain_id", client.id).eq("run_date", day).single();
  if (rErr) return { ok: false, message: `Not re-run: could not read today's run (${rErr.message}).` };
  const again = run.status !== "queued";
  if (again) {
    const asked = await requestRerun({ id: run.id as string, run_date: run.run_date as string, status: run.status as string, error: (run.error as string | null) ?? null, started_at: (run.started_at as string | null) ?? null, step_ms: run.step_ms }, day, { changed: true })
      .catch((err: unknown) => ({ ok: false as const, message: err instanceof Error ? err.message : String(err) }));
    if (!asked.ok) return { ok: false, message: `Not re-run: ${asked.message}` };
  }
  try {
    await dispatchTrackingRun(run.id as string);
  } catch (err) {
    return { ok: false, message: `Not re-run: dispatch failed (${err instanceof Error ? err.message : String(err)}).` };
  }
  await audit(db, client.id, by, "run_checks", run.id as string, { status: run.status }, { asked: again ? "re-run" : "first run", engines });
  return { ok: true, message: `Checks dispatched on ${engines.length} engines; the first results land in a few minutes.` };
}
