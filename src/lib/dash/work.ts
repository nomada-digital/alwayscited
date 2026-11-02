import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { clientsFor } from "@/lib/tracking/member";

import { dashEmail, viewAs } from "./access";
import { dashFixturePath } from "./fixture";
import { isSampleClient } from "./host";
import { absent } from "./load";
import { demoToken, viewToken } from "./page-data";
import { plainFileName, plainNote, plainTitle, workKindLabel } from "./work-text";

/**
 * Work completed (sg-35, 2 Nov 2026): the customer's work_items, newest first. The Nomada hub is the only writer
 * (alwayscited-admin work_sync, service role); the dashboard only reads, with the service role, scoped to the client
 * the page has already authorised. Every title and note passes the census in work-text.ts here, the one place
 * work_items is read, so no page can render one raw.
 *
 * The table is added by 2026-11-02_hub_keywords_and_work_items.sql; until it is applied the section is empty.
 */

export type WorkItem = {
  id: string;
  doneOn: string;
  title: string;
  kind: string;
  kindLabel: string;
  note: string | null;
  /** True when the row carries a file; the file opens only through the work route (workFileUrl). */
  hasFile: boolean;
  fileName: string | null;
};

type WorkRow = { id: string; done_on: string; title: string; kind: string; note: string | null; file_path: string | null; file_name: string | null };

export const WORK_LIMIT = 200;

/** Signed links live five minutes: long enough to open, too short to be worth forwarding. */
export const WORK_FILE_TTL = 300;
export const WORK_BUCKET = "work-files";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function toWorkItem(r: WorkRow): WorkItem {
  return {
    id: r.id,
    doneOn: r.done_on,
    title: plainTitle(r.title),
    kind: r.kind,
    kindLabel: workKindLabel(r.kind),
    note: plainNote(r.note),
    hasFile: Boolean(r.file_path),
    fileName: r.file_path ? plainFileName(r.file_name) : null,
  };
}

/** A client's work items, newest first. An absent table or a failed read is an empty list, never a broken page. */
export async function readWork(clientId: string, db?: SupabaseClient): Promise<WorkItem[]> {
  // The sample client is generated and never read (host.ts); a local fixture run has no database.
  if (isSampleClient(clientId) || (!db && dashFixturePath())) return [];
  const { data, error } = await (db ?? supabaseAdmin())
    .from("work_items")
    .select("id, done_on, title, kind, note, file_path, file_name")
    .eq("client_domain_id", clientId)
    .order("done_on", { ascending: false })
    .order("synced_at", { ascending: false })
    .limit(WORK_LIMIT);
  if (error) {
    if (!absent(error)) console.warn(`[dash] work items read failed: ${error.message}`);
    return [];
  }
  return ((data ?? []) as WorkRow[]).map(toWorkItem);
}

/** The link a work item's file opens through: the work route on this request's base, never a storage URL. */
export function workFileHref(base: string, slug: string, id: string): string {
  return `${base}/${slug}/work/${id}`;
}

/**
 * The client a work file request may open, or null (a 404). The same three doors as pageData, without its
 * redirects: the hub's view-as token (checked against the database, as access.ts viewAs), then the signed-in
 * member's own list (member.ts clientsFor). A demo link never opens a file: it is not the customer, and the
 * section is not drawn there.
 */
export async function workClient(slug: string): Promise<{ id: string } | null> {
  if (dashFixturePath()) return null;
  if (await demoToken()) return null;
  const view = await viewToken();
  let email: string | null;
  if (view) {
    const v = await viewAs(view, slug);
    if (!v) return null;
    email = v.ownerEmail;
  } else {
    email = await dashEmail();
  }
  if (!email) return null;
  const clients = await clientsFor(email);
  const c = clients.find((x) => x.slug === slug);
  return c ? { id: c.id as string } : null;
}

/**
 * A short signed link to one work item's file, or null when the item is not this client's, has no file, or the
 * table or bucket is not there yet. Made server side with the service role; the bucket stays private.
 */
export async function workFileUrl(clientId: string, id: string): Promise<string | null> {
  if (!UUID.test(id)) return null;
  const db = supabaseAdmin();
  const { data, error } = await db.from("work_items").select("file_path, file_name").eq("id", id).eq("client_domain_id", clientId).maybeSingle();
  if (error) {
    if (!absent(error)) console.warn(`[dash] work file read failed: ${error.message}`);
    return null;
  }
  const row = data as { file_path: string | null; file_name: string | null } | null;
  if (!row?.file_path) return null;
  const name = (row.file_name ?? "").trim();
  const { data: signed, error: sErr } = await db.storage.from(WORK_BUCKET).createSignedUrl(row.file_path, WORK_FILE_TTL, name ? { download: name } : undefined);
  if (sErr || !signed?.signedUrl) {
    console.warn(`[dash] could not sign a work file: ${sErr?.message ?? "no url"}`);
    return null;
  }
  return signed.signedUrl;
}
