import Link from "@/components/app/AppLink";
import { BUTTON, CHIP, DARK, FIELD, H2, LINK, OFF, SECTION, SMALL } from "@/components/app/plan/styles";
import { T } from "@/config/tokens";
import type { AdviceLine } from "@/lib/diy/core/evidence";
import type { WhatItIs } from "@/lib/diy/opportunities/brief";
import { oppAction, oppAskAction, oppPath, promptOfferAction } from "@/lib/diy/opportunities/paths";
import type { WhyFact } from "@/lib/diy/opportunities/payload";
import type { Playbook as Book } from "@/lib/diy/opportunities/playbooks.advice";
import type { OppDo } from "@/lib/diy/opportunities/status";
import { DISMISS_CHIPS, DISMISS_LABEL, OPP_LIMITS, type OppStatus } from "@/lib/diy/opportunities/types";
import type { PromptState } from "@/lib/diy/opportunities/detail";
import { formatDay } from "@/lib/tracking/figures";

import Advice, { Chip, chipFor } from "./Advice";
import CopyButton from "./CopyButton";
import { type CapState, SECTION_ERROR } from "./Opportunities";
import OppStyle from "./OppStyle";
import Playbook from "./Playbook";

/**
 * One opportunity (13 Oct 2026, DIY P7; spec 10 section 4.7): why this page,
 * what it is, what to point it at, the method, the pitch outline with its
 * blanks, who to write to, its status and the prompt step, its history, and
 * on placed tiers "Suggest this to your account lead". The brief is
 * deterministic - no model writes a word of it - and every form is a plain
 * POST answered by a 303 and a toast.
 */

export type PromptView = PromptState;

export type DetailProps = {
  slug: string;
  id: string;
  title: string;
  url: string;
  domain: string;
  types: string;
  route: string;
  status: OppStatus;
  statusLine: string;
  cluster: { id: string; name: string } | null;
  clusterHref: string | null;
  toast: { tone: "good" | "bad"; text: string } | null;
  readOnly: string | null;
  canWrite: boolean;
  cap: CapState;
  dark: boolean;
  jobFailed: boolean;
  why: WhyFact[] | null;
  whyChip: AdviceLine;
  whatItIs: WhatItIs | null;
  target: { label: string; url: string | null };
  targetRule: AdviceLine;
  /** The anchor: our practice line, then Google's dated one (playbooks.advice.ts LINE_ANCHOR). */
  anchor: readonly AdviceLine[];
  playbook: Book | null;
  playbookExtra: string | null;
  pitch: string | null;
  who: AdviceLine;
  moves: OppDo[];
  note: string | null;
  verification: string | null;
  canVerify: boolean;
  prompt: PromptView | null;
  /** The pursue route's 303 when the cluster is full: the picker is the page's point now. */
  swapOpen: boolean;
  history: { at: string; text: string }[];
  /** First cited by engine since it was pursued (payload.ts firstCitedLines); empty for a page never pursued. */
  firstCited: string[];
  ask: { label: string } | null;
  upgrade: React.ReactNode;
};

const MOVE_LABEL: Partial<Record<OppDo, string>> = { pursue: "Pursue", pitched: "Mark pitched", won: "Mark won", decline: "Decline", reopen: "Reopen" };

