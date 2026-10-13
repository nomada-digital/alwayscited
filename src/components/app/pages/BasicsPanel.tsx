import Link from "@/components/app/AppLink";
import { T } from "@/config/tokens";
import { itemPath } from "@/lib/diy/plan/paths";
import { STATUS_LABEL, type PlanItem } from "@/lib/diy/plan/types";
import type { BasicsTab, HistoryRow } from "@/lib/diy/pages/view";
import { advice } from "@/lib/diy/pages/words";
import { formatDay } from "@/lib/tracking/figures";

import { Advice, H2, SECTION, SMALL, StateChip } from "./parts";

/**
 * The Basics tab (13 Oct 2026, DIY P8; spec 10 section 4.9): about ten
 * checks from our own read - and the JavaScript read's word count while DIY
 * is on - each a fact: status, final URL, canonical, indexable, title and
 * description with their lengths, the H1s, the word count, alt text, and the
 * key facts found in the text. A page that shows little without JavaScript
 * says so, with Google's dated line on keeping content in text form.
 */
export function BasicsPanel({ b }: { b: BasicsTab | null }) {
  if (!b) {
    return (
      <section aria-label="Basics" style={SECTION}>
        <p style={{ margin: 0, fontSize: "14px", color: T.ink }}>This page hasn't been read yet. We read it with your other key pages each week.</p>
      </section>
    );
  }
  const yes = (v: boolean) => <StateChip label={v ? "Found" : "Not found"} tone={v ? "good" : "none"} />;
  const rows: { label: string; value: React.ReactNode }[] = [
    { label: "HTTP status", value: <StateChip label={b.status === null ? "No answer" : String(b.status)} tone={b.status !== null && b.status >= 200 && b.status < 300 ? "good" : "bad"} /> },
    { label: "Final address", value: <span className="yp-break">{b.finalUrl ?? "Not read"}</span> },
    { label: "Canonical", value: <span className="yp-break">{b.canonical ? `${b.canonical}${b.canonicalOwn ? "" : " (another address)"}` : "None set"}</span> },
    { label: "Indexable", value: b.indexable.ok ? <StateChip label="Yes" tone="good" /> : <StateChip label={`No: noindex in the ${b.indexable.why ?? "page"}`} tone="bad" /> },
    { label: "Title", value: <span className="yp-break">{b.title.text ? `${b.title.text} (${b.title.length} characters)` : "None"}</span> },
    { label: "Description", value: <span className="yp-break">{b.description.text ? `${b.description.text} (${b.description.length} characters)` : "None"}</span> },
    { label: "H1", value: <span className="yp-break">{b.h1.length ? b.h1.join(" · ") : "None"}</span> },
    { label: "Words", value: <span>{`${b.words.static ?? 0} in the page's HTML${b.words.rendered !== null ? `, ${b.words.rendered} once JavaScript runs` : ""}`}</span> },
    { label: "Images with alt text", value: <span>{`${b.alt.with} of ${b.alt.of}`}</span> },
    { label: "Price in the text", value: yes(b.facts.price) },
    { label: "Address", value: yes(b.facts.address) },
    { label: "Phone", value: yes(b.facts.phone) },
    { label: "Opening hours", value: yes(b.facts.hours) },
  ];
  return (
    <>
      {b.words.jsOnly ? (
        <section aria-label="Without JavaScript" style={SECTION}>
          <Advice said={advice("pages.basics.js_only", { static: b.words.static ?? 0, rendered: b.words.rendered ?? 0 })} id="js-only" />
          <Advice said={advice("pages.basics.text_form")} id="text-form" />
        </section>
      ) : null}
      <section aria-labelledby="basics-h" style={{ ...SECTION, padding: 0, gap: 0 }}>
        <div style={{ padding: "18px 20px 10px" }}>
          <h2 id="basics-h" style={H2}>
            Basics
          </h2>
          {b.checkedOn ? <p style={SMALL}>{`Checked ${formatDay(b.checkedOn)}`}</p> : null}
        </div>
        <table className="yp-table">
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} style={{ borderTop: `1px solid ${T.line}` }}>
                <th scope="row" style={{ textAlign: "left", fontSize: "13px", fontWeight: 600, color: T.soft, padding: "12px", width: "200px" }}>
                  {r.label}
                </th>
                <td style={{ fontSize: "14px", color: T.ink, textAlign: "left" }}>
                  {r.value}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}

/** The History tab: every read, the days the page's text changed, and the Actions items on it. */
export function HistoryPanel({ slug, history, items }: { slug: string; history: { checks: HistoryRow[]; changes: string[] }; items: PlanItem[] }) {
  return (
    <>
      <section aria-labelledby="hist-items" style={SECTION}>
        <h2 id="hist-items" style={H2}>
          Actions on this page
        </h2>
        {items.length ? (
          <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: "8px" }}>
            {items.map((i) => (
              <li key={i.id} style={{ display: "flex", flexWrap: "wrap", gap: "6px 10px", alignItems: "center", fontSize: "14px", color: T.ink }}>
                <StateChip label={STATUS_LABEL[i.status]} tone={i.status === "done" ? "good" : i.status === "dropped" ? "none" : "warn"} />
                <Link href={itemPath(slug, i, { view: "list" })} style={{ color: T.accent, fontWeight: 600, textDecoration: "none" }} className="yp-break">
                  {i.title}
                </Link>
                {i.verified ? <span style={SMALL}>{i.verified.text}</span> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p style={SMALL}>No Actions item is about this page yet.</p>
        )}
      </section>
      <section aria-labelledby="hist-changes" style={SECTION}>
        <h2 id="hist-changes" style={H2}>
          When the page changed
        </h2>
        <p style={{ margin: 0, fontSize: "14px", color: T.ink }}>{history.changes.length ? `Its text changed between our reads on ${history.changes.map((d) => formatDay(d)).join(", ")}.` : "Its text hasn't changed between our reads."}</p>
      </section>
      <section aria-labelledby="hist-checks" style={SECTION}>
        <h2 id="hist-checks" style={H2}>
          Every read
        </h2>
        {history.checks.length ? (
          <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: "6px" }}>
            {history.checks.map((c, i) => (
              <li key={i} style={{ fontSize: "14px", lineHeight: 1.5, color: T.ink }}>
                <span style={{ fontWeight: 600 }}>{formatDay(c.day)}</span>
                {` · ${c.trigger === "on_demand" ? "you asked" : c.trigger === "onboarding" ? "first read" : "weekly"} · ${c.line}`}
              </li>
            ))}
          </ul>
        ) : (
          <p style={SMALL}>Not read yet.</p>
        )}
      </section>
    </>
  );
}
