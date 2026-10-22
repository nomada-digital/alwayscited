import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

import { readBrand, clusterKeywordCandidates } from "@/lib/scan/anthropic";
import { readSite } from "@/lib/scan/crawl";
import { readKeywordIntents, readKeywordVolumes } from "@/lib/scan/dataforseo";
import type { Market } from "@/lib/scan/domain";
import { STARTER_BY } from "@/lib/dash/types";
import { ANGLES, insertKeyword, insertPrompts, PROMPTS_PER_CLUSTER } from "@/lib/tracking/limits";
import { marketDrafts, pickStarters, starterTopics } from "@/lib/tracking/starter-pick";

/**
 * Starter clusters (Danny, 22 Oct 2026; the rules are in starter-pick.ts). Run once a signup has made its client
 * and clusters (signup.ts clientFromOrder), after the webhook has answered Stripe - the reads take seconds.
 *
 * Every live cluster with no keyword gets one picked from the buyer's site in the market paid for, the cluster
 * named after it and the keyword marked `added_by: "starter"` (the board shows "Suggested - yours to edit");
 * every live cluster with no prompt gets setup's five drafts, one per angle, naming the market. What could not be
 * made stays as it was ("Needs a keyword"), and the order email to Danny says so, with /admin/tracking, as before.
 *
 * Bounded: at most MAX_TOPIC_CALLS candidate calls (8 candidates each) and one volume and one intent read.
 * Never throws; every failure is in the result's text.
 */

const MAX_TOPIC_CALLS = 3;
const READ_BUDGET_MS = 20_000;

export type StarterInput = {
  clientId: string;
  domain: string;
  market: "UK" | "US";
  startedOn: string;
  /** From the scan when it was in the market paid for; null otherwise, and the site is read for them. */
  topic: string | null;
  positioning: string | null;
  services: string[];
  industries: string[];
  topicVariants: string[];
};
export type StarterResult = { made: string[]; drafted: string[]; failed: string[]; text: string; calls: { model: number; dfsUsd: number } };

