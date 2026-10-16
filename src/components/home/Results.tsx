import SectionHead from "@/components/SectionHead";
import TierName from "@/components/TierName";
import {
  CHATGPT_VISIBILITY,
  KEYWORD_EIGHT_WEEKS,
  KEYWORD_FOUR_MONTHS,
} from "@/config/client-results";
import { CARD, MICRO, SHELL, T } from "@/config/tokens";
import Link from "next/link";

/**
 * The evidence. No board covers this - the five homepage boards scope the
 * product and leave evidence to CaseStudies.dc.html - so it is restyled to
 * the tokens rather than removed. Taking the only proof off a sales page
 * because the design files did not happen to include it would be a
 * commercial change dressed up as a design one.
 *
 * The Vibe Retail figures now carry their windows. The #1 reading has a
 * dated source at last: Danny attested it on 19 Sep 2026 as the account
 * owner, which is what the figure was missing. It is shown as a four-month
 * reading beside the eight-week one rather than replacing it - the campaign
 * produced #4 in eight weeks and the keyword carried on climbing, and
 * collapsing the two would claim #1 in eight weeks, which is not what
 * happened.
 *
 * The "listicle went live in the morning" paragraph has gone, and so has the
 * heading above it, which was "One placement, one morning." An earlier pass
 * removed one of two word-for-word copies of that paragraph and kept the
 * other; this one removes the claim. It said the placement went live in the
 * morning and the AI Overview was citing it as the top source by that
 * evening - a claim about a client's result with no date, no tracker and no
 * name, which is the category AGENTS.md says carries [VERIFY] until there is
 * a dated source. The same sentence was cut from /how-it-works, /what-is-aeo
 * and the blog posts on 19 Sep; it survived here, on /case-studies and on the
 * case study itself, because those sweeps were scoped to the pages with no
 * board. The heading went with it because "one morning" made the same claim
 * in three words.
 *
 * The figures below are untouched - they carry windows and a dated
 * attestation, and they are not what was wrong.
 *
 * The Nomada provenance line is now at the end of the packages board.
 */

/**
 * Each figure carries its own window, because they are readings from
 * different dates and collapsing them would imply the #1 arrived in eight
 * weeks. The eight-week numbers are what the campaign produced; the #1 is a
 * later reading, attested by Danny as the account owner on 19 Sep 2026.
 *
 * Every label below interpolates its figure's own `scope`, so a row cannot be
 * written without the thing that makes its number a reading. That is not
 * tidiness: this panel is where the visibility figure was published as a bare
 * "0% to 25%" with no denominator anywhere on the homepage, while
 * `/case-studies` and the case study both said "of the tracked prompts" and
 * /about published the rule that a percentage without its denominator is not
 * a finding. The denominator was in a comment on this line instead of on the
 * page. See `config/client-results.ts`.
 */
const FACTS = [
  { label: `Money keyword, at ${KEYWORD_EIGHT_WEEKS.scope}`, val: KEYWORD_EIGHT_WEEKS.value },
  { label: `Money keyword, at ${KEYWORD_FOUR_MONTHS.scope}`, val: KEYWORD_FOUR_MONTHS.value },
  { label: `ChatGPT brand visibility, of the ${CHATGPT_VISIBILITY.scope}`, val: CHATGPT_VISIBILITY.value },
  // The AI Overview citation count was the fourth tile until 24 September
  // 2026. Danny took it off the case study rather than fill in the date and
  // the tracker the page was asking for, and a figure that is not good enough
  // for the page it belongs to is not good enough for the homepage either.
  // The constant keeps its attestation in client-results.ts; nothing prints
  // it, which client-results.test.mts holds.
];

export default function Results() {
  return (
    <section id="proof" style={{ ...SHELL, marginTop: "44px" }}>
      <SectionHead
        style={{ marginBottom: "16px" }}
        micro="Results"
        title="One placement, on a page already ranking."
        intro="One campaign, one placement. The eight-week readings are what it produced; the money keyword kept climbing after that."
      />

      <div style={{ ...CARD, padding: "24px 26px" }}>
        <p style={{ ...MICRO, color: T.accent, margin: 0 }}>Vibe Retail · US retail SaaS</p>

        <div style={{ marginTop: "14px" }}>
          {FACTS.map((f) => (
            <div
              key={f.label}
              className="ac-row"
              style={{
                display: "grid",
                gridTemplateColumns: "1fr auto",
                gap: "24px",
                alignItems: "baseline",
                padding: "11px 0",
                borderTop: `1px solid ${T.hair}`,
              }}
            >
              <span style={{ fontSize: "14px", color: T.soft }}>{f.label}</span>
              <span style={{ fontSize: "18px", fontWeight: 700, color: T.ink, letterSpacing: "-0.022em", fontVariantNumeric: "tabular-nums" }}>
                {f.val}
              </span>
            </div>
          ))}
        </div>

        <Link
          href="/case-studies/vibe-retail"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
            color: T.accent,
            fontWeight: 600,
            fontSize: "13.5px",
            textDecoration: "none",
            marginTop: "16px",
          }}
        >
          Read the full case study
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M3 8h10M9 3l5 5-5 5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </Link>
      </div>

      <div className="on-dark ac-row" style={{ background: T.ink, borderRadius: "18px", padding: "32px 40px", marginTop: "20px" }}>
        <p style={{ margin: 0, fontSize: "17px", fontWeight: 600, lineHeight: 1.55, letterSpacing: "-0.01em", color: "#ffffff", maxWidth: "680px" }}>
          &ldquo;The goal is not to get a link. The goal is to be inside the source that the buyer, Google, and AI all
          agree to trust.&rdquo;
        </p>
        {/* faint, not soft: this is the one dark ground on the page. The token
            file states the rule and gives the numbers - faint is 7.44 on
            #0f1115 and soft is 4.04, below AA - and the two other dark cards on
            the site (Packages' white-label block, TierJourney's step 4) already
            follow it. 37512ae swept 46 light-ground sites from faint to soft
            and never looked at the dark grounds, which is how this one kept a
            token that is correct everywhere else it appears. */}
        {/* The name is a lockup here, not a plain word. This attribution is
            visible body copy, which is the context TierName owns - the
            TIER_PLAIN form is for the ones that strip colour, and an
            attribution under a pull quote strips nothing. The dark ground is
            already handled: .on-dark lifts the accent to #a78bfa, which is
            6.98 on #0f1115 where #7C3AED would have been 3.34. The stem keeps
            the faint the comment above argues for. */}
        <p style={{ margin: "12px 0 0", fontSize: "13px", color: T.faint }}>
          - <TierName tier="cited" /> methodology
        </p>
      </div>
    </section>
  );
}
