import "server-only";

import { after } from "next/server";

import {
  deriveOpportunities,
  publicNote,
  type AnswerRow,
  type CitationRow,
  type KindRow,
  type QuestionRow,
} from "@/lib/scan/opportunities";
import { readDifficulty } from "@/lib/scan/difficulty-read";
import { runGatedScan } from "@/lib/scan/pipeline";
import { type CountableAnswer, reportCounts } from "@/lib/scan/report-counts";
import { getSettings } from "@/lib/scan/settings";
import { spentSince } from "@/lib/scan/spend";
import { sendReportReadyEmail } from "@/lib/scan/verify-email";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { selectAll } from "@/lib/supabase/page";
import { missingColumn } from "@/lib/tracking/limits";
import { clusterGoogleTrio, type StoredClusterKeyword } from "@/lib/scan/target-keyword";
import type { ClusterKeywordView } from "@/lib/scan/contract";
import type { Market } from "@/lib/scan/domain";

/**
 * What unlocking a scan actually does, in one place.
 *
 * It lives here rather than in the unlock route because two different requests
 * now perform it: the unlock itself when verification is off, and the verify
 * link when it is on. Having one copy is what stops the two paths drifting into
 * subtly different unlocks.
 */

export type UnlockableScan = {
  id: string;
  public_token: string;
  domain: string;
  brand_name: string | null;
  topic: string | null;
  market: string | null;
  unlocked_at: string | null;
  gated_engines: string[] | null;
  gated_status: string | null;
};

export const SCAN_UNLOCK_COLUMNS =
  "id, public_token, domain, brand_name, topic, market, status, account_id, unlocked_at, gated_engines, gated_status";

/**
 * The unlock did not take, so nothing downstream of it may behave as though it
 * did. Thrown rather than returned because every caller has to stop: an unlock
 * that half-happens is the failure this file is written around.
 */
export class UnlockNotStamped extends Error {
  constructor(scanId: string, detail: string) {
    super("unlock not stamped on " + scanId + ": " + detail);
    this.name = "UnlockNotStamped";
  }
}

export type UnlockPayload = {
  brands: Array<{ brand: string; mentions: number; is_subject: boolean; engines: string[] }>;
  brands_by_engine: Array<{ engine: string; brand: string; mentions: number; is_subject: boolean }>;
  sources: Array<{
    source: string;
    mentions: number;
    engines: string[];
    urls: string[];
    /** own | competitor | review | placement | other. Null until classified. */
    kind: string | null;
    note: string | null;
  }>;
  questions: Array<{
    idx: number;
    question: string;
    kind: string;
    /** The subject's Google organic position for this question. Null: not in the top twenty. */
    google_rank: number | null;
    /** The derived Google head keyword, its monthly searches and the rank for it (R39-R41). Null before 27 Sep 2026. */
    target_keyword: string | null;
    search_volume: number | null;
    keyword_rank: number | null;
    engines: Array<{
      engine: string;
      answered: boolean;
      brand_named: boolean;
      response_text: string | null;
      /** What this engine cited for this question, in the order it cited them, deduped by URL. */
      citations: Array<{ domain: string; url: string | null; title: string | null }>;
    }>;
  }>;
  /**
   * True when the questions' Google trio above is the scan's one cluster
   * keyword (BRIEF-3 C1), so it wins over any per-row keyword the teaser
   * carries. False on scans from before C1.
   */
  cluster_keyword: boolean;
  /** The cluster keyword itself, for the result's cluster section (S1). Null before C1. */
  cluster: ClusterKeywordView | null;
  /**
   * Pages that fed answers the brand was absent from and that a client could
   * realistically be placed into, most valuable first. This is the gated
   * finding - the reason an email address is worth giving up.
   *
   * absent_answers counts question x engine pairs, each one recorded, so the
   * figure reads back to rows rather than being an estimate. There is no
   * "which competitors are on this page" field because the schema cannot
   * support one honestly.
   */
  opportunities: Array<{
    domain: string;
    kind: string;
    note: string | null;
    absent_answers: number;
    absent_questions: number;
    questions: string[];
    /** Distinct engines that cited the page anywhere in the scan. */
    cited_by: number;
    /** 0-100, from placement-difficulty.ts. Absent when not scored. */
    difficulty?: number | null;
  }>;
};

