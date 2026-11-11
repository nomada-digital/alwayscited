import { hubAuthorised } from "@/lib/agency/hub-auth";
import { addPrompt, archive, setBrand, changeKeyword, draftPrompts, editPrompt, readAgency, readClient, removePrompt, replacePrompts, restore, runChecksNow, setClusterLimit, setSheets, setStatus, setTier } from "@/lib/agency/edit";
import { placementsSync, readItems } from "@/lib/agency/sheet-placements";
import { targetRead, targetSet } from "@/lib/agency/targets";
import { teamChange, teamRead } from "@/lib/agency/team";
import { storeSheet } from "@/lib/links/sheet-store";
import { budgetCap, budgetRead, budgetWeight, contextRead, contextSave, overrideClear, overrideSet, shortlistDecide, shortlistRead, shortlistRun, spendRecord } from "@/lib/csm/agency";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { trackingDay } from "@/lib/tracking/decide";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// changeKeyword reads the site, drafts with the model, measures the keyword and dispatches the check. A shortlist run
// reads Fatgrid pages and vets each one's hosts; it stops buying pages at RUN_MS (180s) so it ends inside this, and
// this stays under the scan pipeline's 270s ceiling (run-duration.test.mts), so it needs no exemption there.
export const maxDuration = 240;

/**
 * The agency view's edits (29 Oct 2026, lib/agency/edit.ts). Server to server only: the hub's edge function
 * alwayscited-admin calls it after checking the caller is agency staff (is_agency and a @nomadadigital.co.uk login),
 * with `x-hub-secret` (HUB_OFFER_SECRET, as /api/hub/offer) or `x-ac-key` (the project key the hub already holds;
 * hub-auth.ts); `by` is that staff member's email, written to the audit log. Its sheet sync, sync-alwayscited-sheets,
 * sends the cells it read (action sheet_cells) the same way. Customers never reach it: the dashboards host has no
 * link here, and neither header is anything a browser holds.
 *
 * team_read, team_invite, team_role and team_remove (10 Nov 2026, lib/agency/team.ts) are a customer's team: team.ts's
 * rules with the staff member as the actor, the same writers and invite email as Settings, and an agency_edits line each.
 *
 * POST {action, slug, by, ...} -> {ok, message, data?}
 */
const ACTIONS = new Set(["shortlist_read", "shortlist_run", "shortlist_decide", "spend_record", "context_read", "context_save", "override_set", "override_clear", "budget_weight", "budget_cap", "read", "set_brand", "set_sheets", "set_tier", "set_cluster_limit", "set_status", "archive", "restore", "add_prompt", "edit_prompt", "remove_prompt", "draft_prompts", "replace_prompts", "change_keyword", "run_checks", "sheet_cells", "budget_read", "placements_sync", "target_read", "target_set", "team_read", "team_invite", "team_role", "team_remove"]);

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
  // The hub's sheet schedule runs as itself; budget_read (10 Nov) and target_read (11 Nov 2026) are the finder's and brief's reads; placements_sync (11 Nov) is the sheet job's.
  if (action !== "sheet_cells" && action !== "budget_read" && action !== "target_read" && action !== "placements_sync" && !/^[^@\s]+@nomadadigital\.co\.uk$/.test(by)) return Response.json({ error: "staff_only" }, { status: 403 });

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
      // The placement shortlist and its budget (5 Nov 2026, lib/csm/agency.ts). Agency only: prices, DRs and spend go
      // to the hub's agency view in this answer and nowhere else.
      case "shortlist_read":
        return shortlistRead(db, client);
      case "shortlist_run":
        return shortlistRun(db, client, by, id("cluster_id"), b.unit_cap);
      case "shortlist_decide":
        return shortlistDecide(db, client, by, { id: id("id"), decision: b.decision, note: str("note"), reason: b.reason });
      case "spend_record":
        return spendRecord(db, client, by, { itemId: id("item_id"), amount: b.amount_usd, description: str("description"), month: str("month") });
      case "context_read":
        return contextRead(db, client);
      case "context_save":
        return contextSave(db, client, by, str("notes"));
      case "override_set":
        return overrideSet(db, client, by, { id: id("id"), start: str("start_month"), end: str("end_month"), amount: b.monthly_usd, reason: str("reason") });
      case "override_clear":
        return overrideClear(db, client, by, id("id"));
      case "budget_weight":
        return budgetWeight(db, client, by, { weight: b.weight, excluded: b.excluded });
      // Each live cluster's target page, a suggestion where none is set (11 Nov 2026, lib/agency/targets.ts).
      case "target_read":
        return targetRead(db, client);
      case "target_set":
        return targetSet(db, client, by, { clusterId: id("cluster_id"), url: str("url"), confirmed: b.confirmed === true });
      // Live placements from Kev's master sheet (sg-89, 11 Nov 2026, lib/agency/sheet-placements.ts), sent by the hub's sheet job.
      case "placements_sync":
        return placementsSync(db, client, readItems(b.items), trackingDay());
      case "budget_read":
        return budgetRead(db, client);
      case "budget_cap":
        return budgetCap(db, client, by, b.cap_usd);
      case "set_sheets":
        return setSheets(db, client, by, { insertions: b.insertions, placements: b.placements });
      case "set_brand":
        return setBrand(db, client, by, { brand: b.brand, aliases: b.aliases, exactCase: b.exact_case });
      case "set_tier":
        return setTier(db, client, by, str("tier"));
      case "set_cluster_limit":
        return setClusterLimit(db, client, by, b.cluster_limit);
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
        return replacePrompts(db, client, by, { clusterId: id("cluster_id"), prompts: b.prompts, rerun: b.rerun === true });
      case "change_keyword":
        return changeKeyword(db, client, by, { clusterId: id("cluster_id"), keyword: str("keyword"), prompts: b.prompts, rerun: b.rerun === true });
      case "run_checks":
        return runChecksNow(db, client, by);
      // A customer's team (10 Nov 2026, lib/agency/team.ts): team.ts's rules with the staff member as the actor.
      case "team_read":
        return teamRead(db, client);
      case "team_invite":
        return teamChange(db, client, by, "invite", b);
      case "team_role":
        return teamChange(db, client, by, "role", b);
      case "team_remove":
        return teamChange(db, client, by, "remove", b);
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
