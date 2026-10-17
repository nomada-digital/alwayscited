import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { insertCluster, insertKeyword, insertPrompts, readingsFor } from "@/lib/tracking/limits";
import { stopDay } from "@/lib/tracking/stop";

import { cleanTerms, refuseOp, type Op } from "./ops";
import { planShape } from "./plan";
import type { Raw, RawCluster, RawGroup, RawKeyword, RawPrompt } from "./types";

/**
 * One op, written to Supabase (17 Oct 2026). The rows are read fresh, the op
 * is judged by the same refuseOp the browser ran, then written. Inserts into
 * the tracked tables go through limits.ts, which counts the allowance again
 * at the moment of writing; everything else is an update scoped to the
 * client, and nothing is deleted.
 *
 * Every row added is first read at the next daily check: added_on is
 * tomorrow, as on /app (new-cluster.ts), so the runner, which reads prompts
 * and keywords by client, picks it up then with no change of its own.
 */

export type WriteResult = { ok: true; ids: Record<string, string>; replaced?: string } | { ok: false; message: string; status?: number };

/** The rows refuseOp needs: structure only, no readings. */
export async function loadStructure(db: SupabaseClient, base: Pick<Raw, "client" | "role" | "today">): Promise<Raw | string> {
  const cid = base.client.id;
  const { data: groupRows, error: gErr } = await db.from("keyword_groups").select("id, cluster_id, name, note, terms, position, stopped_on").eq("client_domain_id", cid);
  // Before 20261017000000 there is no table: groups are off, and the columns it adds are not asked for.
  const groupsReady = !gErr;
  const [{ data: cRows, error: cErr }, { data: kRows, error: kErr }, { data: pRows, error: pErr }] = await Promise.all([
    db.from("tracked_clusters").select("id, name, keyword_id, tier, started_on, stopped_on").eq("client_domain_id", cid),
    db.from("tracked_keywords").select(groupsReady ? "id, keyword, search_volume, intent, added_on, stopped_on, cluster_id, group_id" : "id, keyword, search_volume, intent, added_on, stopped_on").eq("client_domain_id", cid),
    db.from("tracked_questions").select(groupsReady ? "id, text, cluster_id, group_id, angle, added_on, stopped_on, allowance" : "id, text, cluster_id, angle, added_on, stopped_on").eq("client_domain_id", cid),
  ]);
  const failed = cErr ?? kErr ?? pErr;
  if (failed) return `Could not read what is tracked: ${failed.message}`;
  const clusters = (cRows ?? []) as RawCluster[];
  const keywords = ((kRows ?? []) as Partial<RawKeyword>[]).map((x) => ({ cluster_id: null, group_id: null, ...x })) as RawKeyword[];
  for (const x of keywords) if (!x.cluster_id) x.cluster_id = clusters.find((cl) => cl.keyword_id === x.id)?.id ?? null;
  return {
    ...base,
    clusters,
    groups: groupsReady ? ((groupRows ?? []) as RawGroup[]) : [],
    keywords,
    prompts: ((pRows ?? []) as Partial<RawPrompt>[]).map((x) => ({ group_id: null, ...x })) as RawPrompt[],
    runs: [], serp: [], answers: [], footprint: null, opportunities: [], placements: [], connections: [], consoleRows: [],
    groupsReady,
  };
}

const fail = (message: string, status = 422): WriteResult => ({ ok: false, message, status });

async function update(db: SupabaseClient, table: string, clientId: string, patch: Record<string, unknown>, where: Record<string, string | null>): Promise<string | null> {
  const eqs = Object.fromEntries(Object.entries(where).filter(([, v]) => v !== null)) as Record<string, string>;
  const nulls = Object.keys(where).filter((k) => where[k] === null);
  const { error } = await nulls.reduce((q, k) => q.is(k, null), db.from(table).update(patch).eq("client_domain_id", clientId).match(eqs));
  return error ? error.message : null;
}

