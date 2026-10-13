import Link from "@/components/app/AppLink";
import Advice from "@/components/app/opportunities/Advice";
import Playbook from "@/components/app/opportunities/Playbook";
import { BUTTON, CHIP, DARK, FIELD, H2, LINK, OFF, SECTION, SMALL } from "@/components/app/plan/styles";
import { T } from "@/config/tokens";
import { appPath } from "@/lib/app-host";
import { formatDay } from "@/lib/tracking/figures";
import { ASK_FOR_LINK, EARN_LINK, LINE_WHO_LINKS } from "@/lib/diy/links/links.advice";
import { linksAction, linksPath } from "@/lib/diy/links/paths";
import { ESTIMATE, LINK_URL_MAX, type LinkLens, type LinkView, VIEW_LABEL } from "@/lib/diy/links/types";
import type { LinksPage } from "@/lib/diy/links/view";

import LinksStyle from "./LinksStyle";

/**
 * Links (13 Oct 2026, DIY P10; spec 10 section 4.8): your link profile, how
 * it compares, and where links to the sites you compete with come from - as
 * a method with capped rows. Five views in the URL (`?view=`): Your links,
 * Link gap, Link targets, Mentions without a link, and Check a link. Every
 * control is a link or a plain form, so it all works with JS off.
 *
 * Every DataForSEO number carries "DataForSEO estimate" and its read date;
 * the rank is "DataForSEO estimate, 0-1000". Nothing here says a link will
 * move a ranking, names a price, or says a site takes placements. The
 * upgrade slot sits above the list, the method strip at the foot, and they
 * never share a card.
 */

export const SECTION_ERROR = "We couldn't read this part just now. The rest of the page is up to date.";
export const JOB_FAILED = "Some checks didn't finish last night; they retry tonight.";
export const NOT_AVAILABLE = "Your link profile isn't available yet.";
export const FEW_LINE = "We compare you with the 3 vendor sites holding the most page-1 places for your keywords, and there aren't 3 yet. This fills in as your keywords rank.";

const PILL = (on: boolean) =>
  ({ display: "inline-flex", alignItems: "center", minHeight: "44px", padding: "0 14px", borderRadius: "999px", border: `1px solid ${on ? T.washLine : T.line}`, background: on ? T.wash : T.surface, color: T.ink, fontSize: "13px", fontWeight: 600, textDecoration: "none", whiteSpace: "nowrap" }) as const;
const ROUTE_PILL = { ...CHIP, background: T.wash, color: T.accentHover, border: `1px solid ${T.washLine}` } as const;
const SOFT_CHIP = { ...CHIP, background: T.chip, color: T.ink, whiteSpace: "normal" as const };
const STATUS_CHIP = { ...CHIP, background: T.goodBg, color: T.goodFg };
const n = (v: number | null | undefined) => (typeof v === "number" ? v.toLocaleString("en-GB") : "not read");
const read = (d: string) => `${ESTIMATE}, read ${formatDay(d)}`;
const STATUS_WORD: Record<string, string> = { pursuing: "Pursuing", pitched: "Pitched", won: "Won", declined: "Declined", dismissed: "Not for us", new: "New" };

type Off = { disabled?: boolean; "aria-describedby"?: string };

export type LinksProps = {
  slug: string;
  view: LinkView;
  page: LinksPage | null;
  brand: string;
  domain: string;
  toast: { tone: "good" | "bad"; text: string } | null;
  readOnly: string | null;
  canWrite: boolean;
  /** Pursuits at once (10, 3 in the trial): at the cap, Pursue is off with the reason. */
  cap: { atCap: boolean; line: string };
  checks: { line: string | null; usedUp: string | null };
  upgrade: React.ReactNode;
};

