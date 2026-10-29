import assert from "node:assert/strict";
import { test } from "node:test";

import { ENGINE_SPECS, ENGINES, FREE_ENGINES } from "../../lib/scan/engines.ts";
import type { LeaderboardEntry, RunScanResponse, ScanQuestion, SourceEntry } from "../../lib/scan/contract.ts";
import {
  OVERVIEW_ENGINE,
  PLAN_ORDER,
  SOV_ROWS,
  clusterLinks,
  clusterRank,
  drawerKeywordLine,
  clusterState,
  engineLabel,
  fmtDate,
  googleLine,
  headline,
  isOwnDomain,
  isSubject,
  kindLabel,
  leaderboardCaption,
  moreSourcesNote,
  namedBy,
  ordinal,
  overviewState,
  placementCopy,
  placementVerdict,
  placementsNote,
  questionPill,
  questionTally,
  resultFigures,
  topBrandNote,
  transcript,
  visibilityNote,
} from "./result-figures.ts";

/**
 * The result screen, which decides what a visitor is told their scan found.
 *
 * `ResultView.tsx` was 827 lines, the largest of the thirteen source files the
 * census of 20 September 2026 found named by no test - and unlike the other
 * twelve it is not reachable by the four walking sweeps either, because it
 * renders only behind a live scan. Nothing on this machine or in the cloud has
 * ever executed a line of it.
 *
 * What is asserted here is the states a happy scan does not produce: no engine
 * answered, no page was cited, half the pages were sorted, the brand tops its
 * own leaderboard, a question whose tallies and whose rows disagree. Those are
 * the ones that are wrong in production and look fine in a fixture.
 *
 * Nothing here retypes a value out of `result-figures.ts`. Engine keys come
 * from `ENGINES`, labels from `ENGINE_SPECS`, the leaderboard ceiling from
 * `SOV_ROWS` and the plan ceiling from `PLAN_ORDER`, so a changed ceiling
 * moves the expectation with it rather than failing this file.
 */

const AIO = OVERVIEW_ENGINE;
const OTHER = FREE_ENGINES.filter((e) => e !== AIO);

function answer(engine: string, answered: boolean, named: boolean, text: string | null = null) {
  return { engine, answered, brand_named: named, response_text: text };
}

function question(over: Partial<ScanQuestion> = {}): ScanQuestion {
  return {
    idx: 1,
    question: "who does this",
    kind: "category",
    answered: 0,
    named: 0,
    google_rank: null,
    ...over,
  };
}

function source(domain: string, kind: string | null = null, mentions = 1): SourceEntry {
  return { domain, mentions, kind, note: null };
}

function scan(over: Partial<RunScanResponse> = {}): RunScanResponse {
  return {
    scan_id: "s",
    platform: "google",
    read_at: "2026-09-20",
    topic: "t",
    market: "UK",
    brand: { name: "Acme", named_in: null, of: null, rank: null, of_brands: null, share_of_voice: null },
    engines: [],
    top_source: null,
    leaderboard: [],
    sources: [],
    history: [],
    gated: false,
    leaderboard_partial: false,
    empty: false,
    reason: null,
    ...over,
  };
}

function breakdown(engine: string, asked: number, answered: number, named: number) {
  return { engine, label: engineLabel(engine), kind: "scraper" as const, asked, answered, named };
}

/* ── The date and the ordinal, which every tile and every row passes through ── */

test("a read date renders as a date, and anything else renders as itself", () => {
  assert.equal(fmtDate("2026-09-20"), "20 Sep 2026");
  assert.equal(fmtDate("2026-01-01T09:15:00.000Z"), "1 Jan 2026");
  assert.equal(fmtDate("2026-12-31"), "31 Dec 2026");
  // A month past the table used to index off the end and print "undefined",
  // which reads as a rendering bug rather than as a bad value.
  assert.equal(fmtDate("2026-13-01"), "2026-13-01");
  assert.equal(fmtDate(""), "");
  assert.equal(fmtDate("not a date"), "not a date");
});

