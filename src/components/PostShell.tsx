import Link from "next/link";
import { Children, isValidElement, type ReactNode } from "react";

import { formatPostDate, type Post } from "@/config/posts";
import { CARD, MICRO, SHELL, T } from "@/config/tokens";
import BlogScanCta from "@/components/BlogScanCta";
import { earlyCtaAt, isListicle } from "@/lib/hub-post-blocks";
import { blogRef } from "@/lib/scan/handoff";

/**
 * A post, from BlogPost.dc.html: the article on eight columns, the aside on
 * four, with a contents list built from the post's own headings. The free scan
 * is in the body (BlogScanCta, 1 Nov 2026): early and at the end. The aside's
 * own "Run it yourself" field went then - under 860px the aside drops below the
 * article, which stacked it under the end box, two domain fields in a row.
 *
 * The board's callout - two big figures above the body - is not built. None
 * of the three pieces on the site carries a measured figure of its own, and a
 * callout filled with numbers nobody read is the exact thing the rules on the
 * About page exist to stop.
 */

export const H2 = ({ id, children }: { id?: string; children: React.ReactNode }) => (
  <h2
    id={id}
    style={{
      margin: "30px 0 0",
      fontSize: "19px",
      fontWeight: 700,
      letterSpacing: "-0.022em",
      color: T.ink,
      scrollMarginTop: "5rem",
    }}
  >
    {children}
  </h2>
);

export const BODY: React.CSSProperties = { fontSize: "16px", lineHeight: 1.75, color: "#3f4451" };

export const P = ({ children }: { children: React.ReactNode }) => (
  <p style={{ margin: "10px 0 0", ...BODY }}>{children}</p>
);

/** Lists in the body, set like P so the body colour is written once. */
export const UL = ({ children }: { children: React.ReactNode }) => (
  <ul style={{ margin: "10px 0 0", paddingLeft: "20px", listStyle: "disc", ...BODY }}>{children}</ul>
);
export const OL = ({ children }: { children: React.ReactNode }) => (
  <ol style={{ margin: "10px 0 0", paddingLeft: "22px", listStyle: "decimal", ...BODY }}>{children}</ol>
);

export const Quote = ({ children }: { children: React.ReactNode }) => (
  <blockquote style={{ margin: "26px 0 0", padding: "0 0 0 20px", borderLeft: "2px solid " + T.accent }}>
    <p style={{ margin: 0, fontSize: "17px", lineHeight: 1.6, color: T.ink, fontWeight: 500 }}>{children}</p>
  </blockquote>
);

export const Method = ({ children }: { children: React.ReactNode }) => (
  <p
    style={{
      margin: "26px 0 0",
      paddingTop: "14px",
      borderTop: "1px solid " + T.line,
      fontSize: "13px",
      lineHeight: 1.6,
      color: T.soft,
    }}
  >
    {children}
  </p>
);

/** Text of a hand-written heading's children, for earlyCtaAt ("1. " stays even when the rest is a component). */
const textOf = (n: ReactNode): string =>
  typeof n === "string" || typeof n === "number" ? String(n)
  : Array.isArray(n) ? n.map(textOf).join("")
  : isValidElement<{ children?: ReactNode }>(n) ? textOf(n.props.children) : "";

/**
 * A hand-written body with its early free scan box placed by the hub posts' rule (earlyCtaAt): before a listicle's
 * first ranked entry, else before the second section (or a numbered list that starts sooner). The shell adds the end one.
 */
function withEarlyCta(children: ReactNode, slug: string, title: string): ReactNode[] {
  const items = Children.toArray(children);
  const heads = items.flatMap((c, at) =>
    isValidElement<{ children?: ReactNode }>(c) && c.type === H2 ? [{ at, level: 2, text: textOf(c.props.children) }] : []);
  const early = earlyCtaAt(heads, items.length, isListicle(title));
  if (early < 0) return items;
  return [...items.slice(0, early), <BlogScanCta key="scan-early" scanRef={blogRef(slug)} slug={slug} />, ...items.slice(early)];
}

