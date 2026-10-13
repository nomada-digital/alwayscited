import type { ReactNode } from "react";

import Link from "@/components/app/AppLink";
import TierName from "@/components/TierName";
import { T } from "@/config/tokens";
import { exampleLabel } from "@/lib/diy/core/evidence";
import type { Cell } from "@/lib/diy/pages/diagnostics";
import { EXAMPLE_LEAD } from "@/lib/diy/pages/example";
import { fitChip, fitEvidence, fitWords } from "@/lib/diy/pages/fit";
import { pageAction, pagePath } from "@/lib/diy/pages/paths";
import type { ExampleBody } from "@/lib/diy/pages/types";
import type { FitTab } from "@/lib/diy/pages/view";
import { advice } from "@/lib/diy/pages/words";
import { formatDay } from "@/lib/tracking/figures";
import { appPath } from "@/lib/app-host";

import CopyBlock from "./CopyBlock";
import { Advice, BUTTON, DARK, H2, H3, Notice, OFF, SECTION, SMALL, StateChip } from "./parts";

/**
 * The Fit and examples tab (13 Oct 2026, DIY P8; spec 10 sections 4.9, 6.4
 * and 6.5), per cluster the page serves: the fit verdict with its evidence
 * and its denominator; the diagnostics, the page against the top 3 (when
 * their structure has been read); what the engines say, one stored answer
 * sentence naming a competitor, with its link to the answer; U6 where it
 * fires; and the drafted example - an example to edit, not finished copy -
 * with Now and Example side by side, each element to copy, and Add to
 * Actions. Pending, failed and used-up each say so in their own words.
 */

export type ExampleState =
  | { kind: "none" }
  | { kind: "pending" }
  | { kind: "failed" }
  | { kind: "ready"; day: string; example: ExampleBody; now: { title: string | null; h1: string | null; opening: string | null } | null };

export type FitView = FitTab & {
  sentence: { text: string; engine: string; href: string | null } | null;
  example: ExampleState;
  upgrade: ReactNode;
  /** Opportunities' lists count for this cluster, or null while it cannot be read. */
  count: number | null;
};

const mark = (c: Cell) => (c === null ? "Not read" : c === true ? "Yes" : c === false ? "No" : String(c));

const ENGINE: Record<string, string> = { google_aio: "Google AI Overviews", chatgpt: "ChatGPT", gemini: "Gemini", perplexity: "Perplexity", claude: "Claude" };