test("the ordinal is right on every teen and every twenty", () => {
  const want: Record<number, string> = {
    1: "1st", 2: "2nd", 3: "3rd", 4: "4th",
    11: "11th", 12: "12th", 13: "13th",
    21: "21st", 22: "22nd", 23: "23rd", 24: "24th",
    100: "100th", 101: "101st", 111: "111th", 112: "112th",
  };
  for (const [n, s] of Object.entries(want)) assert.equal(ordinal(Number(n)), s, "ordinal(" + n + ")");
});

/* ── Which row is you ── */

test("the server's is_subject wins, and the name compare is only the fallback", () => {
  const flagged: LeaderboardEntry = { brand: "A Different Spelling", mentions: 3, is_subject: true };
  assert.equal(isSubject(flagged, "Acme"), true, "the flag was set and was ignored");

  const denied: LeaderboardEntry = { brand: "Acme", mentions: 3, is_subject: false };
  assert.equal(isSubject(denied, "Acme"), false, "the flag said no and the spelling overruled it");

  const unflagged: LeaderboardEntry = { brand: "ACME", mentions: 3 };
  assert.equal(isSubject(unflagged, "acme"), true, "the fixture path lost its case-insensitive compare");
  assert.equal(isSubject({ brand: "Other", mentions: 1 }, "Acme"), false);
});

/* ── One judge per question row ── */

test("the pill and the two columns beside it are read off the same rows", () => {
  /* The tallies say two of four named; the rows the visitor can open say
     three. Whatever the disagreement, the row cannot state both. */
  const q = question({
    answered: 4,
    named: 2,
    answers: [
      answer(AIO, true, true),
      answer(OTHER[0], true, true),
      answer(OTHER[1], true, true),
      answer(OTHER[2], true, false),
    ],
  });
  assert.deepEqual(questionTally(q), { answered: 4, named: 3 });
  assert.equal(questionPill(q), "3 of 4");
  assert.equal(namedBy(q).split(", ").length, 3, "the column lists a different number from the pill");
});

test("no detail carried falls back to the tallies, and an empty array is not a measured zero", () => {
  assert.deepEqual(questionTally(question({ answered: 4, named: 1 })), { answered: 4, named: 1 });
  assert.deepEqual(questionTally(question({ answered: 4, named: 1, answers: [] })), { answered: 4, named: 1 });
  assert.equal(questionPill(question({ answered: 4, named: 1 })), "1 of 4");
});

test("a question no engine answered says so once, not twice in two voices", () => {
  const q = question({
    answered: 0,
    named: 0,
    answers: [answer(AIO, false, false), answer(OTHER[0], false, false)],
  });
  assert.equal(questionPill(q), "no answer");
  // "none of them" here read as four engines having spoken and none having
  // named you, one column from a pill saying nothing was said at all.
  assert.equal(namedBy(q), "", "the engine column contradicts the pill on the same row");
});

test("a question answered and not named still says none of them", () => {
  const q = question({
    answered: 2,
    named: 0,
    answers: [answer(AIO, true, false), answer(OTHER[0], false, false)],
  });
  assert.equal(questionPill(q), "not named");
  assert.equal(namedBy(q), "none of them");
});

test("engine labels come off the spec table, never off the key", () => {
  const q = question({ answered: 1, named: 1, answers: [answer(AIO, true, true)] });
  assert.equal(namedBy(q), ENGINE_SPECS[AIO].label);
  // An engine the specs do not know renders its key rather than "undefined".
  assert.equal(engineLabel("some_new_engine"), "some_new_engine");
  for (const e of ENGINES) assert.equal(engineLabel(e), ENGINE_SPECS[e].label);
});

test("the AI Overview column is keyed on an engine that exists", () => {
  assert.ok(
    (ENGINES as readonly string[]).includes(OVERVIEW_ENGINE),
    "the overview column is keyed on an engine no scan runs, so it is blank on every row",
  );
  assert.equal(overviewState(question({ answers: [answer(AIO, true, true)] })), "mentioned");
  assert.equal(overviewState(question({ answers: [answer(AIO, true, false)] })), "shown, absent");
  assert.equal(overviewState(question({ answers: [answer(AIO, false, false)] })), "none shown");
  // No row for it at all is not the same as a row saying nothing was shown.
  assert.equal(overviewState(question({ answers: [answer(OTHER[0], true, true)] })), "");
  assert.equal(overviewState(question()), "");
});