/** The post's own headings as links - the aside's card, and the top of a narrow page. */
function Contents({
  sections,
  gap = "10px",
  margin = "12px 0 0",
}: {
  sections: { id: string; label: string }[];
  gap?: string;
  margin?: string;
}) {
  return (
    <ul
      style={{
        margin,
        padding: 0,
        listStyle: "none",
        display: "flex",
        flexDirection: "column",
        gap,
      }}
    >
      {sections.map((s) => (
        <li key={s.id}>
          <a href={"#" + s.id} style={{ fontSize: "14px", textDecoration: "none", color: T.soft }}>
            {s.label}
          </a>
        </li>
      ))}
    </ul>
  );
}

export default function PostShell(p: {
  // A registered post, or one from the hub (lib/hub-posts.ts), whose kind can be one this registry does not list yet.
  post: Pick<Post, "title" | "date" | "readMinutes"> & { kind: string; slug?: string };
  /** The body places its own scan boxes (a hub post, HubPostBody); otherwise the shell adds one after the body. */
  bodyCta?: boolean;
  standfirst: string;
  sections: { id: string; label: string }[];
  children: React.ReactNode;
}) {
  const meta = formatPostDate(p.post.date) + " - " + p.post.readMinutes + " min read";
  return (
    <div className="post-shell" style={{ ...SHELL, paddingTop: "40px" }}>
      {/* The beat is on the header block and the two aside cards, and
          deliberately not on the body: `p.children` is the argument, and prose
          that arrives a paragraph at a time is the sparkle globals.css already
          declined for the chart tables. The body div carries no `.ac-row`, so
          it also takes no index and the five header rows stay contiguous. */}
      <article>
        <Link
          className="ac-row"
          href="/blog"
          style={{ display: "block", fontSize: "13px", fontWeight: 600, textDecoration: "none", color: T.accent }}
        >
          Back to writing
        </Link>

        <div className="ac-row" style={{ ...MICRO, marginTop: "20px" }}>{p.post.kind}</div>
        <h1
          className="ac-row"
          style={{
            margin: "10px 0 0",
            fontSize: "34px",
            fontWeight: 700,
            letterSpacing: "-0.03em",
            lineHeight: 1.18,
            color: T.ink,
          }}
        >
          {p.post.title}
        </h1>
        <p
          className="ac-row"
          style={{ margin: "14px 0 0", fontSize: "16px", lineHeight: 1.6, color: T.soft, maxWidth: "68ch" }}
        >
          {p.standfirst}
        </p>

        <div
          className="ac-row"
          style={{
            marginTop: "18px",
            paddingTop: "14px",
            borderTop: "1px solid " + T.line,
            display: "flex",
            gap: "14px",
            alignItems: "center",
            fontSize: "13px",
            color: T.soft,
            flexWrap: "wrap",
          }}
        >
          <span>{meta}</span>
        </div>

        {/* Below 860px the aside drops under the article, which put this list
            after the last paragraph - 5,000px down on the longest post, where
            it can no longer take anyone anywhere (R151, 3 Oct 2026). On a
            narrow page it sits here instead, folded so the body still starts
            on the first screen; <details> opens without script. */}
        {p.sections.length ? (
          <details className="post-toc-top" style={{ ...CARD, marginTop: "18px", padding: "0 18px" }}>
            {/* globals.css hides every <summary> marker, so the fold says it
                opens in words, as the FAQ's hint column does. */}
            <summary style={{ ...MICRO, cursor: "pointer", lineHeight: "44px", display: "flex", justifyContent: "space-between" }}>
              <span>On this page</span>
              <span className="post-toc-show" style={{ color: T.accent }}>Show {p.sections.length}</span>
              <span className="post-toc-hide" style={{ color: T.accent }}>Hide</span>
            </summary>
            {/* Each link a 44px row from globals.css, so no gap between them. */}
            <Contents sections={p.sections} gap="0" margin="0 0 8px" />
          </details>
        ) : null}

        <div style={{ marginTop: "26px", maxWidth: "68ch" }}>
          {p.post.slug && !p.bodyCta ? withEarlyCta(p.children, p.post.slug, p.post.title) : p.children}
          {/* the free scan's second box, at the end (a hub post's body places both itself) */}
          {p.post.slug && !p.bodyCta ? <BlogScanCta scanRef={blogRef(p.post.slug)} slug={p.post.slug} /> : null}
        </div>
      </article>

      <aside style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
        {p.sections.length ? (
          <div className="ac-row post-toc-side" style={{ ...CARD, padding: "22px" }}>
            <div style={MICRO}>On this page</div>
            <Contents sections={p.sections} />
          </div>
        ) : null}
      </aside>
    </div>
  );
}
