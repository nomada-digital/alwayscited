"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { SCAN_LIMITS } from "@/config/contact";
import { QUESTIONS } from "@/config/scan-shape";
import { CARD, MICRO, T } from "@/config/tokens";
import type { Market } from "@/lib/scan";
import { type MarketReason, marketReasonLine } from "@/lib/scan/market-pick";

/**
 * Step 1: what we read off the site, and what we are about to ask.
 *
 * Built from Flow1Confirm.dc.html. The argument of the screen is in its own
 * heading - get the category wrong and every question built on it is wrong,
 * and nobody tells you unless they are asked. So the prompts are written
 * and shown BEFORE anything is paid for.
 *
 * One cluster (BRIEF-3 C1, 30 Sep 2026): the route picks one Google keyword
 * first - measured volume, commercial or transactional intent - and the five
 * prompts are five angles on it. The topic-group chips that used to sit here
 * went with it, and the word "cluster" now means only that keyword and its
 * prompts; the old topic group is `topic` in this file.
 *
 * Nothing here is illustrative. These are the prompts this scan will run:
 * the set that comes back from the preview is the set stored at confirm, and
 * the pipeline asks what it finds rather than writing its own.
 */

/**
 * `own` marks a row the visitor added. It used to be read off `kind ===
 * "custom"`, which stops being true the moment they pick an intent for it.
 * `topic` is the route's `cluster` field on each question: the category or
 * variant it was written under, shown and never edited.
 */
export type PreviewQuestion = { question: string; kind: string; topic: string; own?: boolean };

/** What /api/scan/[token]/questions returns as `cluster_keyword`. */
export type ClusterKeyword = {
  keyword: string | null;
  volume: number | null;
  intent: string | null;
  status: "chosen" | "none_qualified" | "read_failed";
};

/** DataForSEO's four intent labels, sentence case. */
const KEYWORD_INTENT: Record<string, string> = {
  commercial: "Commercial",
  transactional: "Transactional",
  informational: "Informational",
  navigational: "Navigational",
};

/** Our own question kinds, sentence case. The board column is illustrative. */
const INTENT: Record<string, string> = {
  category: "Category",
  positioning: "Positioning",
  sector: "Sector",
  outcome: "Outcome",
  comparison: "Comparison",
  custom: "Yours",
};

/**
 * The cap this screen enforces, and the one the server enforces, are the same
 * number and now come from the same place.
 *
 * /api/scan/[token]/confirm stops at QUESTION_COUNT - `if (out.length >=
 * QUESTION_COUNT) break` - and drops the rest without a word, because the cap
 * has to be enforced where the money is spent rather than trusted from here.
 * A 14 typed on this line is a second copy of that number with nothing holding
 * it in step: lower QUESTIONS and this screen still offers fourteen, still
 * prints "14 of a possible 14" under the button, and the server silently
 * discards the overflow the visitor was just told they could keep.
 *
 * The standfirst above the table reads this too - "A free scan runs up to
 * {MAX_QUESTIONS}" - because it was the one 14 still typed in this file after
 * the constant stopped being. It is the sentence a visitor reads immediately
 * before counting the rows, so it is the copy that gets caught being wrong.
 *
 * It was not the one. The cluster standfirst below carried the same number
 * spelled as a word - "than fourteen variations of the same thing" - and
 * survived five sweeps for this defect because every one of them looked for
 * the digit. A number written out is the same claim and goes stale the same
 * way; copy.test.mts now refuses both spellings so the sixth sweep does not
 * have to be run by hand.
 */
const MAX_QUESTIONS = QUESTIONS;

const fieldStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  fontFamily: "inherit",
  fontSize: "14px",
  color: T.ink,
  background: T.surface,
  border: "1px solid " + T.line,
  borderRadius: "10px",
  padding: "11px 13px",
};

const fieldLabel: React.CSSProperties = {
  display: "block",
  fontSize: "13px",
  fontWeight: 600,
  color: T.ink,
  margin: "12px 0 6px",
};

