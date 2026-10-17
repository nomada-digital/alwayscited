import { MarketCta, MarketPrice, MarketToggle, PackLine, SectorPrice, SelectionCta } from "@/components/SectorPrice";
import TierEngines from "@/components/TierEngines";
import PkgScroll from "@/components/home/PkgScroll";
import TierName, { TierText, type TierKey } from "@/components/TierName";
import { ALWAYS_ON, ALWAYS_ON_SUPPORT } from "@/config/always-on";
import { listIf, onlyIf } from "@/config/capabilities";
import { CLUSTERS_LINE, TIERS, checkoutUrlFor, contactUrlFor } from "@/config/pricing";
import { trialLine } from "@/config/trial";
import { CARD, SHELL, T } from "@/config/tokens";

import { D, PACKAGES_WASH } from "./dark";

/**
 * Packages - the tier staircase, from Packages.dc.html ("Home 3", 25 Sep 2026).
 *
 * A dark band where the four tiers climb a drawn staircase, then one table of
 * what each tier adds. It replaces the four package cards and the separate
 * white-label card; "every tier is white-label" is now the table's last row
 * and the line under it.
 *
 * 8 Oct 2026, LB1/LB7: both of those wait on `dashboardBranding` - no tier's
 * dashboard carries the agency's brand yet, so "Your dashboards and your
 * branding" and "are white-label" are withheld until it does, and so is the
 * foot's "How the line sits" link, whose "line" is the one that clause drew
 * (on review, later that day: alone it read as a fragment). "Placement
 * opportunities, scored for difficulty" is narrowed to the free scan, the only
 * place a difficulty is scored (the dashboard's Cited page shows none, by its
 * brief), and "Rank tracking on the money keywords" is ticked for alwaystracked
 * and alwaysmentioned: the daily run reads every cluster keyword's Google
 * position for every tier (tracking/runner.ts).
 *
 * Every price and basis is read off the tier in src/config/pricing.ts, so the
 * homepage cannot quote a number the package pages disagree with. Where the
 * board prints a basis pricing.ts does not hold, the tier's `positioning` from
 * the same file stands in rather than a line typed here. No "Most taken" badge
 * (removed 25 Sep). The emphasised tier carries a "Recommended" pill and no
 * tinted column (Danny, 28 Sep, R58) - never "Most popular", there is no sales
 * data behind it.
 *
 * Split across two routes (Danny, 28 Sep 2026, R65): the homepage draws the
 * band only, with a "Compare all packages" link under it; `/packages` draws
 * the band, the full table and the foot (`full`), with the band's heading as
 * the page's h1. `id="packages"` stays on both so old `/#packages` anchors land.
 *
 * The staircase draws itself on the board's 10s loop under
 * html[data-motion="on"]; with no script or reduced motion it is drawn, with
 * every step in place.
 */

/** The board's button labels. The everywhere tier's goes to a call, not a page;
 *  the tracked tier's to /contact with the tier carried, as it is set up by
 *  hand (Danny, 26 Sep 2026). */
const ctaStyle = (emphasis?: boolean): React.CSSProperties => ({
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  marginTop: "12px",
  fontSize: "13.5px",
  fontWeight: 600,
  borderRadius: "9px",
  textDecoration: "none",
  minHeight: "40px",
  boxSizing: "border-box",
  // Flat accent, the header's "Free scan" exactly - not
  // .btn-primary's gradient, and no black (R59).
  ...(emphasis
    ? { background: T.accent, color: "#ffffff" }
    : { background: T.surface, color: T.ink, border: `1px solid ${T.line}` }),
});

// Labels are each tier's `action` in pricing.ts (R79); only the targets live here.
// alwaystracked goes to the order form, as its tier page does - it went to
// /contact from before checkout existed (R148 journey pass, 1 Oct 2026).
// alwayseverywhere carries its tier, so /contact says "About alwayseverywhere"
// and the enquiry says which tier it is about (R151, 3 Oct 2026).
const CTA_HREF: Partial<Record<TierKey, string>> = {
  tracked: checkoutUrlFor("tracked"),
  everywhere: contactUrlFor("everywhere"),
};

