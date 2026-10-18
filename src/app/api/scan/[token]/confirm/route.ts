import { after } from "next/server";

import { SCAN_LIMITS } from "@/config/contact";
import { QUESTION_COUNT, QUESTION_KINDS, TOPIC_VARIANT_COUNT } from "@/lib/scan/anthropic";
import { isMarket } from "@/lib/scan/domain";
import { clusterKeywordFits } from "@/lib/scan/target-keyword";
import { runScan } from "@/lib/scan/pipeline";
import { normaliseTopicVariants } from "@/lib/scan/topic-variants";
import { isFreePassDead, reapStalledFreePass } from "@/lib/scan/stall";
import { supabaseAdmin } from "@/lib/supabase/admin";

/** What the confirm screen sends back: the set, minus whatever was dropped. */
type ConfirmedQuestion = { question?: unknown; kind?: unknown };

/**
 * The questions the visitor actually approved, cleaned.
 *
 * Every one of these becomes a paid read against every engine, so the cap and
 * the length limits are enforced here rather than trusted from the screen. A
 * kind we did not write is kept as "custom": the column is free text, and
 * labelling somebody own question as one of ours would file it under a
 * heading it does not belong to.
 */
function cleanQuestions(input: unknown): { question: string; kind: string }[] | null {
  if (!Array.isArray(input)) return null;
  const seen = new Set<string>();
  const out: { question: string; kind: string }[] = [];

  for (const row of input as ConfirmedQuestion[]) {
    const question = typeof row?.question === "string" ? row.question.trim() : "";
    if (question.length < 4 || question.length > SCAN_LIMITS.question) continue;
    const key = question.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const kind = typeof row?.kind === "string" && QUESTION_KINDS.includes(row.kind) ? row.kind : "custom";
    out.push({ question, kind });
    if (out.length >= QUESTION_COUNT) break;
  }

  return out.length ? out : null;
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/**
 * The response is sent as soon as the scan is queued; the run itself continues
 * in after(), so this ceiling covers the whole pipeline, not the round trip.
 * Requires a Vercel plan whose function limit is at least this high.
 */
export const maxDuration = 300;

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;

  let body: { topic?: string; market?: string; topic_variants?: string[]; questions?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "bad_request" }, { status: 400 });
  }

  const topic = (body.topic ?? "").trim();
  if (topic.length < 2 || topic.length > SCAN_LIMITS.topic) {
    return Response.json(
      { error: "bad_topic", message: "Tell us the category in a few words." },
      { status: 400 },
    );
  }

  const db = supabaseAdmin();
  // A read that failed is not a token that does not exist - the same rule the
  // preview route keeps one screen earlier. 404 tells a visitor their scan link
  // is wrong, which is the one message that makes somebody close the tab, and
  // it is the wrong one when the database simply did not answer.
  const { data: scan, error: readErr } = await db
    .from("scans")
    .select("id, status, market, started_at, queued_at, cluster_keyword_status, cluster_keyword_market, cluster_keyword_topic")
    .eq("public_token", token)
    .maybeSingle();

  if (readErr) {
    console.warn("[scan] could not read the scan to confirm it: " + readErr.message);
    return Response.json(
      { error: "read_failed", message: "We could not reach the checker. Try again." },
      { status: 502 },
    );
  }
  if (!scan) return Response.json({ error: "not_found" }, { status: 404 });
  if (scan.status === "complete") {
    return Response.json({ status: "complete" });
  }

  /**
   * A pass the platform killed has to be closed before this one can start.
   *
   * The guard below rejects `queued` and `running`, and the compare-and-swap
   * further down excludes them too - both correctly, because a live pass must
   * not be duplicated. But a pass that was killed mid-flight leaves the row at
   * one of those two states with nothing server-side able to move it, and then
   * this route answers `{ status: "running" }` with a 200. ScanFlow reads
   * `res.ok`, goes back to the progress screen and waits its six minutes again.
   *
   * So the honest end the progress screen offers - "That check stopped before
   * it finished. You can run it again" - was a loop for the exact state it
   * exists to handle. Every reload of /scan/[token] restarted the same six
   * minutes as well, because the page renders the column verbatim.
   *
   * `isFreePassDead` is only true past the platform's own 300s ceiling, so
   * there is no live pass to race: nothing can move that row any more. The reap
   * is a compare-and-swap of its own and scoped to this scan, and once it lands
   * the status is `failed`, which the guard and the swap below both already
   * accept. Nothing else in this route changes.
   *
   * Not fatal. A reap that cannot write leaves the row where it was, which is
   * where it already was - so the visitor gets the status answer they got
   * before rather than an error on top of it.
   */
  let status = scan.status as string;
  if (isFreePassDead(scan)) {
    try {
      const { ids } = await reapStalledFreePass(db, { scanId: scan.id as string });
      if (ids.length) {
        status = "failed";
        console.warn(
          "[scan] " + scan.id + " was left at " + scan.status + " by a killed pass, so it was closed to be re-run",
        );
      }
    } catch (err) {
      console.error("[scan] could not close the stalled pass on " + scan.id + ":", err);
    }
  }

  if (status === "running" || status === "queued") {
    return Response.json({ status });
  }

  const market = isMarket(body.market) ? body.market : scan.market;

  /**
   * The variants the agency confirmed are the trusted set from here, capped so
   * an edited payload cannot widen the question spread without limit.
   *
   * Both figures are read rather than typed, and both were typed here while the
   * questions route two screens earlier read them. That route caps at
   * `TOPIC_VARIANT_COUNT`, which is also what the model is *asked* for - the
   * prompt says "up to 5 ways buyers phrase this category" out of the same
   * constant. So raising it to widen the spread would have widened the ask, the
   * screen and the questions route, and this line would have gone on silently
   * dropping everything past the fifth: the visitor confirms seven chips and
   * the scan runs five. A coincidence waiting to stop being one, which is what
   * `ConfirmScreen`'s `maxLength={200}` was.
   *
   * The cleaning itself moved to `normaliseTopicVariants` on 20 Sep 2026, and
   * moving it is what showed this door was doing less than the one two screens
   * earlier: `/questions` drops a variant identical to the topic and this did
   * not, while *this* is the route that writes the set the rest of the scan
   * trusts. Neither deduped. Both are that function's job now, and
   * `topic-variants.test.mts` walks every door onto the column so a third
   * cannot go on sanitising it its own way.
   */
  const variants = Array.isArray(body.topic_variants)
    ? normaliseTopicVariants(topic, body.topic_variants, {
        min: SCAN_LIMITS.topicVariant.min,
        max: SCAN_LIMITS.topicVariant.max,
        cap: TOPIC_VARIANT_COUNT,
      })
    : undefined;

  /**
   * The confirmed topic is the trusted value from here on.
   *
   * The status checks above are a read, and this is the write - so two confirms
   * arriving together both saw a scan that was not yet queued, and both started
   * a run. A double-submitted form was enough. That is a whole second scan
   * billed, and two pipelines writing answers and citations against one scan
   * id, which inflates every count derived from them.
   *
   * So the status test moves into the update itself: the same three statuses
   * the guard above rejects, as a filter, which makes the database the arbiter
   * of who queues the scan. .select() is what makes the outcome readable - no
   * rows back means another request queued it between our read and our write,
   * and the honest answer is the status it already has rather than a second
   * run. Without .select() a zero-row update looks identical to a successful
   * one, because PostgREST answers both with a 2xx.
   */
  const { data: queued, error } = await db
    .from("scans")
    .update({
      topic,
      market,
      status: "queued",
      step: null,
      error: null,
      /**
       * Dates the queued state so a pass killed before it could claim the row
       * can be told from one that is about to. Without it 'queued' was the one
       * unfinished state with no stamp, and an undatable row cannot be closed
       * safely - see the migration, which explains why created_at will not do.
       */
      queued_at: new Date().toISOString(),
      ...(variants ? { topic_variants: variants } : {}),
      // A cluster keyword read for another market or topic than the one confirmed is dropped (18 Oct 2026): the scan would
      // check its rank in this market, and signup would copy it and its volume onto a client tracked here.
      ...(scan.cluster_keyword_status && !clusterKeywordFits({ status: scan.cluster_keyword_status, topic: scan.cluster_keyword_topic, market: scan.cluster_keyword_market }, topic, market)
        ? { cluster_keyword: null, cluster_keyword_volume: null, cluster_keyword_intent: null, cluster_keyword_status: null, cluster_keyword_market: null, cluster_keyword_topic: null }
        : {}),
    })
    .eq("id", scan.id)
    .not("status", "in", "(queued,running,complete)")
    .select("id");

  if (error) {
    return Response.json({ error: "store_failed" }, { status: 500 });
  }

  if (!queued?.length) {
    return Response.json({ status: "queued", questions: 0 });
  }

  /**
   * The approved set, stored before the run starts.
   *
   * The confirm screen previews the questions and lets clusters, and single
   * questions, be dropped. Storing them here is what makes that mean
   * something: runScan asks the scan what it already has and writes a set only
   * when it finds none, so the screen is not a decoration over a list that is
   * regenerated a second later.
   *
   * Only ever inserted into an empty set. A second confirm on the same scan
   * leaves the first set alone rather than deleting rows that answers already
   * point at.
   */
  let stored = 0;
  const confirmed = cleanQuestions(body.questions);
  if (confirmed) {
    /**
     * Destructured and checked, where it used to be `const existing = await`
     * with only `existing.count` read afterwards.
     *
     * A failed count comes back null, which is the same value as "no rows", and
     * null is the signal to insert - so a read that did not answer meant this
     * wrote a second question set over a scan that already had one. Said
     * honestly: that was never reachable as damage, because `unique (scan_id,
     * idx)` refuses the whole batch atomically and the warn below is what
     * happened instead. The constraint was doing the work this comment claimed
     * the count was doing, and the two should not disagree.
     *
     * Skipped rather than made fatal. A count we cannot read costs the visitor
     * the edits they made on the confirm screen, which is exactly what the
     * failed insert already cost them - and runScan writes its own set when it
     * finds none, so it never costs them the scan.
     */
    const { count: existingCount, error: existingErr } = await db
      .from("scan_questions")
      .select("id", { count: "exact", head: true })
      .eq("scan_id", scan.id);
    if (existingErr) {
      console.warn(
        "[scan] could not count the stored questions for " + scan.id + ", so the confirmed set was not written: " +
          existingErr.message,
      );
    } else if (!existingCount) {
      const rows = confirmed.map(function (q, i) {
        return { scan_id: scan.id, idx: i, question: q.question, kind: q.kind };
      });
      const { error: qErr } = await db.from("scan_questions").insert(rows);
      // Not fatal: runScan writes its own set when it finds none, so a failure
      // here costs the visitor their edits, not their scan.
      if (qErr) console.warn("[scan] could not store the confirmed questions for " + scan.id + ": " + qErr.message);
      else stored = confirmed.length;
    }
  }

  // Return now; the run continues after the response is flushed.
  after(async () => {
    await runScan(scan.id);
  });

  return Response.json({ status: "queued", questions: stored });
}
