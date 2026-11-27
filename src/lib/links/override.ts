import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { LINK_LIMITS } from "@/config/contact";
import { audit } from "@/lib/agency/edit";
import { urlKey as placementKey } from "@/lib/tracking/placements";

import { type LinkCheck, checkLink } from "./check";
import { type Override, OVERRIDE_STATUSES, applyOverride, isOverrideStatus, sheetAgrees, stageOfOverride } from "./override-rules";
import { stageOfStatus } from "./stage";

/**
 * Manual overrides on placements and link insertions (25 Nov 2026; 20261125010000_link_overrides.sql). WLDM's sheet is
 * sometimes slow, so the team can mark an item live, change its stage or correct its address and anchor. The sheet
 * sync is not changed to know about it for the sheet's links: the customer's read applies the override over the
 * sheet's row (`overridesFor`), so a sync cannot revert it; the sync only clears it once the sheet agrees
 * (`clearAgreed`). The in-progress items from Kev's master sheet are written by placements_sync, which skips an
 * overridden item itself (sheet-placements.ts) and clears it on agreement. Every change is a line in agency_edits.
 */

export type Result<T = object> = ({ ok: true } & T) | { ok: false; message: string };
const no = (message: string): { ok: false; message: string } => ({ ok: false, message });
const absent = (e: { code?: string; message?: string } | null) => !!e && (e.code === "PGRST205" || e.code === "42P01" || /link_overrides/.test(e.message ?? "") && /schema cache|does not exist/.test(e.message ?? ""));

const COLS = "source, kind, item_key, status, live_url, anchor_text, live_on, note, link_check, active, set_by, set_at, cleared_at, cleared_reason";
export type OverrideRow = Override & { note: string | null; link_check: LinkCheck | null; set_by: string; set_at: string; cleared_at: string | null; cleared_reason: string | null };

/** The client's overrides, every one (the customer's read wants the active ones, the admin view the history of cleared ones too). An absent table is none. */
export async function readOverrides(db: SupabaseClient, clientId: string, opts: { source?: Override["source"]; activeOnly?: boolean } = {}): Promise<OverrideRow[]> {
  let q = db.from("link_overrides").select(COLS).eq("client_domain_id", clientId);
  if (opts.source) q = q.eq("source", opts.source);
  if (opts.activeOnly) q = q.eq("active", true);
  const { data, error } = await q;
  if (error) {
    if (absent(error)) return [];
    throw new Error(`could not read the link overrides: ${error.message}`);
  }
  return (data ?? []) as OverrideRow[];
}

/** The sheet's rows with the active overrides over them: what the customer sees. No flag, note or check leaves this. */
export function withOverrides<T extends { kind: string; url_key: string; live_url: string; anchor_text: string | null; status: string | null; live_on: string | null }>(rows: T[], overrides: Override[]): T[] {
  const by = new Map(overrides.filter((o) => o.active && o.source === "sheet_link").map((o) => [`${o.kind}|${o.item_key}`, o]));
  return rows.map((r) => {
    const o = by.get(`${r.kind}|${r.url_key}`);
    return o ? applyOverride(r, o) : r;
  });
}

const today = () => new Date().toISOString().slice(0, 10);
const isDay = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
const httpUrl = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s || s.length > LINK_LIMITS.url || /\s/.test(s)) return null;
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:" ? s : null;
  } catch {
    return null;
  }
};

export type Client = { id: string; slug: string; domain: string };
export type SetInput = { source: unknown; kind: unknown; key: unknown; status: unknown; live_url?: unknown; anchor_text?: unknown; live_on?: unknown; note?: unknown; check?: unknown };

