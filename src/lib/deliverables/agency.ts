import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Done } from "@/lib/agency/edit";

import { filesOf } from "./core";
import { advance, createDeliverable, editDeliverable, readInternalDeliverables, setVisible } from "./store";

/**
 * The internal path to deliverables (25 Nov 2026): the actions /api/hub/agency takes for them, for Dispatch, Noma and
 * the hub - server to server, staff only, `by` written to the trail. /admin/deliverables is the same writes with a
 * form. Everything a deliverable may do is in store.ts; this only reads a request body.
 *
 *   deliverable_list      {slug}                         -> every deliverable of the customer, drafts and history
 *   deliverable_create    {slug, by, delivered_by: "nomada"|"client", title, findings, evidence_url?, plan_item_id?,
 *                          files: [{filename, body}] | markdown + filename}   -> {id}. Created HIDDEN.
 *   deliverable_edit      {slug, by, id, title, findings, evidence_url?, reason, expect?, files?}
 *                                                        -> a NEW version; the old one is kept. No files = same files.
 *   deliverable_publish   {slug, by, id}                 -> shows it to the customer (visible_to_customer)
 *   deliverable_unpublish {slug, by, id}                 -> back to a draft
 *   deliverable_deliver   {slug, by, id, note?}          -> status delivered (handed over)
 *   deliverable_complete  {slug, by, id, evidence_url, note?} -> status completed; the link is required for "nomada"
 */
export const DELIVERABLE_ACTIONS = ["deliverable_list", "deliverable_create", "deliverable_edit", "deliverable_publish", "deliverable_unpublish", "deliverable_deliver", "deliverable_complete"] as const;
export const isDeliverableAction = (a: string): boolean => (DELIVERABLE_ACTIONS as readonly string[]).includes(a);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function deliverableAction(db: SupabaseClient, client: { id: string; slug: string; domain: string }, by: string, action: string, b: Record<string, unknown>): Promise<Done> {
  if (action === "deliverable_list") {
    const r = await readInternalDeliverables({ slug: client.slug }, db);
    return r.ok ? { ok: true, message: `${r.items.length} deliverable${r.items.length === 1 ? "" : "s"}.`, data: r.items } : { ok: false, message: r.message };
  }

  if (action === "deliverable_create") {
    const r = await createDeliverable({ clientId: client.id, deliveredBy: b.delivered_by, by, title: b.title, findings: b.findings, evidenceUrl: b.evidence_url, files: filesOf(b), planItemId: typeof b.plan_item_id === "string" && UUID.test(b.plan_item_id) ? b.plan_item_id : null }, db);
    return r.ok ? { ok: true, message: `Created for ${client.domain}, hidden from the customer until you publish it.`, data: { id: r.id, visible_to_customer: false } } : { ok: false, message: r.message };
  }

  const id = typeof b.id === "string" && UUID.test(b.id) ? b.id : null;
  if (!id) return { ok: false, message: "A deliverable id is needed." };
  // Every other action names a deliverable: it must be this customer's.
  const { data: own, error } = await db.from("deliverables").select("id, current_version").eq("id", id).eq("client_domain_id", client.id).maybeSingle();
  if (error) return { ok: false, message: `Could not read the deliverable: ${error.message}` };
  if (!own) return { ok: false, message: `No such deliverable for ${client.domain}.` };

  switch (action) {
    case "deliverable_edit": {
      const expect = typeof b.expect === "number" ? b.expect : (own as { current_version: number }).current_version;
      const r = await editDeliverable({ id, expect, by, title: b.title, findings: b.findings, evidenceUrl: b.evidence_url, files: filesOf(b), reason: b.reason }, db);
      return r.ok ? { ok: true, message: `Saved as version ${r.version}. The earlier versions are kept.`, data: { version: r.version } } : { ok: false, message: r.message };
    }
    case "deliverable_publish":
    case "deliverable_unpublish": {
      const r = await setVisible(id, action === "deliverable_publish", by, db);
      return r.ok ? { ok: true, message: action === "deliverable_publish" ? "Shared with the customer." : "Back to a draft: the customer no longer sees it." } : { ok: false, message: r.message };
    }
    case "deliverable_deliver":
    case "deliverable_complete": {
      const r = await advance(id, action === "deliverable_deliver" ? "delivered" : "completed", { by, note: b.note, url: b.evidence_url }, db);
      return r.ok ? { ok: true, message: `Marked ${r.status}.`, data: { status: r.status } } : { ok: false, message: r.message };
    }
  }
  return { ok: false, message: "unknown action" };
}
