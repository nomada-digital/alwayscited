import Link from "@/components/app/AppLink";
import ChipRow from "@/components/app/ChipRow";
import { ClearSearch } from "@/components/app/ClearLinks";
import { BUTTON, CHIP, DARK, FIELD, H2, LINK, OFF, SECTION, SMALL } from "@/components/app/plan/styles";
import { APP_LIMITS } from "@/config/contact";
import { T } from "@/config/tokens";
import { ORDER_LINE } from "@/lib/diy/opportunities/order";
import { type OppKeep, oppAction, oppPath } from "@/lib/diy/opportunities/paths";
import type { ListRow, PursuingRow } from "@/lib/diy/opportunities/payload";
import { LINE_G1, METHOD_ROUTES, PLAYBOOKS } from "@/lib/diy/opportunities/playbooks.advice";
import { DISMISS_CHIPS, DISMISS_LABEL, LENS_LABEL, OPP_LIMITS, TAB_LENSES, type TabLens } from "@/lib/diy/opportunities/types";

import Advice from "./Advice";
import OppStyle from "./OppStyle";
import Playbook from "./Playbook";

/**
 * Opportunities (13 Oct 2026, DIY P7; spec 10 section 4.7): where getting
 * mentioned would move the answers, and how to do it yourself. Three views
 * in the URL - the list (default), Pursuing and Methods - and on the list,
 * the lens tabs, the stated order, the rows with their route and their
 * facts, and "Log a site you found". Every control is a link or a plain
 * form, so it all works with JS off.
 */

export type OppView = "list" | "pursuing" | "methods";
export const SECTION_ERROR = "We couldn't read this part just now. The rest of the page is up to date.";
export const JOB_FAILED = "Some checks didn't finish last night; they retry tonight.";

const PILL = (on: boolean) =>
  ({ display: "inline-flex", alignItems: "center", gap: "6px", minHeight: "36px", padding: "0 14px", borderRadius: "999px", border: `1px solid ${on ? T.washLine : T.line}`, background: on ? T.wash : T.surface, color: T.ink, fontSize: "13px", fontWeight: 600, textDecoration: "none", whiteSpace: "nowrap" }) as const;
const ROUTE_PILL = { ...CHIP, background: T.wash, color: T.accentHover, border: `1px solid ${T.washLine}` } as const;
const TYPE_CHIP = { ...CHIP, background: T.chip, color: T.ink, whiteSpace: "normal" as const };

export type CapState = { active: number; cap: number; atCap: boolean; line: string };

export default function Opportunities(p: {
  slug: string;
  view: OppView;
  lens: TabLens;
  keep: OppKeep;
  header: string;
  tabs: Record<TabLens, number> | null;
  rows: ListRow[] | null;
  total: number;
  page: number;
  pages: number;
  clusters: { id: string; name: string }[];
  cluster: string | null;
  engines: { key: string; label: string }[];
  engine: string | null;
  q: string;
  toast: { tone: "good" | "bad"; text: string } | null;
  readOnly: string | null;
  canWrite: boolean;
  cap: CapState;
  dark: boolean;
  jobFailed: boolean;
  empty: string | null;
  pursuing: PursuingRow[] | null;
  upgrade: React.ReactNode;
}) {
  const href = (over: Partial<Record<keyof OppKeep, string | null>>, hash = "") => {
    const q: OppKeep = { ...p.keep };
    for (const [k, v] of Object.entries(over) as [keyof OppKeep, string | null][]) {
      if (v === null) delete q[k];
      else q[k] = v;
    }
    return oppPath(p.slug, q, hash);
  };
  const off = p.canWrite ? {} : { disabled: true, "aria-describedby": "opp-ro" };
  const offStyle = p.canWrite ? {} : OFF;

  return (
    <div className="app-col" style={{ display: "flex", flexDirection: "column", gap: "20px", minWidth: 0 }}>
      <OppStyle />
      <header style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        <h1 style={{ margin: 0, fontSize: "28px", fontWeight: 700, letterSpacing: "-0.03em", color: T.ink }}>Opportunities</h1>
        <p style={{ margin: 0, fontSize: "14px", lineHeight: 1.5, color: T.soft, maxWidth: "720px" }}>The pages the engines cite for your prompts that leave you out, and how to get onto them yourself.</p>
        {p.header ? (
          <p data-opp-header="" style={{ margin: 0, fontSize: "14px", lineHeight: 1.5, color: T.ink, maxWidth: "760px" }}>
            {p.header}
          </p>
        ) : null}
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
      {p.jobFailed ? <p style={{ ...SMALL, color: T.ink }}>{JOB_FAILED}</p> : null}

      <nav aria-label="Opportunities views" style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
        {(
          [
            ["list", "List"],
            ["pursuing", "Pursuing"],
            ["methods", "Methods"],
          ] as const
        ).map(([v, label]) => (
          <Link key={v} href={oppPath(p.slug, v === "list" ? {} : { view: v })} aria-current={p.view === v ? "page" : undefined} style={PILL(p.view === v)}>
            {v === "pursuing" ? `${label} (${p.pursuing?.length ?? p.cap.active})` : label}
          </Link>
        ))}
      </nav>

      {p.view === "methods" ? <Methods /> : p.view === "pursuing" ? <Pursuing {...p} off={off} offStyle={offStyle} /> : <List {...p} href={href} off={off} offStyle={offStyle} />}
    </div>
  );
}