const rowInput: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  fontFamily: "inherit",
  fontSize: "13.5px",
  color: T.ink,
  background: "transparent",
  border: "1px solid transparent",
  borderRadius: "8px",
  padding: "4px 6px",
  margin: "-4px -6px",
  /**
   * A textarea that grows to its text, 24 September 2026. As a one-line input
   * the long questions were cut off on the one screen that asks the visitor to
   * read and correct them - 2 of 5 on the rotaready.com scan.
   */
  display: "block",
  resize: "none",
  overflow: "hidden",
  lineHeight: 1.45,
  fieldSizing: "content",
} as React.CSSProperties;

/** The intents a visitor can give their own question. */
const PICKABLE = ["category", "positioning", "sector", "outcome", "comparison"];

/** Intent on an own row: the cell's size, with a box round it. */
const rowSelect: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  fontFamily: "inherit",
  fontSize: "12.5px",
  color: T.ink,
  background: T.surface,
  border: "1px solid " + T.line,
  borderRadius: "8px",
  padding: "3px 6px",
  margin: "-4px 0",
};

const quietBtn: React.CSSProperties = {
  fontFamily: "inherit",
  fontSize: "13px",
  lineHeight: 1,
  color: T.soft,
  background: "none",
  border: 0,
  cursor: "pointer",
  padding: "4px 6px",
  // The padding is hit area, not layout: without this the Remove cell was the
  // tallest in the row and set every question row 7px over the board's.
  margin: "-4px -6px",
};

