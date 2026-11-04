import { TIER_PLAIN } from "../lib/tier-text.ts";
import { FREE_ENGINE_COUNT } from "./scan-shape.ts";

/**
 * The launch video on /how-it-works, as one record (Q23, 26 Sep 2026; re-cut
 * R118, 29 Sep 2026).
 *
 * A video is a rendered file: nothing in it updates when the site does. So
 * everything the page, the JSON-LD and the text summary say about it lives
 * here, and `video.test.mts` holds the parts that can drift - the files, the
 * duration, and above all the prices - against the tree.
 *
 * `shownPrices` is what the video paints as a price, in tier order. The first
 * cut painted $99 / $995 / $2,495 and went stale when the pricing spec moved
 * them (off the site 28 Sep). The re-cut (Danny, 29 Sep, danny.md line 110)
 * shows no price at all, so it is empty: there is nothing in the file for
 * pricing.ts to drift away from. If a re-render paints a price again, record
 * it here and the test holds it to pricing.ts.
 */
export const LAUNCH_VIDEO = {
  src: "/video/alwayscited-tiers-720.mp4",
  poster: "/video/alwayscited-tiers-poster.jpg",
  /** 62.315s by the file's mvhd box, rounded to the second. */
  duration: "PT1M2S",
  durationSeconds: 62,
  width: 1280,
  height: 720,
  /** The day the re-cut went on the site. */
  uploadDate: "2026-09-29",
  name: "alwayscited in 60 seconds: four tiers, from tracked to everywhere",
  description:
    "Every AI tool shows you the gap. We close it. One buyer prompt put to the AI engines, the brands they name instead, and the four tiers that get a brand into the answer: tracking by cluster, placements, citation and earned media.",
  shownPrices: [] as string[],
} as const;

/**
 * What the video argues, as text, for anyone who cannot or does not play it -
 * a crawler, a screen reader, a muted phone. Each line is what the matching
 * beat says on screen, in plain words. The re-cut shows no price, so neither
 * does this (video.test.mts holds that).
 */
export const LAUNCH_VIDEO_SUMMARY: string[] = [
  "Every AI tool shows you the gap. We close it.",
  "A buyer asks the AI engines for the best invoicing software for freelancers, and every engine names other brands, not Tallyroo. Tallyroo is made up, as is every brand shown.",
  `${TIER_PLAIN.tracked}: 10 clusters checked daily, each Google keyword joined to its five prompts. Reporting only.`,
  `${TIER_PLAIN.mentioned}: placements in the pages the engines already cite, links included - three a month, sold per cluster, tracked on the ${FREE_ENGINE_COUNT} engines the free scan reads plus Claude.`,
  `The ${TIER_PLAIN.cited} plan: link insertions and on-site work so the brand is cited as the source and the Google listing moves, sold per cluster.`,
  `${TIER_PLAIN.everywhere}: earned media, then the answers - brand PR by Nomada Digital's own team. Book a call.`,
  "It closes on the free scan: pick a domain and find out.",
];
