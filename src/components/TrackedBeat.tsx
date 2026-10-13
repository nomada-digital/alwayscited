import EngineLogo from "@/components/EngineLogo";
import TierName from "@/components/TierName";
import { TRACKED_CLUSTERS, TRACKED_KEYWORDS, TRACKED_PROMPTS } from "@/config/pricing";
import { FREE_ENGINE_COUNT } from "@/config/scan-shape";
import { CARD, MICRO, T } from "@/config/tokens";
import { FREE_ENGINES } from "@/lib/scan/engines";

import { LIFT_SOFT } from "./home/dark";

/**
 * The daily cluster beat on /alwaystracked only, from the top of
 * TrackedCluster.dc.html (site boards 29 Sep 2026, R115/S2): today's check
 * across the tracked clusters, one cluster open - its prompts, one per angle,
 * wired to the Google keyword they share. The board's coloured engine tiles
 * are the engines' own marks here, dimmed where the engine did not name the
 * brand.
 *
 * Static and server-rendered: the markup is the board's settled frame (lens
 * on the Sector prompt, named today, the keyword at #7 was #9), so it reads
 * the same with JS off or reduced motion. The old weekly walk's .tb-lens /
 * .tb-row / .tb-now animation classes are deliberately not used.
 *
 * Every brand, prompt and figure is made up, and labelled so, as the board
 * labels them. Counts come from pricing.ts, never typed.
 */

type Cluster = { keyword: string; named: string; rank: string };
/** The clusters shown as chips; the first is the one open below. */
const CLUSTERS: Cluster[] = [
  { keyword: "invoicing software for freelancers", named: "24%", rank: "#7" },
  { keyword: "invoicing app for contractors", named: "31%", rank: "#6" },
  { keyword: "recurring invoice software", named: "12%", rank: "#14" },
  { keyword: "best billing software uk", named: "0%", rank: "#22" },
];
const MORE_CLUSTERS = TRACKED_CLUSTERS - CLUSTERS.length;

type Prompt = { angle: string; prompt: string; named: number };
/** The open cluster's prompts, one per angle. */
const PROMPTS: Prompt[] = [
  { angle: "Category", prompt: "best invoicing software for freelancers", named: 2 },
  { angle: "Positioning", prompt: "multi-currency invoicing for freelancers", named: 3 },
  { angle: "Sector", prompt: "invoicing software freelance designers use", named: 2 },
  { angle: "Outcome", prompt: "invoicing that gets freelancers paid on time", named: 1 },
  { angle: "Comparison", prompt: "alternatives to Ledgerbird for freelancers", named: 0 },
];
/** The prompt the lens sits on: named today. */
const PICKED = 2;
const KEYWORD = { rank: "#7", was: "#9", volume: "1,900" };

const PER_CLUSTER = TRACKED_PROMPTS / TRACKED_CLUSTERS;
const SMALL_WORDS: Record<number, string> = { 3: "three", 4: "four", 5: "five", 6: "six" };
const perClusterWord = SMALL_WORDS[PER_CLUSTER] ?? String(PER_CLUSTER);

const COLS: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "92px minmax(0, 1fr) 118px",
  columnGap: "12px",
};
/** 58, not the board's 50: prompts wrap now, and the picked row beside its
 *  "Named today" pill takes three lines (53px) at 1280 (R151, 3 Oct 2026). */
const ROW_H = 58;
const ROW_GAP = 4;
const PITCH = ROW_H + ROW_GAP;
const WIRES_H = PROMPTS.length * PITCH - ROW_GAP;
const WIRES_MID = WIRES_H / 2;

function Marks({ named }: { named: number }) {
  return (
    <>
      {FREE_ENGINES.map((e, i) => (
        <span key={e} className={i < named ? undefined : "tb-off"} style={{ display: "flex" }}>
          <EngineLogo engine={e} size={16} inline />
        </span>
      ))}
    </>
  );
}

