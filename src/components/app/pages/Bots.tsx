import { T } from "@/config/tokens";
import { formatDay } from "@/lib/tracking/figures";
import { CHOICE_CRAWLER, purposeLine, raisesBlocking, robotsEdit, robotsState } from "@/lib/diy/pages/robots";
import type { BotCheck, KeyPage } from "@/lib/diy/pages/types";
import { advice } from "@/lib/diy/pages/words";

import CopyBlock from "./CopyBlock";
import { Advice, H2, SECTION, SMALL, StateChip } from "./parts";

/**
 * The crawlers view (13 Oct 2026, DIY P8; spec 10 sections 4.9 and 6.4): one
 * row per crawler with its state over the key pages, whether its rule names
 * it or comes from `*`, and the line that decides it; what it is for only
 * where a verified, dated source says so (Googlebot, S41, at launch);
 * Google-Extended as a choice, never an error; each key page's status,
 * noindex and canonical; llms.txt as optional, never an issue; and the
 * robots.txt lines to change for a crawler whose block raises a Blocking
 * item.
 */

const STATE: Record<"allowed" | "partial" | "blocked", { label: string; tone: "good" | "warn" | "bad" }> = {
  allowed: { label: "Allowed", tone: "good" },
  partial: { label: "Some key pages blocked", tone: "warn" },
  blocked: { label: "Blocked", tone: "bad" },
};

