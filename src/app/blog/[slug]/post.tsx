import type { Metadata } from "next";

import HubPostBody, { blocks } from "@/components/HubPostBody";
import PostShell from "@/components/PostShell";
import { OG_IMAGE } from "@/config/og";
import { BRAND, ORG_REF, SITE_URL, ld } from "@/config/schema";
import { listed, type HubPost } from "@/lib/hub-posts";

/**
 * A hub post, shared by the live route (`page.tsx`) and its preview
 * (`app/blog-preview/[slug]/[key]/page.tsx`), so the draft a publisher checks is the page that
 * goes live.
 *
 * Metadata and structured data follow `postMetadata` and `blogPostingSchema`
 * in `config/posts.ts`: the canonical, the Open Graph url and the node's url
 * are one URL built from the slug, and the node's description is the meta
 * description, not a second copy (`post-description.test.mts`). The share
 * description is the excerpt, as the hub's editor promises.
 */

export const hubPostUrl = (slug: string) => SITE_URL + "/blog/" + slug;

/** The meta description: the one written for it, else the excerpt. */
const description = (p: HubPost) => p.metaDescription ?? p.excerpt;

export function hubPostMetadata(p: HubPost, preview = false): Metadata {
  return {
    title: p.metaTitle ?? p.title,
    description: description(p),
    alternates: { canonical: hubPostUrl(p.slug) },
    openGraph: { images: OG_IMAGE, title: p.title + " | " + BRAND, description: p.excerpt || description(p), url: hubPostUrl(p.slug) },
    // A draft read by its preview key is never offered to a search engine.
    ...(preview ? { robots: { index: false, follow: false } } : {}),
  };
}

export function hubPostSchema(p: HubPost) {
  const node = {
    "@context": "https://schema.org",
    "@type": p.schemaType,
    headline: p.title,
    description: description(p),
    url: hubPostUrl(p.slug),
    datePublished: p.date,
    ...(p.updated ? { dateModified: p.updated } : {}),
    author: ORG_REF,
    publisher: ORG_REF,
  };
  if (!p.faqs?.length) return [node];
  return [
    node,
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      url: hubPostUrl(p.slug),
      mainEntity: p.faqs.map((f) => ({ "@type": "Question", name: f.question, acceptedAnswer: { "@type": "Answer", text: f.answer } })),
    },
  ];
}

export default function HubPostPage({ post }: { post: HubPost }) {
  const { sections } = blocks(post.content);
  const all = post.faqs?.length ? [...sections, { id: "questions", label: "Questions" }] : sections;
  return (
    <>
      {hubPostSchema(post).map((n, i) => (
        <script key={i} type="application/ld+json" dangerouslySetInnerHTML={{ __html: ld(n) }} />
      ))}
      <PostShell post={listed(post)} standfirst={post.standfirst ?? post.excerpt} sections={all}>
        <HubPostBody post={post} />
      </PostShell>
    </>
  );
}
