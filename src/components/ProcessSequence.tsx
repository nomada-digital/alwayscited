"use client";

import { Fragment, useEffect, useLayoutEffect, useState } from "react";

import EngineLogo from "@/components/EngineLogo";
import TierName, { TierText, type TierKey } from "@/components/TierName";
import { TIERS, TRACKED_CLUSTERS, TRACKED_PROMPTS } from "@/config/pricing";
import { FREE_ENGINE_COUNT } from "@/config/scan-shape";
import { CARD, MICRO, SHELL, T } from "@/config/tokens";
import { ENGINE_SPECS, FREE_ENGINES } from "@/lib/scan/engines";
import { PROMPTS_PER_CLUSTER } from "@/lib/tracking/limits";

import { beatMsFor, seqStep } from "./scan/seq-stagger";

/**
 * The four tiers, as the launch video tells them.
 *
 * Built from `boards/Journey.dc.html` in the 25 September 2026 site brief. One
 * component in two places - the homepage and the scan waiting screen - because
 * there were two explanations of the same four tiers and they did not say the
 * same thing.
 *
 * ## The shape, and why it is two columns now
 *
 * The board puts the argument on the left (lockup, headline, one line, price
 * and basis) and the proof on the right, in a white product panel that builds
 * within its own beat. That split is the point: the left column is what we
 * claim and the right column is the screen you would actually get, so a reader
 * can check one against the other without leaving the tier.
 *
 * ## Timing, and the one number not to take from the board
 *
 * **16s a tier plus a 5s bridge, so 21s a tier and 84s a loop.** The board
 * runs 10s a tier over a 40s loop and that is **compressed for review** -
 * Danny's correction, 25 September 2026. Do not copy it into the site.
 *
 * The live figure is N3's and it was set against the complaint that started
 * all of this: at 3.5s the sequence "whips through each tier faster than
 * anyone can read it". A board is watched by someone who already knows what it
 * says; a visitor is reading it for the first time, while a scan runs. The
 * bridge is additional to the tier's 16s rather than inside it, so a typical
 * ~100s scan sees the story through about once and lands on its result.
 *
 * ## Three rules it keeps
 *
 * - **Take the motion away and the argument survives.** With no
 *   `html[data-motion="on"]` - a crawler, motion off, JavaScript off - all
 *   four tiers render stacked and fully readable, the bridges become plain
 *   cards between them, and the rail is gone rather than dead. Every hidden
 *   start state is scoped under that attribute.
 * - **Every word is real DOM text.** Nothing here is an image. The engines we
 *   are asking a buyer to care about have to be able to read the page.
 * - **Every figure is illustrative and says so.** Tallyroo and every brand in
 *   these panels are invented. `client-results.ts` holds the numbers that are
 *   attested, and none of them appear here.
 */

/**
 * The pace, a prop since 25 Sep 2026 (QF2). Each panel builds, then holds until
 * `beatMs`; the bridge then hands over for `bridgeMs`. Inside a tier the first
 * step lands at `firstStepS`, then one every `stepS`.
 */
export type Tempo = {
  beatMs: number;
  bridgeMs: number;
  stepS: number;
  firstStepS: number;
  /**
   * When set, each tier's beat is its own build time plus this many seconds,
   * and `beatMs` is only what it is until the panels have been measured. Unset,
   * every beat is `beatMs`: the homepage.
   */
  holdS?: number;
};

/** The homepage: 16s a beat and 5s bridges, about 79s round. */
export const HOME_TEMPO: Tempo = { beatMs: 16_000, bridgeMs: 5_000, stepS: 1.2, firstStepS: 1.6 };

/**
 * The scan waiting screen. The parts arrive at half the homepage interval and
 * the bridges are 2.7s (Danny, 25 Sep 2026). Since 2 Oct 2026 a beat is not a
 * fixed 8s: it ends one second after its own panel has finished building, so
 * the four tiers run 9.6s, 5.4s, 4.2s and 4.8s and a loop is about 32s. The 8s
 * had the first tier cut off as its last row began (that row lands at 8.0s) and
 * left the other three standing still for three to four seconds each, which
 * read as the animation having stopped. `beatMs` is the length until the
 * panels are measured, and the length if they cannot be.
 */
export const WAITING_TEMPO: Tempo = { beatMs: 8_000, bridgeMs: 2_700, stepS: 0.6, firstStepS: 0.8, holdS: 1 };

/**
 * What a day of alwaystracked covers, derived rather than typed.
 *
 * `TRACKED_CLUSTERS` and `TRACKED_PROMPTS` are what `pricing.ts` publishes as
 * what the tracking price buys (R112, 29 Sep 2026), and the day's answer total
 * is the prompts times the engine set. One cluster's answers are its prompts
 * times the same set. Counts like these were once typed into this panel until
 * `copy.test.mts` caught them - which is the whole point of that rule: the
 * free engine set has changed once already, and every typed count of it was
 * true when it was written.
 */
