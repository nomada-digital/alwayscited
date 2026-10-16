import type { Metadata } from "next";
import { OG_IMAGE } from "@/config/og";
import Link from "next/link";
import SectionHead from "@/components/SectionHead";

import CoverageForm from "@/components/coverage/CoverageForm";
import { CARD, MICRO, SHELL, T } from "@/config/tokens";
import { FREE_ENGINE_COUNT, FREE_ENGINE_LABELS, listOf } from "@/config/scan-shape";
import { COVERAGE_PROMPT_COUNT, MAX_AGENCY_PROMPTS, PLACEHOLDER, coveragePrompts } from "@/lib/coverage/prompts";
import { MAX_COVERAGE_URLS } from "@/lib/coverage/csv";

/**
 * Every engine and question count on this page is derived, and it is derived
 * because all three of them were wrong.
 *
 * The board says "three engines" and its example data carries three, because
 * it was drawn before the backend had been decided. Danny then accepted the
 * six proposals on 20 September 2026, and proposal 4 was "the scan's own
 * engine set" - which is `FREE_ENGINES`, and has been four since 3586cbf moved
 * Perplexity into the free pass. `20260920010000_campaign_benchmark.sql` is
 * built on that answer in terms: a reading IS a scan row, so it inherits the
 * frozen engine set along with the ceilings and the citation tables. So the
 * page was promising a buyer fifteen answers from a thing that will return
 * twenty.
 *
 * The board is the source for the design, not for a number the backend now
 * owns - the same standing as its `[Client brand]` placeholders, which are
 * example data and stay example data.
 *
 * `src/config/copy.test.mts` used to say the engine count was out of scope
 * because it "shares its wording with the coverage checker's own three
 * engines, five questions - a different product with its own numbers". That
 * premise is what proposal 4 removed. There is one engine set on this site
 * now, so the rule is swept there like the others.
 */
const ANSWERS = COVERAGE_PROMPT_COUNT * FREE_ENGINE_COUNT;

export const metadata: Metadata = {
  title: "Free coverage check",
  description:
    `See which of your coverage the engines actually cite. ${COVERAGE_PROMPT_COUNT} questions - ours or your own - on the ${FREE_ENGINE_COUNT} engines a free scan reads, with each piece of coverage checked page by page. Dated and re-runnable.`,
  openGraph: { url: "https://alwayscited.com/coverage-check", images: OG_IMAGE },
  alternates: { canonical: "https://alwayscited.com/coverage-check" },
};

/**
 * CoverageCheck.dc.html, and it runs now.
 *
 * The board is a working tool: four inputs, a fixed question set, the scan's
 * engines, every cited source matched against an uploaded coverage list, and
 * the whole thing stored dated and re-runnable. All of that exists as of the
 * run path - `/api/coverage-check` inserts the campaign and its coverage list,
 * queues a reading as a scans row, and `runScan` asks the five fixed questions
 * because they are already on the row when it looks. The reading opens at
 * `/coverage-check/[token]`.
 *
 * The submit was stubbed here, visibly rather than as a silent no-op, for as
 * long as there was nothing behind it. What has not changed with the stub going
 * is the rule that kept the email field out: a reading opens on its own link,
 * so nothing is collected that we cannot use, and the address goes in when the
 * sending does - proposal 6, with its line in the privacy policy.
 *
 * The questions and the result figures below are the board's example data.
 * Placeholders stay placeholders - [Client brand], [the thing you announced]
 * - and the whole block is labelled, because a worked example on a marketing
 * page must not read as a measurement of anyone real.
 *
 * Open decisions are in docs/blocked.md, one question each.
 *
 * Motion: the board's acIn stagger and acStamp land on the question list, the
 * one thing on this page that is content rather than a control. acSweep is
 * deliberately not ported and stays that way now the form runs - it is an
 * infinite shimmer, and the boards' own rule is that a page's motion settles.
 * What is in flight lives on the reading at /coverage-check/[token], which
 * says so in words rather than by animating.
 */

/**
 * The five questions, rendered from the template the benchmark itself will
 * ask rather than from a copy of them kept here.
 *
 * They were listed twice - once as example copy on this page and, once the
 * backend existed, once in the code that runs them. That is the shape of the
 * bug this repo has already been bitten by, with the source classifier and the
 * brand extractor judging the same domain differently. Here it would have been
 * quieter and worse: the page advertising one set of questions and the
 * benchmark running another, with nothing ever failing.
 *
 * Danny accepted the fixed template on 20 September 2026. Filling it with the
 * placeholders is what makes this block a worked example rather than a
 * measurement of anyone real - the square brackets are deliberate and stay.
 */
const PROMPTS = coveragePrompts(PLACEHOLDER);

