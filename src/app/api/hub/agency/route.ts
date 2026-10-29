import { hubAuthorised } from "@/lib/agency/hub-auth";
import { addPrompt, archive, changeKeyword, draftPrompts, editPrompt, readAgency, readClient, removePrompt, replacePrompts, restore, runChecksNow, setSheets, setStatus, setTier } from "@/lib/agency/edit";
import { storeSheet } from "@/lib/links/sheet-store";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// changeKeyword reads the site, drafts with the model, measures the keyword and dispatches the check.
export const maxDuration = 120;

/**
 * The agency view's edits (29 Oct 2026, lib/agency/edit.ts). Server to server only: the hub's edge function
 * alwayscited-admin calls it after checking the caller is agency staff (is_agency and a @nomadadigital.co.uk login),
 * with `x-hub-secret` (HUB_OFFER_SECRET, as /api/hub/offer) or `x-ac-key` (the project key the hub already holds;
 * hub-auth.ts); `by` is that staff member's email, written to the audit log. Its sheet sync, sync-alwayscited-sheets,
 * sends the cells it read (action sheet_cells) the same way. Customers never reach it: the dashboards host has no
 * link here, and neither header is anything a browser holds.
 *
 * POST {action, slug, by, ...} -> {ok, message, data?}
 */
const ACTIONS = new Set(["read", "set_sheets", "set_tier", "set_status", "archive", "restore", "add_prompt", "edit_prompt", "remove_prompt", "draft_prompts", "replace_prompts", "change_keyword", "run_checks", "sheet_cells"]);

export async function POST(req: Request) {
  if (!(await hubAuthorised(req))) return Response.json({ error: "forbidden" }, { status: 403 });

  let b: Record<string, unknown>;
  try {
    b = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }
  const action = typeof b.action === "string" ? b.action : "";
  const slug = typeof b.slug === "string" && /^[a-z0-9-]{1,80}$/.test(b.slug) ? b.slug : null;
  const by = typeof b.by === "string" ? b.by.trim().toLowerCase() : "";
  if (!ACTIONS.has(action) || !slug) return Response.json({ error: "bad_request" }, { status: 400 });
  // The hub's sheet schedule runs as itself; every other caller is a staff member the edge function named.
  if (action !== "sheet_cells" && !/^[^@\s]+@nomadadigital\.co\.uk$/.test(by)) return Response.json({ error: "staff_only" }, { status: 403 });

  const db = supabaseAdmin();
  const client = await readClient(db, slug);
  if (typeof client === "string") return Response.json({ error: client }, { status: 502 });
  if (!client) return Response.json({ error: "not_found" }, { status: 404 });
  const str = (k: string) => (typeof b[k] === "string" ? (b[k] as string) : "");
  const id = (k: string) => (/^[0-9a-f-]{36}$/.test(str(k)) ? str(k) : "");

  const done = await (async () => {
    switch (action) {
      case "read":
        return readAgency(db, client);
      case "set_sheets":
        return setSheets(db, client, by, { insertions: b.insertions, placements: b.placements });
      case "set_tier":
        return setTier(db, client, by, str("tier"));
      case "set_status":
        return setStatus(db, client, by, str("status"));
      case "archive":
        return archive(db, client, by, str("reason"));
      case "restore":
        return restore(db, client, by);
      case "add_prompt":
        return addPrompt(db, client, by, { clusterId: id("cluster_id"), text: str("text"), angle: b.angle });
      case "edit_prompt":
        return editPrompt(db, client, by, { id: id("id"), text: str("text") });
      case "remove_prompt":
        return removePrompt(db, client, by, id("id"));
      case "draft_prompts":
        return draftPrompts(client, str("keyword"));
      case "replace_prompts":
        return replacePrompts(db, client, by, { clusterId: id("cluster_id"), prompts: b.prompts });
      case "change_keyword":
        return changeKeyword(db, client, by, { clusterId: id("cluster_id"), keyword: str("keyword"), prompts: b.prompts, rerun: b.rerun === true });
      case "run_checks":
        return runChecksNow(db, client, by);
      case "sheet_cells": {
        const kind = b.kind === "insertion" || b.kind === "placement" ? b.kind : null;
        if (!kind) return { ok: false as const, message: "kind is insertion or placement" };
        const source = str("source").slice(0, 60) || null;
        const incoming = Array.isArray(b.cells)
          ? { cells: b.cells as unknown[][], source: source ?? "hub", readOn: /^\d{4}-\d{2}-\d{2}$/.test(str("read_on")) ? str("read_on") : null }
          : { error: str("error").slice(0, 500) || "The hub sent no cells.", source };
        const r = await storeSheet(db, client, kind, incoming);
        if (by) console.log(`[sheets] ${slug} ${kind} synced by ${by}: ${r.message}`);
        return r;
      }
    }
    return { ok: false as const, message: "unknown action" };
  })().catch((err: unknown) => ({ ok: false as const, message: `Failed: ${err instanceof Error ? err.message : String(err)}` }));

  return Response.json(done, { status: done.ok ? 200 : 422 });
}

/** Server to server only. */
export function GET() {
  return Response.json({ error: "method_not_allowed" }, { status: 405, headers: { allow: "POST" } });
}
