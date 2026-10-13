import Link from "@/components/app/AppLink";
import ChipRow from "@/components/app/ChipRow";
import { T } from "@/config/tokens";
import { formatDay } from "@/lib/tracking/figures";
import { ADD_ANCHOR, pagePath, pagesAction, pagesPath } from "@/lib/diy/pages/paths";
import { KEY_PAGE_URL_MAX } from "@/lib/diy/pages/key-pages";
import { ISSUES, ISSUE_LABEL, type Issue, type ListRow, type SiteStrip } from "@/lib/diy/pages/view";
import { appPath } from "@/lib/app-host";

import { PILL } from "./YourPages";
import { BUTTON, DARK, FIELD, H2, LINK, OFF, Reason, SECTION, SMALL, StateChip } from "./parts";

/**
 * The key pages (13 Oct 2026, DIY P8; spec 10 section 4.9, list view): the
 * site strip, the filters, one row per key page with its origin and the
 * clusters it serves, its Google position, how often the engines cited it in
 * 28 days, its Schema, Fit and Access chips, when it was last read and its
 * open Actions items; Remove on every row; and "Add a page".
 *
 * The table stacks into one card per page below 760px (PagesStyle). Every
 * control is a plain form or link. A viewer, or anyone on an ended client,
 * sees the controls disabled with the reason.
 */

const cell = (label: string) => ({ "data-label": label });

