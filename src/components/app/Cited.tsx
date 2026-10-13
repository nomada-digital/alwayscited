import Link from "@/components/app/AppLink";

import EngineLogo from "@/components/EngineLogo";
import { PagePath } from "@/components/app/PagePath";
import { T } from "@/config/tokens";
import { ENGINE_SPECS, type Engine } from "@/lib/scan/engines";
import { clusterCards } from "@/lib/tracking/cluster-figures";
import { APP_LIMITS } from "@/config/contact";
import { rangeLabel } from "@/lib/tracking/date-range";
import { type Day, type Range, citedPageRows, firstCheckDay, formatDay, firstReadComplete, resolveComparison } from "@/lib/tracking/figures";
import { NAMED_TOP } from "@/lib/tracking/named-figures";
import type { Compare, OverviewData } from "@/lib/tracking/overview-data";
import type { PlacementRow } from "@/lib/tracking/placement-figures";
import { runNote } from "@/lib/tracking/run-note";
import { answerHref, citedEvidence } from "@/lib/tracking/evidence";
import OppStyle from "@/components/app/opportunities/OppStyle";
import type { CitedFacts } from "@/lib/diy/opportunities/cited";
import { DOMAIN_TYPE_LABEL, type DomainType } from "@/lib/diy/opportunities/types";

import ChipRow from "./ChipRow";
import { ClearFilters, ClearSearch } from "./ClearLinks";
import DatePicker from "./DatePicker";
import { appPath } from "@/lib/app-host";

/**
 * Cited pages (R144, 1 Oct 2026; BRIEF-4 P4): the full page of the
 * Overview's "Pages the engines cite most" panel (boards-3/Main.dc.html), in
 * the Clusters page's shell, as Who is named is. Every count is
 * figures.ts citedPageRows, whose head is the panel's citedPages, so a page's
 * count here is the panel's for the same range. Pages are host and path as
 * text - never a link to someone else's page, never a query string. No
 * price, marketplace, difficulty or "you could place this" here, by the brief.
 * Filters, "Show all" and the accordion are links, so JS off works. DS20
 * (2 Oct 2026): `?q=` searches host and path, a GET form like Clusters'.
 * DB-2 (9 Oct 2026): each prompt under an open row opens the latest answer in
 * the range that cited the page, on its day and engine (evidence.ts).
 *
 * 13 Oct 2026, DIY P7 (spec 10 section 4.5, facts only): two columns, Kind
 * (the site's type) and Page type, from the rules and the cached types, a
 * blank reading "not classified yet"; `?type=` narrows to one kind of site
 * (`?kind=` is unchanged: yours, others or all); `?leaves=1` keeps the pages
 * whose latest read found you not named and which were cited in answers
 * naming another brand, less every page where another client has been placed,
 * each with "Open in Opportunities" when it has one; and a page we could not
 * read says so on its row. The unfiltered list is the pages the engines cite,
 * as before, with no advice. Below 1100px the two columns fold into a line
 * under the page.
 */

export type CitedKind = "all" | "yours" | "others";

const HEAD = { fontSize: "12px", fontWeight: 600, color: T.soft } as const;
const GRID = "minmax(0, 1fr) 96px 120px 84px 128px";
/** With the Kind and Page type columns (DIY P7). */
const GRID_TYPES = "minmax(0, 1fr) 104px 112px 96px 120px 84px 128px";
const PILL = (on: boolean) =>
  ({ display: "inline-flex", alignItems: "center", gap: "6px", height: "36px", padding: "0 14px", borderRadius: "999px", border: `1px solid ${on ? T.washLine : T.line}`, background: on ? T.wash : T.surface, color: T.ink, fontSize: "13px", fontWeight: 600, textDecoration: "none", whiteSpace: "nowrap" }) as const;
const TAG = { padding: "1px 8px", borderRadius: "999px", fontSize: "11px", fontWeight: 700, whiteSpace: "nowrap" } as const;

