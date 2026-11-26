import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { promptsMarkdown, type PromptDeliverable } from "./prompts-md";

export type { PromptDeliverable };

/** An "undefined table" answer: the migration has not landed, which reads as nothing published rather than as an error. */
const missingTable = (e: { code?: string; message?: string } | null) => !!e && (e.code === "PGRST205" || e.code === "42P01" || /client_prompt_deliverables/.test(e.message ?? ""));

const clean = (v: unknown): { title: string; body: string }[] =>
  (Array.isArray(v) ? v : []).flatMap((p) => {
    const o = p as { title?: unknown; body?: unknown } | null;
    return o && typeof o.title === "string" && typeof o.body === "string" && o.body.trim() ? [{ title: o.title, body: o.body }] : [];
  });

/** The deliverables published to one client, newest first. Drafts are never read here. */
export async function readPublishedPrompts(db: SupabaseClient, clientId: string): Promise<PromptDeliverable[]> {
  const { data, error } = await db
    .from("client_prompt_deliverables")
    .select("id, title, intro, prompts, published_at")
    .eq("client_domain_id", clientId)
    .eq("status", "published")
    .order("published_at", { ascending: false });
  if (missingTable(error)) return [];
  if (error) throw new Error(`could not read the prompts: ${error.message}`);
  return (data ?? []).map((r) => ({ id: r.id as string, title: r.title as string, intro: (r.intro as string | null) ?? null, publishedAt: (r.published_at as string | null) ?? null, prompts: clean(r.prompts) }));
}

/** How many are published, for the sidebar: the link shows only for a client who has any. A read that fails is none. */
export async function countPublishedPrompts(db: SupabaseClient, clientId: string): Promise<number> {
  const { count, error } = await db.from("client_prompt_deliverables").select("id", { count: "exact", head: true }).eq("client_domain_id", clientId).eq("status", "published");
  return error ? 0 : (count ?? 0);
}

export { promptsMarkdown };
