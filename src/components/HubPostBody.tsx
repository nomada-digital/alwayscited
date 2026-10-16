import Image from "next/image";
import Link from "next/link";

import { BODY, H2, OL, P, Quote, UL } from "@/components/PostShell";
import { CARD, MICRO, T } from "@/config/tokens";
import { blocks } from "@/lib/hub-post-blocks";
import { hubImage, type HubPost } from "@/lib/hub-posts";

export { blocks };

/**
 * The body of a post written on the agency hub (`lib/hub-posts.ts`).
 *
 * The hub stores plain text: `## ` and `### ` headings, paragraphs split by a
 * blank line, `- ` and `1. ` lists, `> ` quotes, `**bold**`, `[text](url)`
 * links, and four directive lines - `[[toc]]`, `[[faqs]]`, `[[figure]]`,
 * `[[cta]]` - that place the post's structured parts. It is parsed here into
 * the same components the hand-written posts use, never into raw HTML, so
 * nothing in a post can inject markup. `[[toc]]` places nothing: PostShell
 * already builds the contents list from the headings, on every width.
 */

/** `**bold**` and `[text](url)`; anything else is text. Only site-relative, anchor and https links become links. */
export function inline(text: string, key = "i"): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let at = 0;
  let n = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > at) out.push(text.slice(at, m.index));
    if (m[1] !== undefined) {
      out.push(<strong key={`${key}-${n++}`}>{m[1]}</strong>);
    } else {
      const label = m[2]!;
      const href = m[3]!.replace(/^https:\/\/(www\.)?alwayscited\.com(?=\/|$)/, "") || "/";
      if (href.startsWith("/") || href.startsWith("#")) {
        out.push(<Link key={`${key}-${n++}`} href={href} style={{ color: T.accent }}>{label}</Link>);
      } else if (/^https:\/\//.test(href)) {
        out.push(<a key={`${key}-${n++}`} href={href} rel="noopener" style={{ color: T.accent }}>{label}</a>);
      } else {
        out.push(label);
      }
    }
    at = m.index + m[0].length;
  }
  if (at < text.length) out.push(text.slice(at));
  return out;
}

const H3 = ({ id, children }: { id: string; children: React.ReactNode }) => (
  <h3 id={id} style={{ margin: "22px 0 0", fontSize: "16px", fontWeight: 700, letterSpacing: "-0.02em", color: T.ink, scrollMarginTop: "5rem" }}>
    {children}
  </h3>
);

function Faqs({ post }: { post: HubPost }) {
  if (!post.faqs?.length) return null;
  return (
    <>
      <H2 id="questions">Questions</H2>
      <dl style={{ margin: "10px 0 0" }}>
        {post.faqs.map((f, i) => (
          <div key={i} style={{ marginTop: i ? "16px" : 0 }}>
            <dt style={{ fontSize: "16px", fontWeight: 600, color: T.ink }}>{f.question}</dt>
            <dd style={{ margin: "6px 0 0", ...BODY }}>{inline(f.answer, `f${i}`)}</dd>
          </div>
        ))}
      </dl>
    </>
  );
}

function Figure({ post }: { post: HubPost }) {
  const f = post.figure;
  const src = hubImage(f?.src);
  if (!f || !src) return null;
  return (
    <figure style={{ margin: "26px 0 0" }}>
      <Image src={src} alt={f.alt} width={f.width} height={f.height} style={{ width: "100%", height: "auto", borderRadius: "12px" }} />
      {f.caption ? <figcaption style={{ marginTop: "8px", fontSize: "13px", color: T.soft }}>{f.caption}</figcaption> : null}
    </figure>
  );
}

function Cta({ post }: { post: HubPost }) {
  return (
    <div style={{ ...CARD, margin: "26px 0 0", padding: "22px 24px" }}>
      <div style={MICRO}>Free scan</div>
      <p style={{ margin: "8px 0 0", fontSize: "17px", fontWeight: 600, color: T.ink }}>
        {post.ctaHeading ?? "See which AI answers name you, and which name someone else."}
      </p>
      <Link href="/#scan" style={{ display: "inline-block", marginTop: "10px", fontSize: "14px", fontWeight: 600, color: T.accent }}>
        Run the free scan
      </Link>
    </div>
  );
}

export default function HubPostBody({ post }: { post: HubPost }) {
  const { blocks: bs } = blocks(post.content);
  const placed = new Set(bs.map((b) => b.k));
  const hero = hubImage(post.image);
  return (
    <>
      {hero ? (
        <Image src={hero} alt={post.imageAlt ?? ""} width={1200} height={630} priority
          style={{ width: "100%", height: "auto", borderRadius: "12px", marginBottom: "16px" }} />
      ) : null}
      {bs.map((b, i) => {
        switch (b.k) {
          case "h2": return <H2 key={i} id={b.id}>{inline(b.text, `b${i}`)}</H2>;
          case "h3": return <H3 key={i} id={b.id}>{inline(b.text, `b${i}`)}</H3>;
          case "p": return <P key={i}>{inline(b.text, `b${i}`)}</P>;
          case "quote": return <Quote key={i}>{inline(b.text, `b${i}`)}</Quote>;
          case "ul": return <UL key={i}>{b.items.map((t, j) => <li key={j}>{inline(t, `b${i}-${j}`)}</li>)}</UL>;
          case "ol": return <OL key={i}>{b.items.map((t, j) => <li key={j}>{inline(t, `b${i}-${j}`)}</li>)}</OL>;
          case "faqs": return <Faqs key={i} post={post} />;
          case "figure": return <Figure key={i} post={post} />;
          case "cta": return <Cta key={i} post={post} />;
          default: return null;
        }
      })}
      {/* A post whose body never placed its FAQs still shows them, last. */}
      {!placed.has("faqs") ? <Faqs post={post} /> : null}
    </>
  );
}
