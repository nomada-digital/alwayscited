import { SCAN_LIMITS } from "@/config/contact";
import {
  clusterKeywordCandidates,
  describeAnthropicError,
  generateQuestions,
  siteFacts,
  type GeneratedQuestion,
  QUESTION_COUNT,
  TOPIC_VARIANT_COUNT,
} from "@/lib/scan/anthropic";
import { readKeywordIntents, readKeywordVolumes } from "@/lib/scan/dataforseo";
import { isScanMarket, type Market } from "@/lib/scan/domain";
import { partnerMayUse } from "@/lib/scan/handoff";
import { clusterKeywordFits, pickClusterKeyword } from "@/lib/scan/target-keyword";
import { normaliseTopicVariants } from "@/lib/scan/topic-variants";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The questions, written but not yet asked.
 *
 * The confirm screen shows what is about to run before a penny is spent, which
 * is the whole point of that screen: if the category is wrong then every
 * question built on it is wrong, and nobody says so unless they are shown.
 *
 * Since 30 Sep 2026 (BRIEF-3 C1) it is not free: before the questions are
 * written it picks the scan's one cluster keyword - a model call for
 * candidates, then one DataForSEO volume read and one intent read, a few
 * cents, billed onto the scan's dfs_cost (which daily_cost_cap_usd sums) and
 * stored on the scan. A rewrite on the same topic and market reuses it. It
 * touches no engine and stores no questions - what gets asked is what comes
 * back through /confirm, after the visitor has pruned it.
 */

/**
 * How many times one scan may have its question set written.
 *
 * The first set plus four rewrites. The route is otherwise unbounded - nothing
 * else stops the same token asking for a new set forever - and an Anthropic
 * call is not covered by daily_cost_cap_usd, which sums DataForSEO spend only.
 *
 * Counted off preview_calls, which exists because this used to count off
 * anthropic_calls and that column stopped meaning previews the day the
 * pipeline started billing onto it. A free pass writes one call for the
 * question set, one per engine for brand extraction, one to judge the
 * leaderboard and one for source kinds, so any scan that has run is past a
 * ceiling of six before a visitor has rewritten anything. Where that showed
 * was the retry a failed scan offers: the screen came back, asked for its
 * preview, and was told we had rewritten these a few times now.
 *
 * Both columns are still written. anthropic_calls is the cost, which the
 * admin page reads; preview_calls is the allowance.
 *
 * Taken as a reservation before the call goes out rather than counted after it
 * comes back. Read-then-write let every request in a concurrent batch read the
 * same number, pass, spend, and write the same total - so a hundred requests
 * were a hundred calls and moved the column by one. The route is public and
 * its only credential is the scan token, so a batch is a thing anyone holding
 * a link can send. note_preview_call does it in one statement instead.
 */