/** Mark live, change the stage, or correct the address or anchor. One call, one override, one audit line. */
export async function setOverride(db: SupabaseClient, client: Client, by: string, i: SetInput): Promise<Result<{ link_check: LinkCheck | null; stage: string }>> {
  const source = i.source === "progress" ? "progress" : i.source === "sheet_link" ? "sheet_link" : null;
  const kind = i.kind === "insertion" ? "insertion" : i.kind === "placement" ? "placement" : null;
  const key = typeof i.key === "string" && i.key.length >= 1 && i.key.length <= LINK_LIMITS.url ? i.key : null;
  if (!source || !kind || !key) return no("Say which item this is.");
  if (!isOverrideStatus(i.status)) return no(`The stage is one of: ${OVERRIDE_STATUSES.join(", ")}.`);
  const status = i.status;
  const stage = stageOfOverride(status);
  const url = i.live_url === undefined || i.live_url === null || i.live_url === "" ? null : httpUrl(i.live_url);
  if (i.live_url && !url) return no("The live URL must be a full http or https address.");
  const anchor = typeof i.anchor_text === "string" && i.anchor_text.trim() ? i.anchor_text.replace(/\s+/g, " ").trim().slice(0, LINK_LIMITS.anchor) : null;
  const note = typeof i.note === "string" && i.note.trim() ? i.note.trim() : null;
  if (note && note.length > LINK_LIMITS.note) return no(`The note is over ${LINK_LIMITS.note} characters.`);
  const liveOn = i.live_on === undefined || i.live_on === null || i.live_on === "" ? (stage === "live" ? today() : null) : isDay(i.live_on) ? i.live_on : "bad";
  if (liveOn === "bad") return no("The live date must be a day, like 2026-11-24.");
  if (liveOn && liveOn > today()) return no("The live date cannot be in the future.");
  if (stage === "live" && !url) return no("Marking an item live needs its live URL.");

  // The item must exist, and its current state is the "old" in the audit line.
  let before: Record<string, unknown> | null = null;
  type Prog = { id: string; cluster_id: string | null; keyword: string | null };
  let progress = null as Prog | null;
  if (source === "sheet_link") {
    const { data, error } = await db.from("sheet_links").select("live_url, status, live_on, anchor_text").eq("client_domain_id", client.id).eq("kind", kind).eq("url_key", key).maybeSingle();
    if (error) return no(`Could not read the item: ${error.message}`);
    if (!data) return no("That item is not on the synced sheet for this customer.");
    before = data as Record<string, unknown>;
  } else {
    const { data, error } = await db.from("placements_in_progress").select("id, cluster_id, keyword, stage, title").eq("client_domain_id", client.id).eq("placement_ref", key).maybeSingle();
    if (error) return no(`Could not read the item: ${error.message}`);
    if (!data) return no("That in-progress item does not exist for this customer.");
    progress = data as Prog;
    before = { stage: (data as { stage: string }).stage, title: (data as { title: string }).title };
  }

  // Check the link when it is going live (default), on the page we are about to show as live.
  let check: LinkCheck | null = null;
  if (stage === "live" && url && i.check !== false) check = await checkLink(url, client.domain);

  if (source === "progress" && progress) {
    const now = new Date().toISOString();
    if (stage === "live") {
      const k = placementKey(url!);
      if (!k) return no("The live URL is not a page address.");
      if (!progress.cluster_id) return no("This item has no cluster to put the placement on.");
      const { data: have, error: hErr } = await db.from("placements").select("id").eq("client_domain_id", client.id).eq("url_key", k).limit(1);
      if (hErr) return no(`Could not check the customer's placements: ${hErr.message}`);
      if (!(have ?? []).length) {
        const { error } = await db.from("placements").insert({
          client_domain_id: client.id, cluster_id: progress.cluster_id, kind: "guest_post", url: url!, url_key: k, domain: k.split("/")[0]!, status: "live", live_on: liveOn,
          anchor_text: anchor ?? progress.keyword, internal_note: `Marked live by ${by} (${key})`, created_by: `manual (${by})`,
          ...(check ? { link_present: check.found, last_checked_on: check.checked_at.slice(0, 10) } : {}),
        });
        if (error) return no(`Could not add the live placement: ${error.message}`);
      }
    }
    const next = stage === "live" ? "live" : stage === "off" ? "dropped" : status === "Content written" ? "written" : "awaiting";
    const { error } = await db.from("placements_in_progress").update({ stage: next, updated_at: now }).eq("id", progress.id);
    if (error) return no(`Could not move the item: ${error.message}`);
  }

  const now = new Date().toISOString();
  const { error } = await db.from("link_overrides").upsert(
    { client_domain_id: client.id, source, kind, item_key: key, status, live_url: url, anchor_text: anchor, live_on: liveOn, note, link_check: check, active: true, set_by: by, set_at: now, updated_at: now, cleared_at: null, cleared_reason: null },
    { onConflict: "client_domain_id,source,item_key" },
  );
  if (error) {
    return no(absent(error) ? "20261125010000_link_overrides.sql is not applied yet, so an override cannot be saved." : `Could not save the override: ${error.message}`);
  }
  await audit(db, client.id, by, stage === "live" ? "link_mark_live" : "link_set_stage", `${source}:${kind}:${key}`, before, { status, live_url: url, anchor_text: anchor, live_on: liveOn, note, link_check: check ? { found: check.found, ok: check.ok, status: check.status, error: check.error } : null });
  return { ok: true, link_check: check, stage };
}

