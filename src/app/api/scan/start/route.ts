import { after } from "next/server";

import { SCAN_LIMITS } from "@/config/contact";
import { describeAnthropicError, QUESTION_COUNT, readBrand, TOPIC_VARIANT_COUNT } from "@/lib/scan/anthropic";
import { checkCeilings } from "@/lib/scan/ceilings";
import { type ReadFailure, readSite, UnreachableDomain } from "@/lib/scan/crawl";
import type { ThinReason } from "@/lib/scan/page-read";
import { isMarket, isPlausibleDomain, normalizeDomain } from "@/lib/scan/domain";
import { readRankingFootprint } from "@/lib/scan/dataforseo";
import { estimateScanCost } from "@/lib/scan/engine-costs";
import { clientIp, hashIp } from "@/lib/scan/ip";
import { needsRankings, pickMarket } from "@/lib/scan/market-pick";
import { cleanUtm, handoffMarket, scanRef } from "@/lib/scan/handoff";
import { getSettings } from "@/lib/scan/settings";
import { recordModelCallDebit } from "@/lib/scan/spend";
import { normaliseTopicVariants } from "@/lib/scan/topic-variants";
import { verifyTurnstile } from "@/lib/scan/turnstile";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function fail(status: number, code: string, message: string) {
  return Response.json({ error: code, message }, { status });
}

/**
 * What a visitor is told when we could not read their site.
 *
 * The 422 and 502 line is the same one the brand read already draws, and it is
 * the only distinction that matters to the person reading it: 422 means the
 * address is the thing to change, 502 means it is not. Only `dns` and
 * `not_html` are the visitor to fix. For the other three, "check the address"
 * is advice with nothing behind it - their address is right, and they are
 * being sent to look at the one thing that is not wrong.
 */
const SITE_READ_FAILURE: Record<
  ReadFailure,
  (domain: string, status?: number, detail?: ThinReason) => { http: number; code: string; message: string }
> = {
  dns: (d) => ({
    http: 422,
    code: "unreachable",
    message: `Nothing answered at ${d}. Check the address and try again.`,
  }),
  not_html: (d) => ({
    http: 422,
    code: "not_a_page",
    message: `${d} answered, but did not return a web page. Check the address and try again.`,
  }),
  blocked: (d, status) => ({
    http: 502,
    code: "site_blocked",
    // The status is in the sentence on purpose. This is the one failure a
    // visitor can act on without us - a 403 to a named crawler is an allowlist
    // entry on their side - and it is the one they would otherwise have to ask
    // us to look up.
    message:
      `${d} is up, but it would not serve the page to our reader` +
      `${status ? ` (HTTP ${status})` : ""}. ` +
      `That is usually a bot filter or a firewall rather than anything wrong with your address.`,
  }),
  timeout: (d) => ({
    http: 502,
    code: "site_slow",
    message: `${d} took too long to answer. Please try again in a moment.`,
  }),
  // Deliberately says nothing about what it resolved to. A visitor who has
  // pointed us at their own internal host needs to know we will not read it;
  // somebody sweeping for one does not need our resolver as an oracle.
  private: (d) => ({
    http: 422,
    code: "not_public",
    message: `${d} does not resolve to a public web server, so there is nothing for us to read.`,
  }),
  /**
   * Said plainly, and said instead of a report (16 Oct 2026). On 15 Oct a Wix
   * homepage came back as CSS, cleared the old check and was shown as a normal
   * report built from nothing - the worst answer there is, because it looks
   * like a real one. The cause is in the sentence where we know it.
   */
  too_thin: (d, _status, detail) => ({
    http: 502,
    code: "too_little_text",
    message:
      `We reached ${d} but couldn't read this site's content, so we haven't produced a report rather than show you an empty one. ` +
      THIN_CAUSE[detail ?? "empty"],
  }),
};

const THIN_CAUSE: Record<ThinReason, string> = {
  js_only: "The page seems to load its words with JavaScript, which our reader does not run.",
  raw_cap: "The page is too large for our reader to reach its text.",
  time: "The page was too slow to send its text. Please try again in a moment.",
  empty: "We found no title, description or body text on it.",
};