export default function OppDetail(p: DetailProps) {
  const action = oppAction(p.slug, { id: p.id, at: "detail" });
  const offer = promptOfferAction(p.slug, p.id);
  const off = p.canWrite ? {} : { disabled: true, "aria-describedby": "opp-ro" };
  const offStyle = p.canWrite ? {} : OFF;
  const whyChip = chipFor(p.whyChip);
  const pursueBlocked = p.cap.atCap && p.moves.includes("pursue");

  return (
    <div className="app-col" style={{ display: "flex", flexDirection: "column", gap: "20px", minWidth: 0 }}>
      <OppStyle />
      <Link href={oppPath(p.slug)} style={{ ...LINK, fontSize: "14px", alignSelf: "flex-start", minHeight: "24px" }}>
        All opportunities
      </Link>
      <header style={{ display: "flex", flexDirection: "column", gap: "8px", minWidth: 0 }}>
        <h1 className="opp-url" style={{ margin: 0, fontSize: "26px", fontWeight: 700, letterSpacing: "-0.025em", color: T.ink, lineHeight: 1.25 }}>
          {p.title}
        </h1>
        {/^https?:\/\//i.test(p.url) ? (
          <a href={p.url} rel="noopener noreferrer" target="_blank" className="opp-url" style={{ fontSize: "14px", color: T.soft, textDecorationColor: T.faint, alignSelf: "flex-start", maxWidth: "100%" }}>
            {p.domain}
            <span className="sr-only"> (opens the page in a new tab)</span>
          </a>
        ) : (
          <span className="opp-url" style={{ fontSize: "14px", color: T.soft }}>
            {p.domain}
          </span>
        )}
        <span style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
          <span style={{ ...CHIP, background: T.wash, color: T.accentHover, border: `1px solid ${T.washLine}` }}>{p.route}</span>
          <span style={{ ...CHIP, background: T.chip, color: T.ink, whiteSpace: "normal" }}>{p.types}</span>
          <span data-opp-status={p.status} style={{ ...CHIP, background: p.status === "won" ? T.goodBg : T.chip, color: p.status === "won" ? T.goodFg : T.ink }}>
            {p.statusLine}
          </span>
          {p.cluster ? (
            p.clusterHref ? (
              <Link href={p.clusterHref} style={{ ...CHIP, background: T.chip, color: T.ink, textDecoration: "none", whiteSpace: "normal" }}>
                {p.cluster.name}
              </Link>
            ) : (
              <span style={{ ...CHIP, background: T.chip, color: T.ink, whiteSpace: "normal" }}>{p.cluster.name}</span>
            )
          ) : null}
        </span>
      </header>
      {p.toast ? (
        <p role="status" data-tone={p.toast.tone} style={{ margin: 0, padding: "12px 16px", borderRadius: "14px", background: T.ink, color: T.surface, fontSize: "14px", lineHeight: 1.4, alignSelf: "flex-start", maxWidth: "100%", boxSizing: "border-box", overflowWrap: "anywhere" }}>
          {p.toast.text}
        </p>
      ) : null}
      {p.readOnly ? (
        <p id="opp-ro" style={{ margin: 0, padding: "12px 16px", borderRadius: "12px", background: T.wash, border: `1px solid ${T.washLine}`, fontSize: "14px", color: T.ink }}>
          {p.readOnly}
        </p>
      ) : null}
      {p.jobFailed ? <p style={{ ...SMALL, color: T.ink }}>Some checks didn&apos;t finish last night; they retry tonight.</p> : null}

      <div className="opp-detail">
        <div style={{ display: "flex", flexDirection: "column", gap: "20px", minWidth: 0 }}>
          <section aria-labelledby="why-h" style={SECTION}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "baseline", justifyContent: "space-between" }}>
              <h2 id="why-h" style={H2}>
                Why this page
              </h2>
              {whyChip ? <Chip chip={whyChip} id="why-chip" /> : null}
            </div>
            {p.why === null ? (
              <p role="status" style={{ margin: 0, fontSize: "14px", color: T.ink }}>
                {SECTION_ERROR}
              </p>
            ) : (
              <ul data-opp-why="" style={{ margin: 0, paddingLeft: "18px", display: "flex", flexDirection: "column", gap: "6px", fontSize: "14px", lineHeight: 1.5, color: T.ink }}>
                {p.why.map((w, i) => (
                  <li key={i}>
                    {w.href ? (
                      <Link href={w.href} style={{ color: T.ink, textDecorationColor: T.faint, textUnderlineOffset: "3px" }}>
                        {w.text}
                      </Link>
                    ) : (
                      w.text
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="what-h" style={SECTION}>
            <h2 id="what-h" style={H2}>
              What it is
            </h2>
            <WhatIt w={p.whatItIs} dark={p.dark} />
          </section>

          <section aria-labelledby="point-h" style={SECTION}>
            <h2 id="point-h" style={H2}>
              What to point it at
            </h2>
            <p style={{ margin: 0, fontSize: "14px", lineHeight: 1.5, color: T.ink }}>
              <strong style={{ fontWeight: 650 }}>{p.target.label}: </strong>
              {p.target.url ? (
                <span className="opp-url" data-opp-target="">
                  {p.target.url}
                </span>
              ) : (
                "Pick a page of yours that proves the point."
              )}
            </p>
            <Advice line={p.targetRule} />
            {p.anchor.map((line) => (
              <Advice key={line.id} line={line} />
            ))}
          </section>

          <section aria-labelledby="method-h" style={SECTION}>
            <h2 id="method-h" style={H2}>
              The method
            </h2>
            {p.playbook ? <Playbook book={p.playbook} heading={false} extra={p.playbookExtra ? <p style={{ ...SMALL, color: T.ink }}>{p.playbookExtra}</p> : null} /> : <p style={{ margin: 0, fontSize: "14px", color: T.ink }}>This route&apos;s method is on its own page.</p>}
          </section>

          {p.pitch ? (
            <section aria-labelledby="pitch-h" style={SECTION}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center", justifyContent: "space-between" }}>
                <h2 id="pitch-h" style={H2}>
                  Pitch outline
                </h2>
                <CopyButton text={p.pitch} label="Copy the outline" usage="brief_copy" />
              </div>
              <p style={SMALL}>One outline with blanks, never a sequence. The words in square brackets are yours to fill; the rest is from what we read on the page.</p>
              <pre data-opp-pitch="" className="opp-pre" style={{ padding: "14px 16px", borderRadius: "12px", background: T.bg, border: `1px solid ${T.line}`, fontSize: "14px", lineHeight: 1.6, color: T.ink }}>
                {p.pitch}
              </pre>
            </section>
          ) : null}

          <section aria-labelledby="who-h" style={SECTION}>
            <h2 id="who-h" style={H2}>
              Who to write to
            </h2>
            <Advice line={p.who} />
          </section>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "20px", minWidth: 0 }}>
          <section aria-labelledby="status-h" style={SECTION}>
            <h2 id="status-h" style={H2}>
              Status
            </h2>
            <p style={{ margin: 0, fontSize: "14px", color: T.ink }}>{p.statusLine}</p>
            {p.moves.length ? (
              <form method="post" action={action} style={{ margin: 0, display: "flex", flexWrap: "wrap", gap: "8px" }}>
                {p.moves
                  .filter((m) => m !== "dismiss" && m !== "note")
                  .map((m) => {
                    const blocked = m === "pursue" && pursueBlocked;
                    return (
                      <button key={m} type="submit" name="do" value={m} {...(blocked ? { disabled: true, "aria-describedby": "opp-cap" } : off)} style={{ ...(m === "pursue" || m === "won" ? DARK : BUTTON), minHeight: "44px", ...(blocked ? OFF : offStyle) }}>
                        {MOVE_LABEL[m]}
                      </button>
                    );
                  })}
              </form>
            ) : null}
            {pursueBlocked ? (
              <p id="opp-cap" style={SMALL}>
                {p.cap.line}
              </p>
            ) : null}
            {p.moves.includes("dismiss") ? (
              <details className="opp-reasons">
                <summary style={{ cursor: "pointer", fontSize: "14px", fontWeight: 600, color: T.accent, minHeight: "44px", display: "flex", alignItems: "center" }}>Not for us</summary>
                <form method="post" action={action} style={{ margin: 0, display: "flex", flexWrap: "wrap", gap: "6px" }}>
                  {DISMISS_CHIPS.map((d) => (
                    <button key={d} type="submit" name="do" value={`dismiss:${d}`} {...off} style={{ ...BUTTON, minHeight: "44px", ...offStyle }}>
                      {DISMISS_LABEL[d]}
                    </button>
                  ))}
                </form>
              </details>
            ) : null}
            {p.verification || p.canVerify ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "8px", borderTop: `1px solid ${T.hair}`, paddingTop: "12px" }}>
                <h3 style={{ margin: 0, fontSize: "14px", fontWeight: 700, color: T.ink }}>Verification</h3>
                <p data-opp-verified="" style={{ margin: 0, fontSize: "14px", lineHeight: 1.5, color: T.ink }}>
                  {p.verification ?? "Not checked yet."}
                </p>
                {p.canVerify ? (
                  <form method="post" action={action} style={{ margin: 0 }}>
                    <button type="submit" name="do" value="verify" {...off} style={{ ...BUTTON, minHeight: "44px", ...offStyle }}>
                      Verify now
                    </button>
                  </form>
                ) : null}
              </div>
            ) : null}
            <form method="post" action={action} style={{ margin: 0, display: "flex", flexDirection: "column", gap: "6px", borderTop: `1px solid ${T.hair}`, paddingTop: "12px" }}>
              <label htmlFor="opp-note" style={{ fontSize: "12px", fontWeight: 600, color: T.soft }}>
                {`Note, up to ${OPP_LIMITS.note} characters`}
              </label>
              <textarea id="opp-note" name="note" rows={3} maxLength={OPP_LIMITS.note} defaultValue={p.note ?? ""} {...off} style={{ ...FIELD, width: "100%", minHeight: "72px", padding: "8px 10px", fontSize: "16px", resize: "vertical", ...offStyle }} />
              <button type="submit" name="do" value="note" {...off} style={{ ...BUTTON, alignSelf: "flex-start", minHeight: "44px", ...offStyle }}>
                Save note
              </button>
            </form>
          </section>

          {p.prompt ? (
            <section id="prompt" aria-labelledby="prompt-h" style={{ ...SECTION, ...(p.swapOpen && p.prompt.kind === "full" ? { border: `1px solid ${T.washLine}` } : {}) }}>
              <h2 id="prompt-h" style={H2}>
                Prompt
              </h2>
              <PromptBlock v={p.prompt} offer={offer} off={off} offStyle={offStyle} />
            </section>
          ) : null}

          {p.ask ? (
            <section aria-label="Your account lead" style={SECTION}>
              <form method="post" action={oppAskAction(p.slug, p.id)} style={{ margin: 0 }}>
                <button type="submit" style={{ ...BUTTON, minHeight: "44px" }}>
                  {p.ask.label}
                </button>
              </form>
              <p style={SMALL}>They get the page&apos;s address and what we counted, and reply to you.</p>
            </section>
          ) : null}

          {p.upgrade ? <section aria-label="Upgrade">{p.upgrade}</section> : null}

          <section aria-labelledby="hist-h" style={SECTION}>
            <h2 id="hist-h" style={H2}>
              History
            </h2>
            {p.history.length ? (
              <ol data-opp-history="" style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: "6px", fontSize: "14px", lineHeight: 1.5, color: T.ink }}>
                {p.history.map((h, i) => (
                  <li key={i}>
                    <span style={{ color: T.soft }}>{`${formatDay(h.at.slice(0, 10))}: `}</span>
                    {h.text}
                  </li>
                ))}
              </ol>
            ) : (
              <p style={{ margin: 0, fontSize: "14px", color: T.ink }}>No changes yet.</p>
            )}
            {p.firstCited.length ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "6px", borderTop: `1px solid ${T.hair}`, paddingTop: "12px" }}>
                <h3 style={{ margin: 0, fontSize: "14px", fontWeight: 700, color: T.ink }}>In the answers since you pursued it</h3>
                <ul data-opp-first-cited="" style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: "4px", fontSize: "14px", lineHeight: 1.5, color: T.ink }}>
                  {p.firstCited.map((t, i) => (
                    <li key={i}>{t}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>
        </div>
      </div>
    </div>
  );
}

function WhatIt({ w, dark }: { w: WhatItIs | null; dark: boolean }) {
  if (w === null)
    return (
      <p role="status" style={{ margin: 0, fontSize: "14px", color: T.ink }}>
        {SECTION_ERROR}
      </p>
    );
  if (w.kind === "unread" || dark) return <p style={{ margin: 0, fontSize: "14px", color: T.ink }}>{dark ? "Not read yet." : "Not read yet. It is read overnight."}</p>;
  if (w.kind === "unreadable")
    return (
      <p data-opp-unreadable="" style={{ margin: 0, fontSize: "14px", color: T.ink }}>
        {w.text}
      </p>
    );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px", fontSize: "14px", lineHeight: 1.5, color: T.ink }}>
      <p style={{ margin: 0 }}>
        <strong style={{ fontWeight: 650 }}>Page type: </strong>
        {w.pageType}
      </p>
      {w.criteria.length ? (
        <div>
          <p style={{ margin: 0, fontWeight: 650 }}>The criteria it lists on (its headings):</p>
          <ul data-opp-criteria="" style={{ margin: "4px 0 0", paddingLeft: "18px" }}>
            {w.criteria.map((c, i) => (
              <li key={i} className="opp-url">
                {c}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <p style={{ margin: 0 }}>
        <strong style={{ fontWeight: 650 }}>Last updated: </strong>
        {w.updated ? formatDay(w.updated, true) : "no date found on the page"}
      </p>
      <p style={SMALL}>{`Read ${formatDay(w.readOn, true)}${w.via === "content_parsing" ? " through a page-reading service, which returns headings and links but not the body" : ""}.`}</p>
    </div>
  );
}

function PromptBlock({ v, offer, off, offStyle }: { v: PromptView; offer: string; off: { disabled?: boolean; "aria-describedby"?: string }; offStyle: React.CSSProperties }) {
  const p = { margin: 0, fontSize: "14px", lineHeight: 1.5, color: T.ink } as const;
  switch (v.kind) {
    case "preview":
      return <p style={p}>{`Pursuing it adds the prompt '${v.text}' to '${v.cluster}' when the cluster has a free slot. Its answers are then read every day, and the page is checked weekly.`}</p>;
    case "added":
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <p data-opp-prompt="added" style={p}>{`Added '${v.text}' to '${v.cluster}' (slot ${v.slot} of ${v.of}). It is first asked tomorrow.`}</p>
          {v.undo ? (
            <form method="post" action={offer} style={{ margin: 0 }}>
              <button type="submit" name="do" value="undo" {...off} style={{ ...BUTTON, minHeight: "44px", ...offStyle }}>
                Undo
              </button>
            </form>
          ) : null}
        </div>
      );
    case "duplicate":
      return <p data-opp-prompt="duplicate" style={p}>{`Already measured by '${v.text}'.`}</p>;
    case "none":
      return <p data-opp-prompt="none" style={p}>{`No prompt from this page: ${v.reason}. It is watched for citations.`}</p>;
    case "room":
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <p style={p}>{`'${v.cluster}' has a free slot for '${v.text}'.`}</p>
          <form method="post" action={offer} style={{ margin: 0 }}>
            <button type="submit" name="do" value="add" {...off} style={{ ...DARK, minHeight: "44px", ...offStyle }}>
              Add the prompt
            </button>
          </form>
        </div>
      );
    case "watching":
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <p data-opp-prompt="watching" style={p}>Watching the page for citations, with no prompt added.</p>
          {v.room && v.text ? (
            <form method="post" action={offer} style={{ margin: 0 }}>
              <button type="submit" name="do" value="add" {...off} style={{ ...BUTTON, minHeight: "44px", ...offStyle }}>
                {`Add '${v.text}' to '${v.cluster}'`}
              </button>
            </form>
          ) : null}
        </div>
      );
    case "full":
      return (
        <div data-opp-swap="" style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <p style={p}>{`'${v.cluster}' has no free prompt slot. Swap one for '${v.text}', or just watch the page.`}</p>
          <form method="post" action={offer} style={{ margin: 0, display: "flex", flexDirection: "column", gap: "6px" }}>
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "6px" }}>
              {v.candidates.map((c) => (
                <li key={c.id} style={{ display: "flex", flexWrap: "wrap", gap: "6px 10px", alignItems: "center", justifyContent: "space-between", padding: "8px 0", borderTop: `1px solid ${T.hair}` }}>
                  <span style={{ display: "flex", flexDirection: "column", gap: "2px", minWidth: 0, flex: "1 1 200px", fontSize: "14px", color: T.ink }}>
                    <span className="opp-url">{c.text}</span>
                    <span style={{ fontSize: "12px", color: T.soft }}>
                      {c.line}
                      {c.suggested ? " · suggested" : ""}
                    </span>
                  </span>
                  <button type="submit" name="do" value={`swap:${c.id}`} {...off} style={{ ...(c.suggested ? DARK : BUTTON), minHeight: "44px", ...offStyle }}>
                    Swap<span className="sr-only">{` '${c.text}'`}</span>
                  </button>
                </li>
              ))}
            </ul>
            <button type="submit" name="do" value="watch" {...off} style={{ ...BUTTON, alignSelf: "flex-start", minHeight: "44px", ...offStyle }}>
              Just watch the page
            </button>
          </form>
        </div>
      );
  }
}
