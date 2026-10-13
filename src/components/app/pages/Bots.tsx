import { T } from "@/config/tokens";
import { formatDay } from "@/lib/tracking/figures";
import { CHOICE_CRAWLER, purposeLine, raisesBlocking, robotsEdit, robotsState } from "@/lib/diy/pages/robots";
import type { BotCheck, CrawlerVerdict, KeyPage } from "@/lib/diy/pages/types";
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
 *
 * Each key page is judged by its own host's robots.txt: the client's domain
 * first, then each subdomain a key page is on, with its own file's verdicts
 * (review of 13 Oct 2026). A page we could not read says "Not read" for its
 * noindex and canonical, never "No" or "Its own".
 */

const STATE: Record<"allowed" | "partial" | "blocked", { label: string; tone: "good" | "warn" | "bad" }> = {
  allowed: { label: "Allowed", tone: "good" },
  partial: { label: "Some key pages blocked", tone: "warn" },
  blocked: { label: "Blocked", tone: "bad" },
};

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-");

/** "robots.txt read 16 Sep.", "No robots.txt (HTTP 404), read 16 Sep.", or that it could not be read. */
function robotsLine(status: number | null, day: string, host: string | null): string {
  const state = robotsState({ status, txt: status !== null && status < 300 ? "" : null });
  const file = host ? `${host}/robots.txt` : "robots.txt";
  if (state.kind === "read") return `${host ? file : "robots.txt"} read ${formatDay(day)}.`;
  if (state.kind === "none") return `No ${file} (HTTP ${state.status}), read ${formatDay(day)}.`;
  return `We couldn't read ${host ? file : "your robots.txt"} on ${formatDay(day)}${state.status ? ` (HTTP ${state.status})` : ""}.`;
}

function CrawlerTable({ crawlers, idPrefix }: { crawlers: readonly CrawlerVerdict[]; idPrefix: string }) {
  return (
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
        {crawlers.map((c) => {
          const purpose = purposeLine(c.name);
          const choice = c.name === CHOICE_CRAWLER;
          const s = STATE[c.state];
          return (
            <tr key={c.name} style={{ borderTop: `1px solid ${T.line}` }}>
              <td>
                <span style={{ fontWeight: 700, color: T.ink }}>{c.name}</span>
                {purpose ? <Advice said={advice(purpose)} id={`${idPrefix}bot-${c.name}`} /> : null}
                {choice ? <Advice said={advice("pages.bots.extended")} id={`${idPrefix}bot-extended`} /> : null}
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
  );
}

export default function Bots({ bot, pages }: { bot: BotCheck | null; pages: readonly KeyPage[] }) {
  if (!bot) {
    return (
      <section aria-label="Crawlers" style={SECTION}>
        <p style={{ margin: 0, fontSize: "14px", lineHeight: 1.5, color: T.ink }}>We read your robots.txt with your key pages, overnight. Nothing has been read yet.</p>
      </section>
    );
  }
  const day = bot.checkedAt.slice(0, 10);
  const state = robotsState({ status: bot.robotsStatus, txt: bot.robotsStatus !== null && bot.robotsStatus < 300 ? "" : null });
  const hosts = bot.hosts ?? [];
  // The lines to change, per file: the domain's, then each subdomain's.
  const edits = [{ host: null as string | null, crawlers: bot.crawlers }, ...hosts.map((h) => ({ host: h.host as string | null, crawlers: h.crawlers }))]
    .flatMap(({ host, crawlers }) => crawlers.filter((c) => c.state !== "allowed" && raisesBlocking(c.name)).map((c) => ({ c, host, text: robotsEdit(c, host) })))
    .filter((e): e is { c: CrawlerVerdict; host: string | null; text: string } => e.text !== null);
  const byKey = new Map(pages.map((p) => [p.urlKey, p] as const));
  const yesNo = (v: boolean | null, yes: string, no: string) => (v === null || v === undefined ? "Not read" : v ? yes : no);
  return (
    <>
      <section aria-labelledby="bots-title" style={{ ...SECTION, padding: 0, gap: 0 }}>
        <div style={{ padding: "18px 20px 10px", display: "flex", flexDirection: "column", gap: "6px" }}>
          <h2 id="bots-title" style={H2}>
            Crawlers
          </h2>
          <p style={SMALL}>{robotsLine(bot.robotsStatus, day, null)}</p>
        </div>
        {state.kind === "unreadable" ? null : <CrawlerTable crawlers={bot.crawlers} idPrefix="" />}
      </section>

      {hosts.map((h) => {
        const hs = robotsState({ status: h.robotsStatus, txt: h.robotsStatus !== null && h.robotsStatus < 300 ? "" : null });
        return (
          <section key={h.host} aria-labelledby={`bots-host-${slug(h.host)}`} style={{ ...SECTION, padding: 0, gap: 0 }}>
            <div style={{ padding: "18px 20px 10px", display: "flex", flexDirection: "column", gap: "6px" }}>
              <h2 id={`bots-host-${slug(h.host)}`} style={{ ...H2, overflowWrap: "anywhere" }}>
                {`Crawlers on ${h.host}`}
              </h2>
              <p style={SMALL}>{`Your key pages on ${h.host} are read against its own robots.txt. ${robotsLine(h.robotsStatus, day, h.host)}`}</p>
            </div>
            {hs.kind === "unreadable" ? null : <CrawlerTable crawlers={h.crawlers} idPrefix={`${slug(h.host)}-`} />}
          </section>
        );
      })}

      {edits.length ? (
        <section aria-labelledby="bots-edit" style={SECTION}>
          <h2 id="bots-edit" style={H2}>
            Copy the lines to change
          </h2>
          <Advice said={advice("pages.bots.lines")} id="bots-lines" />
          {edits.map((e) => {
            const id = `robots-${e.host ? `${slug(e.host)}-` : ""}${e.c.name.toLowerCase()}`;
            return (
              <div key={id} style={{ display: "flex", flexDirection: "column", gap: "6px", minWidth: 0 }}>
                <span style={{ fontSize: "14px", fontWeight: 600, color: T.ink, overflowWrap: "anywhere" }}>{e.host ? `${e.c.name}, on ${e.host}` : e.c.name}</span>
                <CopyBlock text={e.text} label={`robots.txt lines for ${e.c.name}${e.host ? ` on ${e.host}` : ""}`} usage="fix_copy" id={id} button="Copy the lines" />
              </div>
            );
          })}
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
                  <span style={{ fontSize: "13px", color: p.noindex === null ? T.soft : T.ink }}>{yesNo(p.noindex, "Yes", "No")}</span>
                </td>
                <td data-label="Canonical">
                  <span style={{ fontSize: "13px", color: p.canonicalElsewhere === null ? T.soft : T.ink }}>{yesNo(p.canonicalElsewhere, "Points elsewhere", "Its own")}</span>
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
