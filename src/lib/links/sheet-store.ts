import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

import { type LinkKind, type SheetLink, parseLinkSheet } from "./sheet-parse";

/**
 * A synced sheet into sheet_links and sheet_syncs (29 Oct 2026; sheet-parse.ts reads the cells). The agency hub sends
 * the cells (POST /api/hub/agency, action sheet_cells) on its morning schedule and on the agency view's Sync now.
 *
 * Rows are matched by the live URL. A row no longer on the sheet is kept with on_sheet false and leaves the client's
 * dashboard; it is never deleted, so a row removed by mistake comes back as it was on the next sync. A sync that
 * fails - the sheet unreadable, no header row - writes its error and leaves the rows as the last good sync left them.
 */

export type Incoming = { cells: unknown[][]; source: string; readOn: string | null } | { error: string; source: string | null };

const KIND_FIELD: Record<LinkKind, "insertions_sheet_url" | "placements_sheet_url"> = { insertion: "insertions_sheet_url", placement: "placements_sheet_url" };

export async function storeSheet(
  db: SupabaseClient,
  client: { id: string; domain: string; brand_name: string | null; brand_aliases?: string[] | null; slug: string } & Record<string, unknown>,
  kind: LinkKind,
  incoming: Incoming,
): Promise<{ ok: boolean; message: string }> {
  const now = new Date().toISOString();
  const sheetUrl = (client[KIND_FIELD[kind]] as string | null | undefined) ?? null;
  const status = async (fields: Record<string, unknown>): Promise<void> => {
    const { error } = await db.from("sheet_syncs").upsert({ client_domain_id: client.id, kind, sheet_url: sheetUrl, attempted_at: now, ...fields }, { onConflict: "client_domain_id,kind" });
    if (error) console.error(`[sheets] sync status not written for ${client.slug} ${kind}: ${error.message}`);
  };

  if ("error" in incoming) {
    await status({ error: incoming.error.slice(0, 500), source: incoming.source });
    return { ok: false, message: incoming.error };
  }
  const parsed = parseLinkSheet(incoming.cells, { domain: client.domain, brand: client.brand_name, aliases: client.brand_aliases ?? [], slug: client.slug });
  if (parsed.error) {
    await status({ error: parsed.error, source: incoming.source, read_on: incoming.readOn, columns: parsed.columns });
    return { ok: false, message: parsed.error };
  }
  const rows = parsed.rows.map((r: SheetLink) => ({ ...r, client_domain_id: client.id, kind, on_sheet: true, synced_at: now }));
  if (rows.length) {
    const { error } = await db.from("sheet_links").upsert(rows, { onConflict: "client_domain_id,kind,url_key" });
    if (error) {
      await status({ error: `Rows not saved: ${error.message}`, source: incoming.source, read_on: incoming.readOn });
      return { ok: false, message: error.message };
    }
  }
  const keep = new Set(rows.map((r) => r.url_key));
  const { data: held, error: hErr } = await db.from("sheet_links").select("id, url_key").eq("client_domain_id", client.id).eq("kind", kind).eq("on_sheet", true);
  if (hErr) console.error(`[sheets] rows off the sheet not checked for ${client.slug} ${kind}: ${hErr.message}`);
  else {
    const gone = (held ?? []).filter((h) => !keep.has(h.url_key as string)).map((h) => h.id as string);
    const { error: gErr } = gone.length ? await db.from("sheet_links").update({ on_sheet: false }).in("id", gone) : { error: null };
    if (gErr) console.error(`[sheets] ${gone.length} rows off the sheet not hidden for ${client.slug} ${kind}: ${gErr.message}`);
  }
  const skipped = parsed.skipped.other_client + parsed.skipped.no_url + parsed.skipped.repeats;
  await status({ synced_at: now, error: null, source: incoming.source, read_on: incoming.readOn, rows_kept: rows.length, rows_skipped: skipped, columns: parsed.columns });
  return { ok: true, message: `${rows.length} ${kind === "insertion" ? "insertion" : "placement"} row${rows.length === 1 ? "" : "s"} synced${skipped ? `, ${skipped} skipped (other clients, repeats or no URL)` : ""}.` };
}

export type LinkRow = SheetLink & { kind: LinkKind };

/** What the client's dashboard shows: the rows on the sheet now, newest live first. No cost column exists to read. */
export async function readLinks(db: SupabaseClient, clientId: string): Promise<{ rows: LinkRow[]; syncedAt: Record<LinkKind, string | null> }> {
  const [{ data, error }, { data: syncs, error: sErr }] = await Promise.all([
    db
      .from("sheet_links")
      .select("kind, url_key, live_url, linking_domain, target_keyword, anchor_text, target_page, authority, authority_label, page_traffic, status, live_on, live_month, sheet_row")
      .eq("client_domain_id", clientId)
      .eq("on_sheet", true)
      .order("live_on", { ascending: false, nullsFirst: false })
      .order("sheet_row", { ascending: true }),
    db.from("sheet_syncs").select("kind, synced_at").eq("client_domain_id", clientId),
  ]);
  if (error) throw new Error(`could not read the links: ${error.message}`);
  if (sErr) console.warn(`[dash] link sync dates not read: ${sErr.message}`);
  const at = (k: LinkKind) => ((syncs ?? []).find((s) => s.kind === k)?.synced_at as string | null | undefined) ?? null;
  return { rows: (data ?? []) as LinkRow[], syncedAt: { insertion: at("insertion"), placement: at("placement") } };
}
