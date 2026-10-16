import type { Metadata } from "next";
import { OG_IMAGE } from "@/config/og";
import PackagePage from "@/components/PackagePage";
import { listIf } from "@/config/capabilities";
import { MONTHLY_CLUSTERS_WORKED, MONTHLY_INSERTIONS_MIN, MONTHLY_PLACEMENTS, priceProse, TIERS } from "@/config/pricing";

const tier = TIERS.find((t) => t.id === "cited")!;
const price = priceProse(tier);

export const metadata: Metadata = {
  title: "AI citations and rankings for agencies",
  description:
    "Placements in the sources AI engines cite, plus schema work and link insertions aimed at the Google position." +
    (price ? ` ${price}, priced per cluster.` : ""),
  openGraph: { url: "https://alwayscited.com/alwayscited", images: OG_IMAGE },
  alternates: { canonical: "https://alwayscited.com/alwayscited" },
};

export default function Page() {
  return (
    <PackagePage
      tier={tier}
      monthly={[
        { figure: String(MONTHLY_PLACEMENTS), label: "placements a month" },
        { figure: `${MONTHLY_INSERTIONS_MIN}+`, label: "link insertions a month, inside existing ranking articles" },
        { figure: "Schema", label: "on the target pages" },
        { figure: String(MONTHLY_CLUSTERS_WORKED), label: "keyword cluster, worked for both the AI citation and the Google position" },
      ]}
      headline="Get cited,"
      headlineAccent="and rank for it."
      standfirst="Everything in alwaysmentioned, then we go after the ranking directly. Schema work on your client's pages and link insertions from the placements, so the same coverage that wins the AI answer also moves the keyword."
      included={[
        "Everything in alwaysmentioned, including the placements and the tracking",
        "The cluster you track is the one you upgrade: the same keyword and prompts, now worked on",
        "Schema work on your client's target pages",
        "Link insertions inside existing high-authority articles",
        "Insertions agreed with the publisher and with you",
        "Both the AI citation and the Google position worked deliberately",
        // A report in the agency's brand is not built yet (LB1, 8 Oct 2026).
        ...listIf("reportBranding", "White-label reporting with your logo"),
      ]}
      notIncluded={{
        text: "One cluster, one market. For several markets, several brands, or a dedicated strategist, that is",
        upgradeTo: "everywhere",
        href: "/alwayseverywhere",
      }}
      sections={[
        {
          figure: "Both routes",
          heading: "Two routes, worked at once",
          body: "Coverage the engines read can win a citation with no link in it. Links that move rankings can shift a Google position. Both put your client in the pool the engines extract from, and this is the package that does both rather than picking one.",
        },
        {
          figure: "Insertions",
          heading: "Link insertions, not link building",
          body: "We place contextual links inside articles that already exist, already rank for their own terms, and already get read. Agreed with the publisher, agreed with you, and always inside content about your client's category.",
        },
        {
          figure: "Schema",
          heading: "Schema so the answer is extractable",
          body: "A model has to be able to parse what your client's page says before it can quote it. We mark up the pages the placements point at, so the claim on the page and the claim in the coverage line up.",
        },
        {
          figure: "Compounds",
          heading: "What compounds",
          body: "The engines start citing your client, and once cited in a trusted source brands tend to be cited again across engines. The host article's own ranking carries the linked page. And readers arriving from a category roundup are already choosing a provider.",
        },
      ]}
    />
  );
}
