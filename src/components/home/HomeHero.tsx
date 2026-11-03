import { FREE_ENGINE_COUNT, QUESTIONS } from "@/config/scan-shape";
import { T } from "@/config/tokens";
import { scanReady } from "@/lib/scan/readiness";

import { D, HEADER_H, WASH, WASH_SIZE } from "./dark";
import EngineDemo, { word } from "./EngineDemo";
import HeroScanArea from "./HeroScanArea";

/**
 * The homepage hero, from Main.dc.html (25 Sep 2026): dark, centred, the
 * scan field, then the engine demo. /scan keeps HeroSection, which is the
 * light form on its own.
 *
 * The header sits on this ground on `/` and paints the top 66px of the same
 * wash, so this box starts HEADER_H down the board's 1040px image.
 */

export default function HomeHero() {
  return (
    <section
      id="scan"
      className="home-hero"
      style={{
        backgroundColor: D.ground,
        backgroundImage: WASH,
        backgroundSize: WASH_SIZE,
        backgroundPosition: `0 -${HEADER_H}px`,
        backgroundRepeat: "no-repeat",
        color: T.surface,
      }}
    >
      <div style={{ maxWidth: "1180px", margin: "0 auto", padding: "72px 24px 52px", boxSizing: "border-box", textAlign: "center" }}>
        {/* The page's one h1 is the search phrase, read but not painted (Danny,
            25 Sep, R15). The headline below looks exactly as it did as the h1. */}
        <h1 className="sr-only">AI SEO agency</h1>
        <p style={{ margin: 0, fontSize: "clamp(34px, 5vw, 64px)", fontWeight: 700, letterSpacing: "-0.04em", lineHeight: 1.04, color: T.surface }}>
          Every AI tool shows you the gap.
          <br className="hero-break" />{" "}
          <span className="hero-close" style={{ color: D.accent }}>We close it.</span>
        </p>
        <p style={{ margin: "22px auto 0", fontSize: "18px", lineHeight: 1.55, color: D.muted, maxWidth: "52ch" }}>
          We find the pages the answers are built from, then get you named inside them.
        </p>

        <HeroScanArea
          ready={scanReady()}
          questionsLine={`${word(QUESTIONS)} buyer prompts, ${word(FREE_ENGINE_COUNT).toLowerCase()} engines, around two minutes. Free. We email you the report.`}
        />

        <EngineDemo />
      </div>
    </section>
  );
}
