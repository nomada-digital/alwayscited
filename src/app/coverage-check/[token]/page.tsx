import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Fragment } from "react";

import ReadingPoll from "@/components/coverage/ReadingPoll";
import TierName from "@/components/TierName";
import WalkthroughForm from "@/components/scan/WalkthroughForm";
import RerunButton from "@/components/coverage/RerunButton";
import { CARD, GRID12, H2, MICRO, SHELL, T } from "@/config/tokens";
import { COVERAGE_PROMPT_COUNT } from "@/lib/coverage/prompts";
import { visitorReason } from "@/lib/coverage/reading-error";
import { readCampaign, type ReadingAnswer } from "@/lib/coverage/reading";
import { countNamed, type ReadingQuestion } from "@/lib/coverage/reading-figures";
import { canRerun, readingState, shouldPoll } from "@/lib/coverage/reading-state";
import { count, isAre } from "@/lib/plural";
import { ENGINE_SPECS } from "@/lib/scan/engines";
import { readWalkthroughOutcome } from "@/lib/scan/walkthrough-outcome";

/**
 * A campaign reading, by its link.
 *
 * Not indexed. Every one of these is somebody's own campaign, with a client
 * brand and an uploaded coverage list on it.
 */
export const metadata: Metadata = {
  title: "Coverage check",
  robots: { index: false, follow: false },
};

/**
 * The reading.
 *
 * Every number here is counted in `readCampaign` from stored rows, and none of
 * them is typed - including the engine count, which is the reading's own frozen
 * list rather than today's settings. A reading taken in March has to keep
 * describing the run that produced it, however the free scan's engine set moves
 * afterwards. `copy.test.mts` sweeps for a literal count in front of "engines"
 * across the tree, which is what stopped this page's parent advertising three
 * of them for a thing that returns four.
 *
 * Motion: the board's one beat, on the question list, which is the real content
 * here. Nothing loops and nothing important is hidden at rest.
 */

const pill = (bg: string, fg: string): React.CSSProperties => ({
  fontSize: "11px",
  fontWeight: 600,
  padding: "3px 10px",
  borderRadius: "999px",
  background: bg,
  color: fg,
  display: "inline-block",
  whiteSpace: "nowrap",
});

/**
 * One engine's verdict on one question.
 *
 * Three states, and the word is the signal. Colour is never the only way to
 * tell them apart - the same rule the tier names carry - so each chip names the
 * engine and says what it did, and would still read correctly in greyscale.
 *
 * "Did not answer" is its own state rather than being folded into "not named".
 * They are different findings: one is a measured absence of the brand from an
 * answer that exists, the other is an answer we never got, and a reading that
 * merged them would report the second as the first.
 */
function verdict(a: ReadingAnswer) {
  const label = ENGINE_SPECS[a.engine].label;
  if (!a.answered) return { label, word: "no answer", bg: T.chip, fg: T.soft };
  if (a.brandNamed) return { label, word: "named", bg: T.goodBg, fg: T.goodFg };
  return { label, word: "not named", bg: T.badBg, fg: T.badFg };
}