export async function fillStarters(db: SupabaseClient, input: StarterInput): Promise<StarterResult> {
  const made: string[] = [];
  const drafted: string[] = [];
  const failed: string[] = [];
  const billed = { calls: 0 };
  let dfsUsd = 0;
  const done = (extra = ""): StarterResult => {
    const parts = [
      made.length ? `starter keyword${made.length === 1 ? "" : "s"} picked: ${made.join(", ")}` : "",
      drafted.length ? `five market prompts drafted for ${drafted.join(", ")}` : "",
      failed.length ? `NOT generated: ${failed.join("; ")} - pick keywords and prompts in /admin/tracking` : "",
      extra,
    ].filter(Boolean);
    return { made, drafted, failed, text: parts.length ? `Starter: ${parts.join("; ")}.` : "", calls: { model: billed.calls, dfsUsd } };
  };

  const { data: clusters, error: cErr } = await db
    .from("tracked_clusters")
    .select("id, name, keyword_id")
    .eq("client_domain_id", input.clientId)
    .is("stopped_on", null)
    .order("created_at", { ascending: true });
  if (cErr) return done(`NOT generated: could not read the clusters (${cErr.message}) - pick keywords and prompts in /admin/tracking`);
  const { data: kws, error: kErr } = await db.from("tracked_keywords").select("id, keyword").eq("client_domain_id", input.clientId).is("stopped_on", null);
  const { data: qs, error: qErr } = await db.from("tracked_questions").select("cluster_id").eq("client_domain_id", input.clientId).is("stopped_on", null);
  if (kErr || qErr) return done(`NOT generated: could not read the keywords or prompts (${(kErr ?? qErr)!.message}) - pick them in /admin/tracking`);
  const keywordOf = new Map((kws ?? []).map((k) => [k.id as string, String(k.keyword)]));
  const prompts = new Map<string, number>();
  for (const q of qs ?? []) if (q.cluster_id) prompts.set(q.cluster_id as string, (prompts.get(q.cluster_id as string) ?? 0) + 1);

  const needs = (clusters ?? [])
    .map((c) => ({ id: c.id as string, name: String(c.name), keyword: c.keyword_id ? (keywordOf.get(c.keyword_id as string) ?? null) : null }))
    .map((c) => ({ ...c, needKeyword: !c.keyword, needPrompts: (prompts.get(c.id) ?? 0) === 0 }))
    .filter((c) => c.needKeyword || c.needPrompts);
  if (!needs.length) return done();

  // Keywords for the clusters that have none: candidates from the site's category (read now when the order had no
  // scan to give one), then its other phrases, until there are enough or the calls run out.
  const wanted = needs.filter((c) => c.needKeyword).length;
  let picks: { keyword: string; volume: number; intent: string }[] = [];
  if (wanted) {
    let topic = input.topic, positioning = input.positioning, services = input.services, industries = input.industries, variants = input.topicVariants;
    try {
      if (!topic) {
        const brand = await readBrand(await readSite(input.domain), billed);
        topic = brand.suggested_topic;
        positioning = brand.positioning;
        services = brand.services;
        industries = brand.industries;
        variants = brand.topic_variants;
        // the client row learns its category and name, as a scan would have given them; logged, never fatal
        const { error } = await db.from("client_domains").update({ topic: brand.suggested_topic, brand_name: brand.brand_name }).eq("id", input.clientId).is("topic", null);
        if (error) console.warn(`[starter] topic not stored on ${input.clientId}: ${error.message}`);
      }
      const candidates: string[] = [];
      for (const t of starterTopics(topic, variants, services).slice(0, MAX_TOPIC_CALLS)) {
        candidates.push(...(await clusterKeywordCandidates({ topic: t, market: input.market as Market, positioning, services, industries }, billed)));
        if (new Set(candidates).size >= wanted * 4) break;
      }
      const unique = [...new Set(candidates)];
      if (unique.length) {
        const [v, i] = await Promise.all([readKeywordVolumes(unique, input.market as Market, READ_BUDGET_MS), readKeywordIntents(unique, READ_BUDGET_MS)]);
        dfsUsd = v.cost + i.cost;
        picks = pickStarters(unique, v.volumes, i.intents, wanted, [...keywordOf.values()]);
      }
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err);
      console.warn(`[starter] keyword read failed for ${input.domain}: ${why}`);
      for (const c of needs.filter((x) => x.needKeyword)) failed.push(`${c.name} (${c.id.slice(0, 8)}): the keyword read failed (${why.slice(0, 120)})`);
    }
  }

  let next = 0;
  for (const c of needs) {
    let keyword = c.keyword;
    if (c.needKeyword) {
      if (failed.some((f) => f.includes(c.id.slice(0, 8)))) continue;
      const p = picks[next++];
      if (!p) {
        failed.push(`${c.name} (${c.id.slice(0, 8)}): no keyword with ${input.market} volume and a buying intent`);
        continue;
      }
      const kw = await insertKeyword(db, input.clientId, c.id, { keyword: p.keyword, added_on: input.startedOn, added_by: STARTER_BY, search_volume: p.volume, intent: p.intent });
      if (!kw.ok) {
        failed.push(`${c.name}: keyword "${p.keyword}" refused (${kw.message})`);
        continue;
      }
      const { error } = await db.from("tracked_clusters").update({ name: p.keyword }).eq("id", c.id);
      if (error) console.warn(`[starter] cluster ${c.id} not renamed: ${error.message}`);
      keyword = p.keyword;
      made.push(`"${p.keyword}" (${p.volume.toLocaleString("en-GB")}/mo in ${input.market})`);
    }
    if (c.needPrompts && keyword) {
      const rows = marketDrafts(keyword, input.market).slice(0, PROMPTS_PER_CLUSTER)
        .map((text, i) => ({ text, angle: ANGLES[i]!, source: "nomada", origin_kind: "setup" as const, added_on: input.startedOn, added_by: "nomada" }));
      const w = await insertPrompts(db, input.clientId, c.id, rows);
      if (!w.ok) failed.push(`"${keyword}": prompts refused (${w.message})`);
      else drafted.push(`"${keyword}"`);
    }
  }
  return done(billed.calls || dfsUsd ? `${billed.calls} model call(s), $${dfsUsd.toFixed(3)} DataForSEO` : "");
}