export async function writeOp(db: SupabaseClient, raw: Raw, op: Op, by: string): Promise<WriteResult> {
  const refused = refuseOp(raw, op, planShape());
  if (refused) return fail(refused);
  const cid = raw.client.id;
  const day = stopDay(raw.today);
  const err = (m: string | null) => (m ? fail(`Could not save that: ${m}`, 502) : null);

  switch (op.op) {
    case "cluster.add": {
      const c = await insertCluster(db, cid, { name: op.name.trim(), tier: raw.client.tier, started_on: day });
      if (!c.ok) return fail(c.message);
      const ids: Record<string, string> = { [op.tempId]: c.ids[0]! };
      if (op.keyword && op.keyword.trim()) {
        const k = await insertKeyword(db, cid, c.ids[0]!, { keyword: op.keyword.replace(/\s+/g, " ").trim(), added_on: day, added_by: by }, { pooled: raw.groupsReady });
        if (!k.ok) return fail(`The cluster was added, but not its keyword: ${k.message}`);
        ids[`${op.tempId}-k`] = k.ids[0]!;
      }
      return { ok: true, ids };
    }
    case "cluster.rename":
      return err(await update(db, "tracked_clusters", cid, { name: op.name.trim() }, { id: op.id })) ?? { ok: true, ids: {} };
    case "cluster.remove": {
      const tables = ["tracked_questions", "tracked_keywords", ...(raw.groupsReady ? ["keyword_groups"] : [])];
      for (const table of tables) {
        // Keywords stated on the cluster, and before the migration its one keyword_id (below).
        const e = await update(db, table, cid, { stopped_on: day, stopped_by: by }, { cluster_id: op.id, stopped_on: null });
        if (e && !(table === "tracked_keywords" && !raw.groupsReady)) return fail(`Could not save that: ${e}`, 502);
      }
      const head = raw.clusters.find((c) => c.id === op.id)?.keyword_id;
      if (head) {
        const e = await update(db, "tracked_keywords", cid, { stopped_on: day, stopped_by: by }, { id: head, stopped_on: null });
        if (e) return fail(`Could not save that: ${e}`, 502);
      }
      return err(await update(db, "tracked_clusters", cid, { stopped_on: day }, { id: op.id, stopped_on: null })) ?? { ok: true, ids: {} };
    }
    case "cluster.restore": {
      const was = raw.clusters.find((c) => c.id === op.id)!.stopped_on!;
      const e1 = await update(db, "tracked_clusters", cid, { stopped_on: null }, { id: op.id, stopped_on: was });
      if (e1) return fail(`Could not save that: ${e1}`, 502);
      const head = raw.clusters.find((c) => c.id === op.id)?.keyword_id;
      if (head) {
        const e = await update(db, "tracked_keywords", cid, { stopped_on: null, stopped_by: null }, { id: head, stopped_on: was });
        if (e) return fail(`Could not save that: ${e}`, 502);
      }
      for (const table of ["tracked_questions", ...(raw.groupsReady ? ["tracked_keywords", "keyword_groups"] : [])]) {
        const e = await update(db, table, cid, { stopped_on: null, stopped_by: null }, { cluster_id: op.id, stopped_on: was });
        if (e) return fail(`Could not save that: ${e}`, 502);
      }
      return { ok: true, ids: {} };
    }
    case "group.add": {
      const pos = Math.max(0, ...raw.groups.filter((g) => g.cluster_id === op.clusterId).map((g) => g.position + 1));
      const { data, error } = await db
        .from("keyword_groups")
        .insert({ client_domain_id: cid, cluster_id: op.clusterId, name: op.name.trim(), terms: cleanTerms(op.terms), position: pos, created_by: by })
        .select("id")
        .single();
      if (error?.code === "23505") return fail("That cluster already has a group with that name.");
      if (error) return fail(`Could not add the group: ${error.message}`, 502);
      return { ok: true, ids: { [op.tempId]: data.id as string } };
    }
    case "group.edit": {
      const patch: Record<string, unknown> = {};
      if (op.name !== undefined) patch.name = op.name.trim();
      if (op.note !== undefined) patch.note = op.note && op.note.trim() ? op.note.trim() : null;
      if (op.terms !== undefined) patch.terms = cleanTerms(op.terms);
      return err(await update(db, "keyword_groups", cid, patch, { id: op.id })) ?? { ok: true, ids: {} };
    }
    case "group.remove": {
      // Its keywords and prompts stay tracked, back on the cluster's own.
      for (const table of ["tracked_keywords", "tracked_questions"]) {
        const e = await update(db, table, cid, { group_id: null }, { group_id: op.id });
        if (e) return fail(`Could not save that: ${e}`, 502);
      }
      return err(await update(db, "keyword_groups", cid, { stopped_on: day, stopped_by: by }, { id: op.id, stopped_on: null })) ?? { ok: true, ids: {} };
    }
    case "group.restore": {
      const e = await update(db, "keyword_groups", cid, { stopped_on: null, stopped_by: null }, { id: op.id });
      if (e) return fail(`Could not save that: ${e}`, 502);
      for (const k of op.keywords) {
        const e2 = await update(db, "tracked_keywords", cid, { group_id: op.id }, { id: k, group_id: null });
        if (e2) return fail(`Could not save that: ${e2}`, 502);
      }
      for (const p of op.prompts) {
        const e2 = await update(db, "tracked_questions", cid, { group_id: op.id }, { id: p, group_id: null });
        if (e2) return fail(`Could not save that: ${e2}`, 502);
      }
      return { ok: true, ids: {} };
    }
    case "keyword.add": {
      // Before 20261017000000 there is no tracked_keywords.cluster_id to state the cluster on, so /app's rule holds: one keyword per cluster.
      const row = { keyword: op.keyword.replace(/\s+/g, " ").trim(), added_on: day, added_by: by, ...(op.volume != null ? { search_volume: op.volume } : {}), ...(op.intent ? { intent: op.intent } : {}) };
      const k = await insertKeyword(db, cid, op.clusterId, row, raw.groupsReady ? { pooled: true, groupId: op.groupId } : {});
      return k.ok ? { ok: true, ids: { [op.tempId]: k.ids[0]! } } : fail(k.message);
    }
    case "keyword.remove":
      return err(await update(db, "tracked_keywords", cid, { stopped_on: day, stopped_by: by }, { id: op.id, stopped_on: null })) ?? { ok: true, ids: {} };
    case "keyword.restore":
      return err(await update(db, "tracked_keywords", cid, { stopped_on: null, stopped_by: null }, { id: op.id })) ?? { ok: true, ids: {} };
    case "keyword.move": {
      const patch: Record<string, unknown> = raw.groupsReady ? { cluster_id: op.clusterId, group_id: op.groupId } : {};
      if (!Object.keys(patch).length) return { ok: true, ids: {} };
      return err(await update(db, "tracked_keywords", cid, patch, { id: op.id })) ?? { ok: true, ids: {} };
    }
    case "prompt.add": {
      const w = await insertPrompts(db, cid, op.clusterId, [{ text: op.text.trim(), source: "client", added_on: day, added_by: by, origin_kind: "client" }], { pooled: true, groupId: op.groupId });
      return w.ok ? { ok: true, ids: { [op.tempId]: w.ids[0]! } } : fail(w.message);
    }
    case "prompt.edit": {
      const p = raw.prompts.find((x) => x.id === op.id)!;
      if (p.text.trim() === op.text.trim()) return { ok: true, ids: {} };
      const n = await readingsFor(db, "prompt", op.id);
      if (typeof n === "string") return fail(n, 502);
      if (n === 0) return err(await update(db, "tracked_questions", cid, { text: op.text.trim() }, { id: op.id, stopped_on: null })) ?? { ok: true, ids: {} };
      // Measured: its words are fixed, so the edit stops it and starts a new prompt in its place.
      const e = await update(db, "tracked_questions", cid, { stopped_on: day, stopped_by: by }, { id: op.id, stopped_on: null });
      if (e) return fail(`Could not save that: ${e}`, 502);
      const w = await insertPrompts(db, cid, p.cluster_id, [{ text: op.text.trim(), source: "client", added_on: day, added_by: by, angle: p.angle, origin_kind: "client" }], { pooled: true, groupId: p.group_id });
      if (!w.ok) {
        const back = await update(db, "tracked_questions", cid, { stopped_on: null, stopped_by: null }, { id: op.id });
        return fail(w.message + (back ? ` The old prompt could not be put back either: ${back}` : ""));
      }
      return { ok: true, ids: { [op.tempId]: w.ids[0]! }, replaced: op.id };
    }
    case "prompt.remove":
      return err(await update(db, "tracked_questions", cid, { stopped_on: day, stopped_by: by }, { id: op.id, stopped_on: null })) ?? { ok: true, ids: {} };
    case "prompt.restore": {
      const { error } = await db.from("tracked_questions").update({ stopped_on: null, stopped_by: null }).eq("id", op.id).eq("client_domain_id", cid);
      if (error?.code === "23505") return fail("That prompt is already tracked in this cluster.");
      return error ? fail(`Could not save that: ${error.message}`, 502) : { ok: true, ids: {} };
    }
    case "prompt.move": {
      const patch: Record<string, unknown> = { cluster_id: op.clusterId, ...(raw.groupsReady ? { group_id: op.groupId } : {}) };
      const { error } = await db.from("tracked_questions").update(patch).eq("id", op.id).eq("client_domain_id", cid);
      if (error?.code === "23505") return fail("That cluster already tracks the same prompt.");
      return error ? fail(`Could not save that: ${error.message}`, 502) : { ok: true, ids: {} };
    }
  }
}

/** Ask for an integration (17 Oct 2026): records the request; the connect flow itself is not live yet. */
export async function requestIntegration(db: SupabaseClient, clientId: string, provider: "ga4" | "gsc" | "bing", by: string): Promise<string | null> {
  const now = new Date().toISOString();
  const { error } = await db
    .from("integration_connections")
    .upsert({ client_domain_id: clientId, provider, status: "requested", requested_by: by, requested_at: now, updated_at: now }, { onConflict: "client_domain_id,provider" });
  return error ? error.message : null;
}
