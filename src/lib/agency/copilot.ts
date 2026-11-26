import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

import { type Client, type Done, audit } from "@/lib/agency/edit";
import { copilotView } from "@/lib/dash/copilot";

/**
 * Copilot citations, the agency side (26 Nov 2026). The hub pushes one snapshot per client (the shape of generators/bing_ai_export.py)
 * through /api/hub/agency copilot_publish; an empty snapshot removes the client's card data. Every change is an agency_edits line.
 */
const WAITING = "Copilot switches on once 20261126020000_client_copilot.sql is applied.";
const missing = (e: { code?: string; message?: string } | null) => !!e && (e.code === "PGRST205" || e.code === "42P01" || /client_copilot/.test(e.message ?? ""));

export async function copilotPublish(db: SupabaseClient, client: Client, by: string, snapshot: unknown): Promise<Done> {
  if (snapshot === null || snapshot === undefined) {
    const { error } = await db.from("client_copilot").delete().eq("client_domain_id", client.id);
    if (missing(error)) return { ok: false, message: WAITING };
    if (error) return { ok: false, message: `Not removed: ${error.message}` };
    await audit(db, client.id, by, "copilot_publish", null, null, { removed: true });
    return { ok: true, message: "Copilot data removed: the card shows its empty state." };
  }
  if (JSON.stringify(snapshot).length > 200_000) return { ok: false, message: "That snapshot is too large." };
  const v = copilotView(snapshot);
  if (!v) return { ok: false, message: "That snapshot has no citations or pages to show." };
  const { error } = await db.from("client_copilot").upsert({ client_domain_id: client.id, snapshot, as_of: v.asOf, updated_by: by, updated_at: new Date().toISOString() }, { onConflict: "client_domain_id" });
  if (missing(error)) return { ok: false, message: WAITING };
  if (error) return { ok: false, message: `Not saved: ${error.message}` };
  await audit(db, client.id, by, "copilot_publish", null, null, { as_of: v.asOf, total: v.total });
  return { ok: true, message: `Copilot: ${v.total} citations to ${v.asOf}.`, data: { url: `https://dashboards.alwayscited.com/${client.slug}/ai#copilot` } };
}