/** Re-run the link check on an overridden item's live URL and keep the result. */
export async function recheck(db: SupabaseClient, client: Client, by: string, source: string, kind: string, key: string): Promise<Result<{ link_check: LinkCheck }>> {
  const { data, error } = await db.from("link_overrides").select("live_url").eq("client_domain_id", client.id).eq("source", source).eq("kind", kind).eq("item_key", key).maybeSingle();
  if (error) return no(`Could not read the override: ${error.message}`);
  const url = (data as { live_url: string | null } | null)?.live_url;
  if (!url) return no("There is no live URL to check.");
  const check = await checkLink(url, client.domain);
  const { error: uErr } = await db.from("link_overrides").update({ link_check: check, updated_at: new Date().toISOString() }).eq("client_domain_id", client.id).eq("source", source).eq("kind", kind).eq("item_key", key);
  if (uErr) return no(`Could not save the check: ${uErr.message}`);
  await audit(db, client.id, by, "link_check", `${source}:${kind}:${key}`, null, { found: check.found, status: check.status, error: check.error });
  return { ok: true, link_check: check };
}

/**
 * After a sheet sync: an active override whose item the sheet now reads the same way is cleared, and the sheet is the
 * truth again. `rows` are the sheet's rows as just stored. Never thrown: a failed read leaves the override standing.
 */
export async function clearAgreed(db: SupabaseClient, clientId: string, kind: "insertion" | "placement", rows: { url_key: string; live_url: string; status: string | null }[]): Promise<number> {
  try {
    const active = (await readOverrides(db, clientId, { source: "sheet_link", activeOnly: true })).filter((o) => o.kind === kind);
    const agreed = active.filter((o) => sheetAgrees(rows.find((r) => r.url_key === o.item_key) ?? null, o));
    for (const o of agreed) {
      const now = new Date().toISOString();
      const { error } = await db.from("link_overrides").update({ active: false, cleared_at: now, cleared_reason: "WLDM sheet caught up", updated_at: now }).eq("client_domain_id", clientId).eq("source", "sheet_link").eq("kind", kind).eq("item_key", o.item_key);
      if (error) console.error(`[links] override not cleared for ${clientId} ${o.item_key}: ${error.message}`);
      else await audit(db, clientId, "hub sheet sync", "link_override_cleared", `sheet_link:${kind}:${o.item_key}`, { status: o.status }, { reason: "WLDM sheet caught up" });
    }
    return agreed.length;
  } catch (err) {
    console.error(`[links] overrides not checked after a sync for ${clientId}: ${err instanceof Error ? err.message : String(err)}`);
    return 0;
  }
}

/* ---- the internal view ---- */