/**
 * The derivation itself is in `./opportunities`, which carries no
 * `server-only` import and so can be loaded by `node --test`. Re-exported here
 * because this is where every caller already reaches for it, and because the
 * gate and the unlocked table must never derive the count from two places.
 */
export type {
  AnswerRow,
  CitationRow,
  KindRow,
  Opportunity,
  QuestionRow,
} from "@/lib/scan/opportunities";
export { deriveOpportunities } from "@/lib/scan/opportunities";

/**
 * Marks a scan as claimed without the gate. Since 24 September 2026 nothing
 * is gated, so the only thing `unlocked_at` still decides is retention: the
 * nightly purge clears transcripts from scans where it is null. A walkthrough
 * request stamps it, because Danny will record against those transcripts.
 * Only ever sets it once - an earlier stamp is left alone. Never throws.
 */
export async function markClaimed(scanId: string): Promise<boolean> {
  const { error } = await supabaseAdmin()
    .from("scans")
    .update({ unlocked_at: new Date().toISOString() })
    .eq("id", scanId)
    .is("unlocked_at", null);
  if (error) console.warn("[scan] could not mark " + scanId + " claimed: " + error.message);
  return !error;
}

/**
 * What the locked gate is allowed to know: how many opportunities there are
 * and roughly what they look like, never which pages they are. The domains
 * are the thing being traded for an email address, so they are not fetched
 * into a payload that a locked screen receives.
 */
export async function opportunityShape(
  scanId: string,
): Promise<{ count: number; answers: number; kinds: Record<string, number> }> {
  const db = supabaseAdmin();
  // Citations and source kinds are paged: both scale with what the engines
  // cited rather than with what we asked, and an unpaged read silently stops
  // at the 1000th row. The count on the locked screen is the number being
  // traded for an email address, so it has to be the whole count.
  const [citations, { data: answers, error: answersErr }, { data: questions, error: questionsErr }, kinds] =
    await Promise.all([
      selectAll<CitationRow>((from, to) =>
        db
          .from("scan_citations")
          .select("source_domain, question_id, engine")
          .eq("scan_id", scanId)
          .order("id", { ascending: true })
          .range(from, to),
      ),
      db.from("scan_answers").select("question_id, engine, brand_named").eq("scan_id", scanId),
      db.from("scan_questions").select("id, question").eq("scan_id", scanId),
      selectAll<KindRow>((from, to) =>
        db
          .from("scan_sources")
          .select("domain, kind, note, on_topic")
          .eq("scan_id", scanId)
          .order("id", { ascending: true })
          .range(from, to),
      ),
    ]);

  /**
   * A read that failed is not a gate with nothing behind it.
   *
   * Both errors were discarded, and the answers read is the one that decides the
   * whole number: `deriveOpportunities` only counts a citation whose answer is
   * recorded as `brand_named === false`, so an empty answer set skips every
   * citation and this returns a flat `count: 0`. Every caller was written
   * against the opposite. `/api/scan/<token>/opportunities` says in a comment
   * that "a failed read reports as a failure rather than as a count of zero,
   * which on this screen would read as 'there is nothing behind the gate'" - and
   * then answered 200 with `ready: true, count: 0`, which is precisely that
   * sentence. `/scan/<token>` calls it inside a try that logs and falls back to
   * the copy with no number in it, and never reached the catch.
   *
   * So a database blip told a visitor standing at the gate that there were no
   * pages to be placed into. That is a measured finding on this product - a real
   * zero is as much an answer as a fourteen - which is exactly why it must never
   * be the thing a failure degrades to. Thrown, and every caller has the
   * branch for it.
   *
   * That last clause was "all three callers" and this function has two - the
   * count belonged to `buildUnlockPayload` and had drifted onto the wrong
   * function. **A census belongs in a test, not a comment**: a number in prose
   * cannot notice a fourth caller, and the obligation this throw creates lands
   * on callers that do not exist yet. `gate-read-callers.test.mts` walks for
   * them, and holds the other end too - if either of these reads goes back to
   * swallowing its error, every caller's branch becomes dead code and the gate
   * reports a fault as a finding of zero again.
   */
  if (answersErr) {
    throw new Error("could not read the answers behind the gate: " + answersErr.message);
  }
  if (questionsErr) {
    throw new Error("could not read the questions behind the gate: " + questionsErr.message);
  }

  const opportunities = deriveOpportunities({
    citations,
    answers: (answers ?? []) as AnswerRow[],
    questions: (questions ?? []) as QuestionRow[],
    kinds,
  });

  const byKind: Record<string, number> = {};
  for (const o of opportunities) byKind[o.kind] = (byKind[o.kind] ?? 0) + 1;
  return {
    count: opportunities.length,
    answers: opportunities.reduce((n, o) => n + o.absent_answers, 0),
    kinds: byKind,
  };
}