test("only an answer with words behind it is an openable row", () => {
  const q = question({
    answers: [answer(AIO, true, true, "they said this"), answer(OTHER[0], true, false, "   "), answer(OTHER[1], true, false, null)],
  });
  assert.deepEqual(
    transcript(q).map((a) => a.engine),
    [AIO],
    "a whitespace-only or purged response opened an empty drawer",
  );
});

/* ── Whose page is it ── */

test("a cited page is yours only on the domain or under it", () => {
  assert.equal(isOwnDomain("acme.com", "acme.com"), true);
  assert.equal(isOwnDomain("blog.acme.com", "acme.com"), true);
  assert.equal(isOwnDomain("notacme.com", "acme.com"), false, "a suffix match claimed somebody else's domain as yours");
  assert.equal(isOwnDomain("acme.com.au", "acme.com"), false);
  assert.equal(isOwnDomain("acme.com", "blog.acme.com"), false);
});

/* ── The source table's two footnotes ── */

/**
 * The wording changed on 20 September 2026 and the cases did not.
 *
 * "Most-cited" was a ranking claim, and the free list stopped being a ranking
 * when it became the page each answer reached for FIRST (Danny's item 4). The
 * boundaries this test exists for are unchanged - nothing held back, a negative
 * remainder, and the singular - and they are what the assertions are about.
 *
 * The second half of the sentence is asserted deliberately rather than sliced
 * off: "The rest come with the report" is only true while the position filter
 * stays inside `scan_teaser` and out of `buildUnlockPayload`, which is the
 * split `citations.test.mts` holds. If that ever stops being true, this promise
 * is the thing on the page that becomes a lie.
 */
test("nothing held back says nothing, and one row held back is still singular", () => {
  assert.equal(moreSourcesNote(4, 4), null);
  assert.equal(moreSourcesNote(9, 4), null, "a total below what is shown invented a negative remainder");
  assert.equal(
    moreSourcesNote(1, 2),
    "The page your answers reached for first, of 2 pages the engines drew on. The rest come with the report.",
  );
  assert.equal(
    moreSourcesNote(4, 30),
    "The 4 pages your answers reached for first, of 30 pages the engines drew on. The rest come with the report.",
  );
});

/**
 * And that the note never claims a ranking.
 *
 * Position in `scan_citations` is order of citation: on an AI Overview it
 * tracks prominence reasonably well, on a chat engine it may be nothing but
 * order of mention. So the free list may be described by what it is and not by
 * what it would be flattering for it to be. Written as a prohibition over the
 * strings this function can produce, because the failure is one adjective
 * slipping back in during a copy pass - which is exactly how "most-cited" came
 * to be describing a list that had stopped being one.
 */
test("the source footnote never calls the first-cited list a ranking", () => {
  const said = [moreSourcesNote(1, 2), moreSourcesNote(4, 30), moreSourcesNote(12, 300)].filter(
    (s): s is string => s !== null,
  );
  assert.equal(said.length, 3, "the note stopped producing a sentence for these cases");
  for (const s of said) {
    for (const claim of ["most-cited", "most cited", "top ", "best ", "biggest", "leading", "important"]) {
      assert.ok(
        !s.toLowerCase().includes(claim),
        `the source footnote says ${JSON.stringify(claim)} in "${s}". These rows are ordered by which ` +
          `answer cited them first, which is not a ranking of anything - see the header of ` +
          `20260920030000_teaser_first_cited.sql`,
      );
    }
  }
});

test("the placement footnote is absent when nothing was sorted, and agrees with itself when it is not", () => {
  assert.equal(placementsNote([]), null);
  assert.equal(placementsNote([source("a.com"), source("b.com")]), null, "a footnote counted over pages nobody sorted");
  assert.equal(placementsNote([source("a.com", "placement"), source("b.com", "competitor")]), "1 of these is a page a brand can realistically be placed into.");
  assert.equal(placementsNote([source("a.com", "placement"), source("b.com", "placement")]), "2 of these are pages a brand can realistically be placed into.");
  assert.equal(placementsNote([source("a.com", "competitor")]), "0 of these are pages a brand can realistically be placed into.");
});

/* ── The leaderboard caption, and its ceiling ── */

