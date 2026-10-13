"use client";

import EngineLogo from "@/components/EngineLogo";
import { T } from "@/config/tokens";
import { OFFER_COPY } from "@/lib/scan/email-offer";
import { type EngineResult, engineVerdict, landingAnnouncement } from "@/lib/scan/engine-results";
import { ENGINE_SPECS, knownEngines } from "@/lib/scan/engines";
import { DRAWING_CAPTION, stepCaption, stepPct } from "@/lib/scan/run-steps";

/**
 * What the scan is actually doing, while it does it.
 *
 * Split out of `HeroSequence` when the eight-act essay was replaced by
 * `ProcessSequence`. The two halves of that component were doing different
 * jobs and only one of them was being replaced: the acts were a pitch, and
 * this is a measurement. Keeping them in one file meant the pitch could not be
 * changed without touching the progress bar, and the progress bar is the one
 * thing on the screen that must not drift.
 *
 * The rule it keeps is the rule it always kept: **the bar is the scan, not the
 * story.** The width comes from the real pipeline step, and the caption under
 * it is that step's own words. Nothing here is driven by whatever the
 * explanation beside it happens to be showing.
 */
export default function ScanProgress(p: {
  domain: string;
  engines: string[];
  /** Questions this run asks, when the page knows. */
  questions?: number | null;
  landed?: EngineResult[];
  step: number;
  slow?: boolean;
  /** The answers are stored and the result is being fetched to draw. */
  drawing?: boolean;
  headingRef?: React.Ref<HTMLHeadingElement>;
}) {
  const pct = stepPct(p.step);
  /**
   * Through `knownEngines`, which dedupes as well as filtering.
   *
   * The chips are keyed on the engine name, so a row whose frozen list repeats
   * one rendered two identical children under one React key - and told the
   * visitor, on the screen they watch for the length of a scan, that it reads
   * more engines than it does. `pipeline.ts` takes the same column through a
   * Set before it asks anything, so this was the page disagreeing with the
   * pass about the same row.
   */
  const engines = knownEngines(p.engines);
  /**
   * The verdicts, keyed by engine, and the last one to arrive.
   *
   * A Map rather than a `find` per chip, and keyed off the parsed rows rather
   * than off anything this component derives: `parseEngineResults` has already
   * refused a row whose numbers cannot be true of one engine, so a chip either
   * has a measurement behind it or shows nothing.
   */
  const verdicts = new Map((p.landed ?? []).map((r) => [r.engine, r]));
  const newest = (p.landed ?? [])[(p.landed?.length ?? 0) - 1];

  /**
   * "Five questions, four engines, 20 answers" on the board, said as prompts
   * (R127, Danny 30 Sep: his newest word overrides the board). Only when this
   * page knows how many questions the run asks - it does after a confirm here,
   * not after a reload mid-run - and in figures, never spelled.
   */
  const counts =
    p.questions && engines.length
      ? ` ${p.questions} prompts, ${engines.length} engines, ${p.questions * engines.length} answers.`
      : "";

  return (
    <div>
      <h1
        ref={p.headingRef}
        tabIndex={-1}
        style={{ margin: 0, fontSize: "30px", fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1.1, color: T.ink, outline: "none", overflowWrap: "anywhere" }}
      >
        {"Scanning " + p.domain}
      </h1>
      <p style={{ margin: "8px 0 0", fontSize: "15px", color: T.soft, lineHeight: 1.5 }}>
        {OFFER_COPY.wait + counts}
      </p>
      <div className="run-chips">
        {/* Each engine's own card, which gains its verdict the moment that
            engine's last question comes back - rather than every chip standing
            there saying nothing until all of them are in.

            The words are `engineVerdict`'s, which are the same three the
            report's question pills use, so the chip a visitor reads here
            cannot say something different from the report that replaces this
            screen half a minute later. The colour is decoration: each verdict
            is distinguishable by its words alone, which is the rule the
            pricing table keeps for the tier names. */}
        {engines.map((key) => {
          const spec = ENGINE_SPECS[key];
          const found = verdicts.get(key);
          return (
            <div
              key={key}
              style={{
                background: T.surface,
                border: "1px solid " + (found ? T.accent : T.line),
                borderRadius: "12px",
                padding: "10px 12px",
                minWidth: 0,
                transition: "border-color .4s ease",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "7px", fontSize: "12.5px", fontWeight: 600, color: T.ink }}>
                <span aria-hidden="true" style={{ display: "grid", placeItems: "center", flexShrink: 0 }}>
                  <EngineLogo engine={key} size={16} inline />
                </span>
                {/* Wraps rather than truncates: "Google AI Overviews" is wider
                    than a quarter of the column at 1280, and a clipped engine
                    name is a claim about which engine was read. */}
                <span style={{ lineHeight: 1.25, minWidth: 0 }}>{spec.label}</span>
              </div>
              {/* The board fills each card on a timer. Here the fill is the
                  run: the pipeline's own step until this engine lands, then
                  full, with the verdict the report will use. */}
              <div style={{ height: "3px", background: T.chip, borderRadius: "2px", marginTop: "9px", overflow: "hidden" }}>
                <div
                  style={{
                    height: "100%",
                    width: (found ? 100 : pct) + "%",
                    background: T.accent,
                    transition: "width .6s ease",
                  }}
                />
              </div>
              {found ? (
                <div style={{ fontSize: "12px", fontWeight: 600, marginTop: "7px", color: found.named > 0 ? T.ink : T.soft }}>
                  {engineVerdict(found)}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      {/* The reveal is a figure appearing beside a label, which is nothing at
          all to a screen reader unless it is said. Only the newest landing, so
          each engine is announced once as it arrives rather than the whole
          list being re-read every time one more lands. */}
      <p aria-live="polite" className="sr-only">
        {newest ? landingAnnouncement(newest) : ""}
      </p>
      <p aria-live="polite" style={{ margin: "10px 0 0", fontSize: "13px", color: T.soft }}>
        {p.drawing ? DRAWING_CAPTION : p.slow ? "This is taking longer than usual. Still working on it." : stepCaption(p.step)}
      </p>
    </div>
  );
}
