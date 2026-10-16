import type { Metadata } from "next";
import PageScanBox from "@/components/scan/PageScanBox";
import { OG_IMAGE } from "@/config/og";
import Link from "next/link";
import SectionHead from "@/components/SectionHead";

import EngineLogo from "@/components/EngineLogo";
import { D } from "@/components/home/dark";
import { onlyIf } from "@/config/capabilities";
import { TIERS, TRACKED_BASIS } from "@/config/pricing";
import { CARD, SHELL, T } from "@/config/tokens";

export const metadata: Metadata = {
  title: "For SEO agencies",
  // ", run white-label under your name" waits on a dashboard and sign-in mail
  // in the agency's brand (LB1, 8 Oct 2026); see the note below.
  description:
    "Sell AI visibility without building a second supply chain: placement on third-party pages, aimed at a different target list" +
    (onlyIf("dashboardBranding", ", run white-label under your name") ?? "") +
    ".",
  openGraph: { url: "https://alwayscited.com/seo-agencies", images: OG_IMAGE },
  alternates: { canonical: "https://alwayscited.com/seo-agencies" },
};

/**
 * SEOAgencies.dc.html (25 Sep 2026 read, Q13), including its beat: one
 * placement moving both the Google row and the answer.
 *
 * The argument the whole page rests on is "one placement, two jobs": the same
 * article Google reads as a link is the article the engines read as a source.
 * That is why it is not a second service for an agency to staff.
 *
 * What is painted is the settled state - Tallyroo at #3 on Google, "was #10",
 * and second in the ChatGPT answer with the placement as its source - so the
 * page reads the same with no JavaScript or reduced motion. The motion is one
 * pass, not the board's 10s loop: the two link lines draw on the homepage
 * charts' `.flow-line` trigger, and the Google rows and the answer take their
 * cue from the same line through `:has(.flow-line.in-view)` in globals.css.
 *
 * The entry price comes from src/config/pricing.ts, as everywhere else. The
 * scan box runs the scan in place through PageScanBox (R181, 2 Oct 2026); it
 * was a GET to /scan while LiveScanChecker hardcoded its field's id.
 *
 * 8 Oct 2026, LB1: "run white-label under your name" (the description, so the
 * OG card and /llms.txt too) and the hero's "and we run it under your name"
 * claimed what `/white-label` withholds: the dashboard draws our mark and the
 * alwaystracked name in every mode, the sign-in mail is "Your alwaystracked
 * login link", and outreach to publishers is ours by that page's own table.
 * Both clauses wait on `dashboardBranding` and come back in these words when
 * AG-2 ships. "Selling it under your own name?" at the foot is the agency's
 * own reselling, not a claim about our surfaces, and stays.
 */

const tracked = TIERS.find((t) => t.id === "tracked");

const QUESTIONS: { q: string; a: string }[] = [
  {
    q: "How long before anything moves?",
    a: "A placement is live in weeks. Citation usually follows the next time the engine reads the page. Google moves on its own schedule, and we report the two separately.",
  },
  {
    q: "Links, or do mentions count?",
    a: "An unlinked mention can get a brand named. Every placement we run carries at least a brand link; a contextual link to a chosen page is what moves the Google position most, and not every placement carries one - so we report the two separately.",
  },
  {
    q: "What do I resell this at?",
    a: "Your call. The packages page shows what you pay us, not what your client pays you.",
  },
];

/** The Google result, settled: Tallyroo has climbed into third. */
const SERP: { n: number; name: string; domain: string; you?: boolean; cls?: string }[] = [
  { n: 1, name: "Ledgerbird", domain: "ledgerbird.com" },
  { n: 2, name: "Stackbill", domain: "stackbill.io" },
  { n: 3, name: "Tallyroo", domain: "tallyroo.com", you: true, cls: "seo-climb" },
  { n: 4, name: "Pennywell", domain: "pennywell.com", cls: "seo-down" },
  { n: 5, name: "Billcraft", domain: "billcraft.app", cls: "seo-down" },
];

