import { T } from "@/config/tokens";
import { EXAMPLES, ILLUSTRATIVE } from "@/lib/diy/pages/examples-library";
import { advice } from "@/lib/diy/pages/words";

import CopyBlock from "./CopyBlock";
import { Advice, H2, H3, SECTION, SMALL } from "./parts";

/**
 * The schema examples library (13 Oct 2026, DIY P8; spec 10 section 4.9,
 * Examples view): static, dated, made-up brands. Each type's requirement is
 * an advice line with its grade and dated source; then a good block to copy,
 * and a bad one with what is wrong with it. FAQPage and HowTo carry their
 * dated "no rich result" lines. A pair whose requirement fails the register
 * does not draw (SoftwareApplication is not in the library until Google's
 * own page is read).
 */
export default function ExamplesLibrary() {
  const pairs = EXAMPLES.map((e) => ({ e, said: advice(e.adviceId) })).filter((x) => x.said !== null);
  return (
    <>
      <section aria-labelledby="ex-title" style={SECTION}>
        <h2 id="ex-title" style={H2}>
          Schema examples
        </h2>
        <p style={SMALL}>{ILLUSTRATIVE}</p>
        <nav aria-label="Types" style={{ display: "flex", flexWrap: "wrap", gap: "8px 14px" }}>
          {pairs.map(({ e }) => (
            <a key={e.id} href={`#ex-${e.id}`} style={{ color: T.accent, fontWeight: 600, textDecoration: "none", fontSize: "14px", minHeight: "44px", display: "inline-flex", alignItems: "center" }}>
              {e.type}
            </a>
          ))}
        </nav>
      </section>
      {pairs.map(({ e, said }) => (
        <section key={e.id} id={`ex-${e.id}`} aria-labelledby={`ex-${e.id}-h`} style={SECTION}>
          <h2 id={`ex-${e.id}-h`} style={H2}>
            {e.type}
          </h2>
          <Advice said={said} id={`ex-${e.id}-adv`} />
          <h3 style={H3}>{e.bad ? "Good" : "Example"}</h3>
          <CopyBlock text={`<script type="application/ld+json">\n${JSON.stringify(e.good, null, 2)}\n</script>`} label={`A good ${e.type} block`} usage="fix_copy" id={`ex-${e.id}-good`} />
          {e.bad ? (
            <>
              <h3 style={H3}>Not like this</h3>
              <pre className="yp-code" tabIndex={0} aria-label={`A ${e.type} block with mistakes`} style={{ background: T.surface, color: T.ink, border: `1px dashed ${T.line}` }}>
                <code>{JSON.stringify(e.bad, null, 2)}</code>
              </pre>
              <p style={{ margin: 0, fontSize: "14px", lineHeight: 1.5, color: T.ink }}>{e.badWhy}</p>
            </>
          ) : null}
        </section>
      ))}
    </>
  );
}
