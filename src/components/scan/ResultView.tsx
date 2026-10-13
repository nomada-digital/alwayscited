"use client";

import EngineLogo from "@/components/EngineLogo";
import TierName from "@/components/TierName";
import { D, TRACKED_WASH } from "@/components/home/dark";
import { TIERS, TRACKED_BASIS, TRACKED_CLUSTERS, TRACKED_KEYWORDS, TRACKED_PRICE, TRACKED_PROMPTS, checkoutUrlFor } from "@/config/pricing";
import { TRIAL_CTA, trialLine } from "@/config/trial";
import { count } from "@/lib/plural";
import { SCAN_LIMITS } from "@/config/contact";
import { track } from "@/lib/analytics";
import { useCallback, useEffect, useRef, useState } from "react";
import { CARD, MICRO, T } from "@/config/tokens";
import type { EngineAnswer, RunScanResponse, SourceEntry } from "@/lib/scan";
import { ENGINE_SPECS, isEngine } from "@/lib/scan/engines";
import {
  PLAN_ORDER,
  SOV_ROWS,
  clusterLinks,
  drawerKeywordLine,
  clusterRank,
  clusterState,
  engineLabel,
  fmtDate,
  googleLine,
  isSubject,
  leaderboardCaption,
  placementCopy,
  questionPill,
  resultFigures,
} from "./result-figures";
import { btn, field, label } from "./screens";
import WalkthroughForm from "./WalkthroughForm";
import { trackOffer } from "./track-offer";
import { type Inline, parseAnswer } from "./answer-markdown";
import { type Band, bandOf, selfServeCount, selfServeSentence } from "@/lib/scan/placement-difficulty";
import type { WalkthroughOutcome } from "@/lib/scan/walkthrough-outcome";

/**
 * The result, free and unlocked, from Flow2Free.dc.html and Flow3Report.dc.html.
 *
 * One component for both because they are the same page in two states: the
 * free result with the placement list behind the gate, and the same page with
 * the list open and the metric strip filled in. Rendering them as two screens
 * would mean two copies of every table.
 *
 * What is NOT here, and why:
 *
 * - **"Who is in it"**, the column the board puts on the placement table.
 *   scan_brands is aggregated per scan and per engine, never per question, so
 *   there is no honest way to say which competitor is on which page.
 * - **"Where your competitors are cited and you are not"**, the board heading.
 *   The derivation finds pages cited for questions where no engine named the
 *   brand. That is not the same claim, however well it would sell.
 * The whole leaderboard and every source are free, and have been since
 * 20260919000000 put them in the teaser. Only the placement list is gated, and
 * the blur is on that table alone. Every section here renders from what it is
 * given and disappears when it is given nothing, which is why widening the
 * teaser filled these in without touching this file.
 */

/**
 * Every figure and every sentence this screen states is derived in
 * `result-figures.ts`, which has no JSX and therefore has an executor. Nothing
 * below re-derives one: what is here is the painting.
 */

const pill = (bg: string, fg: string): React.CSSProperties => ({
  fontSize: "11px",
  fontWeight: 600,
  padding: "3px 10px",
  borderRadius: "999px",
  background: bg,
  color: fg,
  whiteSpace: "nowrap",
});

const QUIET = pill(T.chip, T.soft);
/** The question row's pill, from ScanResult.dc.html: purple when named, quiet when not. */
const ROW_NAMED = pill(T.wash, T.accentHover);

/**
 * What kind of site each cited page is. Unclassified renders nothing at all:
 * a domain the classifier did not reach is a different finding from one it
 * read and could not place.
 */
function Head(p: { title: React.ReactNode; children: React.ReactNode; aside?: React.ReactNode }) {
  const head = (
    // ScanResult.dc.html: a 26px heading with its description beside it on the
    // same baseline, 32px apart. `.board-head` stacks them on a phone.
    <div className="board-head" style={{ display: "flex", alignItems: "baseline", gap: "32px", marginBottom: p.aside ? 0 : "18px" }}>
      <h2 style={{ margin: 0, fontSize: "26px", fontWeight: 700, letterSpacing: "-0.03em", color: T.ink, flexShrink: 0 }}>
        {p.title}
      </h2>
      <p style={{ margin: 0, fontSize: "14.5px", lineHeight: 1.6, color: T.soft }}>{p.children}</p>
    </div>
  );
  if (!p.aside) return head;
  // The board's "Where to get placed" row: the self-serve count at the right
  // end of the heading line. `.res-headrow` stacks it under on a phone.
  return (
    <div className="res-headrow">
      {head}
      <div style={{ fontSize: "15px", fontWeight: 700, color: T.ink }}>{p.aside}</div>
    </div>
  );
}

/**
 * One figure in its own card, as the board draws them: label, then the value.
 * The note is the denominator in words, which the board leaves out; it stays,
 * visually hidden, because "of 5" means "of the questions an engine answered"
 * and a screen reader has no other way to learn that.
 */
function Metric(p: { label: string; value: React.ReactNode; note: string }) {
  return (
    <div className="res-metric" style={{ background: T.surface, border: "1px solid " + T.line, borderRadius: "16px", padding: "16px", minWidth: 0 }}>
      <div className="res-metric-l" style={{ fontSize: "12.5px", color: T.soft }}>{p.label}</div>
      <div style={{ fontSize: "30px", fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1.15, marginTop: "4px", color: T.ink }}>
        {p.value}
      </div>
      <span className="sr-only">{p.note}</span>
    </div>
  );
}

const unit: React.CSSProperties = { fontSize: "15px", color: T.soft, letterSpacing: 0, whiteSpace: "nowrap" };

/* ── Question by question ── */

/** One engine's verdict on one question, as a word. The mark beside it is decoration. */
function answerState(a: EngineAnswer): "named" | "not named" | "no answer" {
  if (!a.answered) return "no answer";
  return a.brand_named ? "named" : "not named";
}

/**
 * The engines' marks on a question row: full strength where the engine named
 * the brand, faded where it did not, dashed where it gave no answer. The pill
 * beside them says the same thing in words, so nothing here rests on colour.
 */