const DAILY_ANSWERS = TRACKED_PROMPTS * FREE_ENGINE_COUNT;
const CLUSTER_ANSWERS = PROMPTS_PER_CLUSTER * FREE_ENGINE_COUNT;
/** Illustrative: how many of today's answers name the subject. */
const NAMED_COUNT = 30;
const NAMED_SHARE = Math.round((NAMED_COUNT / DAILY_ANSWERS) * 100);
/** Illustrative: engines citing the subject's own page on the cited tier. */
const CITED_BY = 3;

/** The invented brand every panel is about, and the question it is judged on. */
const SUBJECT = "Tallyroo";
const RIVALS = ["Ledgerbird", "Stackbill"] as const;
const ASK = "best invoicing software for freelancers";
/** The Google keyword the tracked cluster is joined to, and its illustrative position. */
const KEYWORD = { term: "invoicing software for freelancers", now: 7, was: 9 };

type Beat = {
  tier: TierKey;
  /** The board's headline, set big on the left. */
  headline: string;
  /** The sentence under it. */
  line: string;
  /** What the panel shows, for a screen reader - the panel is a drawing. */
  alt: string;
};

const BEATS: Beat[] = [
  {
    tier: "tracked",
    headline: "See every placement opportunity.",
    line: `Buyer prompts put to ${FREE_ENGINE_COUNT} AI engines every day, with every source behind every answer.`,
    alt: `A daily tracking dashboard for ${SUBJECT}: ${TRACKED_CLUSTERS} clusters, ${TRACKED_PROMPTS} prompts across ${FREE_ENGINE_COUNT} engines, ${NAMED_SHARE}% of today's ${DAILY_ANSWERS} answers naming it, one cluster's prompt angles joined to the Google keyword "${KEYWORD.term}" at #${KEYWORD.now}, up from #${KEYWORD.was}, and the brands named instead in that cluster's ${CLUSTER_ANSWERS} answers.`,
  },
  {
    tier: "mentioned",
    headline: "We place you in the answers.",
    line: "Placements in the pages the engines already cite, links included. Three a month, on one topic.",
    alt: `The pages the engines cite for one buyer question, and the answers that now name ${SUBJECT}.`,
  },
  {
    tier: "cited",
    headline: "Cited as the source, and first.",
    line: "Link insertions and on-site work go after the Google listing as well as the answer, with your own page as the source.",
    alt: `${SUBJECT}'s own page cited by ${CITED_BY} of ${FREE_ENGINE_COUNT} engines, and its Google position moving from #9 to #1.`,
  },
  {
    tier: "everywhere",
    // Pricing spec 27 Sep, section 8: brand PR and earned media, not a portfolio.
    headline: "Earned media, then the answers.",
    line: "Brand PR on top of everything else: coverage in the publications buyers read, tracked into the answers it reaches.",
    alt: `Three pieces of coverage for ${SUBJECT} in made-up publications, and the answers that name it with one as a source.`,
  },
];

/** The question that hands over to the next tier, from the board. */
const BRIDGES: Partial<Record<TierKey, { ask: string; to: TierKey }>> = {
  tracked: { ask: "Found the gaps. Want to be in them?", to: "mentioned" },
  mentioned: { ask: "Want the Google listing to move too?", to: "cited" },
  cited: { ask: "Want coverage you cannot buy?", to: "everywhere" },
};

const tierOf = (key: TierKey) => TIERS.find((t) => t.key === key);

/**
 * The product panel's own ground: white, floating, with the video's soft
 * shadow. The brief allows a shadow here and nowhere else - everything else on
 * this site keeps hairlines.
 */
const PANEL: React.CSSProperties = {
  ...CARD,
  background: T.surface,
  borderRadius: "18px",
  padding: "18px 20px",
  boxShadow: "0 18px 48px -24px rgba(15,17,21,.28)",
};

const pill = (bg: string, fg: string): React.CSSProperties => ({
  fontSize: "11px",
  fontWeight: 600,
  padding: "3px 10px",
  borderRadius: "999px",
  background: bg,
  color: fg,
  whiteSpace: "nowrap",
});

const hair = "1px solid " + T.hair;

/** A panel's header: the brand mark, its name, and what it is counting. */
function PanelHead(p: { note: string; badge?: string }) {
  return (
    <div
      {...seqStep(0, {
        display: "flex",
        alignItems: "center",
        gap: "10px",
        paddingBottom: "12px",
        borderBottom: hair,
      })}
    >
      <span
        aria-hidden="true"
        style={{
          width: "26px",
          height: "26px",
          borderRadius: "8px",
          background: T.ink,
          color: T.surface,
          display: "grid",
          placeItems: "center",
          fontSize: "13px",
          fontWeight: 700,
          flexShrink: 0,
        }}
      >
        {SUBJECT[0]}
      </span>
      <span>
        <span style={{ display: "block", fontSize: "13.5px", fontWeight: 700 }}>{SUBJECT}</span>
        <span style={{ display: "block", fontSize: "11.5px", color: T.soft }}>{p.note}</span>
      </span>
      <span style={{ flexGrow: 1 }} />
      {p.badge ? <span style={pill(T.wash, T.accent)}>{p.badge}</span> : null}
    </div>
  );
}