type Off = { disabled?: boolean; "aria-describedby"?: string };

function List(p: Parameters<typeof Opportunities>[0] & { href: (over: Partial<Record<keyof OppKeep, string | null>>, hash?: string) => string; off: Off; offStyle: React.CSSProperties }) {
  const term = p.q.trim();
  return (
    <>
      {p.tabs ? (
        <ChipRow label="Lenses" current={p.lens}>
          {TAB_LENSES.map((l) => (
            // Positioned, so the absolute .sr-only separator stays inside the tab rather than escaping the scroller (globals.css).
            <Link key={l} href={p.href({ lens: l === "cited" ? null : l, page: null })} aria-current={p.lens === l ? "page" : undefined} style={{ ...PILL(p.lens === l), position: "relative" }}>
              {LENS_LABEL[l]}
              {/* A separator for screen readers, so the name is "Threads, 2", not "Threads2" (13 Oct 2026, review of DIY P7). */}
              <span className="sr-only">, </span>
              <span style={{ fontWeight: 400, color: T.soft }}>{p.tabs?.[l] ?? 0}</span>
            </Link>
          ))}
        </ChipRow>
      ) : null}
      <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        {p.clusters.length ? (
          <ChipRow label="Filter by cluster" current={p.cluster ?? ""}>
            <Link href={p.href({ cluster: null, page: null })} aria-current={!p.cluster ? "true" : undefined} style={PILL(!p.cluster)}>
              All clusters
            </Link>
            {p.clusters.map((c) => (
              <Link key={c.id} href={p.href({ cluster: c.id, page: null })} aria-current={p.cluster === c.id ? "true" : undefined} style={PILL(p.cluster === c.id)}>
                {c.name}
              </Link>
            ))}
          </ChipRow>
        ) : null}
        {p.engines.length > 1 ? (
          <ChipRow label="Filter by engine" current={p.engine ?? ""}>
            <Link href={p.href({ engine: null, page: null })} aria-current={!p.engine ? "true" : undefined} style={PILL(!p.engine)}>
              All engines
            </Link>
            {p.engines.map((e) => (
              <Link key={e.key} href={p.href({ engine: e.key, page: null })} aria-current={p.engine === e.key ? "true" : undefined} style={PILL(p.engine === e.key)}>
                {e.label}
              </Link>
            ))}
          </ChipRow>
        ) : null}
        <form method="get" role="search" className="app-search" style={{ display: "flex", alignItems: "center", gap: "8px", width: "320px", maxWidth: "100%", height: "44px", boxSizing: "border-box", padding: "0 12px", border: `1px solid ${T.line}`, borderRadius: "12px", background: T.surface }}>
          {p.keep.lens ? <input id="op-lens" type="hidden" name="lens" value={p.keep.lens} /> : null}
          {p.keep.cluster ? <input id="op-cluster" type="hidden" name="cluster" value={p.keep.cluster} /> : null}
          {p.keep.engine ? <input id="op-engine" type="hidden" name="engine" value={p.keep.engine} /> : null}
          <label htmlFor="op-search" className="sr-only">
            Search pages
          </label>
          <input id="op-search" type="search" name="q" defaultValue={p.q} maxLength={APP_LIMITS.search} placeholder="Search pages, e.g. a site name" enterKeyHint="search" autoCapitalize="none" autoCorrect="off" spellCheck={false} style={{ flexGrow: 1, minWidth: 0, border: 0, outline: 0, fontFamily: "inherit", fontSize: "16px", color: T.ink, background: "transparent" }} />
          {term ? <ClearSearch href={p.href({ q: null, page: null })} /> : null}
        </form>
      </div>

      <details style={{ fontSize: "14px", color: T.ink }}>
        <summary style={{ cursor: "pointer", fontWeight: 600, minHeight: "24px" }}>How this list is ordered</summary>
        <p data-opp-order="" style={{ ...SMALL, color: T.ink, marginTop: "8px", maxWidth: "760px" }}>
          {ORDER_LINE}
        </p>
      </details>

      {p.upgrade}

      <section aria-labelledby="opp-h" style={{ ...SECTION, padding: "0", gap: 0, overflow: "hidden" }}>
        <h2 id="opp-h" style={{ ...H2, padding: "18px 20px 14px" }}>
          {LENS_LABEL[p.lens]}
          {p.rows ? <span style={{ fontWeight: 400, color: T.soft }}>{` · ${p.total.toLocaleString("en-GB")}${term ? ` matching "${term}"` : ""}`}</span> : null}
        </h2>
        {p.rows === null ? (
          <p role="status" style={{ margin: 0, padding: "0 20px 18px", fontSize: "14px", color: T.ink }}>
            {SECTION_ERROR}
          </p>
        ) : !p.rows.length ? (
          <p data-opp-empty="" style={{ margin: 0, padding: "0 20px 18px", fontSize: "14px", lineHeight: 1.5, color: T.ink, maxWidth: "760px" }}>
            {term ? `No page matches "${term}". Clear the search or try part of a site name.` : (p.empty ?? "Nothing here yet. New pages arrive as the engines cite them.")}
          </p>
        ) : (
          <ol data-opp-rows="" style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {p.rows.map((r) => (
              <Row key={r.id} r={r} slug={p.slug} keep={p.keep} off={p.off} offStyle={p.offStyle} cap={p.cap} />
            ))}
          </ol>
        )}
        {p.rows && p.pages > 1 ? (
          <nav aria-label="Pages" style={{ display: "flex", gap: "8px", alignItems: "center", padding: "14px 20px", borderTop: `1px solid ${T.line}`, fontSize: "14px" }}>
            {p.page > 1 ? (
              <Link href={p.href({ page: p.page - 1 === 1 ? null : String(p.page - 1) })} style={LINK}>
                Previous
              </Link>
            ) : null}
            <span style={{ color: T.soft }}>{`Page ${p.page} of ${p.pages}`}</span>
            {p.page < p.pages ? (
              <Link href={p.href({ page: String(p.page + 1) })} style={LINK}>
                Next
              </Link>
            ) : null}
          </nav>
        ) : null}
      </section>

      {p.dark ? null : (
        <section id="log" aria-labelledby="log-h" style={SECTION}>
          <h2 id="log-h" style={H2}>
            Log a site you found
          </h2>
          <p style={{ ...SMALL, color: T.ink }}>Found a page that should mention you? Log it and we&apos;ll read it.</p>
          <form method="post" action={oppAction(p.slug, p.keep)} style={{ display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "flex-end" }}>
            <label htmlFor="op-log-url" style={{ display: "flex", flexDirection: "column", gap: "4px", flex: "1 1 260px", minWidth: 0, fontSize: "12px", fontWeight: 600, color: T.soft }}>
              The page&apos;s address
              <input id="op-log-url" name="url" type="url" inputMode="url" required maxLength={OPP_LIMITS.url} placeholder="https://" autoCapitalize="none" autoCorrect="off" spellCheck={false} {...p.off} style={{ ...FIELD, width: "100%", fontSize: "16px", ...p.offStyle }} />
            </label>
            <button type="submit" name="do" value="log" {...p.off} style={{ ...DARK, minHeight: "44px", ...p.offStyle }}>
              Log it
            </button>
          </form>
        </section>
      )}
    </>
  );
}