test("the caption counts to the same ceiling the bars are drawn to", () => {
  const under = SOV_ROWS - 1;
  const over = SOV_ROWS + 1;
  assert.equal(leaderboardCaption(1, false), "Answers naming each brand across these engines, 1 brand in all.");
  assert.equal(leaderboardCaption(under, false), "Answers naming each brand across these engines, " + under + " brands in all.");
  assert.equal(
    leaderboardCaption(SOV_ROWS, false),
    "Answers naming each brand across these engines, " + SOV_ROWS + " brands in all.",
    "the caption said 'top N of N' for a list it drew in full",
  );
  assert.equal(
    leaderboardCaption(over, false),
    "Answers naming each brand across these engines, top " + SOV_ROWS + " of " + over + " brands.",
  );
});

test("a partial leaderboard never says in all", () => {
  for (const n of [1, SOV_ROWS, SOV_ROWS + 5]) {
    const caption = leaderboardCaption(n, true);
    assert.ok(caption.endsWith(" we could read."), "a short leaderboard claimed to be the whole category: " + caption);
    assert.ok(!caption.includes("in all"), caption);
  }
});

/* ── The headline ── */

test("the headline never states a miss it did not measure", () => {
  assert.equal(headline(0, 0), "No engine answered these questions yet.");
  // A measured silence must not read as a clean sweep.
  assert.ok(!headline(0, 0).includes("named you"), "a scan nobody answered congratulated the visitor");
  assert.equal(headline(20, 0), "Every answer named you.");
  assert.equal(headline(20, 7), "7 of 20 AI answers did not name you.");
});

/* ── Why the placement list is empty, which is four sentences ── */

test("the four ways to reach an empty placement list are four findings", () => {
  assert.equal(placementVerdict([]), "none-cited");
  assert.equal(placementVerdict([source("a.com"), source("b.com")]), "unclassified");
  assert.equal(placementVerdict([source("a.com", "competitor"), source("b.com")]), "partial");
  assert.equal(placementVerdict([source("a.com", "competitor"), source("b.com", "own")]), "none-qualified");
});

test("only a scan that sorted every page it cited may call an empty list a finding", () => {
  const finding = placementCopy([source("a.com", "competitor"), source("b.com", "own")]);
  assert.ok(finding.includes("That is a finding, not a gap in the scan."), finding);

  for (const sources of [[], [source("a.com")], [source("a.com", "competitor"), source("b.com")]]) {
    const copy = placementCopy(sources);
    assert.ok(
      !copy.includes("That is a finding, not a gap"),
      "a scan that did not sort every page it cited called the empty list a finding: " + copy,
    );
    assert.ok(copy.includes("gap in the scan") || copy.includes("partial read"), copy);
  }
});

test("a scan that cited nothing does not describe pages it never had", () => {
  const copy = placementCopy([]);
  // "Every page the engines cited for these questions ..." is a sentence about
  // pages that do not exist. Reachable on any scan where every engine failed,
  // which is the state the headline already has a branch for.
  assert.ok(!copy.includes("Every page the engines cited"), copy);
  assert.ok(copy.includes("cited no pages at all"), copy);
});

test("a partly sorted scan counts what it could not sort, and agrees with itself", () => {
  const one = placementCopy([source("a.com", "competitor"), source("b.com")]);
  assert.ok(one.includes("1 page of the 2 pages"), one);
  assert.ok(one.includes("it has not been ruled out"), one);

  const many = placementCopy([source("a.com", "competitor"), source("b.com"), source("c.com")]);
  assert.ok(many.includes("2 pages of the 3 pages"), many);
  assert.ok(many.includes("they have not been ruled out"), many);
});

/* ── The unlocked tiles ── */

test("the top tile's two halves cannot contradict each other", () => {
  assert.equal(topBrandNote(9, true, 1), "9 mentions. That is you - nobody we read is named more often.");
  // The defect this replaced: the tile named the runner-up as the leader and
  // said "You sit 1st" underneath it.
  assert.ok(!topBrandNote(9, true, 1).includes("You sit"), "the tile says the brand is top and that it sits somewhere else");
  assert.equal(topBrandNote(9, false, 3), "9 mentions. You sit 3rd.");
  assert.equal(topBrandNote(9, false, null), "9 mentions.", "a null rank printed as a rank");
});

