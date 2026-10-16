import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { postBySlug } from "@/config/posts";
import { hubPost, publishedHubPosts } from "@/lib/hub-posts";

import HubPostPage, { hubPostMetadata } from "./post";

/**
 * A post published from the agency hub's CMS (`lib/hub-posts.ts`, 16 Oct 2026).
 *
 * The four hand-written posts are static folders beside this one and win over
 * it. A hub post whose slug one of them already uses is never served here, so
 * a slug clash cannot put two pages at one URL.
 *
 * ISR, like `/case-studies/[id]`: a post published on the hub is here within
 * `HUB_BLOG_REVALIDATE` seconds without a deploy; one taken down 404s on the
 * next re-read. The draft preview the hub links to (`?preview=<key>`) is
 * rewritten by `proxy.ts` to `/blog-preview/[slug]/[key]`, so this page never reads its
 * query and stays static.
 */

export const revalidate = 300;
export const dynamicParams = true;

export async function generateStaticParams() {
  return (await publishedHubPosts()).filter((p) => !postBySlug(p.slug)).map((p) => ({ slug: p.slug }));
}

async function find(slug: string) {
  return postBySlug(slug) ? null : hubPost(slug);
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const p = await find((await params).slug);
  // No robots tag here: an unknown slug renders not-found, which carries its own.
  return p ? hubPostMetadata(p) : { title: "Post not found" };
}

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const p = await find((await params).slug);
  if (!p) notFound();
  return <HubPostPage post={p} />;
}
