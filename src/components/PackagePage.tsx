import { MarketCta, MarketPrice, MarketToggle, PackLine, SectorPrice, SelectionCta } from "@/components/SectorPrice";
import DeliverableTiles, { type Tile } from "@/components/DeliverableTiles";
import NextSteps from "@/components/NextSteps";
import SectionHead from "@/components/SectionHead";
import TierEngines from "@/components/TierEngines";
import WalkthroughForm from "@/components/scan/WalkthroughForm";
import TierName, { TierText, type TierKey } from "@/components/TierName";
import { ALWAYS_ON, ALWAYS_ON_SUPPORT } from "@/config/always-on";
import { onlyIf } from "@/config/capabilities";
import { MAX_CLUSTERS } from "@/config/sector-pricing";
import { CLUSTERS_LINE, CONTACT_URL, TIERS, TRACKED_BASIS, TRACKED_CLUSTERS, TRACKED_KEYWORDS, TRACKED_PROMPTS, checkoutUrlFor, contactUrlFor, enginesFor, type Tier } from "@/config/pricing";
import { ld } from "@/config/schema";
import { trialLine } from "@/config/trial";
import { serviceSchema } from "@/config/service-schema";
import { CARD, MICRO, SHELL, T } from "@/config/tokens";
import Link from "next/link";

/**
 * A package page, from PackageDetail.dc.html.
 *
 * The four pages pass the same props they always did. What changed is the
 * page around them: the deliverables are a table rather than a run of
 * headings, because a buyer comparing tiers reads down a column, and the
 * ladder at the bottom says plainly that each tier contains the one below it.
 */

/** `figure` is the tile's short noun; `heading` becomes its one-line label (R78). */
export type PackageSection = { figure: string; heading: string; body: string };

/**
 * The tiles every tier carries first - each includes the tracking - then one
 * per section. Every number is read from pricing.ts or engines.ts; the engine
 * tile draws the tier's own marks, four on alwaystracked and five above it.
 */
function trackedTiles(tier: Tier, clustersLabel = "keyword clusters"): Tile[] {
  const engines = enginesFor(tier.key).length;
  return [
    { key: "clusters", figure: String(TRACKED_CLUSTERS), label: clustersLabel },
    { key: "prompts", figure: String(TRACKED_PROMPTS), label: "prompts checked daily" },
    { key: "keywords", figure: String(TRACKED_KEYWORDS), label: "keywords ranked on Google daily" },
    {
      key: "engines",
      figure: (
        // Wraps: with 1.4.12 letter spacing the logos ran 2px past a 320 screen (R151).
        <span style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px 10px" }}>
          {engines}
          <TierEngines tier={tier.key} size={18} colour={T.soft} />
        </span>
      ),
      label: engines > 4 ? "engines, Claude included" : "engines",
    },
  ];
}

function sectionTiles(sections: PackageSection[]): Tile[] {
  return sections.map((x) => ({ key: x.heading, figure: x.figure, label: x.heading, detail: x.body }));
}

/** One of the deliverables a paid tier adds each month: a short figure and its label. */
export type MonthlyDeliverable = { figure: React.ReactNode; label: string };

/** The label over each block of "What lands each month". */
const BLOCK_LABEL: React.CSSProperties = { margin: "0 0 10px", fontSize: "14px", fontWeight: 700, letterSpacing: "-0.01em", color: T.ink };

/** The board's "/mo per client" treatment: a qualifier beside the figure, small and soft. */
const PRICE_UNIT: React.CSSProperties = { fontSize: "15px", fontWeight: 600, color: T.soft, letterSpacing: 0 };
const CTA_STYLE: React.CSSProperties = {
  display: "block",
  textAlign: "center",
  fontSize: "15px",
  fontWeight: 600,
  padding: "13px 20px",
  borderRadius: "10px",
  textDecoration: "none",
};
const PRICE_BIG: React.CSSProperties ={ fontSize: "36px", fontWeight: 700, letterSpacing: "-0.035em", lineHeight: 1.1 };

const GLOSS: Record<string, string> = {
  // The count comes from pricing.ts. It was typed here, which made this the
  // third of four surfaces carrying its own copy of what $99 buys.
  tracked: `${TRACKED_BASIS}. The map - you do the placing`,
  mentioned: "We do the placing",
  cited: "Citations and rankings pushed together",
  everywhere: "All of it, plus brand PR",
};