const PROMISES: { k: string; t: string; b: string }[] = [
  {
    k: "Recognition",
    t: "Do the engines know who the brand is",
    b: "Ask about the brand by name and see whether the answer is right, wrong, or about somebody else. Confusion with a similarly named company is more common than you would think, and it is invisible until you look.",
  },
  {
    k: "Evidence",
    t: "Is your coverage the source, or is a competitor",
    b: "Every AI answer is assembled from pages. Each URL you give us gets a row: cited as a page, cited as a publication but a different page on it, or not cited at all. Two of four being a competitor comparison page is a finding.",
  },
  {
    k: "A starting line",
    t: "Something to measure the next campaign against",
    b: "The reading is dated and stored with its questions, so the same ones can be asked again after the campaign. Without that first reading there is nothing to compare, which is why this one is free - one per client domain.",
  },
];

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

export default function CoverageCheckPage() {
  return (
    <div style={{ ...SHELL, paddingTop: "42px", paddingBottom: "44px", display: "flex", flexDirection: "column", gap: "26px" }}>
      {/* The form owns this grid since R140 part 5: step 2 replaces this
          introduction with the draft's own, in the confirm screen's layout. */}
      <CoverageForm
        intro={
        <div style={{ gridColumn: "span 7" }}>
          <div style={MICRO}>Free coverage check</div>
          <h1 style={{ margin: "10px 0 0", fontSize: "36px", fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1.18, color: T.ink }}>
            See which of your coverage the engines actually cite.{" "}
            <span style={{ color: T.accent }}>Before a campaign it is your baseline. After it, your proof.</span>
          </h1>
          <p style={{ margin: "14px 0 0", fontSize: "15px", lineHeight: 1.65, color: T.soft, maxWidth: "62ch" }}>
            Give us the client, up to {MAX_COVERAGE_URLS} coverage URLs and, if you have them, your own prompts. We
            ask {listOf(FREE_ENGINE_LABELS)} - the same engines a free scan reads - and tell you piece by piece
            whether they cited that page, the publication it is on, or neither, plus which sites they are citing
            instead. Dated, stored and re-runnable, so the next reading is a comparison rather than another snapshot.
          </p>
        </div>
        }
      />

      <section>
        <SectionHead
          style={{ marginBottom: "14px" }}
          title={<>These are the {COVERAGE_PROMPT_COUNT} we ask by default</>}
          intro={
            <>
            {/* This read "you would get to edit them before anything ran" while
            the form was a stub, describing a board rather than a build. The
            run path does not offer that, and a fixed set is the better
            promise anyway: a question that changes between two readings
            makes a change in the answer unreadable. */}
            Built from the brand and what you want the client referenced for, not from your headlines. Supply your
            own {MAX_AGENCY_PROMPTS} instead if you track a prompt set already - either way the wording is frozen onto
            the reading, so the same questions can be asked again after the campaign and the two compared.
            </>
          }
        />

        {/* CoverageCheck.dc.html staggers this list at .07s, where Journey
            uses .09s. The property inherits, so declaring it on the card is
            what makes every row inside it the board's own interval. */}
        <div style={{ ...CARD, overflow: "hidden", ["--ac-stagger" as string]: "0.07s" } as React.CSSProperties}>
          {PROMPTS.map((q, i) => (
            <div key={q.question} className="cc-prompt ac-row" style={{ padding: "14px 26px", borderTop: i ? `1px solid ${T.hair}` : undefined, alignItems: "baseline" }}>
              <div>
                <span className="ac-stamp" style={q.weak ? pill(T.warnBg, T.warnFg) : pill(T.chip, T.soft)}>{q.kind}</span>
              </div>
              <div style={{ fontSize: "14px", color: T.ink }}>{q.question}</div>
              <div style={{ fontSize: "12.5px", lineHeight: 1.5, color: T.soft }}>{q.why}</div>
            </div>
          ))}
          <p style={{ margin: 0, padding: "13px 26px", fontSize: "12.5px", color: T.soft, borderTop: `1px solid ${T.hair}` }}>
            {FREE_ENGINE_COUNT} engines, {COVERAGE_PROMPT_COUNT} questions, {ANSWERS} answers. Every source kept.
          </p>
        </div>
      </section>

      <section>
        <SectionHead
          style={{ marginBottom: "16px" }}
          title="Three things it tells you"
          intro={
            <>
            All three are readable today, from what is published. None of them needs a tag on the client&apos;s site,
            and none of them claims the campaign caused anything.
            </>
          }
        />

        <div className="three-up">
          {PROMISES.map((p) => (
            <div key={p.k} style={{ ...CARD, padding: "24px" }}>
              <div style={{ ...MICRO, color: T.accent }}>{p.k}</div>
              <div style={{ fontSize: "15.5px", fontWeight: 600, marginTop: "9px", lineHeight: 1.35, color: T.ink }}>{p.t}</div>
              <p style={{ margin: "9px 0 0", fontSize: "13.5px", lineHeight: 1.6, color: T.soft }}>{p.b}</p>
            </div>
          ))}
        </div>
      </section>

      <p style={{ margin: 0, fontSize: "13.5px", lineHeight: 1.65, color: T.soft }}>
        Built for PR teams who are tired of reporting reach.{" "}
        <Link href="/pr-agencies" style={{ fontWeight: 600, textDecoration: "none", color: T.accent }}>
          See how agencies use it
        </Link>
      </p>
    </div>
  );
}