function Row({ r, slug, keep, off, offStyle, cap }: { r: ListRow; slug: string; keep: OppKeep; off: Off; offStyle: React.CSSProperties; cap: CapState }) {
  const action = oppAction(slug, { ...keep, id: r.id });
  const capped = cap.atCap && r.status === "new";
  const pursueOff = capped ? { disabled: true, "aria-describedby": `cap-${r.id}` } : off;
  return (
    <li id={`opp-${r.id}`} data-opp-row={r.id} data-route={r.routeKey} style={{ borderTop: `1px solid ${T.line}`, padding: "14px 20px", scrollMarginTop: "16px" }}>
      <div className="opp-row">
        <div style={{ display: "flex", flexDirection: "column", gap: "6px", minWidth: 0 }}>
          <Link href={r.href} className="opp-url" style={{ fontSize: "15px", fontWeight: 650, color: T.ink, textDecoration: "none", lineHeight: 1.35 }}>
            {r.title}
          </Link>
          <span className="opp-url" style={{ fontSize: "13px", color: T.soft }}>
            {r.domain}
          </span>
          <span style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
            <span style={ROUTE_PILL}>{r.route}</span>
            <span style={TYPE_CHIP}>{r.types}</span>
            {r.cluster ? <span style={TYPE_CHIP}>{r.cluster.name}</span> : null}
          </span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "4px", minWidth: 0, fontSize: "14px", lineHeight: 1.5, color: T.ink }}>
          {r.whyHref ? (
            <Link href={r.whyHref} style={{ color: T.ink, textDecorationColor: T.faint, textUnderlineOffset: "3px" }}>
              {r.why}
            </Link>
          ) : (
            <span>{r.why}</span>
          )}
          {r.names ? <span>{r.names}</span> : null}
          {r.fresh.length ? <span style={{ fontSize: "13px", color: T.soft }}>{r.fresh.join(" · ")}</span> : null}
        </div>
        <div className="opp-actions">
          <Link href={r.href} style={{ ...BUTTON, display: "inline-flex", alignItems: "center", textDecoration: "none", minHeight: "44px" }}>
            Open<span className="sr-only">{` ${r.title}`}</span>
          </Link>
          {r.status === "new" ? (
            <form method="post" action={action} style={{ margin: 0 }}>
              <button type="submit" name="do" value="pursue" {...pursueOff} style={{ ...DARK, minHeight: "44px", ...(capped ? OFF : offStyle) }}>
                Pursue<span className="sr-only">{` ${r.title}`}</span>
              </button>
            </form>
          ) : null}
          {r.status === "new" ? (
            <details className="opp-reasons" style={{ width: "100%", display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
              <summary style={{ cursor: "pointer", fontSize: "13px", fontWeight: 600, color: T.accent, minHeight: "44px", display: "flex", alignItems: "center", justifyContent: "flex-end" }}>Not for us</summary>
              <form method="post" action={action} style={{ margin: 0, display: "flex", flexWrap: "wrap", gap: "6px", justifyContent: "flex-end" }}>
                {DISMISS_CHIPS.map((d) => (
                  <button key={d} type="submit" name="do" value={`dismiss:${d}`} {...off} style={{ ...BUTTON, minHeight: "40px", ...offStyle }}>
                    {DISMISS_LABEL[d]}
                  </button>
                ))}
              </form>
            </details>
          ) : null}
          {capped ? (
            <p id={`cap-${r.id}`} style={{ ...SMALL, width: "100%", textAlign: "right" }}>
              {cap.line}
            </p>
          ) : null}
        </div>
      </div>
    </li>
  );
}

