import Link from "@/components/app/AppLink";

import { T } from "@/config/tokens";
import type { ChangeLink, Diff } from "@/lib/diy/changes/diff";

/**
 * "Since last check" (13 Oct 2026, DIY P4; spec 10 sections 4.1 row 5 and
 * 6.8): up to eight lines a rule wrote over the last week of checks, most
 * important first, each opening its evidence; the rest as a count in plain
 * words, since the full list is the Answers explorer, which is not built. A
 * line whose evidence has no page yet (a keyword, until the Google page) is
 * plain text. A failed read says so and never reads as "no changes".
 *
 * Review of P4 (13 Oct 2026): a line grouped per engine ("Gemini stopped
 * naming you for 8 prompts") lists its prompts under a native <details>, each
 * opening the answer that shows its change - two clicks, with JS off too. It
 * linked to /ai?eng=, which cannot say which prompts changed. And "Changes
 * start from your second check" is only for a client whose checks began this
 * week; one checked before it with few checks this week reads as a quiet week.
 */
const say = (n: number) => (n === 0 ? "No check" : n === 1 ? "Only one check" : "Only two checks");

export default function SinceLastCheck({ diff, href }: { diff: Diff | { error: true }; href: (link: ChangeLink) => string | null }) {
  return (
    <section aria-labelledby="slc-h" style={{ background: T.surface, border: `1px solid ${T.line}`, borderRadius: "18px", padding: "22px 24px", display: "flex", flexDirection: "column", gap: "12px", minWidth: 0 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
        <h2 id="slc-h" style={{ margin: 0, fontSize: "19px", fontWeight: 700, letterSpacing: "-0.022em", color: T.ink }}>
          Since last check
        </h2>
        <p style={{ margin: 0, fontSize: "13px", lineHeight: 1.5, color: T.soft }}>What changed over the last week of checks and held for two of them in a row.</p>
      </div>
      {"error" in diff ? (
        <p style={{ margin: 0, fontSize: "14px", lineHeight: 1.5, color: T.ink }}>We couldn&apos;t read this part just now. The rest of the page is up to date.</p>
      ) : diff.state === "early" ? (
        <p data-since-state="early" style={{ margin: 0, fontSize: "14px", lineHeight: 1.5, color: T.ink }}>Changes start from your second check.</p>
      ) : diff.state === "quiet" ? (
        <p data-since-state="quiet" style={{ margin: 0, fontSize: "14px", lineHeight: 1.5, color: T.ink }}>{`${say(diff.days)} in the last week, so nothing has held for two checks in a row.`}</p>
      ) : !diff.lines.length ? (
        <p style={{ margin: 0, fontSize: "14px", lineHeight: 1.5, color: T.ink }}>{`Nothing changed that held for two checks in a row over the last ${diff.days} checks.`}</p>
      ) : (
        <>
          <ul data-since="" style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column" }}>
            {diff.lines.map((l, i) => {
              const to = l.link ? href(l.link) : null;
              const items = (l.items ?? []).map((it) => ({ text: it.text, to: href(it.link) }));
              return (
                <li key={i} data-kind={l.kind} style={{ display: "flex", gap: "10px", alignItems: "baseline", padding: "10px 0", borderTop: i ? `1px solid ${T.hair}` : undefined, fontSize: "14px", lineHeight: 1.5, color: T.ink }}>
                  <span aria-hidden="true" style={{ flexShrink: 0, width: "6px", height: "6px", borderRadius: "50%", background: l.kind === "lost" || l.kind === "left_page1" || l.kind === "check" ? T.badFg : l.kind === "won" || l.kind === "entered_page1" ? T.goodFg : T.faint, alignSelf: items.length ? "flex-start" : "center", marginTop: items.length ? "8px" : undefined }} />
                  <span style={{ minWidth: 0, overflowWrap: "anywhere", display: "flex", flexDirection: "column", gap: "4px" }}>
                    {to ? (
                      <Link href={to} style={{ color: T.ink, textDecorationColor: T.faint, textUnderlineOffset: "3px" }}>
                        {l.text}
                      </Link>
                    ) : (
                      <span>{l.text}</span>
                    )}
                    {items.length ? (
                      <details data-since-items="">
                        <summary style={{ cursor: "pointer", fontSize: "13px", fontWeight: 600, color: T.accent, minHeight: "24px" }}>{`Show the ${items.length} prompts`}</summary>
                        <ul style={{ listStyle: "none", margin: "6px 0 0", padding: 0, display: "flex", flexDirection: "column", gap: "6px" }}>
                          {items.map((it, j) => (
                            <li key={j} style={{ fontSize: "13px", lineHeight: 1.45 }}>
                              {it.to ? (
                                <Link href={it.to} style={{ color: T.ink, textDecorationColor: T.faint, textUnderlineOffset: "3px" }}>
                                  {it.text}
                                </Link>
                              ) : (
                                it.text
                              )}
                            </li>
                          ))}
                        </ul>
                      </details>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ul>
          {diff.more ? <p style={{ margin: 0, fontSize: "13px", color: T.soft }}>{`${diff.more} more ${diff.more === 1 ? "change" : "changes"}.`}</p> : null}
        </>
      )}
    </section>
  );
}
