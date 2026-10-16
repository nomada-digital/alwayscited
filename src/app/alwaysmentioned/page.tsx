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
    (price ? ` ${price}, priced per cluster.` : ""),
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
        "Placed in sources the scan shows the engines already citing",
        "Best-of lists, comparisons and round-ups, approached through editors we work with",
        "Anchor text agreed with you before anything goes live",
        ...listIf("reportBranding", "White-label reporting with your logo"),
      ]}
      notIncluded={{
        text: "This package wins the mention. It does not do on-page work. For schema and link insertions that go after the Google position directly, that is",
        upgradeTo: "cited",
        href: "/alwayscited",
      }}
      sections={[
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
