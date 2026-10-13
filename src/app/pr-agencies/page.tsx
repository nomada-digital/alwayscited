import type { Metadata } from "next";
import { OG_IMAGE } from "@/config/og";
import Link from "next/link";

import EngineLogo from "@/components/EngineLogo";
import TierName from "@/components/TierName";
import { D, WASH_PR } from "@/components/home/dark";
import { TIERS } from "@/config/pricing";
import { FREE_ANSWERS } from "@/config/scan-shape";
import { CARD, SHELL, T } from "@/config/tokens";
import { MAX_COVERAGE_URLS } from "@/lib/coverage/csv";
import { ENGINE_SPECS, type Engine } from "@/lib/scan/engines";

export const metadata: Metadata = {
  title: "For PR agencies",
  description:
    "You already place the coverage. We show you which of it the engines read, so a placement has a measurable outcome and the report says who got named.",
  openGraph: { url: "https://alwayscited.com/pr-agencies", images: OG_IMAGE },
  alternates: { canonical: "https://alwayscited.com/pr-agencies" },
};

/**
 * PRAgencies.dc.html (25 Sep 2026 read, Q12), including its beat: the
 * coverage fan-out on the dark hero.
 *
 * Four pieces of coverage on the left, three answers on the right, and the
 * lines between them: three pieces feed an answer, the regional one stops
 * short under "Read by no engine". The board loops the lines every 10s and
 * fades the pills in with them. Here the lines draw once on the homepage
 * charts' trigger (`.flow-line`, so reduced motion and no JavaScript get them
 * drawn), and the pills are simply there - nothing that holds text starts
 * invisible. The dead piece reads as dead without any motion: dimmer card,
 * no accent edge, a grey stub and the pill.
 *
 * The sitewide header stays; the board draws its own dark bar with a
 * "Check your coverage" button, which here is the dark card at the foot.
 */

const priceOf = (id: string) => TIERS.find((t) => t.id === id)?.priceLabel ?? "";
// The two priced cards led nowhere (R151, 3 Oct 2026): a buyer who read the
// price had no way to the plan. Not the coverage check's door, which stays one.
const hrefOf = (id: string) => TIERS.find((t) => t.id === id)!.href;
const planLink: React.CSSProperties = { fontWeight: 600, textDecoration: "none", color: T.accent };

const PIECES: { outlet: string; title: string; live: boolean }[] = [
  { outlet: "Trade title", title: "Tallyroo adds multi-currency invoicing", live: true },
  { outlet: "National", title: "The startups fixing freelancer pay", live: true },
  { outlet: "Regional press", title: "Leeds firm announces 40 roles", live: false },
  { outlet: "Vertical blog", title: "Why Tallyroo rebuilt onboarding", live: true },
];

const ANSWERS: { engine: Engine; kind: string; q: string }[] = [
  { engine: "chatgpt", kind: "brand question", q: "what does tallyroo do" },
  { engine: "gemini", kind: "category question", q: "best invoicing software for freelancers" },
  { engine: "perplexity", kind: "objection question", q: "is tallyroo easy to set up" },
];

/**
 * The example report line, counted rather than typed.
 *
 * The denominator was the literal 56 - question count times engine count,
 * the exact figure `config/scan-shape.ts` exists to own, typed into the one
 * sentence on this page that shows an agency what our reporting looks like.
 * Shorten the free pass and this page kept quoting a denominator no scan
 * produces, in the sentence it tells a PR director to take to their board.
 *
 * The numerator is a share of the denominator for the same reason, not to
 * claim precision: it is an illustration of the shape of the line, and the
 * one property that has to hold is that it stays a possible reading. Typed,
 * a 22 survives a free pass that drops below 22 answers and becomes
 * arithmetic nobody can get to.
 */
const EXAMPLE_NAMED = Math.round(FREE_ANSWERS * 0.4);

const CHANGES: { label: string; body: string }[] = [
  {
    label: "The target list",
    body: "The exact pages the engines build your client's answers from. The titles you already know move first.",
  },
  {
    label: "The report",
    body:
      '"Named in ' +
      EXAMPLE_NAMED +
      " of " +
      FREE_ANSWERS +
      ' AI answers, from none before the campaign" goes to a board. Reach and AVE do not.',
  },
  {
    label: "The retainer",
    body: "A measure that moves is a reason to continue. Placements decay, so replacing them is maintenance.",
  },
];

