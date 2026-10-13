import EngineLogo from "@/components/EngineLogo";
import { T } from "@/config/tokens";
import { FREE_ENGINES, ENGINE_SPECS } from "@/lib/scan/engines";

import { D } from "./dark";

/**
 * The engine demo under the hero, from Main.dc.html. Replaces AnswerExplorer.
 *
 * A buyer question types itself, the free scan's engines answer it one card at
 * a time, each card is stamped "Tallyroo not named", and the verdict lands. The
 * board ends on the miss rather than on the brand arriving - the queue line
 * says otherwise and the board is the later read, so it ends on the miss.
 *
 * Every word is DOM text. The motion is the board's own 12s loop, and every
 * from-state sits under html[data-motion="on"] in globals.css, so with no
 * JavaScript or reduced motion the demo is simply the settled frame: question
 * typed, four cards, four pills, verdict.
 *
 * The engines are FREE_ENGINES, so the cards and the count in the verdict are
 * the engines a free scan actually reads. The rankings are made up, and the
 * line under the verdict says so.
 */

const BRAND = "Tallyroo";
const QUESTION = "best invoicing software for freelancers";
// One ordering per card, by position - the board's four.
const LISTS = [
  ["Ledgerbird", "Stackbill", "Pennywell"],
  ["Stackbill", "Ledgerbird", "Pennywell"],
  ["Ledgerbird", "Pennywell", "Stackbill"],
  ["Stackbill", "Pennywell", "Ledgerbird"],
];
const WORDS = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];
/** A count as a capitalised word, for the counts the hero prints from scan-shape. */
export const word = (n: number) => WORDS[n] ?? String(n);

function Mark({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true" style={{ display: "block", flex: "none" }}>
      <g stroke={D.accent} strokeWidth="4.5" strokeLinecap="round">
        <line x1="16" y1="4.5" x2="16" y2="27.5" />
        <line x1="6.041" y1="10.25" x2="25.959" y2="21.75" />
        <line x1="25.959" y1="10.25" x2="6.041" y2="21.75" />
      </g>
    </svg>
  );
}

export default function EngineDemo() {
  const countWord = word(FREE_ENGINES.length);

  return (
    <div className="demo" aria-label="Illustrative example" role="group" style={{ maxWidth: "1020px", margin: "64px auto 0" }}>
      <div
        className="demo-ask"
        style={{
          // The board's 560px is content-box; this is the same box, border-box.
          maxWidth: "594px",
          margin: "0 auto",
          display: "flex",
          alignItems: "center",
          gap: "12px",
          background: D.field,
          border: `1px solid ${D.fieldLine}`,
          borderRadius: "999px",
          padding: "12px 12px 12px 20px",
          boxSizing: "border-box",
        }}
      >
        <Mark size={16} />
        <span style={{ flexGrow: 1, minWidth: 0, fontSize: "16px", color: T.surface, textAlign: "left", display: "flex", alignItems: "center" }}>
          <span className="demo-typed">{QUESTION}</span>
          <span className="demo-caret" aria-hidden="true" style={{ background: D.caret }} />
        </span>
        <span
          aria-hidden="true"
          style={{ width: "30px", height: "30px", borderRadius: "50%", background: T.accent, display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={T.surface} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 19V5M5 12l7-7 7 7" />
          </svg>
        </span>
      </div>

      <div className="demo-grid">
        {FREE_ENGINES.map((engine, i) => (
          <div
            key={engine}
            className="demo-card"
            style={{
              ["--demo-d" as string]: `${i * 0.15}s`,
              background: D.card,
              border: `1px solid ${D.cardLine}`,
              borderRadius: "16px",
              padding: "16px 16px 14px",
              textAlign: "left",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12.5px", fontWeight: 600, color: D.cardHead }}>
              <EngineLogo engine={engine} size={18} inline />
              {ENGINE_SPECS[engine].label}
            </div>
            <div aria-hidden="true" style={{ height: "6px", background: D.bar, borderRadius: "3px", marginTop: "14px", width: "92%" }} />
            <div aria-hidden="true" style={{ height: "6px", background: D.bar, borderRadius: "3px", marginTop: "6px", width: "68%" }} />
            <ol style={{ listStyle: "none", margin: "14px 0 0", padding: 0, fontSize: "14px", lineHeight: 1.9, color: T.surface }}>
              {LISTS[i % LISTS.length]!.map((name, n) => (
                <li key={name}>
                  <span style={{ color: T.faint, display: "inline-block", width: "20px" }}>{n + 1}.</span>
                  {name}
                </li>
              ))}
            </ol>
            <div
              className="demo-miss"
              style={{
                display: "inline-block",
                marginTop: "12px",
                fontSize: "11.5px",
                fontWeight: 600,
                color: D.missFg,
                background: D.missBg,
                borderRadius: "999px",
                padding: "4px 10px",
              }}
            >
              {BRAND} not named
            </div>
          </div>
        ))}
      </div>

      <p className="demo-verdict" style={{ textAlign: "center", margin: "34px 0 0", fontSize: "clamp(22px, 3vw, 30px)", fontWeight: 700, letterSpacing: "-0.03em", color: T.surface }}>
        {countWord} AI engines. Not one named {BRAND}.
      </p>
      <p style={{ textAlign: "center", margin: "10px 0 0", fontSize: "12px", color: T.faint }}>
        Illustrative. {BRAND} and every brand shown are made up. Your scan uses your own questions.
      </p>
    </div>
  );
}