export default function KeyPagesList({
  slug,
  rows,
  site,
  filters,
  clusters,
  canWrite,
  reason,
  focus,
  prefill,
  day0,
  removed,
  citedRead,
}: {
  slug: string;
  /** Null when the key pages could not be read. */
  rows: ListRow[] | null;
  all: number;
  site: SiteStrip | null;
  filters: { issue: Issue | null; cluster: string | null };
  clusters: { id: string; name: string }[];
  canWrite: boolean;
  reason: string;
  /** `?url=`: a page on the client's domain, and its row when it is a key page. */
  focus: { key: string; row: ListRow | null } | null;
  prefill: string;
  day0: boolean;
  removed: number;
  /** False when the citations could not be read: the column says so, never 0. */
  citedRead: boolean;
}) {
  const keep = { ...(filters.issue ? { issue: filters.issue } : {}), ...(filters.cluster ? { cluster: filters.cluster } : {}) };
  const off = !canWrite;
  const action = pagesAction(slug, keep);
  return (
    <>
      {site ? (
        <section aria-label="Your site" style={{ ...SECTION, flexDirection: "row", flexWrap: "wrap", gap: "12px 28px" }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "4px" }}>
            <span style={SMALL}>AI crawler access</span>
            {site.access ? (
              <Link href={pagesPath(slug, { view: "bots" })} style={{ textDecoration: "none" }}>
                <StateChip label={site.access.line} tone={site.access.tone} />
              </Link>
            ) : (
              <span style={SMALL}>Not read yet</span>
            )}
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "4px" }}>
            <span style={SMALL}>Organization schema on your homepage</span>
            {site.organization ? <StateChip label={site.organization.line} tone={site.organization.tone} /> : <span style={SMALL}>Not read yet</span>}
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "4px" }}>
            <span style={SMALL}>Key pages checked</span>
            <span style={{ fontSize: "14px", fontWeight: 600, color: T.ink }}>{`${site.checked.n} of ${site.checked.of}${site.checked.last ? `, last check ${formatDay(site.checked.last)}` : ""}`}</span>
          </div>
        </section>
      ) : null}

      {focus ? (
        <section aria-label="The page you asked about" style={SECTION}>
          {focus.row ? (
            <p style={{ margin: 0, fontSize: "14px", color: T.ink }}>
              {`${focus.key} is one of your key pages. `}
              <Link href={pagePath(slug, focus.row.page.id)} style={LINK}>
                Open it
              </Link>
            </p>
          ) : (
            <p style={{ margin: 0, fontSize: "14px", color: T.ink }}>{`${focus.key} isn't one of your key pages yet. Add it below to have it read each week.`}</p>
          )}
        </section>
      ) : null}

      {rows === null ? null : day0 ? (
        <section aria-label="Your key pages" style={SECTION}>
          <p style={{ margin: 0, fontSize: "14px", lineHeight: 1.5, color: T.ink }}>Checking your homepage and the pages that rank for your keywords. This happens overnight.</p>
        </section>
      ) : (
        <section aria-label="Your key pages" style={{ ...SECTION, padding: 0, gap: 0 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "10px", padding: "18px 20px 12px" }}>
            <h2 style={H2}>{`Key pages (${rows.length}${filters.issue || filters.cluster ? " shown" : ""})`}</h2>
            <ChipRow label="Issue" current={filters.issue ?? "all"}>
              <Link href={pagesPath(slug, { ...(filters.cluster ? { cluster: filters.cluster } : {}) })} aria-current={filters.issue === null ? "true" : undefined} style={PILL(filters.issue === null)}>
                All
              </Link>
              {ISSUES.map((i) => (
                <Link key={i} href={pagesPath(slug, { issue: i, ...(filters.cluster ? { cluster: filters.cluster } : {}) })} aria-current={filters.issue === i ? "true" : undefined} style={PILL(filters.issue === i)}>
                  {ISSUE_LABEL[i]}
                </Link>
              ))}
            </ChipRow>
            {clusters.length ? (
              <ChipRow label="Cluster" current={filters.cluster ?? "all"}>
                <Link href={pagesPath(slug, { ...(filters.issue ? { issue: filters.issue } : {}) })} aria-current={filters.cluster === null ? "true" : undefined} style={PILL(filters.cluster === null)}>
                  All clusters
                </Link>
                {clusters.map((c) => (
                  <Link key={c.id} href={pagesPath(slug, { cluster: c.id, ...(filters.issue ? { issue: filters.issue } : {}) })} aria-current={filters.cluster === c.id ? "true" : undefined} style={PILL(filters.cluster === c.id)}>
                    {c.name}
                  </Link>
                ))}
              </ChipRow>
            ) : null}
          </div>
          {rows.length ? (
            <div className="yp-wrap">
              <table className="yp-table yp-wide">
                <thead>
                  <tr style={{ borderTop: `1px solid ${T.line}`, color: T.soft }}>
                    <th scope="col">Page</th>
                    <th scope="col">Google</th>
                    <th scope="col">Cited (28 days)</th>
                    <th scope="col">Schema</th>
                    <th scope="col">Fit</th>
                    <th scope="col">Access</th>
                    <th scope="col">Checked</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.page.id} id={`row-${r.page.id}`} style={{ borderTop: `1px solid ${T.line}` }}>
                      <td style={{ minWidth: "200px", maxWidth: "300px" }}>
                        <Link href={pagePath(slug, r.page.id)} style={{ ...LINK, display: "block", overflowWrap: "anywhere" }}>
                          {r.title ?? r.path}
                        </Link>
                        <span style={{ ...SMALL, display: "block", overflowWrap: "anywhere" }}>{`${r.path} · ${r.origin}`}</span>
                        {r.clusters.length ? (
                          <span style={{ ...SMALL, display: "block" }}>
                            {"Serves "}
                            {r.clusters.slice(0, 2).map((c, i) => (
                              <span key={c.id}>
                                {i ? ", " : ""}
                                <Link href={appPath(`/${encodeURIComponent(slug)}/clusters/${encodeURIComponent(c.id)}`)} style={{ color: T.accent, textDecoration: "none" }}>
                                  {c.name}
                                </Link>
                              </span>
                            ))}
                            {r.clusters.length > 2 ? ` and ${r.clusters.length - 2} more` : ""}
                          </span>
                        ) : (
                          <span style={{ ...SMALL, display: "block" }}>Serves no cluster</span>
                        )}
                        <form method="post" action={pagesAction(slug, keep, { id: r.page.id })} style={{ margin: "6px 0 0" }}>
                          <button type="submit" name="do" value="remove" disabled={off} aria-describedby={off ? "yp-reason" : undefined} aria-label={`Remove ${r.path} from your key pages`} style={{ ...BUTTON, minHeight: "44px", padding: "0 12px", fontSize: "13px", ...(off ? OFF : {}) }}>
                            Remove
                          </button>
                        </form>
                      </td>
                      <td {...cell("Google")} title={r.position ? `'${r.position.keyword}'` : undefined}>
                        {r.position ? <span style={{ fontWeight: 700, color: T.ink }}>{`#${r.position.position}`}</span> : <span style={SMALL}>{r.heldElsewhere ? "Another of your pages ranks" : "Not in the top 20"}</span>}
                      </td>
                      <td {...cell("Cited (28 days)")}>
                        {!citedRead ? (
                          <span style={SMALL}>Not read</span>
                        ) : r.cited ? (
                          <Link href={appPath(`/${encodeURIComponent(slug)}/cited?kind=yours`)} style={LINK}>
                            {`${r.cited} ${r.cited === 1 ? "answer" : "answers"}`}
                          </Link>
                        ) : (
                          <span style={SMALL}>0 answers</span>
                        )}
                      </td>
                      <td {...cell("Schema")}>
                        <StateChip label={r.schema.label} tone={r.schema.tone} />
                      </td>
                      <td {...cell("Fit")}>
                        <StateChip label={r.fit.label} tone={r.fit.tone} />
                      </td>
                      <td {...cell("Access")}>
                        <StateChip label={r.access.label} tone={r.access.tone} />
                      </td>
                      <td {...cell("Checked")}>
                        <span style={{ display: "flex", flexDirection: "column", gap: "2px", alignItems: "inherit" }}>
                          <span style={{ fontSize: "13px", color: T.ink, whiteSpace: "nowrap" }}>{r.checkedOn ? formatDay(r.checkedOn) : "Not yet"}</span>
                          {r.open ? (
                            <Link href={pagePath(slug, r.page.id, { tab: "history" })} style={{ ...LINK, fontSize: "13px", whiteSpace: "nowrap" }}>
                              {`${r.open} open ${r.open === 1 ? "item" : "items"}`}
                            </Link>
                          ) : null}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p style={{ ...SMALL, padding: "0 20px 18px" }}>No key page matches these filters.</p>
          )}
          {removed ? <p style={{ ...SMALL, padding: "0 20px 18px" }}>{`${removed} ${removed === 1 ? "page you removed stays" : "pages you removed stay"} out: we won't add ${removed === 1 ? "it" : "them"} back on our own.`}</p> : null}
        </section>
      )}

      <section id={ADD_ANCHOR} aria-labelledby="add-title" style={SECTION}>
        <h2 id="add-title" style={H2}>
          Add a page
        </h2>
        <p style={SMALL}>A page on your own domain. At 10 key pages it takes the place of the oldest page we picked; pages you added stay until you remove them.</p>
        <form method="post" action={action} style={{ display: "flex", flexWrap: "wrap", gap: "10px", alignItems: "flex-end", margin: 0 }}>
          <label htmlFor="yp-add-url" style={{ display: "flex", flexDirection: "column", gap: "6px", flex: "1 1 260px", maxWidth: "520px", minWidth: 0, fontSize: "13px", fontWeight: 600, color: T.soft }}>
            Page address
            <input id="yp-add-url" name="url" type="url" inputMode="url" required maxLength={KEY_PAGE_URL_MAX} defaultValue={prefill} placeholder="https://" autoCapitalize="none" autoCorrect="off" spellCheck={false} disabled={off} aria-describedby={off ? "yp-reason" : undefined} style={FIELD} />
          </label>
          <button type="submit" name="do" value="add" disabled={off} aria-describedby={off ? "yp-reason" : undefined} style={{ ...DARK, ...(off ? OFF : {}) }}>
            Add page
          </button>
        </form>
        {off ? <Reason id="yp-reason" text={reason} /> : null}
      </section>
    </>
  );
}