test("the visibility note agrees in number with what it counts", () => {
  assert.equal(visibilityNote(1, 1, 1), "1 of 1 answer named you, across 1 question.");
  assert.equal(visibilityNote(0, 4, 14), "0 of 4 answers named you, across 14 questions.");
});

test("a page kind renders a label, and an unsorted one renders nothing", () => {
  assert.equal(kindLabel(null), null);
  assert.equal(kindLabel("placement"), "placement");
  assert.equal(kindLabel("own"), "yours");
  assert.equal(kindLabel("review"), "review site");
  assert.equal(kindLabel("something new"), "other", "an unknown kind rendered as itself or as nothing");
});

/* ── The whole figure block ── */

test("the two halves of 'questions with no mention' are counted over the same set", () => {
  /* Four questions: two answered and named, one answered and not, one nobody
     answered. The denominator is three, not four - a question nobody answered
     is neither named nor missing. */
  const r = scan({
    questions: [
      question({ idx: 1, answered: 4, named: 2 }),
      question({ idx: 2, answered: 4, named: 1 }),
      question({ idx: 3, answered: 4, named: 0 }),
      question({ idx: 4, answered: 0, named: 0 }),
    ],
  });
  const f = resultFigures(r, "acme.com", { unlocked: true });
  assert.equal(f.answeredQuestions, 3, "the denominator counted a question nobody answered");
  assert.equal(f.blank, 1);
});

test("the figures survive a scan where nothing at all came back", () => {
  const f = resultFigures(scan(), "acme.com", { unlocked: true });
  assert.equal(f.answers, 0);
  assert.equal(f.pct, null, "a share of nothing was estimated rather than left blank");
  assert.equal(f.bestRank, null);
  assert.equal(f.topBrand, null);
  assert.equal(f.topIsYou, false);
  assert.equal(f.answeredQuestions, 0);
  assert.equal(f.headline, headline(0, 0));
});

test("the answer totals are summed over the engines that ran", () => {
  const r = scan({
    engines: [breakdown(AIO, 14, 14, 5), breakdown(OTHER[0], 14, 10, 0), breakdown(OTHER[1], 14, 0, 0)],
  });
  const f = resultFigures(r, "acme.com", { unlocked: true });
  assert.equal(f.answers, 24);
  assert.equal(f.named, 5);
  assert.equal(f.missing, 19);
  assert.equal(f.pct, 21);
});

test("your own pages are counted the same way the source table marks them", () => {
  const r = scan({ sources: [source("acme.com"), source("blog.acme.com"), source("notacme.com"), source("g2.com")] });
  assert.equal(resultFigures(r, "acme.com", { unlocked: true }).yourSources, 2);
});

test("an empty list is a counted zero on either side of the gate, never an uncounted one", () => {
  const withRows = scan({ opportunities: [{ domain: "a.com", kind: "placement", note: null, absent_answers: 3, absent_questions: 2, questions: [] }] });
  assert.equal(resultFigures(withRows, "acme.com", { unlocked: true }).emptyList, false);
  assert.equal(resultFigures(scan(), "acme.com", { unlocked: true }).emptyList, true);
  // Locked: undefined is "not counted yet" and must keep the blur, which means
  // it must not read as an empty list.
  assert.equal(resultFigures(scan(), "acme.com", { unlocked: false }).emptyList, false);
  assert.equal(resultFigures(scan(), "acme.com", { unlocked: false, noPlacements: true }).emptyList, true);
});

test("the brand that tops its own leaderboard is recognised as the subject", () => {
  const r = scan({
    leaderboard: [
      { brand: "Acme", mentions: 9, is_subject: true },
      { brand: "Rival", mentions: 4, is_subject: false },
    ],
  });
  const f = resultFigures(r, "acme.com", { unlocked: true });
  assert.equal(f.topBrand?.brand, "Acme");
  assert.equal(f.topIsYou, true);
});

test("the plan cards and their labels share one ceiling", () => {
  assert.ok(PLAN_ORDER.length > 0);
  assert.deepEqual(PLAN_ORDER.filter((l) => !l), [], "a plan label is blank, so a card renders 'undefined - join'");
});

