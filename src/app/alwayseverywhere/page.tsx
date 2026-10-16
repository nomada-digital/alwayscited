import type { Metadata } from "next";
import { OG_IMAGE } from "@/config/og";
import PackagePage from "@/components/PackagePage";
import TierName from "@/components/TierName";
import { onlyIf } from "@/config/capabilities";
import { MONTHLY_INSERTIONS_MIN, MONTHLY_PLACEMENTS, TIERS } from "@/config/pricing";

const tier = TIERS.find((t) => t.id === "everywhere")!;

/**
 * Pricing spec 27 Sep 2026, section 8: alwayseverywhere is brand PR and earned
 * media on top of the alwayscited plan, not a portfolio of clients. Sold to
 * brands direct rather than white-labelled (open decision 5's default, Danny to
 * confirm). The spec's claims rules hold here harder than anywhere: no
 * guarantee of mentions, citations or coverage on this tier, and no price.
 *
 * 8 Oct 2026, LB1: "This tier is not white-labelled." is true, but stressing
 * "this tier" contrasts it with tiers that are, and no tier's dashboard
 * carries an agency's brand yet. It waits on `dashboardBranding` with the
 * "are white-label" lines it answers; the tile reads whole without it.
 */
export const metadata: Metadata = {
  title: "alwayseverywhere | Brand PR and earned media for AI visibility",
  description:
    "Everything in the alwayscited plan, plus brand PR for earned media, run by our senior team and tracked into the AI answers. Sold to brands direct.",
  openGraph: { url: "https://alwayscited.com/alwayseverywhere", images: OG_IMAGE },
  alternates: { canonical: "https://alwayscited.com/alwayseverywhere" },
};

export default function Page() {
  return (
    <PackagePage
      tier={tier}
      monthly={[
        { figure: <TierName tier="cited" />, label: `Everything in it, on one cluster: ${MONTHLY_PLACEMENTS} placements, ${MONTHLY_INSERTIONS_MIN}+ link insertions, schema` },
        { figure: "Brand PR", label: "For earned media, run by our senior team" },
        { figure: "Tracked", label: "URL for URL into the answers" },
      ]}
      headline="Earned media,"
      headlineAccent="then the answers."
      standfirst="For brands that want coverage as well as placements. Everything in the alwayscited plan, plus brand PR for earned media, run by our senior team and tracked into the answers the same way as every placement."
      included={[
        "Everything in alwayscited",
        "Brand PR for earned media, run by our senior team",
        "Each piece of coverage matched against the sources behind the answers",
        "The same locked question set as the rest of the plan",
        "Sold to your brand direct, under our name",
      ]}
      notIncluded={{
        text: "A published price, and any guarantee of coverage. What earned media costs depends on the brand, the market and what you already have running, so we quote it on a call rather than post a figure. No one can promise that a journalist writes about you, so we do not: we say what we would pitch, where, and how we will report what lands.",
      }}
      sections={[
        {
          figure: "Earned media",
          heading: "Coverage, then the answers",
          body: "The placements in the alwayscited plan are paid. Earned media is the part you cannot buy: coverage in the publications your buyers already read. We pitch it, then read which pieces the engines pick up, so coverage is judged by whether it reaches the answer rather than by a clippings count.",
        },
        {
          figure: "Tracked",
          heading: "Tracked the same way as everything else",
          body: "Each piece of coverage is matched URL for URL against the sources behind the answers, on the same locked questions as the rest of the plan. A change in the reading is a change in the answers, not a change in what we asked.",
        },
        {
          figure: "Direct",
          heading: "Sold to brands direct",
          body:
            (onlyIf("dashboardBranding", "This tier is not white-labelled. ") ?? "") +
            "Agencies that run PR sell it to their own clients, and we would rather work alongside them than compete, so it is sold to the brand under our name.",
        },
        {
          figure: "On a call",
          heading: "Scoped on a call",
          body: "The call covers the brand, the market and what coverage you already have. We say what we would do first, and roughly what it costs, before you commit to anything.",
        },
      ]}
    />
  );
}