function Wires() {
  return (
    <svg className="tb-meta" width="80" height={WIRES_H} viewBox={`0 0 80 ${WIRES_H}`} aria-hidden="true" style={{ flexShrink: 0 }}>
      {PROMPTS.map((p, i) => {
        const y = i * PITCH + ROW_H / 2;
        const picked = i === PICKED;
        return (
          <path
            key={p.angle}
            d={`M0,${y} C44,${y} 36,${WIRES_MID} 80,${WIRES_MID}`}
            fill="none"
            stroke={p.named > 0 ? T.accent : T.faint}
            strokeOpacity={picked ? 1 : p.named > 0 ? 0.5 : 0.6}
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeDasharray={p.named > 0 ? undefined : "3 4"}
          />
        );
      })}
      <circle cx="77" cy={WIRES_MID} r="4" fill={T.accent} />
    </svg>
  );
}

export default function TrackedBeat() {
  return (
    <div className="tb-grid ac-row">
      <div className="tb-report" style={{ ...CARD, boxShadow: LIFT_SOFT, overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: "12px", padding: "18px 24px", borderBottom: `1px solid ${T.line}` }}>
          <div style={{ fontSize: "15px", fontWeight: 700, color: T.ink, flex: "none" }}>Today&apos;s check</div>
          <div className="tb-meta" style={{ fontSize: "13px", color: T.soft }}>
            tallyroo.com · {TRACKED_CLUSTERS} clusters · 06:10
          </div>
          <div style={{ flexGrow: 1 }} />
          <div style={{ fontSize: "12px", fontWeight: 600, color: T.soft }}>Illustrative</div>
        </div>

        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", padding: "14px 24px", background: T.bg, borderBottom: `1px solid ${T.hair}` }}>
          {CLUSTERS.map((c, i) => {
            const open = i === 0;
            return (
              <span
                key={c.keyword}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "8px",
                  fontSize: "12.5px",
                  fontWeight: open ? 700 : 600,
                  color: open ? T.accentHover : T.ink,
                  background: open ? T.wash : T.surface,
                  border: `1px solid ${open ? T.washLine : T.line}`,
                  borderRadius: "999px",
                  padding: "5px 11px",
                }}
              >
                {c.keyword}
                <span style={{ fontWeight: 500, color: open ? undefined : T.soft }}>
                  {c.named} · {c.rank}
                </span>
              </span>
            );
          })}
          {MORE_CLUSTERS > 0 ? (
            <span style={{ display: "inline-flex", alignItems: "center", fontSize: "12.5px", fontWeight: 600, color: T.soft, background: T.surface, border: `1px solid ${T.line}`, borderRadius: "999px", padding: "5px 11px" }}>
              + {MORE_CLUSTERS} more clusters
            </span>
          ) : null}
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", rowGap: "14px", padding: "12px 12px 14px" }}>
          <div style={{ flex: "1 1 380px", minWidth: 0 }}>
            <div className="tb-phead" style={{ ...COLS, padding: "0 12px 8px", fontSize: "12px", fontWeight: 600, color: T.soft }}>
              <span>Angle</span>
              <span className="tb-phead-prompt">Prompt</span>
              <span>Engines naming you</span>
            </div>
            {PROMPTS.map((p, i) => {
              const picked = i === PICKED;
              return (
                <div
                  key={p.angle}
                  className="tb-prow"
                  style={{
                    ...COLS,
                    alignItems: "center",
                    height: `${ROW_H}px`,
                    padding: "0 12px",
                    marginBottom: i === PROMPTS.length - 1 ? 0 : `${ROW_GAP}px`,
                    borderRadius: "12px",
                    background: picked ? T.wash : undefined,
                    boxShadow: picked ? `inset 0 0 0 1.5px ${T.accent}` : undefined,
                  }}
                >
                  <span
                    style={{
                      justifySelf: "start",
                      fontSize: "11px",
                      fontWeight: 700,
                      color: picked ? T.accentHover : T.soft,
                      background: picked ? T.surface : T.chip,
                      borderRadius: "6px",
                      padding: "3px 7px",
                    }}
                  >
                    {p.angle}
                  </span>
                  {/* Wraps, never an ellipsis: the prompt is what the row is
                      about, and at 390 the ellipsis left "best i..." (R151,
                      3 Oct 2026). Three lines fit the ROW_H row. */}
                  <span className="tb-prompt" style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
                    <span style={{ fontSize: "13.5px", fontWeight: picked ? 600 : 500, color: T.ink, lineHeight: 1.3 }}>
                      {p.prompt}
                    </span>
                    {picked ? (
                      <span className="tb-pill" style={{ flexShrink: 0, fontSize: "11px", fontWeight: 700, color: T.accentHover, background: T.surface, borderRadius: "999px", padding: "2px 8px" }}>
                        Named today
                      </span>
                    ) : null}
                  </span>
                  <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                    <Marks named={p.named} />
                    <span style={{ marginLeft: "6px", fontSize: "12.5px", fontWeight: picked ? 600 : undefined, color: picked ? T.accentHover : T.soft, whiteSpace: "nowrap" }}>
                      {p.named} of {FREE_ENGINE_COUNT}
                    </span>
                  </span>
                </div>
              );
            })}
          </div>

          <div style={{ display: "flex", alignItems: "flex-end", flexShrink: 0, alignSelf: "flex-end" }}>
            <Wires />
            <div
              style={{
                width: "156px",
                boxSizing: "border-box",
                padding: "14px",
                borderRadius: "14px",
                border: `1px solid ${T.washLine}`,
                background: T.surface,
                display: "flex",
                flexDirection: "column",
                gap: "6px",
                alignSelf: "center",
              }}
            >
              <span style={{ fontSize: "11px", fontWeight: 600, color: T.soft }}>Google keyword</span>
              <span style={{ fontSize: "13px", fontWeight: 700, lineHeight: 1.3, color: T.ink }}>{CLUSTERS[0].keyword}</span>
              <span style={{ display: "flex", alignItems: "baseline", gap: "6px" }}>
                <span style={{ fontSize: "32px", fontWeight: 700, letterSpacing: "-0.03em", color: T.ink }}>{KEYWORD.rank}</span>
                <span style={{ fontSize: "12px", fontWeight: 600, color: T.accentHover }}>was {KEYWORD.was}</span>
              </span>
              <span style={{ fontSize: "11.5px", color: T.soft }}>{KEYWORD.volume} searches a month</span>
            </div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "10px", padding: "14px 24px", borderTop: `1px solid ${T.hair}`, fontSize: "12.5px", color: T.soft }}>
          <span>Cited today for that prompt:</span>
          <span style={{ fontWeight: 600, color: T.accentHover, background: T.wash, borderRadius: "999px", padding: "2px 10px" }}>solodesk.io</span>
        </div>
      </div>

      <div className="tb-argument" style={{ paddingTop: "8px" }}>
        <div style={MICRO}>
          What <TierName tier="tracked" /> shows you
        </div>
        <h2 style={{ margin: "10px 0 0", fontSize: "28px", fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1.15, color: T.ink }}>
          {TRACKED_KEYWORDS} keywords. {TRACKED_PROMPTS} prompts. Checked every morning.
        </h2>
        <p style={{ margin: "14px 0 0", fontSize: "15px", lineHeight: 1.6, color: T.soft }}>
          Each keyword your buyers search, joined to the {perClusterWord} prompts they ask AI about it. Which engines named
          you, where you rank on Google, and the pages they cited, side by side.
        </p>
        <div style={{ marginTop: "22px", display: "flex", flexDirection: "column", gap: "12px" }}>
          {[
            <>A citation and a ranking, side by side, never averaged</>,
            <>Every answer kept, with the sources behind it</>,
            <>
              {/* Not a link: no tier name sits inside one on this site (the lockup census). */}
              Reporting only. Moving a cluster is <TierName tier="mentioned" />, one cluster at a time
            </>,
          ].map((item, i) => (
            <div key={i} style={{ display: "flex", gap: "10px", fontSize: "14px", lineHeight: 1.5, color: T.ink }}>
              <span style={{ flexShrink: 0, width: "6px", height: "6px", borderRadius: "999px", background: T.accent, marginTop: "8px" }} />
              <span>{item}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="tb-note" style={{ fontSize: "12px", color: T.soft }}>
        Illustrative. Tallyroo and every brand and figure shown are made up.
      </div>
    </div>
  );
}
