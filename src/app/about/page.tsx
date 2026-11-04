import type { Metadata } from "next";
import Link from "next/link";
import { OG_IMAGE } from "@/config/og";

import TierName from "@/components/TierName";
import { BRAND, ORG_REF, SITE_REF, ld } from "@/config/schema";
import { FREE_ANSWERS, FREE_ENGINE_COUNT, QUESTIONS } from "@/config/scan-shape";
import { CARD, MICRO, SHELL, T } from "@/config/tokens";

/**
 * About, from About.dc.html.
 *
 * The measurement rules are the point of the page. Each one exists because it
 * caught a real error in a real client report, and they are the strongest
 * thing we can say about how this is built - stronger than any claim about
 * the team, which is why they sit above it.
 */

export const metadata: Metadata = {
  title: "About us | AI citation placements for agencies",
  description:
    "An agency built the tool it wanted, then sold it to other agencies. Run by the senior team at Nomada Digital, a B2B search agency in York.",
  alternates: { canonical: "https://alwayscited.com/about" },
  openGraph: {
    images: OG_IMAGE,
    title: "About " + BRAND,
    description:
      "An agency built the tool it wanted, then sold it to other agencies. Run by the senior team at Nomada Digital, York.",
    url: "https://alwayscited.com/about",
  },
};

const aboutSchema = {
  "@context": "https://schema.org",
  "@type": "AboutPage",
  name: "About " + BRAND,
  description:
    "An agency built the tool it wanted, then sold it to other agencies. Run by the senior team at Nomada Digital, a B2B search agency in York.",
  url: "https://alwayscited.com/about",
  isPartOf: SITE_REF,
  publisher: ORG_REF,
  about: ORG_REF,
};

/** The worked example in "Scope every claim": answers naming the brand. */
const EXAMPLE_NAMED = 6;

const RULES = [
  {
    title: "Unmeasured is excluded, never zero",
    body: "An engine that returns no answer is dropped from the denominator. Scoring it as a miss understates a position; averaging it in flatters one.",
  },
  {
    title: "Store the whole answer",
    body: "What each engine said, and the sources it used, are kept per question - so any figure can be read back to the words that produced it. They are kept for as long as the reading is, rather than purged on a schedule. A score nobody can audit is not evidence.",
  },
  {
    title: "Scope every claim",
    // The example is a count first and a percentage second, both from the scan
    // shape, so the two always agree. It used to print "24% of 20 answers",
    // which is 4.8 answers - a figure no reading can produce.
    body:
      '"AI visibility: ' +
      Math.round((EXAMPLE_NAMED / FREE_ANSWERS) * 100) +
      '%" reads as a total. We write "' +
      EXAMPLE_NAMED +
      " of " +
      FREE_ANSWERS +
      " answers, across " +
      QUESTIONS +
      " questions and " +
      FREE_ENGINE_COUNT +
      ' engines, read 18 Sep". A percentage without its denominator is not a finding.',
  },
  {
    title: "Say what is measured and what is inferred",
    body: "A reading taken from a chart or a screenshot is labelled as such. Solid lines and plain numbers mean measured. Where two tools disagree we report it rather than smooth it.",
  },
];

/**
 * The people, confirmed by Danny on 24 September 2026.
 *
 * First names only, and **nothing else**. He gave five names and no roles, no
 * titles and no bios, so five names is what goes on the page: inventing "Head
 * of" anything, or deciding which of them does the link building, would be
 * publishing a claim about a real person that nobody has stood behind. The
 * card used to carry four roles and a line saying the names were waiting; the
 * names have arrived and the roles were never his.
 */
const TEAM = ["Danny", "Kev", "Luke", "Amy", "Naz"];