/** 1 = included, 0 = not, a string = the cell's text. One entry per tier, in TIERS order. */
type Cell = 0 | 1 | string;
type Row = { what: string; cells: Record<TierKey, Cell> };
const ROWS: Row[] = [
  { what: "Buyer questions across the AI engines and Google keywords, checked daily", cells: { tracked: 1, mentioned: 1, cited: 1, everywhere: 1 } },
  { what: "Every source behind every answer", cells: { tracked: 1, mentioned: 1, cited: 1, everywhere: 1 } },
  { what: "Placement opportunities, scored for difficulty, in the free scan", cells: { tracked: 1, mentioned: 1, cited: 1, everywhere: 1 } },
  { what: "Who secures the placements", cells: { tracked: "You", mentioned: "Us", cited: "Us", everywhere: "Us" } },
  { what: "Placements in cited pages, links included", cells: { tracked: 0, mentioned: 1, cited: 1, everywhere: 1 } },
  { what: "Citation reporting on every placement", cells: { tracked: 0, mentioned: 1, cited: 1, everywhere: 1 } },
  { what: "Placements chosen to move the Google position too", cells: { tracked: 0, mentioned: 0, cited: 1, everywhere: 1 } },
  { what: "Link insertions and schema work", cells: { tracked: 0, mentioned: 0, cited: 1, everywhere: 1 } },
  { what: "Rank tracking on the money keywords", cells: { tracked: 1, mentioned: 1, cited: 1, everywhere: 1 } },
  // Pricing spec 27 Sep, section 8: the top tier is brand PR, sold to brands
  // direct rather than white-labelled (open decision 5's default).
  { what: "Brand PR for earned media", cells: { tracked: 0, mentioned: 0, cited: 0, everywhere: 1 } },
  ...listIf<Row>("dashboardBranding", { what: "Your dashboards and your branding", cells: { tracked: 1, mentioned: 1, cited: 1, everywhere: 0 } }),
];

const PRICE: React.CSSProperties = { fontSize: "24px", fontWeight: 700, letterSpacing: "-0.03em", marginTop: "8px", color: T.ink, lineHeight: 1.2 };
const PER: React.CSSProperties = { fontSize: "13px", color: T.soft, fontWeight: 600, letterSpacing: 0 };
const PILL: React.CSSProperties = {
  alignSelf: "flex-start",
  display: "inline-flex",
  alignItems: "center",
  boxSizing: "border-box",
  height: "22px",
  marginBottom: "8px",
  padding: "0 9px",
  borderRadius: "999px",
  background: T.wash,
  color: T.accent,
  fontSize: "11.5px",
  fontWeight: 600,
  lineHeight: 1.5,
};

/** The basis or positioning line, directly under the price in every column. */
function Basis({ text }: { text: string }) {
  // TierText: alwayseverywhere's basis names the alwayscited plan (R72).
  return <div style={{ fontSize: "12px", lineHeight: 1.45, color: T.soft, marginTop: "4px", minHeight: "35px" }}><TierText>{text}</TierText></div>;
}

function CellMark({ v }: { v: Cell }) {
  if (v === 1) {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={T.accent} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" role="img" aria-label="Included">
        <path d="M5 12.5l4.5 4.5L19 7.5" />
      </svg>
    );
  }
  if (v === 0) {
    return (
      <span role="img" aria-label="Not included" style={{ width: "10px", height: "1.5px", background: T.faint, display: "block", margin: "8px 0" }} />
    );
  }
  return <span>{v}</span>;
}

export const PACKAGES_HREF = "/packages";