/* -- Tier 1: where you stand ------------------------------------- */

/**
 * One cluster: its prompt angles, and which engine named the brand on each.
 * Positions into FREE_ENGINES. From TrackedCluster.dc.html (29 Sep 2026, R115):
 * the prompt list became one cluster joined to a keyword and its Google position.
 */
const CLUSTER_ANGLES: { angle: string; named: number[] }[] = [
  { angle: "Category", named: [0, 1] },
  { angle: "Positioning", named: [0, 1, 2] },
  { angle: "Sector", named: [] },
  { angle: "Outcome", named: [0] },
  { angle: "Comparison", named: [] },
];

/** The subject's count in the cluster is the dots above, not a second typed figure. */
const CLUSTER_NAMED = CLUSTER_ANGLES.reduce((sum, a) => sum + a.named.length, 0);

const NAMED_INSTEAD: { brand: string; of: number; you?: boolean }[] = [
  { brand: RIVALS[0], of: 11 },
  { brand: RIVALS[1], of: 9 },
  { brand: SUBJECT, of: CLUSTER_NAMED, you: true },
];

/** One angle row's height; the connectors are drawn to the same grid. */
const ANGLE_ROW = 24;
const ANGLE_GRID = `72px repeat(${FREE_ENGINES.length}, 20px)`;