test("googleLine: a question without a derived keyword reads as it always has (R43)", () => {
  assert.equal(googleLine({ google_rank: 4 }), "Google #4");
  assert.equal(googleLine({ google_rank: null }), "Not in Google top 20");
  assert.equal(googleLine({ google_rank: 4, target_keyword: "  " }), "Google #4");
});

test("googleLine: a derived keyword reads keyword - volume/mo - rank (R43)", () => {
  const kw = "business cash flow finance providers";
  assert.equal(
    googleLine({ google_rank: 3, target_keyword: kw, search_volume: 480, keyword_rank: null }),
    kw + " - 480/mo - not in top 20",
  );
  assert.equal(googleLine({ google_rank: null, target_keyword: kw, search_volume: 12100, keyword_rank: 7 }), kw + " - 12,100/mo - Google #7");
  // No volume read: the clause drops rather than claiming zero.
  assert.equal(googleLine({ google_rank: null, target_keyword: kw, search_volume: null, keyword_rank: 2 }), kw + " - Google #2");
});

test("googleLine: a single-digit volume is never printed as a measurement (R43)", () => {
  for (const v of [0, 3, 7, 9]) {
    assert.equal(googleLine({ google_rank: null, target_keyword: "seo agencies", search_volume: v, keyword_rank: null }), "seo agencies - under 10/mo - not in top 20");
  }
  assert.equal(googleLine({ google_rank: null, target_keyword: "seo agencies", search_volume: 10, keyword_rank: null }), "seo agencies - 10/mo - not in top 20");
});

test("S1: a scan from before C1 has no cluster section, and never reads as one that looked and found nothing", () => {
  assert.equal(clusterState({}), null);
  assert.equal(clusterState({ cluster_keyword: null }), null);
  assert.equal(clusterRank({ cluster_keyword: null }), "-");
});

test("S1: chosen shows the keyword's rank, a missing rank is the depth read's words, never a zero", () => {
  const c = { status: "chosen" as const, keyword: "invoicing software", volume: 1900, intent: "commercial", rank: 9 };
  assert.equal(clusterState({ cluster_keyword: c }), "chosen");
  assert.equal(clusterRank({ cluster_keyword: c }), "#9");
  assert.match(clusterRank({ cluster_keyword: { ...c, rank: null } }), /^Not in top \d+$/);
});

test("S1: none_qualified and read_failed draw the dashed node and a dash, whatever keyword text is left on the row", () => {
  for (const status of ["none_qualified", "read_failed"] as const) {
    const c = { status, keyword: "leftover", volume: 5, intent: "commercial", rank: 3 };
    assert.equal(clusterState({ cluster_keyword: c }), "none");
    assert.equal(clusterRank({ cluster_keyword: c }), "-");
  }
  assert.equal(clusterState({ cluster_keyword: { status: "chosen", keyword: " ", volume: null, intent: null, rank: null } }), "none");
});

test("S1: a prompt links solid to the keyword when any engine named the brand, dashed when none did", () => {
  assert.deepEqual(clusterLinks([question({ answered: 4, named: 2 }), question({ answered: 4, named: 0 }), question()]), [
    { named: true },
    { named: false },
    { named: false },
  ]);
});

test("S1 drawer head: the keyword's Google figure reads as a phrase, ranked or not", () => {
  const c = { status: "chosen" as const, keyword: "bookkeeping services small business", volume: 3600, intent: "commercial", rank: 9 };
  assert.equal(drawerKeywordLine({ cluster_keyword: c }), "keyword at Google #9");
  assert.equal(drawerKeywordLine({ cluster_keyword: { ...c, rank: null } }), "keyword not in Google's top 20");
  assert.equal(drawerKeywordLine({ cluster_keyword: { ...c, status: "none_qualified", keyword: null } }), "no keyword yet");
  assert.equal(drawerKeywordLine({ cluster_keyword: null }), "");
});

test("S1: the empty placements line says prompts on a cluster scan, questions on an older one", () => {
  assert.ok(placementCopy([], "prompts").includes("for these prompts,"));
  assert.ok(placementCopy([]).includes("for these questions,"));
  const sorted = [source("a.com", "competitor")];
  assert.ok(placementCopy(sorted, "prompts").includes("cited for these prompts either"));
});
