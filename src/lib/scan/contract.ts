/**
 * The scan API contract, section 3 of the checker brief.
 *
 * Numeric brand fields are nullable. The three DataForSEO endpoints that
 * produce the fixtures return no brand leaderboard for this topic and no
 * per-question "named in N of M" count, and the house rule is that a figure
 * we did not measure is blank rather than estimated. Matt's spec wins if it
 * disagrees - flagged for him.
 */

/** JM only on a partner's scans (29 Oct 2026, domain.ts MARKETS). */
export type Market = "UK" | "US" | "JM";

/**
 * `ai_search_volume` was a field on the three types below and came out on
 * 20 September 2026 with the search volume step. See `dataforseo.ts` for why
 * the step went; what matters here is that it was rendered by nothing - it was
 * carried from the RPC, through the payload, into `ScanFlow`'s props and no
 * further - and the site's own copy says twice that this product does not use
 * search volume.
 *
 * `scan_questions.search_volume` is still a column, because dropping one is
 * destructive and is on AGENTS.md's absolute list. Rows written before that
 * date hold real measurements. A payload field that is permanently null is a
 * different thing from a column that stopped being written: the column is
 * readable history, the field would just be a number nobody can interpret.
 */
export type LeaderboardEntry = {
  brand: string;
  mentions: number;
  /**
   * Whether this row is the brand the scan is about.
   *
   * The server already knows - `scan_brands.is_subject` is set when the row is
   * written, and both the teaser RPC and buildUnlockPayload carry it through -
   * and the views were throwing it away and re-deciding by comparing the row's
   * spelling against `brand.name`. Two pieces of code judging the same fact,
   * which is the failure AGENTS.md names: the extractor's spelling of the
   * subject and the leaderboard's need not match, and when they do not the
   * report highlights nobody and calls the runner-up the leader.
   *
   * Optional because the fixture path has no such flag. Absent means "ask the
   * name", which is what every reader did before this existed.
   */
  is_subject?: boolean;
};

export type SourceEntry = {
  domain: string;
  mentions: number;
  /**
   * own | competitor | review | placement | other, or null where the
   * classifier did not reach this domain. Null is "unclassified", never
   * "other" - a domain we failed to read is a different finding from one we
   * read and could not place.
   */
  kind: string | null;
  /** One line on why it was classified that way. Null where unclassified. */
  note: string | null;
};

/**
 * One page a client could realistically be placed into: it fed answers the
 * brand was absent from, and it is somewhere an article can run.
 *
 * There is no "which competitors are on this page" field. scan_brands is
 * aggregated per scan and per engine, never per question, so that claim is
 * not derivable from what the scan records. The design asks for the column;
 * it is left out rather than guessed, because a named competitor on a named
 * page is exactly the kind of claim that has to be stood behind.
 */
export type ScanOpportunity = {
  domain: string;
  /** placement | review. Nothing else reaches this list. */
  kind: string;
  note: string | null;
  /** Answers (question x engine) this page fed where the brand was absent. */
  absent_answers: number;
  /** Distinct questions behind that count. Always <= absent_answers. */
  absent_questions: number;
  questions: string[];
  /** How hard the placement is, 0-100 (placement-difficulty.ts). Null or absent: not scored. */
  difficulty?: number | null;
  /**
   * Distinct engines that cited the page anywhere in the scan. Optional because
   * scans unlocked before 25 Sep 2026 were served without it.
   *
   * difficulty_basis is stored on the row and deliberately not on this type
   * (QF1, Danny, 25 Sep 2026): the result may not name or imply a marketplace
   * or a price, so the reason behind a score does not leave the server.
   */
  cited_by?: number;
};

export type HistoryPoint = {
  year: number;
  month: number;
  mentions: number;
};

/** One engine's coverage of the question set. */
export type EngineBreakdown = {
  engine: string;
  label: string;
  /** "scraper" read the consumer product; "model" asked the model directly. */
  kind: "scraper" | "model";
  /** Questions this engine was asked. */
  asked: number;
  /** Of those, how many it actually answered. Zero is a measured absence. */
  answered: number;
  /** Of the answers, how many named the brand. */
  named: number;
};