export default function SeoAgenciesPage() {
  const soft: React.CSSProperties = { color: T.soft };
  return (
    <div style={{ ...SHELL, paddingTop: "64px", paddingBottom: "64px" }}>
      <div className="seo-top">
        <div>
          <div style={{ fontSize: "13px", fontWeight: 600, color: T.soft }}>For SEO agencies</div>
          <h1 className="seo-h1" style={{ margin: "12px 0 0", fontSize: "50px", fontWeight: 700, letterSpacing: "-0.04em", lineHeight: 1.04, color: T.ink }}>
            Sell AI visibility without building a second supply chain.
          </h1>
          <p style={{ margin: "18px 0 0", fontSize: "17px", lineHeight: 1.55, color: T.soft, maxWidth: "54ch" }}>
            The work is placement on third-party pages, which you already do. It is aimed at a different target list
            {onlyIf("dashboardBranding", ", and we run it under your name")}.
          </p>
        </div>

        <div style={{ ...CARD, borderRadius: "18px", padding: "20px" }}>
          <div style={{ fontSize: "14px", fontWeight: 700, color: T.ink }}>Scan a client you already rank well for</div>
          <div style={{ fontSize: "13px", lineHeight: 1.5, color: T.soft, marginTop: "4px" }}>
            The gap between position 1 and being named is usually the surprise.
          </div>
          <PageScanBox id="seo-domain" label="Client domain" placeholder="clientdomain.com" />
        </div>
      </div>

      <section style={{ marginTop: "72px" }}>
        <SectionHead
          title="One placement, two jobs"
          titleStyle={{ fontSize: "28px", letterSpacing: "-0.03em" }}
          intro="The article Google reads as a link is the article the engines read as a source."
          introStyle={{ fontSize: "15px", lineHeight: 1.55 }}
        />

        <div className="seo-beat">
          <div style={{ ...CARD, borderRadius: "18px", padding: "20px 22px" }}>
            <div style={{ fontSize: "12px", color: T.soft }}>Google · best invoicing software for freelancers</div>
            <ol style={{ listStyle: "none", margin: "12px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: "4px" }}>
              {SERP.map((r) => (
                <li key={r.name} style={{ display: "flex", alignItems: "center", minHeight: "40px", fontSize: "13.5px" }}>
                  <span style={{ width: "34px", flexShrink: 0, fontSize: "13px", fontWeight: 700, color: T.soft }}>{r.n}</span>
                  <span
                    className={r.cls}
                    style={{
                      flexGrow: 1,
                      minWidth: 0,
                      display: "flex",
                      alignItems: "center",
                      // Wraps only under 1.4.12 spacing at 320, where "was #10" ran 5px out (R151).
                      flexWrap: "wrap",
                      gap: "10px",
                      minHeight: "40px",
                      borderRadius: "10px",
                      padding: r.you ? "0 10px" : "0 0 0 10px",
                      background: r.you ? T.wash : undefined,
                      position: "relative",
                      zIndex: r.you ? 1 : undefined,
                    }}
                  >
                    <span style={{ fontWeight: r.you ? 700 : 600, color: r.you ? T.accentHover : T.ink }}>{r.name}</span>
                    <span style={soft}>{r.domain}</span>
                    {r.you ? (
                      <span style={{ marginLeft: "auto", fontSize: "11.5px", fontWeight: 600, color: T.accentHover, whiteSpace: "nowrap" }}>was #10</span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ol>
          </div>

          <div className="seo-beat__mid">
            <svg className="seo-beat__wires" width="260" height="120" viewBox="0 0 260 120" fill="none" aria-hidden="true">
              <path className="flow-line" pathLength={1} d="M130 60 C 70 60, 60 30, 0 30" stroke={T.accent} strokeWidth="1.6" />
              <path className="flow-line" pathLength={1} d="M130 60 C 190 60, 200 90, 260 90" stroke={T.accent} strokeWidth="1.6" />
            </svg>
            <div style={{ position: "relative", background: T.ink, color: T.surface, borderRadius: "14px", padding: "14px 16px", width: "200px", boxSizing: "border-box" }}>
              <div style={{ fontSize: "11px", color: D.muted }}>Placement · solodesk.io</div>
              <div style={{ fontSize: "13.5px", fontWeight: 700, marginTop: "4px", lineHeight: 1.3 }}>The 9 best invoicing apps for freelancers</div>
              <div style={{ fontSize: "11px", color: D.caret, marginTop: "8px" }}>Link to tallyroo.com</div>
            </div>
          </div>

          <div style={{ background: D.ground, borderRadius: "18px", padding: "20px 22px", color: T.surface, minHeight: "304px", boxSizing: "border-box" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "7px", fontSize: "12px", color: D.muted }}>
              {/* The logo carries the engine; the word is dropped (Danny, 27 Sep, R46). */}
              <span style={{ color: T.surface, display: "flex" }}>
                <EngineLogo engine="chatgpt" size={14} title="ChatGPT" inline />
              </span>
              best invoicing software for freelancers
            </div>
            <div aria-hidden="true" style={{ height: "6px", background: D.bar, borderRadius: "3px", marginTop: "16px", width: "90%" }} />
            <div aria-hidden="true" style={{ height: "6px", background: D.bar, borderRadius: "3px", marginTop: "6px", width: "70%" }} />
            <div className="seo-answer" style={{ marginTop: "18px", fontSize: "14px", lineHeight: 2.1 }}>
              <div>1. Ledgerbird</div>
              <div style={{ background: D.card, border: "1px solid " + D.accent, color: T.surface, borderRadius: "6px", margin: "0 -8px", padding: "0 8px", fontWeight: 700 }}>
                2. Tallyroo
              </div>
              <div>3. Stackbill</div>
              <div style={{ marginTop: "14px", fontSize: "11.5px", color: D.muted, lineHeight: 1.5 }}>Sources</div>
              <div style={{ display: "inline-block", marginTop: "4px", fontSize: "11.5px", fontWeight: 600, color: D.cardHead, background: D.card, border: "1px solid " + D.cardLine, borderRadius: "999px", padding: "0 10px", lineHeight: 1.8 }}>
                solodesk.io
              </div>
            </div>
          </div>
        </div>
        <div className="seo-notes" style={{ color: T.soft }}>
          <span>Measured as a position, daily</span>
          <span>Illustrative. Every brand shown is made up.</span>
          <span>Measured across the cluster&apos;s prompts, every engine</span>
        </div>
      </section>

      <section style={{ marginTop: "80px" }}>
        <h2 style={{ margin: 0, fontSize: "28px", fontWeight: 700, letterSpacing: "-0.03em", color: T.ink }}>
          The three questions you are about to ask
        </h2>
        <div className="three-up" style={{ gap: "16px", marginTop: "22px" }}>
          {QUESTIONS.map((item) => (
            <div key={item.q} style={{ ...CARD, borderRadius: "16px", padding: "20px" }}>
              <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 700, color: T.ink }}>{item.q}</h3>
              <p style={{ margin: "8px 0 0", fontSize: "14px", lineHeight: 1.55, color: T.soft }}>{item.a}</p>
            </div>
          ))}
        </div>
        <p style={{ margin: "20px 0 0", fontSize: "14px", color: T.soft, lineHeight: 1.6 }}>
          <Link href="/packages" style={{ fontWeight: 600, textDecoration: "none", color: T.accent }}>
            See all packages
          </Link>
          {/* "a week" said something the other three surfaces did not: the basis
              is the same prompts checked daily, not new prompts every week. */}
          {tracked ? ` - ${tracked.priceLabel} for tracking alone, at ${TRACKED_BASIS}.` : "."}
        </p>
        <p style={{ margin: "8px 0 0", fontSize: "14px", color: T.soft, lineHeight: 1.6 }}>
          Selling it under your own name?{" "}
          <Link href="/white-label" style={{ fontWeight: 600, textDecoration: "none", color: T.accent }}>
            How the white-label arrangement works
          </Link>
        </p>
      </section>
    </div>
  );
}
