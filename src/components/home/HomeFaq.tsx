import { ALWAYS_ON, ALWAYS_ON_SUPPORT } from "@/config/always-on";
import { onlyIf } from "@/config/capabilities";
import { WAITLIST_LIMITS } from "@/config/contact";
import { FREE_ENGINE_COUNT, QUESTIONS } from "@/config/scan-shape";
import { PACK_CLUSTERS, PACK_KEYWORDS, PACK_PROMPTS, TRACKED_CLUSTERS, TRACKED_PROMPTS, TRACKING_PACK_PRICE } from "@/config/pricing";
import { MAX_CLUSTERS } from "@/config/sector-pricing";import { PROMPTS_PER_CLUSTER } from "@/lib/tracking/limits";
import { word } from "./EngineDemo";
import { CARD, GRID12, MICRO, SHELL, T } from "@/config/tokens";
import { ORG_REF, SITE_REF, ld } from "@/config/schema";
import Link from "next/link";
import SectionHead from "@/components/SectionHead";

/**
 * FAQ and the closing scan - HomeFaq.dc.html.
 *
 * The questions are <details>/<summary>, as on the board: open by default is
 * wrong for eight of them, and a disclosure that works without JavaScript is
 * better than an accordion that does not.
 *
 * The closing form is a plain GET to /scan, which is the no-JS path the app
 * already supports (/scan?domain=... prefills the hero). It deliberately does
 * not render a second LiveScanChecker: that component hardcodes
 * id="scan-email", so a second instance on this page would duplicate a DOM id
 * and break the label, and it would start a second independent scan.
 */

export type Faq = { q: string; hint: string; a: string };

export const FAQS: Faq[] = [
  {
    q: "If I am an agency, will you contact my client?",
    // 8 Oct 2026 (LB1): /legal publishes no agreement for "it is in the
    // agreement" to point at, so the hint says only what is true. The
    // branding sentence waits on a dashboard in the agency's brand.
    hint: "No",
    a:
      "No. Not for a case study, not for a testimonial, not after the engagement ends." +
      (onlyIf("dashboardBranding", " Every surface a client opens carries your branding, and the only place our name appears is on the invoice to you.") ?? ""),
  },
  {
    q: "Do I need links, or do mentions count?",
    hint: "Both, and they do different jobs",
    a: "An unlinked mention can get a brand named in an answer. Every placement we run carries at least a link to the brand; what moves the Google position most is a contextual link to a chosen page, and not every placement carries one. So the two measures can move separately, and we report them separately.",
  },
  {
    q: "How long before anything moves?",
    hint: "Weeks for a placement, longer for a position",
    a: "A placement is live in weeks. Citation usually follows the next time the engine reads the page. A Google position moves on its own schedule, and we report the two separately rather than averaging them into one number that hides which one changed.",
  },
  {
    q: "What happens when a placement gets old?",
    // Rewritten 27 Sep 2026 (pricing spec section 8): the always-on line and
    // its supporting sentence, word for word. The old answer asserted that
    // citation rates drift as articles age; the spec rules out any claim
    // about decay, so the answer is about the regularity of the work instead.
    hint: ALWAYS_ON.faq,
    a: `${ALWAYS_ON_SUPPORT} That is why the programme runs monthly rather than as a one-off campaign, and why the charts we show you have dips in them.`,
  },
  {
    q: "Can I resell this, and at what margin?",
    hint: "Your call entirely",
    a: "The prices on the packages page are what an agency pays us, not what their client pays them. We have no view on what you charge and no way of finding out. If you are the brand rather than the agency, the same prices apply and there is nothing to mark up.",
  },
  {
    q: "Do you use search volume?",
    hint: "On a keyword, never on the question",
    // Rewritten 27 Sep 2026 (Danny, R42): search volume returned at keyword
    // level. The September reading stays because it is still true and is the
    // reason the volume sits on a keyword rather than on the question. No
    // question count in it, for the reason the old comment gave: a live
    // constant would restate a past reading with a future number.
    a: "Not on the questions. What a buyer types into an engine is a sentence - eleven words, a budget, a constraint, a deadline - and search volume indexes keyword-shaped queries, so those return nothing: on a real scan we ran in September, every question came back at zero volume. So the questions stay the sentences buyers ask, and each one also gets the short Google keyword nearest it - \"business cash flow finance providers\" rather than the whole question - with its monthly searches and where you rank for it. A keyword can carry real volume where the sentence could not. Whether you were named in the answer is still the figure that changes what someone buys; the keyword says how much search sits behind the question.",
  },
  {
    q: "Then how do you choose which questions to track?",
    hint: "Backwards, from the decision",
    a: 'We start at the prompt someone types when they are ready to choose - "best X for a team of twelve moving off spreadsheets" - and work outwards to the questions sitting next to it. That is the opposite of keyword research, which starts at the biggest number and works down. Being named in the broadest question in your category is worth less than being named in the narrow one where somebody is deciding, and the broad one is far more crowded.',
  },
  {
    // Added 29 Sep 2026 (R115, danny.md line 107): tracking is sold as clusters.
    q: "What's a cluster?",
    hint: "One keyword and the prompts around it",
    a: `One Google keyword your buyers search, joined to the ${PROMPTS_PER_CLUSTER} prompts they ask AI about it - the category, your positioning, your sector, the outcome they want and a comparison. Every day we check the prompts on each engine and the keyword's Google position, side by side and never averaged. The tracking plan covers ${TRACKED_CLUSTERS} clusters, ${TRACKED_PROMPTS} prompts in all. The placement tiers are sold per cluster, and the cluster you track is the one you upgrade: up to ${MAX_CLUSTERS} clusters at checkout, more on a call. An extra tracking pack adds ${PACK_CLUSTERS} clusters (${PACK_PROMPTS} prompts, ${PACK_KEYWORDS} keywords) for $${TRACKING_PACK_PRICE.us} a month, or £${TRACKING_PACK_PRICE.uk} plus VAT in the UK.`,
    // The last two sentences added 30 Sep 2026 (R50, pricing spec section 8:
    // "say that more can be added" on the FAQ), folded in here rather than a
    // new entry, which would take the FAQ's .ac-row group past its stagger cap.
  },
  {
    q: "What if I already pay for a tracking tool?",
    hint: "Keep it if your team knows it",
    // ", which no tracking tool does" came off 8 Oct 2026 (LB7): an undated
    // claim about every competitor, which AGENTS.md bars without a dated source.
    a: "Most agencies that talk to us already pay for something. Our figures will not match theirs exactly - different prompt sets, different engines, different days - and where two tools disagree we report it rather than smooth it. What we add is the placements.",
  },
];