const CALL_CEILING = 5;

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;

  let body: { topic?: string; market?: string; topic_variants?: string[] };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }

  const db = supabaseAdmin();
  const { data: scan, error: readErr } = await db
    .from("scans")
    // Neither counter is read here any more. The ceiling is decided by
    // note_preview_call inside the update, which is the only reading of
    // preview_calls that two concurrent requests cannot disagree about.
    .select("id, status, domain, brand_name, positioning, topic, topic_variants, market, ref, site_facts, cluster_keyword, cluster_keyword_volume, cluster_keyword_intent, cluster_keyword_status, cluster_keyword_market, cluster_keyword_topic")
    .eq("public_token", token)
    .maybeSingle();

  /**
   * A read that failed is not a token that does not exist.
   *
   * These arrived at the screen as the same 404, so a broken select - a column
   * that is not there yet, a database that is not answering - told the visitor
   * their scan link was wrong. That is the one message that makes somebody
   * close the tab rather than try again, and it is the wrong one.
   */
  if (readErr) {
    console.warn("[scan] could not read the scan for a preview: " + readErr.message);
    return Response.json(
      { error: "read_failed", message: "We could not reach the checker. Try again." },
      { status: 502 },
    );
  }

  if (!scan) return Response.json({ error: "not_found" }, { status: 404 });

  // Only a scan that has not run yet. Rewriting the questions of one that is
  // running or complete would describe it wrongly on its own screen: the
  // answers on file were given to the questions it actually asked.
  if (scan.status !== "pending_topic" && scan.status !== "failed") {
    return Response.json({ error: "already_started", status: scan.status }, { status: 409 });
  }

  const topic = (body.topic ?? scan.topic ?? "").trim();
  if (topic.length < 2 || topic.length > SCAN_LIMITS.topic) {
    return Response.json({ error: "bad_topic", message: "Tell us the category in a few words." }, { status: 400 });
  }

  // JM only on a scan whose partner offers it (handoff.ts partnerMayUse, 29 Oct 2026); the row's own market stands otherwise.
  const asked = isScanMarket(body.market) && partnerMayUse(scan.ref as string | null, body.market) ? body.market : null;
  const market = asked ?? (isScanMarket(scan.market) ? scan.market : "US");

  const supplied: unknown[] = Array.isArray(body.topic_variants)
    ? body.topic_variants
    : ((scan.topic_variants as string[] | null) ?? []);
  /**
   * A variant that is the topic again is dropped, case-insensitively.
   *
   * Variants are lowercased here; the topic is whatever the visitor typed into
   * the category field, where a capital is ordinary. So "B2B SEO agency" and
   * the variant "b2b seo agency" were two different strings to the filter
   * below and one chip too many on the screen: the clusters list carried both,
   * while generateQuestions folded them onto one key and stamped every
   * question with the lower-cased one. The chip carrying the visitor's own
   * capitalisation then counted nothing and toggled nothing - a dead control
   * on the first screen of the funnel, reading identically to the live one
   * beside it.
   *
   * What this route did NOT do, until 20 Sep 2026, is dedupe the variants
   * against each other - and `clusters` below is `[topic, ...variants]`, which
   * `ConfirmScreen` renders with `key={c}`. One repeated string is two chips
   * under one React key, both toggling the same cluster, while the footer's
   * `keptClusters` Set counts one. The model is asked for "up to 5 ways buyers
   * phrase this category", so two spellings of one phrase is its ordinary
   * failure rather than an edited payload.
   *
   * Both folds live in `normaliseTopicVariants` now, with `/confirm` and
   * `/scan/start`, because this was the only one of the three doing either.
   */
  const variants = normaliseTopicVariants(topic, supplied, {
    min: SCAN_LIMITS.topicVariant.min,
    max: SCAN_LIMITS.topicVariant.max,
    cap: TOPIC_VARIANT_COUNT,
  });

  /**
   * One rewrite, taken before it is spent.
   *
   * The reservation is the ceiling: the function updates the row only where
   * preview_calls is still under it, so two requests arriving together cannot
   * both pass. A 0 back means refused - already at the ceiling - and nothing
   * has been spent to find that out.
   *
   * An error here refuses too, and says so as a 502 rather than as the rewrite
   * limit. They are different things and the visitor can act on only one of
   * them: "try again" is true of a database that did not answer and false of
   * an allowance that is used up.
   */
  const { data: reserved, error: reserveErr } = await db.rpc("note_preview_call", {
    p_scan: scan.id,
    p_ceiling: CALL_CEILING,
  });
  if (reserveErr) {
    console.warn("[scan] could not reserve a preview call for " + scan.id + ": " + reserveErr.message);
    return Response.json(
      { error: "read_failed", message: "We could not reach the checker. Try again." },
      { status: 502 },
    );
  }
  if (!Number(reserved ?? 0)) {
    return Response.json(
      {
        error: "rewrite_limit",
        message: "We have rewritten these a few times now. Run them, or start again with a different category.",
      },
      { status: 429 },
    );
  }

  // What the call actually billed, against the one already reserved. withRetry
  // makes up to three requests and Anthropic bills each, so the reservation is
  // a floor rather than the figure; a call that threw before it sent anything
  // hands its reservation back.
  const billed = { calls: 0 };

  /** Settles the reservation against the bill, through whichever exit this takes. */
  const recordSpend = async () => {
    const delta = billed.calls - 1;
    if (!delta) return;
    const { error } = await db.rpc("note_preview_calls", { p_scan: scan.id, p_calls: delta });
    if (error) {
      // Not fatal on either exit: the reservation is already on the row, so the
      // ceiling holds either way and what is lost is the accuracy of the cost.
      console.warn("[scan] could not settle preview calls for " + scan.id + ": " + error.message);
    }
  };

  const cluster = await clusterKeywordFor(db, scan, topic, market);

  // Annotated rather than left to evolve, because the assignment below is a
  // destructuring one and an inferred `any` here would take the type off
  // everything the response is built from.
  let questions: GeneratedQuestion[];
  try {
    ({ questions } = await generateQuestions({
      topic,
      topicVariants: variants,
      market,
      brand: scan.brand_name ?? scan.domain,
      domain: scan.domain,
      positioning: scan.positioning,
      ...siteFacts(scan.site_facts),
      keyword: cluster.keyword,
    }, billed));
  } catch (err) {
    // Logged rather than swallowed. This is the only step between a visitor
    // and their scan, and a silent 502 here looks identical to a slow network.
    console.warn("[scan] could not write the questions for " + scan.id + ": " + describeAnthropicError(err));
    await recordSpend();
    return Response.json(
      { error: "write_failed", message: "We could not write the questions just now. Try again." },
      { status: 502 },
    );
  }

  // Settled whether or not the visitor goes on to run them. The admin page and
  // the ceiling above both read these columns, and a call that happened is a
  // cost that happened.
  await recordSpend();

  return Response.json({
    topic,
    market,
    // The chips, in the order the questions group under them: the broad
    // category first, then the narrowing the site gave us.
    clusters: [topic, ...variants],
    max: QUESTION_COUNT,
    questions,
    // The one cluster keyword (BRIEF-3 C1), or why there is none.
    cluster_keyword: cluster,
  });
}