export default function Links(p: LinksProps) {
  const off: Off = p.canWrite ? {} : { disabled: true, "aria-describedby": "links-ro" };
  const offStyle = p.canWrite ? {} : OFF;
  const ready = p.page?.state === "ready";
  const views: LinkView[] = ready ? ["profile", "gap", "targets", "mentions", "check"] : ["profile", "check"];
  const view: LinkView = views.includes(p.view) ? p.view : "profile";
  return (
    <div className="app-col" style={{ display: "flex", flexDirection: "column", gap: "20px", minWidth: 0 }}>
      <LinksStyle />
      <header style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        <h1 style={{ margin: 0, fontSize: "28px", fontWeight: 700, letterSpacing: "-0.03em", color: T.ink }}>Links</h1>
        <p style={{ margin: 0, fontSize: "14px", lineHeight: 1.5, color: T.soft, maxWidth: "720px" }}>Your link profile, how it compares with the sites you compete with, and where their links come from, with the method for each.</p>
      </header>
      {p.toast ? (
        <p role="status" data-tone={p.toast.tone} style={{ margin: 0, padding: "12px 16px", borderRadius: "14px", background: T.ink, color: T.surface, fontSize: "14px", lineHeight: 1.4, alignSelf: "flex-start", maxWidth: "100%", boxSizing: "border-box", overflowWrap: "anywhere" }}>
          {p.toast.text}
        </p>
      ) : null}
      {p.readOnly ? (
        <p id="links-ro" style={{ margin: 0, padding: "12px 16px", borderRadius: "12px", background: T.wash, border: `1px solid ${T.washLine}`, fontSize: "14px", color: T.ink }}>
          {p.readOnly}
        </p>
      ) : null}
      {p.page?.jobFailed && ready ? <p style={{ ...SMALL, color: T.ink }}>{JOB_FAILED}</p> : null}

      <nav aria-label="Links views" style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
        {views.map((v) => (
          <Link key={v} href={linksPath(p.slug, { view: v })} aria-current={view === v ? "page" : undefined} style={PILL(view === v)}>
            {VIEW_LABEL[v]}
          </Link>
        ))}
      </nav>

      {p.page === null ? (
        <section style={SECTION}>
          <p role="status" style={{ margin: 0, fontSize: "14px", color: T.ink }}>
            {SECTION_ERROR}
          </p>
        </section>
      ) : view === "check" ? (
        <Check {...p} off={off} offStyle={offStyle} />
      ) : !ready ? (
        <Unread {...p} page={p.page} />
      ) : view === "gap" ? (
        <Gap {...p} page={p.page} off={off} offStyle={offStyle} />
      ) : view === "targets" ? (
        <Targets {...p} page={p.page} off={off} offStyle={offStyle} />
      ) : view === "mentions" ? (
        <Mentions {...p} page={p.page} off={off} offStyle={offStyle} />
      ) : (
        <Profile {...p} page={p.page} />
      )}
    </div>
  );
}

/** Dark, inactive, or not read yet: no paid section, the wins and the method (spec 10 section 4.8, "States"). */
function Unread(p: LinksProps & { page: LinksPage }) {
  const line = p.page.state === "inactive" ? NOT_AVAILABLE : p.page.state === "not_read" ? `Your link profile is read weekly.${p.page.firstRead ? ` First read ${formatDay(p.page.firstRead)}.` : ""}` : null;
  return (
    <>
      {line ? (
        <section data-links-state={p.page.state} style={SECTION}>
          <p style={{ margin: 0, fontSize: "15px", fontWeight: 600, color: T.ink }}>{line}</p>
          <p style={{ ...SMALL }}>Check a link still works: it reads the page now and says whether it links to you.</p>
        </section>
      ) : (
        <p data-links-state="dark" style={{ ...SMALL, color: T.ink }}>
          Check whether a page links to you under Check a link, and follow the method below.
        </p>
      )}
      <Wins page={p.page} slug={p.slug} />
      <Methods books="both" />
    </>
  );
}

