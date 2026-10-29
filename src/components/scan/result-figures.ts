/**
 * Every number and every sentence the result screen tells a visitor their scan
 * found, separated from the markup that paints it.
 *
 * `ResultView.tsx` was 827 lines and, on the census of 20 September 2026, one
 * of thirteen source files named by no test. The four walking sweeps read its
 * *rendered* output on the prerendered pages; none of them executes it, and
 * none of them can - the screen renders only behind a live scan. So the file
 * that decides what a visitor is told their scan found had no executor at all,
 * and the queue named it the measurement this repo does not have.
 *
 * Splitting is the same move `brand-name.ts`, `settings-merge.ts`,
 * `dataforseo-request.ts` and `readiness-spec.ts` made, for a different
 * obstacle: there the blocker was `server-only`, here it is JSX, which Node's
 * runner cannot parse however well it strips types. The alternative - a test
 * that retypes the logic beside the component - is how this repo got four
 * blind tripwires, so it is not an alternative.
 *
 * No JSX and no imports beyond pure modules, so `node --test` loads it.
 * Relative and extensionful for the same reason as `scan-shape.ts`.
 *
 * Nothing here is server-only and nothing here is commercially sensitive: it
 * is what the visitor is already reading, said once instead of in two places.
 */

import { count } from "../../lib/plural.ts";
import { SERP_DEPTH } from "../../lib/scan/dataforseo-request.ts";
import { ENGINE_SPECS, isEngine } from "../../lib/scan/engines.ts";
import type {
  EngineAnswer,
  LeaderboardEntry,
  RunScanResponse,
  ScanQuestion,
  SourceEntry,
} from "../../lib/scan/contract.ts";

/**
 * "20 Sep 2026" off an ISO date, and the raw string back if it is not one.
 *
 * One line, because this used to be a second copy of the formatter in
 * `config/posts.ts` and the two had drifted - this one guarded the month and
 * that one did not. See `lib/format-date.ts`. The name is kept so the call
 * sites and the tests that already point here still read the same.
 */
export { formatDate as fmtDate } from "../../lib/format-date.ts";

export function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/**
 * Whether a leaderboard row is the brand this scan is about.
 *
 * `is_subject` is set by the pipeline when the row is written and carried all
 * the way here by both the teaser and the unlock payload, so it is the answer.
 * The name compare is the fallback for the fixture path, which has no flag -
 * and it is also what the view used to do on its own, which is the defect: the
 * brand extractor's spelling of the subject and the leaderboard's are produced
 * by different code and need not match. When they did not, the report bolded
 * nobody in the share-of-voice bars and handed "Top of the leaderboard" to
 * whoever was actually second.
 */
export function isSubject(row: LeaderboardEntry, brandName: string): boolean {
  if (typeof row.is_subject === "boolean") return row.is_subject;
  return row.brand.toLowerCase() === brandName.toLowerCase();
}

export function engineLabel(key: string): string {
  return isEngine(key) ? ENGINE_SPECS[key].label : key;
}

/**
 * The engine the "AI Overview" column is about, read off the spec table rather
 * than typed. `ENGINE_SPECS` is keyed by `Engine`, so renaming or dropping the
 * key is a compile error here instead of a column that silently goes blank on
 * every row while its header still promises a reading.
 */
export const OVERVIEW_ENGINE = ENGINE_SPECS.google_aio.key;

/**
 * What a question row's two tallies are, decided once.
 *
 * The pill ("2 of 4", "not named", "no answer") was read off the server's
 * `answered`/`named` counts while the two columns beside it were read off the
 * per-engine rows. Two judges of one fact, which is the failure AGENTS.md
 * names - and here the visitor can open the row and read the evidence, so a
 * disagreement is visible to them and the rows are the half that is right.
 *
 * The rows win when there are any. An empty array is "no detail carried", not
 * "measured zero", so it falls back to the tallies exactly as an absent one
 * does - the same rule `toResult` keeps for an absent engine breakdown.
 */
