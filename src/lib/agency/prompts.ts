import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

import { type Client, type Done, audit } from "@/lib/agency/edit";

/**
 * Prompts for your site, the agency side (26 Nov 2026). Staff publish a deliverable - a title, an intro and its
 * prompts [{title, body}] - to a customer's dashboard (/<slug>/prompts) from the hub, through /api/hub/agency
 * prompts_publish. Publishing with an `id` replaces that deliverable's content (its published_at stays); without one it
 * creates a new row. prompts_unpublish takes it off the dashboard but keeps it, as a draft. Every change is an
 * agency_edits line. Customers never reach this: it is server to server, staff only (hub-auth.ts).
 */
const WAITING = "Prompts switch on once 20261126000000_client_prompt_deliverables.sql is applied.";
const missingTable = (e: { code?: string; message?: string } | null) => !!e && (e.code === "PGRST205" || e.code === "42P01" || /client_prompt_deliverables/.test(e.message ?? ""));
const UUID = /^[0-9a-f-]{36}$/;

export type PromptInput = { title: string; body: string };

/** The prompts as sent: at least one, each with a title (1-200) and a body (1-100 000 characters). A string is the reason it was refused. */
export function readPrompts(v: unknown): PromptInput[] | string {
  if (!Array.isArray(v) || v.length === 0) return "Add at least one prompt.";
  if (v.length > 40) return "At most 40 prompts in one deliverable.";
  const out: PromptInput[] = [];
  for (const [i, p] of v.entries()) {
    const o = p as { title?: unknown; body?: unknown } | null;
    const title = typeof o?.title === "string" ? o.title.trim() : "";
    const body = typeof o?.body === "string" ? o.body.replace(/\r\n/g, "\n").replace(/^\n+|\s+$/g, "") : "";
    if (!title || title.length > 200) return `Prompt ${i + 1} needs a title of up to 200 characters.`;
    if (!body || body.length > 100_000) return `Prompt ${i + 1} needs its text (up to 100,000 characters).`;
    out.push({ title, body });
  }
  return out;
}

export async function promptsRead(db: SupabaseClient, client: Client): Promise<Done> {
  const { data, error } = await db.from("client_prompt_deliverables").select("id, title, intro, prompts, status, published_at, created_by, updated_at").eq("client_domain_id", client.id).order("created_at", { ascending: false });
  if (missingTable(error)) return { ok: true, message: WAITING, data: { rows: [], ready: false } };
  if (error) return { ok: false, message: `Could not read the prompts: ${error.message}` };
  return { ok: true, message: `${(data ?? []).length} deliverable${(data ?? []).length === 1 ? "" : "s"}.`, data: { rows: data ?? [], ready: true, dashboard: `https://dashboards.alwayscited.com/${client.slug}/prompts` } };
}

export async function promptsPublish(db: SupabaseClient, client: Client, by: string, p: { id: string; title: string; intro: string; prompts: unknown }): Promise<Done> {
  const title = p.title.trim();
  if (title.length < 3 || title.length > 200) return { ok: false, message: "Give the deliverable a title (3 to 200 characters)." };
  const intro = p.intro.trim();
  if (intro.length > 2000) return { ok: false, message: "The intro is at most 2,000 characters." };
  const prompts = readPrompts(p.prompts);
  if (typeof prompts === "string") return { ok: false, message: prompts };
  const now = new Date().toISOString();
  if (p.id) {
    if (!UUID.test(p.id)) return { ok: false, message: "That is not a deliverable id." };
    const { data: had, error: hErr } = await db.from("client_prompt_deliverables").select("id, published_at").eq("id", p.id).eq("client_domain_id", client.id).maybeSingle();
    if (missingTable(hErr)) return { ok: false, message: WAITING };
    if (hErr) return { ok: false, message: `Could not read the deliverable: ${hErr.message}` };
    if (!had) return { ok: false, message: "That deliverable is not this customer's." };
    const { error } = await db.from("client_prompt_deliverables").update({ title, intro: intro || null, prompts, status: "published", published_at: (had.published_at as string | null) ?? now, updated_at: now }).eq("id", p.id);
    if (error) return { ok: false, message: `Not saved: ${error.message}` };
    await audit(db, client.id, by, "prompts_publish", p.id, null, { title, prompts: prompts.length, updated: true });
    return { ok: true, message: `Updated "${title}": ${prompts.length} prompt${prompts.length === 1 ? "" : "s"} on the dashboard.`, data: { id: p.id, url: `https://dashboards.alwayscited.com/${client.slug}/prompts` } };
  }
  const { data, error } = await db.from("client_prompt_deliverables").insert({ client_domain_id: client.id, title, intro: intro || null, prompts, status: "published", published_at: now, created_by: by }).select("id").single();
  if (missingTable(error)) return { ok: false, message: WAITING };
  if (error || !data) return { ok: false, message: `Not saved: ${error?.message ?? "no row"}` };
  await audit(db, client.id, by, "prompts_publish", data.id as string, null, { title, prompts: prompts.length });
  return { ok: true, message: `Published "${title}": ${prompts.length} prompt${prompts.length === 1 ? "" : "s"} on the dashboard.`, data: { id: data.id, url: `https://dashboards.alwayscited.com/${client.slug}/prompts` } };
}

export async function promptsUnpublish(db: SupabaseClient, client: Client, by: string, id: string): Promise<Done> {
  if (!UUID.test(id)) return { ok: false, message: "Which deliverable?" };
  const { data, error } = await db.from("client_prompt_deliverables").update({ status: "draft", updated_at: new Date().toISOString() }).eq("id", id).eq("client_domain_id", client.id).select("title").maybeSingle();
  if (missingTable(error)) return { ok: false, message: WAITING };
  if (error) return { ok: false, message: `Not saved: ${error.message}` };
  if (!data) return { ok: false, message: "That deliverable is not this customer's." };
  await audit(db, client.id, by, "prompts_unpublish", id, null, { title: data.title });
  return { ok: true, message: `Took "${data.title as string}" off the dashboard. It is kept as a draft.` };
}
