import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

import { type Client, type Done, audit } from "@/lib/agency/edit";
import { jsonLdNodes } from "@/lib/diy/pages/own-parse";

/**
 * Schema Nomada delivers to a customer (Danny, 14 Nov 2026: a customer's "Schema for your site" must not contradict
 * the schema work Nomada has done; when it is live, it shows as complete). Staff record each delivered block from the
 * hub's customer page: its name, where it goes, when and by whom it was supplied, and the JSON-LD itself, from which
 * only each node's @id, types and property names are kept (schema_delivered, 20261114010000). A block supplied again
 * is a new version of the same block_key. The dashboard (schema-build.ts deliveredStatus) does the rest live.
 */
const missingTable = (e: { code?: string; message?: string } | null) => !!e && (e.code === "PGRST205" || e.code === "42P01" || /schema_delivered/.test(e.message ?? ""));
const WAITING = "Delivered schema switches on once 20261114010000_schema_delivered.sql is applied.";

export async function schemaDeliveredRead(db: SupabaseClient, client: Client): Promise<Done> {
  const { data, error } = await db.from("schema_delivered").select("block_key, version, label, where_url, how, supplied_on, supplied_by, note, created_by, created_at").eq("client_domain_id", client.id).order("block_key").order("version", { ascending: false });
  if (missingTable(error)) return { ok: true, message: WAITING, data: { rows: [], ready: false } };
  if (error) return { ok: false, message: `Could not read the delivered schema: ${error.message}` };
  return { ok: true, message: `${(data ?? []).length} delivered.`, data: { rows: data ?? [], ready: true } };
}

/** The JSON-LD's nodes, by @id: types and property names. Nodes without an @id cannot be checked and are refused. */
export function expectedOf(jsonld: string): Record<string, { types: string[]; props: string[] }> | string {
  const raw = /<script/i.test(jsonld) ? jsonld : `<script type="application/ld+json">${jsonld}</script>`;
  const { nodes, errors } = jsonLdNodes(raw);
  if (errors) return "That JSON-LD doesn't parse. Paste the block exactly as supplied.";
  const out: Record<string, { types: string[]; props: string[] }> = {};
  for (const n of nodes) {
    if (typeof n["@id"] !== "string") continue;
    const types = (Array.isArray(n["@type"]) ? n["@type"] : [n["@type"]]).filter((t): t is string => typeof t === "string");
    const props = Object.keys(n).filter((k) => !k.startsWith("@"));
    // A bare reference ({"@id": ...}) nested in another node adds nothing to check.
    if (!types.length && !props.length) continue;
    const was = out[n["@id"] as string];
    out[n["@id"] as string] = { types: [...new Set([...(was?.types ?? []), ...types])], props: [...new Set([...(was?.props ?? []), ...props])].sort() };
  }
  return Object.keys(out).length ? out : "No node in that JSON-LD has an @id, so it can't be checked on the site.";
}

export async function schemaDeliveredSet(db: SupabaseClient, client: Client, by: string, p: { key: string; label: string; where: string; how: string; suppliedOn: string; suppliedBy: string; jsonld: string }): Promise<Done> {
  const key = (p.key || p.label).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  const where = p.where.trim() === "" || /^sitewide$/i.test(p.where.trim()) ? "sitewide" : p.where.trim();
  if (!key || p.label.trim().length < 3) return { ok: false, message: "Give the block a name." };
  if (where !== "sitewide" && !/^https?:\/\//.test(where)) return { ok: false, message: "Where it goes: sitewide, or the page's full address." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.suppliedOn)) return { ok: false, message: "The date it was supplied, as YYYY-MM-DD." };
  const expected = expectedOf(p.jsonld);
  if (typeof expected === "string") return { ok: false, message: expected };
  const { data: had, error: hErr } = await db.from("schema_delivered").select("version").eq("client_domain_id", client.id).eq("block_key", key).order("version", { ascending: false }).limit(1);
  if (missingTable(hErr)) return { ok: false, message: WAITING };
  if (hErr) return { ok: false, message: `Could not read the delivered schema: ${hErr.message}` };
  const version = ((had ?? [])[0]?.version as number | undefined ?? 0) + 1;
  const row = { client_domain_id: client.id, block_key: key, version, label: p.label.trim().slice(0, 160), where_url: where, how: p.how.trim().slice(0, 200) || null, supplied_on: p.suppliedOn, supplied_by: (p.suppliedBy.trim() || by).slice(0, 120), expected, created_by: by };
  const { error } = await db.from("schema_delivered").insert(row);
  if (error) return { ok: false, message: `Not saved: ${error.message}` };
  await audit(db, client.id, by, "schema_delivered", key, null, { version, where, ids: Object.keys(expected) });
  return { ok: true, message: `Recorded ${row.label}${version > 1 ? ` (version ${version})` : ""}: ${Object.keys(expected).length} node${Object.keys(expected).length === 1 ? "" : "s"} it will look for on the site.` };
}