export function questionTally(q: ScanQuestion): { answered: number; named: number } {
  const rows = q.answers ?? [];
  if (!rows.length) return { answered: q.answered, named: q.named };
  return {
    answered: rows.filter((a) => a.answered).length,
    named: rows.filter((a) => a.brand_named).length,
  };
}

/** The pill beside a question: a measured silence, a tally, or a clean miss. */
export function questionPill(q: ScanQuestion): string {
  const t = questionTally(q);
  if (t.answered === 0) return "no answer";
  if (t.named > 0) return t.named + " of " + t.answered;
  return "not named";
}

/**
 * Which engines named the brand, in words rather than a count.
 *
 * Blank when no engine answered at all. It used to say "none of them" on that
 * row, which is true of the naming and false of everything it implies: the
 * pill one column to the left already says "no answer", so the row read as
 * four engines having spoken and none having named you. Same species as the
 * "Top of the leaderboard" defect this screen already carries a comment about
 * - two halves of one row disagreeing, with the louder half the wrong one.
 *
 * Distinguishing *why* an engine did not answer is blocked item 12 and is not
 * decided here; this only stops the column contradicting its own row.
 */
export function namedBy(q: ScanQuestion): string {
  const rows = q.answers ?? [];
  if (!rows.length) return "";
  const named = rows.filter((a) => a.brand_named).map((a) => engineLabel(a.engine));
  if (named.length) return named.join(", ");
  return rows.some((a) => a.answered) ? "none of them" : "";
}

/** Whether Google returned an AI Overview at all for this question. */
export function overviewState(q: ScanQuestion): string {
  const row = (q.answers ?? []).find((a) => a.engine === OVERVIEW_ENGINE);
  if (!row) return "";
  if (!row.answered) return "none shown";
  return row.brand_named ? "mentioned" : "shown, absent";
}

/** The engine answers with words behind them, which are the openable rows. */
export function transcript(q: ScanQuestion): EngineAnswer[] {
  return (q.answers ?? []).filter((a) => a.response_text?.trim());
}

/** Whether a cited page belongs to the domain that was scanned. */
export function isOwnDomain(sourceDomain: string, domain: string): boolean {
  return sourceDomain === domain || sourceDomain.endsWith("." + domain);
}

export const KINDS: Record<string, string> = {
  own: "yours",
  placement: "placement",
  competitor: "competitor",
  review: "review site",
  other: "other",
};

/** The label for a page kind. Unclassified is null, and renders nothing. */
export function kindLabel(kind: string | null): string | null {
  if (!kind) return null;
  return KINDS[kind] ?? KINDS.other;
}

/**
 * "The 4 most-cited of 30 pages ...", or null when nothing is held back.
 *
 * "The 1 most-cited of 2 pages" is reachable - a positive difference says the
 * list is longer than what is shown, not that what is shown is more than one
 * row - so the singular is spelled out rather than counted into the sentence.
 */
export function moreSourcesNote(shown: number, total: number): string | null {
  if (total - shown <= 0) return null;
  /**
   * "Most-cited" was true until 20 September 2026 and is not any more.
   *
   * The free list is now the page each answer reached for FIRST, deduped by
   * domain - Danny's item 4, a filter that lives in `scan_teaser` alone. A page
   * cited by every answer but never first is not on this list, so calling what
   * is shown "the most-cited" is a ranking claim the rows no longer support.
   *
   * "The rest come with the report" stays, and stays TRUE, because the filter
   * is in the view and not in the pass: `buildUnlockPayload` reads
   * `scan_citations` with no position anywhere in it, so the report really does
   * carry every page. That sentence is the reason `total_sources` was
   * deliberately left counting every cited domain rather than the shortened
   * set - see the migration header.
   */
  return (
    (shown === 1 ? "The page " : "The " + shown + " pages ") +
    "your answers reached for first, of " +
    count(total, "page") +
    " the engines drew on. The rest come with the report."
  );
}

