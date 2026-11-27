import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Done } from "@/lib/agency/edit";

import { listInternal, recheck, setOverride } from "./override";

/**
 * The internal path to the link overrides (25 Nov 2026): what /api/hub/agency takes for them, for the hub, Dispatch and
 * Noma - server to server, staff only, `by` written to agency_edits. /admin/links is the same writes with a form.
 *
 *   links_list    {slug}                                  -> every item in progress or overridden, with the sheet's
 *                                                            status, the override and `differs`
 *   links_set     {slug, by, source: "sheet_link"|"progress", kind: "placement"|"insertion", key, status,
 *                  live_url?, anchor_text?, live_on? (default today when live), note?, check? (default true when live)}
 *                                                         -> marks live / sets the stage / corrects the address or anchor
 *   links_check   {slug, by, source, kind, key}           -> re-runs the "is our link on the page" check
 *
 * `status` is one of Content written, Awaiting publication, Published, Live, Not live. Live and Published need live_url.
 */
export const LINK_ACTIONS = ["links_list", "links_set", "links_check"] as const;
export const isLinkAction = (a: string): boolean => (LINK_ACTIONS as readonly string[]).includes(a);

export async function linkAction(db: SupabaseClient, client: { id: string; slug: string; domain: string }, by: string, action: string, b: Record<string, unknown>): Promise<Done> {
  if (action === "links_list") {
    const r = await listInternal(db, client);
    return r.ok ? { ok: true, message: `${r.items.length} item${r.items.length === 1 ? "" : "s"}.`, data: r } : { ok: false, message: r.message };
  }
  if (action === "links_set") {
    const r = await setOverride(db, client, by, { source: b.source, kind: b.kind, key: b.key, status: b.status, live_url: b.live_url, anchor_text: b.anchor_text, live_on: b.live_on, note: b.note, check: b.check });
    if (!r.ok) return { ok: false, message: r.message };
    const c = r.link_check;
    return { ok: true, message: r.stage === "live" ? `Marked live. ${c ? (c.found ? `Link check passed: ${c.href}` : `Link check FAILED: ${c.error}`) : "Link not checked."}` : "Saved.", data: { link_check: c, stage: r.stage } };
  }
  if (action === "links_check") {
    const r = await recheck(db, client, by, String(b.source ?? ""), String(b.kind ?? ""), String(b.key ?? ""));
    return r.ok ? { ok: true, message: r.link_check.found ? `Link check passed: ${r.link_check.href}` : `Link check failed: ${r.link_check.error}`, data: r.link_check } : { ok: false, message: r.message };
  }
  return { ok: false, message: "unknown action" };
}