/**
 * The four package pages were the only priced surfaces on the site with no
 * structured data at all - which is an odd gap for a company that sells being
 * readable to answer engines. "What does it cost" is the question a buyer
 * actually asks one.
 *
 * `serviceSchema` used to live here and now lives in
 * `src/config/service-schema.ts`, because nothing could execute it where it
 * was - Node's runner cannot parse JSX. Its rules and the reason the split
 * happened are in that file's header; `price-schema.test.mts` runs it and
 * reads the offer nodes back off the built pages.
 */

export default function PackagePage({
  tier,
  standfirst,
  included,
  sections,
  notIncluded,
  beat,
  monthly,
}: {
  tier: Tier;
  /** Kept in the signature: the four pages still pass them. */
  headline?: string;
  headlineAccent?: string;
  standfirst: string;
  included: string[];
  sections: PackageSection[];
  /**
   * `upgradeTo` is a tier key rather than the written name: the page names a
   * tier here, so the lockup is not something a page should be able to spell
   * for itself.
   */
  notIncluded?: { text: string; upgradeTo?: TierKey; href?: string };
  /** A tier's own beat, directly under the header. Only /alwaystracked has one (R25). */
  beat?: React.ReactNode;
  /**
   * What the paid tiers add each month on one keyword cluster (Danny, 16 Oct
   * 2026). Given, the section draws the alwaystracked block, this block, then
   * the cards; /alwaystracked passes none and keeps the section as it was.
   */
  monthly?: MonthlyDeliverable[];
}) {
  return (
    <section style={{ ...SHELL, paddingTop: "40px", display: "flex", flexDirection: "column", gap: "28px" }}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: ld(serviceSchema(tier, standfirst)) }}
      />
      {/* The beat, from globals.css, on the groups that were already siblings.
          These four pages shipped with no motion at all - `fa251a1` extended
          coverage to "the sections that had none" and meant the homepage's, so
          19 of the 22 prerendered pages had none of their own. Nothing here is
          a new rule or a new class: `.ac-row` is the site's one entrance and the
          index comes from the document's own structure, so the only decision
          taken per group is which elements are the beat. Leaf content rather
          than the wrappers around it, deliberately - a row inside a row animates
          twice and reads as mush. */}
      <div className="confirm-top">
        <div>
          <Link
            className="ac-row"
            href="/packages"
            style={{ display: "block", fontSize: "13px", fontWeight: 600, textDecoration: "none", color: T.accent }}
          >
            All packages
          </Link>
          <div className="ac-row" style={{ ...MICRO, marginTop: "18px" }}>Package</div>
          <h1
            className="ac-row pkg-h1"
            style={{
              margin: "10px 0 0",
              fontSize: "36px",
              fontWeight: 700,
              letterSpacing: "-0.03em",
              lineHeight: 1.16,
              color: T.ink,
            }}
          >
            <TierName tier={tier.key} qualifier={tier.qualifier} />
          </h1>
          <p
            className="ac-row"
            style={{ margin: "12px 0 0", fontSize: "15.5px", lineHeight: 1.65, color: T.soft, maxWidth: "60ch" }}
          >
            <TierText>{standfirst}</TierText>
          </p>
        </div>

        <div className="ac-row" style={{ ...CARD, padding: "24px", alignSelf: "start" }}>
          {/* The board sets the qualifiers small and soft beside the figure.
              Split by the site's one price-label reader, which returns a label
              it cannot parse whole, at figure size. */}
          {/* The page's one market toggle, US first (pricing spec section 4;
              Danny, 27 Sep). The sector tiers get a select and a stepper. */}
          {tier.basePrice !== null ? <MarketToggle style={{ marginBottom: "14px", color: T.soft }} /> : null}
          {tier.key === "mentioned" || tier.key === "cited" ? (
            <SectorPrice tier={tier.key} fallback={tier.priceLabel} per={PRICE_UNIT} priceStyle={PRICE_BIG} syncUrl />
          ) : (
            // Through MarketPrice, so alwaystracked follows the toggle too: a
            // static priceLabel here stayed on $129 when UK was picked (Danny,
            // 28 Sep 2026, R77).
            <div style={PRICE_BIG} aria-live="polite">
              <MarketPrice tier={tier.key} fallback={tier.priceLabel} per={PRICE_UNIT} />
            </div>
          )}
          <p style={{ margin: "8px 0 16px", fontSize: "13.5px", lineHeight: 1.6, color: T.soft }}>
            {/* "white-labelled" waits for a dashboard in the agency's brand (LB1, 8 Oct 2026). */}
            <TierText>{tier.priceBasis ?? `Monthly, no minimum term${onlyIf("dashboardBranding", ", white-labelled") ?? ""}. What you pay us, not what you charge on.`}</TierText>
            {tier.key === "everywhere" ? null : (
              <span style={{ display: "block", marginTop: "4px" }}>
                {tier.key === "tracked" ? null : <>{CLUSTERS_LINE} </>}
                <PackLine />
              </span>
            )}
            {/* The alwaystracked trial, only while config/trial.ts has it on. Not in the Offer markup. */}
            {trialLine(tier.key) ? <span style={{ display: "block", marginTop: "6px", color: T.ink, fontWeight: 600 }}>{trialLine(tier.key)}</span> : null}
          </p>
          <TierEngines tier={tier.key} size={16} colour={T.soft} style={{ margin: "-4px 0 16px" }} />
          {/* The sector tiers' CTA carries the picks to the order form, or to
              /contact with the tier when they price as a call (R69, R91). */}
          {tier.key === "mentioned" || tier.key === "cited" ? (
            <SelectionCta tier={tier.key} href={checkoutUrlFor(tier.key)} className="btn-primary" style={CTA_STYLE}>
              {tier.action}
            </SelectionCta>
          ) : (
            <MarketCta tier={tier.key} href={tier.key === "tracked" ? checkoutUrlFor("tracked") : contactUrlFor(tier.key)} className="btn-primary" style={CTA_STYLE}>
              {/* The tier's own verb from pricing.ts (R79). alwayseverywhere's
                  still goes to /contact as a call - only the label moved. The
                  market picked on the page travels with it (R148), and the tier
                  too, so /contact says what the enquiry is about (R151). */}
              {tier.action}
            </MarketCta>
          )}
          <Link
            href="/#scan"
            style={{
              display: "block",
              textAlign: "center",
              marginTop: "8px",
              background: T.surface,
              border: "1px solid " + T.line,
              color: T.ink,
              fontSize: "15px",
              fontWeight: 600,
              padding: "12px 20px",
              borderRadius: "10px",
              textDecoration: "none",
            }}
          >
            Scan one first
          </Link>
        </div>
      </div>

      {beat}

      <div>
        {monthly ? (
          <>
            <SectionHead
              className="ac-row"
              style={{ marginBottom: "18px" }}
              title="What lands each month"
              intro={
                <TierText>
                  {"Every plan includes the full alwaystracked data. On top of it, this plan delivers the work below each month, on one keyword cluster. Stated as deliverables rather than adjectives, so you can hold us to it."}
                </TierText>
              }
            />

            <h3 className="ac-row" style={BLOCK_LABEL}>
              Included in every plan: <TierName tier="tracked" />
            </h3>
            <DeliverableTiles tiles={trackedTiles(tier, "keyword clusters tracked")} />

            <h3 className="ac-row" style={{ ...BLOCK_LABEL, marginTop: "24px" }}>
              On top, each month: one keyword cluster, worked on
            </h3>
            <DeliverableTiles tiles={monthly.map((m) => ({ key: m.label, figure: m.figure, label: m.label }))} />
            <p className="ac-row" style={{ margin: "12px 0 24px", fontSize: "14px", lineHeight: 1.6, color: T.soft }}>
              {/* alwayseverywhere has no checkout: its button books a call. */}
              {tier.key === "everywhere"
                ? "Working more than one cluster? We'll scope it on the call."
                : `Working more than one cluster? Add them at checkout, up to ${MAX_CLUSTERS}.`}
            </p>

            <DeliverableTiles tiles={sectionTiles(sections)} included={included} />
          </>
        ) : (
          <>
            <SectionHead
              className="ac-row"
              style={{ marginBottom: "14px" }}
              title="What lands each month"
              intro="Stated as deliverables rather than adjectives, so you can hold us to it."
            />
            <DeliverableTiles tiles={[...trackedTiles(tier), ...sectionTiles(sections)]} included={included} />
          </>
        )}

        {notIncluded ? (
          <p style={{ margin: "14px 0 0", fontSize: "14px", lineHeight: 1.65, color: T.soft }}>
            <TierText>{notIncluded.text}</TierText>
            {notIncluded.upgradeTo && notIncluded.href ? (
              <>
                {" "}
                {/* The lockup in the sentence and plain words in the link (QF1,
                    Danny, 25 Sep 2026): no tier name inside a link anywhere. */}
                <TierName tier={notIncluded.upgradeTo} />.{" "}
                <Link
                  href={notIncluded.href}
                  style={{ color: T.ink, textDecoration: "underline", textUnderlineOffset: "2px" }}
                >
                  See how it works
                </Link>
              </>
            ) : null}
          </p>
        ) : null}
      </div>

      <div className="ac-row" style={{ ...CARD, padding: "20px 24px", background: T.wash }}>
        <p style={{ margin: 0, fontSize: "17px", fontWeight: 700, letterSpacing: "-0.02em", color: T.ink }}>{ALWAYS_ON.tierPage}</p>
        <p style={{ margin: "4px 0 0", fontSize: "14px", lineHeight: 1.6, color: T.soft, maxWidth: "70ch" }}>{ALWAYS_ON_SUPPORT}</p>
      </div>

      <NextSteps />

      {/* See it first, 28 Sep 2026 (pricing spec section 6; Danny, danny.md
          line 55): no Loom URL or demo link yet, so each is an ask stored in
          walkthrough_requests with no scan. Book a call stays a plain link -
          walkthrough_requests.kind allows only video and demo (blocked.md). */}
      <div className="ac-row see-first" style={{ ...CARD, padding: "24px" }}>
        <div>
          <h2 style={{ margin: 0, fontSize: "19px", fontWeight: 700, letterSpacing: "-0.022em", color: T.ink }}>See it first</h2>
          <p style={{ margin: "8px 0 0", fontSize: "14px", lineHeight: 1.6, color: T.soft, maxWidth: "46ch" }}>
            A Loom of the <TierName tier="tracked" /> platform, or a demo with Danny. Rather talk it through?{" "}
            <a href={CONTACT_URL} style={{ fontWeight: 600, color: T.ink, textDecoration: "underline", textUnderlineOffset: "2px" }}>
              Book a call
            </a>
            .
          </p>
        </div>
        <WalkthroughForm from={tier.href} />
      </div>

      <div>
        <SectionHead
          className="ac-row"
          style={{ marginBottom: "14px" }}
          title="Where it sits"
          intro="Each tier contains the one below it. Nothing here is a different product."
        />

        <div style={{ ...CARD, display: "flex", overflow: "hidden", flexWrap: "wrap" }}>
          {TIERS.map((t, i) => {
            const here = t.key === tier.key;
            return (
              // A card, not a link: the lockup and the gloss are text, and the
              // link is plain words at the foot (QF1, Danny, 25 Sep 2026).
              <div
                key={t.id}
                className="ac-row"
                style={{
                  flexGrow: 1,
                  flexBasis: "220px",
                  padding: "20px 24px",
                  display: "block",
                  background: here ? T.wash : T.surface,
                  borderLeft: i ? "1px solid " + T.line : undefined,
                }}
              >
                <div style={{ fontSize: "14.5px", fontWeight: 700, letterSpacing: "-0.022em", color: T.ink }}>
                  <TierName tier={t.key} qualifier={t.qualifier} />
                </div>
                <div style={{ fontSize: "13px", color: T.soft, marginTop: "4px" }}>
                  <MarketPrice tier={t.key} fallback={t.priceLabel} />
                </div>
                <TierEngines tier={t.key} size={14} colour={T.soft} style={{ marginTop: "8px" }} />
                <div style={{ fontSize: "13px", color: T.soft, marginTop: "8px", lineHeight: 1.55 }}>
                  {here ? "You are here. " : ""}
                  <TierText>{GLOSS[t.key]}</TierText>
                </div>
                {here ? null : (
                  <Link
                    href={t.href}
                    style={{ display: "inline-block", marginTop: "10px", fontSize: "13px", fontWeight: 600, color: T.ink, textDecoration: "underline", textUnderlineOffset: "2px" }}
                  >
                    See the plan
                  </Link>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <p className="ac-row" style={{ margin: 0, fontSize: "13.5px", color: T.soft, lineHeight: 1.65 }}>
        Not sure which tier a client needs?{" "}
        <Link href="/#scan" style={{ fontWeight: 600, textDecoration: "none", color: T.accent }}>
          Run the free scan
        </Link>{" "}
        - the source table usually answers it.
      </p>
    </section>
  );
}
