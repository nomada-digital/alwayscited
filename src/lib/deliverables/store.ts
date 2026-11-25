import "server-only";

import { createHash } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { mention } from "@/config/team";
import { SITE_ORIGIN } from "@/lib/app-host";
import { dashFixturePath } from "@/lib/dash/fixture";
import { isSampleClient } from "@/lib/dash/host";
import { absent } from "@/lib/dash/load";
import { postToChannel } from "@/lib/slack";
import { supabaseAdmin } from "@/lib/supabase/admin";

import {
  type CustomerDeliverable,
  type DeliveredBy,
  type DeliverableFile,
  type Status,
  type TrailEvent,
  DELIVERED_BY,
  cleanFiles,
  cleanFindings,
  cleanNote,
  cleanTitle,
  cleanUrl,
  customerEvent,
  refuseStatus,
  tickNotice,
} from "./core";
import { sampleDeliverables } from "./sample";

/**
 * Deliverables, read and written (25 Nov 2026; the rules are core.ts, the tables and what they enforce are
 * 20261125000000_deliverables.sql). Service role, every customer-side read and write scoped to the client the caller
 * has already been authorised for.
 *
 * Every change of status, visibility or version leaves an event row by itself - the migration's triggers write it from
 * the `changed_*` stamp each update here carries - so nothing in this file writes an event, and nothing here deletes
 * or overwrites a version.
 */

export type Result<T = object> = ({ ok: true } & T) | { ok: false; message: string; status?: number };
const no = (message: string, status = 422): { ok: false; message: string; status: number } => ({ ok: false, message, status });

/** Who an actor is, for the stamp: staff are the ones with a Nomada address, the rest are customers. */
export const isStaff = (email: string): boolean => /^[^@\s]+@nomadadigital\.co\.uk$/i.test(email);
const kindOf = (by: string): "customer" | "nomada" => (isStaff(by) ? "nomada" : "customer");

const STAFF_ONLY = "Only Nomada staff can do that.";

const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const filesJson = (files: DeliverableFile[]) => files.map((f) => ({ filename: f.filename, content_type: f.contentType, body: f.body, sha256: sha(f.body) }));

const db = (d?: SupabaseClient) => d ?? supabaseAdmin();
const dbErr = (what: string, e: { message: string }) => no(`Could not ${what}: ${e.message}`, 502);

/* ---- internal writes ---- */

export type NewDeliverable = { clientId: string; deliveredBy: unknown; by: string; title: unknown; findings: unknown; evidenceUrl?: unknown; files?: unknown; planItemId?: string | null };

/** Create a deliverable, hidden from the customer, at version 1 with its files. All or nothing (deliverable_create). */
export async function createDeliverable(p: NewDeliverable, client?: SupabaseClient): Promise<Result<{ id: string }>> {
  if (!isStaff(p.by)) return no(STAFF_ONLY, 403);
  const deliveredBy = DELIVERED_BY.find((x) => x === p.deliveredBy);
  if (!deliveredBy) return no("Say who delivers it: nomada or client.");
  const title = cleanTitle(p.title);
  if (!title) return no("A title of 1 to 200 characters is needed.");
  const findings = cleanFindings(p.findings);
  if (!findings) return no("A findings summary is needed (up to 20,000 characters of Markdown).");
  const evidence = p.evidenceUrl === undefined || p.evidenceUrl === null || p.evidenceUrl === "" ? null : cleanUrl(p.evidenceUrl);
  if (p.evidenceUrl && !evidence) return no("The evidence link must be a full http or https address.");
  const files = cleanFiles(p.files);
  if (typeof files === "string") return no(files);
  if (!files.length) return no("Attach at least one file (the Markdown the customer copies).");
  const { data, error } = await db(client).rpc("deliverable_create", {
    p_client: p.clientId,
    p_delivered_by: deliveredBy,
    p_by: p.by,
    p_kind: kindOf(p.by),
    p_title: title,
    p_findings: findings,
    p_evidence_url: evidence,
    p_files: filesJson(files),
    p_plan_item: p.planItemId ?? null,
  });
  if (error) return dbErr("create the deliverable", error);
  return { ok: true, id: String(data) };
}

export type DeliverableEdit = { id: string; expect: number; by: string; title: unknown; findings: unknown; evidenceUrl?: unknown; files?: unknown; reason: unknown };

