import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { missingColumn } from "@/lib/tracking/limits";

import { clusterKeywordCandidates, siteFacts } from "./anthropic";
import { readClusterRank, storeClusterRank } from "./cluster-rank";
import { readKeywordIntents, readKeywordVolumes } from "./dataforseo";
import { isScanMarket, type Market } from "./domain";
import { KEYWORD_FALLBACK, pickAcrossMarkets, pickClusterKeyword, THIN_KEYWORD_VOLUME } from "./target-keyword";

export type ClusterKeyword = {
  keyword: string | null;
  volume: number | null;
  intent: string | null;
  status: "chosen" | "none_qualified" | "read_failed";
  /** Where the keyword was read: the scan's market, or one of its fallbacks. */
  market: Market;
};

/**
 * The cluster keyword check - BRIEF-3 C1 (Danny, 29 Sep 2026): candidates from
 * the model, their Google volume and intent, and `pickClusterKeyword` (measured
 * volume above zero, commercial or transactional intent). A thin market
 * (KEYWORD_FALLBACK, 3 Nov 2026) reads its buyers' markets too, one volume
 * read each, in order, only while the home pick is under THIN_KEYWORD_VOLUME;
 * intent carries no market, so it is read once.
 *
 * One copy, moved out of /api/scan/[token]/questions on 3 Nov 2026 so the
 * admin's "Add keyword" (`addClusterKeyword`) picks exactly as the confirm
 * step does. Never throws: a read that fails is `read_failed`. What it spent
 * comes back for the caller to bill onto the scan.
 */
export async function chooseClusterKeyword(input: {
  scanId: string;
  topic: string;
  market: Market;
  positioning: string | null;
  siteFacts: unknown;
}): Promise<{ out: ClusterKeyword; dfsCalls: number; dfsCost: number; modelCalls: number }> {
  const { topic, market } = input;
  const modelBilled = { calls: 0 };
  let dfsCost = 0;
  let dfsCalls = 0;
  let out: ClusterKeyword;
  try {
    const candidates = await clusterKeywordCandidates({ topic, market, positioning: input.positioning, ...siteFacts(input.siteFacts) }, modelBilled);
    if (!candidates.length) {
      out = { keyword: null, volume: null, intent: null, status: "none_qualified", market };
    } else {
      const [v, i] = await Promise.all([readKeywordVolumes(candidates, market, 20_000), readKeywordIntents(candidates, 20_000)]);
      dfsCalls = 2;
      dfsCost = v.cost + i.cost;
      const reads = [{ market, pick: pickClusterKeyword(candidates, v.volumes, i.intents) }];
      for (const fallback of KEYWORD_FALLBACK[market] ?? []) {
        if (pickAcrossMarkets(reads) !== reads[0] || ("volume" in reads[0].pick && reads[0].pick.volume >= THIN_KEYWORD_VOLUME)) break;
        const fv = await readKeywordVolumes(candidates, fallback, 20_000);
        dfsCalls += 1;
        dfsCost += fv.cost;
        reads.push({ market: fallback, pick: pickClusterKeyword(candidates, fv.volumes, i.intents) });
      }
      const chosen = pickAcrossMarkets(reads);
      out = "none" in chosen.pick
        ? { keyword: null, volume: null, intent: null, status: "none_qualified", market }
        : { ...chosen.pick, status: "chosen", market: chosen.market };
    }
  } catch (err) {
    console.warn(`[scan] cluster keyword check failed for ${input.scanId}: ${err instanceof Error ? err.message : String(err)}`);
    out = { keyword: null, volume: null, intent: null, status: "read_failed", market };
  }
  return { out, dfsCalls, dfsCost, modelCalls: modelBilled.calls };
}

/**
 * "Add keyword" on /admin/scans (Luke, 3 Nov 2026: "can't re-run a previous
 * scan to now pull in the keyword"). A finished free scan from before C1, or
 * one whose keyword was not picked, gains a cluster keyword and its Google
 * position on the same row, so the link already shared shows them. The AI
 * answers, sources and placements are kept: nothing about them depends on the
 * keyword. "Run a new check" (/api/scan/[token]/rerun) is the other door and
 * makes a new scan at a new link; this one does not.
 *
 * A scan that already has a keyword keeps it and only has its position read
 * again. About $0.10 a press: one model call, two or three volume reads, an
 * intent read and one SERP read, added to the scan's own spend columns.
 *
 * Called only from the admin action (cluster-rank.test.mts holds it there),
 * which checks the admin's Basic auth before it gets here.
 */
