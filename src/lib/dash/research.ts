import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { loadDiyClient } from "@/lib/diy/core/client";
import { readKeywordDifficulty, readKeywordSuggestions, readRelatedKeywords } from "@/lib/diy/core/doors";
import { runOnDemand } from "@/lib/diy/core/runondemand";
import { AUDIENCE_SEED, type Audience } from "@/config/keyword-audience";
import { type ResearchedKeyword, keywordForm, researchSeed } from "@/lib/scan/dataforseo-request";

import { rankForAudience } from "./audience";

/**
 * Keyword research on the dashboards host (Danny, 17 Oct 2026: "search for
 * new keywords ... showing search volume and keyword difficulty, with
 * one-click add to tracking"). DataForSEO Labs, server-side only:
 *
 * - every paid read goes through the DIY ledger (runOnDemand, action
 *   keyword_research): the global kill switch and daily caps, 30 on-demand
 *   Labs reads a client a day (caps.ts), and the client's month budget;
 * - every answer is kept in keyword_research for 30 days and shared across
 *   clients by market, kind and seed, so a repeat search costs nothing;
 * - each suggestion's difficulty is kept as a "difficulty" row too, so a
 *   keyword tracked from a search already has its KD.
 */

export const RESEARCH_DAYS = 30;
export type ResearchKind = "suggestions" | "related";
export type ResearchAnswer = { ok: true; rows: ResearchedKeyword[]; cached: boolean } | { ok: false; message: string };