function EngineMarks(p: { answers: EngineAnswer[]; size?: number }) {
  if (!p.answers.length) return null;
  const size = p.size ?? 26;
  return (
    <div style={{ display: "flex", gap: size < 26 ? "6px" : "8px" }}>
      {p.answers.map((a) => {
        const state = answerState(a);
        return (
          <span
            key={a.engine}
            title={engineLabel(a.engine) + ": " + state}
            style={{
              width: size + "px",
              height: size + "px",
              borderRadius: "7px",
              display: "grid",
              placeItems: "center",
              background: T.surface,
              color: T.ink,
              border:
                state === "named"
                  ? "1.5px solid " + T.accent
                  : state === "no answer"
                    ? "1px dashed " + T.line
                    : "1px solid " + T.line,
              opacity: state === "named" ? 1 : 0.42,
              filter: state === "named" ? undefined : "grayscale(1)",
            }}
          >
            <EngineLogo engine={a.engine} size={14} inline />
          </span>
        );
      })}
    </div>
  );
}

function QuestionTable(p: { r: RunScanResponse; onOpen: (idx: number) => void }) {
  const qs = p.r.questions ?? [];
  if (!qs.length) return null;
  return (
    // 64px under the headline on the board: the page's 26px gap plus this.
    <section style={{ marginTop: "38px" }}>
      <Head title="Question by question">
        Open a question to read what each engine said and which pages it cited.
      </Head>
      {/* ScanResult.dc.html: no header row; question, engine marks, Google
          position, the pill, and a chevron that says the row opens. */}
      <div style={{ ...CARD, borderRadius: "18px", overflow: "hidden" }}>
        {qs.map((q, i) => {
          const label = questionPill(q);
          const silent = label === "no answer";
          const hit = label !== "not named" && !silent;
          const answers = q.answers ?? [];
          const open = answers.length > 0;
          return (
            <button
              key={q.idx}
              type="button"
              className="res-qline res-qbtn"
              disabled={!open}
              onClick={() => p.onOpen(q.idx)}
              aria-haspopup="dialog"
              style={{ borderTop: i ? "1px solid " + T.hair : undefined }}
            >
              <span style={{ fontSize: "15px", fontWeight: 600, color: T.ink }}>{q.question}</span>
              <EngineMarks answers={answers} />
              {/* A derived keyword line is too long for one 170px line, so it
                  wraps; the bare rank never does. */}
              <span style={{ fontSize: "13px", color: T.soft, whiteSpace: q.target_keyword ? "normal" : "nowrap", lineHeight: 1.35 }}>
                {googleLine(q)}
              </span>
              <span style={{ justifySelf: "start" }}>
                <span style={{ ...(hit ? ROW_NAMED : QUIET), fontSize: "12px", padding: "4px 10px" }}>{hit ? "Named " + label : label[0].toUpperCase() + label.slice(1)}</span>
              </span>
              {open ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={T.soft} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M9 6l6 6-6 6" />
                </svg>
              ) : (
                <span />
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}

/* ── Your first cluster (ScanCluster.dc.html, S1) ── */

const KIND: Record<string, string> = {
  category: "Category",
  positioning: "Positioning",
  sector: "Sector",
  outcome: "Outcome",
  comparison: "Comparison",
};

const KEYWORD_INTENT: Record<string, string> = {
  commercial: "Commercial",
  transactional: "Transactional",
  informational: "Informational",
  navigational: "Navigational",
};

const WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const word = (n: number) => WORDS[n] ?? String(n);

/** The board's row: 62px tall, 6px apart. The link lines are drawn off these. */
const ROW_H = 62;
const ROW_GAP = 6;

/**
 * One line from each prompt row to the keyword node, as the board draws them:
 * solid purple where an engine named the brand on that prompt, dashed grey
 * where none did. Decoration: the row's pill says the same in words.
 */
function ClusterLinks(p: { links: { named: boolean }[] }) {
  const n = p.links.length;
  const h = n * ROW_H + (n - 1) * ROW_GAP;
  const mid = h / 2;
  return (
    <svg className="clu-links" width="92" height={h} viewBox={"0 0 92 " + h} aria-hidden="true" style={{ flexShrink: 0 }}>
      {p.links.map((l, i) => {
        const y = ROW_H / 2 + i * (ROW_H + ROW_GAP);
        return (
          <path
            key={i}
            className={l.named ? "clu-link" : undefined}
            d={"M0," + y + " C51," + y + " 41," + mid + " 92," + mid}
            fill="none"
            stroke={l.named ? "#a78bfa" : "#d4d4d8"}
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeDasharray={l.named ? undefined : "3 4"}
          />
        );
      })}
      <circle cx="89" cy={mid} r="4" fill={T.accent} />
    </svg>
  );
}

function KeywordNode(p: { r: RunScanResponse; chosen: boolean; rank: string }) {
  const c = p.r.cluster_keyword;
  const head = <span style={{ fontSize: "12px", fontWeight: 600, color: T.soft }}>The Google keyword</span>;
  const box: React.CSSProperties = {
    boxSizing: "border-box",
    padding: "22px",
    borderRadius: "16px",
    display: "flex",
    flexDirection: "column",
    gap: "10px",
  };
  if (!p.chosen || !c?.keyword) {
    return (
      <div className="clu-node" data-figure="cluster-keyword" style={{ ...box, border: "1.5px dashed #c4b5fd", background: T.surface }}>
        {head}
        <span style={{ fontSize: "19px", fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1.25, color: T.ink }}>Not picked yet</span>
        <span style={{ fontSize: "14px", lineHeight: 1.55, color: T.ink }}>
          {c?.status === "read_failed"
            ? "We couldn't check Google search volume when this scan ran. The prompts are written on the category, and nomada digital picks the keyword when you start tracking."
            : "We couldn't find a commercial Google term with search volume for this. The prompts are written on the category, and nomada digital picks the keyword when you start tracking."}
        </span>
        <span style={{ fontSize: "13px", color: T.soft }}>We never guess one.</span>
      </div>
    );
  }
  const chip = (bg: string, fg: string): React.CSSProperties => ({ fontSize: "12px", fontWeight: 600, color: fg, background: bg, borderRadius: "999px", padding: "3px 10px" });
  return (
    <div className="clu-node" data-figure="cluster-keyword" style={{ ...box, border: "1px solid #c4b5fd", background: "#fcfbff" }}>
      {head}
      <span style={{ fontSize: "19px", fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1.25, color: T.ink }}>{c.keyword}</span>
      <span style={{ display: "flex", alignItems: "baseline", gap: "10px", flexWrap: "wrap" }}>
        <span style={{ fontSize: "44px", fontWeight: 700, letterSpacing: "-0.04em", lineHeight: 1.1, color: T.ink }}>{p.rank}</span>
        <span style={{ fontSize: "13px", color: T.soft }}>{"on Google, in the " + p.r.market}</span>
      </span>
      {c.intent || c.volume != null ? (
        <span style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
          {c.intent ? <span style={chip(T.wash, T.accentHover)}>{(KEYWORD_INTENT[c.intent] ?? c.intent) + " intent"}</span> : null}
          {c.volume != null ? (
            <span style={chip(T.chip, T.ink)}>{(c.volume < 10 ? "Under 10" : c.volume.toLocaleString("en-GB")) + " searches a month"}</span>
          ) : null}
        </span>
      ) : null}
      <span style={{ fontSize: "13px", lineHeight: 1.5, color: T.soft, paddingTop: "10px", borderTop: "1px solid " + T.line }}>
        This is the term placements link on, so it has to be one buyers search.
      </span>
    </div>
  );
}

/**
 * The scan as the visitor's first cluster: one Google keyword joined to the
 * five prompts written on it, each row opening the same answer drawer the
 * question table did. Only drawn on a scan from C1 on (`clusterState` not
 * null); an older scan keeps `QuestionTable`.
 */
function ClusterSection(p: { r: RunScanResponse; chosen: boolean; rank: string; onOpen: (idx: number) => void }) {
  const qs = p.r.questions ?? [];
  if (!qs.length) return null;
  const cols = "96px minmax(0, 1fr) 128px 104px";
  return (
    <section style={{ marginTop: "38px" }}>
      <Head title="Your first cluster">
        One keyword buyers search, and the five prompts they ask AI about it. Open a prompt to read what each engine said.
      </Head>
      <div className="clu-card" style={{ ...CARD, borderRadius: "18px", padding: "24px 24px 0" }}>
        <div className="clu-head" style={{ display: "grid", gridTemplateColumns: cols, gap: "14px", padding: "0 14px 10px", marginRight: "392px", fontSize: "12px", fontWeight: 600, color: T.soft }}>
          <span>Angle</span>
          <span>Prompt</span>
          <span>Engines naming you</span>
          <span style={{ textAlign: "right" }}>Verdict</span>
        </div>
        <div className="clu-body" style={{ display: "flex", alignItems: "center" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: ROW_GAP + "px", flexGrow: 1, minWidth: 0 }}>
            {qs.map((q) => {
              const label = questionPill(q);
              const hit = label !== "not named" && label !== "no answer";
              const answers = q.answers ?? [];
              return (
                <button
                  key={q.idx}
                  type="button"
                  className="clu-row res-qbtn"
                  disabled={!answers.length}
                  onClick={() => p.onOpen(q.idx)}
                  aria-haspopup="dialog"
                  style={{ gridTemplateColumns: cols }}
                >
                  <span style={{ justifySelf: "start", fontSize: "11px", fontWeight: 700, letterSpacing: ".03em", textTransform: "uppercase", color: T.soft, background: T.chip, borderRadius: "6px", padding: "3px 8px" }}>
                    {KIND[q.kind] ?? "Own"}
                  </span>
                  <span style={{ fontSize: "14.5px", fontWeight: 600, lineHeight: 1.35, color: T.ink }}>{q.question}</span>
                  <EngineMarks answers={answers} size={24} />
                  <span style={{ justifySelf: "end" }}>
                    <span style={{ ...(hit ? ROW_NAMED : QUIET), fontSize: "12px", padding: "3px 10px" }}>{hit ? "Named " + label : label[0].toUpperCase() + label.slice(1)}</span>
                  </span>
                </button>
              );
            })}
          </div>
          <ClusterLinks links={clusterLinks(qs)} />
          <KeywordNode r={p.r} chosen={p.chosen} rank={p.rank} />
        </div>
        <div className="clu-foot" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px 24px", margin: "24px -24px 0", padding: "16px 24px", borderTop: "1px solid " + T.hair, background: "#fbfbfc", borderRadius: "0 0 18px 18px" }}>
          <span style={{ fontSize: "14px", lineHeight: 1.5, color: T.ink }}>
            <TierName tier="tracked" />
            {" checks this cluster every morning, and " + word(TRACKED_CLUSTERS - 1) + " more like it: " + TRACKED_PROMPTS + " prompts and " + TRACKED_KEYWORDS + " keywords, on the same " + word(p.r.engines.length) + " engines and Google."}
          </span>
          <a href="#tracked" style={{ flexShrink: 0, fontSize: "14px", fontWeight: 600, color: T.accent, textDecoration: "none" }}>
            See what it tracks
          </a>
        </div>
      </div>
    </section>
  );
}

/**
 * The answers to one question, in a panel from the right.
 *
 * A sidebar rather than an inline disclosure: five answers of a few hundred
 * words each pushed everything below them off the page, and a visitor
 * comparing engines wants them side by side with the question still in view.
 */
function AnswerDrawer(p: {
  r: RunScanResponse;
  idx: number | null;
  onClose: () => void;
  onMove: (idx: number) => void;
}) {
  const qs = p.r.questions ?? [];
  const at = qs.findIndex((q) => q.idx === p.idx);
  const q = at >= 0 ? qs[at] : null;
  const closeRef = useRef<HTMLButtonElement>(null);
  const { onClose } = p;

  useEffect(() => {
    if (!q) return;
    closeRef.current?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [q, onClose]);

  if (!q) return null;
  const brand = p.r.brand.name;
  const answers = q.answers ?? [];
  // ScanCluster.dc.html: on a cluster scan the head names the prompt and the
  // keyword's rank, and an angle line sits over the prompt; a scan from
  // before C1 keeps "Question N of M" and the row's own Google line.
  const cluster = clusterState(p.r);
  const noun = cluster ? "prompt" : "question";
  const rank = cluster ? drawerKeywordLine(p.r) : googleLine(q);
  const step = (d: number) => {
    const next = qs[at + d];
    if (next) p.onMove(next.idx);
  };

  return (
    <>
      <div className="ans-backdrop" onClick={p.onClose} aria-hidden="true" />
      <aside className="ans-drawer" role="dialog" aria-modal="true" aria-labelledby="ans-title">
        {/* ScanResult.dc.html: "Question N of M · Google #N" beside the three
            44px paging buttons, the question at 22px, then one card per engine
            with its verdict pill, what it said, and the pages it cited. */}
        <div className="ans-drawer__head">
          <div style={{ fontSize: "12.5px", color: T.soft, flexGrow: 1 }}>{noun[0].toUpperCase() + noun.slice(1) + " " + (at + 1) + " of " + qs.length + " · " + rank}</div>
          <button type="button" className="ans-nav" onClick={() => step(-1)} disabled={at <= 0} aria-label={"Previous " + noun}>
            <Chevron d="M15 6l-6 6 6 6" />
          </button>
          <button type="button" className="ans-nav" onClick={() => step(1)} disabled={at >= qs.length - 1} aria-label={"Next " + noun}>
            <Chevron d="M9 6l6 6-6 6" />
          </button>
          <button type="button" className="ans-nav" ref={closeRef} onClick={p.onClose} aria-label="Close">
            <Chevron d="M6 6l12 12M18 6L6 18" />
          </button>
        </div>
        <div style={{ padding: "4px 26px 32px" }}>
          {cluster ? (
            <div style={{ marginBottom: "8px", fontSize: "11px", fontWeight: 700, letterSpacing: ".03em", textTransform: "uppercase", color: T.accentHover }}>
              {(KIND[q.kind] ?? "Your own") + " prompt" + (cluster === "chosen" ? ", about “" + p.r.cluster_keyword?.keyword + "”" : "")}
            </div>
          ) : null}
          <h2 id="ans-title" style={{ margin: 0, fontSize: "22px", fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1.2 }}>
            {q.question}
          </h2>

          <div style={{ display: "flex", flexDirection: "column", gap: "14px", marginTop: "14px" }}>
            {answers.map((a) => {
              const state = answerState(a);
              const direct = isEngine(a.engine) && ENGINE_SPECS[a.engine].kind === "model";
              const cited = a.citations ?? [];
              return (
                <div key={a.engine} style={{ border: "1px solid " + T.line, borderRadius: "14px", padding: "14px 16px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                    <EngineLogo engine={a.engine} size={18} inline />
                    <span style={{ fontSize: "13.5px", fontWeight: 700 }}>{engineLabel(a.engine)}</span>
                    {direct ? <span style={{ fontSize: "11.5px", color: T.soft }}>asked directly</span> : null}
                    <span style={{ ...(state === "named" ? ROW_NAMED : QUIET), marginLeft: "auto", fontSize: "11.5px", padding: "3px 9px" }}>
                      {state === "named" ? "Names " + brand : state === "no answer" ? "No answer" : "Does not name " + brand}
                    </span>
                  </div>
                  <div style={{ marginTop: "10px" }}>
                    {a.response_text?.trim() ? (
                      <AnswerText source={a.response_text} />
                    ) : (
                      <p style={{ margin: 0, fontSize: "13px", color: T.soft }}>
                        {a.answered
                          ? "The words were not kept for this scan - it ran before answers were stored for good."
                          : "This engine gave no answer to this " + noun + "."}
                      </p>
                    )}
                    {cited.length ? (
                      <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginTop: "10px" }} aria-label={"Cited " + count(cited.length, "page")}>
                        {cited.slice(0, 8).map((c, i) => {
                          const chip: React.CSSProperties = { fontSize: "11.5px", color: T.soft, background: T.chip, borderRadius: "6px", padding: "3px 8px", textDecoration: "none" };
                          return c.url ? (
                            <a key={c.url + i} href={c.url} target="_blank" rel="noopener noreferrer nofollow" title={c.title ?? undefined} style={chip}>
                              {c.domain}
                            </a>
                          ) : (
                            <span key={c.domain + i} title={c.title ?? undefined} style={chip}>
                              {c.domain}
                            </span>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </aside>
    </>
  );
}

function Chevron(p: { d: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={p.d} />
    </svg>
  );
}

/* ── One stored answer, as the markdown the engine wrote ── */

/**
 * See `answer-markdown.ts`. Every string reaches the page as a React text
 * node, never as HTML, so nothing an engine wrote can run.
 */
function AnswerText(p: { source: string }) {
  const blocks = parseAnswer(p.source);
  const text: React.CSSProperties = { margin: 0, fontSize: "13.5px", lineHeight: 1.7, color: T.ink };
  const cell: React.CSSProperties = { padding: "6px 8px", borderBottom: "1px solid " + T.hair, verticalAlign: "top", textAlign: "left" };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      {blocks.map((b, i) => {
        if (b.kind === "table") {
          return (
            <div key={i} style={{ overflowX: "auto" }}>
              <table style={{ borderCollapse: "collapse", width: "100%", fontSize: "12.5px", lineHeight: 1.5, color: T.ink }}>
                <thead>
                  <tr>
                    {b.head.map((c, j) => (
                      <th key={j} style={{ ...cell, fontWeight: 600, borderBottom: "1px solid " + T.line }}>
                        <Runs runs={c} />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {b.rows.map((r, j) => (
                    <tr key={j}>
                      {r.map((c, k) => (
                        <td key={k} style={cell}>
                          <Runs runs={c} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        if (b.kind === "ul" || b.kind === "ol") {
          const List = b.kind;
          return (
            <List key={i} style={{ ...text, paddingLeft: "20px", display: "flex", flexDirection: "column", gap: "4px" }}>
              {b.items.map((it, j) => (
                <li key={j}>
                  <Runs runs={it} />
                </li>
              ))}
            </List>
          );
        }
        if (b.kind === "h") {
          return (
            <p key={i} style={{ ...text, fontWeight: 600 }}>
              <Runs runs={b.text} />
            </p>
          );
        }
        if (b.kind !== "p") return null;
        return (
          <p key={i} style={text}>
            {b.lines.map((l, j) => (
              <span key={j}>
                {j ? <br /> : null}
                <Runs runs={l} />
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
}

function Runs(p: { runs: Inline[] }) {
  return (
    <>
      {p.runs.map((r, i) =>
        r.bold ? (
          <strong key={i} style={{ fontWeight: 600 }}>
            {r.text}
          </strong>
        ) : r.cite ? (
          <sup key={i} style={{ fontSize: "10px", color: T.soft }}>
            {"[" + r.text + "]"}
          </sup>
        ) : (
          <span key={i}>{r.text}</span>
        ),
      )}
    </>
  );
}

/* ── Who is being named instead ── */

function ShareOfVoice(p: { r: RunScanResponse }) {
  const rows = p.r.leaderboard;
  if (!rows.length) return null;
  const top = Math.max(...rows.map((b) => b.mentions), 1);
  /**
   * Part of this leaderboard did not come back.
   *
   * Every row below is still a real count - the bars are what those brands
   * were named. What is missing is other brands, so the standfirst cannot
   * claim "every brand in the category" and the caption cannot say "in all".
   * The rank and the share of voice counted against this list are already
   * absent by the time the data reaches here.
   */
  const partial = p.r.leaderboard_partial;

  return (
    <section>
      <Head title="Who is being named instead">
        {partial
          ? "The same question set scored for every brand we could read. Part of this leaderboard did not come back, so names are missing from it - the counts below are real, but we are not publishing a ranking off a list we know is short."
          : "The same question set scored for every brand in the category. This is the gap, and it is the number that has to move."}
      </Head>
      {/* ScanResult.dc.html: name, a 10px rounded bar, the count in bold at the
          right. The board's "/ 20" is not drawn: these are mention counts and can
          exceed the answer total (39 against 17 answers on the 25 Sep US scan),
          so "of N answers" would be false. */}
      <div style={{ ...CARD, borderRadius: "18px", padding: "10px 22px 18px" }}>
        <div style={{ display: "flex", flexDirection: "column" }}>
          {rows.slice(0, SOV_ROWS).map((b) => {
            const you = isSubject(b, p.r.brand.name);
            return (
              <div key={b.brand} className="res-sov">
                <div style={{ fontSize: "14px", fontWeight: 600, color: you ? T.accentHover : T.ink, minWidth: 0, overflowWrap: "anywhere" }}>
                  {b.brand}
                </div>
                <div style={{ height: "10px", background: T.hair, borderRadius: "5px", overflow: "hidden" }}>
                  {/* acGrow, at Flow2Free.dc.html's own .8s cubic-bezier -
                      seq-bar is already that exact declaration. Time-based
                      rather than scroll-driven because this arrives when the
                      scan finishes, which is the moment the board animates.
                      The count sits in text beside it, so a bar at scaleX(0)
                      hides a graphic and never a number. */}
                  <div
                    className="seq-bar"
                    style={{
                      height: "100%",
                      width: Math.round((b.mentions / top) * 100) + "%",
                      background: you ? T.accent : "#c8cad0",
                      borderRadius: "5px",
                    }}
                  />
                </div>
                <div style={{ fontSize: "14px", fontWeight: 700, textAlign: "right", color: T.ink }}>
                  {b.mentions}
                </div>
              </div>
            );
          })}
        </div>
        <p style={{ margin: "16px 0 0", fontSize: "12.5px", color: T.soft }}>
          {leaderboardCaption(rows.length, partial)}
        </p>
      </div>
    </section>
  );
}

/* ── The placement list ── */

const BAND_COLOUR: Record<Band, string> = { Easy: T.goodFg, Moderate: T.warnFg, Hard: T.badFg };

/** The answers a page fed that did not name you, as the board's pill words it. */
const feeds = (n: number) => "Feeds " + count(n, "answer") + " you miss";

/**
 * How hard a placement is, as ScanResult.dc.html draws it on a card: a 92px
 * half dial with the score under its arc, and "Difficulty, out of 100" over the
 * band in words beside it - the word is always there, so colour never carries
 * it alone. `placement-difficulty.ts` is the rule; this is the painting.
 */
function Dial(p: { score: number | null }) {
  if (p.score === null) {
    return <div style={{ fontSize: "13px", color: T.soft, minHeight: "56px", display: "flex", alignItems: "center" }}>Not scored</div>;
  }
  const band = bandOf(p.score);
  // The board's arc is radius 40; its length, pi x 40, rounds to its 126.
  const len = 126;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
      <div style={{ position: "relative", width: "92px", height: "56px", flexShrink: 0 }}>
        <svg width="92" height="56" viewBox="0 0 92 56" fill="none" aria-hidden="true">
          <path d="M6 50 A40 40 0 0 1 86 50" stroke={T.hair} strokeWidth="8" strokeLinecap="round" />
          <path
            className="res-dial"
            d="M6 50 A40 40 0 0 1 86 50"
            stroke={BAND_COLOUR[band]}
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={len}
            strokeDashoffset={len - Math.round((len * p.score) / 100)}
          />
        </svg>
        <div style={{ position: "absolute", left: 0, right: 0, bottom: "2px", textAlign: "center", fontSize: "19px", fontWeight: 700, letterSpacing: "-0.02em", color: T.ink }}>
          {p.score}
        </div>
      </div>
      <div>
        <div style={{ fontSize: "12px", color: T.soft }}>Difficulty, out of 100</div>
        <div style={{ fontSize: "16px", fontWeight: 700, color: BAND_COLOUR[band] }}>{band}</div>
      </div>
    </div>
  );
}

/** The table's difficulty cell: a 56px bar filled to the score, and the band. */
function DifficultyBar(p: { score: number | null }) {
  if (p.score === null) return <span style={{ fontSize: "12.5px", color: T.soft }}>Not scored</span>;
  const band = bandOf(p.score);
  return (
    <span style={{ display: "flex", alignItems: "center", gap: "8px" }} aria-label={"Difficulty " + p.score + " out of 100, " + band}>
      <span aria-hidden="true" style={{ width: "56px", height: "6px", background: T.hair, borderRadius: "3px", overflow: "hidden", flexShrink: 0 }}>
        <span className="seq-bar" style={{ display: "block", height: "6px", width: p.score + "%", background: BAND_COLOUR[band] }} />
      </span>
      <span style={{ fontWeight: 600, color: BAND_COLOUR[band] }}>{band}</span>
    </span>
  );
}

/**
 * Which of these the visitor could land alone - Danny, 25 Sep 2026: "we want
 * people to understand whether they could do this themselves or would be
 * better off with us doing it for them". Only drawn when the rows were
 * scored; an unscored list says nothing rather than zero. The board sets it
 * at the right end of the section's heading line.
 */
function selfServeLine(r: RunScanResponse): string | null {
  return selfServeSentence(selfServeCount(r.opportunities ?? []));
}

/**
 * The step up for the rest, under the table as the board places it. The board's
 * dark ink card (ScanResult.dc.html, QF1). The tier name is in the sentence,
 * through TierName under `.on-dark`; the button is plain words, so no lockup
 * sits inside a coloured link. Drawn only when some scored row is not one the
 * visitor could land alone.
 */
function HardOnes(p: { r: RunScanResponse }) {
  const { easy, scored } = selfServeCount(p.r.opportunities ?? []);
  if (!scored || scored - easy <= 0) return null;
  return (
    <div
      className="on-dark"
      style={{
        marginTop: "16px",
        background: T.ink,
        color: T.surface,
        borderRadius: "18px",
        padding: "22px 26px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "16px",
        flexWrap: "wrap",
      }}
    >
      <div style={{ flexGrow: 1, minWidth: "220px" }}>
        <div style={{ fontSize: "18px", fontWeight: 700, color: T.surface }}>Want us to secure these placements for you?</div>
        <p style={{ margin: "4px 0 0", fontSize: "14px", lineHeight: 1.55, color: D.muted }}>
          That is <TierName tier="mentioned" />: placements in the pages the engines cite, links included.
        </p>
      </div>
      <a
        href="/alwaysmentioned"
        style={{
          background: T.surface,
          color: T.ink,
          fontSize: "14.5px",
          fontWeight: 600,
          padding: "12px 18px",
          borderRadius: "10px",
          textDecoration: "none",
          minHeight: "44px",
          boxSizing: "border-box",
          display: "flex",
          alignItems: "center",
        }}
      >
        See how it works
      </a>
    </div>
  );
}

/**
 * No page to be placed into, said once and used on both sides of the gate.
 *
 * It used to exist only on the unlocked side. Locked, the same scan drew the
 * blurred skeleton and a gate offering a list - so a visitor gave an address
 * for rows that were never there, and the report then told them so. The gate
 * and the report have to agree before the address is given, not after.
 *
 * There are four ways to reach zero and only one of them is a finding, which
 * is `placementVerdict`'s whole subject - read it there. This is the painting.
 */
function NoPlacements(p: { sources: readonly SourceEntry[]; cluster: boolean }) {
  return (
    <div style={{ ...CARD, padding: "22px 26px" }}>
      <p style={{ margin: 0, fontSize: "14px", lineHeight: 1.65, color: T.soft }}>{placementCopy(p.sources, p.cluster ? "prompts" : "questions")}</p>
    </div>
  );
}

/**
 * Every row after the first three, as the board's table: page, then a column
 * the board fills with the brands each page names. Which brands a page names
 * is not derivable (opportunities.ts - scan_brands is per scan, not per page),
 * so that column says how many engines cite the page instead, which the scan
 * does record. Answers you miss, then difficulty as a bar.
 */
function PlacementTable(p: { r: RunScanResponse; rows: RunScanResponse["opportunities"] }) {
  const rows = p.rows ?? [];
  const engines = p.r.engines.length;
  return (
    <div style={{ ...CARD, borderRadius: "18px", overflow: "hidden", marginTop: "16px" }}>
      <div className="res-prow res-head" style={{ fontSize: "12px", fontWeight: 600, color: T.soft, borderBottom: "1px solid " + T.line }}>
        <span>Page</span>
        <span>Cited by</span>
        <span>Answers you miss</span>
        <span>Difficulty</span>
      </div>
      {rows.map((o, i) => (
        <div key={o.domain} className="res-prow" style={{ fontSize: "13.5px", borderTop: i ? "1px solid " + T.hair : undefined }}>
          <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>
            <span style={{ fontWeight: 600, color: T.ink }}>{o.domain}</span>
            {o.note ? <span style={{ color: T.soft }}>{" · " + o.note}</span> : null}
          </span>
          <span style={{ color: T.soft }}>{o.cited_by ? o.cited_by + " of " + engines + " engines" : ""}</span>
          <span style={{ color: T.ink }}>
            {o.absent_answers}
            <span className="res-mob">{o.absent_answers === 1 ? " answer you miss" : " answers you miss"}</span>
          </span>
          <DifficultyBar score={o.difficulty ?? null} />
        </div>
      ))}
    </div>
  );
}

/**
 * The first three, as cards: the dial, the page, what it feeds.
 *
 * The board labels them join / join / create and names the brands each page
 * carries. Only join is derivable, and so is not the brand list: a "create"
 * row is a page that does not exist yet, and nothing in the scan records the
 * absence of a page. So these are the three highest-value pages that can be
 * joined, and the second pill says how many engines cite the page - the fact
 * the scan does hold - where the board's says which brands it names.
 */
function PlanCards(p: { r: RunScanResponse; rows: RunScanResponse["opportunities"] }) {
  const rows = p.rows ?? [];
  if (!rows.length) return null;
  const engines = p.r.engines.length;
  const chip = (bg: string, fg: string): React.CSSProperties => ({
    fontSize: "11.5px",
    fontWeight: 600,
    color: fg,
    background: bg,
    borderRadius: "999px",
    padding: "3px 9px",
  });
  return (
    <div className="seq-three">
      {rows.map((o) => (
        <div key={o.domain} style={{ background: T.surface, border: "1px solid " + T.line, borderRadius: "18px", padding: "20px", minWidth: 0 }}>
          <Dial score={o.difficulty ?? null} />
          <div style={{ fontSize: "15px", fontWeight: 700, marginTop: "16px", lineHeight: 1.3, color: T.ink, overflowWrap: "anywhere" }}>{o.domain}</div>
          {o.note ? <div style={{ fontSize: "12.5px", color: T.soft, marginTop: "4px", lineHeight: 1.5 }}>{o.note}</div> : null}
          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginTop: "14px" }}>
            <span style={chip(T.wash, T.accentHover)}>{feeds(o.absent_answers)}</span>
            {o.cited_by ? <span style={chip(T.chip, T.soft)}>{"Cited by " + o.cited_by + " of " + engines + " engines"}</span> : null}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * alwaystracked, as ScanResult.dc.html draws it: a dark card with the purple
 * wash upper right, the argument in four tiles on the left and the walkthrough
 * ask in a white card on the right. The price line is `pricing.ts`'s label and
 * question count, never typed here - the tracked tier is a floor, and "from"
 * travels with the figure.
 */
function TrackedSection(p: { token: string; r: RunScanResponse; cluster: ReturnType<typeof clusterState>; walkthrough?: WalkthroughOutcome | null }) {
  const tracked = TIERS.find((t) => t.id === "tracked");
  // ScanCluster.dc.html's cta=checkout: a cluster scan buys the cluster it
  // just read, now checkout and the webhook are live (R117). Since R139
  // (30 Sep 2026) a UK scan buys too: GBP "plus VAT", its link carrying
  // market=uk (track-offer.ts); VAT is Stripe Tax's, on its page (R129).
  const buy = !!p.cluster;
  const offer = trackOffer(p.r.market, TRACKED_PRICE, checkoutUrlFor("tracked"), p.token);
  const tile = (title: string, body: React.ReactNode) => (
    <div style={{ background: D.card, border: "1px solid " + D.cardLine, borderRadius: "14px", padding: "14px 16px" }}>
      <div style={{ fontSize: "14px", fontWeight: 700, color: T.surface }}>{title}</div>
      <div style={{ fontSize: "13px", lineHeight: 1.5, color: D.muted, marginTop: "4px" }}>{body}</div>
    </div>
  );
  return (
    <section id="tracked" className="res-tracked on-dark" style={{ background: TRACKED_WASH + ", " + D.ground, color: T.surface }}>
      <div>
        <div style={{ fontSize: "18px", fontWeight: 700 }}>
          <TierName tier="tracked" />
        </div>
        <h2 style={{ margin: "10px 0 0", fontSize: "38px", fontWeight: 700, letterSpacing: "-0.035em", lineHeight: 1.08, color: T.surface }} className="res-tracked-h">
          {p.cluster ? "This was one reading of one cluster. See " + word(TRACKED_CLUSTERS) + " of them every day." : "This was one reading. See it every day."}
        </h2>
        {p.cluster ? (
          <div className="res-tiles">
            {tile("Daily, not once", TRACKED_PROMPTS + " prompts on " + word(p.r.engines.length) + " engines, every morning.")}
            {tile(word(TRACKED_CLUSTERS)[0].toUpperCase() + word(TRACKED_CLUSTERS).slice(1) + " clusters", word(TRACKED_KEYWORDS)[0].toUpperCase() + word(TRACKED_KEYWORDS).slice(1) + " keywords on Google, each joined to its five prompts.")}
            {tile("Your own keywords", "The terms your buyers search, checked for volume and intent.")}
            {tile(
              "Reporting only",
              <>
                Winning the placements is <TierName tier="mentioned" />, one cluster at a time.
              </>,
            )}
          </div>
        ) : (
          <div className="res-tiles">
            {tile("Daily, not once", TRACKED_BASIS + ".")}
            {tile("Your own questions", "The ones your buyers actually ask, not ours.")}
            {tile("Adjacent openings", "Pages not cited yet, of the kind these engines reach for.")}
            {tile(
              "Reporting only",
              <>
                Winning the placements is <TierName tier="mentioned" />.
              </>,
            )}
          </div>
        )}
        {tracked ? (
          <div style={{ fontSize: "13px", color: D.muted, marginTop: "18px" }}>
            {(offer.line ?? tracked.priceLabel[0].toUpperCase() + tracked.priceLabel.slice(1)) + ", " + (p.cluster ? TRACKED_CLUSTERS + " clusters checked daily" : TRACKED_BASIS) + "."}
            {trialLine("tracked") ? <span style={{ display: "block", marginTop: "4px", color: T.surface }}>{trialLine("tracked")}</span> : null}
            {/* R151 (3 Oct 2026): without a cluster the card names a price and
                offers only the walkthrough, so a buyer who read the price had
                no way on to what it buys. The quiet link /pr-agencies uses. */}
            {buy ? null : (
              <div>
                <a
                  href={tracked.href}
                  style={{ display: "inline-flex", alignItems: "center", minHeight: "44px", fontSize: "14px", fontWeight: 600, color: T.surface, textDecoration: "underline", textUnderlineOffset: "2px" }}
                >
                  See the plan
                </a>
              </div>
            )}
          </div>
        ) : null}
      </div>
      {buy ? (
        <div data-figure="tracked-checkout" style={{ background: T.surface, color: T.ink, borderRadius: "18px", padding: "24px", minWidth: 0, display: "flex", flexDirection: "column", gap: "14px" }}>
          <div style={{ fontSize: "17px", fontWeight: 700 }}>Track this cluster from tomorrow</div>
          {trialLine("tracked") ? <div style={{ alignSelf: "flex-start", padding: "4px 10px", borderRadius: "999px", background: T.wash, border: "1px solid " + T.washLine, fontSize: "13px", fontWeight: 600, color: T.accent }}>14-day free trial</div> : null}
          <div style={{ display: "flex", flexDirection: "column", gap: "4px", padding: "14px 16px", borderRadius: "12px", background: "#fcfbff", border: "1px solid " + T.washLine }}>
            <span style={{ fontSize: "12px", color: T.soft }}>Your first cluster, set up from this scan</span>
            <span style={{ fontSize: "15px", fontWeight: 700, overflowWrap: "anywhere" }}>{p.cluster === "chosen" ? p.r.cluster_keyword?.keyword : "Needs a keyword"}</span>
            <span style={{ fontSize: "13px", color: T.soft }}>{"and its 5 prompts. Add " + (TRACKED_CLUSTERS - 1) + " more whenever you like."}</span>
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: "8px", flexWrap: "wrap" }}>
            <span style={{ fontSize: "30px", fontWeight: 700, letterSpacing: "-0.03em" }}>{offer.price}</span>
            <span style={{ fontSize: "14px", color: T.soft }}>{(offer.vat ? "plus VAT a month, " : "a month, ") + TRACKED_CLUSTERS + " clusters checked daily"}</span>
          </div>
          <a
            href={offer.href}
            style={{ display: "flex", alignItems: "center", justifyContent: "center", background: T.accent, color: T.surface, fontSize: "15px", fontWeight: 600, borderRadius: "12px", minHeight: "48px", textDecoration: "none" }}
          >
            {trialLine("tracked") ? TRIAL_CTA : "Track this cluster"}
          </a>
          <div style={{ fontSize: "12px", lineHeight: 1.5, color: T.soft }}>{trialLine("tracked") ? `${trialLine("tracked")} The dashboard login arrives by email.` : <>Monthly, 30 days&apos; notice to cancel. The dashboard login arrives by email.</>}</div>
        </div>
      ) : (
        <div style={{ background: T.surface, color: T.ink, borderRadius: "18px", padding: "24px", minWidth: 0 }}>
          <div style={{ fontSize: "17px", fontWeight: 700, marginBottom: "16px" }}>{p.cluster ? "See it on your own cluster" : "See it on your own report"}</div>
          <WalkthroughForm token={p.token} outcome={p.walkthrough} market={p.r.market} />
        </div>
      )}
    </section>
  );
}

/* ── The whole page ── */

/**
 * A section the run has not finished yet (Danny, 2 Oct 2026). The result draws
 * once the answers are stored; who got named, the source kinds and the
 * placement list come after, so their sections hold this until then - with
 * the same turning ring as the scan's buttons, so a visitor who scrolls past
 * the prompts can see it is still working rather than empty.
 */
function Pending(p: { caption: string; error: string | null; what: string }) {
  return (
    <div
      role="status"
      aria-busy={p.error ? undefined : true}
      style={{ ...CARD, padding: "28px 24px", minHeight: "140px", display: "flex", flexDirection: "column", justifyContent: "center", gap: "8px" }}
    >
      {p.error ? (
        <span style={{ fontSize: "14px", lineHeight: 1.55, color: T.badFg }}>{p.error}</span>
      ) : (
        <>
          <span style={{ display: "flex", alignItems: "center", fontSize: "15px", fontWeight: 600, color: T.ink }}>
            <span className="btn-spin" aria-hidden="true" style={{ color: T.accent }} />
            {"Still loading " + p.what}
          </span>
          <span style={{ fontSize: "13px", lineHeight: 1.55, color: T.soft }}>{p.caption + ". This fills in by itself, no need to refresh."}</span>
        </>
      )}
    </div>
  );
}

export default function ResultView(p: {
  r: RunScanResponse;
  domain: string;
  token: string;
  /** R151: the walkthrough ask's outcome, after it posted without script. */
  walkthrough?: WalkthroughOutcome | null;
  /** The count route has already answered zero. */
  noPlacements?: boolean;
  /** Set while the run is still finishing: the answers are final, the brand and source work is not. */
  pending?: { caption: string; error: string | null } | null;
}) {
  const r = p.r;
  const pending = p.pending ?? null;
  /**
   * The keyword's Google position is read alongside the engines and can land
   * after the answers. Until the run finishes a missing rank is "Checking",
   * not "Not in top 20" - the second is a finding, and it is not one yet.
   */
  const rankText =
    pending && clusterState(r) === "chosen" && typeof r.cluster_keyword?.rank !== "number" ? "Checking" : clusterRank(r);
  const f = resultFigures(r, p.domain, { unlocked: true, noPlacements: p.noPlacements });
  const cluster = clusterState(r);
  const qs = r.questions ?? [];
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const close = useCallback(() => setOpenIdx(null), [setOpenIdx]);
  const opps = r.opportunities ?? [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "26px" }}>
      {pending ? (
        <div
          role="status"
          aria-live="polite"
          style={{ display: "flex", alignItems: "center", gap: "4px", flexWrap: "wrap", background: T.wash, borderRadius: "12px", padding: "12px 16px", fontSize: "14px", lineHeight: 1.5, color: T.ink }}
        >
          {pending.error ? (
            <span style={{ color: T.badFg }}>{pending.error}</span>
          ) : (
            <>
              <span style={{ display: "flex", alignItems: "center", fontWeight: 600 }}>
                <span className="btn-spin" aria-hidden="true" style={{ color: T.accent }} />
                {"Still running: " + pending.caption.charAt(0).toLowerCase() + pending.caption.slice(1) + "."}
              </span>
              <span style={{ color: T.soft }}>The prompts and answers below are final. Where to get placed and who is named instead load in as they finish.</span>
            </>
          )}
        </div>
      ) : null}
      {/* Headline */}
      {/* ScanResult.dc.html: the headline beside three figure cards, both
          sitting on one bottom line. The board prints the domain and read date
          in its own header bar; this page keeps the sitewide header, so they
          stay as the line above the headline. */}
      <div className="res-top">
        <div>
          <div style={MICRO}>{p.domain + " · read " + fmtDate(r.read_at)}</div>
          <h1 className="res-h1" style={{ margin: "10px 0 0", fontSize: "50px", fontWeight: 700, letterSpacing: "-0.04em", lineHeight: 1.04, color: T.ink }}>
            {f.headline}
          </h1>
          <p style={{ margin: "14px 0 0", fontSize: "16px", lineHeight: 1.5, color: T.soft }}>{f.standfirst}</p>
          <div style={{ marginTop: "18px", display: "flex", gap: "8px", flexWrap: "wrap" }}>
            {r.engines.map((e) => (
              <div
                key={e.engine}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  background: T.surface,
                  border: "1px solid " + T.line,
                  borderRadius: "999px",
                  padding: "5px 11px 5px 6px",
                  color: T.ink,
                }}
              >
                <EngineLogo engine={e.engine} size={16} inline />
                <span style={{ fontSize: "12.5px", fontWeight: 600 }}>{e.label}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="res-metrics">
          <Metric
            label="Answers naming you"
            value={
              <>
                {f.named} <span style={unit}>{"of " + f.answers}</span>
              </>
            }
            note={f.pct === null ? "No engine answered yet." : f.pct + "% across the question set"}
          />
          <Metric
            label={cluster ? "Prompts, no mention" : "Questions, no mention"}
            value={
              <>
                {f.blank} <span style={unit}>{"of " + f.answeredQuestions}</span>
              </>
            }
            note={cluster ? "Of the prompts an engine answered at all." : "Of the questions an engine answered at all."}
          />
          {/* ScanCluster.dc.html: a scan with a cluster keyword (C1) shows the
              keyword's own Google figure here, or "-" when none qualified;
              a scan from before C1 keeps its best position on any question. */}
          {cluster ? (
            <Metric
              label="Google, for the keyword"
              value={rankText}
              note={
                cluster === "chosen"
                  ? "Your organic position for " + (r.cluster_keyword?.keyword ?? "") + "."
                  : "No Google keyword was picked for this scan, so there is no position to show."
              }
            />
          ) : f.bestRank !== null ? (
            <Metric label="Best Google position" value={"#" + f.bestRank} note="Your best organic position on any of these questions." />
          ) : null}
        </div>
      </div>

      {cluster ? <ClusterSection r={r} chosen={cluster === "chosen"} rank={rankText} onOpen={setOpenIdx} /> : <QuestionTable r={r} onOpen={setOpenIdx} />}

      {/* Where to get placed - the sources, cut down to the ones worth acting on. */}
      {/* 72px between sections on the board: the page's 26px gap plus 46. */}
      <section id="plan" style={{ marginTop: "46px" }}>
        <Head title="Where to get placed" aside={!pending && opps.length ? selfServeLine(r) : null}>
          Pages feeding answers you are missing from, where an article can run.
        </Head>
        {pending ? (
          <Pending caption={pending.caption} error={pending.error} what="where to get placed" />
        ) : opps.length ? (
          <div>
            <PlanCards r={r} rows={opps.slice(0, PLAN_ORDER.length)} />
            {opps.length > PLAN_ORDER.length ? <PlacementTable r={r} rows={opps.slice(PLAN_ORDER.length)} /> : null}
            <HardOnes r={r} />
          </div>
        ) : (
          <NoPlacements sources={r.sources} cluster={clusterState(r) !== null} />
        )}
      </section>

      <div style={{ marginTop: "46px" }}>
        {pending ? (
          <section>
            <Head title="Who is being named instead">The same prompts scored for every brand in the category.</Head>
            <Pending caption={pending.caption} error={pending.error} what="who is named instead" />
          </section>
        ) : (
          <ShareOfVoice r={r} />
        )}
      </div>

      <div style={{ marginTop: "46px" }}>
        <TrackedSection token={p.token} r={r} cluster={cluster} walkthrough={p.walkthrough} />
      </div>

      <AnswerDrawer r={r} idx={openIdx} onClose={close} onMove={setOpenIdx} />
    </div>
  );
}