function Pursuing(p: Parameters<typeof Opportunities>[0] & { off: Off; offStyle: React.CSSProperties }) {
  return (
    <section aria-labelledby="pur-h" style={{ ...SECTION, padding: 0, gap: 0, overflow: "hidden" }}>
      <div style={{ padding: "18px 20px 14px", display: "flex", flexDirection: "column", gap: "4px" }}>
        <h2 id="pur-h" style={H2}>
          Pursuing
        </h2>
        <p style={SMALL}>{`Every page you are pursuing, have pitched or have won. ${p.cap.active} of ${p.cap.cap} in Pursuing or Pitched, the most at once. Each is checked weekly; won pages monthly.`}</p>
      </div>
      {p.pursuing === null ? (
        <p role="status" style={{ margin: 0, padding: "0 20px 18px", fontSize: "14px", color: T.ink }}>
          {SECTION_ERROR}
        </p>
      ) : !p.pursuing.length ? (
        <p style={{ margin: 0, padding: "0 20px 18px", fontSize: "14px", color: T.ink }}>Nothing pursued yet. Pursue a page from the list and it is checked weekly from then on.</p>
      ) : (
        <ol data-opp-pursuing="" style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {p.pursuing.map((r) => (
            <li key={r.id} data-opp-row={r.id} style={{ borderTop: `1px solid ${T.line}`, padding: "14px 20px" }}>
              <div className="opp-row">
                <div style={{ display: "flex", flexDirection: "column", gap: "6px", minWidth: 0 }}>
                  <Link href={r.href} className="opp-url" style={{ fontSize: "15px", fontWeight: 650, color: T.ink, textDecoration: "none" }}>
                    {r.title}
                  </Link>
                  <span className="opp-url" style={{ fontSize: "13px", color: T.soft }}>
                    {r.domain}
                  </span>
                  <span style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                    <span style={ROUTE_PILL}>{r.route}</span>
                    {r.cluster ? <span style={TYPE_CHIP}>{r.cluster.name}</span> : null}
                    <span style={{ ...CHIP, background: T.goodBg, color: T.goodFg }}>{r.since ? `${r.statusLabel} since ${r.since}` : r.statusLabel}</span>
                  </span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "4px", minWidth: 0, fontSize: "14px", lineHeight: 1.5, color: T.ink }}>
                  <span>
                    <strong style={{ fontWeight: 650 }}>{r.prompt && !r.prompt.added ? "Measured by: " : "Prompt added: "}</strong>
                    {r.prompt ? (
                      r.prompt.href ? (
                        <Link href={r.prompt.href} style={{ color: T.ink }}>{`'${r.prompt.text}'`}</Link>
                      ) : (
                        `'${r.prompt.text}'`
                      )
                    ) : (
                      "none; the page is watched"
                    )}
                  </span>
                  <span>{r.verification}</span>
                  {r.firstCited ? <span>{r.firstCited}</span> : null}
                  {r.note ? <span style={{ fontSize: "13px", color: T.soft }}>{`Note: ${r.note}`}</span> : null}
                </div>
                <div className="opp-actions">
                  <Link href={r.href} style={{ ...BUTTON, display: "inline-flex", alignItems: "center", textDecoration: "none", minHeight: "44px" }}>
                    Open<span className="sr-only">{` ${r.title}`}</span>
                  </Link>
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
      {p.upgrade ? <div style={{ borderTop: `1px solid ${T.line}` }}>{p.upgrade}</div> : null}
    </section>
  );
}

function Methods() {
  return (
    <section aria-labelledby="met-h" style={{ display: "flex", flexDirection: "column", gap: "16px", minWidth: 0 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
        <h2 id="met-h" style={H2}>
          Methods
        </h2>
        <p style={{ ...SMALL, maxWidth: "760px" }}>How to approach each kind of page, step by step. Every line says how we know it: Google&apos;s own documents, what your data shows, or common practice, which promises no outcome.</p>
      </div>
      {METHOD_ROUTES.map((r) => {
        const book = PLAYBOOKS[r];
        return book ? (
          <div key={r} data-opp-method={r} style={SECTION}>
            <Playbook book={book} />
          </div>
        ) : null;
      })}
      <div style={SECTION}>
        <Advice line={LINE_G1} />
      </div>
    </section>
  );
}
