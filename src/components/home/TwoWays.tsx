import { FREE_ENGINE_COUNT } from "@/config/scan-shape";
import { CARD, SHELL, T } from "@/config/tokens";
import SectionHead from "../SectionHead";
import TierName from "../TierName";

/**
 * "Two ways into an answer", from Main.dc.html (25 Sep 2026): join a page that
 * already feeds answers, or create the page that should exist. The second card
 * has the accent border, because creating the missing page is the half nobody
 * else sells.
 *
 * Each card shows its move rather than describing it. On the left, Tallyroo is
 * placed third in a cited round-up and Pennywell drops to fourth; on the right,
 * the missing page draws itself and picks up a ranking and a citation. Every
 * word is DOM text. The motion is the board's 9s loop, and every from-state
 * sits under html[data-motion="on"] in globals.css, so with no JavaScript or
 * reduced motion each card is its settled frame: placed, and cited.
 */

const BRAND = "Tallyroo";

const num: React.CSSProperties = { color: T.soft, display: "inline-block", width: "22px" };
const bar = (width: string, marginTop: string): React.CSSProperties => ({
  height: "6px",
  background: T.hair,
  borderRadius: "3px",
  marginTop,
  width,
});
const pill: React.CSSProperties = {
  fontSize: "11.5px",
  fontWeight: 600,
  borderRadius: "999px",
  padding: "4px 10px",
};

export default function TwoWays() {
  return (
    <section style={{ ...SHELL, paddingTop: "clamp(56px, 7vw, 88px)" }}>
      <SectionHead
        title="Two ways into an answer"
        titleStyle={{ fontSize: "clamp(26px, 3.4vw, 34px)", letterSpacing: "-0.03em" }}
        introStyle={{ fontSize: "15px" }}
        intro={
          <>
            Both are placements on sites we do not own, the pages the answers are built from. The{" "}
            <TierName tier="cited" /> plan adds on-site work on top of them.
          </>
        }
      />

      <div className="ways-grid" role="group" aria-label="Illustrative example">
        <div style={{ ...CARD, padding: "28px" }}>
          <h3 style={{ margin: 0, fontSize: "20px", fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1.3, color: T.ink }}>
            Join a page that already feeds answers
          </h3>
          <p style={{ margin: "8px 0 0", fontSize: "14.5px", lineHeight: 1.55, color: T.soft }}>
            Get into the round-ups the engines already cite. Fastest route, capped by what exists.
          </p>
          <div style={{ marginTop: "22px", border: `1px solid ${T.line}`, borderRadius: "14px", padding: "16px 18px" }}>
            <div style={{ fontSize: "11.5px", color: T.soft }}>solodesk.io · cited by {FREE_ENGINE_COUNT - 1} of {FREE_ENGINE_COUNT} engines</div>
            <div style={{ fontSize: "15px", fontWeight: 700, marginTop: "4px", color: T.ink }}>
              The 9 best invoicing apps for freelancers
            </div>
            <ol style={{ listStyle: "none", margin: "10px 0 0", padding: 0, fontSize: "13.5px", lineHeight: 2, color: T.ink }}>
              <li><span style={num}>1.</span>Ledgerbird</li>
              <li><span style={num}>2.</span>Stackbill</li>
              <li
                className="ways-row-new"
                style={{
                  overflow: "hidden",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  background: T.wash,
                  borderRadius: "8px",
                  margin: "0 -8px",
                  padding: "0 8px",
                  fontWeight: 700,
                  color: T.accentHover,
                }}
              >
                <span><span style={{ display: "inline-block", width: "22px" }}>3.</span>{BRAND}</span>
                <span className="ways-pill-new" style={{ ...pill, fontSize: "11px", color: T.goodFg, background: T.goodBg, padding: "2px 9px", lineHeight: 1.6 }}>
                  Placed
                </span>
              </li>
              <li>
                <span style={{ ...num, position: "relative" }}>
                  <span className="ways-was3" aria-hidden="true">3.</span>
                  <span className="ways-now4" style={{ position: "absolute", left: 0 }}>4.</span>
                </span>
                Pennywell
              </li>
            </ol>
          </div>
        </div>

        <div style={{ ...CARD, border: `1px solid ${T.washLine}`, padding: "28px" }}>
          <h3 style={{ margin: 0, fontSize: "20px", fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1.3, color: T.ink }}>
            Create the page that should exist
          </h3>
          <p style={{ margin: "8px 0 0", fontSize: "14.5px", lineHeight: 1.55, color: T.soft }}>
            Where nobody covers the cut a buyer asks about, we write it on a site with the authority to rank.
          </p>
          <div style={{ marginTop: "22px", border: `1px solid ${T.line}`, borderRadius: "14px", overflow: "hidden" }}>
            <div style={{ background: T.bg, padding: "7px 12px", borderBottom: `1px solid ${T.line}`, fontSize: "11.5px", color: T.soft, overflowWrap: "anywhere" }}>
              freelancefield.com/invoicing-two-currencies
            </div>
            <div className="ways-draw" style={{ padding: "16px 18px" }}>
              <div style={{ fontSize: "15px", fontWeight: 700, color: T.ink }}>
                Best invoicing software for freelancers who bill in two currencies
              </div>
              <div aria-hidden="true" style={bar("94%", "12px")} />
              <div aria-hidden="true" style={bar("80%", "6px")} />
              <div aria-hidden="true" style={bar("60%", "6px")} />
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginTop: "14px" }}>
                <span className="ways-rank" style={{ ...pill, color: T.ink, background: T.chip }}>Google #4</span>
                <span className="ways-rank" style={{ ...pill, color: T.accentHover, background: T.wash, ["--ways-d" as string]: ".15s" }}>
                  Now cited by ChatGPT
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
      <p style={{ margin: "16px 0 0", fontSize: "12px", color: T.soft }}>
        Illustrative. {BRAND} and every brand shown are made up.
      </p>
    </section>
  );
}