function dateOf(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

/**
 * The time, shown only when the date alone would not tell two readings apart.
 *
 * Two readings of one campaign on one day is not a hypothetical - it is what a
 * re-run after a failed pass looks like, and what the first live test of this
 * page produced: two rows both reading "20 September 2026", with different
 * findings and nothing to say which was which. The date is what matters for a
 * benchmark, so it stays the label; the time is added only where it is needed
 * to disambiguate.
 */
/** "26 Sep" - the baseline cell's figure. The full date is in the header. */
function shortDateOf(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" }).replace("Sept", "Sep");
}

const BASELINE_FIGURE: React.CSSProperties = {
  fontSize: "32px",
  fontWeight: 700,
  letterSpacing: "-0.035em",
  lineHeight: 1.1,
  marginTop: "2px",
  color: T.ink,
};
const BASELINE_NOTE: React.CSSProperties = { margin: "5px 0 0", fontSize: "12.5px", lineHeight: 1.5, color: T.soft };

/**
 * One question's named figure, in the board's three pill colours: every
 * engine, some, none. Counted by `countNamed` over that one row, so its
 * denominator is what was asked, the same as the headline's.
 */
function namedPill(q: ReadingQuestion) {
  const n = countNamed([q]);
  const tone = n.count === 0 ? [T.badBg, T.badFg] : n.count === n.of ? [T.goodBg, T.goodFg] : [T.warnBg, T.warnFg];
  return { text: `${n.count} of ${n.of}`, bg: tone[0], fg: tone[1] };
}

function timeOf(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

export default async function CampaignReadingPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { token } = await params;
  const walkthrough = readWalkthroughOutcome((await searchParams).walkthrough);

  const data = await readCampaign(token);
  if (!data) notFound();

  const { campaign, reading, questions, sources, coverage, pieces, named, history } = data;
  /**
   * Exactly one of four states - see `reading-state.ts` for what used to be
   * wrong with three and a fall-through.
   */
  const state = readingState(reading?.status ?? null);
  const running = state === "running";
  const failed = state === "failed";
  const complete = state === "complete";
  const stalled = state === "stalled";
  /** Nothing measured on this campaign yet: the one reading never started, or stopped before it finished. */
  const firstTry = (stalled || failed) && history.length <= 1;

  const engineCount = reading?.engines.length ?? 0;
  const placedSources = sources.filter((s) => s.placed);
  const citedPieces = pieces.filter((p) => p.pageEngines.length > 0).length;

  /**
   * What the source list actually shows.
   *
   * The first real reading cited 111 distinct domains across 210 citations,
   * and 83 of those were cited exactly once. Printing all of them is honest and
   * unreadable - a PR lead scrolls past eighty single-citation rows looking for
   * their own coverage, which is the one thing they came for.
   *
   * So the cut is by weight, not by an arbitrary top-N: everything cited more
   * than once, plus every placed domain whatever its count, and the remainder
   * named as a number underneath. Nothing is hidden from a crawler that matters
   * - the tail is one citation each and the count of it is on the page - and a
   * placement can never fall off the list, which is the case where a cut would
   * have changed what the reading says.
   */
  const SHOW_BELOW = 2;
  const shown = sources.filter((s) => s.citations >= SHOW_BELOW || s.placed);
  const tail = sources.length - shown.length;

  return (
    <div
      style={{
        ...SHELL,
        paddingTop: "42px",
        paddingBottom: "44px",
        display: "flex",
        flexDirection: "column",
        gap: "26px",
      }}
    >
      {shouldPoll(state) && <ReadingPoll />}

      <div className="board-head" style={{ ...GRID12, alignItems: "start" }}>
        <div style={{ gridColumn: "span 8" }}>
          <div style={MICRO}>Coverage check</div>
          <h1
            style={{
              margin: "10px 0 0",
              fontSize: "36px",
              fontWeight: 700,
              letterSpacing: "-0.03em",
              lineHeight: 1.18,
              color: T.ink,
            }}
          >
            {campaign.brand}, on {campaign.topic}
          </h1>
          <p style={{ margin: "14px 0 0", fontSize: "15px", lineHeight: 1.65, color: T.soft, maxWidth: "62ch" }}>
            {campaign.domain} &middot; {campaign.market}
            {reading?.completedAt ? ` · read ${dateOf(reading.completedAt)}` : ""}
          </p>
        </div>

        {!complete && (
        <div style={{ ...CARD, gridColumn: "span 4", padding: "20px" }}>
          <div style={MICRO}>Where the brand stands</div>
            <p style={{ margin: "8px 0 0", fontSize: "13px", lineHeight: 1.55, color: T.soft }}>
              {/* "Fills in on its own" is only true while something is actually
                  running. It was shown in every non-complete state, including
                  failed and stalled - both of which mount no poll, so the page
                  sat there promising a refresh that was never coming. */}
              {running
                ? "The reading is not in yet. This page fills in on its own."
                : failed
                  ? "That reading stopped before it finished, so there is nothing measured to show."
                  : "This reading never started, so there is nothing to show yet."}
            </p>
        </div>
        )}
      </div>

      {/* The board's baseline, stated as a baseline: three cells in one
          accent-edged card. The middle cell counts pieces cited as a page and
          nothing looser - a publication-only citation is its own state further
          down, and folding it in here would call a placement cited when what
          was cited was another page on the same title. */}
      {complete && (
        <div className="cc-baseline" style={{ ...CARD, borderColor: T.accent, overflow: "hidden" }}>
          <div>
            <div style={{ fontSize: "13px", color: T.soft }}>Named</div>
            <div style={BASELINE_FIGURE}>
              {named.count} of {named.of}
            </div>
            <p style={BASELINE_NOTE}>
              Answers naming {campaign.brand}, across {count(questions.length, "question")} on{" "}
              {count(engineCount, "engine")}. A measured zero is a finding, not a blank.
            </p>
          </div>
          <div>
            <div style={{ fontSize: "13px", color: T.soft }}>Your coverage cited</div>
            <div style={{ ...BASELINE_FIGURE, color: T.accent }}>
              {pieces.length > 0 ? `${citedPieces} of ${pieces.length}` : "No list"}
            </div>
            <p style={BASELINE_NOTE}>
              {pieces.length > 0
                ? "Pieces you gave us that an engine cited as a page."
                : "No coverage was uploaded with this campaign, so nothing is marked as yours."}
            </p>
          </div>
          <div>
            <div style={{ fontSize: "13px", color: T.soft }}>Reading taken</div>
            <div style={BASELINE_FIGURE}>{shortDateOf(reading?.completedAt ?? null)}</div>
            <p style={BASELINE_NOTE}>Stored with the questions and every source, so it can be re-run identically.</p>
          </div>
        </div>
      )}

      {running && (
        <div style={{ ...CARD, padding: "20px 24px", background: T.wash, borderColor: T.washLine }}>
          <div style={{ fontSize: "14px", fontWeight: 600, color: T.ink }}>Reading now</div>
          <p style={{ margin: "6px 0 0", fontSize: "13.5px", lineHeight: 1.6, color: T.soft }}>
            {count(questions.length || 0, "question")} on {count(engineCount, "engine")}, and every source they cite.
            It takes a couple of minutes. The link is yours - it keeps working, so you can close this and come back.
          </p>
        </div>
      )}

      {failed && (
        <div style={{ ...CARD, padding: "20px 24px", background: T.badBg, borderColor: T.badLine }}>
          <div style={{ fontSize: "14px", fontWeight: 600, color: T.badFg }}>That reading stopped before it finished</div>
          <p style={{ margin: "6px 0 0", fontSize: "13.5px", lineHeight: 1.6, color: T.soft }}>
            {/* A benchmark that failed for a reason we can name and does not name
                it sends the reader to guess at their own campaign - so the
                reason is still printed. What is not printed is the column: it
                held whatever was thrown, and this page asks for no credential.
                `visitorReason` carries the whole argument. */}
            {visitorReason(reading?.error)} Nothing was measured, so there is nothing
            here to read against. The button below takes a fresh reading of this same campaign - your uploaded
            coverage list is still on it, so there is nothing to re-enter.
          </p>
        </div>
      )}

      {stalled && (
        <div style={{ ...CARD, padding: "20px 24px", background: T.badBg, borderColor: T.badLine }}>
          <div style={{ fontSize: "14px", fontWeight: 600, color: T.badFg }}>That reading never got started</div>
          <p style={{ margin: "6px 0 0", fontSize: "13.5px", lineHeight: 1.6, color: T.soft }}>
            Something went wrong while we were setting it up, so no questions were ever asked. Nothing was spent and
            nothing was measured. The button below takes a fresh reading of this same campaign - your uploaded coverage
            list is still on it, so there is nothing to re-enter.
          </p>
        </div>
      )}

      {complete && (
        <section>
          <div className="board-head" style={{ ...GRID12, marginBottom: "14px" }}>
            <h2 style={{ ...H2, gridColumn: "span 4" }}>What each engine said</h2>
            <p style={{ gridColumn: "span 8", margin: 0, fontSize: "14px", lineHeight: 1.6, color: T.soft }}>
              The same {count(questions.length, "question")} will be asked again after the campaign, unchanged, so
              the next reading is a comparison rather than another snapshot.
            </p>
          </div>

          <div style={{ ...CARD, overflow: "hidden", ["--ac-stagger" as string]: "0.07s" } as React.CSSProperties}>
            {questions.map((q, i) => (
              <div
                key={q.question}
                className="ac-row"
                style={{ padding: "16px 26px", borderTop: i ? `1px solid ${T.hair}` : undefined }}
              >
                <div style={{ display: "flex", gap: "10px", alignItems: "baseline", flexWrap: "wrap" }}>
                  {/* Stored lowercase; the board writes the kind capitalised.
                      The news question is the weak one, flagged as on the
                      landing page. */}
                  <span
                    style={{
                      ...(q.kind.toLowerCase() === "news" ? pill(T.warnBg, T.warnFg) : pill(T.chip, T.soft)),
                      textTransform: "capitalize",
                    }}
                  >
                    {q.kind}
                  </span>
                  <span style={{ fontSize: "14.5px", color: T.ink, flex: "1 1 240px" }}>{q.question}</span>
                  {(() => {
                    const n = namedPill(q);
                    return (
                      <span className="ac-stamp" style={pill(n.bg, n.fg)}>
                        named {n.text}
                      </span>
                    );
                  })()}
                </div>
                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "10px" }}>
                  {q.answers.map((a) => {
                    const v = verdict(a);
                    return (
                      <span key={a.engine} style={pill(v.bg, v.fg)}>
                        {v.label}: {v.word}
                      </span>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* The piece-by-piece reading, which is the finding a PR agency came
          for. Above the domain-level list because "did they cite the thing I
          placed" is a different question from "what are they citing", and it
          is the one that was asked.

          Two columns, never summed: an engine that cited the page is a
          stronger claim than one that cited the publication, and collapsing
          them would tell somebody their placement was cited when what was
          cited was a five-year-old article on the same title. `pieces.ts`
          keeps them apart and its tests hold them apart.

          Nothing here is phrased as an effect. One reading has no before, so
          a cited placement is a fact about this reading and not evidence the
          placement caused anything. */}
      {complete && pieces.length > 0 && (
        <section>
          <div className="board-head" style={{ ...GRID12, marginBottom: "14px" }}>
            <h2 style={{ ...H2, gridColumn: "span 4" }}>Your coverage, piece by piece</h2>
            <p style={{ gridColumn: "span 8", margin: 0, fontSize: "14px", lineHeight: 1.6, color: T.soft }}>
              For each URL you gave us, whether an engine cited that page, or the publication it is on, or neither -
              on these {count(questions.length, "question")}. This is one reading, so it says what is true now and
              nothing about what the coverage moved.
            </p>
          </div>

          <div style={{ ...CARD, overflow: "hidden" }}>
            {pieces.map((piece, i) => {
              const cited = piece.pageEngines.length > 0;
              const onTitle = piece.publicationEngines.length > 0;
              return (
                <div
                  key={piece.url}
                  style={{ padding: "14px 26px", borderTop: i ? `1px solid ${T.hair}` : undefined }}
                >
                  <div style={{ display: "flex", alignItems: "baseline", gap: "10px", flexWrap: "wrap" }}>
                    <span style={{ fontSize: "13px", color: T.ink, fontWeight: 600 }}>{piece.domain}</span>
                    <span
                      style={pill(
                        cited ? T.goodBg : onTitle ? T.warnBg : T.chip,
                        cited ? T.goodFg : onTitle ? T.warnFg : T.soft,
                      )}
                    >
                      {cited ? "page cited" : onTitle ? "publication cited" : "not cited"}
                    </span>
                  </div>
                  {/* R151 (3 Oct 2026): break-all split "launch" at 320; the address now breaks after a slash or dot, and mid-word only when one piece will not fit. */}
                  <p style={{ margin: "5px 0 0", fontSize: "12.5px", color: T.soft, lineHeight: 1.5, overflowWrap: "anywhere" }}>
                    {piece.url.split(/(?<=[./])/).map((part, i) => (i ? <Fragment key={i}><wbr />{part}</Fragment> : part))}
                  </p>
                  <p style={{ margin: "7px 0 0", fontSize: "12.5px", color: T.soft, lineHeight: 1.55 }}>
                    {cited
                      ? // R151 (3 Oct 2026): an engine that cited another page on the same
                        // title was dropped here once the page itself was cited.
                        `Cited by ${piece.pageEngines.map((e) => ENGINE_SPECS[e].label).join(", ")}.` +
                        (onTitle
                          ? ` ${piece.publicationEngines.map((e) => ENGINE_SPECS[e].label).join(", ")} cited a different page on it.`
                          : "")
                      : onTitle
                        ? `${piece.publicationEngines.map((e) => ENGINE_SPECS[e].label).join(", ")} cited ${piece.domain}, but a different page on it.`
                        : "No engine cited this page or this publication on these questions."}
                  </p>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {complete && (
        <section>
          <div className="board-head" style={{ ...GRID12, marginBottom: "14px" }}>
            <h2 style={{ ...H2, gridColumn: "span 4" }}>Which pages built those answers</h2>
            <p style={{ gridColumn: "span 8", margin: 0, fontSize: "14px", lineHeight: 1.6, color: T.soft }}>
              {coverage.uploaded > 0 ? (
                <>
                  {coverage.cited} of {count(coverage.uploaded, "domain")} you uploaded {isAre(coverage.cited)} among
                  them. A placement nothing cited is not a failed placement - it is one the engines have not read yet,
                  which is what the next reading measures.
                </>
              ) : (
                <>
                  No coverage list was uploaded with this campaign, so nothing here is marked as yours. Upload one on
                  the next reading and every source below is matched against it.
                </>
              )}
            </p>
          </div>

          <div style={{ ...CARD, overflow: "hidden" }}>
            {sources.length === 0 && (
              <p style={{ margin: 0, padding: "16px 26px", fontSize: "14px", color: T.soft }}>
                No engine cited a source on any of these answers. That is a measurement, not a gap in the report:
                every one of them answered from what it already held.
              </p>
            )}
            {shown.map((s, i) => (
              <div
                key={s.domain}
                style={{
                  padding: "12px 26px",
                  borderTop: i ? `1px solid ${T.hair}` : undefined,
                  display: "flex",
                  alignItems: "baseline",
                  gap: "12px",
                  justifyContent: "space-between",
                  flexWrap: "wrap",
                }}
              >
                <span style={{ fontSize: "14px", color: T.ink }}>
                  {s.domain}
                  {s.placed && (
                    <span style={{ ...pill(T.goodBg, T.goodFg), marginLeft: "10px" }}>yours</span>
                  )}
                </span>
                <span style={{ fontSize: "12.5px", color: T.soft }}>
                  cited in {count(s.citations, "answer")}
                </span>
              </div>
            ))}
            {sources.length > 0 && (
              <p
                style={{
                  margin: 0,
                  padding: "13px 26px",
                  fontSize: "12.5px",
                  color: T.soft,
                  borderTop: `1px solid ${T.hair}`,
                }}
              >
                {/* One string rather than adjacent expressions. JSX collapses
                    the newline between two of them to a space, which put a
                    space in front of the full stop on the first reading that
                    had a tail. */}
                {`${count(sources.length, "source")} in all, ${placedSources.length} from your coverage` +
                  // R151 (3 Oct 2026): "1 more cited once each" on a tail of one.
                  (tail > 0 ? `. ${tail === 1 ? "1 more, cited once, not listed." : `${tail} more cited once each, not listed.`}` : ".")}
                {placedSources.length > 0 && (
                  <>
                    {" "}
                    A source is matched on its domain, so a page on a large host - a networking site, a wire service -
                    counts as yours even when the page the engine cited is somebody else&apos;s.
                  </>
                )}
              </p>
            )}
          </div>

          {coverage.uncited.length > 0 && (
            <div style={{ ...CARD, marginTop: "14px", padding: "18px 24px" }}>
              <div style={MICRO}>Uploaded, not yet cited</div>
              <p style={{ margin: "8px 0 0", fontSize: "13.5px", lineHeight: 1.6, color: T.soft }}>
                {coverage.uncited.join(", ")}
              </p>
            </div>
          )}
        </section>
      )}

      {/* The one call to action, and the same one the scan report makes.

          alwaystracked is what this reading is a sample of: the dashboards do
          per-placement ranking impact mapped against when each piece went
          live, AI visibility on the agency's own prompts, and which
          publications actually get cited. None of that is in a free reading
          and the copy below must never imply it is - a reading is one dated
          measurement with no before.

          The before-and-after mapping carries [VERIFY]: it is a claim about
          what alwaystracked does, and nobody has stood a dated source behind
          it yet. */}
      {complete && reading?.scanToken && (
        <section>
          <div className="board-head" style={{ ...GRID12, marginBottom: "14px" }}>
            <h2 style={{ ...H2, gridColumn: "span 4" }}>
              Did my coverage move rankings and AI visibility?
            </h2>
            <p style={{ gridColumn: "span 8", margin: 0, fontSize: "14px", lineHeight: 1.6, color: T.soft }}>
              This reading answers half of it: who the engines name today, and whether your placements are among the
              sources. The half it cannot answer is what changed, because it is one reading and there is nothing
              before it to compare against. That is what <TierName tier="tracked" /> is for.
            </p>
          </div>

          <div style={{ ...CARD, padding: "20px 24px" }}>
            <div style={{ display: "grid", gap: "12px" }}>
              {[
                {
                  t: "Upload placements and coverage",
                  b: "The same list you gave this reading, kept as the campaign runs rather than re-uploaded each time.",
                },
                {
                  t: "Ranking impact, mapped to when each piece went live",
                  b: "Before and after, per the link in the coverage, against the date the placement landed. [VERIFY]",
                },
                {
                  t: "AI visibility on your own prompts",
                  b: "Your prompts, asked on a schedule, and whether the placements move them.",
                },
                {
                  t: "Publications to target",
                  b: "Not every publication gets cited. Which ones do, in your client's category, is a KPI you can take to them.",
                },
              ].map((row) => (
                <div key={row.t} style={{ borderTop: "1px solid " + T.line, paddingTop: "12px" }}>
                  <div style={{ fontSize: "14px", fontWeight: 600, color: T.ink }}>{row.t}</div>
                  <p style={{ margin: "4px 0 0", fontSize: "13px", color: T.soft, lineHeight: 1.55 }}>{row.b}</p>
                </div>
              ))}
            </div>

            <p style={{ margin: "16px 0 0", fontSize: "13px", color: T.soft, lineHeight: 1.6 }}>
              It is set up per client rather than self-serve, so the quickest way to see it is a walkthrough of this
              reading.
            </p>
            <div style={{ marginTop: "14px" }}>
              <WalkthroughForm token={reading.scanToken} back={`/coverage-check/${token}`} outcome={walkthrough} market={campaign.market} />
            </div>
          </div>
        </section>
      )}

      {/* Every state but a pass in flight, which is also exactly what the rerun
          route accepts. `stalled` is the point of the change: it is the only
          state where the re-run is the *only* thing that can move the page on,
          and it was the one state the button was hidden in. */}
      {/* R151 (3 Oct 2026): a first reading that failed measured nothing too, but read
          "After the campaign ... once the coverage has had time to land" over its retry. */}
      {canRerun(state) && (
        <section>
          <div className="board-head" style={{ ...GRID12, marginBottom: "14px" }}>
            <h2 style={{ ...H2, gridColumn: "span 4" }}>
              {firstTry
                ? "Take the first reading"
                : history.length > 1
                  ? "Every reading of this campaign"
                  : "After the campaign"}
            </h2>
            <p style={{ gridColumn: "span 8", margin: 0, fontSize: "14px", lineHeight: 1.6, color: T.soft }}>
              {firstTry
                ? "Nothing has been measured against this campaign yet. This asks the " +
                  // The reading's own rows, stored when it was made: an agency may have given 1-5 prompts of its own.
                  count(questions.length || COVERAGE_PROMPT_COUNT, "question") +
                  " for the first time and gives you the starting line the next reading is compared to."
                : history.length > 1
                  ? "Each one is kept as it was taken. A re-run writes a new reading and never edits an old one, which is what makes the first one worth having."
                  : "Run it again once the coverage has had time to land. The same questions, unchanged, against the same uploaded list - so what changed is the answer rather than the question."}
            </p>
          </div>

          <div style={{ marginBottom: history.length > 1 ? "14px" : 0 }}>
            <RerunButton
              token={token}
              primary={!complete}
              label={firstTry ? "Take the first reading" : "Take another reading"}
            />
          </div>
        </section>
      )}

      {history.length > 1 && (
        <section>
          <div style={{ ...CARD, overflow: "hidden" }}>
            {history.map((h, i) => (
              <div
                key={h.id}
                style={{
                  padding: "12px 26px",
                  borderTop: i ? `1px solid ${T.hair}` : undefined,
                  display: "flex",
                  justifyContent: "space-between",
                  gap: "12px",
                  flexWrap: "wrap",
                }}
              >
                <span style={{ fontSize: "14px", color: T.ink }}>
                  {h.takenAt
                    ? dateOf(h.takenAt) +
                      (history.filter((o) => o.takenAt && dateOf(o.takenAt) === dateOf(h.takenAt)).length > 1
                        ? `, ${timeOf(h.takenAt)}`
                        : "")
                    : h.status}
                </span>
                <span style={{ fontSize: "12.5px", color: T.soft }}>
                  {h.answers ? `named in ${h.named} of ${h.answers} answers` : "no answers stored"}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      <p style={{ margin: 0, fontSize: "13.5px", lineHeight: 1.65, color: T.soft }}>
        This is the free benchmark.{" "}
        <Link href="/#scan" style={{ fontWeight: 600, textDecoration: "none", color: T.accent }}>
          The full scan asks more
        </Link>{" "}
        - a generated question set across the whole category, the leaderboard, and where an article could be placed.
      </p>
    </div>
  );
}
