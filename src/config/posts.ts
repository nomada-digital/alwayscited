/**
 * The writing, in one place.
 *
 * The index used to hold this list and each post repeated its own title and
 * date in three places. One registry means the index, the post header and the
 * structured data cannot drift apart.
 *
 * `kind` is the filter on BlogIndex.dc.html. The board assigns these itself,
 * and they are kept as it has them.
 */

import type { Metadata } from "next";

import { OG_IMAGE } from "./og";
import { BRAND, ORG_REF, SITE_URL } from "./schema";

export type PostKind = "Findings" | "Method" | "Running an agency";

export type Post = {
  slug: string;
  title: string;
  /** One line of standfirst, shown on the index. */
  blurb: string;
  kind: PostKind;
  /** ISO, so it sorts and so the structured data can use it verbatim. */
  date: string;
  readMinutes: number;
};

const REGISTERED: Post[] = [
  {
    slug: "best-ai-seo-agencies",
    title: "Best AI SEO agencies in 2026: 9 US AEO and GEO agencies ranked",
    blurb:
      "The best AI SEO agency for getting your brand named in ChatGPT, Gemini, Perplexity and Google's AI Overviews, whether they call it AI SEO, AEO or GEO, ranked on what you can check before you sign.",
    kind: "Findings",
    date: "2026-09-28",
    readMinutes: 6,
  },
  {
    slug: "how-llms-pick-which-brands-to-recommend",
    title: "How LLMs pick which brands to recommend",
    blurb:
      "A model asked for a recommendation does not evaluate suppliers. It reads a small set of third-party sources - best-of lists, comparisons and round-ups - and returns what they say.",
    kind: "Method",
    date: "2026-04-30",
    readMinutes: 5,
  },
  {
    slug: "aeo-vs-seo-whats-actually-different",
    title: "AEO vs SEO: what is actually different",
    blurb:
      "Two overlapping channels with different surfaces, different measurement and different time horizons. What carries over, and what does not.",
    kind: "Findings",
    date: "2026-04-30",
    readMinutes: 5,
  },
  {
    slug: "why-most-aeo-audits-are-a-waste-of-money",
    title: "Why most AEO audits are a waste of money",
    blurb:
      "The industry has a new product to sell, and most of it is a report nobody acts on. What to buy instead.",
    kind: "Findings",
    date: "2026-04-30",
    readMinutes: 5,
  },
];

/**
 * Newest first, sorted here rather than trusted to the order above.
 *
 * The index takes the first entry as its lead card and lists the rest under
 * it, so the order of this array was the running order of the blog. Nothing
 * enforced it: a fourth post typed at the bottom would have published under
 * three older ones, and the only thing that would have said so is somebody
 * looking at the page. All three carry the same date today, so this changes
 * nothing now and is here for the post after them - ties keep the order they
 * are written in, which is what a stable sort gives.
 */
export const POSTS: Post[] = [...REGISTERED].sort((a, b) => b.date.localeCompare(a.date));

export function postBySlug(slug: string): Post | undefined {
  return POSTS.find((p) => p.slug === slug);
}

/**
 * The post, or a build that fails loudly.
 *
 * A post page whose slug is not in this list has lost its title, date and
 * kind. Rendering it half-built is worse than not building: the error names
 * the slug and the fix is one line here.
 */
export function requirePost(slug: string): Post {
  const post = postBySlug(slug);
  if (!post) throw new Error("no post registered for the slug " + slug);
  return post;
}

/**
 * Where the post lives. Built from the slug rather than typed, because it was
 * typed three times per post - the canonical, the Open Graph url and the
 * structured-data url - and three hand-copied URLs are three chances for a
 * renamed slug to leave one of them pointing at a 404.
 */
export function postUrl(post: Post): string {
  return SITE_URL + "/blog/" + post.slug;
}

/**
 * The metadata that is a fact about the post rather than a piece of copy.
 *
 * The registry above exists so the index, the post header and the structured
 * data cannot drift apart, and for the h1 it worked. The title tag never went
 * through it. All three posts retyped their own, and all three retyped it in
 * title case, so the page said "How LLMs pick which brands to recommend" and
 * the tab, the SERP result and the share card said "How LLMs Pick Which
 * Brands to Recommend". Sentence case is the rule on every other title on the
 * site and on the h1 six lines below the one that broke it.
 *
 * The descriptions stay arguments, because the SERP one and the share one
 * differ on purpose. **The sentence that used to follow - "nothing else on the
 * site holds a second copy of either" - was false, and it was the premise that
 * kept the third surface out of this file.** `blogPostingSchema` took a loose
 * `description: string`, so every post typed one of these two strings a second
 * time by hand. Two posts copied the share line and the third copied the SERP
 * line, and because neither copy referenced anything, nothing could say that
 * the three posts had answered the same question three different ways.
 *
 * It takes the whole `copy` object now, so the second typing is gone by
 * construction rather than by a rule. See `blogPostingSchema` for which of the
 * two it reads and why.
 */
export type PostCopy = {
  /** The meta description - the summary a search engine shows. */
  description: string;
  /** The share card. A hook, written to be clicked rather than to summarise. */
  ogDescription: string;
};

export function postMetadata(post: Post, copy: PostCopy): Metadata {
  return {
    title: post.title,
    description: copy.description,
    alternates: { canonical: postUrl(post) },
    // OG_IMAGE because openGraph merges shallowly - see config/og.ts.
    openGraph: {
      images: OG_IMAGE,
      title: post.title + " | " + BRAND,
      description: copy.ogDescription,
      url: postUrl(post),
    },
  };
}

/**
 * The BlogPosting node.
 *
 * `headline` was the fourth spelling of the title: sentence case, but with a
 * trailing clause no heading on the page carried, so the structured data
 * announced a different article from the one it was attached to. On a site
 * that sells being the entity an answer engine recognises, that is the exact
 * drift we tell clients to fix.
 *
 * `datePublished` was the other retyped fact. The registry date is what the
 * index sorts on, so the two could disagree about when a post was published
 * and only one of them would move it up the page.
 *
 * **`description` was the third, and it was the one still loose.** This took a
 * bare string, so each page typed a fourth description beside its SERP one and
 * its share one. Read off the shipped prerenders on 20 Sep 2026: two posts had
 * copied the share line into it and one had copied the SERP line, so the node
 * an answer engine reads was a hand copy of a different surface on different
 * posts, and a rewrite of either line would have left it behind in silence.
 *
 * It reads `copy.description` - the SERP line - because that field and this one
 * answer the same question, "summarise this article for a machine", where the
 * share line is a hook written to be clicked. That collapses the two posts
 * whose node had copied the hook onto their fuller summary; nothing is lost,
 * since both hooks still publish on the share card where they were written to
 * go. `post-description.test.mts` reads the join back off the built bytes.
 */
export function blogPostingSchema(post: Post, copy: PostCopy) {
  return {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    description: copy.description,
    url: postUrl(post),
    datePublished: post.date,
    author: ORG_REF,
    publisher: ORG_REF,
  };
}

/**
 * "2026-04-30" -> "30 Apr 2026".
 *
 * One line, because this used to be its own copy of the formatter and it was
 * the copy without the guard: a month past twelve rendered
 * "30 undefined 2026" on the blog index and on all three post headers, where
 * the identical function in the result view fell back to the raw string. See
 * `lib/format-date.ts`. The name is kept so the three call sites read the
 * same.
 */
export { formatDate as formatPostDate } from "../lib/format-date";
