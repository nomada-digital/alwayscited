import { SCAN_LIMITS } from "@/config/contact";
import { TOPIC_VARIANT_COUNT } from "@/lib/scan/anthropic";
import { checkCeilings } from "@/lib/scan/ceilings";
import { clientIp, hashIp } from "@/lib/scan/ip";
import { getSettings } from "@/lib/scan/settings";
import { normaliseTopicVariants } from "@/lib/scan/topic-variants";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fail(status: number, code: string, message: string) {
  return Response.json({ error: code, message }, { status });
}

/**
 * "Run a new check" on a finished report - 29 Oct 2026.
 *
 * The domain cache in /api/scan/start hands anyone who types a domain the last
 * free reading of it for `domain_cache_days`, whatever category or prompts they
 * wanted, and it is matched on the server, so a private window changes nothing.
 * Luke hit it on gracefoods.com before an agency call: a mistake in the
 * category, or one more prompt, could not be tried. It reads as being out of
 * credits, which it is not.
 *
 * This starts a new scan of the same domain from the reading on screen, at the
 * confirm step, so the category and every prompt can be changed before
 * anything is spent. The site read and brand read are copied, not repeated:
 * they are about the site, not the question set, and they are already on the
 * row the visitor is looking at. Nothing here is paid; the run is paid at
 * /confirm, as every free scan is.
 *
 * Bounded twice: every ceiling in ceilings.ts (the kill switch, the day's scan
 * count, both spend caps, this caller's allowance), and `domain_reruns_per_day`
 * new checks of one domain in a rolling day, so the cache cannot simply be
 * stepped round in a loop.
 *
 * Only from a finished free scan. A tracking run is a paying client's own
 * reading and a campaign reading is somebody's brief; neither is a free scan
 * anyone may start from.
 *
 * POST -> {token} of the new scan, which opens on its confirm step.
 */
export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const db = supabaseAdmin();

  const { data: from, error: readErr } = await db
    .from("scans")
    .select("domain, brand_name, positioning, site_facts, topic, topic_variants, market, market_reason, status, is_tracking_run, campaign_id")
    .eq("public_token", token)
    .maybeSingle();
  if (readErr) {
    console.warn("[scan] could not read the scan to re-run it: " + readErr.message);
    return fail(502, "read_failed", "We could not reach the checker. Please try again.");
  }
  if (!from) return fail(404, "not_found", "We could not find that report.");
  if (from.status !== "complete" || from.is_tracking_run || from.campaign_id) {
    return fail(409, "not_rerunnable", "A new check can only be started from a finished free report.");
  }

  const settings = await getSettings();
  const ipHash = hashIp(clientIp(req));
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const refusal = await checkCeilings({ settings, since, ipHash, subject: "scan" });
  if (refusal) return fail(refusal.http, refusal.code, refusal.message);

  // Counted, and a count that did not answer refuses rather than reading as none.
  const { count, error: countErr } = await db
    .from("scans")
    .select("id", { count: "exact", head: true })
    .eq("domain", from.domain)
    .eq("is_tracking_run", false)
    .is("campaign_id", null)
    .gte("created_at", since);
  if (countErr) {
    console.warn(`[scan] could not count today's checks of ${from.domain}: ${countErr.message}`);
    return fail(502, "read_failed", "We could not reach the checker. Please try again.");
  }
  if ((count ?? 0) >= settings.domain_reruns_per_day) {
    return fail(
      429,
      "domain_limit",
      `${from.domain} has been checked ${count} times today, which is as many as we run for one site in a day. Try again tomorrow.`,
    );
  }

  const { data: scan, error } = await db
    .from("scans")
    .insert({
      domain: from.domain,
      brand_name: from.brand_name,
      positioning: from.positioning,
      site_facts: from.site_facts,
      topic: from.topic,
      // Through the one cleaner every door onto this column uses (topic-variants.test.mts).
      topic_variants: normaliseTopicVariants(
        (from.topic as string | null) ?? null,
        Array.isArray(from.topic_variants) ? (from.topic_variants as string[]) : [],
        { min: SCAN_LIMITS.topicVariant.min, max: SCAN_LIMITS.topicVariant.max, cap: TOPIC_VARIANT_COUNT },
      ),
      market: from.market,
      market_reason: from.market_reason,
      status: "pending_topic",
      ip_hash: ipHash,
      // Today's engine sets, frozen onto the row as /start freezes them.
      engines: settings.scan_engines_free,
      gated_engines: settings.scan_engines_gated,
      anthropic_calls: 0,
    })
    .select("public_token")
    .single();
  if (error || !scan) {
    console.warn(`[scan] could not start a new check of ${from.domain}: ${error?.message ?? "no row"}`);
    return fail(500, "store_failed", "We could not start a new check. Please try again.");
  }

  console.log(`[scan] new check of ${from.domain} started from a finished report`);
  return Response.json({ token: scan.public_token });
}
