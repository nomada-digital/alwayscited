import { T } from "@/config/tokens";
import { diffLines } from "@/lib/diy/pages/fix";
import { pageAction } from "@/lib/diy/pages/paths";
import type { SchemaTab } from "@/lib/diy/pages/view";
import { advice } from "@/lib/diy/pages/words";

import CopyBlock from "./CopyBlock";
import { Advice, BUTTON, H2, H3, OFF, SECTION, SMALL } from "./parts";

/**
 * The Schema tab (13 Oct 2026, DIY P8; spec 10 sections 4.9 and 6.4): what
 * we found and where (static HTML, or only after JavaScript), the validator's
 * findings in plain words when it has read (monthly, while DIY is on); our
 * checks, each with its grade; the fix, filled only from the page's own
 * visible content, each property saying where it came from, shown against
 * the block already on the page; how to add it; and the evidence box, which
 * is always shown. Copy says "the structured data we found", never "the
 * schema Google sees".
 */

const list = (xs: readonly string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}` : (xs[0] ?? ""));

const HOWTO = ["pages.howto.wordpress", "pages.howto.shopify", "pages.howto.webflow", "pages.howto.squarespace", "pages.howto.wix", "pages.howto.other", "pages.howto.tag_manager"];
const EVIDENCE = ["pages.evidence.eligible", "pages.evidence.ai_features", "pages.evidence.faq"];

export default function SchemaPanel({ slug, pageId, pageUrl, tab, canWrite, reason, enabled, checksOut }: { slug: string; pageId: string; pageUrl: string; tab: SchemaTab | null; canWrite: boolean; reason: string; enabled: boolean; checksOut: string | null }) {
  const action = pageAction(slug, pageId, "schema");
  const off = !canWrite;
  return (
    <>
      {tab ? (
        <>
          <section aria-labelledby="schema-found" style={SECTION}>
            <h2 id="schema-found" style={H2}>
              Found
            </h2>
            {tab.found.length ? (
              <ul style={{ margin: 0, paddingLeft: "18px", display: "flex", flexDirection: "column", gap: "4px", fontSize: "14px", color: T.ink }}>
                {tab.found.map((f) => (
                  <li key={f.type}>{`${f.type}: ${f.where === "static" ? (f.microdata ? "in the page's HTML, as microdata" : "in the page's HTML") : "only after JavaScript runs"}`}</li>
                ))}
              </ul>
            ) : (
              <p style={{ margin: 0, fontSize: "14px", color: T.ink }}>No structured data in what we found on this page.</p>
            )}
            {tab.validator ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                <p style={{ margin: 0, fontSize: "14px", color: T.ink }}>{`The validator found ${tab.validator.errors} ${tab.validator.errors === 1 ? "error" : "errors"} and ${tab.validator.warnings} ${tab.validator.warnings === 1 ? "warning" : "warnings"} in the structured data we found.`}</p>
                {tab.validator.notes.length ? (
                  <ul style={{ margin: 0, paddingLeft: "18px", fontSize: "13px", color: T.ink, display: "flex", flexDirection: "column", gap: "2px" }}>
                    {tab.validator.notes.map((m, i) => (
                      <li key={i} className="yp-break">
                        {m}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
          </section>

          <section aria-labelledby="schema-checks" style={SECTION}>
            <h2 id="schema-checks" style={H2}>
              Our checks
            </h2>
            {tab.findings.length ? (
              tab.findings.map((f, i) => <Advice key={`${f.id}-${i}`} said={advice(f.id, f.vars)} id={`check-${i}`} />)
            ) : (
              <p style={{ margin: 0, fontSize: "14px", color: T.ink }}>Nothing to fix in the structured data we found.</p>
            )}
          </section>

          {tab.fix.length ? (
            <section aria-labelledby="schema-fix" style={SECTION}>
              <h2 id="schema-fix" style={H2}>
                The fix
              </h2>
              <Advice said={advice("pages.fix.found")} id="fix-found" />
              {tab.fix.map((b) => (
                <div key={b.type} id={`fix-${b.type}`} style={{ display: "flex", flexDirection: "column", gap: "10px", paddingTop: "8px", borderTop: `1px solid ${T.line}` }}>
                  <h3 style={H3}>{`${b.type} (${b.status === "new" ? "new" : `replaces the ${b.type} block on your page`})`}</h3>
                  {b.status === "update" ? (
                    <p style={{ margin: 0, fontSize: "13px", lineHeight: 1.5, color: T.ink }}>
                      {`Replace your ${b.type} block with this one, rather than adding it beside it: two ${b.type} blocks on one page conflict.${b.kept.length ? ` Like your block, it has ${list(b.kept)}.` : ""}${b.extra.length ? ` Your block also has ${list(b.extra)}, which this one doesn't: copy ${b.extra.length === 1 ? "it" : "them"} across before you replace it.` : ""}`}
                    </p>
                  ) : null}
                  <ul aria-label={`What the ${b.type} block has`} style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: "3px", fontSize: "13px", color: T.ink }}>
                    {diffLines(b).map((l, i) => (
                      <li key={i} className="yp-break">
                        <span aria-hidden="true" style={{ display: "inline-block", width: "16px", fontWeight: 700, color: l.mark === "+" ? T.goodFg : T.soft }}>
                          {l.mark === "+" ? "+" : "·"}
                        </span>
                        <span className="sr-only">{l.mark === "+" ? "Adds " : "Keeps "}</span>
                        {l.text}
                      </li>
                    ))}
                  </ul>
                  {!b.validates ? <Advice said={advice("pages.fix.placeholders")} id={`fix-ph-${b.type}`} /> : null}
                  <CopyBlock text={`<script type="application/ld+json">\n${b.json}\n</script>`} label={`The ${b.type} block`} usage="fix_copy" id={`fix-json-${b.type}`} />
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center" }}>
                    <a href={`https://search.google.com/test/rich-results?url=${encodeURIComponent(pageUrl)}`} target="_blank" rel="noopener noreferrer" style={{ ...BUTTON, display: "inline-flex", alignItems: "center", textDecoration: "none" }}>
                      Test in Google's Rich Results Test
                    </a>
                    <form method="post" action={pageAction(slug, pageId, "schema", null, { item: `schema:${b.type}` })} style={{ margin: 0 }}>
                      <button type="submit" name="do" value="act" disabled={off} aria-describedby={off ? "detail-reason" : undefined} style={{ ...BUTTON, ...(off ? OFF : {}) }}>
                        Add to Actions
                      </button>
                    </form>
                  </div>
                </div>
              ))}
              {enabled ? (
                <form method="post" action={action} style={{ margin: 0 }}>
                  <button type="submit" name="do" value="check" disabled={off || checksOut !== null} aria-describedby={off ? "detail-reason" : checksOut ? "checks-out" : undefined} style={{ ...BUTTON, ...(off || checksOut ? OFF : {}) }}>
                    Check this page again
                  </button>
                </form>
              ) : null}
              <details style={{ fontSize: "14px", color: T.ink }}>
                <summary style={{ cursor: "pointer", fontWeight: 600, minHeight: "44px", display: "flex", alignItems: "center" }}>How to add it</summary>
                <div style={{ display: "flex", flexDirection: "column", gap: "10px", paddingTop: "6px" }}>
                  {HOWTO.map((id) => (
                    <Advice key={id} said={advice(id)} id={id.replace(/\./g, "-")} />
                  ))}
                </div>
              </details>
            </section>
          ) : null}
        </>
      ) : null}

      <section aria-labelledby="schema-evidence" style={{ ...SECTION, background: T.wash, border: `1px solid ${T.washLine}` }}>
        <h2 id="schema-evidence" style={H2}>
          What Google's own pages say
        </h2>
        {EVIDENCE.map((id) => (
          <Advice key={id} said={advice(id)} id={id.replace(/\./g, "-")} />
        ))}
        <p style={SMALL}>Structured data describes your page. None of it is a promise of a result.</p>
      </section>
    </>
  );
}