function addDays(d: string, n: number): string {
  return new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

const absent = (e: { code?: string; message: string } | null) => !!e && (e.code === "42P01" || e.code === "PGRST205" || /relation .* does not exist|Could not find the table/i.test(e.message));

async function cached(db: SupabaseClient, market: string, kind: string, seed: string, today: string): Promise<unknown[] | null> {
  const { data, error } = await db.from("keyword_research").select("rows").eq("market", market).eq("kind", kind).eq("seed", seed).gte("read_on", addDays(today, -RESEARCH_DAYS)).order("read_on", { ascending: false }).limit(1);
  if (error) {
    if (!absent(error)) console.warn(`[dash] keyword research cache unreadable: ${error.message}`);
    return null;
  }
  return (data?.[0]?.rows as unknown[] | undefined) ?? null;
}

async function keep(db: SupabaseClient, rows: { market: string; kind: string; seed: string; rows: unknown; read_on: string }[]): Promise<void> {
  if (!rows.length) return;
  const { error } = await db.from("keyword_research").upsert(rows, { onConflict: "market,kind,seed,read_on" });
  if (error && !absent(error)) console.warn(`[dash] keyword research not cached: ${error.message}`);
}

type ReadOne = { ok: true; rows: ResearchedKeyword[]; cached: boolean } | { ok: false; message: string };

/** One Labs read for a seed, from the 30-day cache when it is there, else through the capped ledger and into the cache. */
async function readOne(db: SupabaseClient, p: { clientId: string; market: "US" | "UK"; member: string; seed: string; kind: ResearchKind; today: string }): Promise<ReadOne> {
  const hit = await cached(db, p.market, p.kind, p.seed, p.today);
  if (hit) return { ok: true, rows: hit as ResearchedKeyword[], cached: true };
  const client = await loadDiyClient(db, p.clientId, Date.now());
  if (!client) return { ok: false, message: "Keyword research is not available on this site." };
  const answer = await runOnDemand({ db, client, member: p.member, action: "keyword_research" }, (ctx) => (p.kind === "suggestions" ? readKeywordSuggestions(ctx, p.seed) : readRelatedKeywords(ctx, p.seed)));
  if (!answer.ok) return { ok: false, message: answer.words };
  if (answer.deferred) return { ok: false, message: "That search is still running. Try again in a moment." };
  const read = answer.value;
  if (read.kind === "refused") return { ok: false, message: "Keyword searches are paused for now. Try again tomorrow." };
  if (read.kind === "failed") return { ok: false, message: "The keyword data did not come back. Try again in a minute." };
  const rows = read.value;
  await keep(db, [
    { market: p.market, kind: p.kind, seed: p.seed, rows, read_on: p.today },
    ...rows.filter((r) => r.kd !== null).map((r) => ({ market: p.market, kind: "difficulty", seed: keywordForm(r.keyword), rows: [{ keyword: r.keyword, kd: r.kd, volume: r.volume, cpc: r.cpc, intent: r.intent }], read_on: p.today })),
  ]);
  return { ok: true, rows, cached: false };
}

/**
 * A search for one seed, shaped for an audience (18 Oct 2026, the B2B / B2C toggle; lib/dash/audience.ts).
 * "All" is one read. B2B or B2C adds one related read on the audience's own seed ("<seed> services", "best
 * <seed>"), then ranks the merged rows by the audience's words and DataForSEO's intent. Each read is cached on
 * its own seed for 30 days, so each toggle value costs its reads once.
 */
export async function research(db: SupabaseClient, p: { clientId: string; market: string; member: string; seed: string; kind: ResearchKind; today: string; audience?: Audience }): Promise<ResearchAnswer> {
  let seed: string;
  try {
    seed = researchSeed(p.seed);
  } catch (e) {
    return { ok: false, message: (e as Error).message.replace(/^a /, "A ") };
  }
  const market = p.market === "UK" ? "UK" : "US";
  const audience = p.audience ?? "all";
  const base = await readOne(db, { clientId: p.clientId, market, member: p.member, seed, kind: p.kind, today: p.today });
  if (!base.ok) return base;
  if (audience === "all") return { ok: true, rows: rankForAudience(base.rows, "all"), cached: base.cached };
  const biased = await readOne(db, { clientId: p.clientId, market, member: p.member, seed: researchSeed(AUDIENCE_SEED[audience](seed)), kind: "related", today: p.today });
  // A refused or failed second read still answers with the first, ranked for the audience.
  const rows = biased.ok ? [...base.rows, ...biased.rows] : base.rows;
  return { ok: true, rows: rankForAudience(rows, audience), cached: base.cached && (!biased.ok || biased.cached) };
}

/** What is already known about these keywords - difficulty, volume, CPC, intent - from the shared cache. Free. */
export async function knownMetrics(db: SupabaseClient, market: string, keywords: readonly string[], today: string): Promise<Map<string, ResearchedKeyword>> {
  const out = new Map<string, ResearchedKeyword>();
  const seeds = [...new Set(keywords.map((k) => keywordForm(k)))].slice(0, 200);
  if (!seeds.length) return out;
  const { data, error } = await db.from("keyword_research").select("seed, rows").eq("market", market === "UK" ? "UK" : "US").eq("kind", "difficulty").in("seed", seeds).gte("read_on", addDays(today, -RESEARCH_DAYS));
  if (error) {
    if (!absent(error)) console.warn(`[dash] keyword metrics unreadable: ${error.message}`);
    return out;
  }
  for (const r of data ?? []) {
    const row = ((r.rows as ResearchedKeyword[]) ?? [])[0];
    if (row) out.set(String(r.seed), row);
  }
  return out;
}

/** Difficulty for tracked keywords the cache does not know yet: one capped Labs read for up to 100. */
export async function fillDifficulty(db: SupabaseClient, p: { clientId: string; market: string; member: string; keywords: readonly string[]; today: string }): Promise<{ ok: true; filled: number } | { ok: false; message: string }> {
  const market = p.market === "UK" ? "UK" : "US";
  const known = await knownMetrics(db, market, p.keywords, p.today);
  const missing = [...new Set(p.keywords.map((k) => keywordForm(k)))].filter((k) => !known.has(k)).slice(0, 100);
  if (!missing.length) return { ok: true, filled: 0 };
  const client = await loadDiyClient(db, p.clientId, Date.now());
  if (!client) return { ok: false, message: "Keyword data is not available on this site." };
  const answer = await runOnDemand({ db, client, member: p.member, action: "keyword_research" }, (ctx) => readKeywordDifficulty(ctx, missing));
  if (!answer.ok) return { ok: false, message: answer.words };
  if (answer.deferred || answer.value.kind !== "read") return { ok: false, message: "The keyword data did not come back. Try again in a minute." };
  await keep(db, answer.value.value.map((r) => ({ market, kind: "difficulty", seed: r.keyword, rows: [{ keyword: r.keyword, kd: r.kd, volume: null, cpc: null, intent: null }], read_on: p.today })));
  return { ok: true, filled: answer.value.value.length };
}
