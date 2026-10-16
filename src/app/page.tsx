import type { Metadata } from "next";
import { OG_IMAGE } from "@/config/og";
import HomeHero from "@/components/home/HomeHero";
import TwoWays from "@/components/home/TwoWays";
import ProcessSequence from "@/components/ProcessSequence";
import Packages from "@/components/home/Packages";
import HomeFaq from "@/components/home/HomeFaq";
import Results from "@/components/home/Results";
import Link from "next/link";
import { SHELL, T } from "@/config/tokens";

export const metadata: Metadata = {
  title: "AI SEO agency | AI visibility tools - alwayscited",
  description:
    "Check whether AI engines name your client. A free scan shows who Google AI Overviews and ChatGPT cite for a keyword cluster. Then get placed in them.",
  alternates: { canonical: "https://alwayscited.com" },
  openGraph: {
    images: OG_IMAGE,
    title: "AI SEO agency | AI visibility tools - alwayscited",
    description: "Check whether AI engines name your client. Free scan, then get placed in the sources they cite. Prices on the page.",
    url: "https://alwayscited.com",
  },
};

/* ══════════════════════════════════════════════════════════════ */

export default function HomePage() {
  return (
    <>
      {/* Dark hero, scan field and the engine demo, from Main.dc.html. The
          demo replaces AnswerExplorer. */}
      <HomeHero />

      {/* Two ways into an answer, the rest of Main.dc.html. ScanFacts, the
          phone stand-in for AnswerExplorer, went with it (Q03, 25 Sep). */}
      <TwoWays />

      {/* The four tiers, as four pictures. One explanation of them on this
          page and the same component on the scan waiting screen - there used
          to be two, and they did not agree about what $99 buys. */}
      <ProcessSequence
        heading="Four tiers. Each one adds to the last."
        standfirst="Start with measurement and stop there if you want. Everything above it is the same programme, doing more of the work."
      />

      {/* One text link to the same argument as a video (Q23, 26 Sep 2026).
          Off 28 Sep with the stale cut, back with the re-cut (R118, 29 Sep). */}
      <div style={SHELL}>
        <p style={{ margin: 0, fontSize: "14px" }}>
          <Link href="/how-it-works#video" style={{ fontWeight: 600, textDecoration: "none", color: T.accent }}>
            Watch the 60-second version
          </Link>
        </p>
      </div>

      {/* Packages and white label, from Packages.dc.html. Replaces the
          old pricing table and the separate white-label block. */}
      <Packages />

      <Results />

      {/* FAQ and the closing scan, from HomeFaq.dc.html. Replaces the
          old FAQ block and the navy closing CTA. */}
      <HomeFaq />

    </>
  );
}