/** Edit = a new version. `files` omitted keeps the previous version's files. The earlier versions stay. */
export async function editDeliverable(p: DeliverableEdit, client?: SupabaseClient): Promise<Result<{ version: number }>> {
  if (!isStaff(p.by)) return no(STAFF_ONLY, 403);
  const title = cleanTitle(p.title);
  if (!title) return no("A title of 1 to 200 characters is needed.");
  const findings = cleanFindings(p.findings);
  if (!findings) return no("A findings summary is needed.");
  const evidence = p.evidenceUrl === undefined || p.evidenceUrl === null || p.evidenceUrl === "" ? null : cleanUrl(p.evidenceUrl);
  if (p.evidenceUrl && !evidence) return no("The evidence link must be a full http or https address.");
  const reason = cleanNote(p.reason);
  if (reason === undefined || reason === null) return no("Say what changed and why (up to 1,000 characters): it is kept with the version.");
  let files: ReturnType<typeof filesJson> | null = null;
  if (p.files !== undefined && p.files !== null) {
    const f = cleanFiles(p.files);
    if (typeof f === "string") return no(f);
    if (!f.length) return no("Attach at least one file, or leave the files as they were.");
    files = filesJson(f);
  }
  const { data, error } = await db(client).rpc("deliverable_edit", {
    p_id: p.id,
    p_expect: p.expect,
    p_by: p.by,
    p_kind: kindOf(p.by),
    p_title: title,
    p_findings: findings,
    p_evidence_url: evidence,
    p_files: files,
    p_reason: reason,
  });
  if (error) return /changed while you were editing/.test(error.message) ? no(error.message, 409) : dbErr("save the new version", error);
  return { ok: true, version: Number(data) };
}

type Row = { id: string; client_domain_id: string; delivered_by: DeliveredBy; status: Status; visible_to_customer: boolean };

async function readRow(d: SupabaseClient, id: string): Promise<Row | null | string> {
  const { data, error } = await d.from("deliverables").select("id, client_domain_id, delivered_by, status, visible_to_customer").eq("id", id).maybeSingle();
  if (error) return error.message;
  return (data as Row | null) ?? null;
}

/** "Publish to customer" (visible true) or take it back to a draft (false). Nothing else changes. */
export async function setVisible(id: string, visible: boolean, by: string, client?: SupabaseClient): Promise<Result> {
  if (!isStaff(by)) return no(STAFF_ONLY, 403);
  const d = db(client);
  const row = await readRow(d, id);
  if (typeof row === "string") return dbErr("read the deliverable", { message: row });
  if (!row) return no("No such deliverable.", 404);
  if (row.visible_to_customer === visible) return no(visible ? "It is already shared with the customer." : "It is already a draft.");
  const { error } = await d.from("deliverables").update({ visible_to_customer: visible, changed_by: by, changed_kind: kindOf(by), changed_note: null, changed_url: null }).eq("id", id).eq("visible_to_customer", !visible);
  return error ? dbErr("change what the customer sees", error) : { ok: true };
}

/** Our side moves it on: delivered (handed over) or completed. Completing what we make needs an evidence link. */
export async function advance(id: string, to: Status, p: { by: string; note?: unknown; url?: unknown }, client?: SupabaseClient): Promise<Result<{ status: Status }>> {
  // The customer's own completion is tickDeliverable, never this.
  if (!isStaff(p.by)) return no(STAFF_ONLY, 403);
  const d = db(client);
  const row = await readRow(d, id);
  if (typeof row === "string") return dbErr("read the deliverable", { message: row });
  if (!row) return no("No such deliverable.", 404);
  const note = cleanNote(p.note);
  if (note === undefined) return no("The note is over 1,000 characters.");
  const url = p.url === undefined || p.url === null || p.url === "" ? null : cleanUrl(p.url);
  if (p.url && !url) return no("The link must be a full http or https address.");
  const why = refuseStatus({ deliveredBy: row.delivered_by, status: row.status }, to, url);
  if (why) return no(why);
  const { data, error } = await d
    .from("deliverables")
    .update({ status: to, changed_by: p.by, changed_kind: kindOf(p.by), changed_note: note, changed_url: url })
    .eq("id", id)
    .eq("status", row.status)
    .select("id");
  if (error) return dbErr("update the status", error);
  if (!(data ?? []).length) return no("It changed while you were doing that. Reload and look again.", 409);
  return { ok: true, status: to };
}

