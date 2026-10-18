import type { Metadata } from "next";
import { OG_IMAGE } from "@/config/og";
import PackagePage from "@/components/PackagePage";
import { listIf, onlyIf } from "@/config/capabilities";
import { MONTHLY_CLUSTERS_WORKED, MONTHLY_PLACEMENTS, priceProse, TIERS } from "@/config/pricing";

const tier = TIERS.find((t) => t.id === "mentioned")!;
const price = priceProse(tier);

export const metadata: Metadata = {
  title: "alwaysmentioned | AI citation placements",
  description:
    // "white-labelled" and the reporting line below claim a dashboard and a
    // report in the agency's brand, neither built yet (LB1, 8 Oct 2026).
    "Three placements a month in the sources AI engines already cite for your client's keyword cluster" +
    (onlyIf("dashboardBranding", ", white-labelled") ?? "") +
    "." +
    // The label reads "from $..."; here it opens a sentence, so it takes a
    // capital (handoff 16 Oct 2026, shipped 18 Oct 2026).
    (price ? ` ${price.charAt(0).toUpperCase()}${price.slice(1)}, priced per cluster.` : ""),
  openGraph: { url: "https://alwayscited.com/alwaysmentioned", images: OG_IMAGE },
  alternates: { canonical: "https://alwayscited.com/alwaysmentioned" },
};

export default function Page() {
  return (
    <PackagePage
      tier={tier}
      monthly={[
        { figure: String(MONTHLY_PLACEMENTS), label: "placements a month" },
        { figure: String(MONTHLY_CLUSTERS_WORKED), label: "keyword cluster, the one you track" },
        { figure: "Screened", label: "Every placement passes the three-part screen" },
        { figure: "Replaced", label: `A placement that fails doesn't count toward your ${MONTHLY_PLACEMENTS}` },
      ]}
      headline="Get named when"
      headlineAccent="AI recommends."
      standfirst="Three placements a month in the third-party articles the engines draw on when someone asks who to use. The focus is recommendations and brand mentions for one keyword cluster. Rankings improve as a side effect."
      included={[
        `${MONTHLY_PLACEMENTS} placements a month on one cluster`,
        "Placed in sources the scan shows the engines already citing",
        "Best-of lists, comparisons and round-ups, approached through editors we work with",
        "Anchor text agreed with you before anything goes live",
        "Everything in alwaystracked, so you can see what each placement did",
        ...listIf("reportBranding", "White-label reporting with your logo"),
      ]}
      notIncluded={{
        text: "This package wins the mention. It does not do on-page work. For schema and link insertions that go after the Google position directly, that is",
        upgradeTo: "cited",
        href: "/alwayscited",
      }}
      sections={[
        {
          figure: "Screened",
          heading: "Every placement passes the same three-part screen",
          body: "Already cited by the engines for the cluster, so we place where the answers are actually drawn from rather than on a domain-authority list. Real organic traffic, verified rather than claimed. And contextual to the cluster, so the mention reads as part of the page to a person and to a model.",
        },
        {
          figure: "Replaced",
          heading: "A placement that fails the screen is replaced",
          body: `Not counted. You are buying placements that passed, not attempts. If a publication drops out or the piece never runs, it does not come off your ${MONTHLY_PLACEMENTS}.`,
        },
        {
          figure: "Mentions",
          heading: "A mention can win the citation without a link",
          body: "Across our own coverage, the citations came from pieces with no link in them. Coverage and links do different jobs, and this package is aimed at the first one. The tracker reports which happened.",
        },
        {
          figure: "Per cluster",
          heading: "Priced per cluster",
          body: "You name the cluster, we build the prompts buyers actually ask around it - the longer-tail prompts people use when they are choosing a provider. Each cluster is priced and worked on its own, so the work stays focused enough to move.",
        },
      ]}
    />
  );
}