export async function POST(req: Request) {
  let body: { domain?: string; turnstileToken?: string; market?: string; ref?: string; utm?: unknown };
  try {
    body = await req.json();
  } catch {
    return fail(400, "bad_request", "Send a JSON body with a domain.");
  }

  const ip = clientIp(req);

  // 1. Bot filter first: everything below this line costs money or database work.
  if (!(await verifyTurnstile(body.turnstileToken, ip))) {
    return fail(403, "turnstile_failed", "We could not verify that request. Please reload and try again.");
  }

  // 2. Normalise and validate the domain.
  const domain = normalizeDomain(body.domain ?? "");
  if (!isPlausibleDomain(domain)) {
    return fail(400, "bad_domain", "That does not look like a website address. Try example.com.");
  }

  const db = supabaseAdmin();
  const ipHash = hashIp(ip);

  // 3. Caches and limits, cheapest first, failing fast.
  const settings = await getSettings();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  /**
   * The kill switch and the four ceilings, which used to be transcribed here.
   *
   * They moved to lib/scan/ceilings.ts unchanged - same order, same refusals,
   * same reasoning, which travelled with them - when the campaign benchmark
   * needed the same set. The alternative was a second copy on the second route,
   * and every one of those ceilings is here because the first copy had a hole
   * in it; keeping two would mean finding each hole twice.
   *
   * A request that fails before the insert below has no row to bill, and those
   * calls used to be invisible to the model-call ceiling - the gap that
   * mattered, because the failure that produces them repeats. They go to
   * model_call_debits now and anthropicCallsSince adds them, so it reads the
   * whole day rather than the part of it that completed.
   */
  const refusal = await checkCeilings({ settings, since, ipHash, subject: "scan" });
  if (refusal) return fail(refusal.http, refusal.code, refusal.message);

  /**
   * The market, picked rather than assumed - 25 September 2026.
   *
   * It defaulted to the UK. The product is sold into the US now, so a visitor's
   * own choice wins, a .co.uk or .us ending decides it, and anything else asks
   * where the domain ranks (`readRankingFootprint`, two Labs reads, never
   * fatal) and falls back to the US. Picked here, after the ceilings and
   * before the cache, because the cache is keyed on (domain, market).
   */
  // A partner hand-off sends "uk"/"us" (lib/scan/handoff.ts); anything else is no choice at all.
  const handed = handoffMarket(body.market);
  const chosen = isMarket(handed) ? handed : null;
  // Where the visitor was handed over from, so these leads can be routed (scans.ref, 20261018030000). Checked, never trusted.
  const ref = scanRef(body.ref);
  // Its campaign tags, only with a ref (scans.utm, 20261019000000): a hand-off's lead keeps its campaign.
  const utm = ref ? cleanUtm(body.utm) : null;
  const rankings = needsRankings(chosen, domain) ? await readRankingFootprint(domain) : null;
  if (rankings) console.log(`[scan] market read for ${domain} cost $${rankings.cost.toFixed(4)}`);
  const picked = pickMarket({ chosen, domain, rankings });
  const market = picked.market;

  // A complete scan for this domain inside the cache window is returned as is.
  // Repeat visits are instant and spend on a given domain is capped.
  //
  // Unlocked scans are excluded, and that single condition is load-bearing.
  // This cache is keyed on (domain, market) and nothing else - it does not know
  // or check who is asking - so without the filter the token handed back is
  // whichever scan ran most recently, including one somebody else opened with
  // their email. The full report gates on unlocked_at alone and treats the
  // public token as the credential, and the result screen fetches it
  // unconditionally on arrival. So the visitor would land on the unlocked
  // report having given no address: the placement list, every source and the
  // detailed question table, which is the one thing the funnel asks for an
  // email to see.
  //
  // Tracking runs are excluded for the same reason the daily cap above excludes
  // them: they are a paying client's scheduled re-read of their own domain, not
  // a free scan anyone may be handed. Without this a visitor who typed a
  // client's domain would be served that client's tracking run as their own
  // result.
  //
  // Campaign readings are excluded on the same principle and it is the newest
  // of the three, so it is worth being explicit about what it stops. A reading
  // is a scans row - complete, not a tracking run, never unlocked - so it
  // matched every condition this cache tests. A visitor typing a domain
  // somebody had benchmarked would have been handed that reading as their free
  // scan: the campaign's five fixed questions instead of the fourteen this
  // product generates, against the campaign's topic rather than theirs, and
  // titled with somebody else's brief. Nothing would have failed, and the cache
  // would have made it instant.
  //
  // The other direction is closed by construction rather than here: a benchmark
  // never reads this cache at all, because a dated reading that silently
  // returned an older one is not a reading.
  //
  // The filter costs one extra scan per unlocked domain, not one per visitor.
  // The fresh scan is itself locked, so it becomes the entry the next visitor
  // hits, and the caps above bound it either way.
  const cacheSince = new Date(Date.now() - settings.domain_cache_days * 86_400_000).toISOString();
  //
  // The error is bound and logged rather than discarded. It is the one read in
  // this route whose failure is not refused, and that is deliberate: a cache
  // miss runs a real scan, which is correct data at the cost of a scan we did
  // not need to pay for. Refusing instead would turn a blip on an optimisation
  // into a visitor turned away. But it is spend, on the free tool the two
  // ceilings above exist to bound, and unlogged it looked exactly like a domain
  // nobody had scanned before.
  //
  // A domain on app_settings.scan_cache_exempt_domains skips the cache
  // altogether (Danny, 15 Oct 2026): a prospect's domain re-run to show a
  // different category, prompts or market has to be a new reading, not the
  // last one handed back. Every ceiling above still applied to get here.
  const cacheExempt = settings.scan_cache_exempt_domains.includes(domain);
  if (cacheExempt) console.log(`[scan] ${domain} is cache-exempt, so this runs fresh`);
  const { data: cached, error: cacheErr } = cacheExempt
    ? { data: null, error: null }
    : await db
        .from("scans")
        .select("public_token, brand_name, topic, topic_variants, market, status, engines")
        .eq("domain", domain)
        .eq("market", market)
        .eq("status", "complete")
        .eq("is_tracking_run", false)
        .is("campaign_id", null)
        .is("unlocked_at", null)
        .gte("completed_at", cacheSince)
        .order("completed_at", { ascending: false })
        .limit(1)
        .maybeSingle();

  if (cacheErr) {
    console.warn(
      `[scan] could not read the domain cache for ${domain} (${market}), so this scan runs and is paid for ` +
        `whether or not a fresh one already existed: ${cacheErr.message}`,
    );
  }

  if (cached?.public_token) {
    // A hand-off onto a cached report still says where it came from, without overwriting a ref an earlier visit set.
    if (ref) {
      const { error: refErr } = await db
        .from("scans")
        .update({ ref, ...(utm ? { utm } : {}) })
        .eq("public_token", cached.public_token)
        .is("ref", null);
      if (refErr) console.warn(`[scan] could not note ref ${ref} on the cached scan for ${domain}: ${refErr.message}`);
    }
    return Response.json({
      token: cached.public_token,
      brand_name: cached.brand_name,
      suggested_topic: cached.topic,
      topic_variants: cached.topic_variants ?? [],
      market: cached.market,
      market_reason: picked.reason,
      // The stored scan's own engine set, not today's: the result on screen
      // must describe the run that produced it.
      engines: cached.engines ?? [],
      cached: true,
      status: "complete",
    });
  }

  // What the brand read actually billed, rather than a flat one. withRetry
  // makes up to three requests and Anthropic bills each; the rewrite ceiling
  // in /questions is counted off this column and so is the admin cost figure,
  // so a scan that retried here used to get two free rewrites it had paid for.
  //
  // A read that throws has no scan row to be billed onto, because the row does
  // not exist until below. It is not lost any more: both failing exits record
  // what was spent to model_call_debits, which the daily ceiling above sums.
  const billed = { calls: 0 };
  // 4 and 5. Read the site, then one language model call to name the brand.
  let read;
  try {
    const siteText = await readSite(domain);
    read = await readBrand(siteText, billed);
  } catch (err) {
    if (err instanceof UnreachableDomain) {
      // Logged with its reason. Every one of these used to print nothing at
      // all and return the same sentence, so a whole class of site failing on
      // step one - anything behind a WAF, anything slower than the budget -
      // was indistinguishable in the log from people mistyping a domain.
      console.warn(
        `[scan] site read failed for ${domain}: ${err.reason}${err.status ? ` ${err.status}` : ""}` +
          `${err.detail ? ` (${err.detail})` : ""}${err.url ? ` url=${err.url}` : ""}`,
      );
      const told = SITE_READ_FAILURE[err.reason](domain, err.status, err.detail);
      return fail(told.http, told.code, told.message);
    }
    // Logged rather than swallowed. These two failures look identical to a
    // visitor and are nothing alike: 422 is a site we could not fetch, and
    // this is a site we fetched and then could not read. One of those is ours.
    // nomadadigital.co.uk produced this on 19 Sep and it was the language
    // model returning 529, not the site - which is unreadable from the
    // response alone unless the reason is written down.
    console.warn(`[scan] read failed for ${domain}: ${describeAnthropicError(err)}`);
    // Paid for and unattributable. withRetry makes up to three requests before
    // it throws, and a 529 stretch is answered by visitors trying again - so
    // this is the exit where uncounted spend accumulates fastest.
    await recordModelCallDebit({
      calls: billed.calls,
      reason: "read_failed",
      domain,
      ipHash,
    });
    return fail(502, "read_failed", "We could not read that site just now. Please try again.");
  }

  /**
   * A low-confidence read stores no topic, but its guess is not thrown away:
   * it leads the variants, and the confirm screen offers that list as options
   * the visitor picks from or types over (Danny, 20 Oct 2026). glassray.ai
   * opened on an empty field with five good variants stored behind it. The
   * routes fold the picked option out of the variants, so choosing the guess
   * does not make it a cluster twice.
   */
  const confident = read.confidence === "high";
  const variants = normaliseTopicVariants(
    confident ? read.suggested_topic : null,
    confident ? (read.topic_variants ?? []) : [read.suggested_topic, ...(read.topic_variants ?? [])],
    { min: SCAN_LIMITS.topicVariant.min, max: SCAN_LIMITS.topicVariant.max, cap: TOPIC_VARIANT_COUNT },
  );
  // 6. Insert, awaiting the topic the visitor confirms. `ref` only when there is one, and the insert is tried again
  // without it if the column is not there yet: a deploy landing before 20261018030000 must not stop every scan.
  const row = {
      domain,
      brand_name: read.brand_name,
      positioning: read.positioning,
      // Services and industries read off the site, case studies included. The
      // question set narrows the category by these rather than by how the
      // company describes itself. Column added by 20260924000000.
      site_facts: {
        services: (read.services ?? []).map((s) => s.trim()).filter(Boolean).slice(0, 5),
        industries: (read.industries ?? []).map((s) => s.trim()).filter(Boolean).slice(0, 4),
      },
      topic: confident ? read.suggested_topic : null,
      /**
       * Cleaned on the way in, rather than stored raw and cleaned twice later.
       *
       * This stored the model's array verbatim, and that row is what
       * `ScanFlow` posts back to `/confirm` - so the list that reached the door
       * folding the least was the least folded list there is. The topic passed
       * is the one being stored, so a null topic folds nothing while the dedupe
       * still applies. See `topic-variants.test.mts`.
       */
      topic_variants: variants,
      market,
      status: "pending_topic",
      ip_hash: ipHash,
      // Both sets are frozen onto the row at start, so a settings change
      // mid-scan cannot leave a result claiming engines it never read.
      engines: settings.scan_engines_free,
      gated_engines: settings.scan_engines_gated,
      anthropic_calls: billed.calls,
    };
  const { data: firstScan, error: firstErr } = await db
    .from("scans")
    .insert({ ...row, ...(ref ? { ref } : {}), ...(utm ? { utm } : {}) })
    .select("public_token")
    .single();
  let scan = firstScan;
  let error = firstErr;
  if (error && ref && /\b(ref|utm)\b/.test(error.message) && /column|schema cache/i.test(error.message)) {
    console.warn(`[scan] scans.ref is not there yet, so ${domain} starts without its ref (${ref}): ${error.message}`);
    const { data: retryScan, error: retryErr } = await db.from("scans").insert(row).select("public_token").single();
    scan = retryScan;
    error = retryErr;
  }

  if (error || !scan) {
    // The read succeeded and was billed; the row that would have carried the
    // cost is the thing that failed. Same debit, different reason, so the log
    // can tell a bad hour at Anthropic from a bad hour at our database.
    await recordModelCallDebit({
      calls: billed.calls,
      reason: "store_failed",
      domain,
      ipHash,
    });
    return fail(500, "store_failed", "We could not start that scan. Please try again.");
  }

  /**
   * The reason goes on in its own write, not in the insert above. The column
   * is added by 20260925000000; if that migration has not reached this
   * database the insert would fail and the visitor would lose the scan, where
   * this only loses the sentence under the market toggle.
   */
  {
    const { error: reasonErr } = await db
      .from("scans")
      .update({ market_reason: picked.reason })
      .eq("public_token", scan.public_token);
    if (reasonErr) console.warn(`[scan] could not store the market reason for ${domain}: ${reasonErr.message}`);
  }

  after(() => {
    // Our cost basis stays server side: it is in the log and the admin page,
    // never in a response a visitor can read.
    // QUESTION_COUNT, not a typed 14. This is the figure the daily dollar cap
    // is reasoned about against, so a question-count change that left it at 14
    // would understate or overstate every scan in the log while the cap itself
    // moved - the one place a stale copy of this number is hard to notice,
    // because nothing on screen contradicts it.
    const free = estimateScanCost(settings.scan_engines_free, QUESTION_COUNT).toFixed(3);
    const gated = estimateScanCost(settings.scan_engines_gated, QUESTION_COUNT).toFixed(3);
    console.log(
      `[scan] started ${domain} (${market}) free=${settings.scan_engines_free.join(",")} ($${free}) ` +
        `gated=${settings.scan_engines_gated.join(",")} ($${gated} on unlock)`,
    );
  });

  return Response.json({
    token: scan.public_token,
    engines: settings.scan_engines_free,
    // Named so the gate can say what the email actually buys.
    gated_engines: settings.scan_engines_gated,
    brand_name: read.brand_name,
    // A low-confidence guess is not pre-filled: it leads topic_variants, which
    // the confirm screen offers as options instead.
    suggested_topic: confident ? read.suggested_topic : null,
    // Shown at step 2 so the agency can see how the site narrowed the category,
    // and correct it before fourteen questions are built on top of it.
    topic_variants: variants,
    positioning: read.positioning,
    confidence: read.confidence,
    market,
    market_reason: picked.reason,
    cached: false,
    status: "pending_topic",
  });
}