/** How many of the listed pages an article could run on, or null if none was sorted. */
export function placementsNote(sources: readonly SourceEntry[]): string | null {
  if (!sources.some((s) => s.kind)) return null;
  const placements = sources.filter((s) => s.kind === "placement").length;
  return (
    placements +
    (placements === 1 ? " of these is a page" : " of these are pages") +
    " a brand can realistically be placed into."
  );
}

/** How many rows of the leaderboard are drawn, and the ceiling its caption counts to. */
export const SOV_ROWS = 12;

/** Answers, not mentions, since 29 Oct 2026 - see answers-naming.ts. */
export function leaderboardCaption(rowCount: number, partial: boolean): string {
  const tail = partial ? " we could read." : rowCount > SOV_ROWS ? "." : " in all.";
  const body =
    rowCount > SOV_ROWS ? "top " + SOV_ROWS + " of " + count(rowCount, "brand") : count(rowCount, "brand");
  return "Answers naming each brand across these engines, " + body + tail;
}

/**
 * The line under the headline, from ScanResult.dc.html ("Five buyer questions,
 * each put to four engines. Everything below is free."). In figures, from the
 * scan's own question list and engine list. Nothing on the finished result is
 * gated any more, so the second sentence is true of every scan that reaches it.
 * Said as prompts, not the board's questions (R127, Danny 30 Sep, danny.md
 * line 113); scan-prompts-copy.test.mts holds it. A scan with a chosen
 * cluster keyword says what the prompts are about, as ScanCluster.dc.html does.
 */
export function standfirst(questions: number, engines: number, cluster = false): string {
  return count(questions, "buyer prompt") + (cluster ? " about one Google keyword" : "") + ", each put to " + count(engines, "engine") + ". Everything below is free.";
}

export function headline(answers: number, missing: number): string {
  if (answers === 0) return "No engine answered these questions yet.";
  if (missing === 0) return "Every answer named you.";
  return missing + " of " + answers + " AI answers did not name you.";
}

/**
 * Why the placement list is empty, which is four different sentences.
 *
 * `deriveOpportunities` excludes any page whose kind is null, so the list
 * empties for reasons that are not the same finding and must not read like
 * one. Measured on 19 September 2026: of six scans read back from production,
 * three had zero of their sources classified while citing 255, 264 and 564
 * pages between them, and one of those three is unlocked and live - its report
 * told its reader that was a finding rather than a gap. Classification is
 * wrapped in never-fatal, so a call that fails today lands a fresh scan in the
 * same state.
 *
 * - `none-cited`: the engines cited nothing, so there was never a list to
 *   build. The screen shows no source table at all on this scan, and the
 *   finding copy - "every page the engines cited ..." - is a sentence about
 *   pages that do not exist. Reachable on any scan where every engine failed,
 *   which is the state the headline already has its own branch for.
 * - `unclassified`: pages were cited and none could be sorted.
 * - `partial`: some were sorted and some were not. The ones that were not have
 *   not been ruled out, so "every page ... either already names you, is a
 *   competitor own site, or is somewhere an article cannot run" is not a claim
 *   this scan can make. Only a scan where *every* cited page was sorted can.
 * - `none-qualified`: every page was sorted and none qualified. The finding.
 */
export type PlacementVerdict = "none-cited" | "unclassified" | "partial" | "none-qualified";

export function placementVerdict(sources: readonly SourceEntry[]): PlacementVerdict {
  if (!sources.length) return "none-cited";
  const sorted = sources.filter((s) => s.kind).length;
  if (sorted === 0) return "unclassified";
  if (sorted < sources.length) return "partial";
  return "none-qualified";
}

/**
 * `noun` is "prompts" on a scan from C1 on (a cluster), "questions" on an
 * older one, which was run and is drawn as questions (7453059).
 */