export default function Cited({
  domain,
  engines,
  today,
  range,
  compareMode,
  startedOn,
  data,
  placements,
  slug,
  cluster,
  engine,
  kind,
  all,
  open,
  q,
  diy,
}: {
  domain: string;
  engines: readonly Engine[];
  today: Day;
  range: Range;
  compareMode: Compare;
  startedOn: string | null;
  data: OverviewData;
  placements: (PlacementRow & { cluster_id: string })[];
  slug: string;
  cluster: string | null;
  engine: Engine | null;
  kind: CitedKind;
  all: boolean;
  /** The open row's page, as the URL carries it. */
  open: string | null;
  /** DS20: the search, already cut to APP_LIMITS.search; matches host and path. */
  q: string;
  /**
   * DIY P7: the page facts, the `?type=` and `?leaves=1` filters, and where a
   * page's opportunity opens. `facts` is null when they could not be read:
   * the columns read "not classified yet" and "Leaves you out" says so.
   */
  diy?: { facts: CitedFacts | null; type: DomainType | null; leaves: boolean; oppHref: (id: string) => string };
}) {
  // 8 Oct 2026 (audit data-10): the comparison the Overview reads - the first week for a young client.
  // The first week's first day, from started_on and the prompts - the date picker is handed the same day.
  const firstCheck = firstCheckDay(startedOn, data.questions);
  // ON-3 review (9 Oct 2026): a first reading only when its check was complete.
  const firstComplete = firstReadComplete(data.runs, firstCheck);
  const before = resolveComparison(range, compareMode, startedOn, firstCheck, firstComplete).range;
  // Audit data-3 (8 Oct 2026): every partial or failed check in the range, not only the last.
  const partial = runNote(data, range, today);
  const cards = clusterCards({ clusters: data.clusters ?? [], questions: data.questions, keywords: data.keywords, answers: data.answers, serp: data.serp, range, before, today, engines });
  const picked = cluster ? (cards.find((c) => c.id === cluster) ?? null) : null;
  const only = picked ? new Set(picked.prompts.map((p) => p.id)) : null;
  const filtered = citedPageRows(
    data.answers.filter((a) => (!only || only.has(a.question_id)) && (!engine || a.engine === engine)),
    range,
    domain,
  ).filter((p) => kind === "all" || (kind === "yours") === p.yours);
  const term = q.trim().toLowerCase();
  const facts = diy?.facts ?? null;
  const typeOn = diy?.type ?? null;
  const leavesOn = diy?.leaves === true;
  const narrowed = filtered.filter((p) => (!typeOn || facts?.kinds.get(p.page)?.domainType === typeOn) && (!leavesOn || (facts?.leaves.has(p.page) ?? false)));
  const rows = term ? narrowed.filter((p) => p.page.toLowerCase().includes(term)) : narrowed;
  const kindsSeen = facts ? [...new Set(filtered.map((p) => facts.kinds.get(p.page)?.domainType).filter((t): t is DomainType => !!t))] : [];
  const grid = diy ? GRID_TYPES : GRID;
  const live = new Map(placements.filter((p) => p.status === "live" && p.url_key).map((p) => [p.url_key, p.cluster_id]));

  const where = new Map<string, { clusterId: string; keyword: string; index: number }>();
  for (const c of cards) c.prompts.forEach((p, i) => where.set(p.id, { clusterId: c.id, keyword: c.keyword ?? c.name, index: i }));
  const text = new Map(data.questions.map((q) => [q.id, q.text]));

  const base: Record<string, string> = { from: range.from, to: range.to, ...(compareMode === "prev" ? {} : { compare: compareMode }) };
  const state = { ...base, ...(picked ? { cluster: picked.id } : {}), ...(engine ? { engine } : {}), ...(kind === "all" ? {} : { kind }), ...(typeOn ? { type: typeOn } : {}), ...(leavesOn ? { leaves: "1" } : {}), ...(term ? { q } : {}), ...(all ? { all: "1" } : {}) };
  const href = (over: Record<string, string | null>) => {
    const q: Record<string, string> = { ...state };
    for (const [k, v] of Object.entries(over)) if (v === null) delete q[k];
    else q[k] = v;
    return `?${new URLSearchParams(q)}`;
  };
  const clientPath = appPath(`/${encodeURIComponent(slug)}`);
  const shown = all ? rows : rows.slice(0, NAMED_TOP);
  const total = rows.reduce((s, p) => s + p.count, 0);
  const span = (p: { first: Day; last: Day }) => (p.first === p.last ? formatDay(p.first) : `${formatDay(p.first)} - ${formatDay(p.last)}`);
  // Audit mobile-4 (8 Oct 2026): the headline said nothing of the filters, whose chips load out of sight
  // on a phone - "5 pages cited 47 times." for one cluster on one engine read as the whole account.
  const filters = `${picked ? ` in the "${picked.keyword ?? picked.name}" cluster` : ""}${engine ? `, ${ENGINE_SPECS[engine].label} only` : ""}${kind === "yours" ? ", your site only" : kind === "others" ? ", other sites only" : ""}${typeOn ? `, ${DOMAIN_TYPE_LABEL[typeOn].toLowerCase()} sites only` : ""}${leavesOn ? ", leaving you out" : ""}`;
  const filteredView = Boolean(picked || engine || kind !== "all" || term || typeOn || leavesOn);

  return (
    <div className="app-col" style={{ display: "flex", flexDirection: "column", gap: "20px", minWidth: 0 }}>
      {diy ? <OppStyle /> : null}
      <header style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: "24px", flexWrap: "wrap" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          <h1 style={{ margin: 0, fontSize: "28px", fontWeight: 700, letterSpacing: "-0.03em", color: T.ink }}>Cited pages</h1>
          <p style={{ margin: 0, fontSize: "14px", lineHeight: 1.5, color: T.soft, maxWidth: "680px" }}>Every page the engines cite in answers to your prompts, and how often.</p>
          {partial ? <p style={{ margin: 0, fontSize: "14px", lineHeight: 1.5, color: T.soft, maxWidth: "680px" }}>{partial}</p> : null}
        </div>
        <DatePicker range={range} compare={compareMode} today={today} startedOn={startedOn} firstCheck={firstCheck} firstComplete={firstComplete} grow={false}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={T.ink} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="5" width="18" height="16" rx="2" />
            <path d="M3 10h18M8 3v4M16 3v4" />
          </svg>
          <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.25 }}>
            <span style={{ fontSize: "14px", fontWeight: 700 }}>{rangeLabel(range, today, startedOn)}</span>
            <span style={{ fontSize: "12px", color: T.soft }}>
              {formatDay(range.from)} - {formatDay(range.to, true)}
            </span>
          </span>
        </DatePicker>
      </header>

      <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        {cards.length ? (
          <ChipRow label="Filter by cluster" current={picked?.id ?? ""}>
            <Link href={href({ cluster: null, open: null })} aria-current={!picked ? "true" : undefined} style={PILL(!picked)}>
              All clusters
            </Link>
            {cards.map((c) => (
              <Link key={c.id} href={href({ cluster: c.id, open: null })} aria-current={picked?.id === c.id ? "true" : undefined} style={PILL(picked?.id === c.id)}>
                {c.keyword ?? c.name}
              </Link>
            ))}
          </ChipRow>
        ) : null}
        <ChipRow label="Filter by engine" current={engine ?? ""}>
          <Link href={href({ engine: null, open: null })} aria-current={!engine ? "true" : undefined} style={PILL(!engine)}>
            All engines
          </Link>
          {engines.map((e) => (
            <Link key={e} href={href({ engine: e, open: null })} aria-current={engine === e ? "true" : undefined} style={PILL(engine === e)}>
              <EngineLogo engine={e} size={16} />
              {ENGINE_SPECS[e].label}
            </Link>
          ))}
        </ChipRow>
        <ChipRow label="Filter by site" current={kind}>
          {(
            [
              ["all", "All sites"],
              ["yours", "Your site"],
              ["others", "Other sites"],
            ] as const
          ).map(([k, label]) => (
            <Link key={k} href={href({ kind: k === "all" ? null : k, open: null })} aria-current={kind === k ? "true" : undefined} style={PILL(kind === k)}>
              {label}
            </Link>
          ))}
        </ChipRow>
        {diy ? (
          <ChipRow label="Filter by kind of site" current={typeOn ?? (leavesOn ? "leaves" : "")}>
            <Link href={href({ leaves: leavesOn ? null : "1", open: null })} aria-current={leavesOn ? "true" : undefined} style={PILL(leavesOn)}>
              Leaves you out
            </Link>
            <Link href={href({ type: null, open: null })} aria-current={!typeOn ? "true" : undefined} style={PILL(!typeOn)}>
              Every kind
            </Link>
            {kindsSeen.map((t) => (
              <Link key={t} href={href({ type: t, open: null })} aria-current={typeOn === t ? "true" : undefined} style={PILL(typeOn === t)}>
                {DOMAIN_TYPE_LABEL[t]}
              </Link>
            ))}
          </ChipRow>
        ) : null}
        <form method="get" role="search" className="app-search" style={{ display: "flex", alignItems: "center", gap: "8px", width: "320px", maxWidth: "100%", height: "44px", boxSizing: "border-box", padding: "0 12px", border: `1px solid ${T.line}`, borderRadius: "12px", background: T.surface }}>
          <input id="ct-from" type="hidden" name="from" value={range.from} />
          <input id="ct-to" type="hidden" name="to" value={range.to} />
          {compareMode === "prev" ? null : <input id="ct-compare" type="hidden" name="compare" value={compareMode} />}
          {picked ? <input id="ct-cluster" type="hidden" name="cluster" value={picked.id} /> : null}
          {engine ? <input id="ct-engine" type="hidden" name="engine" value={engine} /> : null}
          {kind === "all" ? null : <input id="ct-kind" type="hidden" name="kind" value={kind} />}
          {typeOn ? <input id="ct-type" type="hidden" name="type" value={typeOn} /> : null}
          {leavesOn ? <input id="ct-leaves" type="hidden" name="leaves" value="1" /> : null}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={T.soft} strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-4-4" />
          </svg>
          <label htmlFor="ct-search" className="sr-only">
            Search cited pages
          </label>
          {/* Audit mobile-6 (8 Oct 2026): a search key on the phone's keyboard, and site names left as typed rather than autocorrected. */}
          <input id="ct-search" type="search" name="q" defaultValue={q} maxLength={APP_LIMITS.search} placeholder="Search pages, e.g. a site name" enterKeyHint="search" autoCapitalize="none" autoCorrect="off" spellCheck={false} style={{ flexGrow: 1, minWidth: 0, border: 0, outline: 0, fontFamily: "inherit", fontSize: "14px", color: T.ink, background: "transparent" }} />
          {term ? <ClearSearch href={href({ q: null, open: null })} /> : null}
        </form>
      </div>

      <section aria-labelledby="ct-h" style={{ background: T.surface, border: `1px solid ${T.line}`, borderRadius: "18px", overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "4px 16px", flexWrap: "wrap", padding: "18px 24px 14px" }}>
          <h2 id="ct-h" style={{ margin: 0, fontSize: "15px", fontWeight: 600, color: T.ink }}>
            {/* DS45 (2 Oct 2026): a search that keeps nothing still counts what it searched, as Who is named does - pages were cited. */}
            {rows.length
              ? `${term ? `${rows.length.toLocaleString("en-GB")} of ${filtered.length.toLocaleString("en-GB")} pages match "${q.trim()}", cited` : `${rows.length.toLocaleString("en-GB")} page${rows.length === 1 ? "" : "s"} cited`} ${total.toLocaleString("en-GB")} time${total === 1 ? "" : "s"}${filters}.`
              : term && filtered.length
                ? `0 of ${filtered.length.toLocaleString("en-GB")} pages match "${q.trim()}"${filters}.`
                : `No pages cited in this range${filters}.`}
          </h2>
          {filteredView ? <ClearFilters href={`?${new URLSearchParams(base)}`} /> : null}
        </div>
        {leavesOn && !facts ? (
          <p role="status" style={{ margin: 0, padding: "0 24px 20px", fontSize: "14px", color: T.ink }}>
            We couldn&apos;t read which pages leave you out just now. The rest of the page is up to date.
          </p>
        ) : rows.length ? (
          <>
            <div className={`app-ct-grid app-hide-sm${diy ? " opp-ct-grid" : ""}`} style={{ display: "grid", gridTemplateColumns: grid, gap: "16px", padding: "10px 24px", borderTop: `1px solid ${T.line}` }}>
              <span style={HEAD}>Page</span>
              {diy ? (
                <>
                  <span className="opp-ct-col" style={HEAD}>Kind</span>
                  <span className="opp-ct-col" style={HEAD}>Page type</span>
                </>
              ) : null}
              <span style={{ ...HEAD, textAlign: "right" }}>Times cited</span>
              <span style={HEAD}>Engines</span>
              <span style={{ ...HEAD, textAlign: "right" }}>Prompts</span>
              <span style={{ ...HEAD, textAlign: "right" }}>Cited</span>
            </div>
            <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {shown.map((p) => {
                const isOpen = open === p.page;
                const placed = live.get(p.page);
                // DB-2: per prompt, the answer each prompt link opens - the latest in range citing this page, on these filters.
                const opens = isOpen ? citedEvidence({ answers: data.answers, range, page: p.page, only, engine, engines }) : null;
                return (
                  <li key={p.page} style={{ borderTop: `1px solid ${T.line}`, background: p.yours ? T.wash : undefined }}>
                    <div className={`app-ct-grid${diy ? " opp-ct-grid" : ""}`} style={{ display: "grid", gridTemplateColumns: grid, gap: "16px", alignItems: "center", padding: "14px 24px" }}>
                      <span style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0, flexWrap: "wrap" }}>
                        <Link href={href({ open: isOpen ? null : p.page })} scroll={false} aria-expanded={isOpen} style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0, fontSize: "14px", fontWeight: 600, color: T.ink, textDecoration: "none" }}>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={T.soft} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0, transform: isOpen ? "rotate(90deg)" : undefined }}>
                            <path d="M9 6l6 6-6 6" />
                          </svg>
                          <span style={{ overflowWrap: "anywhere" }}><PagePath page={p.page} /></span>
                        </Link>
                        {p.yours ? <span style={{ ...TAG, background: T.surface, border: `1px solid ${T.washLine}`, color: T.accent }}>Your site</span> : null}
                        {placed ? (
                          <Link href={`${clientPath}/placements?${new URLSearchParams({ ...base, cluster: placed })}`} className="app-tap" style={{ ...TAG, background: T.chip, border: `1px solid ${T.line}`, color: T.ink, textDecoration: "none" }}>
                            Placement
                            <span className="sr-only">{` on ${p.page}`}</span>
                          </Link>
                        ) : null}
                        {leavesOn && facts?.opps.get(p.page) ? (
                          <Link href={diy!.oppHref(facts.opps.get(p.page)!)} className="app-tap" style={{ ...TAG, background: T.wash, border: `1px solid ${T.washLine}`, color: T.accent, textDecoration: "none" }}>
                            Open in Opportunities
                            <span className="sr-only">{` for ${p.page}`}</span>
                          </Link>
                        ) : null}
                        {diy ? (
                          <span className="opp-ct-inline" style={{ width: "100%", fontSize: "12px", color: T.soft }}>
                            {`${facts?.kinds.get(p.page)?.kind ?? "not classified yet"} · ${facts?.kinds.get(p.page)?.type ?? "not classified yet"}`}
                          </span>
                        ) : null}
                        {facts?.unreadable.get(p.page) ? (
                          <span data-ct-unread="" style={{ width: "100%", fontSize: "12px", color: T.soft }}>
                            {facts.unreadable.get(p.page)}
                          </span>
                        ) : null}
                      </span>
                      {diy ? (
                        <>
                          <span className="opp-ct-col" style={{ fontSize: "13px", color: T.soft }}>{facts?.kinds.get(p.page)?.kind ?? "not classified yet"}</span>
                          <span className="opp-ct-col" style={{ fontSize: "13px", color: T.soft }}>{facts?.kinds.get(p.page)?.type ?? "not classified yet"}</span>
                        </>
                      ) : null}
                      <span className="app-ct-count" style={{ textAlign: "right", fontSize: "14px", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
                        {p.count.toLocaleString("en-GB")}
                        <span className="app-show-sm" style={{ fontWeight: 400, color: T.soft }}>{" times"}</span>
                      </span>
                      <span className="app-ct-engines" style={{ display: "flex", gap: "4px", alignItems: "center" }}>
                        {engines.map((e) => (
                          <span key={e} style={{ display: "inline-flex", opacity: p.engines.includes(e) ? 1 : 0.22 }}>
                            <EngineLogo engine={e} size={16} title={`${ENGINE_SPECS[e].label}${p.engines.includes(e) ? " cited" : " did not cite"} this page`} />
                          </span>
                        ))}
                      </span>
                      <span className="app-ct-prompts" style={{ textAlign: "right", fontSize: "13px", color: T.soft, whiteSpace: "nowrap" }}>{`${p.prompts.length} prompt${p.prompts.length === 1 ? "" : "s"}`}</span>
                      <span className="app-ct-span" style={{ textAlign: "right", fontSize: "13px", color: T.soft, whiteSpace: "nowrap" }}>{span(p)}</span>
                    </div>
                    {isOpen ? (
                      <ul style={{ listStyle: "none", margin: 0, padding: "0 24px 16px 44px", display: "flex", flexDirection: "column", gap: "2px" }}>
                        {p.prompts.map((q) => {
                          const w = where.get(q.id);
                          return (
                            <li key={q.id} style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "8px 16px", flexWrap: "wrap", padding: "8px 0", borderTop: `1px solid ${T.hair}` }}>
                              <span style={{ display: "flex", flexDirection: "column", gap: "2px", minWidth: 0, flex: "1 1 320px" }}>
                                {w ? (
                                  <Link href={answerHref(`${clientPath}/clusters/${encodeURIComponent(w.clusterId)}`, { ...base, prompt: String(w.index) }, opens?.get(q.id))} style={{ fontSize: "14px", fontWeight: 600, color: T.ink, textDecoration: "none", overflowWrap: "anywhere" }}>
                                    {text.get(q.id) ?? "A stopped prompt"}
                                  </Link>
                                ) : (
                                  <span style={{ fontSize: "14px", fontWeight: 600, overflowWrap: "anywhere" }}>{text.get(q.id) ?? "A stopped prompt"}</span>
                                )}
                                {w ? <span style={{ fontSize: "12px", color: T.soft }}>{w.keyword}</span> : null}
                              </span>
                              <span style={{ fontSize: "13px", color: T.soft, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{`Cited ${q.daysCited} of ${q.daysAnswered} day${q.daysAnswered === 1 ? "" : "s"} answered`}</span>
                            </li>
                          );
                        })}
                      </ul>
                    ) : null}
                  </li>
                );
              })}
            </ol>
            {!all && rows.length > NAMED_TOP ? (
              <div style={{ borderTop: `1px solid ${T.line}`, padding: "14px 24px" }}>
                <Link href={href({ all: "1" })} style={{ fontSize: "14px", fontWeight: 600, color: T.accent, textDecoration: "none" }}>
                  {`Show all ${rows.length}`}
                </Link>
              </div>
            ) : null}
          </>
        ) : (
          <p style={{ margin: 0, padding: "0 24px 20px", fontSize: "14px", color: T.soft }}>
            {term && filtered.length
              ? `No cited page matches "${q.trim()}". Clear the search or try part of a site name.`
              : picked || engine || kind !== "all" || typeOn || leavesOn
                ? "No pages match these filters in this range. Clear a filter or pick another range."
                : // DS78 (2 Oct 2026, R173 pass 13, uncited cold read): answered checks that cited nothing said the figures would fill in from the first check; Overview's next step.
                  data.answers.some((a) => a.answered && a.run_date >= range.from && a.run_date <= range.to)
                  ? "The engines answered your prompts without citing a page. Pick a longer range at the top of the page."
                  : "The figures fill in from the first daily check."}
          </p>
        )}
      </section>
      <p style={{ margin: 0, fontSize: "13px", lineHeight: 1.5, color: T.soft, maxWidth: "820px" }}>
        Times cited counts every citation of the page in an answer to your prompts. Pages are shown as host and path; query strings are left off.
      </p>
    </div>
  );
}
