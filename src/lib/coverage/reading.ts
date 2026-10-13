import "server-only";

import { type CitationCountRow, countCitedDomains } from "@/lib/coverage/citation-count";
import { MAX_COVERAGE_URLS } from "@/lib/coverage/csv";
import { type CoveragePiece, coveragePieces } from "@/lib/coverage/pieces";
import { readingFixture } from "@/lib/coverage/reading-fixture";
import {
  type ReadingAnswer,
  type ReadingQuestion,
  type ReadingSource,
  type ReadingSummary,
  buildCoverage,
  buildQuestions,
  buildSources,
  countNamed,
  summariseReading,
} from "@/lib/coverage/reading-figures";
import { type Engine, isEngine, knownEngines } from "@/lib/scan/engines";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { selectAll } from "@/lib/supabase/page";

/**
 * A campaign reading, assembled for the page that shows it.
 *
 * Every figure on this page is counted here from stored rows. None of them is
 * typed, and none of them is a model's opinion about what the reading means:
 * "named in 6 of 20 answers" is six rows with `brand_named` true out of twenty
 * rows, and "3 of your 14 placements were cited" is a set intersection. That is
 * the whole reason this product can be given away - it makes no claim it cannot
 * point at a row for.
 *
 * ## What is deliberately not here
 *
 * No share of voice, no rank against competitors, no verdict. The scan's
 * leaderboard is built on the same row and could be read from here in one more
 * select, and it is left out because a benchmark's five questions are not a
 * category sample - ranking somebody ninth off five questions would be a number
 * with a denominator too small to mean what a reader takes it to mean. The free
 * scan asks a full set and says so.
 *
 * No verbatim answer text either, and that one is load-bearing rather than
 * editorial. `response_text` is cleared by the retention purge on any scan that
 * was never unlocked, and a reading is never unlocked - it takes no email, so
 * nothing ever sets `unlocked_at`. Every reading's prose is therefore gone a
 * week after it was taken, while the columns this page reads - `answered`,
 * `brand_named`, and the citation rows - are kept for good. That is what lets a
 * benchmark promise a dated starting line worth coming back to. Anyone adding
 * the answers themselves to this page is adding something that will be blank on
 * every reading older than `response_retention_days`, with nothing on screen to
 * say why.
 */

/**
 * The row shapes moved to `reading-figures.ts` with the counting that produces
 * them, and are re-exported here because this is where the pages import them
 * from.
 */
export type { ReadingAnswer, ReadingQuestion, ReadingSource, ReadingSummary };

export type CampaignReading = {
  campaign: {
    brand: string;
    domain: string;
    topic: string;
    segment: string | null;
    market: string;
    createdAt: string;
  };
  /** The newest reading. Null only if the scan insert never landed. */
  reading: {
    id: string;
    /**
     * The reading's own scans token, which is what
     * `/api/scan/[token]/walkthrough` looks a row up by. Not the campaign's
     * public token - that is the credential in the page's URL and the
     * walkthrough route 404s on it.
     */
    scanToken: string | null;
    /**
     * The market the visitor chose for this reading, as the scan row stores
     * it, or null. Not `campaign.market`, which reads a missing value as "UK":
     * the walkthrough form preselects this, and a guess would let a required
     * field look answered when nobody answered it (13 Oct 2026).
     */
    market: string | null;
    status: string;
    step: string | null;
    error: string | null;
    createdAt: string;
    completedAt: string | null;
    engines: Engine[];
    enginesAnswered: Engine[];
  } | null;
  questions: ReadingQuestion[];
  /** Cited sources, most-cited first. */
  sources: ReadingSource[];
  coverage: {
    /**
     * Distinct placed *domains* dated on or before this reading - not the
     * placement count, which is larger whenever a campaign put two pieces on
     * one title. The page says "domain" out loud for that reason; the upload
     * route's `stored` is the row count and the two are different numbers on
     * purpose.
     */
    uploaded: number;
    /** Distinct placed domains at least one engine cited. */
    cited: number;
    /** Placed domains no engine cited. The other half of the same finding. */
    uncited: string[];
  };
  /**
   * One row per uploaded piece, in upload order, capped at what the page
   * reports on. Empty when the campaign uploaded nothing.
   */
  pieces: CoveragePiece[];
  /** Named in N of M answers, counted over the current reading. */
  named: { count: number; of: number };
  /** Every reading of this campaign, newest first. One today, more after a re-run. */
  history: ReadingSummary[];
};