export type InternalItem = {
  source: "sheet_link" | "progress";
  kind: "insertion" | "placement";
  key: string;
  title: string;
  live_url: string | null;
  anchor_text: string | null;
  target_keyword: string | null;
  sheet_status: string | null;
  stage: "live" | "progress" | "off";
  override: OverrideRow | null;
  /** An active override the sheet does not agree with yet. Internal only. */
  differs: boolean;
  live_on: string | null;
};

/** What the team works from: every item still in progress, and every item with an active override, newest first; with the recent edits. */
export async function listInternal(db: SupabaseClient, client: Client): Promise<Result<{ items: InternalItem[]; recent: { at: string; by: string; action: string; target: string | null }[] }>> {
  try {
    const [{ data: links, error: lErr }, { data: prog, error: pErr }, overrides, { data: edits, error: eErr }] = await Promise.all([
      db.from("sheet_links").select("kind, url_key, live_url, anchor_text, target_keyword, status, live_on, sheet_row").eq("client_domain_id", client.id).eq("on_sheet", true).order("sheet_row"),
      db.from("placements_in_progress").select("placement_ref, title, keyword, stage, expected_month").eq("client_domain_id", client.id).in("stage", ["written", "awaiting", "live", "dropped"]).order("placement_ref"),
      readOverrides(db, client.id),
      db.from("agency_edits").select("created_at, actor_email, action, target").eq("client_domain_id", client.id).in("action", ["link_mark_live", "link_set_stage", "link_override_cleared", "link_check"]).order("created_at", { ascending: false }).limit(30),
    ]);
    if (lErr) return no(`Could not read the sheet's links: ${lErr.message}`);
    const progressMissing = !!pErr && (pErr.code === "PGRST205" || pErr.code === "42P01");
    if (pErr && !progressMissing) return no(`Could not read the in-progress items: ${pErr.message}`);
    if (eErr) console.warn(`[links] recent edits not read: ${eErr.message}`);
    const ov = (s: string, k: string) => overrides.find((o) => o.source === s && o.item_key === k) ?? null;
    const items: InternalItem[] = [];
    for (const r of (links ?? []) as { kind: "insertion" | "placement"; url_key: string; live_url: string; anchor_text: string | null; target_keyword: string | null; status: string | null; live_on: string | null }[]) {
      const o = ov("sheet_link", r.url_key);
      const active = o?.active ? o : null;
      if (stageOfStatus(r.status) !== "progress" && !active) continue;
      items.push({ source: "sheet_link", kind: r.kind, key: r.url_key, title: r.live_url, live_url: active?.live_url ?? r.live_url, anchor_text: active?.anchor_text ?? r.anchor_text, target_keyword: r.target_keyword, sheet_status: r.status, stage: stageOfStatus(active?.status ?? r.status), override: o, differs: !!active && !sheetAgrees(r, active), live_on: active?.live_on ?? r.live_on });
    }
    for (const p of (prog ?? []) as { placement_ref: string; title: string; keyword: string | null; stage: string }[]) {
      const o = ov("progress", p.placement_ref);
      const active = o?.active ? o : null;
      if ((p.stage === "live" || p.stage === "dropped") && !active) continue;
      const sheetStatus = p.stage === "written" ? "Content written" : p.stage === "awaiting" ? "Awaiting publication" : null;
      items.push({ source: "progress", kind: "placement", key: p.placement_ref, title: p.title, live_url: active?.live_url ?? null, anchor_text: active?.anchor_text ?? p.keyword, target_keyword: p.keyword, sheet_status: sheetStatus, stage: p.stage === "live" ? "live" : p.stage === "dropped" ? "off" : "progress", override: o, differs: !!active, live_on: active?.live_on ?? null });
    }
    return { ok: true, items, recent: ((edits ?? []) as { created_at: string; actor_email: string; action: string; target: string | null }[]).map((e) => ({ at: e.created_at, by: e.actor_email, action: e.action, target: e.target })) };
  } catch (err) {
    return no(`Could not read the links: ${err instanceof Error ? err.message : String(err)}`);
  }
}
