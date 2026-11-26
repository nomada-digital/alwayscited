import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

import { type Client, type Done, audit } from "@/lib/agency/edit";
import { trackingDay } from "@/lib/tracking/decide";

/**
 * "Mark as live" in the agency view (26 Nov 2026): staff say a placement or a link insertion is live when the sheet and
 * the checks have not caught up. Two targets, both reached only through /api/hub/agency, staff only, an agency_edits
 * line each:
 *
 * - a `placement` (placements): status becomes live and live_on is today, or the day staff give (never in the future);
 *   a row keeps the date it already has. It then shows on the customer's Your links.
 * - a `sheet_link` (sheet_links): `state` becomes live. State is ours and the customer page reads it ahead of the
 *   sheet's free-text status (links/stage.ts); a sheet sync never writes it, so the override survives the next sync.
 *   live_on is set only where the row has none, and is overwritten by the sheet's own date on the next sync.
 *
 * links_read lists what can be marked: each placement not yet live and every sheet row, with the stage the customer sees.
 */
const UUID = /^[0-9a-f-]{36}$/;
const isDay = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
const missing = (e: { code?: string; message?: string } | null) => !!e && (e.code === "PGRST204" || e.code === "42703" || /state/.test(e.message ?? ""));

export async function linksRead(db: SupabaseClient, client: Client): Promise<Done> {
  const [{ data: placements, error: pErr }, { data: sheet, error: sErr }] = await Promise.all([
    db.from("placements").select("id, kind, url, domain, status, live_on, anchor_text").eq("client_domain_id", client.id).order("created_at", { ascending: false }).limit(200),
    db.from("sheet_links").select("id, kind, live_url, linking_domain, status, state, live_on, link_present, last_checked_on, on_sheet").eq("client_domain_id", client.id).eq("on_sheet", true).order("sheet_row", { ascending: true }).limit(500),
  ]);
  if (pErr) return { ok: false, message: `Could not read the placements: ${pErr.message}` };
  if (sErr) return { ok: false, message: `Could not read the sheet links: ${sErr.message}` };
  return { ok: true, message: `${(placements ?? []).length} placements, ${(sheet ?? []).length} sheet links.`, data: { placements: placements ?? [], sheet_links: sheet ?? [] } };
}

export async function markLive(db: SupabaseClient, client: Client, by: string, p: { target: string; id: string; liveOn: string }): Promise<Done> {
  if (!UUID.test(p.id)) return { ok: false, message: "Which row?" };
  const today = trackingDay();
  if (p.liveOn && (!isDay(p.liveOn) || p.liveOn > today)) return { ok: false, message: "The live date is a day up to today, as YYYY-MM-DD." };

  if (p.target === "placement") {
    const { data: row, error } = await db.from("placements").select("id, url, status, live_on").eq("id", p.id).eq("client_domain_id", client.id).maybeSingle();
    if (error) return { ok: false, message: `Could not read the placement: ${error.message}` };
    if (!row) return { ok: false, message: "That placement is not this customer's." };
    if (!row.url) return { ok: false, message: "A placement needs its live page address before it can be marked live." };
    if (row.status === "live") return { ok: true, message: "Already live." };
    const liveOn = (row.live_on as string | null) ?? (p.liveOn || today);
    const { error: uErr } = await db.from("placements").update({ status: "live", live_on: liveOn, updated_at: new Date().toISOString() }).eq("id", p.id);
    if (uErr) return { ok: false, message: `Not saved: ${uErr.message}` };
    await audit(db, client.id, by, "mark_live", `placement:${p.id}`, { status: row.status, live_on: row.live_on }, { status: "live", live_on: liveOn });
    return { ok: true, message: `Marked live (${liveOn}). It shows on the customer's Your links.` };
  }

  if (p.target === "sheet_link") {
    const { data: row, error } = await db.from("sheet_links").select("id, state, status, live_on").eq("id", p.id).eq("client_domain_id", client.id).maybeSingle();
    if (missing(error)) return { ok: false, message: "sheet_links.state is not there yet: apply 20261106000000_csm_batch_a.sql." };
    if (error) return { ok: false, message: `Could not read the link: ${error.message}` };
    if (!row) return { ok: false, message: "That link is not this customer's." };
    if (row.state === "live") return { ok: true, message: "Already live." };
    const { error: uErr } = await db.from("sheet_links").update({ state: "live", ...(row.live_on ? {} : { live_on: p.liveOn || today }) }).eq("id", p.id);
    if (uErr) return { ok: false, message: `Not saved: ${uErr.message}` };
    await audit(db, client.id, by, "mark_live", `sheet_link:${p.id}`, { state: row.state, status: row.status, live_on: row.live_on }, { state: "live", live_on: row.live_on ?? (p.liveOn || today) });
    return { ok: true, message: "Marked live. The customer's Your links shows it as Live, whatever the sheet says; a sync does not undo it." };
  }
  return { ok: false, message: "Mark a placement or a sheet link." };
}
