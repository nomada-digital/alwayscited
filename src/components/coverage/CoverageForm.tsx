"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import Turnstile from "@/components/scan/Turnstile";
import { COVERAGE_LIMITS, WAITLIST_LIMITS } from "@/config/contact";
import { CARD, GRID12, H2, MICRO, T } from "@/config/tokens";
import { MAX_COVERAGE_BYTES, MAX_COVERAGE_ROWS, MAX_COVERAGE_URLS, parseCoverageCsv } from "@/lib/coverage/csv";
import { type DraftRow, runBlocker, tickedRows } from "@/lib/coverage/draft";
import { MAX_AGENCY_PROMPTS } from "@/lib/coverage/prompts";
import { track } from "@/lib/analytics";
import { count } from "@/lib/plural";
import { isPlausibleDomain, normalizeDomain } from "@/lib/scan/domain";

/**
 * The campaign form, which now runs.
 *
 * The page it sits in carried a "Not open yet" panel and four disabled inputs
 * until the run path existed, and the reason that panel was there is the reason
 * this component looks the way it does: there is still no email field. A
 * reading opens on its own link, which needs nothing from the visitor, so
 * nothing is collected that we cannot use. The address goes in when the backend
 * can send - proposal 6, together with its line in the privacy policy.
 *
 * The coverage file is read in the browser and posted as text. It is a list of
 * URLs - 500 of them is perhaps 30KB - so a multipart upload would be a second
 * request shape on this site for no benefit, and the server bounds the body
 * before it parses it either way.
 */

const field: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  fontFamily: "inherit",
  fontSize: "14px",
  color: T.ink,
  background: T.surface,
  border: `1px solid ${T.line}`,
  borderRadius: "10px",
  padding: "11px 13px",
};

const labelStyle: React.CSSProperties = { ...MICRO, display: "block", marginBottom: "6px" };

