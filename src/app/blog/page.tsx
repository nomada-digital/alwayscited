import type { Metadata } from "next";
import { OG_IMAGE } from "@/config/og";
import Link from "next/link";

import { formatPostDate, postBySlug, POSTS } from "@/config/posts";
import { CARD, MICRO, SHELL, T } from "@/config/tokens";
import { ORG_REF, ld } from "@/config/schema";
import { listed, publishedHubPosts } from "@/lib/hub-posts";

/**
 * The writing index, from BlogIndex.dc.html.
 *
 * Two things on the board are not built. The filter pills are real - they
 * filter - but only the kinds that have a post in them are shown, because a
 * pill that leads to an empty page is a worse answer than no pill. And the
 * lead post card has no metric cells: the board fills them with [METRIC
 * LABEL] and [N], and none of these pieces carries a figure of its own.
 * Inventing two would be inventing a finding.
 */

export const metadata: Metadata = {
  title: "What we have actually found",
  description:
    "Written for people who run agencies, not for search engines. Every number says where it came from and when it was taken.",
  alternates: { canonical: "https://alwayscited.com/blog" },
  openGraph: {
    images: OG_IMAGE,
    title: "What we have actually found | alwayscited",
    description: "Written for people who run agencies, not for search engines.",
    url: "https://alwayscited.com/blog",
  },
};

const blogSchema = {
  "@context": "https://schema.org",
  "@type": "Blog",
  name: "alwayscited",
  description: "Notes on AI search, written for people who run agencies.",
  url: "https://alwayscited.com/blog",
  publisher: ORG_REF,
};

function pill(active: boolean): React.CSSProperties {
  return {
    background: active ? T.surface : "transparent",
    border: "1px solid " + (active ? T.line : "transparent"),
    color: active ? T.ink : T.soft,
    fontSize: "14px",
    fontWeight: 600,
    padding: "8px 15px",
    borderRadius: "999px",
    textDecoration: "none",
    // `transform` does not apply to a non-replaced inline element, and a
    // `Link` is an `<a>`. These pills sit in a flex container, which blockifies
    // its items and would make the lift work anyway - this is stated rather
    // than relied on, so that moving them out of the flex row cannot silently
    // cost them the transform and leave only the opacity leg.
    display: "inline-block",
  };
}

export default async function BlogIndexPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string }>;
}) {
  const { kind } = await searchParams;
  // The registered posts and the ones published from the agency hub (lib/hub-posts.ts, 16 Oct 2026), newest
  // first; a stable sort keeps the registry's order on a tie, and a hub slug a registered post already uses is
  // that post's, not a second card.
  const hub = (await publishedHubPosts()).filter((p) => !postBySlug(p.slug)).map(listed);
  const posts = [...POSTS, ...hub].sort((a, b) => b.date.localeCompare(a.date));
  const kinds = Array.from(new Set(posts.map((p) => p.kind)));
  const active = kinds.find((k) => k === kind) ?? null;
  const shown = active ? posts.filter((p) => p.kind === active) : posts;
  const lead = shown[0];
  const rest = shown.slice(1);

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: ld(blogSchema) }} />

      <section style={{ ...SHELL, paddingTop: "44px", display: "flex", flexDirection: "column", gap: "26px" }}>
        {/* The beat. `/blog` was the one linked, indexed content page serving
            the motion script and `data-motion="on"` with nothing to animate -
            a third zero beside `_global-error` and `_not-found`, both of which
            are expected and this is not. It fell through both earlier sweeps
            because `PostShell` covers the three posts rather than the index,
            and the index is not on the ten-page list in `3c42983`.

            Additive class names only: no new rule, no keyframe, no class.
            Leaf content rather than the wrappers, so nothing nests - the
            `rest` card and the pill row stay bare and their children carry the
            class. Five groups of 2, 1, 3, 1 and 2 against a cap of nine. */}
        <div className="board-head confirm-head">
          <div>
            <div className="ac-row" style={MICRO}>Writing</div>
            <h1
              className="ac-row"
              style={{
                margin: "8px 0 0",
                fontSize: "27px",
                fontWeight: 700,
                letterSpacing: "-0.03em",
                color: T.ink,
              }}
            >
              What we have actually found
            </h1>
          </div>
          <p className="ac-row" style={{ margin: 0, fontSize: "14px", lineHeight: 1.6, color: T.soft }}>
            Written for people who run agencies, not for search engines. Every number says where it came from and
            when it was taken. No explainers on what an AI Overview is.
          </p>
        </div>

        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
          <Link className="ac-row blog-pill" href="/blog" style={pill(!active)}>
            All
          </Link>
          {kinds.map((k) => (
            <Link className="ac-row blog-pill" key={k} href={"/blog?kind=" + encodeURIComponent(k)} style={pill(active === k)}>
              {k}
            </Link>
          ))}
        </div>

        {lead ? (
          <Link
            className="ac-row"
            href={"/blog/" + lead.slug}
            style={{ ...CARD, display: "block", padding: "28px 30px", textDecoration: "none" }}
          >
            <div style={{ ...MICRO, color: T.accent }}>{lead.kind}</div>
            <h2
              style={{
                margin: "10px 0 0",
                fontSize: "25px",
                fontWeight: 700,
                letterSpacing: "-0.03em",
                lineHeight: 1.22,
                color: T.ink,
                maxWidth: "24ch",
              }}
            >
              {lead.title}
            </h2>
            <p style={{ margin: "10px 0 0", fontSize: "14.5px", lineHeight: 1.6, color: T.soft, maxWidth: "70ch" }}>
              {lead.blurb}
            </p>
            <div style={{ marginTop: "14px", fontSize: "13px", color: T.soft }}>
              {formatPostDate(lead.date) + " - " + lead.readMinutes + " min read"}
            </div>
          </Link>
        ) : null}

        {rest.length ? (
          <div style={{ ...CARD, overflow: "hidden" }}>
            {rest.map((post) => (
              <Link
                key={post.slug}
                href={"/blog/" + post.slug}
                className="post-row ac-row"
                style={{ borderTop: "1px solid " + T.hair, textDecoration: "none" }}
              >
                <div style={MICRO}>{post.kind}</div>
                <div>
                  <div
                    style={{
                      fontSize: "16px",
                      fontWeight: 600,
                      letterSpacing: "-0.022em",
                      color: T.ink,
                      lineHeight: 1.35,
                    }}
                  >
                    {post.title}
                  </div>
                  <div style={{ fontSize: "13.5px", lineHeight: 1.55, color: T.soft, marginTop: "4px" }}>
                    {post.blurb}
                  </div>
                </div>
                <div style={{ textAlign: "right", fontSize: "13px", color: T.soft }}>
                  {formatPostDate(post.date) + " - " + post.readMinutes + " min"}
                </div>
              </Link>
            ))}
          </div>
        ) : null}
      </section>
    </>
  );
}
