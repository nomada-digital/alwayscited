import type { SupabaseClient } from "@supabase/supabase-js";

import type { Day } from "../../tracking/figures.ts";
import { pagesFixture, type PagesFixture } from "./data.ts";
import { type MemberAdd, insertKeyPage, memberAdd, readKeyPages, removeKeyPage } from "./key-pages.ts";
import { keyPageOf } from "./key-pages.ts";
import type { ExampleBody, KeyPage } from "./types.ts";

/**
 * The route's writes to Your pages' tables (13 Oct 2026, DIY P8; spec 10
 * section 3.6): add and remove a key page, and a drafted example's row from
 * pending to ready or failed. Each looks at its own error and is held to one
 * client. Each has a fixture twin over pages.json's rows held in memory
 * (TRACKING_FIXTURE_WRITE=1); without it the fixture refuses to save.
 */

export type AddResult = { ok: true; done: "added" | "replaced"; id: string; replaced: KeyPage | null } | { ok: false; why: Exclude<MemberAdd, { ok: true }>["why"] | "readonly" };

/** A member's page: on the client's domain, not live already; the oldest automatic page gives way at 10. */
export async function addPage(db: SupabaseClient, client: { id: string; domain: string }, url: string, p: { by: string; today: Day }): Promise<AddResult> {
  const rows = await readKeyPages(db, client.id);
  const d = memberAdd(rows, url, client.domain);
  if (!d.ok) return d;
  if (d.replace && !(await removeKeyPage(db, client.id, d.replace.id, p))) throw new Error("the page it replaces has changed");
  const put = await insertKeyPage(db, client.id, { url: d.add.url, urlKey: d.add.urlKey, origin: "member", clusterIds: [], by: p.by, today: p.today });
  if (put === "duplicate") return { ok: false, why: "already" };
  if (put === "refused") return { ok: false, why: "bad_url" };
  const added = (await readKeyPages(db, client.id)).find((k) => k.removedOn === null && k.urlKey === d.add.urlKey);
  if (!added) throw new Error("the page was added and not found");
  return { ok: true, done: d.replace ? "replaced" : "added", id: added.id, replaced: d.replace };
}

export function addPageFixture(client: { id: string; domain: string }, url: string, p: { by: string; today: Day }): AddResult {
  const fx = pagesFixture();
  const f = fx.get();
  const rows = f.keyPages.filter((r) => r.client_domain_id === client.id).map(keyPageOf).filter((k): k is KeyPage => k !== null);
  const d = memberAdd(rows, url, client.domain);
  if (!d.ok) return d;
  const id = `kp-fx-${f.keyPages.length + 1}`;
  const next: PagesFixture = {
    ...f,
    keyPages: [
      ...f.keyPages.map((r) => (d.replace && String(r.id) === d.replace.id ? { ...r, removed_on: p.today, removed_by: p.by } : r)),
      { id, client_domain_id: client.id, url: d.add.url, url_key: d.add.urlKey, origin: "member", cluster_ids: [], added_by: p.by, added_on: p.today, removed_on: null, removed_by: null },
    ],
  };
  if (!fx.write(next)) return { ok: false, why: "readonly" };
  return { ok: true, done: d.replace ? "replaced" : "added", id, replaced: d.replace };
}

export function removePageFixture(clientId: string, id: string, p: { by: string; today: Day }): "removed" | "gone" | "readonly" {
  const fx = pagesFixture();
  const f = fx.get();
  const at = f.keyPages.findIndex((r) => String(r.id) === id && r.client_domain_id === clientId && !r.removed_on);
  if (at < 0) return "gone";
  return fx.write({ ...f, keyPages: f.keyPages.map((r, i) => (i === at ? { ...r, removed_on: p.today, removed_by: p.by } : r)) }) ? "removed" : "readonly";
}

/** Rows into the fixture's checks (a page check on the fixture: its canned reads, newly dated). */
export function addChecksFixture(rows: Record<string, unknown>[]): boolean {
  const fx = pagesFixture();
  const f = fx.get();
  return fx.write({ ...f, checks: [...f.checks, ...rows] });
}

// ---- Examples. ----

export async function insertExample(db: SupabaseClient, row: { id: string; clientId: string; clusterId: string; url: string; urlKey: string; by: string; now: string }): Promise<void> {
  const { error } = await db.from("reopt_examples").insert({ id: row.id, client_domain_id: row.clientId, cluster_id: row.clusterId, url: row.url, url_key: row.urlKey, status: "pending", requested_by: row.by, requested_at: row.now });
  if (error) throw new Error(`could not start the example: ${error.message}`);
}

/** Whether a pending example row exists for this client, by id: the deferred work starts only on its own row. */
export async function examplePending(db: SupabaseClient, clientId: string, id: string): Promise<boolean> {
  const { data, error } = await db.from("reopt_examples").select("id, status").eq("client_domain_id", clientId).eq("id", id).maybeSingle();
  if (error) throw new Error(`could not read the example: ${error.message}`);
  return (data as { status?: string } | null)?.status === "pending";
}

export type ExampleFinish =
  | { status: "ready"; example: ExampleBody; hits: { field: string; token: string }[]; inputs: Record<string, unknown>; readId: string | null; at: string }
  | { status: "failed"; error: string; inputs: Record<string, unknown> | null; readId: string | null; at: string };

export async function finishExample(db: SupabaseClient, clientId: string, id: string, f: ExampleFinish): Promise<void> {
  const patch =
    f.status === "ready"
      ? { status: "ready", example: f.example, guard_hits: f.hits, inputs: f.inputs, read_id: f.readId, finished_at: f.at, error: null }
      : { status: "failed", error: f.error.slice(0, 300), inputs: f.inputs, read_id: f.readId, finished_at: f.at };
  const { error } = await db.from("reopt_examples").update(patch).eq("client_domain_id", clientId).eq("id", id).eq("status", "pending");
  if (error) throw new Error(`could not store the example: ${error.message}`);
}

export function insertExampleFixture(row: { id: string; clientId: string; clusterId: string; url: string; urlKey: string; by: string; now: string }): boolean {
  const fx = pagesFixture();
  const f = fx.get();
  return fx.write({ ...f, examples: [...f.examples, { id: row.id, client_domain_id: row.clientId, cluster_id: row.clusterId, url: row.url, url_key: row.urlKey, status: "pending", requested_by: row.by, requested_at: row.now, finished_at: null, inputs: null, example: null, guard_hits: null, error: null }] });
}

export function finishExampleFixture(id: string, f: ExampleFinish): boolean {
  const fx = pagesFixture();
  const cur = fx.get();
  return fx.write({
    ...cur,
    examples: cur.examples.map((r) =>
      String(r.id) === id && r.status === "pending"
        ? f.status === "ready"
          ? { ...r, status: "ready", example: f.example, guard_hits: f.hits, inputs: f.inputs, finished_at: f.at }
          : { ...r, status: "failed", error: f.error, inputs: f.inputs, finished_at: f.at }
        : r,
    ),
  });
}