export default function AboutPage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ld(aboutSchema) }} />

      <section style={{ ...SHELL, paddingTop: "44px", display: "flex", flexDirection: "column", gap: "30px" }}>
        <div className="confirm-top">
          <div>
            {/* The beat, from globals.css - leaf content, never the wrapper
                around it, so nothing animates twice. */}
            <div className="ac-row" style={MICRO}>Who runs this</div>
            <h1
              className="ac-row"
              style={{
                margin: "10px 0 0",
                fontSize: "36px",
                fontWeight: 700,
                letterSpacing: "-0.03em",
                lineHeight: 1.18,
                color: T.ink,
              }}
            >
              An agency built the tool it wanted, then sold it to other agencies.
            </h1>
            <p className="ac-row" style={{ margin: "14px 0 0", fontSize: "15px", lineHeight: 1.7, color: T.soft, maxWidth: "64ch" }}>
              <TierName tier="cited" /> is run by the senior team at{" "}
              <a
                href="https://nomadadigital.co.uk"
                style={{ fontWeight: 600, textDecoration: "none", color: T.ink }}
              >
                Nomada Digital
              </a>
              , a B2B search agency in York. We built the scan because we needed it for our own clients, and the
              placement side because measuring a gap we could not close was not worth charging for.
            </p>
          </div>

          <div className="ac-row" style={{ ...CARD, padding: "24px", alignSelf: "start" }}>
            <div style={MICRO}>Why agencies first</div>
            <p style={{ margin: "10px 0 0", fontSize: "14px", lineHeight: 1.7, color: T.soft }}>
              We are an agency, so we built this to be run by agencies, under their own name. That is the default,
              and the work is priced for it. A brand can come to us direct at the same prices; we do not go after
              the clients our partners already have.
            </p>
          </div>
        </div>

        <section>
          <div className="board-head confirm-head" style={{ marginBottom: "16px" }}>
            <h2 className="ac-row" style={{ margin: 0, fontSize: "19px", fontWeight: 700, letterSpacing: "-0.022em", color: T.ink }}>
              How we measure
            </h2>
            <p className="ac-row" style={{ margin: 0, fontSize: "14px", lineHeight: 1.6, color: T.soft }}>
              These rules exist because each one caught a real error in a real client report. They are the part worth
              carrying into anything we build.
            </p>
          </div>
          <div className="two-up">
            {RULES.map((r) => (
              <div key={r.title} className="ac-row" style={{ ...CARD, padding: "22px 24px" }}>
                <div style={{ fontSize: "14.5px", fontWeight: 600 }}>{r.title}</div>
                <p style={{ margin: "8px 0 0", fontSize: "14px", lineHeight: 1.65, color: T.soft }}>{r.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section>
          <div className="board-head confirm-head" style={{ marginBottom: "16px" }}>
            <h2 className="ac-row" style={{ margin: 0, fontSize: "19px", fontWeight: 700, letterSpacing: "-0.022em", color: T.ink }}>
              Who you deal with
            </h2>
            <p className="ac-row" style={{ margin: 0, fontSize: "14px", lineHeight: 1.6, color: T.soft }}>
              Small team, no account managers between you and the people doing the work.
            </p>
          </div>
          <div className="team-row" style={{ ...CARD, overflow: "hidden" }}>
            {TEAM.map((name) => (
              <div key={name} className="ac-row">
                <div style={{ fontSize: "14.5px", fontWeight: 600 }}>{name}</div>
              </div>
            ))}
          </div>
          {/* The board carried [CONFIRM which names go on a public page before
              this ships]. Danny confirmed the five on 24 September 2026, first
              names only. No role, title or bio is attached to any of them,
              because he gave none - and a plausible one written here would be
              a claim about a real person with nothing behind it. */}
          {/* The page ended on the team card with nothing in main to do next;
              About.dc.html has no closing either (R151, 3 Oct 2026). The tier
              pages' and case study's closing line, pointed at the rules above. */}
          <p className="ac-row" style={{ margin: "22px 0 0", fontSize: "13.5px", color: T.soft, lineHeight: 1.65 }}>
            Want these rules run on your own site?{" "}
            <Link href="/#scan" style={{ fontWeight: 600, textDecoration: "none", color: T.accent }}>
              Run the free scan
            </Link>
            .
          </p>
        </section>
      </section>
    </>
  );
}