/* The board's 460x330 connector box: piece centres at 62/140/218/296 down the
   left, answer centres at 71/167/263 down the right. */
const WIRES = [
  "M0 62 C 200 62, 240 71, 460 71",
  "M0 140 C 220 140, 230 71, 460 71",
  "M0 140 C 220 140, 230 167, 460 167",
  "M0 296 C 220 296, 230 263, 460 263",
];

export default function PrAgenciesPage() {
  const label: React.CSSProperties = { fontSize: "12px", lineHeight: "17px", color: D.muted };
  return (
    <div>
      <section className="on-dark" style={{ background: WASH_PR + ", " + D.ground, color: T.surface, paddingBottom: "64px" }}>
        <div style={{ ...SHELL, paddingTop: "56px" }}>
          <div style={{ fontSize: "13px", fontWeight: 600, color: D.muted }}>For PR agencies</div>
          <h1 className="pr-h1" style={{ margin: "12px 0 0", fontSize: "54px", fontWeight: 700, letterSpacing: "-0.04em", lineHeight: 1.03, maxWidth: "20ch", color: T.surface }}>
            You already place the coverage. We show you which of it the engines read.
          </h1>
          <p style={{ margin: "18px 0 0", fontSize: "17px", lineHeight: 1.55, color: D.muted, maxWidth: "56ch" }}>
            AI answers give a placement a measurable outcome for the first time. The engines cite it and name your
            client, or they do not.
          </p>

          <div className="pr-fan">
            <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
              <div style={label}>Campaign coverage</div>
              {PIECES.map((c) => (
                <div
                  key={c.title}
                  style={{
                    background: D.card,
                    border: "1px solid " + (c.live ? D.accent : D.cardLine),
                    borderRadius: "14px",
                    padding: "12px 14px",
                    minHeight: "64px",
                    boxSizing: "border-box",
                    opacity: c.live ? 1 : 0.6,
                  }}
                >
                  <div style={{ fontSize: "11px", color: D.muted }}>{c.outlet}</div>
                  <div style={{ fontSize: "13.5px", fontWeight: 600, marginTop: "3px" }}>
                    {c.title}
                    {c.live ? null : <span className="pr-mob" style={{ color: D.muted, fontWeight: 500 }}> - read by no engine</span>}
                  </div>
                </div>
              ))}
            </div>

            <div className="pr-fan__wires" style={{ position: "relative" }} aria-hidden="true">
              <svg width="100%" height="330" viewBox="0 0 460 330" preserveAspectRatio="none" fill="none" style={{ position: "absolute", left: 0, top: 0 }}>
                {WIRES.map((d, i) => (
                  <path
                    key={d}
                    className={"flow-line" + (i === 0 ? "" : " flow-line--" + Math.min(i + 1, 3))}
                    pathLength={1}
                    d={d}
                    stroke={D.accent}
                    strokeWidth="1.6"
                  />
                ))}
                <path d="M0 218 C 60 218, 80 218, 110 218" stroke={D.quiet} strokeWidth="1.6" />
              </svg>
              <div style={{ position: "absolute", left: "124px", top: "204px", fontSize: "11.5px", fontWeight: 600, color: D.muted, background: D.bar, borderRadius: "999px", padding: "4px 10px" }}>
                Read by no engine
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
              <div style={label}>Answers it is now the source for</div>
              {ANSWERS.map((a) => (
                <div key={a.q} style={{ background: T.surface, color: T.ink, borderRadius: "14px", padding: "14px 16px", minHeight: "82px", boxSizing: "border-box" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px" }}>
                    {/* The logo carries the engine; the word is dropped (Danny, 27 Sep, R46). */}
                    <span style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11px", color: T.soft }}>
                      <EngineLogo engine={a.engine} size={14} title={ENGINE_SPECS[a.engine].label} inline />
                      {a.kind}
                    </span>
                    <span style={{ fontSize: "11px", fontWeight: 600, color: T.accentHover, background: T.wash, borderRadius: "999px", padding: "2px 9px", whiteSpace: "nowrap" }}>
                      Client named
                    </span>
                  </div>
                  <div style={{ fontSize: "14px", fontWeight: 600, marginTop: "6px" }}>{a.q}</div>
                </div>
              ))}
            </div>
          </div>
          <div style={{ marginTop: "22px", fontSize: "12px", color: T.faint }}>
            Illustrative. Every outlet, brand and headline shown is made up.
          </div>
        </div>
      </section>

      <div style={{ ...SHELL, paddingTop: "72px", paddingBottom: "64px" }}>
        <div className="board-head" style={{ display: "flex", alignItems: "baseline", gap: "40px" }}>
          <h2 style={{ margin: 0, fontSize: "28px", fontWeight: 700, letterSpacing: "-0.03em", flexShrink: 0, color: T.ink }}>
            What changes for a PR team
          </h2>
          <p style={{ margin: 0, fontSize: "15px", lineHeight: 1.55, color: T.soft }}>
            Nothing about how you work. Which titles you go after, and what goes in the report.
          </p>
        </div>

        <div className="three-up" style={{ gap: "16px", marginTop: "24px" }}>
          {CHANGES.map((c) => (
            <div key={c.label} style={{ ...CARD, borderRadius: "16px", padding: "20px" }}>
              <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 700, color: T.ink }}>{c.label}</h3>
              <p style={{ margin: "8px 0 0", fontSize: "14px", lineHeight: 1.55, color: T.soft }}>{c.body}</p>
            </div>
          ))}
        </div>

        <div className="pr-two" style={{ marginTop: "16px" }}>
          <div style={{ ...CARD, borderRadius: "16px", padding: "22px" }}>
            <div style={{ fontSize: "17px", fontWeight: 700, letterSpacing: "-0.02em", color: T.ink }}>
              <TierName tier="tracked" /> <span style={{ fontSize: "13px", color: T.soft, fontWeight: 600, letterSpacing: 0 }}>{priceOf("tracked")}</span>
            </div>
            <p style={{ margin: "8px 0 0", fontSize: "14px", lineHeight: 1.55, color: T.soft }}>
              Measurement only. We track the questions and hand you the source list. Your team does the outreach.{" "}
              <Link href={hrefOf("tracked")} style={planLink}>
                See the plan
              </Link>
            </p>
          </div>
          <div style={{ ...CARD, borderRadius: "16px", padding: "22px", borderColor: T.washLine }}>
            <div style={{ fontSize: "17px", fontWeight: 700, letterSpacing: "-0.02em", color: T.ink }}>
              <TierName tier="mentioned" /> <span style={{ fontSize: "13px", color: T.soft, fontWeight: 600, letterSpacing: 0 }}>{priceOf("mentioned")}</span>
            </div>
            <p style={{ margin: "8px 0 0", fontSize: "14px", lineHeight: 1.55, color: T.soft }}>
              We place into the pages your team does not cover - best-of lists, comparisons and round-ups - and leave
              your media relationships alone.{" "}
              <Link href={hrefOf("mentioned")} style={planLink}>
                See the plan
              </Link>
            </p>
          </div>
        </div>

        {/* The one door to the coverage check (24 Sep 2026: one name, one door). */}
        <div
          style={{
            marginTop: "16px",
            background: T.ink,
            color: T.surface,
            borderRadius: "16px",
            padding: "22px 26px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "16px",
            flexWrap: "wrap",
          }}
        >
          <div style={{ flexGrow: 1, minWidth: "220px" }}>
            <div style={{ fontSize: "18px", fontWeight: 700 }}>Already have a campaign?</div>
            <p style={{ margin: "4px 0 0", fontSize: "14px", lineHeight: 1.55, color: D.muted }}>
              {"Paste up to " + MAX_COVERAGE_URLS + " coverage links and see which ones the engines read."}
            </p>
          </div>
          <Link
            href="/coverage-check"
            className="btn-primary"
            style={{
              color: "#ffffff",
              fontSize: "15px",
              fontWeight: 600,
              padding: "12px 20px",
              borderRadius: "10px",
              textDecoration: "none",
              minHeight: "44px",
              boxSizing: "border-box",
              display: "flex",
              alignItems: "center",
            }}
          >
            Check your coverage
          </Link>
        </div>
        <p style={{ margin: "20px 0 0", fontSize: "14px", color: T.soft, lineHeight: 1.6 }}>
          Selling it under your own name?{" "}
          <Link href="/white-label" style={{ fontWeight: 600, textDecoration: "none", color: T.accent }}>
            How the white-label arrangement works
          </Link>
        </p>
      </div>
    </div>
  );
}