/** One question put to every engine, and what came back at the tally level. */
export type ScanQuestion = {
  idx: number;
  question: string;
  /** category | positioning | sector | outcome | comparison */
  kind: string;
  /** How many engines produced an answer at all. */
  answered: number;
  /** Of those, how many named the brand. */
  named: number;
  /**
   * Where the brand sits in Google's organic results for this question, or
   * null outside the top 20 - and null also when no organic read was taken.
   * Deliberately not merged with the AI figures: a share of answers and a
   * rank are different measures with different denominators.
   */
  google_rank: number | null;
  /**
   * The derived Google head keyword for this question (R39/R41, Danny, 27 Sep
   * 2026), its monthly searches and the scan domain's organic position for
   * it. Absent on every scan before those shipped - no backfill - and the
   * result screen falls back to `google_rank` wherever `target_keyword` is.
   */
  target_keyword?: string | null;
  search_volume?: number | null;
  keyword_rank?: number | null;
  /**
   * What each engine actually said, present only once the scan is unlocked.
   * The tallies above are free; the words are what the email buys.
   */
  answers?: EngineAnswer[];
};

/** One engine's response to one question, verbatim. */
export type EngineAnswer = {
  engine: string;
  answered: boolean;
  brand_named: boolean;
  /** Null when the engine said nothing, or when the purge has reclaimed it. */
  response_text: string | null;
  /** What it cited for this question. Absent on the teaser and on older payloads. */
  citations?: { domain: string; url: string | null; title: string | null }[];
};

/**
 * The scan's one cluster keyword, as the result shows it (BRIEF-3 C1, S1 on
 * ScanCluster.dc.html). `rank` null is "not in Google's top twenty" or a read
 * that failed; `status` other than chosen means there is no keyword and the
 * result says so rather than guessing one.
 */
export type ClusterKeywordView = {
  status: "chosen" | "none_qualified" | "read_failed";
  keyword: string | null;
  volume: number | null;
  intent: string | null;
  rank: number | null;
};

export type RunScanResponse = {
  scan_id: string;
  /** Kept for the fixture path. Live results use `engines` instead. */
  platform: "google";
  /** ISO date the figures were read. Every figure carries this. */
  read_at: string;
  topic: string;
  market: Market;
  brand: {
    name: string;
    named_in: number | null;
    of: number | null;
    rank: number | null;
    of_brands: number | null;
    share_of_voice: number | null;
  };
  /** Empty on the fixture path; one row per engine the scan actually ran. */
  engines: EngineBreakdown[];
  top_source: { domain: string; brand_present: boolean } | null;
  leaderboard: LeaderboardEntry[];
  sources: SourceEntry[];
  history: HistoryPoint[];
  /**
   * The questions actually put to the engines, with how many answered and how
   * many named the brand. Free, and deliberately so: the strongest evidence a
   * scan is real is the list of things it asked.
   *
   * Optional because the fixture path does not have it. /example carried the
   * same gap and is gone - e21d801 redirected it and the route was deleted.
   */
  questions?: ScanQuestion[];
  /**
   * The placement opportunities. Present only once the scan is unlocked -
   * this is the finding the email address buys, so it is absent from a locked
   * payload rather than hidden in one.
   */
  opportunities?: ScanOpportunity[];
  /**
   * The cluster keyword, on scans whose confirm screen picked one (BRIEF-3
   * C1). Absent or null on scans from before C1, which keep the old
   * question-by-question result.
   */
  cluster_keyword?: ClusterKeywordView | null;
  gated: boolean;
  /**
   * A model batch failed while the leaderboard was being built, so names are
   * missing from it. Every count in `leaderboard` is still measured - what is
   * not safe is anything counted *against* it, so rank, of_brands and
   * share_of_voice are null whenever this is true.
   */
  leaderboard_partial: boolean;
  empty: boolean;
  /** Why a field is blank or the result is empty. Null when nothing is missing. */
  reason: string | null;
};
