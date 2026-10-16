import type { Metadata } from "next";
import { OG_IMAGE } from "@/config/og";
import PackagePage from "@/components/PackagePage";
import TrackedBeat from "@/components/TrackedBeat";
import { listIf, onlyIf } from "@/config/capabilities";
import { enginesFor, priceProse, TIERS } from "@/config/pricing";
import { listOf } from "@/config/scan-shape";
import { trialLine } from "@/config/trial";
import { ENGINE_SPECS } from "@/lib/scan/engines";

const tier = TIERS.find((t) => t.id === "tracked")!;
/**
 * Written as "White-labelled, from $99 a month." rather than opening the
 * sentence on the price, because `priceProse` returns the label's own casing
 * and this tier's label carries a leading "from". Capitalising it here would
 * be a second decision about the string; moving the clause is none.
 *
 * 8 Oct 2026, LB1: "White-labelled" is withheld until the dashboard carries
 * the agency's brand (`dashboardBranding`), so the price moved up beside the
 * product's name rather than being lost with it - the same words, reordered.
 * "For one topic" went: the plan is sold as TRACKED_CLUSTERS clusters.
 * Coverage matching, the host article's Google position and white-label
 * reports are not built for this tier, so every line claiming them sits behind
 * its capability in `config/capabilities.ts` (`coverageUpload`,
 * `hostArticleRankings`, `reportBranding`) and comes back in these words when
 * it ships.
 */
const price = priceProse(tier);

/** The engines this tier reads, named from the one list rather than typed - the Names tile named two of them. */
const ENGINE_NAMES = listOf(enginesFor("tracked").map((e) => ENGINE_SPECS[e].label));

export const metadata: Metadata = {
  title: "alwaystracked | AI visibility tracking",
  description:
    "AI visibility tracking" +
    (price ? `, ${price}` : "") +
    ": who the engines name" +
    (onlyIf("coverageUpload", ", which sources they cite, and which of your coverage is in that list.") ?? " and which sources they cite.") +
    (onlyIf("dashboardBranding", " White-labelled.") ?? "") +
    // The trial, only while config/trial.ts has it on; llms.txt reads this description.
    (trialLine("tracked") ? ` ${trialLine("tracked")}` : ""),
  openGraph: { url: "https://alwayscited.com/alwaystracked", images: OG_IMAGE },
  alternates: { canonical: "https://alwayscited.com/alwaystracked" },
};

export default function Page() {
  return (
    <PackagePage
      tier={tier}
      beat={<TrackedBeat />}
      headline="Know what your coverage"
      headlineAccent="actually did."
      standfirst="The scan tells you where a client stands today. alwaystracked keeps reading, every morning, so you can show a client what changed and when it changed."
      included={[
        "Daily AI visibility readings on your clusters: each keyword joined to the prompts buyers ask about it",
        "The category leaderboard, and where your client sits in it",
        "The sources the engines cite for your clusters, ranked by how often",
        ...listIf("coverageUpload", "Coverage matching: upload a campaign, see which pieces are cited"),
        onlyIf("hostArticleRankings", "Google positions for the host article and the client page, tracked separately") ?? "Google positions for the client page",
        ...listIf("reportBranding", "White-label reports with your logo, not ours"),
        "One market",
      ]}
      notIncluded={{
        text: "This package measures. It does not place. If you want us to get your client into the sources the scan names, that starts at",
        upgradeTo: "mentioned",
        href: "/alwaysmentioned",
      }}
      sections={[
        {
          figure: "Names",
          heading: "Who the engines name",
          body: `Every brand ${ENGINE_NAMES} mention when buyers ask about your client's cluster, ranked by share of voice. You see the competitors ahead of your client by name, not a score out of a hundred.`,
        },
        {
          figure: "Sources",
          heading: "What they drew on to say it",
          body: "The exact sources cited in those answers, ranked by how often they appear. This is the list that decides whether your client exists in an AI answer, and it is the list we work from when you buy a placement.",
        },
        ...listIf("coverageUpload", {
          figure: "Coverage",
          heading: "Which of your coverage is in that list",
          body: "Upload a campaign's coverage and we match it URL for URL against the cited sources. You get the pieces doing the work, the pieces doing nothing, and the sources you are not in yet.",
        }),
        ...listIf("hostArticleRankings", {
          figure: "Rankings",
          heading: "Two keyword sets, never averaged",
          body: "The host article's ranking for the terms it was written to win, and your client's page ranking for the term that converts. They are different jobs, so we report them separately rather than rolling them into one number.",
        }),
        // The coverage's go-live date is what the upload records; alwaystracked
        // takes no placements today (admin/tracking/actions.ts).
        ...listIf("coverageUpload", {
          figure: "Dates",
          heading: "The sequence, not a claim about cause",
          body: "We show you where a page sat before, where it sits now, and the date the coverage went live. We do not pretend that is a controlled experiment.",
        }),
      ]}
    />
  );
}