function Profile(p: LinksProps & { page: LinksPage }) {
  const pr = p.page.profile;
  return (
    <>
      <section aria-labelledby="lk-you" style={SECTION}>
        <h2 id="lk-you" style={H2}>
          Your links
        </h2>
        {!pr ? (
          <p style={{ margin: 0, fontSize: "14px", color: T.ink }}>{`Your link profile is read weekly.${p.page.firstRead ? ` First read ${formatDay(p.page.firstRead)}.` : ""}`}</p>
        ) : pr.notIndexed ? (
          <p data-links-state="not-indexed" style={{ margin: 0, fontSize: "14px", color: T.ink }}>{`No links found in DataForSEO's index for ${p.domain} (read ${formatDay(pr.readOn)}). Check a link still works.`}</p>
        ) : (
          <>
            <div className="lk-figs">
              <Figure label="Referring domains" value={n(pr.referringDomains)} />
              <Figure label="Backlinks" value={n(pr.backlinks)} />
              <Figure label="DataForSEO rank" value={n(pr.rank)} note="DataForSEO estimate, 0-1000" />
              {pr.follow ? <Figure label="Followed" value={`${pr.follow.followed}%`} note={`Not followed ${pr.follow.notFollowed}%, other ${pr.follow.other}%`} /> : null}
            </div>
            <p style={SMALL}>{`${read(pr.readOn)}. Counted from DataForSEO's index, not from Google.`}</p>
          </>
        )}
      </section>

      {p.page.weeks && p.page.weeks.bars.length ? <Weeks weeks={p.page.weeks} /> : null}
      {p.page.moved ? <Moved moved={p.page.moved} /> : null}

      <section aria-labelledby="lk-cmp" style={SECTION}>
        <h2 id="lk-cmp" style={H2}>
          You and the sites you compete with
        </h2>
        {p.page.compare ? (
          <>
            <p data-links-basis="" style={{ margin: 0, fontSize: "14px", lineHeight: 1.5, color: T.ink, maxWidth: "820px" }}>
              {p.page.compare.line}
            </p>
            <div className="lk-scroll" role="region" aria-label="You and the sites you compete with" tabIndex={0}>
              <table className="lk-table">
                <thead>
                  <tr style={{ color: T.soft, fontSize: "12px" }}>
                    <th scope="col">Site</th>
                    <th scope="col" className="num">
                      DataForSEO rank
                    </th>
                    <th scope="col" className="num">
                      Referring domains
                    </th>
                    <th scope="col" className="num">
                      New, 30 days
                    </th>
                    <th scope="col" className="num">
                      Lost, 30 days
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {p.page.compare.rows.map((r) => (
                    <tr key={r.domain} style={{ borderTop: `1px solid ${T.line}`, fontWeight: r.you ? 650 : 400 }}>
                      <th scope="row" style={{ fontWeight: "inherit" }} className="lk-url">
                        {r.you ? `${r.domain} (you)` : r.domain}
                      </th>
                      <td className="num">{n(r.rank)}</td>
                      <td className="num">{n(r.referringDomains)}</td>
                      <td className="num">{n(r.newDomains)}</td>
                      <td className="num">{n(r.lostDomains)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p style={SMALL}>{`${read(p.page.compare.readOn)}. Rank on DataForSEO's 0-1000 scale.`}</p>
          </>
        ) : (
          <p style={{ margin: 0, fontSize: "14px", color: T.ink }}>{p.page.few ? FEW_LINE : "The comparison is read monthly."}</p>
        )}
      </section>

      <Wins page={p.page} slug={p.slug} />
    </>
  );
}

function Figure({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "2px", padding: "12px 14px", borderRadius: "14px", background: T.bg, minWidth: 0 }}>
      <span style={{ fontSize: "12px", fontWeight: 600, color: T.soft }}>{label}</span>
      <span style={{ fontSize: "22px", fontWeight: 700, color: T.ink, letterSpacing: "-0.02em" }}>{value}</span>
      {note ? <span style={{ fontSize: "12px", color: T.soft }}>{note}</span> : null}
    </div>
  );
}

function Weeks({ weeks }: { weeks: NonNullable<LinksPage["weeks"]> }) {
  const max = Math.max(1, ...weeks.bars.flatMap((b) => [b.newDomains, b.lostDomains]));
  const w = (v: number) => `${Math.max(v ? 4 : 0, Math.round((v / max) * 120))}px`;
  return (
    <section aria-labelledby="lk-weeks" style={SECTION}>
      <h2 id="lk-weeks" style={H2}>
        New and lost referring domains, by week
      </h2>
      <div className="lk-scroll" role="region" aria-label="New and lost referring domains, by week" tabIndex={0}>
        <table className="lk-table">
          <thead>
            <tr style={{ color: T.soft, fontSize: "12px" }}>
              <th scope="col">Week to</th>
              <th scope="col">New</th>
              <th scope="col">Lost</th>
            </tr>
          </thead>
          <tbody>
            {weeks.bars.map((b) => (
              <tr key={b.week} style={{ borderTop: `1px solid ${T.line}` }}>
                <th scope="row" style={{ fontWeight: 400, whiteSpace: "nowrap" }}>
                  {formatDay(b.week)}
                </th>
                <td style={{ whiteSpace: "nowrap" }}>
                  <span className="lk-bar" aria-hidden="true" style={{ width: w(b.newDomains), background: T.accent }} /> <span>{b.newDomains}</span>
                </td>
                <td style={{ whiteSpace: "nowrap" }}>
                  <span className="lk-bar" aria-hidden="true" style={{ width: w(b.lostDomains), background: T.soft }} /> <span>{b.lostDomains}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p style={SMALL}>{`${read(weeks.readOn)}.`}</p>
    </section>
  );
}

function Moved({ moved }: { moved: NonNullable<LinksPage["moved"]> }) {
  const list = (rows: typeof moved.added, word: string) =>
    rows.length ? (
      <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: "8px" }}>
        {rows.slice(0, 20).map((r) => (
          <li key={`${r.domain}|${r.page}`} style={{ fontSize: "14px", lineHeight: 1.45, color: T.ink }}>
            <span className="lk-url" style={{ fontWeight: 650 }}>
              {r.domain}
            </span>
            <span style={{ color: T.soft }}>{` ${word} ${r.page ?? "your site"}${r.on ? ` · ${formatDay(r.on)}` : ""}`}</span>
          </li>
        ))}
        {rows.length > 20 ? <li style={SMALL}>{`and ${rows.length - 20} more`}</li> : null}
      </ul>
    ) : (
      <p style={{ margin: 0, fontSize: "14px", color: T.soft }}>None this week.</p>
    );
  return (
    <section aria-labelledby="lk-moved" style={SECTION}>
      <h2 id="lk-moved" style={H2}>
        {`New and lost since ${formatDay(moved.since)}`}
      </h2>
      <div className="lk-two">
        <div style={{ display: "flex", flexDirection: "column", gap: "8px", minWidth: 0 }}>
          <h3 style={{ margin: 0, fontSize: "14px", fontWeight: 700, color: T.ink }}>New referring domains</h3>
          {list(moved.added, "links to")}
        </div>
        <div id="lost" style={{ display: "flex", flexDirection: "column", gap: "8px", minWidth: 0, scrollMarginTop: "16px" }}>
          <h3 style={{ margin: 0, fontSize: "14px", fontWeight: 700, color: T.ink }}>Lost referring domains</h3>
          {list(moved.lost, "linked to")}
        </div>
      </div>
      <p style={SMALL}>{`${read(moved.readOn)}. A lost link to one of your key pages becomes a Reclaim card in Actions.`}</p>
    </section>
  );
}

function Wins({ page, slug }: { page: LinksPage; slug: string }) {
  return (
    <section id="wins" aria-labelledby="lk-wins" style={{ ...SECTION, scrollMarginTop: "16px" }}>
      <h2 id="lk-wins" style={H2}>
        Links you are pursuing
      </h2>
      {page.wins.length ? (
        <ul data-links-wins="" style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: "12px" }}>
          {page.wins.map((w) => (
            <li key={w.id} style={{ display: "flex", flexDirection: "column", gap: "4px", fontSize: "14px", lineHeight: 1.45, color: T.ink }}>
              <span style={{ display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center" }}>
                {w.open ? (
                  <Link href={appPath(`/${encodeURIComponent(slug)}/opportunities/${encodeURIComponent(w.id)}`)} className="lk-url" style={{ fontWeight: 650, color: T.ink }}>
                    {w.title}
                  </Link>
                ) : (
                  <span className="lk-url" style={{ fontWeight: 650, color: T.ink }}>
                    {w.title}
                  </span>
                )}
                <span style={STATUS_CHIP}>{w.since ? `${STATUS_WORD[w.status] ?? w.status} since ${formatDay(w.since)}` : (STATUS_WORD[w.status] ?? w.status)}</span>
              </span>
              <span style={{ color: T.soft }}>{w.line}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p style={{ margin: 0, fontSize: "14px", color: T.ink }}>Nothing pursued from Links yet. Pursue a site, a page or a mention and it is listed here and in Opportunities.</p>
      )}
    </section>
  );
}

function PursueForm({ slug, view, lens, rowKey, label, pursued, off, offStyle, cap }: { slug: string; view: LinkView; lens: LinkLens; rowKey: string; label: string; pursued: { id: string; status: string; open: boolean } | null; off: Off; offStyle: React.CSSProperties; cap: LinksProps["cap"] }) {
  if (pursued && !pursued.open) return <span style={{ ...STATUS_CHIP, minHeight: "28px" }}>{STATUS_WORD[pursued.status] ?? "Pursued"}</span>;
  if (pursued) {
    return (
      <Link href={appPath(`/${encodeURIComponent(slug)}/opportunities/${encodeURIComponent(pursued.id)}`)} style={{ ...BUTTON, display: "inline-flex", alignItems: "center", textDecoration: "none", minHeight: "44px" }}>
        {STATUS_WORD[pursued.status] ?? "Open"}
        <span className="sr-only">{` ${label}`}</span>
      </Link>
    );
  }
  const capped = cap.atCap;
  const rowId = `${lens}-${rowKey.replace(/[^a-z0-9]+/gi, "-").slice(0, 60)}`;
  const capId = `cap-${rowId}`;
  const o = capped ? { disabled: true, "aria-describedby": capId } : off;
  return (
    <form method="post" action={linksAction(slug, { view })} style={{ margin: 0, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "4px" }}>
      <input id={`lk-lens-${rowId}`} type="hidden" name="lens" value={lens} />
      <input id={`lk-key-${rowId}`} type="hidden" name="key" value={rowKey} />
      <button type="submit" name="do" value="pursue" {...o} style={{ ...DARK, minHeight: "44px", ...(capped ? OFF : offStyle) }}>
        Pursue<span className="sr-only">{` ${label}`}</span>
      </button>
      {capped ? (
        <span id={capId} style={{ ...SMALL, textAlign: "right", maxWidth: "260px" }}>
          {cap.line}
        </span>
      ) : null}
    </form>
  );
}

function Gap(p: LinksProps & { page: LinksPage; off: Off; offStyle: React.CSSProperties }) {
  const g = p.page.gap;
  return (
    <>
      <section id="gap" aria-labelledby="lk-gap" style={{ ...SECTION, padding: 0, gap: 0, overflow: "hidden", scrollMarginTop: "16px" }}>
        <div style={{ padding: "18px 20px 14px", display: "flex", flexDirection: "column", gap: "6px" }}>
          <h2 id="lk-gap" style={H2}>
            Link gap
          </h2>
          {p.page.few ? (
            <p data-links-state="few" style={{ margin: 0, fontSize: "14px", color: T.ink }}>
              {FEW_LINE}
            </p>
          ) : g ? (
            <p style={SMALL}>{`Sites linking to at least 2 of the ${g.of} sites you compete with, and not to you, with followed links. Top ${g.limit}, most of the ${g.of} first. ${read(g.readOn)}.`}</p>
          ) : (
            <p style={{ margin: 0, fontSize: "14px", color: T.ink }}>The link gap is read monthly, with the sites you compete with.</p>
          )}
        </div>
        {g && !p.page.few ? (
          g.rows.length ? (
            <ol data-links-gap="" style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {g.rows.map((r) => (
                <li key={r.key} data-links-row={r.domain} style={{ borderTop: `1px solid ${T.line}`, padding: "14px 20px" }}>
                  <div className="lk-row">
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px", minWidth: 0 }}>
                      <span className="lk-url" style={{ fontSize: "15px", fontWeight: 650, color: T.ink }}>
                        {r.domain}
                      </span>
                      <span style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                        <span style={ROUTE_PILL}>Earn a link</span>
                        {r.platform ? <span style={SOFT_CHIP}>{r.platform}</span> : null}
                      </span>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: "4px", minWidth: 0, fontSize: "14px", lineHeight: 1.5, color: T.ink }}>
                      <span>{`Links to ${r.linksTo} of ${r.of}: ${r.names.join(", ")}`}</span>
                      {r.firstSeen ? <span style={{ fontSize: "13px", color: T.soft }}>{`First seen ${formatDay(r.firstSeen)}`}</span> : null}
                    </div>
                    <div className="lk-actions">
                      <PursueForm slug={p.slug} view="gap" lens="link_domain" rowKey={r.key} label={r.domain} pursued={r.pursued} off={p.off} offStyle={p.offStyle} cap={p.cap} />
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p style={{ margin: 0, padding: "0 20px 18px", fontSize: "14px", color: T.ink }}>No site in this month&apos;s read links to two of these and not to you.</p>
          )
        ) : null}
        {g && !p.page.few && g.more > 0 ? (
          <p data-links-more="" style={{ margin: 0, padding: "14px 20px", borderTop: `1px solid ${T.line}`, fontSize: "14px", color: T.ink }}>
            {`${g.more.toLocaleString("en-GB")} more ${g.more === 1 ? "site links" : "sites link"} to two or more of these and not to you.`}
          </p>
        ) : null}
      </section>
      <Methods books="earn" />
    </>
  );
}

function TargetRow({ r, p }: { r: NonNullable<LinksPage["targets"]>["thisMonth"][number]; p: LinksProps & { off: Off; offStyle: React.CSSProperties } }) {
  return (
    <li data-links-target={r.key} style={{ borderTop: `1px solid ${T.line}`, padding: "14px 20px" }}>
      <div className="lk-row">
        <div style={{ display: "flex", flexDirection: "column", gap: "6px", minWidth: 0 }}>
          <a href={r.url} rel="noopener noreferrer nofollow" target="_blank" className="lk-url" style={{ fontSize: "15px", fontWeight: 650, color: T.ink, textDecoration: "none", lineHeight: 1.35 }}>
            {r.title ?? r.url}
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
          <span className="lk-url" style={{ fontSize: "13px", color: T.soft }}>
            {r.url}
          </span>
          <span style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
            <span style={ROUTE_PILL}>Earn a link</span>
            <span style={SOFT_CHIP}>In the article</span>
          </span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "4px", minWidth: 0, fontSize: "14px", lineHeight: 1.5, color: T.ink }}>
          {r.links.length ? r.links.map((l) => <span key={l.target}>{`Links to ${l.target}${l.anchor ? ` with '${l.anchor}'` : ""}`}</span>) : <span>Links to a site you compete with.</span>}
          <span style={{ fontSize: "13px", color: T.soft }}>{[r.firstSeen ? `First seen ${formatDay(r.firstSeen)}` : null, r.revealedOn ? `revealed ${formatDay(r.revealedOn)}` : null].filter(Boolean).join(" · ")}</span>
        </div>
        <div className="lk-actions">
          <PursueForm slug={p.slug} view="targets" lens="link_page" rowKey={r.key} label={r.title ?? r.url} pursued={r.pursued} off={p.off} offStyle={p.offStyle} cap={p.cap} />
        </div>
      </div>
    </li>
  );
}

function Targets(p: LinksProps & { page: LinksPage; off: Off; offStyle: React.CSSProperties }) {
  const t = p.page.targets;
  return (
    <>
      {p.upgrade}
      <section id="targets" aria-labelledby="lk-tg" style={{ ...SECTION, padding: 0, gap: 0, overflow: "hidden", scrollMarginTop: "16px" }}>
        <div style={{ padding: "18px 20px 14px", display: "flex", flexDirection: "column", gap: "6px" }}>
          <h2 id="lk-tg" style={H2}>
            Link targets
          </h2>
          {p.page.few || !t ? (
            <p data-links-state="few" style={{ margin: 0, fontSize: "14px", color: T.ink }}>
              {FEW_LINE}
            </p>
          ) : (
            <p style={SMALL}>{`Pages that link to the sites you compete with from inside an article, with a followed link, and not to you. ${t.limit} are revealed a month.${t.readOn ? ` ${read(t.readOn)}.` : ""}`}</p>
          )}
        </div>
        {t && !p.page.few ? (
          <>
            <h3 style={{ margin: 0, padding: "0 20px 10px", fontSize: "14px", fontWeight: 700, color: T.ink }}>{`This month's revealed pages: ${t.used} of ${t.limit}`}</h3>
            {t.thisMonth.length ? (
              <ol data-links-revealed="" style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {t.thisMonth.map((r) => (
                  <TargetRow key={r.key} r={r} p={p} />
                ))}
              </ol>
            ) : (
              <p style={{ margin: 0, padding: "0 20px 14px", fontSize: "14px", color: T.ink }}>None revealed yet this month.</p>
            )}
            <div style={{ padding: "14px 20px", borderTop: `1px solid ${T.line}`, display: "flex", flexDirection: "column", gap: "10px" }}>
              {t.left > 0 && t.more > 0 ? (
                <form method="post" action={linksAction(p.slug, { view: "targets" })} style={{ margin: 0 }}>
                  <input id="lk-seen" type="hidden" name="seen" value={String(t.used)} />
                  <button type="submit" name="do" value="reveal" {...p.off} style={{ ...DARK, minHeight: "44px", ...p.offStyle }}>
                    {`Show the next ${Math.min(5, t.left, t.more)}`}
                  </button>
                </form>
              ) : t.left === 0 ? (
                <p data-links-cap="" style={{ margin: 0, fontSize: "14px", fontWeight: 600, color: T.ink }}>{`You've used this month's ${t.limit} link targets. They reset on ${t.resetsLabel}.`}</p>
              ) : null}
              <p data-links-more="" style={{ margin: 0, fontSize: "14px", color: T.ink }}>
                {t.more > 0 ? `${t.more.toLocaleString("en-GB")} more ${t.more === 1 ? "page links" : "pages link"} to the sites you compete with from inside an article, and not to you. Next reveals from ${t.resetsLabel}${t.left > 0 ? `, or ${t.left} left this month` : ""}.` : "Every page in this month's read is revealed."}
              </p>
            </div>
            {t.earlier.length ? (
              <details style={{ borderTop: `1px solid ${T.line}` }}>
                <summary style={{ cursor: "pointer", padding: "14px 20px", fontSize: "14px", fontWeight: 600, color: T.ink, minHeight: "44px", boxSizing: "border-box" }}>{`Revealed in earlier months (${t.earlier.length})`}</summary>
                <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
                  {t.earlier.map((r) => (
                    <TargetRow key={r.key} r={r} p={p} />
                  ))}
                </ol>
              </details>
            ) : null}
          </>
        ) : null}
      </section>
      <Methods books="earn" />
    </>
  );
}

function Mentions(p: LinksProps & { page: LinksPage; off: Off; offStyle: React.CSSProperties }) {
  const m = p.page.mentions;
  return (
    <>
      <section id="mentions" aria-labelledby="lk-mn" style={{ ...SECTION, padding: 0, gap: 0, overflow: "hidden", scrollMarginTop: "16px" }}>
        <div style={{ padding: "18px 20px 14px", display: "flex", flexDirection: "column", gap: "6px" }}>
          <h2 id="lk-mn" style={H2}>
            Mentions without a link
          </h2>
          {m ? (
            <p style={SMALL}>{`Pages that name ${p.brand} and don't link to you. DataForSEO's index found the pages; we read each one ourselves (${formatDay(m.readOn)}) and list only those we could read that name you with no link.`}</p>
          ) : (
            <p style={{ margin: 0, fontSize: "14px", color: T.ink }}>Mentions are read monthly.</p>
          )}
        </div>
        {m ? (
          m.rows.length ? (
            <ol data-links-mentions="" style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {m.rows.map((r) => (
                <li key={r.key} data-links-mention={r.key} style={{ borderTop: `1px solid ${T.line}`, padding: "14px 20px" }}>
                  <div className="lk-row">
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px", minWidth: 0 }}>
                      <a href={r.url} rel="noopener noreferrer nofollow" target="_blank" className="lk-url" style={{ fontSize: "15px", fontWeight: 650, color: T.ink, textDecoration: "none", lineHeight: 1.35 }}>
                        {r.title ?? r.url}
                        <span className="sr-only"> (opens in a new tab)</span>
                      </a>
                      <span className="lk-url" style={{ fontSize: "13px", color: T.soft }}>
                        {r.domain}
                      </span>
                      <span style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                        <span style={ROUTE_PILL}>Ask for a link</span>
                      </span>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: "4px", minWidth: 0, fontSize: "14px", lineHeight: 1.5, color: T.ink }}>
                      {r.snippet ? <span style={{ fontStyle: "italic" }}>{`"${r.snippet}"`}</span> : null}
                      <span style={{ fontSize: "13px", color: T.soft }}>{[r.published ? `Published ${formatDay(r.published)}` : null, `read by us ${formatDay(r.readOn)}`].filter(Boolean).join(" · ")}</span>
                    </div>
                    <div className="lk-actions">
                      <PursueForm slug={p.slug} view="mentions" lens="mention" rowKey={r.key} label={r.title ?? r.url} pursued={r.pursued} off={p.off} offStyle={p.offStyle} cap={p.cap} />
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p style={{ margin: 0, padding: "0 20px 18px", fontSize: "14px", color: T.ink }}>No page we read names you without a link this month.</p>
          )
        ) : null}
      </section>
      <Methods books="ask" />
    </>
  );
}

function Check(p: LinksProps & { off: Off; offStyle: React.CSSProperties }) {
  return (
    <section id="check" aria-labelledby="lk-ck" style={{ ...SECTION, scrollMarginTop: "16px" }}>
      <h2 id="lk-ck" style={H2}>
        Check a link
      </h2>
      <p style={{ ...SMALL, color: T.ink, maxWidth: "760px" }}>{`We read the page now and say whether it links to ${p.domain}: the anchor, whether the link is followed, and the page it points at.`}</p>
      {p.checks.usedUp ? (
        <p data-links-cap="" style={{ margin: 0, fontSize: "14px", fontWeight: 600, color: T.ink }}>
          {p.checks.usedUp}
        </p>
      ) : (
        <form method="post" action={linksAction(p.slug, { view: "check" })} style={{ display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "flex-end" }}>
          <label htmlFor="lk-url" style={{ display: "flex", flexDirection: "column", gap: "4px", flex: "1 1 260px", minWidth: 0, fontSize: "12px", fontWeight: 600, color: T.soft }}>
            The page&apos;s address
            <input id="lk-url" name="url" type="url" inputMode="url" required maxLength={LINK_URL_MAX} placeholder="https://" autoCapitalize="none" autoCorrect="off" spellCheck={false} {...p.off} style={{ ...FIELD, width: "100%", fontSize: "16px", ...p.offStyle }} />
          </label>
          <button type="submit" name="do" value="check" {...p.off} style={{ ...DARK, minHeight: "44px", ...p.offStyle }}>
            Check this page
          </button>
        </form>
      )}
      {p.checks.line ? <p style={SMALL}>{p.checks.line}</p> : null}
      {p.page && p.page.checks.length ? (
        <ul data-links-checks="" style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: "10px" }}>
          {p.page.checks.map((c) => (
            <li key={c.id} style={{ display: "flex", flexDirection: "column", gap: "2px", paddingTop: "10px", borderTop: `1px solid ${T.line}`, fontSize: "14px", lineHeight: 1.45, color: T.ink }}>
              <span className="lk-url" style={{ fontWeight: 650 }}>
                {c.url}
              </span>
              <span>{c.line}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <p style={SMALL}>
        Pursued pages are checked for your link weekly. <Link href={appPath(`/${encodeURIComponent(p.slug)}/opportunities?view=pursuing`)} style={LINK}>See them in Opportunities</Link>.
      </p>
    </section>
  );
}

/** The method strip, at the foot of the page: never in the same card as the upgrade slot (spec 10 section 2.7). */
function Methods({ books }: { books: "earn" | "ask" | "both" }) {
  const list = books === "earn" ? [EARN_LINK] : books === "ask" ? [ASK_FOR_LINK] : [EARN_LINK, ASK_FOR_LINK];
  return (
    <section aria-label="The method" data-links-method={books} style={{ display: "flex", flexDirection: "column", gap: "12px", minWidth: 0 }}>
      {list.map((b) => (
        <div key={b.route} style={SECTION}>
          <Playbook book={b} extra={<Advice line={LINE_WHO_LINKS} lead="Who to write to:" />} />
        </div>
      ))}
    </section>
  );
}