/**
 * FAQPage, built from the same array the page renders. The README has claimed
 * this schema was on the homepage for a while and it was not - only
 * /what-is-aeo carried one. Generating it from FAQS rather than hand-writing
 * it means the markup and the answers cannot drift apart, which is the usual
 * way this schema goes wrong.
 */
const faqSchema = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  isPartOf: SITE_REF,
  publisher: ORG_REF,
  mainEntity: FAQS.map((f) => ({
    "@type": "Question",
    name: f.q,
    acceptedAnswer: { "@type": "Answer", text: f.a },
  })),
};

export default function HomeFaq() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ld(faqSchema) }} />

      <section id="faq" style={{ ...SHELL, marginTop: "44px" }}>
        <SectionHead
          style={{ marginBottom: "16px" }}
          title="Questions we get asked"
          intro="Answered here rather than on a call, because the whole point is that you should not need one."
        />

        <div style={{ ...CARD, overflow: "hidden" }}>
          {FAQS.map((f) => (
            <details key={f.q} className="faq-row ac-row" style={{ borderBottom: `1px solid ${T.hair}`, scrollMarginTop: "24px" }}>
              <summary className="board-head faq-summary" style={{ ...GRID12, padding: "17px 26px", cursor: "pointer", lineHeight: 1.3 }}>
                <span style={{ gridColumn: "span 5", fontSize: "15px", fontWeight: 600, color: T.ink }}>{f.q}</span>
                <span style={{ gridColumn: "span 7", fontSize: "13.5px", color: T.soft }}>{f.hint}</span>
              </summary>
              <div className="board-head" style={{ ...GRID12, padding: "0 26px 20px" }}>
                <p style={{ gridColumn: "6 / span 7", margin: 0, fontSize: "14.5px", lineHeight: 1.7, color: T.soft }}>
                  {f.a}
                </p>
              </div>
            </details>
          ))}
        </div>
      </section>

      <section style={{ ...SHELL, marginTop: "34px" }}>
        <div className="board-head closing-scan ac-row" style={{ ...CARD, ...GRID12, alignItems: "center", padding: "34px 40px" }}>
          <div style={{ gridColumn: "span 6" }}>
            <h2 style={{ margin: 0, fontSize: "25px", fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1.22, color: T.ink }}>
              Pick a domain and find out.
            </h2>
            <p style={{ margin: "10px 0 0", fontSize: "14.5px", lineHeight: 1.6, color: T.soft }}>
              {/* The board's line, counted the way the hero counts it. */}
              {word(QUESTIONS)} buyer prompts, {word(FREE_ENGINE_COUNT).toLowerCase()} engines, every answer and every
              source it cited. It takes around two minutes, or we email you the result.
            </p>
          </div>

          {/* A GET to /scan, which prefills the hero checker. No second
              checker here - see the note at the top of this file. */}
          <form action="/scan" method="get" style={{ gridColumn: "span 6" }}>
            <label htmlFor="close-domain" style={{ ...MICRO, display: "block", marginBottom: "7px" }}>
              Domain
            </label>
            <div style={{ display: "flex", gap: "8px" }}>
              <input
                id="close-domain"
                name="domain"
                type="text"
                maxLength={WAITLIST_LIMITS.domain}
                inputMode="url"
                autoComplete="url"
                placeholder="yourdomain.com"
                style={{
                  flexGrow: 1,
                  minWidth: 0,
                  fontFamily: "inherit",
                  fontSize: "15px",
                  color: T.ink,
                  background: T.surface,
                  border: `1px solid ${T.line}`,
                  borderRadius: "10px",
                  padding: "13px 15px",
                }}
              />
              <button
                type="submit"
                style={{
                  fontFamily: "inherit",
                  fontSize: "15px",
                  fontWeight: 600,
                  color: "#ffffff",
                  background: T.accent,
                  border: 0,
                  borderRadius: "10px",
                  padding: "13px 26px",
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                Check
              </button>
            </div>
            <p style={{ margin: "10px 0 0", fontSize: "12.5px", color: T.soft }}>
              Or{" "}
              <Link href="/contact" style={{ fontWeight: 600, textDecoration: "none", color: T.accent }}>
                talk to a partner
              </Link>{" "}
              if you have a portfolio to move.
            </p>
          </form>
        </div>
      </section>
    </>
  );
}