type ClusterKeyword = { keyword: string | null; volume: number | null; intent: string | null; status: "chosen" | "none_qualified" | "read_failed" };

/**
 * The scan's cluster keyword - BRIEF-3 C1 (Danny, 29 Sep 2026). Chosen once,
 * before the prompts are written, so the prompts are about a keyword that
 * already passed: measured Google volume above zero and a commercial or
 * transactional intent (`pickClusterKeyword`). A rewrite on the same topic and
 * market reuses what is stored and makes no new reads; a changed topic or
 * market re-runs the check, inside CALL_CEILING's reservation above.
 *
 * Never fatal. A read that throws stores `read_failed` and the prompts are
 * written on the category, the same as `none_qualified`. What was spent is
 * billed onto the scan through `note_scan_spend` - DataForSEO onto `dfs_cost`,
 * which `daily_cost_cap_usd` sums, and the candidates call onto
 * `anthropic_calls` only, not the visitor's rewrite allowance.
 */
async function clusterKeywordFor(
  db: ReturnType<typeof supabaseAdmin>,
  scan: Record<string, unknown>,
  topic: string,
  market: Market,
): Promise<ClusterKeyword> {
  // Reused only for the topic and market it was read for (18 Oct 2026): scans.market and .topic are written by /confirm,
  // not here, so comparing against them let a keyword read in one market come back after the market was switched twice.
  if (clusterKeywordFits({ status: scan.cluster_keyword_status, topic: scan.cluster_keyword_topic, market: scan.cluster_keyword_market }, topic, market)) {
    return {
      keyword: (scan.cluster_keyword as string | null) ?? null,
      volume: (scan.cluster_keyword_volume as number | null) ?? null,
      intent: (scan.cluster_keyword_intent as string | null) ?? null,
      status: scan.cluster_keyword_status as ClusterKeyword["status"],
    };
  }
  const modelBilled = { calls: 0 };
  let dfsCost = 0;
  let dfsCalls = 0;
  let out: ClusterKeyword;
  try {
    const candidates = await clusterKeywordCandidates(
      { topic, market, positioning: (scan.positioning as string | null) ?? null, ...siteFacts(scan.site_facts) },
      modelBilled,
    );
    if (!candidates.length) {
      out = { keyword: null, volume: null, intent: null, status: "none_qualified" };
    } else {
      const [v, i] = await Promise.all([readKeywordVolumes(candidates, market, 20_000), readKeywordIntents(candidates, 20_000)]);
      dfsCalls = 2;
      dfsCost = v.cost + i.cost;
      const pick = pickClusterKeyword(candidates, v.volumes, i.intents);
      out = "none" in pick ? { keyword: null, volume: null, intent: null, status: "none_qualified" } : { ...pick, status: "chosen" };
    }
  } catch (err) {
    console.warn(`[scan] cluster keyword check failed for ${String(scan.id)}: ${err instanceof Error ? err.message : String(err)}`);
    out = { keyword: null, volume: null, intent: null, status: "read_failed" };
  }
  const { error: wErr } = await db
    .from("scans")
    .update({ cluster_keyword: out.keyword, cluster_keyword_volume: out.volume, cluster_keyword_intent: out.intent, cluster_keyword_status: out.status, cluster_keyword_market: market, cluster_keyword_topic: topic })
    .eq("id", scan.id as string);
  if (wErr) console.warn(`[scan] cluster keyword not stored for ${String(scan.id)}: ${wErr.message}`);
  if (dfsCalls || dfsCost || modelBilled.calls) {
    const { error: bErr } = await db.rpc("note_scan_spend", {
      p_scan: scan.id as string,
      p_dfs_calls: dfsCalls,
      p_dfs_cost: dfsCost,
      p_anthropic_calls: modelBilled.calls,
    });
    if (bErr) console.warn(`[scan] cluster keyword spend not billed for ${String(scan.id)}: ${bErr.message}`);
  }
  return out;
}
