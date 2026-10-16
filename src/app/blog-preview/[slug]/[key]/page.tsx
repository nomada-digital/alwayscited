import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { hubPreview } from "@/lib/hub-posts";

import HubPostPage, { hubPostMetadata } from "@/app/blog/[slug]/post";

/**
 * A hub post before it is live, read by its preview key (16 Oct 2026).
 *
 * The hub links a draft as `/blog/<slug>?preview=<key>`; `proxy.ts` rewrites
 * that here, so the live route stays static. Its own prefix so robots.txt and
 * the x-robots-tag header close it the way they close /scan/ (next.config.ts, robots.ts). Read on every request, never
 * cached, noindex, and a wrong key or slug is a 404 - the key is the only
 * thing standing between a draft and the public, and only the hub can read it.
 */

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string; key: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug, key } = await params;
  const p = await hubPreview(slug, key);
  return p ? hubPostMetadata(p, true) : { title: "Post not found", robots: { index: false, follow: false } };
}

export default async function Preview({ params }: Params) {
  const { slug, key } = await params;
  const p = await hubPreview(slug, key);
  if (!p) notFound();
  return <HubPostPage post={p} />;
}