/* ---- the customer's tick ---- */

/**
 * The customer's tick (core.ts canTick): the deliverable must be this client's, shared with them, theirs to do and not
 * done. Records who and when (the trigger stamps completed_by and completed_at from `by`), with the note and the link
 * to the live page if they gave them, then tells the customer success manager on Slack. A Slack failure never fails
 * the tick; the trail has it either way.
 */
export async function tickDeliverable(p: { clientId: string; domain: string; id: string; by: string; note: unknown; url: unknown }, client?: SupabaseClient): Promise<Result<{ slack: boolean }>> {
  const d = db(client);
  const { data: found, error: fErr } = await d.from("deliverables").select("id, client_domain_id, delivered_by, status, visible_to_customer, current_version").eq("id", p.id).eq("client_domain_id", p.clientId).eq("visible_to_customer", true).maybeSingle();
  if (fErr) return dbErr("read the deliverable", fErr);
  const row = found as (Row & { current_version: number }) | null;
  if (!row) return no("Not found.", 404);
  if (row.delivered_by !== "client") return no("We make this change ourselves, so there is nothing for you to tick.", 403);
  if (row.status === "completed") return no("This is already marked as done.");
  const note = cleanNote(p.note);
  if (note === undefined) return no("Keep the note under 1,000 characters.");
  const url = p.url === undefined || p.url === null || p.url === "" ? null : cleanUrl(p.url);
  if (p.url && !url) return no("The page link must be a full address starting with https://");
  const { data, error } = await d
    .from("deliverables")
    .update({ status: "completed", changed_by: p.by, changed_kind: "customer", changed_note: note, changed_url: url })
    .eq("id", p.id)
    .eq("client_domain_id", p.clientId)
    .eq("status", row.status)
    .select("id");
  if (error) return dbErr("save that", error);
  if (!(data ?? []).length) return no("Someone has just marked this as done. Reload to see it.", 409);
  const { data: v, error: vErr } = await d.from("deliverable_versions").select("title").eq("deliverable_id", p.id).eq("version", row.current_version).maybeSingle();
  // The tick is already saved: a title that cannot be read only makes the notice less specific.
  if (vErr) console.warn(`[dash] deliverable title for the notice could not be read: ${vErr.message}`);
  const title = (v as { title: string } | null)?.title ?? "a deliverable";
  const s = await postToChannel(`${mention("kev")} ${tickNotice({ domain: p.domain, title, by: p.by, note, url, adminUrl: `${SITE_ORIGIN}/admin/deliverables#${p.id}` })}`);
  return { ok: true, slack: s.posted };
}

/* ---- reads ---- */

type EventRow = { deliverable_id: string; at: string; actor: string; actor_kind: TrailEvent["actorKind"]; event: string; from_status: string | null; to_status: string | null; version: number | null; note: string | null; url: string | null; id: number };
const trailOf = (e: EventRow): TrailEvent => ({ at: e.at, actor: e.actor, actorKind: e.actor_kind, event: e.event, toStatus: e.to_status, version: e.version, note: e.note, url: e.url });

export type Read<T> = { ok: true; items: T[] } | { ok: false };

/**
 * What the customer sees: the deliverables shared with them, each at its current version, with the trail from when it
 * was shared. A drafts is never returned. The generated sample client has its own; a local fixture run has none; a
 * failed read is `{ ok: false }` so the page says so rather than reading as empty (an absent table is empty).
 */
export async function readCustomerDeliverables(clientId: string, client?: SupabaseClient): Promise<Read<CustomerDeliverable>> {
  if (isSampleClient(clientId)) return { ok: true, items: sampleDeliverables() };
  if (!client && dashFixturePath()) return { ok: true, items: [] };
  return loadViews(db(client), (q) => q.eq("client_domain_id", clientId).eq("visible_to_customer", true));
}

/** One deliverable as the customer would see it, drafts included: /admin/deliverables/preview. Never used on the customer's side. */
export async function readPreview(id: string, client?: SupabaseClient): Promise<CustomerDeliverable | null> {
  const r = await loadViews(db(client), (q) => q.eq("id", id));
  return r.ok ? (r.items[0] ?? null) : null;
}

async function loadViews(d: SupabaseClient, filter: (q: any) => any): Promise<Read<CustomerDeliverable>> { // eslint-disable-line @typescript-eslint/no-explicit-any
  try {
    const { data, error } = await filter(
      d.from("deliverables").select("id, delivered_by, status, current_version, created_at, published_at, delivered_at, completed_at, completed_by, completion_note, completion_url"),
    )
      .order("published_at", { ascending: false })
      .limit(200);
    if (error) {
      if (absent(error)) return { ok: true, items: [] };
      throw new Error(error.message);
    }
    const rows = (data ?? []) as { id: string; delivered_by: DeliveredBy; status: Status; current_version: number; created_at: string; published_at: string | null; delivered_at: string | null; completed_at: string | null; completed_by: string | null; completion_note: string | null; completion_url: string | null }[];
    if (!rows.length) return { ok: true, items: [] };
    const ids = rows.map((r) => r.id);
    const [{ data: vData, error: vErr }, { data: fData, error: fErr }, { data: eData, error: eErr }] = await Promise.all([
      d.from("deliverable_versions").select("deliverable_id, version, title, findings_md, evidence_url").in("deliverable_id", ids),
      d.from("deliverable_files").select("deliverable_id, version, position, filename, content_type, body").in("deliverable_id", ids).order("position"),
      d.from("deliverable_events").select("id, deliverable_id, at, actor, actor_kind, event, from_status, to_status, version, note, url").in("deliverable_id", ids).order("at").order("id"),
    ]);
    const failed = vErr ?? fErr ?? eErr;
    if (failed) throw new Error(failed.message);
    const versions = (vData ?? []) as { deliverable_id: string; version: number; title: string; findings_md: string; evidence_url: string | null }[];
    const files = (fData ?? []) as { deliverable_id: string; version: number; filename: string; content_type: string; body: string }[];
    const events = (eData ?? []) as EventRow[];
    const items: CustomerDeliverable[] = [];
    for (const r of rows) {
      const v = versions.find((x) => x.deliverable_id === r.id && x.version === r.current_version);
      if (!v) continue;
      const completedEvent = r.status === "completed" ? [...events].reverse().find((e) => e.deliverable_id === r.id && e.event === "status" && e.to_status === "completed") : undefined;
      items.push({
        id: r.id,
        title: v.title,
        findingsMd: v.findings_md,
        evidenceUrl: v.evidence_url,
        deliveredBy: r.delivered_by,
        status: r.status,
        version: r.current_version,
        visible: true,
        createdAt: r.created_at,
        publishedAt: r.published_at,
        deliveredAt: r.delivered_at,
        completedAt: r.completed_at,
        completedBy: r.completed_by,
        completedByKind: completedEvent?.actor_kind ?? null,
        completionNote: r.completion_note,
        completionUrl: r.completion_url,
        files: files.filter((f) => f.deliverable_id === r.id && f.version === r.current_version).map((f) => ({ filename: f.filename, contentType: f.content_type, body: f.body })),
        trail: events.filter((e) => e.deliverable_id === r.id && customerEvent(e)).map(trailOf),
      });
    }
    return { ok: true, items };
  } catch (err) {
    console.warn(`[dash] deliverables read failed: ${err instanceof Error ? err.message : String(err)}`);
    return { ok: false };
  }
}

/** How many deliverables the customer can see, for the sidebar: 0 on any failure, so the item never shows a broken section. */
export async function countCustomerDeliverables(clientId: string, client?: SupabaseClient): Promise<{ total: number; open: number }> {
  const r = await readCustomerDeliverables(clientId, client);
  if (!r.ok) return { total: 0, open: 0 };
  return { total: r.items.length, open: r.items.filter((x) => x.deliveredBy === "client" && x.status !== "completed").length };
}

/** An internal row: everything, drafts included, every version and every event. */
export type InternalDeliverable = {
  id: string;
  clientId: string;
  slug: string;
  domain: string;
  deliveredBy: DeliveredBy;
  status: Status;
  visible: boolean;
  version: number;
  createdBy: string;
  createdAt: string;
  publishedAt: string | null;
  completedAt: string | null;
  completedBy: string | null;
  completionNote: string | null;
  completionUrl: string | null;
  planItemId: string | null;
  versions: { version: number; title: string; findingsMd: string; evidenceUrl: string | null; reason: string | null; createdBy: string; createdAt: string; files: { filename: string; bytes: number; sha256: string }[] }[];
  events: (TrailEvent & { fromStatus: string | null })[];
};

export async function readInternalDeliverables(opts: { slug?: string } = {}, client?: SupabaseClient): Promise<Result<{ items: InternalDeliverable[] }>> {
  try {
    return await readInternal(opts, db(client));
  } catch (err) {
    return no(`Could not read deliverables: ${err instanceof Error ? err.message : String(err)}`, 502);
  }
}

async function readInternal(opts: { slug?: string }, d: SupabaseClient): Promise<Result<{ items: InternalDeliverable[] }>> {
  let clientIds: Map<string, { slug: string; domain: string }> | null = null;
  if (opts.slug) {
    const { data, error } = await d.from("client_domains").select("id, slug, domain").eq("slug", opts.slug).maybeSingle();
    if (error) return dbErr("read the customer", error);
    if (!data) return no("No such customer.", 404);
    clientIds = new Map([[(data as { id: string }).id, data as { slug: string; domain: string }]]);
  }
  let q = d.from("deliverables").select("id, client_domain_id, delivered_by, status, visible_to_customer, current_version, created_by, created_at, published_at, completed_at, completed_by, completion_note, completion_url, plan_item_id").order("created_at", { ascending: false }).limit(300);
  if (clientIds) q = q.in("client_domain_id", [...clientIds.keys()]);
  const { data, error } = await q;
  if (error) return absent(error) ? { ok: true, items: [] } : dbErr("read deliverables", error);
  const rows = (data ?? []) as (Row & { current_version: number; created_by: string; created_at: string; published_at: string | null; completed_at: string | null; completed_by: string | null; completion_note: string | null; completion_url: string | null; plan_item_id: string | null })[];
  if (!rows.length) return { ok: true, items: [] };
  const ids = rows.map((r) => r.id);
  if (!clientIds) {
    const { data: cs, error: cErr } = await d.from("client_domains").select("id, slug, domain").in("id", [...new Set(rows.map((r) => r.client_domain_id))]);
    if (cErr) return dbErr("read customers", cErr);
    clientIds = new Map((cs ?? []).map((c) => [(c as { id: string }).id, c as { slug: string; domain: string }]));
  }
  const [{ data: vData, error: vErr }, { data: fData, error: fErr }, { data: eData, error: eErr }] = await Promise.all([
    d.from("deliverable_versions").select("deliverable_id, version, title, findings_md, evidence_url, reason, created_by, created_at").in("deliverable_id", ids).order("version"),
    d.from("deliverable_files").select("deliverable_id, version, position, filename, body, sha256").in("deliverable_id", ids).order("position"),
    d.from("deliverable_events").select("id, deliverable_id, at, actor, actor_kind, event, from_status, to_status, version, note, url").in("deliverable_id", ids).order("at").order("id"),
  ]);
  const failed = vErr ?? fErr ?? eErr;
  if (failed) return dbErr("read the history", failed);
  const versions = (vData ?? []) as { deliverable_id: string; version: number; title: string; findings_md: string; evidence_url: string | null; reason: string | null; created_by: string; created_at: string }[];
  const files = (fData ?? []) as { deliverable_id: string; version: number; filename: string; body: string; sha256: string }[];
  const events = (eData ?? []) as EventRow[];
  return {
    ok: true,
    items: rows.map((r) => ({
      id: r.id,
      clientId: r.client_domain_id,
      slug: clientIds!.get(r.client_domain_id)?.slug ?? "",
      domain: clientIds!.get(r.client_domain_id)?.domain ?? "",
      deliveredBy: r.delivered_by,
      status: r.status,
      visible: r.visible_to_customer,
      version: r.current_version,
      createdBy: r.created_by,
      createdAt: r.created_at,
      publishedAt: r.published_at,
      completedAt: r.completed_at,
      completedBy: r.completed_by,
      completionNote: r.completion_note,
      completionUrl: r.completion_url,
      planItemId: r.plan_item_id,
      versions: versions
        .filter((v) => v.deliverable_id === r.id)
        .map((v) => ({ version: v.version, title: v.title, findingsMd: v.findings_md, evidenceUrl: v.evidence_url, reason: v.reason, createdBy: v.created_by, createdAt: v.created_at, files: files.filter((f) => f.deliverable_id === r.id && f.version === v.version).map((f) => ({ filename: f.filename, bytes: f.body.length, sha256: f.sha256 })) })),
      events: events.filter((e) => e.deliverable_id === r.id).map((e) => ({ ...trailOf(e), fromStatus: e.from_status })),
    })),
  };
}
