import { z } from "zod";

import type { Post, PostKind } from "../config/posts.ts";

/**
 * Blog posts published from the Nomada agency hub's CMS (16 Oct 2026).
 *
 * The four hand-written posts in `config/posts.ts` stay exactly as they are,
 * each in its own folder. A post written on the hub - drafted, approved by its
 * author and put live by a publisher there, leak-checked by the database at
 * the moment of publishing - reaches this site through a public edge function
 * on the nomada-dashboards Supabase project, the same way the case studies do
 * (`lib/case-studies.ts`): no key here, and the table is closed to anon. The
 * hub's workflow lives in nomada-dashboards `ops/blog/README.md`.
 *
 * Never fatal: a feed that fails to load - or answers 400, as it does for this
 * site until the function knows it - means no hub posts, and ISR keeps serving
 * the last good render until it answers again.
 */
export const HUB_BLOG_FEED = "https://qpsrvmnmtozvailsyqqz.supabase.co/functions/v1/blog?site=alwayscited.com";

/** Seconds between re-reads of the feed. A post goes live within this of being published. */
export const HUB_BLOG_REVALIDATE = 300;

/** Where the hub keeps a post's images. The only remote images the site shows (next.config.ts `images`). */
export const HUB_IMAGE_ROOT = "https://qpsrvmnmtozvailsyqqz.supabase.co/storage/v1/object/public/blog-images/";

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const PREVIEW_KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const HubPost = z.object({
  slug: z.string().regex(SLUG),
  title: z.string().min(1),
  excerpt: z.string().default(""),
  author: z.string().optional(),
  authorRole: z.string().optional(),
  date: z.string().regex(DAY),
  updated: z.string().regex(DAY).optional(),
  readTime: z.number().int().positive().default(1),
  category: z.string().optional(),
  content: z.string(),
  standfirst: z.string().optional(),
  ctaHeading: z.string().optional(),
  image: z.string().optional(),
  imageAlt: z.string().optional(),
  metaTitle: z.string().optional(),
  metaDescription: z.string().optional(),
  schemaType: z.enum(["BlogPosting", "Article", "NewsArticle"]).default("BlogPosting"),
  faqs: z.array(z.object({ question: z.string(), answer: z.string() })).optional(),
  figure: z.object({ src: z.string(), alt: z.string(), width: z.number(), height: z.number(), caption: z.string().optional() }).optional(),
  itemList: z.object({ items: z.array(z.unknown()) }).optional(),
});
export type HubPost = z.infer<typeof HubPost>;

function parse(rows: unknown[] | undefined): HubPost[] {
  // One malformed post is dropped rather than taking the others down with it.
  return (rows ?? []).flatMap((x) => {
    const r = HubPost.safeParse(x);
    return r.success ? [r.data] : [];
  });
}

export async function publishedHubPosts(): Promise<HubPost[]> {
  try {
    const res = await fetch(HUB_BLOG_FEED, { next: { revalidate: HUB_BLOG_REVALIDATE } });
    if (!res.ok) return [];
    const body = (await res.json()) as { posts?: unknown[] };
    return parse(body.posts);
  } catch {
    return [];
  }
}

export async function hubPost(slug: string): Promise<HubPost | null> {
  return (await publishedHubPosts()).find((p) => p.slug === slug) ?? null;
}

/** One unpublished post by its preview key, never cached. A wrong key or slug is null. */
export async function hubPreview(slug: string, key: string): Promise<HubPost | null> {
  if (!SLUG.test(slug) || !PREVIEW_KEY.test(key)) return null;
  try {
    const url = `${HUB_BLOG_FEED}&slug=${encodeURIComponent(slug)}&preview=${encodeURIComponent(key)}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    return parse([((await res.json()) as { post?: unknown }).post])[0] ?? null;
  } catch {
    return null;
  }
}

export const isPreviewKey = (k: string | null | undefined): k is string => !!k && PREVIEW_KEY.test(k);

const KINDS: PostKind[] = ["Findings", "Method", "Running an agency"];

/**
 * The hub's category as one of this blog's kinds where it is one, matched
 * without case; otherwise the category as written, so a new kind shows rather
 * than being forced into the nearest existing one.
 */
export function kindOf(p: HubPost): string {
  const c = (p.category ?? "").trim();
  return KINDS.find((k) => k.toLowerCase() === c.toLowerCase()) ?? (c || "Findings");
}

/** The fields the index and the post header read, in the registry's shape. */
export type ListedPost = Omit<Post, "kind"> & { kind: string };

export function listed(p: HubPost): ListedPost {
  return { slug: p.slug, title: p.title, blurb: p.excerpt, kind: kindOf(p), date: p.date, readMinutes: p.readTime };
}

/** Only images the hub uploaded are shown; anything else in a post is left out rather than hotlinked. */
export const hubImage = (src: string | undefined): string | null => (src && src.startsWith(HUB_IMAGE_ROOT) ? src : null);