/** Everything the gate was holding back, assembled once. */
const CLUSTER_COLUMNS = "cluster_keyword, cluster_keyword_volume, cluster_keyword_intent, cluster_keyword_rank, cluster_keyword_status, cluster_keyword_market";

/**
 * The scan's cluster keyword row. `cluster_keyword_rank_unchecked` (3 Nov 2026,
 * migration 20261103000000) is asked for and, on a database the migration has
 * not reached, asked again without: a missing column must not turn every
 * report into "could not read the cluster keyword".
 */
async function readClusterRow(db: ReturnType<typeof supabaseAdmin>, scanId: string) {
  const { data, error } = await db.from("scans").select(`${CLUSTER_COLUMNS}, cluster_keyword_rank_unchecked`).eq("id", scanId).maybeSingle();
  if (!error || !missingColumn(error)) return { data: data as Record<string, unknown> | null, error };
  const { data: before, error: beforeErr } = await db.from("scans").select(CLUSTER_COLUMNS).eq("id", scanId).maybeSingle();
  return { data: before as Record<string, unknown> | null, error: beforeErr };
}

export async function buildUnlockPayload(scanId: string): Promise<UnlockPayload> {
  const db = supabaseAdmin();

  type CitationWithVolume = CitationRow & {
    url: string | null;
    title: string | null;
    scan_questions?: unknown;
  };
  type EngineBrandRow = { engine: string; brand: string; mentions: number; is_subject: boolean };

  /**
   * The three that scale with what the engines gave back are paged. This is
   * the paid report: an unpaged citation read stops at the 1000th row, and a
   * source that falls off the end is missing from the source list, from share
   * of voice and from the placement list at once - with nothing on the page
   * to say the list is partial.
   */
  const [
    brands,
    sources,
    { data: questions, error: questionsErr },
    { data: answers, error: answersErr },
    kinds,
    { data: clusterRow, error: clusterErr },
  ] = await Promise.all([
    selectAll<EngineBrandRow>((from, to) =>
      db
        .from("scan_brands")
        .select("engine, brand, mentions, is_subject")
        .eq("scan_id", scanId)
        .order("id", { ascending: true })
        .range(from, to),
    ),
    selectAll<CitationWithVolume>((from, to) =>
      db
        .from("scan_citations")
        // The embedded `scan_questions(search_volume)` join came off this
        // select on 20 September 2026 with the search volume step. It existed
        // to sum a per-question volume onto each source row, and that sum was
        // used as a sort tiebreak and displayed nowhere.
        .select("source_domain, url, title, question_id, engine")
        .eq("scan_id", scanId)
        .order("id", { ascending: true })
        .range(from, to),
    ),
    db
      .from("scan_questions")
      .select("id, idx, question, kind, google_rank, target_keyword, search_volume, keyword_rank")
      .eq("scan_id", scanId)
      .order("idx", { ascending: true }),
    db
      .from("scan_answers")
      .select("question_id, engine, answered, brand_named, response_text")
      .eq("scan_id", scanId),
    selectAll<KindRow>((from, to) =>
      db
        .from("scan_sources")
        .select("domain, kind, note, on_topic")
        .eq("scan_id", scanId)
        .order("id", { ascending: true })
        .range(from, to),
    ),
    readClusterRow(db, scanId),
  ]);

  /**
   * The property `/api/scan/<token>/full` already claims, finally true.
   *
   * That route's comment reads "the per-scan reads used to swallow their own
   * error and hand back no rows... They throw now" - and the three paged ones
   * did, through `selectAll`. These two never have. So a fault on either one
   * assembled a report with no questions, no transcripts and - because
   * `deriveOpportunities` needs the answers to know the brand was absent - no
   * placements, and handed it back as a 200 to the person who had just given
   * their address for it. The failure and the finding were the same screen, on
   * the one payload this product sells.
   *
   * Thrown so the callers' existing branches fire: /full answers 502
   * report_failed, /scan/<token> logs and lets the client fetch retry, and the
   * unlock route says the report could not be assembled rather than serving an
   * empty one.
   */
  if (questionsErr) {
    throw new Error("could not read the questions for the report: " + questionsErr.message);
  }
  if (answersErr) {
    throw new Error("could not read the answers for the report: " + answersErr.message);
  }
  // Thrown for the reason above: a scan with a cluster keyword read as one
  // without would put the old per-prompt keyword back on its Google line.
  if (clusterErr) {
    throw new Error("could not read the cluster keyword for the report: " + clusterErr.message);
  }
  /**
   * BRIEF-3 C1 step 8: a scan with a cluster keyword status reads its Google
   * line off the one cluster keyword; `target_keyword` on the rows stays for
   * scans from before C1. Null here is the old meaning.
   */
  const clusterTrio = clusterGoogleTrio(
    clusterRow
      ? {
          status: (clusterRow.cluster_keyword_status ?? null) as StoredClusterKeyword["status"],
          keyword: (clusterRow.cluster_keyword ?? null) as string | null,
          volume: (clusterRow.cluster_keyword_volume ?? null) as number | null,
          rank: (clusterRow.cluster_keyword_rank ?? null) as number | null,
        }
      : null,
  );

  const brandRows = brands;
  const overall = new Map<string, { brand: string; mentions: number; is_subject: boolean; engines: string[] }>();
  for (const b of brandRows) {
    const row = overall.get(b.brand) ?? { brand: b.brand, mentions: 0, is_subject: b.is_subject, engines: [] };
    row.mentions += b.mentions;
    row.is_subject = row.is_subject || b.is_subject;
    if (!row.engines.includes(b.engine)) row.engines.push(b.engine);
    overall.set(b.brand, row);
  }
  const leaderboard = [...overall.values()].sort((a, b) => b.mentions - a.mentions);

  type SourceRow = {
    source: string;
    mentions: number;
    engines: string[];
    urls: string[];
    kind: string | null;
    note: string | null;
  };
  const kindOf = new Map(kinds.map((k) => [k.domain, k]));
  const bySource = new Map<string, SourceRow>();
  const counted = new Set<string>();
  for (const c of sources) {
    const row: SourceRow = bySource.get(c.source_domain) ?? {
      source: c.source_domain,
      mentions: 0,
      engines: [],
      urls: [],
      kind: kindOf.get(c.source_domain)?.kind ?? null,
      note: publicNote(kindOf.get(c.source_domain)?.note),
    };
    const key = `${c.source_domain}|${c.question_id}|${c.engine}`;
    if (!counted.has(key)) {
      counted.add(key);
      row.mentions += 1;
    }
    if (!row.engines.includes(c.engine)) row.engines.push(c.engine);
    if (c.url && !row.urls.includes(c.url)) row.urls.push(c.url);
    bySource.set(c.source_domain, row);
  }
  /**
   * Mentions alone, since 20 September 2026.
   *
   * The second key was `ai_search_volume` descending, and it came off with the
   * search volume step. It was already inert for any scan run after that date -
   * nothing populates the column - so this changes the order only for sources
   * tied on mentions in scans that ran before it, where the tiebreak is now
   * insertion order rather than a volume sum. Said plainly rather than left to
   * be discovered: this is a sort, not a count, and no figure moves.
   */
  const fullSources = [...bySource.values()].sort((a, b) => b.mentions - a.mentions);

  const answerRows = (answers ?? []) as Array<{
    question_id: string;
    engine: string;
    answered: boolean;
    brand_named: boolean;
    response_text: string | null;
  }>;
  /**
   * Per answer, what the engine cited. The rows are already in hand for the
   * source list, so this is a grouping rather than another read. Read order is
   * insertion order, which is the order the parser recorded the citations.
   */
  const citedBy = new Map<string, Array<{ domain: string; url: string | null; title: string | null }>>();
  for (const c of sources as Array<CitationWithVolume & { question_id?: string; engine?: string }>) {
    if (!c.question_id || !c.engine) continue;
    const key = c.question_id + "|" + c.engine;
    const list = citedBy.get(key) ?? [];
    if (c.url && list.some((x) => x.url === c.url)) continue;
    if (list.length < 12) list.push({ domain: c.source_domain, url: c.url ?? null, title: c.title ?? null });
    citedBy.set(key, list);
  }
  const citedFor = (questionId: string, engine: string) => citedBy.get(questionId + "|" + engine) ?? [];

  const questionDetail = (questions ?? []).map((q) => ({
    idx: q.idx as number,
    question: q.question as string,
    kind: q.kind as string,
    google_rank: (q.google_rank ?? null) as number | null,
    target_keyword: (q.target_keyword ?? null) as string | null,
    search_volume: (q.search_volume ?? null) as number | null,
    keyword_rank: (q.keyword_rank ?? null) as number | null,
    ...clusterTrio,
    engines: answerRows
      .filter((a) => a.question_id === q.id)
      .map((a) => ({
        engine: a.engine,
        answered: a.answered,
        brand_named: a.brand_named,
        // Null for scans that ran before the prose was stored, and for any the
        // purge has already reclaimed. The screen says so rather than showing a
        // blank and letting it read as "the engine said nothing".
        response_text: (a.response_text ?? null) as string | null,
        citations: citedFor(q.id as string, a.engine),
      })),
  }));

  const difficulty = await readDifficulty(scanId);
  const opportunities = deriveOpportunities({
    citations: sources,
    answers: answerRows,
    questions: (questions ?? []) as QuestionRow[],
    kinds,
  }).map((o) => {
    const d = difficulty.get(o.domain);
    // difficulty_basis stays stored on the row and never leaves the server
    // (Danny, 25 Sep 2026, QF1): nothing on the result may name or imply a
    // marketplace or a price, and the basis is where that could come from.
    return { ...o, difficulty: d?.difficulty ?? null };
  });

  return {
    brands: leaderboard,
    brands_by_engine: brandRows,
    sources: fullSources,
    questions: questionDetail,
    cluster_keyword: clusterTrio !== null,
    cluster:
      clusterRow?.cluster_keyword_status
        ? {
            status: clusterRow.cluster_keyword_status as ClusterKeywordView["status"],
            keyword: (clusterRow.cluster_keyword ?? null) as string | null,
            volume: (clusterRow.cluster_keyword_volume ?? null) as number | null,
            intent: (clusterRow.cluster_keyword_intent ?? null) as string | null,
            rank: (clusterRow.cluster_keyword_rank ?? null) as number | null,
            ...(clusterRow.cluster_keyword_rank_unchecked === true ? { unchecked: true } : {}),
            ...(typeof clusterRow.cluster_keyword_market === "string" ? { market: clusterRow.cluster_keyword_market as Market } : {}),
          }
        : null,
    opportunities,
  };
}