export function placementCopy(sources: readonly SourceEntry[], noun: "prompts" | "questions" = "questions"): string {
  const verdict = placementVerdict(sources);
  if (verdict === "none-cited") {
    return (
      "The engines cited no pages at all for these " + noun + ", so there was nothing to build this list from." +
      " That is a gap in the scan rather than a finding."
    );
  }
  if (verdict === "unclassified") {
    return (
      "We could not sort the pages behind this scan into the ones an article could run on, so this list could" +
      " not be built. That is a gap in the scan rather than a finding - every page the engines cited is still" +
      " listed above, and none of them has been ruled out."
    );
  }
  if (verdict === "partial") {
    const unsorted = sources.filter((s) => !s.kind).length;
    return (
      "None of the pages we could sort is somewhere an article could run. " +
      count(unsorted, "page") +
      " of the " +
      count(sources.length, "page") +
      " behind this scan could not be sorted at all, so " +
      (unsorted === 1 ? "it has" : "they have") +
      " not been ruled out. That makes this a partial read rather than a finding."
    );
  }
  return (
    "None this time. Every page the engines cited for these " + noun + " either already names you, is a" +
    " competitor own site, or is somewhere an article cannot run. That is a finding, not a gap in the scan."
  );
}

/** The note under the "Top of the leaderboard" tile. */
export function topBrandNote(mentions: number, topIsYou: boolean, rank: number | null): string {
  const tail = topIsYou
    ? ". That is you - nobody we read is named more often."
    : rank
      ? ". You sit " + ordinal(rank) + "."
      : ".";
  return mentions + " mentions" + tail;
}

/** The note under the "AI visibility" tile. */
export function visibilityNote(named: number, answers: number, questions: number): string {
  return named + " of " + count(answers, "answer") + " named you, across " + count(questions, "question") + ".";
}

/** The note under the "Sources in the category" tile. */
export function sourcesNote(yours: number): string {
  return "Distinct pages the answers were assembled from. You appear in " + yours + ".";
}

/** The first three placements, labelled by position rather than by a typed list. */
export const PLAN_ORDER = ["First", "Second", "Third"];

export type ResultFigures = {
  /** Answers every engine gave, and how many named the brand. */
  answers: number;
  named: number;
  missing: number;
  /** Share of answers, or null when nothing was answered. Never estimated. */
  pct: number | null;
  headline: string;
  standfirst: string;
  /**
   * Counted over the questions that got an answer, and shown over them too.
   *
   * The numerator has always excluded questions no engine answered - it has
   * to, because a question nobody answered is neither named nor missing - but
   * the denominator was every question asked. So a scan where four of fourteen
   * went unanswered read "10 of 14" for a figure whose real denominator was
   * ten, and the other way round a clean scan with four unanswered read
   * "0 of 14" as though fourteen had been measured.
   */
  answeredQuestions: number;
  blank: number;
  bestRank: number | null;
  topBrand: LeaderboardEntry | null;
  topIsYou: boolean;
  yourSources: number;
  /** A counted zero on either side of the gate. Not "not counted yet". */
  emptyList: boolean;
};

export function resultFigures(
  r: RunScanResponse,
  domain: string,
  opts: { unlocked: boolean; noPlacements?: boolean },
): ResultFigures {
  const answers = r.engines.reduce((a, e) => a + e.answered, 0);
  const named = r.engines.reduce((a, e) => a + e.named, 0);
  const missing = answers - named;
  const qs = r.questions ?? [];
  const tallies = qs.map((q) => questionTally(q));
  const answeredQuestions = tallies.filter((t) => t.answered > 0).length;
  const ranks = qs.map((q) => q.google_rank).filter((v): v is number => typeof v === "number");
  /**
   * The brand at the top of the leaderboard, which is the first row: both the
   * teaser RPC and buildUnlockPayload order by mentions descending.
   *
   * It used to be the first row that was NOT the subject, under a label saying
   * "Top of the leaderboard". On a scan where the brand tops its own category
   * - the best result this product can return, and one that exists in
   * production - the tile named the runner-up as the leader and then said
   * "You sit 1st" directly underneath it.
   */
  const topBrand = r.leaderboard[0] ?? null;

  return {
    answers,
    named,
    missing,
    pct: answers > 0 ? Math.round((named / answers) * 100) : null,
    headline: headline(answers, missing),
    standfirst: standfirst(qs.length, r.engines.length, clusterState(r) === "chosen"),
    answeredQuestions,
    blank: tallies.filter((t) => t.answered > 0 && t.named === 0).length,
    bestRank: ranks.length ? Math.min(...ranks) : null,
    topBrand,
    topIsYou: topBrand ? isSubject(topBrand, r.brand.name) : false,
    yourSources: r.sources.filter((s) => isOwnDomain(s.domain, domain)).length,
    emptyList: opts.unlocked
      ? !(r.opportunities && r.opportunities.length)
      : Boolean(opts.noPlacements),
  };
}

