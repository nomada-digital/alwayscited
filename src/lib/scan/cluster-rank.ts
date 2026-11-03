import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { missingColumn } from "@/lib/tracking/limits";

import { readKeywordRank } from "./dataforseo";
import { MARKETS, type Market } from "./domain";

/**
 * A scan's cluster keyword position, stored (3 Nov 2026).
 *
 * Three outcomes, and until today two of them were written the same way: a
 * number is a rank, null with `unchecked` false is "not in Google's top 20",
 * and null with `unchecked` true is a read that did not measure anything - it
 * threw, came back empty, or was a degraded page (engines.ts `serpFault`).
 * From 30 Oct DataForSEO served degraded pages for most keywords, and every
 * one of those reached a prospect as "Not in top 20".
 */
export type ClusterRankRead = { rank: number | null; unchecked: boolean };

/** How long after a scan an unchecked position is still read again, once a day. */
export const RETRY_DAYS = 14;
/** The most positions one daily pass reads again. At $0.0035 a read, under 11 cents. */
export const RETRIES_PER_PASS = 30;

/** One read of the scan's cluster keyword, as an outcome. Throws nothing. */
export async function readClusterRank(
  keyword: string,
  domain: string,
  market: Market,
  budgetMs?: number,
): Promise<ClusterRankRead & { cost: number; why: string | null }> {
  try {
    const read = await readKeywordRank(keyword, domain, market, budgetMs);
    if (read.rank === undefined) return { rank: null, unchecked: true, cost: read.cost, why: read.fault ? `${read.fault} SERP` : "empty SERP" };
    return { rank: read.rank, unchecked: false, cost: read.cost, why: null };
  } catch (err) {
    const cost = (err as { cost?: unknown })?.cost;
    return { rank: null, unchecked: true, cost: typeof cost === "number" && cost > 0 ? cost : 0, why: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Writes the outcome. Before migration 20261103000000 is applied the column
 * does not exist; the rank is still written, and an unchecked read is logged
 * rather than stored as a miss it is not.
 */
export async function storeClusterRank(scanId: string, read: ClusterRankRead, extra: Record<string, unknown> = {}): Promise<string | null> {
  const db = supabaseAdmin();
  const { error } = await db
    .from("scans")
    .update({ ...extra, cluster_keyword_rank: read.rank, cluster_keyword_rank_unchecked: read.unchecked })
    .eq("id", scanId);
  if (!error) return null;
  if (!missingColumn(error)) return error.message;
  console.warn(`[scan] ${scanId}: scans.cluster_keyword_rank_unchecked is missing (migration 20261103000000), so ${read.unchecked ? "an unchecked position is stored as not ranked" : "the rank is stored alone"}`);
  const again = await db.from("scans").update({ ...extra, cluster_keyword_rank: read.rank }).eq("id", scanId);
  return again.error?.message ?? null;
}

/**
 * The daily pass: every scan from the last RETRY_DAYS whose position could not
 * be checked is read again, oldest first, RETRIES_PER_PASS at most. A read that
 * is still degraded stays unchecked for tomorrow. What each read billed is
 * added to the scan's own dfs columns, as the pipeline's would have been.
 */
export async function retryUncheckedClusterRanks(now = Date.now()): Promise<{ read: number; ranked: number; notRanked: number; still: number; errors: string[] }> {
  const db = supabaseAdmin();
  const out = { read: 0, ranked: 0, notRanked: 0, still: 0, errors: [] as string[] };
  const since = new Date(now - RETRY_DAYS * 86_400_000).toISOString();
  const { data, error } = await db
    .from("scans")
    .select("id, domain, market, cluster_keyword, dfs_calls, dfs_cost")
    .eq("cluster_keyword_rank_unchecked", true)
    .eq("cluster_keyword_status", "chosen")
    .eq("status", "complete")
    .gte("created_at", since)
    .order("created_at", { ascending: true })
    .limit(RETRIES_PER_PASS);
  if (error) {
    // Before the migration there is nothing marked to retry.
    if (missingColumn(error)) return out;
    out.errors.push(error.message);
    return out;
  }
  for (const s of data ?? []) {
    const keyword = typeof s.cluster_keyword === "string" ? s.cluster_keyword.trim() : "";
    const market = String(s.market).toUpperCase();
    if (!keyword || !(market in MARKETS)) continue;
    const read = await readClusterRank(keyword, s.domain as string, market as Market, 30_000);
    out.read += 1;
    if (read.unchecked) out.still += 1;
    else if (read.rank === null) out.notRanked += 1;
    else out.ranked += 1;
    const err = await storeClusterRank(s.id as string, read, {
      dfs_calls: (Number(s.dfs_calls) || 0) + 1,
      dfs_cost: (Number(s.dfs_cost) || 0) + read.cost,
    });
    if (err) out.errors.push(`${s.id}: ${err}`);
  }
  return out;
}