export async function addClusterKeyword(token: string): Promise<{ ok: boolean; message: string }> {
  const db = supabaseAdmin();
  const { data: scan, error } = await db
    .from("scans")
    .select("id, domain, topic, market, positioning, site_facts, status, is_tracking_run, campaign_id, cluster_keyword, cluster_keyword_status, cluster_keyword_market, dfs_calls, dfs_cost, anthropic_calls")
    .eq("public_token", token)
    .maybeSingle();
  if (error) return { ok: false, message: "Could not read the scan: " + error.message };
  if (!scan) return { ok: false, message: "No scan has that link." };
  if (scan.status !== "complete" || scan.is_tracking_run || scan.campaign_id) {
    return { ok: false, message: "Only a finished free scan can have a keyword added." };
  }
  const topic = typeof scan.topic === "string" ? scan.topic.trim() : "";
  const market = isScanMarket(scan.market) ? scan.market : null;
  if (!topic || !market) return { ok: false, message: "The scan has no category or market to pick a keyword for." };

  let keyword = scan.cluster_keyword_status === "chosen" && typeof scan.cluster_keyword === "string" ? scan.cluster_keyword.trim() : "";
  let keywordMarket: Market = isScanMarket(scan.cluster_keyword_market) ? scan.cluster_keyword_market : market;
  let picked: ClusterKeyword | null = null;
  let dfsCalls = 0;
  let dfsCost = 0;
  let modelCalls = 0;
  const spend = () => ({
    dfs_calls: (Number(scan.dfs_calls) || 0) + dfsCalls,
    dfs_cost: (Number(scan.dfs_cost) || 0) + dfsCost,
    anthropic_calls: (Number(scan.anthropic_calls) || 0) + modelCalls,
  });
  const billOnly = async () => {
    const { error: bErr } = await db.from("scans").update(spend()).eq("id", scan.id as string);
    if (bErr) console.warn(`[scan] add keyword spend not billed for ${String(scan.id)}: ${bErr.message}`);
  };
  if (!keyword) {
    const c = await chooseClusterKeyword({ scanId: scan.id as string, topic, market, positioning: (scan.positioning as string | null) ?? null, siteFacts: scan.site_facts });
    dfsCalls += c.dfsCalls;
    dfsCost += c.dfsCost;
    modelCalls += c.modelCalls;
    if (c.out.status !== "chosen" || !c.out.keyword) {
      // Nothing to show on the report, so only the spend is written; the scan keeps what it had.
      await billOnly();
      return {
        ok: false,
        message: c.out.status === "read_failed" ? "Google volume could not be read just now. Try again shortly." : `No commercial keyword with searches was found for "${topic}".`,
      };
    }
    picked = c.out;
    keyword = c.out.keyword;
    keywordMarket = c.out.market;
  }

  // The position is read before anything is written: a keyword stored with a null rank reads "Not in top 20",
  // so a read that measured nothing must be storable as unchecked (migration 20261103000000) or not stored at all.
  const read = await readClusterRank(keyword, scan.domain as string, keywordMarket, 30_000);
  dfsCalls += 1;
  dfsCost += read.cost;
  if (read.unchecked && !(await hasUncheckedColumn(db))) {
    await billOnly();
    return {
      ok: false,
      message: `Found "${keyword}", but Google's results came back unreadable (${read.why}) and the scan cannot yet record "couldn't check", so nothing was saved. Try again once migration 20261103000000 is applied.`,
    };
  }
  if (picked) {
    const { error: wErr } = await db
      .from("scans")
      .update({
        cluster_keyword: picked.keyword,
        cluster_keyword_volume: picked.volume,
        cluster_keyword_intent: picked.intent,
        cluster_keyword_status: picked.status,
        cluster_keyword_market: picked.market,
        cluster_keyword_topic: topic,
      })
      .eq("id", scan.id as string);
    if (wErr) return { ok: false, message: "The keyword was picked but not saved: " + wErr.message };
  }
  const wErr = await storeClusterRank(scan.id as string, read, spend());
  if (wErr) return { ok: false, message: `Keyword "${keyword}" saved, but its position was not: ${wErr}` };
  const where = keywordMarket === market ? "" : ` (searched in ${keywordMarket})`;
  const position = read.unchecked ? "position couldn't be checked, it is re-read daily" : read.rank === null ? "not in Google's top 20" : `Google #${read.rank}`;
  console.log(`[scan] admin ${picked ? "added keyword" : "re-read position"} on ${scan.domain}: ${keyword}${where}, ${position}`);
  return { ok: true, message: `${scan.domain}: ${picked ? "added" : "kept"} "${keyword}"${where}, ${position}.` };
}

/** Whether scans.cluster_keyword_rank_unchecked exists yet (migration 20261103000000). */
async function hasUncheckedColumn(db: ReturnType<typeof supabaseAdmin>): Promise<boolean> {
  const { error } = await db.from("scans").select("cluster_keyword_rank_unchecked").limit(1);
  return !error || !missingColumn(error);
}