export default function CoverageForm({ intro }: { intro: React.ReactNode }) {
  const router = useRouter();
  const [brand, setBrand] = useState("");
  const [domain, setDomain] = useState("");
  const [topic, setTopic] = useState("");
  const [segment, setSegment] = useState("");
  const [market, setMarket] = useState<"UK" | "US">("UK");
  const [csv, setCsv] = useState("");
  /**
   * Pasted URLs, one per line, which is how a publicist actually has them.
   *
   * A separate field from the file rather than a second way to fill the same
   * one: a reader who has pasted three links and then picks a file is doing
   * something deliberate, and silently discarding either half would be worse
   * than either. Both are parsed by the same function and concatenated, and
   * the count under them is the count of what will actually be read.
   */
  const [pasted, setPasted] = useState("");
  /** The agency's own prompts, one per line. Optional. */
  const [prompts, setPrompts] = useState("");
  const [fileNote, setFileNote] = useState("");
  /**
   * True when the chosen file yielded no links at all. Kept apart from
   * `fileNote` because it is the one case that needs the reader to act, so it
   * is coloured and does not read as a confirmation.
   */
  const [fileUnread, setFileUnread] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  /**
   * The field a refusal is about, when it is about one (R151): the sentence is
   * drawn under that field, linked by aria-describedby, and focus moves there.
   * Null means the run controls carry it, as a server refusal always has.
   */
  const [errorFor, setErrorFor] = useState<string | null>(null);

  function refuse(text: string, id: string | null) {
    setError(text);
    setErrorFor(id);
    if (id) document.getElementById(id)?.focus();
  }

  function clearError() {
    setError("");
    setErrorFor(null);
  }
  /**
   * Two steps since 1 Oct 2026 (R140, Danny, danny.md lines 128-133). Step 1
   * is the coverage alone; step 2 is the draft the route built from it, every
   * field editable, and only step 2's "Run the reading" reaches the engines.
   */
  const [step, setStep] = useState<1 | 2>(1);
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [marketLine, setMarketLine] = useState("");
  const [unread, setUnread] = useState<string[]>([]);
  const [reportLimit, setReportLimit] = useState<string | null>(null);
  const [domainRefusal, setDomainRefusal] = useState<string | null>(null);
  /** The client domain whose per-domain ceiling (FREE_RUN_DAYS) was last asked about (checkDomain). */
  const askedFor = useRef("");

  /**
   * What the file turned out to hold, said here rather than after the reading
   * starts.
   *
   * `parseCoverageCsv` is a pure function over a string with no `server-only`,
   * and this component already imports `MAX_COVERAGE_BYTES` from the same
   * module - so the parser is in this bundle either way and running it costs
   * nothing new.
   *
   * It is run here because this is the only moment the reader can still do
   * anything about the answer. The route computes `stored`, `skipped` and
   * `truncated` and returns them with a comment saying the form needs to show
   * what was read "now, not after the pass finishes" - and the form then
   * navigated to the reading without looking at them, so nothing ever did. The
   * case csv.ts names is a coverage export whose link column holds headlines:
   * it parses to nothing, and an upload that stored no placements is
   * indistinguishable on the reading page from a campaign that uploaded none.
   *
   * The server parses again and its answer is still the one that counts. This
   * is a preview of it, from the same function, so the two cannot disagree.
   */
  function noteFor(name: string, text: string): { note: string; unread: boolean } {
    const parsed = parseCoverageCsv(text);
    const found = parsed.rows.length;

    if (found === 0) {
      return {
        note: "No links found in that file. We look for a web address in any column - check it holds the URLs and not just the headlines.",
        unread: true,
      };
    }
    if (parsed.truncated) {
      return {
        note: `${name} - first ${count(MAX_COVERAGE_ROWS, "link")} read, and the rest of the file was not.`,
        unread: false,
      };
    }
    // One skipped line is almost always the header, which is not worth a
    // sentence. More than one means a shape we did not read, and that is.
    if (parsed.skipped > 1) {
      return {
        note: `${name} - ${count(found, "link")} found, and ${count(parsed.skipped, "line")} with none.`,
        unread: false,
      };
    }
    return { note: `${name} - ${count(found, "link")} found, matched against every source the engines cite.`, unread: false };
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) {
      setCsv("");
      setFileNote("");
      setFileUnread(false);
      return;
    }
    // Bounded here as well as on the server. The server's limit is the one that
    // counts; this one exists so a visitor who picks the wrong file is told
    // before they wait for an upload that will be refused.
    if (file.size > MAX_COVERAGE_BYTES) {
      setCsv("");
      setFileNote("");
      setFileUnread(false);
      refuse("That file is too large. A list of URLs, not the articles themselves.", "cc-coverage");
      return;
    }
    const text = await file.text();
    setCsv(text);
    clearError();
    const { note, unread } = noteFor(file.name, text);
    setFileNote(note);
    setFileUnread(unread);
  }

  /**
   * Everything the reading will be given, from both fields, through the one
   * parser the server uses.
   *
   * Built on every render rather than kept in state, because it is a function
   * of two fields and a second copy in state is a second thing to keep in step
   * - which is the defect this repo keeps paying for. `parseCoverageCsv` is
   * already in this bundle and a handful of lines costs nothing.
   */
  const coverageText = [pasted, csv].filter((t) => t.trim()).join("\n");
  const coverageFound = parseCoverageCsv(coverageText).rows.length;
  const coverageKept = Math.min(coverageFound, MAX_COVERAGE_URLS);
  const promptLines = prompts.split(/\r\n|\r|\n/).map((l) => l.trim()).filter(Boolean);
  const promptsKept = Math.min(promptLines.length, MAX_AGENCY_PROMPTS);

  /** Step 1: the coverage goes to the draft route, and step 2 opens on what it sends back. */
  async function onDraft(e: React.FormEvent) {
    e.preventDefault();
    clearError();
    if (!coverageFound) {
      refuse("Paste the URLs of the pieces you placed, or drop a CSV of them.", "cc-links");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/coverage-check/draft", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ coverageLinks: pasted, coverageCsv: csv, turnstileToken }),
      });
      const json = (await res.json()) as {
        message?: string;
        brand?: string;
        clientDomain?: string;
        topic?: string;
        segment?: string;
        prompts?: string[];
        market?: "UK" | "US";
        marketLine?: string;
        rows?: DraftRow[];
        reportLimit?: string | null;
        unread?: string[];
        domainRefusal?: string | null;
      };
      if (!res.ok || !json.rows) {
        setError(json.message ?? "We could not build a draft from that. Please try again.");
        return;
      }
      setBrand(json.brand ?? "");
      setDomain(json.clientDomain ?? "");
      setTopic(json.topic ?? "");
      setSegment(json.segment ?? "");
      setPrompts((json.prompts ?? []).join("\n"));
      setMarket(json.market === "UK" ? "UK" : "US");
      setMarketLine(json.marketLine ?? "");
      setRows(json.rows);
      setReportLimit(json.reportLimit ?? null);
      setUnread(json.unread ?? []);
      setDomainRefusal(json.domainRefusal ?? null);
      // Already checked by the draft route; a blur without an edit asks nothing.
      askedFor.current = (json.clientDomain ?? "").trim();
      // Turnstile tokens are single use and the run route checks its own.
      setTurnstileToken(null);
      setStep(2);
    } catch {
      setError("We could not reach the draft. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  /**
   * The per-domain ceiling (FREE_RUN_DAYS, 7 days since 1 Oct 2026) for a domain the visitor typed (R140 part 4), asked as
   * the field loses focus so the refusal sits under it before the run. The
   * draft already checked the domain it found. An answer for a domain the
   * field no longer holds is dropped, and a failed check says nothing: the run
   * route asks again and gives the same sentence.
   */
  async function checkDomain(value: string) {
    const typed = value.trim();
    if (!typed || typed === askedFor.current) return;
    askedFor.current = typed;
    try {
      const res = await fetch("/api/coverage-check/domain", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ domain: typed }),
      });
      const json = (await res.json()) as { refusal?: string | null };
      if (askedFor.current === typed) setDomainRefusal(res.ok ? (json.refusal ?? null) : null);
    } catch {
      // Said by the run route instead.
    }
  }

  /** aria props for a field a refusal may be about, and the sentence drawn under it. */
  const invalid = (id: string) =>
    errorFor === id ? { "aria-invalid": true as const, "aria-describedby": `${id}-error` } : {};
  const fieldError = (id: string) =>
    errorFor === id && error ? (
      <p id={`${id}-error`} role="alert" style={{ margin: "6px 0 0", fontSize: "12.5px", color: T.badFg, lineHeight: 1.5 }}>
        {error}
      </p>
    ) : null;

  const blocker = step === 2 ? runBlocker({ clientDomain: domain, rows }) : null;
  const tickedCount = rows.filter((r) => r.ticked).length;

  /** Step 2: the same fields /api/coverage-check has always taken, the coverage being the ticked rows. */
  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    clearError();
    if (blocker) {
      // A domain refusal is about the domain field; "tick at least one" is about the list, said by the button.
      refuse(blocker, domain.trim() && isPlausibleDomain(normalizeDomain(domain)) ? null : "cc-domain");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/coverage-check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          brand,
          domain,
          topic,
          segment,
          market,
          coverageLinks: tickedRows(rows).map((r) => r.url).join("\n"),
          coverageCsv: "",
          coveragePrompts: prompts,
          turnstileToken,
        }),
      });
      const json = (await res.json()) as { token?: string; message?: string; error?: string };
      if (json.error === "domain_recently_read" && json.message) {
        // Under the field it is about, as the blur check would have put it.
        setDomainRefusal(json.message);
        return;
      }
      if (!res.ok || !json.token) {
        // The server's own sentence, which knows why it refused. A generic
        // "something went wrong" here would replace "you have used today's
        // free benchmarks" with nothing the reader can act on.
        setError(json.message ?? "We could not start that benchmark. Please try again.");
        return;
      }
      track("coverage_check_start", { market });
      router.push(`/coverage-check/${json.token}`);
    } catch {
      setError("We could not reach the benchmark. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  /** The run controls, in the card on both steps: the widget, the refusal, the button and its foot line. */
  const runControls = (
    <>
      {/* Keyed on the step: a token is spent by the draft, so step 2 mounts a fresh widget for the run. */}
      <Turnstile key={step} onToken={setTurnstileToken} />

      {error && !errorFor && (
        <p role="alert" style={{ margin: "12px 0 0", fontSize: "13px", color: T.badFg, lineHeight: 1.55 }}>
          {error}
        </p>
      )}

      <button
        type="submit"
        className="btn-primary"
        disabled={busy}
        style={{
          width: "100%",
          marginTop: "14px",
          fontSize: "15px",
          fontWeight: 600,
          fontFamily: "inherit",
          color: "#ffffff",
          background: T.accent,
          border: "none",
          borderRadius: "10px",
          padding: "13px 20px",
          cursor: busy ? "default" : "pointer",
        }}
      >
        {step === 1 ? (busy ? "Reading the coverage" : "Build the draft") : busy ? "Starting the reading" : "Run the reading"}
      </button>
      <p style={{ margin: "10px 0 0", fontSize: "12.5px", color: T.soft, lineHeight: 1.55 }}>
        Free, and no email. The reading opens on its own link, which keeps working - so you can send it on or come
        back to it.
      </p>
    </>
  );

  /**
   * Step 1: the page's own introduction on the left and the coverage in the
   * card, the same grid and the same DOM the page drew before the form owned it.
   */
  if (step === 1) {
    return (
      <div className="board-head" style={{ ...GRID12, alignItems: "start" }}>
        {intro}
        <div style={{ ...CARD, gridColumn: "span 5", padding: "22px" }}>
          <form onSubmit={onDraft} noValidate>
            <div style={MICRO}>Step 1 of 2: the coverage</div>
            <div style={{ marginTop: "12px", display: "flex", flexDirection: "column", gap: "12px" }}>
              <div>
                <label htmlFor="cc-links" style={labelStyle}>
                  Coverage
                </label>
                <textarea
                  id="cc-links"
                  {...invalid("cc-links")}
                  style={{ ...field, minHeight: "96px", resize: "vertical", borderColor: errorFor === "cc-links" ? T.badFg : T.line }}
                  maxLength={COVERAGE_LIMITS.links.max}
                  /* No scheme, deliberately. `parseCoverageCsv` and `comparableUrl` both
                      accept a bare host, and `route-closure.test.mts` reads an https
                      literal in a component as an origin the page loads - which this
                      is not, it is example text in a placeholder. The shorter form
                      is also what somebody pasting out of a coverage report has. */
                  placeholder={"publication.com/the-piece-you-placed\nanother.com/and-the-next"}
                  value={pasted}
                  onChange={(e) => setPasted(e.target.value)}
                />
                {fieldError("cc-links")}
                <p style={{ margin: "6px 0 0", fontSize: "12.5px", color: T.soft, lineHeight: 1.5 }}>
                  {`One URL per line, up to ${MAX_COVERAGE_URLS}. We report on each one: whether the engines cited that page, or the publication, or neither.`}
                </p>
                {/* The board's dashed drop zone. The native input stays, stretched
                    transparent over the zone, so a dropped file, a click and the
                    keyboard all reach the real control; the label is its name,
                    which the bare "Choose file" button never had. */}
                <label
                  htmlFor="cc-coverage"
                  className="cc-drop"
                  style={{
                    position: "relative",
                    display: "block",
                    marginTop: "10px",
                    border: `1px dashed ${T.soft}`,
                    borderRadius: "12px",
                    padding: "14px",
                    textAlign: "center",
                    background: T.surface,
                    fontSize: "13px",
                    color: T.soft,
                    cursor: "pointer",
                  }}
                >
                  Or drop a CSV of URLs here, or{" "}
                  <span style={{ fontWeight: 600, color: T.accent }}>choose a file</span>
                  <input
                    id="cc-coverage"
                    type="file"
                    accept=".csv,.txt,text/csv,text/plain"
                    onChange={onFile}
                    {...invalid("cc-coverage")}
                    style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0, cursor: "pointer" }}
                  />
                </label>
                {fieldError("cc-coverage")}
                {/* The parse result, and the only feedback a chosen file gets. It is
                    polite rather than assertive because it is usually good news -
                    "2 links found" - and it must not cut across the file picker
                    closing. The case it exists for is the file whose link column
                    holds headlines: that note is the difference between an upload
                    that stored nothing and one that looks identical to a success,
                    and until now it was drawn in red and said out loud to nobody.
                    The colour is not the signal either way; the sentence is. */}
                <p
                  role="status"
                  style={{
                    margin: "6px 0 0",
                    fontSize: "12.5px",
                    color: fileUnread ? T.badFg : T.soft,
                    lineHeight: 1.5,
                  }}
                >
                  {fileNote || "A CSV of the URLs you placed. Any column will do; we find the links."}
                </p>
                {/* What will actually be read, from both fields at once. Said before
                    the submit rather than after the reading starts, because this is
                    the last moment anybody can do anything about it - and a list
                    silently cut to five is the same class of defect as a file whose
                    link column held headlines. */}
                {coverageFound > 0 && (
                  <p role="status" style={{ margin: "8px 0 0", fontSize: "12.5px", color: coverageFound > MAX_COVERAGE_URLS ? T.badFg : T.soft, lineHeight: 1.5 }}>
                    {coverageFound > MAX_COVERAGE_URLS
                      ? `${count(coverageFound, "link")} found. The reading reports on ${MAX_COVERAGE_URLS}, and you pick which on the next step.`
                      : `${count(coverageKept, "link")} ready to check.`}
                  </p>
                )}
                <p style={{ margin: "10px 0 0", fontSize: "12.5px", color: T.soft, lineHeight: 1.5 }}>
                  {`We read each piece and draft the rest for you to check: the brand, what they should be named for, and ${MAX_AGENCY_PROMPTS} prompts. Nothing is asked of the engines until you run it.`}
                </p>
              </div>
            </div>
            {runControls}
          </form>
        </div>
      </div>
    );
  }

  /**
   * Step 2, in the scan's confirm screen layout (ConfirmScreen.tsx, R140):
   * what was read and why it matters on the left, the fields and the run in
   * the card, then the coverage and the prompts as headed sections below - the
   * confirm screen's keyword and prompts sections, on the same grid.
   */
  return (
    <form onSubmit={onSubmit} noValidate style={{ display: "flex", flexDirection: "column", gap: "26px" }}>
      <div className="board-head" style={{ ...GRID12, alignItems: "start" }}>
        <div style={{ gridColumn: "span 7", fontSize: "14.5px", maxWidth: "62ch" }}>
          <div style={MICRO}>Step 2 of 2: check the draft</div>
          <h1 style={{ margin: "10px 0 0", fontSize: "32px", fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1.2, color: T.ink }}>
            This is what we read off the coverage. Correct it before we run.
          </h1>
          <p style={{ margin: "12px 0 0", lineHeight: 1.65, color: T.soft }}>
            The prompts come from what the pieces say the client is for. If that is wrong, every answer after it is
            measuring the wrong thing - so it is worth ten seconds now.
          </p>
          <button
            type="button"
            onClick={() => {
              setStep(1);
              clearError();
              setTurnstileToken(null);
            }}
            style={{ marginTop: "12px", fontFamily: "inherit", fontSize: "13px", fontWeight: 600, color: T.accent, background: "none", border: "none", padding: 0, cursor: "pointer" }}
          >
            Back to the coverage
          </button>
        </div>

        <div style={{ ...CARD, gridColumn: "span 5", padding: "22px" }}>
          <div style={MICRO}>Who the reading is for</div>
          <div style={{ marginTop: "12px", display: "flex", flexDirection: "column", gap: "12px" }}>
            <div>
              <label htmlFor="cc-brand" style={labelStyle}>
                Brand name
              </label>
              {/* Bounded here as well as on the server, for the reason the file
                  input is: the server's limit is the one that counts, and this
                  one exists so a visitor is stopped at the field rather than by
                  a refusal that reads as if they left it blank. */}
              <input
                id="cc-brand"
                style={field}
                maxLength={COVERAGE_LIMITS.brand.max}
                placeholder="Your client"
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
                required
              />
            </div>
            <div>
              <label htmlFor="cc-domain" style={labelStyle}>
                Client domain
              </label>
              <input
                id="cc-domain"
                {...invalid("cc-domain")}
                style={{ ...field, borderColor: errorFor === "cc-domain" ? T.badFg : T.line }}
                maxLength={WAITLIST_LIMITS.domain}
                placeholder="clientdomain.com"
                value={domain}
                onChange={(e) => {
                  setDomain(e.target.value);
                  // The draft's check was for the domain it found; a typed one is
                  // asked about on blur, below.
                  setDomainRefusal(null);
                  askedFor.current = "";
                  if (errorFor === "cc-domain") clearError();
                }}
                onBlur={() => void checkDomain(domain)}
                required
              />
              {fieldError("cc-domain")}
              {!domain.trim() && errorFor !== "cc-domain" && (
                <p style={{ margin: "6px 0 0", fontSize: "12.5px", color: T.badFg, lineHeight: 1.5 }}>
                  We could not find the client&rsquo;s site in the coverage. Add it to run the reading.
                </p>
              )}
              {domainRefusal && (
                <p role="alert" style={{ margin: "6px 0 0", fontSize: "12.5px", color: T.badFg, lineHeight: 1.5 }}>
                  {domainRefusal}
                </p>
              )}
            </div>
            <div>
              <label htmlFor="cc-topic" style={labelStyle}>
                What the client should be referenced for
              </label>
              <input
                id="cc-topic"
                style={field}
                maxLength={COVERAGE_LIMITS.topic.max}
                placeholder="same-day settlement"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                required
              />
              <p style={{ margin: "6px 0 0", fontSize: "12.5px", color: T.soft, lineHeight: 1.5 }}>
                The thing you want the answer to name them for. A capability or a claim, not a headline -
                &ldquo;same-day settlement&rdquo;, not &ldquo;Brand announces exciting news&rdquo;.
              </p>
            </div>
            <div>
              <label htmlFor="cc-segment" style={labelStyle}>
                Who it is for <span style={{ fontWeight: 400, color: T.soft }}>optional</span>
              </label>
              <input
                id="cc-segment"
                style={field}
                maxLength={COVERAGE_LIMITS.segment.max}
                placeholder="independent retailers"
                value={segment}
                onChange={(e) => setSegment(e.target.value)}
              />
              <p style={{ margin: "6px 0 0", fontSize: "12.5px", color: T.soft, lineHeight: 1.5 }}>
                Sharpens the buying question. Without it we ask the broader form, which is a weaker question but still a
                real one.
              </p>
            </div>
            <div>
              <label htmlFor="cc-market" style={labelStyle}>
                Market
              </label>
              <select
                id="cc-market"
                style={field}
                value={market}
                onChange={(e) => setMarket(e.target.value === "US" ? "US" : "UK")}
              >
                <option value="UK">United Kingdom</option>
                <option value="US">United States</option>
              </select>
              {marketLine && (
                <p style={{ margin: "6px 0 0", fontSize: "12.5px", color: T.soft, lineHeight: 1.5 }}>{marketLine}</p>
              )}
            </div>
          </div>
          {runControls}
        </div>
      </div>

      <section>
        <div className="board-head" style={{ ...GRID12, marginBottom: "14px" }}>
          <h2 style={{ ...H2, gridColumn: "span 4" }}>The coverage we report on</h2>
          <p style={{ gridColumn: "span 8", margin: 0, fontSize: "14px", lineHeight: 1.6, color: T.soft }}>
            {`Each ticked piece gets a row in the reading: cited as a page, cited as the publication, or neither. Up to ${MAX_COVERAGE_URLS}.`}
          </p>
        </div>
        <fieldset style={{ ...CARD, margin: 0, padding: 0, overflow: "hidden", minWidth: 0 }}>
          <legend className="sr-only">Coverage we report on</legend>
          {rows.map((r, i) => (
            <label
              key={r.url}
              style={{
                display: "flex",
                gap: "10px",
                alignItems: "flex-start",
                padding: "13px 22px",
                borderTop: i ? `1px solid ${T.hair}` : undefined,
                fontSize: "14px",
                color: T.ink,
                lineHeight: 1.45,
              }}
            >
              <input
                id={`cc-row-${i}`}
                type="checkbox"
                checked={r.ticked}
                disabled={!r.ticked && tickedCount >= MAX_COVERAGE_URLS}
                onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, ticked: e.target.checked } : x)))}
                style={{ marginTop: "3px" }}
              />
              <span>
                {/* A long URL may break anywhere; the words after it break only between words. */}
                <span style={{ wordBreak: "break-all" }}>{r.url}</span>
                {unread.includes(r.url) && <span style={{ color: T.soft }}> - could not be read, still counted</span>}
              </span>
            </label>
          ))}
          {(reportLimit || unread.length > 0) && (
            <div style={{ padding: "13px 22px", borderTop: `1px solid ${T.hair}`, fontSize: "12.5px", color: T.soft, lineHeight: 1.5 }}>
              {reportLimit && <p style={{ margin: 0 }}>{`${reportLimit}. ${count(rows.length, "link")} found; tick the ${MAX_COVERAGE_URLS} to check.`}</p>}
              {unread.length > 0 && (
                <p style={{ margin: reportLimit ? "6px 0 0" : 0 }}>
                  {`We could not read ${count(unread.length, "page")} (a paywall or a block, usually). It still counts as coverage; it just added nothing to the draft.`}
                </p>
              )}
            </div>
          )}
        </fieldset>
      </section>

      <section>
        <div className="board-head" style={{ ...GRID12, marginBottom: "14px" }}>
          <h2 style={{ ...H2, gridColumn: "span 4" }}>
            <label htmlFor="cc-prompts">The prompts we ask</label>
          </h2>
          <p style={{ gridColumn: "span 8", margin: 0, fontSize: "14px", lineHeight: 1.6, color: T.soft }}>
            {`Drafted from the coverage, one per line - edit freely. Clear them and we ask our own ${MAX_AGENCY_PROMPTS}, the same ones every time, so a later reading can be compared against this one.`}
          </p>
        </div>
        <div style={{ ...CARD, padding: "22px" }}>
          <textarea
            id="cc-prompts"
            style={{ ...field, minHeight: "150px", resize: "vertical" }}
            maxLength={COVERAGE_LIMITS.prompts.max}
            placeholder={"who offers same-day settlement for independent retailers\nbest payment providers for small shops"}
            value={prompts}
            onChange={(e) => setPrompts(e.target.value)}
          />
          {promptLines.length > 0 && (
            <p role="status" style={{ margin: "8px 0 0", fontSize: "12.5px", color: promptLines.length > MAX_AGENCY_PROMPTS ? T.badFg : T.soft, lineHeight: 1.5 }}>
              {promptLines.length > MAX_AGENCY_PROMPTS
                ? `${count(promptLines.length, "prompt")} written, and we ask the first ${MAX_AGENCY_PROMPTS}.`
                : `${count(promptsKept, "prompt")}, asked as you wrote them.`}
            </p>
          )}
        </div>
      </section>
    </form>
  );
}
