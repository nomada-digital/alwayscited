import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Prompt tiers and "ready to broaden" (Danny, 18 Nov 2026: "yep love it"; nomada-daily
 * docs/handbook/prompt-expansion-playbook.md). Prompts start narrow and widen once the narrow ones are won.
 *
 * `tracked_questions.prompt_tier` holds the tier (supabase/migrations/20261118000000_prompt_tiers.sql); every prompt
 * tracked before then is tier 1. Staff set it from the agency view (lib/agency/edit.ts setPromptTier).
 *
 * The rule is worked out in one place, the database function `prompt_broaden(p_slug)`: the hub's alwayscited customer
 * view, /admin/tracking and Kev's My week all read it. The three numbers below are that function's, for labels; the
 * test reads them back out of the migration so the two cannot drift.
 */

export const PROMPT_TIERS = [1, 2, 3, 4] as const;
export type PromptTier = (typeof PROMPT_TIERS)[number];

export const PROMPT_TIER_LABEL: Record<PromptTier, string> = {
  1: "Exact service",
  2: "Category",
  3: "Category + market",
  4: "Adjacent",
};

/** A tier is won when the brand is named in at least this share of its answers... */
export const WIN_SHARE = 0.5;
/** ...at least this many engines each name it in that share of their own answers... */
export const WIN_ENGINES = 2;
/** ...on each of this many consecutive readings. */
export const WIN_READINGS = 2;

export function promptTierOf(raw: unknown): PromptTier | null {
  const n = typeof raw === "number" ? raw : Number(raw);
  return (PROMPT_TIERS as readonly number[]).includes(n) ? (n as PromptTier) : null;
}

/** Tiers 2 to 4: the "Growth prompts" a customer's dashboard reports apart from the core (playbook rule 5). */
export const isGrowthTier = (t: unknown): boolean => (promptTierOf(t) ?? 1) > 1;

export type BroadenEngine = { engine: string; answers: number; named: number; share: number };
export type BroadenReading = { run_date: string; answers: number; named: number; share: number; engines_won: number; engines: BroadenEngine[] };
export type BroadenPrompt = { id: string; text: string; answers: number; named: number; share: number | null };
export type BroadenTier = { tier: PromptTier; prompts: number; readings: number; won: boolean; by_reading: BroadenReading[]; by_prompt: BroadenPrompt[] };
export type Broaden = {
  slug: string;
  domain: string;
  brand: string;
  plan: string;
  top_tier: PromptTier | null;
  ready: boolean;
  next_tier: PromptTier | null;
  pool: { size: number; live: number; free: number };
  rule: { share: number; engines: number; readings: number };
  tiers: BroadenTier[];
};

/** Every live customer's broaden status, or one customer's (`slug`). A string is the error. */
export async function readBroaden(db: SupabaseClient, slug: string | null): Promise<Broaden[] | string> {
  const { data, error } = await db.rpc("prompt_broaden", { p_slug: slug });
  if (error) return `Could not read the prompt tiers: ${error.message}`;
  return Array.isArray(data) ? (data as Broaden[]) : [];
}