export default function Packages({ full = false }: { full?: boolean }) {
  const Heading = full ? "h1" : "h2";
  return (
    <section id="packages" style={{ marginTop: full ? 0 : "72px", scrollMarginTop: "5rem" }}>
      <div
        className="on-dark"
        style={{
          background: `${PACKAGES_WASH}, ${D.ground}`,
          color: T.surface,
          padding: "72px 0 56px",
        }}
      >
        <div style={SHELL}>
          <div className="ways-head">
            <Heading style={{ margin: 0, fontSize: "clamp(26px, 3.4vw, 34px)", fontWeight: 700, letterSpacing: "-0.03em", color: T.surface, flexShrink: 0 }}>
              {full ? "Packages and pricing" : "Packages"}
            </Heading>
            <p style={{ margin: 0, fontSize: "15px", lineHeight: 1.6, color: D.muted, maxWidth: "56ch" }}>
              Monthly, no minimum term. The price is here because you should not have to sit through a
              call to find out.
            </p>
          </div>
          <div style={{ marginTop: "20px" }}>
            <p style={{ margin: 0, fontSize: "17px", fontWeight: 700, letterSpacing: "-0.02em", color: T.surface }}>{ALWAYS_ON.packages}</p>
            <p style={{ margin: "4px 0 0", fontSize: "14px", lineHeight: 1.6, color: D.muted, maxWidth: "64ch" }}>{ALWAYS_ON_SUPPORT}</p>
          </div>
          {/* One market toggle for the section, US first (pricing spec
              section 4; Danny, 27 Sep). Drawn only once script runs. */}
          <MarketToggle tone="dark" style={{ marginTop: "20px", color: D.muted }} />

          {/* In the order pricing.ts lists them, which is ascending intensity. */}
          <div className="stair" style={{ marginTop: "40px" }}>
            <svg className="stair-line" viewBox="0 0 1132 250" preserveAspectRatio="none" fill="none" aria-hidden="true">
              <path
                pathLength={1}
                d="M0 232 H250 V172 H530 V112 H810 V52 H1132"
                stroke={T.accent}
                strokeWidth="2"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
            <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {TIERS.map((t, i) => (
              <li key={t.id} className="stair-step" style={{ ["--stair-i" as string]: i }}>
                <span style={{ display: "block", fontSize: "clamp(20px, 2.1vw, 26px)", fontWeight: 700, letterSpacing: "-0.025em" }}>
                  <TierName tier={t.key} />
                </span>
                <span style={{ display: "block", fontSize: "14px", color: D.muted, marginTop: "4px" }}>
                  <MarketPrice tier={t.key} fallback={t.priceLabel} />
                </span>
                {/* The alwaystracked trial, only while config/trial.ts has it on. */}
                {trialLine(t.key) ? <span style={{ display: "block", fontSize: "13px", color: D.muted, marginTop: "2px" }}>{trialLine(t.key)}</span> : null}
                <TierEngines tier={t.key} size={14} colour={D.muted} style={{ marginTop: "8px" }} />
              </li>
            ))}
            </ol>
          </div>
          {full ? null : (
            // id="packages-compare" marks the end of the homepage band for price-surfaces.test.mts.
            <p id="packages-compare" style={{ margin: "32px 0 0", fontSize: "15px" }}>
              <a href={PACKAGES_HREF} style={{ fontWeight: 600, textDecoration: "none", color: T.surface }}>
                Compare all packages <span aria-hidden="true">→</span>
              </a>
            </p>
          )}
        </div>
      </div>

      {full ? (
      <div style={{ ...SHELL, paddingTop: "48px", paddingBottom: "72px" }}>
        {/* Below 860px the table scrolls sideways and read as one tier of
            four (Danny, 26 Sep 2026, R28). The label says so; the right-edge
            fade in globals.css says so again and clears at the end. */}
        <p className="pkg-cue" style={{ margin: "0 0 10px", fontSize: "12.5px", fontWeight: 600, color: T.soft }}>
          Swipe for all four tiers <span aria-hidden="true">→</span>
        </p>
        <PkgScroll style={{ ...CARD, overflow: "hidden" }}>
          <table className="pkg-table">
            <caption className="sr-only">What each tier adds</caption>
            <colgroup>
              <col className="pkg-col-what" />
              {TIERS.map((t) => (
                <col key={t.id} />
              ))}
            </colgroup>
            <thead>
              <tr>
                {/* The table's visible heading, built like a tier cell so it
                    shares the tier names' line: the pill's row, the name at
                    their size, then a soft line where the price sits (R57, R70). */}
                <td style={{ padding: "20px 24px", verticalAlign: "top" }}>
                  <div style={{ display: "flex", flexDirection: "column" }}>
                    <span aria-hidden="true" style={{ height: PILL.height, marginBottom: PILL.marginBottom }} />
                    <div style={{ fontSize: "16px", fontWeight: 700, letterSpacing: "-0.02em", color: T.ink }}>What each tier adds</div>
                    <div style={{ display: "flex", alignItems: "flex-end", minHeight: "29px", marginTop: PRICE.marginTop, fontSize: "14px", lineHeight: 1.45, color: T.soft }}>
                      Pick a sector to see your price
                    </div>
                  </div>
                </td>
                {TIERS.map((t) => (
                  // height: 1px lets the inner column fill the row, so the engine
                  // marks and the CTA share one bottom line in all four (R56).
                  <th key={t.id} scope="col" style={{ height: "1px", padding: "20px 18px", borderLeft: `1px solid ${T.line}`, textAlign: "left", fontWeight: 400, verticalAlign: "top" }}>
                    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
                    {/* Every column keeps the pill's row, so the names stay on one line (R56, R58). */}
                    {t.emphasis ? (
                      <span style={PILL}>Recommended</span>
                    ) : (
                      <span aria-hidden="true" style={{ height: PILL.height, marginBottom: PILL.marginBottom }} />
                    )}
                    <div style={{ fontSize: "16px", fontWeight: 700, letterSpacing: "-0.02em", color: T.ink }}>
                      <TierName tier={t.key} />
                    </div>
                    {t.key === "mentioned" || t.key === "cited" ? (
                      <SectorPrice
                        tier={t.key}
                        fallback={t.priceLabel}
                        compact
                        per={PER}
                        priceStyle={PRICE}
                        basis={
                          <>
                            <Basis text={t.priceBasis ?? t.positioning} />
                            {/* Spec section 8's add-on line, both sentences (R50). */}
                            <div style={{ fontSize: "12px", lineHeight: 1.45, color: T.soft, marginTop: "4px" }}>
                              {CLUSTERS_LINE} <PackLine />
                            </div>
                          </>
                        }
                      />
                    ) : (
                      <>
                        <div style={PRICE}>
                          <MarketPrice tier={t.key} fallback={t.priceLabel} per={PER} />
                        </div>
                        <Basis text={t.priceBasis ?? t.positioning} />
                        {t.key === "tracked" ? (
                          <div style={{ fontSize: "12px", lineHeight: 1.45, color: T.soft, marginTop: "4px" }}>
                            <PackLine />
                            {trialLine(t.key) ? <span style={{ display: "block", marginTop: "4px", color: T.ink, fontWeight: 600 }}>{trialLine(t.key)}</span> : null}
                          </div>
                        ) : null}
                      </>
                    )}
                    <TierEngines tier={t.key} size={14} colour={T.soft} style={{ marginTop: "auto", paddingTop: "10px", minHeight: "18px" }} />
                    {/* The sector tiles' CTA carries their picks to the tier page (R69). */}
                    {t.key === "mentioned" || t.key === "cited" ? (
                      <SelectionCta tier={t.key} href={CTA_HREF[t.key] ?? t.href} className="pkg-btn" style={ctaStyle(t.emphasis)}>
                        {t.action}
                      </SelectionCta>
                    ) : (
                      <MarketCta tier={t.key} href={CTA_HREF[t.key] ?? t.href} className="pkg-btn" style={ctaStyle(t.emphasis)}>
                        {t.action}
                      </MarketCta>
                    )}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROWS.map((r) => (
                <tr key={r.what}>
                  <th scope="row" style={{ padding: "13px 24px", fontSize: "14px", fontWeight: 400, textAlign: "left", color: T.ink, borderTop: `1px solid ${T.hair}` }}>
                    {r.what}
                  </th>
                  {TIERS.map((t) => (
                    <td
                      key={t.id}
                      style={{
                        padding: "13px 18px",
                        borderLeft: `1px solid ${T.hair}`,
                        borderTop: `1px solid ${T.hair}`,
                        fontSize: "13px",
                        fontWeight: 600,
                        color: T.soft,
                      }}
                    >
                      <span style={{ display: "flex", justifyContent: "center" }}>
                        <CellMark v={r.cells[t.key]} />
                      </span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </PkgScroll>

        {/* id="white-label" marks the end of the priced grid for price-surfaces.test.mts. */}
        <div id="white-label" className="pkg-foot" style={{ marginTop: "18px", fontSize: "13.5px", lineHeight: 1.6, color: T.soft }}>
          <span>
            {onlyIf("dashboardBranding", <><TierName tier="tracked" /> to <TierName tier="cited" /> are white-label;{" "}</>)}
            <TierName tier="everywhere" /> is sold to brands direct.
            {/* "The line" is the one the clause above draws, so the link waits with it (8 Oct 2026). */}
            {onlyIf("dashboardBranding", (
              <>
                {" "}
                <a href="/white-label" style={{ fontWeight: 600, textDecoration: "none", color: T.ink }}>
                  How the line sits
                </a>
              </>
            ))}
          </span>
          <span>
            <TierName tier="cited" /> is built and run by the senior team at{" "}
            <a href="https://nomadadigital.co.uk" style={{ fontWeight: 600, textDecoration: "none", color: T.ink }}>
              nomada digital
            </a>
            .
          </span>
        </div>
      </div>
      ) : null}
    </section>
  );
}