/**
 * Read a campaign by its public token, or null when there is no such campaign.
 *
 * A read that fails throws rather than returning null, so the page can tell
 * "this link matches nothing" from "the database did not answer". The scan
 * result page carries the same distinction and the comment on it says why: a
 * 404 to somebody following a link to their own reading is a false statement
 * and a terminal one.
 */
export async function readCampaign(token: string): Promise<CampaignReading | null> {
  const fixture = readingFixture(token);
  if (fixture) return fixture;

  const db = supabaseAdmin();

  const { data: campaign, error: campaignErr } = await db
    .from("campaigns")
    .select("id, brand, domain, topic, segment, market, created_at")
    .eq("public_token", token)
    .maybeSingle();
  if (campaignErr) {
    throw new Error("could not read the campaign behind a benchmark link: " + campaignErr.message);
  }
  if (!campaign) return null;

  const campaignId = campaign.id as string;

  /**
   * Every reading of this campaign, newest first.
   *
   * All of them rather than the newest one, because the campaign id is the
   * stable thing and a re-run inserts a new row beside the old one. The
   * history below is the only place the product's actual promise - the same
   * five questions again, compared - is visible, and it costs one select.
   */
  const { data: scans, error: scansErr } = await db
    .from("scans")
    .select("id, public_token, status, step, error, created_at, completed_at, engines, engines_answered, market")
    .eq("campaign_id", campaignId)
    .order("created_at", { ascending: false });
  if (scansErr) throw new Error("could not read the readings for a campaign: " + scansErr.message);

  const rows = scans ?? [];
  const current = rows[0] ?? null;

  const base: CampaignReading = {
    campaign: {
      brand: campaign.brand as string,
      domain: campaign.domain as string,
      topic: campaign.topic as string,
      segment: (campaign.segment as string | null) ?? null,
      market: (campaign.market as string | null) ?? "UK",
      createdAt: campaign.created_at as string,
    },
    reading: null,
    questions: [],
    sources: [],
    coverage: { uploaded: 0, cited: 0, uncited: [] },
    pieces: [],
    named: { count: 0, of: 0 },
    history: [],
  };

  if (!current) return base;

  const readingId = current.id as string;
  /**
   * Through `knownEngines`, which dedupes as well as filtering.
   *
   * This was `.filter(isEngine)` alone, and `pipeline.ts` takes the same column
   * through `[...new Set(...)]` before it asks anything - explicitly "for rows
   * already written". So a row whose list repeats a name was read one way by
   * the pass and another way by the page: one answer stored, two columns
   * rendered, and the headline counting the same answer twice on both sides of
   * its fraction while the history strip counted it once.
   */
  const engines = knownEngines(current.engines as string[] | null);

  base.reading = {
    id: readingId,
    scanToken: (current.public_token as string | null) ?? null,
    market: (current.market as string | null) ?? null,
    status: current.status as string,
    step: (current.step as string | null) ?? null,
    error: (current.error as string | null) ?? null,
    createdAt: current.created_at as string,
    completedAt: (current.completed_at as string | null) ?? null,
    engines,
    enginesAnswered: ((current.engines_answered as string[] | null) ?? []).filter(isEngine),
  };

  /**
   * The coverage list as it stood when this reading was taken.
   *
   * Dated rather than "all rows for the campaign", which is the whole argument
   * for `campaign_coverage` being a table instead of a column. A list that grew
   * after a reading was taken would otherwise change what that reading was
   * judged against, months later and silently, and the comparison the next
   * reading makes would be against a moving line.
   */
  const [coverageRows, questionRows, answerRows, citationRows, historyAnswers, historyQuestions] =
    await Promise.all([
    selectAll<{ url: string; source_domain: string }>((from, to) =>
      db
        .from("campaign_coverage")
        .select("url, source_domain")
        .eq("campaign_id", campaignId)
        .lte("added_at", current.created_at as string)
        .order("id", { ascending: true })
        .range(from, to),
    ),
    selectAll<{ id: string; idx: number; kind: string; question: string }>((from, to) =>
      db
        .from("scan_questions")
        .select("id, idx, kind, question")
        .eq("scan_id", readingId)
        .order("id", { ascending: true })
        .range(from, to),
    ),
    selectAll<{ question_id: string; engine: string; answered: boolean; brand_named: boolean }>((from, to) =>
      db
        .from("scan_answers")
        .select("question_id, engine, answered, brand_named")
        .eq("scan_id", readingId)
        .order("id", { ascending: true })
        .range(from, to),
    ),
    selectAll<CitationCountRow & { url: string | null }>((from, to) =>
      db
        .from("scan_citations")
        .select("source_domain, url, question_id, engine")
        .eq("scan_id", readingId)
        .order("id", { ascending: true })
        .range(from, to),
    ),
    /**
     * `engine` as well as `brand_named`, because the history is counted under
     * the same rule as the headline now and that rule drops an engine value
     * the `Engine` union does not know.
     */
    selectAll<{ scan_id: string; engine: string; brand_named: boolean }>((from, to) =>
      db
        .from("scan_answers")
        .select("scan_id, engine, brand_named")
        .in(
          "scan_id",
          rows.map((r) => r.id as string),
        )
        .order("id", { ascending: true })
        .range(from, to),
    ),
    /**
     * How many questions each past reading asked.
     *
     * The history denominator is `questions x engines`, the same as the
     * headline's, and the engines are on the scan row already while the
     * question count is not. One more select rather than counting the answer
     * rows, because counting the rows is exactly the bug: an engine that
     * stored nothing would leave the denominator and make a failed reading
     * look like a better one.
     */
    selectAll<{ scan_id: string }>((from, to) =>
      db
        .from("scan_questions")
        .select("scan_id")
        .in(
          "scan_id",
          rows.map((r) => r.id as string),
        )
        .order("id", { ascending: true })
        .range(from, to),
    ),
  ]);

  const placed = new Set(coverageRows.map((r) => r.source_domain));

  base.questions = buildQuestions(questionRows, answerRows, engines);

  /**
   * Counted off `base.questions`, which is the grid the page itself renders,
   * and off nothing else. See `reading-figures.ts` for why both this and the
   * history strip below have to come out of one function: they are the same
   * reading counted twice on one page, and they used to disagree.
   */
  base.named = countNamed(base.questions);

  const counts = countCitedDomains(citationRows);
  base.sources = buildSources(counts, placed);
  base.coverage = buildCoverage(placed, counts);
  /**
   * The same rows again, read per piece rather than per domain.
   *
   * Capped at what the reading undertakes to report on rather than at what a
   * campaign may have uploaded: `MAX_COVERAGE_ROWS` is an insert ceiling and
   * this is a page. Taken in upload order off rows already ordered by id, so
   * the five a reader sees are the first five they gave us rather than an
   * arbitrary five.
   */
  base.pieces = coveragePieces(coverageRows.slice(0, MAX_COVERAGE_URLS), citationRows, engines);

  const answersByScan = new Map<string, { engine: string; brand_named: boolean }[]>();
  for (const a of historyAnswers) {
    const list = answersByScan.get(a.scan_id) ?? [];
    list.push({ engine: a.engine, brand_named: a.brand_named });
    answersByScan.set(a.scan_id, list);
  }
  const questionsByScan = new Map<string, number>();
  for (const q of historyQuestions) {
    questionsByScan.set(q.scan_id, (questionsByScan.get(q.scan_id) ?? 0) + 1);
  }

  base.history = rows.map((r) => {
    const id = r.id as string;
    return summariseReading({
      id,
      status: r.status as string,
      takenAt: (r.completed_at as string | null) ?? null,
      engines: (r.engines as string[] | null) ?? [],
      questionCount: questionsByScan.get(id) ?? 0,
      answers: answersByScan.get(id) ?? [],
    });
  });

  return base;
}
