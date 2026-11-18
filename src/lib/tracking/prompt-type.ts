import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * A prompt's type (Danny, 18 Nov 2026; migration 20261118010000): list ("best X", "top X", "which X would you
 * recommend"), comparison ("X vs Y", "is X better than", "alternatives to") or other. The database derives it from the
 * wording (prompt_type_of, stored as tracked_questions.prompt_type_auto); staff can set it (prompt_type), and the set
 * one wins. A list prompt is judged by where the client sits in the list, a comparison by who the answer recommends.
 */
export const PROMPT_TYPES = ["list", "comparison", "other"] as const;
export type PromptType = (typeof PROMPT_TYPES)[number];

export const PROMPT_TYPE_LABEL: Record<PromptType, string> = { list: "List", comparison: "Comparison", other: "Other" };

export function promptTypeOf(raw: unknown): PromptType | null {
  return (PROMPT_TYPES as readonly string[]).includes(String(raw)) ? (raw as PromptType) : null;
}

/** The type that stands: staff's, else the wording's. */
export const effectiveType = (p: { prompt_type?: string | null; prompt_type_auto?: string | null }): PromptType =>
  promptTypeOf(p.prompt_type) ?? promptTypeOf(p.prompt_type_auto) ?? "other";

export type PromptPosition = {
  id: string;
  text: string;
  type: PromptType;
  type_set: boolean;
  answers: number;
  named: number;
  placed: number;
  first: number;
  top3: number;
  avg_pos: number | null;
  dist: { "1": number; "2-3": number; "4-10": number; "11+": number };
  never_top3: boolean;
  verdicts: { client: number; neutral: number; rival: number; unread: number };
  rivals: { name: string; n: number }[] | null;
};

/** Each live prompt's type, position and verdict figures over its last `days` readings (prompt_positions()). */
export async function readPositions(db: SupabaseClient, slug: string, days = 28): Promise<PromptPosition[] | string> {
  const { data, error } = await db.rpc("prompt_positions", { p_slug: slug, p_days: days });
  if (error) return `Could not read the prompt positions: ${error.message}`;
  return Array.isArray(data) ? (data as PromptPosition[]) : [];
}