export default function FitPanel({
  slug,
  pageId,
  fits,
  enabled,
  canWrite,
  reason,
  examplesOut,
  cited,
  agency,
}: {
  slug: string;
  pageId: string;
  fits: FitView[];
  enabled: boolean;
  canWrite: boolean;
  reason: string;
  /** "You've used this month's 10 examples. They reset on 1 Nov.", or null. */
  examplesOut: string | null;
  /** On the alwayscited plan: schema and on-page work is in the plan, so the example says to ask the account lead. */
  cited: boolean;
  agency: boolean;
}) {
  if (!fits.length) {
    return (
      <section aria-label="Fit" style={SECTION}>
        <p style={{ margin: 0, fontSize: "14px", lineHeight: 1.5, color: T.ink }}>This page serves none of your clusters yet: none of their keywords ranks with it. Its fit is read for each cluster it ranks for.</p>
      </section>
    );
  }
  const off = !canWrite;
  return (
    <>
      {fits.map((f) => {
        const kw = f.keyword?.keyword ?? f.cluster.name;
        const words = fitWords(f.verdict, kw, f.count);
        const chip = fitChip(f.verdict);
        const evidence = fitEvidence(f.verdict, kw);
        const last = f.serp?.readings[f.serp.readings.length - 1];
        const action = pageAction(slug, pageId, "fit", f.cluster.id, { of: f.cluster.id });
        return (
          <section key={f.cluster.id} id={`fit-${f.cluster.id}`} aria-labelledby={`fit-h-${f.cluster.id}`} style={SECTION}>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 12px" }}>
              <h2 id={`fit-h-${f.cluster.id}`} style={H2}>
                {`'${kw}'`}
              </h2>
              <StateChip label={chip.label} tone={chip.tone} />
            </div>
            <p style={SMALL}>
              <Link href={appPath(`/${encodeURIComponent(slug)}/clusters/${encodeURIComponent(f.cluster.id)}`)} style={{ color: T.accent, fontWeight: 600, textDecoration: "none" }}>
                {f.cluster.name}
              </Link>
              {last ? ` · ${last.position === null ? "not in the top 20" : `#${last.position}`} on ${formatDay(last.day)}` : " · not read yet"}
            </p>
            {words ? <Advice said={advice(words.id, words.vars)} id={`fit-adv-${f.cluster.id}`} /> : <p style={{ margin: 0, fontSize: "14px", color: T.ink }}>This keyword hasn't been read yet, so its fit can't be read.</p>}
            {evidence ? <p style={SMALL}>{evidence}</p> : null}

            {f.diagnostics && f.top.length ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <h3 style={H3}>You against the top 3</h3>
                <Advice said={advice("pages.diag.table", { keyword: kw })} id={`diag-${f.cluster.id}`} />
                <div className="yp-scroll" role="region" aria-label={`You against the top 3 for '${kw}'`} tabIndex={0}>
                  <table className="yp-diag">
                    <thead>
                      <tr style={{ color: T.soft, borderBottom: `1px solid ${T.line}` }}>
                        <th scope="col">Check</th>
                        <th scope="col">You</th>
                        {f.top.map((t) => (
                          <th key={t.rank} scope="col" title={t.url}>{`#${t.rank} ${t.urlKey.split("/")[0]}`}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {f.diagnostics.map((r) => (
                        <tr key={r.key} style={{ borderBottom: `1px solid ${T.hair}` }}>
                          <th scope="row" style={{ fontWeight: 500, color: T.ink }}>
                            {r.label}
                            {r.flag ? <span style={{ display: "block", fontSize: "12px", color: T.warnFg, fontWeight: 600 }}>Worth a look</span> : null}
                          </th>
                          <td style={{ fontWeight: 600, color: T.ink }}>{mark(r.you)}</td>
                          {r.top.map((c, i) => (
                            <td key={i} style={{ color: c === null ? T.soft : T.ink }}>
                              {mark(c)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p style={SMALL}>A price and a comparison table are read for your page only: the top 3 are read for their structure, never their text.</p>
              </div>
            ) : enabled ? (
              <p style={SMALL}>The top 3's structure is read once a month; it hasn't been read for this keyword yet.</p>
            ) : null}

            {f.sentence ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <h3 style={H3}>What the engines say</h3>
                <blockquote style={{ margin: 0, padding: "10px 14px", borderLeft: `3px solid ${T.washLine}`, background: T.chip, borderRadius: "8px", fontSize: "14px", lineHeight: 1.5, color: T.ink }} className="yp-break">
                  {f.sentence.text}
                </blockquote>
                <Advice
                  said={advice("pages.diag.engines")}
                  id={`eng-${f.cluster.id}`}
                  after={
                    f.sentence.href ? (
                      <Link href={f.sentence.href} style={{ color: T.accent, fontWeight: 600, textDecoration: "none", fontSize: "13px", minHeight: "24px", display: "inline-flex", alignItems: "center" }}>
                        {`Open the ${ENGINE[f.sentence.engine] ?? f.sentence.engine} answer`}
                      </Link>
                    ) : null
                  }
                />
              </div>
            ) : null}

            {f.upgrade}

            {enabled ? (
              <div id={`example-${f.cluster.id}`} style={{ display: "flex", flexDirection: "column", gap: "10px", paddingTop: "10px", borderTop: `1px solid ${T.line}` }}>
                <h3 style={H3}>An example to edit</h3>
                {f.example.kind === "ready" ? <Ready slug={slug} pageId={pageId} clusterId={f.cluster.id} ex={f.example} off={off} action={pageAction(slug, pageId, "fit", f.cluster.id, { item: `rework:${f.cluster.id}` })} /> : null}
                {f.example.kind === "pending" ? (
                  <p role="status" style={{ margin: 0, fontSize: "14px", color: T.ink }}>
                    {"Writing your example. It's usually ready in a minute; refresh to see it. "}
                    <Link href={pagePath(slug, pageId, { tab: "fit", cluster: f.cluster.id }, `#example-${f.cluster.id}`)} style={{ color: T.accent, fontWeight: 600, textDecoration: "none" }}>
                      Refresh
                    </Link>
                  </p>
                ) : null}
                {f.example.kind === "failed" ? <p style={{ margin: 0, fontSize: "14px", color: T.ink }}>We couldn't write a usable example for this page today. It didn't use an example from your allowance.</p> : null}
                {cited ? (
                  <Notice>
                    {agency ? (
                      "Schema and on-page work is part of your plan. Ask your account contact."
                    ) : (
                      <>
                        {"Schema and on-page work is in "}
                        <span style={{ fontWeight: 700, whiteSpace: "nowrap" }}>
                          {"the "}
                          <TierName tier="cited" />
                          {" plan"}
                        </span>
                        {". Ask your account lead."}
                      </>
                    )}
                  </Notice>
                ) : f.example.kind === "pending" ? null : examplesOut ? (
                  <p style={{ margin: 0, fontSize: "14px", color: T.ink }}>{examplesOut}</p>
                ) : (
                  <form method="post" action={action} style={{ margin: 0 }}>
                    <button type="submit" name="do" value="example" disabled={off} aria-describedby={off ? "detail-reason" : `ex-note-${f.cluster.id}`} style={{ ...DARK, ...(off ? OFF : {}) }}>
                      {f.example.kind === "ready" ? "Write another example" : "Show me an example"}
                    </button>
                    <span id={`ex-note-${f.cluster.id}`} style={{ ...SMALL, display: "block", marginTop: "6px" }}>
                      Uses one of this month's drafted examples. Written from your page, for you to edit; nothing is published for you.
                    </span>
                  </form>
                )}
              </div>
            ) : null}
          </section>
        );
      })}
    </>
  );
}

function Ready({ ex, off, action, pageId, clusterId }: { slug: string; pageId: string; clusterId: string; ex: Extract<ExampleState, { kind: "ready" }>; off: boolean; action: string }) {
  const e = ex.example;
  const rows: { label: string; now: string; example: string; id: string }[] = [
    { label: "Title", now: ex.now?.title ?? "Not read", example: e.title, id: "title" },
    { label: "H1", now: ex.now?.h1 ?? "Not read", example: e.h1, id: "h1" },
    { label: "Opening", now: ex.now?.opening ?? "Not kept", example: e.opening, id: "opening" },
    { label: "A missing section", now: "Not on your page", example: `${e.missing_section.heading}\n${e.missing_section.bullets.map((b) => `- ${b}`).join("\n")}`, id: "section" },
    { label: "An internal link sentence", now: "None yet", example: `${e.link_sentence.sentence} (on ${e.link_sentence.from_url}, linking "${e.link_sentence.anchor}" to this page)`, id: "link" },
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      <p style={{ margin: 0, fontSize: "14px", lineHeight: 1.5, color: T.ink, fontWeight: 600 }}>{`${EXAMPLE_LEAD} ${exampleLabel(ex.day)}`}</p>
      {rows.map((r) => (
        <div key={r.id} style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <span style={{ fontSize: "13px", fontWeight: 700, color: T.ink }}>{r.label}</span>
          <div className="yp-side">
            <div style={{ display: "flex", flexDirection: "column", gap: "4px", minWidth: 0 }}>
              <span style={SMALL}>Now</span>
              <p style={{ margin: 0, padding: "10px 12px", borderRadius: "10px", border: `1px solid ${T.line}`, fontSize: "14px", lineHeight: 1.5, color: T.ink, whiteSpace: "pre-line", overflowWrap: "anywhere" }}>{r.now}</p>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "4px", minWidth: 0 }}>
              <span style={SMALL}>Example</span>
              <CopyBlock text={r.example} label={`Example ${r.label.toLowerCase()}`} usage="example_copy" id={`ex-${clusterId}-${r.id}`} code={false} />
            </div>
          </div>
        </div>
      ))}
      {e.placeholders.length ? <p style={SMALL}>{`Fill in the ${e.placeholders.length} [ADD] ${e.placeholders.length === 1 ? "field" : "fields"} with your own facts before you use it.`}</p> : null}
      <form method="post" action={action} style={{ margin: 0 }}>
        <button type="submit" name="do" value="act" disabled={off} aria-describedby={off ? "detail-reason" : undefined} style={{ ...BUTTON, ...(off ? OFF : {}) }}>
          Add to Actions
        </button>
      </form>
    </div>
  );
}