export default function Bots({ bot, pages }: { bot: BotCheck | null; pages: readonly KeyPage[] }) {
  if (!bot) {
    return (
      <section aria-label="Crawlers" style={SECTION}>
        <p style={{ margin: 0, fontSize: "14px", lineHeight: 1.5, color: T.ink }}>We read your robots.txt with your key pages, overnight. Nothing has been read yet.</p>
      </section>
    );
  }
  const state = robotsState({ status: bot.robotsStatus, txt: bot.robotsStatus !== null && bot.robotsStatus < 300 ? "" : null });
  const robotsLine =
    state.kind === "read" ? `robots.txt read ${formatDay(bot.checkedAt.slice(0, 10))}.` : state.kind === "none" ? `No robots.txt (HTTP ${state.status}), read ${formatDay(bot.checkedAt.slice(0, 10))}.` : `We couldn't read your robots.txt on ${formatDay(bot.checkedAt.slice(0, 10))}${state.status ? ` (HTTP ${state.status})` : ""}.`;
  const edits = bot.crawlers.filter((c) => c.state !== "allowed" && raisesBlocking(c.name)).map((c) => ({ c, text: robotsEdit(c) })).filter((e): e is { c: (typeof bot.crawlers)[number]; text: string } => e.text !== null);
  const byKey = new Map(pages.map((p) => [p.urlKey, p] as const));
  return (
    <>
      <section aria-labelledby="bots-title" style={{ ...SECTION, padding: 0, gap: 0 }}>
        <div style={{ padding: "18px 20px 10px", display: "flex", flexDirection: "column", gap: "6px" }}>
          <h2 id="bots-title" style={H2}>
            Crawlers
          </h2>
          <p style={SMALL}>{robotsLine}</p>
        </div>
        {state.kind === "unreadable" ? null : (
          <table className="yp-table">
            <thead>
              <tr style={{ borderTop: `1px solid ${T.line}`, color: T.soft }}>
                <th scope="col">Crawler</th>
                <th scope="col">On your key pages</th>
                <th scope="col">Rule</th>
                <th scope="col">The line that decides it</th>
              </tr>
            </thead>
            <tbody>
              {bot.crawlers.map((c) => {
                const purpose = purposeLine(c.name);
                const choice = c.name === CHOICE_CRAWLER;
                const s = STATE[c.state];
                return (
                  <tr key={c.name} style={{ borderTop: `1px solid ${T.line}` }}>
                    <td>
                      <span style={{ fontWeight: 700, color: T.ink }}>{c.name}</span>
                      {purpose ? <Advice said={advice(purpose)} id={`bot-${c.name}`} /> : null}
                      {choice ? <Advice said={advice("pages.bots.extended")} id="bot-extended" /> : null}
                    </td>
                    <td data-label="On your key pages">
                      <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "4px", minWidth: 0 }}>
                        <StateChip label={choice && c.state !== "allowed" ? `${s.label}, by your choice` : s.label} tone={choice ? "none" : s.tone} />
                        {c.blocked.length && c.state === "partial" ? <span style={{ ...SMALL, overflowWrap: "anywhere" }}>{c.blocked.join(", ")}</span> : null}
                      </span>
                    </td>
                    <td data-label="Rule">
                      <span style={{ fontSize: "13px", color: T.ink }}>{c.line ? (c.inherited ? "From User-agent: *" : `Its own group`) : "No rule applies"}</span>
                    </td>
                    <td data-label="The line that decides it">
                      {c.line ? <code style={{ fontSize: "12.5px", color: T.ink, overflowWrap: "anywhere" }}>{c.line}</code> : <span style={SMALL}>None</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      {edits.length ? (
        <section aria-labelledby="bots-edit" style={SECTION}>
          <h2 id="bots-edit" style={H2}>
            Copy the lines to change
          </h2>
          <Advice said={advice("pages.bots.lines")} id="bots-lines" />
          {edits.map((e) => (
            <div key={e.c.name} style={{ display: "flex", flexDirection: "column", gap: "6px", minWidth: 0 }}>
              <span style={{ fontSize: "14px", fontWeight: 600, color: T.ink }}>{e.c.name}</span>
              <CopyBlock text={e.text} label={`robots.txt lines for ${e.c.name}`} usage="fix_copy" id={`robots-${e.c.name.toLowerCase()}`} button="Copy the lines" />
            </div>
          ))}
        </section>
      ) : null}

      <section aria-labelledby="bots-pages" style={{ ...SECTION, padding: 0, gap: 0 }}>
        <div style={{ padding: "18px 20px 10px" }}>
          <h2 id="bots-pages" style={H2}>
            Your key pages
          </h2>
        </div>
        <table className="yp-table">
          <thead>
            <tr style={{ borderTop: `1px solid ${T.line}`, color: T.soft }}>
              <th scope="col">Page</th>
              <th scope="col">HTTP status</th>
              <th scope="col">noindex</th>
              <th scope="col">Canonical</th>
            </tr>
          </thead>
          <tbody>
            {bot.pages.map((p) => (
              <tr key={p.urlKey} style={{ borderTop: `1px solid ${T.line}` }}>
                <td>
                  <span style={{ fontSize: "14px", color: T.ink, overflowWrap: "anywhere" }}>{byKey.get(p.urlKey) ? p.urlKey : p.urlKey}</span>
                </td>
                <td data-label="HTTP status">
                  <StateChip label={p.status === null ? "Not read" : String(p.status)} tone={p.status === null ? "none" : p.status >= 200 && p.status < 300 ? "good" : "bad"} />
                </td>
                <td data-label="noindex">
                  <span style={{ fontSize: "13px", color: T.ink }}>{p.noindex ? "Yes" : "No"}</span>
                </td>
                <td data-label="Canonical">
                  <span style={{ fontSize: "13px", color: T.ink }}>{p.canonicalElsewhere ? "Points elsewhere" : "Its own"}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section aria-labelledby="bots-llms" style={SECTION}>
        <h2 id="bots-llms" style={H2}>
          llms.txt
        </h2>
        <p style={SMALL}>{bot.llmsTxtStatus === null ? "Not read." : bot.llmsTxtStatus >= 200 && bot.llmsTxtStatus < 300 ? "Found on your site." : `Not on your site (HTTP ${bot.llmsTxtStatus}).`}</p>
        <Advice said={advice("pages.bots.llms")} id="bots-llms-src" />
      </section>
    </>
  );
}