function BeatTracked() {
  return (
    <div style={PANEL}>
      <PanelHead note={`${TRACKED_CLUSTERS} clusters, ${TRACKED_PROMPTS} prompts across ${FREE_ENGINE_COUNT} engines`} badge="Today, 06:10" />

      <div {...seqStep(1, { display: "flex", alignItems: "baseline", gap: "12px", padding: "14px 0 4px", flexWrap: "wrap" })}>
        <span style={{ fontSize: "34px", fontWeight: 700, letterSpacing: "-0.035em", lineHeight: 1 }}>{NAMED_SHARE}%</span>
        <span style={{ fontSize: "12.5px", color: T.soft }}>{`of today's ${DAILY_ANSWERS} answers name ${SUBJECT}`}</span>
        <span className="proc-opps-gap" style={{ flexGrow: 1 }} />
        <span className="proc-opps">
          <span style={{ fontSize: "11.5px", color: T.soft }}>Placement opportunities</span>
          <span style={{ fontSize: "20px", fontWeight: 700, color: T.accent, lineHeight: 1.2 }}>9</span>
        </span>
      </div>

      {/* One cluster: its prompt angles on the left, joined by a line each to
          the Google keyword they share. A line is solid where that angle
          named the subject on any engine, dashed where none did. */}
      <div style={{ marginTop: "12px", paddingTop: "12px", borderTop: hair }}>
        <div
          {...seqStep(2, {
            display: "grid",
            gridTemplateColumns: ANGLE_GRID,
            columnGap: "6px",
            paddingBottom: "6px",
          })}
        >
          <span style={{ fontSize: "10.5px", fontWeight: 600, color: T.soft }}>Angle</span>
          {FREE_ENGINES.map((e) => (
            <span key={e} title={ENGINE_SPECS[e].label} style={{ display: "grid", placeItems: "center" }}>
              <EngineLogo engine={e} size={12} inline />
              <span className="sr-only">{ENGINE_SPECS[e].label}</span>
            </span>
          ))}
        </div>

        <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", rowGap: "10px" }}>
          <div style={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
            <div>
              {CLUSTER_ANGLES.map((a, n) => (
                <div
                  key={a.angle}
                  {...seqStep(3 + n, {
                    display: "grid",
                    gridTemplateColumns: ANGLE_GRID,
                    columnGap: "6px",
                    alignItems: "center",
                    height: ANGLE_ROW + "px",
                  })}
                >
                  <span style={{ fontSize: "10.5px", fontWeight: 700, letterSpacing: ".03em", textTransform: "uppercase", color: T.soft }}>
                    {a.angle}
                  </span>
                  {FREE_ENGINES.map((e, i) => (
                    <span key={e} style={{ display: "grid", placeItems: "center" }}>
                      <span
                        aria-hidden="true"
                        style={{
                          width: "9px",
                          height: "9px",
                          boxSizing: "border-box",
                          borderRadius: "50%",
                          background: a.named.includes(i) ? T.accent : "transparent",
                          border: a.named.includes(i) ? undefined : "1px solid " + T.line,
                        }}
                      />
                      <span className="sr-only">
                        {ENGINE_SPECS[e].label}: {a.named.includes(i) ? `named ${SUBJECT}` : `did not name ${SUBJECT}`}
                      </span>
                    </span>
                  ))}
                </div>
              ))}
            </div>
            <svg
              {...seqStep(3 + CLUSTER_ANGLES.length, { flexShrink: 0 })}
              width="48"
              height={CLUSTER_ANGLES.length * ANGLE_ROW}
              viewBox={`0 0 48 ${CLUSTER_ANGLES.length * ANGLE_ROW}`}
              aria-hidden="true"
            >
              {CLUSTER_ANGLES.map((a, n) => {
                const y = n * ANGLE_ROW + ANGLE_ROW / 2;
                const mid = (CLUSTER_ANGLES.length * ANGLE_ROW) / 2;
                const hit = a.named.length > 0;
                return (
                  <path
                    key={a.angle}
                    d={`M0,${y} C26,${y} 22,${mid} 48,${mid}`}
                    fill="none"
                    stroke={hit ? T.accent : T.faint}
                    strokeOpacity={hit ? 0.55 : 0.6}
                    strokeWidth="1.5"
                    strokeDasharray={hit ? undefined : "3 3"}
                  />
                );
              })}
              <circle cx="45" cy={(CLUSTER_ANGLES.length * ANGLE_ROW) / 2} r="3.5" fill={T.accent} />
            </svg>
          </div>

          <div
            {...seqStep(3 + CLUSTER_ANGLES.length, {
              flex: "1 1 150px",
              minWidth: 0,
              boxSizing: "border-box",
              padding: "12px 14px",
              borderRadius: "12px",
              border: "1px solid " + T.washLine,
              background: T.wash,
              display: "flex",
              flexDirection: "column",
              gap: "3px",
            })}
          >
            <span style={{ fontSize: "10.5px", fontWeight: 600, color: T.soft }}>Google keyword</span>
            <span style={{ fontSize: "13px", fontWeight: 700, color: T.ink }}>{KEYWORD.term}</span>
            <span style={{ display: "flex", alignItems: "baseline", gap: "6px" }}>
              <span style={{ fontSize: "24px", fontWeight: 700, letterSpacing: "-0.03em" }}>#{KEYWORD.now}</span>
              <span style={{ fontSize: "11.5px", fontWeight: 600, color: T.accentHover }}>was #{KEYWORD.was}</span>
            </span>
          </div>
        </div>
      </div>

      <div {...seqStep(4 + CLUSTER_ANGLES.length, { marginTop: "12px", paddingTop: "10px", borderTop: hair })}>
        <div style={MICRO}>{`Named instead, of this cluster's ${CLUSTER_ANSWERS} answers`}</div>
        {NAMED_INSTEAD.map((b, n) => (
          <div
            key={b.brand}
            {...seqStep(5 + CLUSTER_ANGLES.length + n, { display: "flex", alignItems: "center", gap: "10px", marginTop: "6px" })}
          >
            <span style={{ fontSize: "12px", fontWeight: 700, color: b.you ? T.accent : T.ink, width: "80px", flexShrink: 0 }}>
              {b.brand}
            </span>
            <span aria-hidden="true" style={{ flexGrow: 1, height: "7px", borderRadius: "4px", background: T.line, overflow: "hidden" }}>
              <span
                style={{ display: "block", height: "100%", width: Math.round((b.of / CLUSTER_ANSWERS) * 100) + "%", background: b.you ? T.accent : "#c9ccd3" }}
              />
            </span>
            <span style={{ fontSize: "12px", fontWeight: 700, width: "22px", textAlign: "right" }}>{b.of}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* -- Tier 2: the placement --------------------------------------- */

const CITED_PAGES: { site: string; note: string; ours?: boolean }[] = [
  { site: "solodesk.io", note: "Placement, links to you", ours: true },
  { site: "invoicingguide.co", note: "Round-up the engines quote" },
  { site: "freelancefield.com", note: "Comparison page" },
];

function BeatMentioned() {
  return (
    <div style={PANEL}>
      <PanelHead note={`Pages the engines cite for "${ASK}"`} />

      <div style={{ marginTop: "12px" }}>
        {CITED_PAGES.map((c, n) => (
          <div
            key={c.site}
            {...seqStep(1 + n, {
              display: "flex",
              alignItems: "center",
              gap: "10px",
              padding: "9px 11px",
              marginTop: n ? "6px" : 0,
              borderRadius: "10px",
              background: c.ours ? T.wash : T.bg,
              border: "1px solid " + (c.ours ? T.washLine : T.line),
              flexWrap: "wrap",
            })}
          >
            <span style={{ fontSize: "12.5px", fontWeight: 600, color: T.ink }}>{c.site}</span>
            <span style={{ fontSize: "12px", color: T.soft }}>{c.note}</span>
            <span style={{ flexGrow: 1 }} />
            {c.ours ? <span style={pill(T.goodBg, T.goodFg)}>yours</span> : null}
          </div>
        ))}
      </div>

      <div {...seqStep(4, { marginTop: "14px", paddingTop: "12px", borderTop: hair })}>
        <div style={MICRO}>Answers naming {SUBJECT}</div>
        <div style={{ display: "flex", alignItems: "baseline", gap: "10px", marginTop: "6px" }}>
          <span style={{ fontSize: "28px", fontWeight: 700, letterSpacing: "-0.03em", color: T.accent, lineHeight: 1 }}>3</span>
          <span style={{ fontSize: "12.5px", color: T.soft }}>of {FREE_ENGINE_COUNT}, on this question</span>
        </div>
      </div>

      <div {...seqStep(5, { display: "flex", alignItems: "center", gap: "8px", marginTop: "12px", flexWrap: "wrap" })}>
        {FREE_ENGINES.slice(0, 3).map((e) => (
          <span
            key={e}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "4px 10px 4px 6px",
              borderRadius: "999px",
              background: T.surface,
              border: "1px solid " + T.accent,
            }}
          >
            <EngineLogo engine={e} size={13} inline />
            <span style={{ fontSize: "11.5px", color: T.ink }}>names {SUBJECT}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/* -- Tier 3: cited, and first ------------------------------------ */

function BeatCited() {
  return (
    <div style={PANEL}>
      <PanelHead note="Your pages, made citable" />

      <div {...seqStep(1, { marginTop: "12px", padding: "11px 13px", borderRadius: "10px", background: T.wash, border: "1px solid " + T.washLine })}>
        <div style={{ fontSize: "12.5px", fontWeight: 600 }}>tallyroo.com/invoicing</div>
        <div style={{ fontSize: "12px", color: T.soft, marginTop: "2px" }}>Invoicing for freelancers</div>
        <div style={{ display: "flex", alignItems: "center", gap: "7px", marginTop: "8px", flexWrap: "wrap" }}>
          {FREE_ENGINES.slice(0, CITED_BY).map((e) => (
            <EngineLogo key={e} engine={e} size={14} title={ENGINE_SPECS[e].label} inline />
          ))}
          <span style={{ fontSize: "11.5px", color: T.soft }}>cited by {CITED_BY} of {FREE_ENGINE_COUNT} engines</span>
        </div>
      </div>

      <div {...seqStep(2, { marginTop: "14px", paddingTop: "12px", borderTop: hair })}>
        <div style={MICRO}>Google position</div>
        <div style={{ display: "flex", alignItems: "center", gap: "12px", marginTop: "8px" }}>
          <span style={{ fontSize: "22px", fontWeight: 700, color: T.soft, textDecoration: "line-through", letterSpacing: "-0.03em" }}>#9</span>
          <span aria-hidden="true" style={{ fontSize: "15px", color: T.soft }}>&rarr;</span>
          <span style={{ fontSize: "32px", fontWeight: 700, color: T.accent, letterSpacing: "-0.035em", lineHeight: 1 }}>#1</span>
        </div>
      </div>

      <div {...seqStep(3, { marginTop: "14px", paddingTop: "12px", borderTop: hair })}>
        <div style={MICRO}>Schema added to tallyroo.com</div>
        <pre className="proc-schema">{`"@type": "SoftwareApplication",
"applicationCategory": "Invoicing",
"sameAs": ["solodesk.io/best-invoicing"]`}</pre>
      </div>
    </div>
  );
}

/* -- Tier 4: coverage, then the answers ----------------------------
 * Pricing spec 27 Sep, section 8: the beat was a three-client portfolio. It is
 * now the PR agencies fan-out in this panel's language - coverage landing
 * across publications, then which answers read each piece. One piece reaches
 * no engine, as on /pr-agencies: coverage is not promised to reach anything.
 */

const COVERAGE: { outlet: string; title: string; readBy: number }[] = [
  { outlet: "Trade title", title: `${SUBJECT} adds multi-currency invoicing`, readBy: 3 },
  { outlet: "National", title: "The startups fixing freelancer pay", readBy: 2 },
  { outlet: "Regional press", title: "Leeds firm announces 40 roles", readBy: 0 },
];

function BeatEverywhere() {
  const reached = COVERAGE.filter((c) => c.readBy > 0).length;
  return (
    <div style={PANEL}>
      <div {...seqStep(0, { paddingBottom: "12px", borderBottom: hair })}>
        <div style={{ fontSize: "13.5px", fontWeight: 700 }}>Coverage for {SUBJECT}</div>
        <div style={{ fontSize: "11.5px", color: T.soft, marginTop: "2px" }}>
          Engines citing each piece, out of {FREE_ENGINE_COUNT}
        </div>
      </div>

      {COVERAGE.map((c, n) => (
        <div
          key={c.title}
          {...seqStep(1 + n, {
            display: "flex",
            alignItems: "center",
            gap: "10px",
            padding: "10px 0",
            borderBottom: n === COVERAGE.length - 1 ? undefined : hair,
            flexWrap: "wrap",
            opacity: c.readBy ? 1 : 0.6,
          })}
        >
          <span style={{ minWidth: 0, flex: "1 1 180px" }}>
            <span style={{ display: "block", fontSize: "11px", color: T.soft }}>{c.outlet}</span>
            <span style={{ display: "block", fontSize: "12.5px", fontWeight: 600, marginTop: "2px" }}>{c.title}</span>
          </span>
          {c.readBy ? (
            <span style={{ display: "flex", alignItems: "center", gap: "5px" }}>
              {FREE_ENGINES.map((e, i) => (
                <span key={e} style={{ opacity: i < c.readBy ? 1 : 0.25, display: "flex" }}>
                  <EngineLogo engine={e} size={14} title={ENGINE_SPECS[e].label} inline />
                </span>
              ))}
            </span>
          ) : (
            <span style={{ fontSize: "11.5px", fontWeight: 600, color: T.soft }}>Read by no engine</span>
          )}
        </div>
      ))}

      <div {...seqStep(4, { marginTop: "12px", paddingTop: "10px", borderTop: hair, display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" })}>
        <span style={pill(T.wash, T.accent)}>
          {reached} of {COVERAGE.length} pieces in the answers
        </span>
        <span style={{ fontSize: "12px", color: T.soft }}>matched URL for URL</span>
      </div>
    </div>
  );
}

const BODIES: Record<TierKey, () => React.JSX.Element> = {
  tracked: BeatTracked,
  mentioned: BeatMentioned,
  cited: BeatCited,
  everywhere: BeatEverywhere,
};

/**
 * The sequence.
 *
 * `heading` is what tells the two callers apart. The homepage calls this as a
 * page section, so it gets the site shell and the board's own headline; the
 * waiting screen drops it inside a shell it already has, under a progress
 * block that already carries the heading, so it takes neither.
 */
export default function ProcessSequence(p: {
  heading?: string;
  standfirst?: string;
  tempo?: Tempo;
  /**
   * Whether the pointer resting on the panel pins the tier. On by default, as
   * the homepage reads it. Off on the waiting screen (Danny, 2 Oct 2026: the
   * animation "stopped for a while on the alwaysmentioned screen"): there the
   * pointer is nearly always over the panel, or crosses it on every scroll, so
   * hover locked the loop on whichever tier was showing for the rest of the
   * scan. A click on a tier, or a key in the rail, still pins.
   */
  pinOnHover?: boolean;
}) {
  const tempo = p.tempo ?? HOME_TEMPO;
  const { beatMs: BEAT_MS, bridgeMs: BRIDGE_MS, stepS: STEP_S, firstStepS: FIRST_STEP_S, holdS: HOLD_S } = tempo;
  const [beat, setBeat] = useState(0);
  /** The largest step each tier's panel renders, read off the DOM once. */
  const [lastSteps, setLastSteps] = useState<Partial<Record<TierKey, number>>>({});
  /** Between tiers, the bridge card for the tier that just finished. */
  const [bridging, setBridging] = useState(false);
  /** Taken by a click or a hover; "Play all four" is the only way back. */
  const [held, setHeld] = useState(false);

  /**
   * Read how many steps each panel has, before the first paint. All four are
   * in the DOM from the start (the idle ones are only hidden), and `--ac-i` is
   * an inline custom property, so this reads no layout. Done in a layout
   * effect so the first tier's bar starts with its real length rather than
   * being corrected a frame in.
   */
  useLayoutEffect(() => {
    if (HOLD_S === undefined) return;
    const next: Partial<Record<TierKey, number>> = {};
    for (const b of BEATS) {
      let last = 0;
      document.querySelectorAll<HTMLElement>("#proc-beat-" + b.tier + " .seq-step").forEach((el) => {
        const i = Number(el.style.getPropertyValue("--ac-i"));
        if (Number.isFinite(i) && i > last) last = i;
      });
      next[b.tier] = last;
    }
    setLastSteps(next);
  }, [HOLD_S]);

  /** This tier's beat: its own build plus the hold, or the fixed length. */
  const beatMsOf = (tier: TierKey) => {
    const last = lastSteps[tier];
    return HOLD_S === undefined || last === undefined ? BEAT_MS : beatMsFor(tempo, last, HOLD_S);
  };
  const thisBeatMs = beatMsOf(BEATS[beat].tier);

  useEffect(() => {
    if (held) return;
    if (typeof window === "undefined") return;
    // The same gate `Motion.tsx` applies before it sets data-motion. Without
    // it the tiers would still be cycling under a reader who asked for no
    // motion, while the CSS has already stacked all four for them.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const hasBridge = Boolean(BRIDGES[BEATS[beat].tier]);
    const t = setTimeout(
      () => {
        if (!bridging && hasBridge) setBridging(true);
        else {
          setBridging(false);
          setBeat((n) => (n + 1) % BEATS.length);
        }
      },
      bridging ? BRIDGE_MS : thisBeatMs,
    );
    return () => clearTimeout(t);
  }, [beat, bridging, held, thisBeatMs, BRIDGE_MS]);

  /** Pin a tier. Hover pins too: a story that moves on while you read is worse. */
  const hold = () => setHeld(true);

  /** How long the active tab's bar takes to fill: its tier plus its bridge. */
  const fillMs = thisBeatMs + (BRIDGES[BEATS[beat].tier] ? BRIDGE_MS : 0);
  const current = BEATS[beat];
  const currentTier = tierOf(current.tier);

  const body = (
    <div
      className="proc"
      onMouseEnter={p.pinOnHover === false ? undefined : hold}
      onFocusCapture={hold}
      style={{ ["--proc-step" as string]: STEP_S + "s", ["--proc-first" as string]: FIRST_STEP_S + "s" } as React.CSSProperties}
    >
      {p.heading ? (
        <div className="proc-head">
          <h2 style={{ margin: 0, fontSize: "34px", fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1.1 }}>
            {p.heading}
          </h2>
          {p.standfirst ? (
            <p style={{ margin: 0, fontSize: "15px", lineHeight: 1.6, color: T.soft, maxWidth: "46ch" }}>
              {p.standfirst}
            </p>
          ) : null}
        </div>
      ) : null}

      {/* The rail. It is gone rather than dead when motion is off, because all
          four tiers are on the page then and there is nothing to move between.
          The control is 44px tall for WCAG 2.5.8 even though the mark in it is
          3px. The active bar fills over the tier's time, so a reader can see
          how long they have; once the reader takes over it is simply full. */}
      {/* R151 (1 Oct 2026): one Tab stop, as the WAI-ARIA APG tabs pattern
          has it - only the playing tier is tabbable, and the arrows, Home and
          End move between tiers, selecting as they go. Four stops with no
          arrows was what docs/parity/r151-flow-keys.mjs found on the waiting
          screen. */}
      <div
        className="proc-rail"
        role="tablist"
        aria-label="The four tiers"
        onKeyDown={(e) => {
          const last = BEATS.length - 1;
          const to =
            e.key === "ArrowRight" ? (beat === last ? 0 : beat + 1)
            : e.key === "ArrowLeft" ? (beat === 0 ? last : beat - 1)
            : e.key === "Home" ? 0
            : e.key === "End" ? last
            : null;
          if (to === null) return;
          e.preventDefault();
          setBeat(to);
          setBridging(false);
          hold();
          document.getElementById("proc-tab-" + BEATS[to].tier)?.focus();
        }}
      >
        {BEATS.map((b, n) => (
          <button
            key={b.tier}
            type="button"
            role="tab"
            id={"proc-tab-" + b.tier}
            aria-controls={"proc-beat-" + b.tier}
            aria-selected={n === beat}
            tabIndex={n === beat ? 0 : -1}
            onClick={() => {
              setBeat(n);
              setBridging(false);
              hold();
            }}
            style={{
              flexGrow: 1,
              border: 0,
              padding: "4px 0",
              minHeight: "44px",
              appearance: "none",
              background: "transparent",
              cursor: "pointer",
            }}
          >
            {/* The board rings the tier that is playing. */}
            <span
              style={{
                display: "inline-block",
                fontSize: "14px",
                fontWeight: 600,
                letterSpacing: "-0.018em",
                padding: "7px 12px",
                borderRadius: "999px",
                border: "1px solid " + (n === beat ? T.accent : "transparent"),
              }}
            >
              <TierName tier={b.tier} />
            </span>
            <span
              aria-hidden="true"
              style={{
                display: "block",
                height: "3px",
                borderRadius: "3px",
                marginTop: "9px",
                background: T.line,
                overflow: "hidden",
              }}
            >
              {n === beat ? (
                <span
                  key={beat + (held ? "-held" : "")}
                  className={held ? undefined : "proc-fill"}
                  style={
                    {
                      display: "block",
                      height: "100%",
                      background: T.accent,
                      ["--proc-fill" as string]: fillMs + "ms",
                    } as React.CSSProperties
                  }
                />
              ) : null}
            </span>
          </button>
        ))}
      </div>

      <div className="proc-beats">
        {BEATS.map((b, n) => {
          const bTier = tierOf(b.tier);
          const Body = BODIES[b.tier];
          const bridge = BRIDGES[b.tier];
          const on = n === beat;
          return (
            <Fragment key={b.tier}>
              <div
                id={"proc-beat-" + b.tier}
                role="tabpanel"
                aria-labelledby={"proc-tab-" + b.tier}
                className="proc-beat proc-stage"
                data-on={on && !bridging ? "1" : undefined}
              >
                {/* Left: the argument. Right: the screen you would get. */}
                <div key={on ? beat : "rest"}>
                  <span style={{ fontSize: "19px", fontWeight: 700, letterSpacing: "-0.025em" }}>
                    <TierName tier={b.tier} />
                  </span>
                  <h3
                    className="proc-line proc-headline"
                    style={{ margin: "10px 0 0", fontWeight: 700, letterSpacing: "-0.035em", lineHeight: 1.08 }}
                  >
                    {b.headline}
                  </h3>
                  <p className="proc-line" style={{ margin: "14px 0 0", fontSize: "14.5px", lineHeight: 1.6, color: T.soft, maxWidth: "40ch" }}>
                    {b.line}
                  </p>
                  {bTier ? (
                    <p className="proc-line" style={{ margin: "22px 0 0", fontSize: "26px", fontWeight: 700, letterSpacing: "-0.03em" }}>
                      {bTier.priceLabel}
                    </p>
                  ) : null}
                  {bTier?.priceBasis ? (
                    <p className="proc-line" style={{ margin: "4px 0 0", fontSize: "12.5px", color: T.soft, lineHeight: 1.55, maxWidth: "36ch" }}>
                      <TierText>{bTier.priceBasis}</TierText>
                    </p>
                  ) : null}
                  {/* The panel is a drawing of placeholder brands, so each tier
                      says in words what its picture shows. */}
                  <p className="sr-only">{b.alt}</p>
                </div>
                <div key={on ? "p" + beat : "p-rest"}>
                  <Body />
                </div>
              </div>

              {bridge ? (
                <div className="proc-beat proc-bridge" data-on={on && bridging ? "1" : undefined}>
                  <div
                    key={on && bridging ? "b" + beat : "rest"}
                    style={{
                      background: T.wash,
                      border: "1px solid " + T.washLine,
                      borderRadius: "16px",
                      padding: "22px 24px",
                      textAlign: "center",
                    }}
                  >
                    {/* No entrance of its own: the question is the whole card
                        until the tier lands, so it is readable from the first
                        frame rather than an empty wash box (R27, 26 Sep 2026). */}
                    <p style={{ margin: 0, fontSize: "18px", fontWeight: 600, letterSpacing: "-0.02em", color: T.ink }}>
                      {bridge.ask}
                    </p>
                    <p className="proc-bridge-to" style={{ margin: "8px 0 0", fontSize: "22px", fontWeight: 700, letterSpacing: "-0.028em" }}>
                      <TierName tier={bridge.to} />
                    </p>
                  </div>
                </div>
              ) : null}
            </Fragment>
          );
        })}
      </div>

      <div className="proc-foot">
        {/* One string, not three text nodes with {SUBJECT} between them. A
            crawler concatenates them either way, but the brief's rule is that
            every word is real DOM text, and a sentence that only exists once
            the nodes are joined is a sentence no grep of the built page can
            find - which is how you end up unable to prove the label shipped. */}
        <p style={{ margin: 0, fontSize: "12px", color: T.soft }}>
          {`Illustrative. ${SUBJECT} and every brand and figure shown are made up.`}
        </p>
        {/* Only once a reader has pinned a tier. Until then the story is
            already playing and a "play" button would be a control that does
            nothing, which is the shape the rail's own comment warns about. */}
        {held ? (
          <button
            type="button"
            onClick={() => {
              setHeld(false);
              setBridging(false);
            }}
            style={{
              fontFamily: "inherit",
              fontSize: "13px",
              fontWeight: 600,
              color: T.ink,
              background: T.surface,
              border: "1px solid " + T.line,
              borderRadius: "999px",
              padding: "9px 16px",
              minHeight: "44px",
              cursor: "pointer",
            }}
          >
            Play all four
          </button>
        ) : null}
      </div>

      {/* The tier changing is a picture changing, which is nothing at all to a
          screen reader unless it is said. Silent once a reader has pinned one,
          because then nothing is moving. */}
      <p className="sr-only" aria-live="polite">
        {held ? "" : `Showing ${currentTier?.plainName ?? current.tier}: ${current.headline}`}
      </p>
    </div>
  );

  /* The homepage calls this as a page section and gets the site shell; the
     waiting screen is already inside one. Wrapped as a value rather than by a
     component declared in this function body - that would be a fresh component
     type on every render, so React would unmount and remount the whole tree
     each time the tier changed, and the animation this exists to run would be
     destroyed by the state change that starts it. */
  return p.heading ? <section style={{ ...SHELL, marginTop: "44px" }}>{body}</section> : body;
}