export default function ConfirmScreen(p: {
  token: string;
  domain: string;
  brand: string | null;
  positioning: string | null;
  initialTopic: string;
  initialMarket: Market;
  /** Why the market opened where it did. Null hides the line. */
  marketReason?: MarketReason | null;
  variants: string[];
  /** Returns a message when the run could not be started, null when it could. */
  onRun: (input: {
    topic: string;
    market: Market;
    questions: { question: string; kind: string }[];
  }) => Promise<string | null>;
  running: boolean;
}) {
  const [topic, setTopic] = useState(p.initialTopic);
  const [market, setMarket] = useState<Market>(p.initialMarket);

  const [questions, setQuestions] = useState<PreviewQuestion[]>([]);
  const [keyword, setKeyword] = useState<ClusterKeyword | null>(null);

  /**
   * True from the first paint when there is a category to work from, because
   * that is when the request is about to fire. Starting at false rendered
   * "tell us the category above" for one frame under a field that already had
   * one, which is the wrong thing to say to somebody who is waiting.
   */
  const [writing, setWriting] = useState(p.initialTopic.trim().length >= 2);
  const [error, setError] = useState("");
  /** The topic and market the set on screen was written for. */
  const [writtenFor, setWrittenFor] = useState<{ topic: string; market: Market } | null>(null);

  const lastRef = useRef<HTMLTextAreaElement | null>(null);
  const focusLast = useRef(false);

  const write = useCallback(
    async (forTopic: string, forMarket: Market) => {
      setWriting(true);
      setError("");
      try {
        const headers = new Headers();
        headers.set("content-type", "application/json");
        const res = await fetch("/api/scan/" + p.token + "/questions", {
          method: "POST",
          headers,
          body: JSON.stringify({ topic: forTopic, market: forMarket, topic_variants: p.variants }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.message ?? "We could not write the prompts just now. Try again.");
          return;
        }
        setQuestions(
          ((data.questions ?? []) as { question: string; kind: string; cluster: string }[]).map((q) => ({
            question: q.question,
            kind: q.kind,
            topic: q.cluster,
          })),
        );
        setKeyword((data.cluster_keyword as ClusterKeyword | undefined) ?? null);
        setWrittenFor({ topic: forTopic, market: forMarket });
      } catch {
        setError("We could not reach the checker. Try again.");
      } finally {
        setWriting(false);
      }
    },
    [p.token, p.variants],
  );

  /**
   * Written once, on arrival, when the site gave us a category to work from.
   * A site that did not is left with an empty field rather than a guess, so
   * there is nothing to write yet.
   *
   * On the disable below, because this was the last lint error in the project
   * and it is worth saying why it is not a defect rather than leaving it to be
   * re-litigated every run.
   *
   * react-hooks/set-state-in-effect is aimed at cascading renders: an effect
   * that sets state, causing a render, causing the effect again. That cannot
   * happen here, and it is provable rather than argued. `write` opens with
   * setWriting(true) and setError(""), and on the only path this effect takes:
   *
   * - `writing` is initialised to `p.initialTopic.trim().length >= 2`, which
   *   is the same condition guarding the call. So it is already true.
   * - `error` is initialised to "", which is what it is set to.
   *
   * Both are therefore no-op sets, and React bails out of re-rendering when
   * setState is given the value it already holds. The rule flags it because it
   * cannot see the coupling between the useState initialiser twenty lines up
   * and the guard on this line - and that coupling is deliberate, written to
   * stop the screen saying "tell us the category above" for one frame under a
   * field that already had one.
   *
   * The run-once ref is the other half: the effect re-runs when `write` is
   * rebuilt, and without the guard a second request would fire mid-typing.
   *
   * Restructuring to satisfy the rule - deferring the call into a microtask,
   * say - would add a frame of nothing on the first screen of the funnel to
   * silence a warning about a render that does not occur. Narrowed to this one
   * line so the rule stays live everywhere else.
   */
  /**
   * Every question box sized to its text, for browsers without
   * `field-sizing: content`. Runs after each render, which is when a question
   * can change, and on resize, which is when the column width can.
   */
  useEffect(() => {
    const fit = () =>
      document.querySelectorAll<HTMLTextAreaElement>("textarea.q-text").forEach((t) => {
        t.style.height = "auto";
        t.style.height = t.scrollHeight + "px";
      });
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  });

  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- see above: both sets are no-ops on this path
    if (p.initialTopic.trim().length >= 2) void write(p.initialTopic, p.initialMarket);
  }, [p.initialTopic, p.initialMarket, write]);

  useEffect(() => {
    if (focusLast.current && lastRef.current) {
      lastRef.current.focus();
      focusLast.current = false;
    }
  });

  const stale = Boolean(writtenFor && (writtenFor.topic.trim() !== topic.trim() || writtenFor.market !== market));
  const isOwn = (q: PreviewQuestion) => q.own === true;
  /**
   * Counted off what would actually run, not off the rows on screen: a blank
   * row the visitor has just added is on screen and not in the run, so the
   * footer and the Add cap both read `kept`.
   */
  const kept = questions.filter((q) => q.question.trim().length >= 4);
  const atMax = kept.length >= MAX_QUESTIONS;
  const needsWriting = stale || !writtenFor;
  const canAct = topic.trim().length >= 2 && !writing && !p.running && (needsWriting || kept.length > 0);

  async function run() {
    if (!kept.length) return;
    const message = await p.onRun({
      topic: topic.trim(),
      market,
      questions: kept.map((q) => ({ question: q.question.trim(), kind: q.kind })),
    });
    if (message) setError(message);
  }

  /**
   * Run without the preview.
   *
   * The set is written by a model call, and a model call can be down. Without
   * this, a visitor whose preview failed twice has no way to run a scan at
   * all - which is worse than running one they did not get to prune. Sending
   * no questions is what the pipeline already handles: it writes its own set,
   * exactly as it did before this screen existed.
   */
  async function runBlind() {
    const message = await p.onRun({ topic: topic.trim(), market, questions: [] });
    if (message) setError(message);
  }

  function edit(index: number, text: string) {
    setQuestions((prev) => prev.map((q, i) => (i === index ? { ...q, question: text } : q)));
  }

  /** Intent is the visitor's to set, but only on a row they added. */
  function setIntent(index: number, kind: string) {
    setQuestions((prev) => prev.map((q, i) => (i === index ? { ...q, kind } : q)));
  }

  function remove(index: number) {
    setQuestions((prev) => prev.filter((_, i) => i !== index));
  }

  function add() {
    focusLast.current = true;
    setQuestions((prev) => [...prev, { question: "", kind: "custom", topic: topic.trim(), own: true }]);
  }

  const busy = writing || p.running;
  const primaryLabel = p.running
    ? "Starting"
    : writing
      ? "Writing the prompts"
      : needsWriting
        ? "Write the prompts"
        : "Run " + kept.length + (kept.length === 1 ? " prompt" : " prompts");

  // What the report's Google line reads (pipeline rankClusterKeyword): the
  // cluster keyword's rank when one was chosen, else the rank for each
  // prompt's own text.
  const footerText =
    kept.length +
    " of a possible " +
    MAX_QUESTIONS +
    (keyword?.status === "chosen" && keyword.keyword
      ? ". The report shows where you rank on Google for " + keyword.keyword + " beside what the engines said."
      : ". The report shows where you rank on Google for each one beside what the engines said.");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "26px" }}>
      <div className="confirm-top confirm-12">
        {/* One measure for the whole left column (Danny, 27 Sep 2026). The
            paragraphs each carried their own 62ch, and a ch is the width of
            the element's own font, so the 13px line wrapped about 45px short
            of the 14.5px one and the h1 ran on to the full seven columns -
            three wrap points. The 62ch is read at 14.5px, here, once. */}
        <div style={{ fontSize: "14.5px", maxWidth: "62ch" }}>
          <div style={MICRO}>{p.domain}</div>
          <h1
            style={{
              margin: "10px 0 0",
              fontSize: "32px",
              fontWeight: 700,
              letterSpacing: "-0.03em",
              lineHeight: 1.2,
              color: T.ink,
            }}
          >
            This is what we read off the site. Correct it before we run.
          </h1>
          <p style={{ margin: "12px 0 0", lineHeight: 1.65, color: T.soft }}>
            The keyword and the prompts come from what the site says it sells. If the category is wrong, everything after it is
            wrong too - so it is worth ten seconds now.
          </p>
          {p.positioning ? (
            <p style={{ margin: "12px 0 0", fontSize: "13px", lineHeight: 1.6, color: T.soft }}>
              From the site: {p.positioning}
            </p>
          ) : null}
        </div>

        <div style={{ ...CARD, padding: "22px", alignSelf: "start" }}>
          <div style={MICRO}>What we think you sell</div>
          <label htmlFor="confirm-category" style={fieldLabel}>
            Category
          </label>
          {/* The confirm and questions routes both refuse a topic over
              SCAN_LIMITS.topic. Unbounded here, a pasted category came back
              "Tell us the category in a few words" from a field that visibly
              held a category. */}
          <input
            id="confirm-category"
            type="text"
            maxLength={SCAN_LIMITS.topic}
            value={topic}
            placeholder="b2b seo agency"
            onChange={(e) => setTopic(e.target.value)}
            style={fieldStyle}
          />
          {/* A legend's top margin is not honoured inside a fieldset, so the
              board's 14px gap above "Market" lives on the fieldset instead. */}
          <fieldset style={{ border: 0, padding: 0, margin: "14px 0 0" }}>
            <legend style={{ ...fieldLabel, margin: "0 0 6px", padding: 0 }}>Market</legend>
            <div style={{ display: "flex", gap: "8px" }}>
              {(["UK", "US"] as Market[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMarket(m)}
                  aria-pressed={market === m}
                  style={{
                    flex: 1,
                    fontFamily: "inherit",
                    fontSize: "14px",
                    fontWeight: 600,
                    padding: "11px 13px",
                    borderRadius: "10px",
                    cursor: "pointer",
                    color: market === m ? T.surface : T.ink,
                    background: market === m ? T.accent : T.surface,
                    border: "1px solid " + (market === m ? T.accent : T.line),
                  }}
                >
                  {m === "UK" ? "United Kingdom" : "United States"}
                </button>
              ))}
            </div>
            {/* Why it opened here - shown until the visitor changes it, because
                after that the choice is theirs and the sentence would be wrong. */}
            {market === p.initialMarket && marketReasonLine(p.domain, { market, reason: p.marketReason ?? null }) ? (
              <p style={{ margin: "8px 0 0", fontSize: "12.5px", lineHeight: 1.5, color: T.soft }}>
                {marketReasonLine(p.domain, { market, reason: p.marketReason ?? null })}
              </p>
            ) : null}
          </fieldset>
          <button
            type="button"
            className="btn-primary"
            onClick={() => (needsWriting ? void write(topic.trim(), market) : void run())}
            disabled={!canAct}
            data-busy={busy ? "1" : undefined}
            aria-busy={busy || undefined}
            style={{
              width: "100%",
              marginTop: "16px",
              fontFamily: "inherit",
              fontSize: "15px",
              fontWeight: 600,
              border: 0,
              borderRadius: "10px",
              padding: "13px 20px",
              cursor: canAct ? "pointer" : "default",
            }}
          >
            {/* The same turning ring as the first step's Checking button
                (ScanBox): writing takes a few seconds and the label alone
                read as stuck (Danny, 2 Oct 2026). */}
            {busy ? <span className="btn-spin" aria-hidden="true" /> : null}
            {primaryLabel}
          </button>
          <p style={{ margin: "10px 0 0", fontSize: "12.5px", color: T.soft }}>
            No email needed. The result is free in full.
          </p>
          {error ? (
            <p role="alert" style={{ margin: "10px 0 0", fontSize: "12.5px", color: T.badFg }}>
              {error}
            </p>
          ) : null}
          {error && !writtenFor && topic.trim().length >= 2 ? (
            <button
              type="button"
              onClick={() => void runBlind()}
              disabled={p.running}
              style={{
                marginTop: "8px",
                padding: 0,
                fontFamily: "inherit",
                fontSize: "12.5px",
                fontWeight: 600,
                color: T.accent,
                background: "none",
                border: 0,
                cursor: "pointer",
              }}
            >
              Run it anyway, and we will write the prompts as it goes
            </button>
          ) : null}
        </div>
      </div>

      {keyword ? (
        <section>
          <div className="board-head confirm-head" style={{ marginBottom: "14px" }}>
            <h2 style={{ margin: 0, fontSize: "19px", fontWeight: 700, letterSpacing: "-0.022em", color: T.ink }}>
              The Google keyword
            </h2>
            <p style={{ margin: 0, fontSize: "14px", lineHeight: 1.6, color: T.soft }}>
              {keyword.status === "chosen"
                ? "The term a buyer types into Google when choosing a supplier, with searches behind it. The prompts below are five angles on it."
                : keyword.status === "read_failed"
                  ? "We couldn't check Google search volume just now. The prompts below are written on the category, and nomada digital picks the keyword when you start tracking."
                  : "We couldn't find a commercial Google term with search volume for this. The prompts below are written on the category, and nomada digital picks the keyword when you start tracking."}
            </p>
          </div>
          {keyword.status === "chosen" && keyword.keyword ? (
            <div
              data-figure="cluster-keyword"
              style={{
                ...CARD,
                padding: "16px 22px",
                display: "flex",
                alignItems: "baseline",
                gap: "10px 28px",
                flexWrap: "wrap",
                opacity: stale ? 0.55 : 1,
              }}
            >
              <div style={{ fontSize: "17px", fontWeight: 700, letterSpacing: "-0.015em", color: T.ink }}>
                {keyword.keyword}
              </div>
              {keyword.volume != null ? (
                <div style={{ fontSize: "13.5px", color: T.soft }}>
                  <span style={{ fontWeight: 600, color: T.ink }}>{keyword.volume.toLocaleString("en-GB")}</span>{" "}
                  searches a month in the {writtenFor?.market ?? market}
                </div>
              ) : null}
              {keyword.intent ? <div style={MICRO}>{KEYWORD_INTENT[keyword.intent] ?? keyword.intent} intent</div> : null}
            </div>
          ) : null}
        </section>
      ) : null}

      <section>
        <div className="board-head confirm-head" style={{ marginBottom: "14px" }}>
          <h2 style={{ margin: 0, fontSize: "19px", fontWeight: 700, letterSpacing: "-0.022em", color: T.ink }}>
            Your five prompts
          </h2>
          <p style={{ margin: 0, fontSize: "14px", lineHeight: 1.6, color: T.soft }}>
            Written as a buyer would type them into an AI engine, not as keywords, and aimed at the end of the
            decision rather than the top of it. Edit any of them, swap one out, or add your own. A free scan runs up
            to {MAX_QUESTIONS}.
          </p>
        </div>

        <div style={{ ...CARD, overflow: "hidden", opacity: stale ? 0.55 : 1 }}>
          <div className="q-row q-head" style={{ background: "#fbfbfc", borderBottom: "1px solid " + T.line }}>
            <div style={MICRO}>#</div>
            <div style={MICRO}>Prompt</div>
            <div style={MICRO}>Cluster</div>
            <div style={MICRO}>Intent</div>
            <div />
          </div>

          {questions.length === 0 ? (
            <p style={{ margin: 0, padding: "18px 26px", fontSize: "13.5px", color: T.soft }}>
              {writing
                ? "Checking the Google keyword and writing the prompts a buyer in this category would type. It takes a few seconds."
                : "Tell us the category above and we will write the prompts before anything runs."}
            </p>
          ) : null}

          {questions.map((q, i) => {
            /**
             * indexOf returns -1, and -1 + 1 is 0, so a prompt the visitor had
             * just added numbered itself 0 until the first character was typed
             * into it - a blank row fails the length test in `kept`. A row that
             * is not counted yet draws nothing.
             */
            const at = kept.indexOf(q);
            const position = at >= 0 ? at + 1 : "";
            const rowLabel = "Prompt " + (i + 1);
            const removeLabel = "Remove prompt " + (i + 1);
            return (
              <div key={i} className="q-row" style={{ borderBottom: "1px solid " + T.hair }}>
                <div style={{ fontSize: "13px", color: T.soft }}>{position}</div>
                <div>
                  <textarea
                    ref={i === questions.length - 1 ? lastRef : undefined}
                    rows={1}
                    className="q-text"
                    value={q.question}
                    onChange={(e) => edit(i, e.target.value.replace(/\n/g, " "))}
                    onKeyDown={(e) => {
                      // One prompt per row: Enter does not start a second line.
                      if (e.key === "Enter") e.preventDefault();
                    }}
                    aria-label={rowLabel}
                    placeholder="the prompt a buyer would type"
                    maxLength={SCAN_LIMITS.question}
                    style={rowInput}
                  />
                </div>
                <div style={{ fontSize: "12.5px", color: T.soft }}>{q.topic}</div>
                {isOwn(q) ? (
                  <div>
                    <select
                      value={q.kind}
                      onChange={(e) => setIntent(i, e.target.value)}
                      aria-label={"Intent for prompt " + (i + 1)}
                      style={rowSelect}
                    >
                      {/* "Yours" is the unset state, not a pick: it shows until
                          something else is chosen, then leaves the list. */}
                      {q.kind === "custom" ? <option value="custom">{INTENT.custom}</option> : null}
                      {PICKABLE.map((k) => (
                        <option key={k} value={k}>
                          {INTENT[k]}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <div style={MICRO}>{INTENT[q.kind] ?? INTENT.custom}</div>
                )}
                {/* Flex, not text-align: an inline button sits on the div's own
                    16px line and made this the tallest cell in the row. */}
                <div style={{ display: "flex", justifyContent: "flex-end", paddingTop: "3px" }}>
                  <button type="button" onClick={() => remove(i)} aria-label={removeLabel} className="q-remove" style={quietBtn}>
                    Remove
                  </button>
                </div>
              </div>
            );
          })}

          <div style={{ padding: "12px 26px", display: "flex", alignItems: "baseline", gap: "14px", flexWrap: "wrap" }}>
            <span style={{ fontSize: "13px", color: T.soft }}>
              {footerText}
            </span>
            <div style={{ flexGrow: 1 }} />
            <button
              type="button"
              onClick={add}
              disabled={atMax}
              style={{
                fontFamily: "inherit",
                fontSize: "13px",
                fontWeight: 600,
                color: atMax ? T.faint : T.accent,
                background: "none",
                border: 0,
                cursor: atMax ? "default" : "pointer",
                padding: 0,
              }}
            >
              Add a prompt
            </button>
          </div>
        </div>

        {stale ? (
          <p style={{ margin: "10px 0 0", fontSize: "13px", color: T.warnFg }}>
            These were written for a different category. Rewrite them before you run.
          </p>
        ) : null}
      </section>
    </div>
  );
}