/**
 * The Google fact on a question row and in the answer drawer's header.
 *
 * A question carrying a derived keyword (R39/R41, Danny, 27 Sep 2026) reads
 * "<keyword> - <volume>/mo - <rank>"; one without reads as it always has,
 * off the rank for the question text itself. No backfill, so both shapes
 * live side by side on the site for good.
 *
 * A volume under 10 reads "under 10/mo". DataForSEO's Google Ads volume is
 * banded at the low end, so a single-digit figure is not a measurement and is
 * not printed as one. A null volume - the read not taken, or failed - drops
 * the middle clause rather than claiming zero.
 */
export function googleLine(
  q: Pick<ScanQuestion, "google_rank" | "target_keyword" | "search_volume" | "keyword_rank">,
): string {
  const kw = q.target_keyword?.trim();
  if (!kw) return typeof q.google_rank === "number" ? "Google #" + q.google_rank : "Not in Google top " + SERP_DEPTH;
  const parts = [kw];
  if (typeof q.search_volume === "number") {
    parts.push(q.search_volume < 10 ? "under 10/mo" : q.search_volume.toLocaleString("en-GB") + "/mo");
  }
  parts.push(typeof q.keyword_rank === "number" ? "Google #" + q.keyword_rank : "not in top " + SERP_DEPTH);
  return parts.join(" - ");
}

/**
 * Which cluster section a result draws (S1, ScanCluster.dc.html, 30 Sep 2026).
 * Null is a scan from before C1: no cluster keyword was ever picked, so the
 * result keeps its question-by-question table rather than claiming one was
 * looked for and not found. "none" is a scan that looked and found no
 * qualifying keyword, or could not read one: the board's dashed node, "Not
 * picked yet", and never a guessed keyword.
 */
export function clusterState(r: Pick<RunScanResponse, "cluster_keyword">): "chosen" | "none" | null {
  const c = r.cluster_keyword;
  if (!c) return null;
  return c.status === "chosen" && c.keyword?.trim() ? "chosen" : "none";
}

/**
 * The cluster keyword's Google figure: "#9", "Not in top 20" for a chosen
 * keyword the domain does not rank for in the depth read, "-" when there is
 * no keyword (the board's `kw.rank`).
 */
export function clusterRank(r: Pick<RunScanResponse, "cluster_keyword">): string {
  if (clusterState(r) !== "chosen") return "-";
  const rank = r.cluster_keyword?.rank;
  return typeof rank === "number" ? "#" + rank : "Not in top " + SERP_DEPTH;
}

/**
 * The drawer head's keyword note: the board's "keyword at Google #9", and
 * "keyword not in Google's top 20" where it does not rank, which read
 * "keyword at Google Not in top 20" when it borrowed the tile's figure
 * (live on 00862d12, 30 Sep).
 */
export function drawerKeywordLine(r: Pick<RunScanResponse, "cluster_keyword">): string {
  const state = clusterState(r);
  if (state === null) return "";
  if (state === "none") return "no keyword yet";
  const rank = r.cluster_keyword?.rank;
  return typeof rank === "number" ? "keyword at Google #" + rank : "keyword not in Google's top " + SERP_DEPTH;
}

/**
 * The board's link from each prompt to the keyword node: solid where at
 * least one engine named the brand on that prompt, dashed where none did.
 * The row's verdict pill says the same in words, so the line is decoration.
 */
export function clusterLinks(qs: ScanQuestion[]): { named: boolean }[] {
  return qs.map((q) => ({ named: questionTally(q).named > 0 }));
}
